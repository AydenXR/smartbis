import test from 'node:test'
import assert from 'node:assert/strict'

process.env.SUPABASE_URL = 'https://supabase.test'
process.env.SUPABASE_SECRET_KEY = 'service-role-key-for-tests'
process.env.SUPABASE_PUBLISHABLE_KEY = 'anon-key-for-tests'
process.env.EMAIL_DOMAIN_CHECK = 'off'
delete process.env.SMTP_HOST
delete process.env.EMAIL_LINK_SECRET

const {
  AppError,
  isValidEmailFormat,
  passwordProblem,
  readEmailVerificationToken,
  signEmailVerificationToken,
  takeRateLimit,
} = await import('./accountSecurity.js')
const {
  confirmDbAccountEmail,
  loginDbAccount,
  registerDbAccount,
  resetDbPassword,
  sendDbPasswordResetEmail,
} = await import('./dbWorkspace.js')

type Call = { method: string; path: string; body: any; auth: string }

// A fake Supabase: each test says how it answers; every call is recorded
function fakeSupabase(answer: (call: Call) => { status?: number; body?: unknown } | undefined) {
  const calls: Call[] = []
  const original = globalThis.fetch
  globalThis.fetch = (async (input: any, init: any = {}) => {
    const url = new URL(String(input))
    const call: Call = {
      method: init.method || 'GET',
      path: `${url.pathname}${url.search}`,
      body: init.body ? JSON.parse(init.body) : undefined,
      auth: init.headers?.Authorization || '',
    }
    calls.push(call)
    const reply = answer(call) || { status: 200, body: [] }
    return new Response(JSON.stringify(reply.body ?? {}), { status: reply.status || 200 })
  }) as typeof fetch
  return { calls, restore: () => { globalThis.fetch = original } }
}

// Mail is printed instead of sent while SMTP is not configured (development)
async function quietly<T>(work: () => Promise<T>) {
  const warn = console.warn
  const printed: string[] = []
  console.warn = (...args: unknown[]) => { printed.push(args.join(' ')) }
  try {
    return { result: await work(), printed: printed.join('\n') }
  } finally {
    console.warn = warn
  }
}

test('email format: real addresses pass, broken ones do not', () => {
  for (const email of ['ana@empresa.com', 'ana.perez+mx@sub.empresa.com.mx', 'a_b@x.io']) assert.ok(isValidEmailFormat(email), email)
  for (const email of ['ana', 'ana@', '@empresa.com', 'ana@empresa', 'ana..perez@empresa.com', '.ana@empresa.com', 'ana@-empresa.com', 'ana perez@empresa.com', 'ana@empresa.c']) {
    assert.ok(!isValidEmailFormat(email), email)
  }
})

test('passwords need 8 characters with a letter and a number, up to 72 bytes', () => {
  assert.match(passwordProblem('abc123') || '', /8 caracteres/)
  assert.match(passwordProblem('abcdefgh') || '', /letra y un número/)
  assert.match(passwordProblem('12345678') || '', /letra y un número/)
  assert.match(passwordProblem(`a1${'x'.repeat(80)}`) || '', /demasiado larga/)
  assert.equal(passwordProblem('Salubel2026'), null)
})

test('a confirmation link only works signed by the server and before it expires', () => {
  const now = Date.now()
  const token = signEmailVerificationToken('user-1', 'ana@empresa.com', now)
  assert.equal(readEmailVerificationToken(token, now + 1000).sub, 'user-1')

  const [body, signature] = token.split('.')
  const forged = Buffer.from(JSON.stringify({ sub: 'user-2', email: 'otro@empresa.com', purpose: 'verify-email', exp: now + 1e9 })).toString('base64url')
  for (const bad of [`${forged}.${signature}`, `${body}.${signature.slice(0, -2)}xx`, `${body}`, '', 'a.b.c']) {
    assert.throws(() => readEmailVerificationToken(bad, now), (error: any) => error instanceof AppError && error.code === 'invalid_link')
  }
  assert.throws(() => readEmailVerificationToken(token, now + 49 * 60 * 60 * 1000), /no es válido o ya venció/)
})

test('rate limit blocks after the limit and frees the key once the window passes', () => {
  const key = `test:${Math.random()}`
  assert.ok(takeRateLimit(key, 2, 1000, 0))
  assert.ok(takeRateLimit(key, 2, 1000, 10))
  assert.ok(!takeRateLimit(key, 2, 1000, 20))
  assert.ok(takeRateLimit(key, 2, 1000, 1500))
})

test('registering creates an unconfirmed account and emails the link, without signing in', async () => {
  const supabase = fakeSupabase((call) => {
    if (call.path === '/auth/v1/admin/users' && call.method === 'POST') return { body: { id: 'user-1', email: call.body.email } }
    if (call.path.startsWith('/rest/v1/tenants') && call.method === 'POST') return { body: [{ id: 'tenant-1', slug: 'C-1' }] }
    return undefined
  })
  try {
    const { result, printed } = await quietly(() => registerDbAccount({ email: ' Ana@Empresa.com ', password: 'Salubel2026' }))
    assert.deepEqual(result, { pendingVerification: true, email: 'ana@empresa.com', emailSent: true })
    const created = supabase.calls.find((call) => call.path === '/auth/v1/admin/users')
    assert.equal(created?.body.email_confirm, false)
    assert.ok(!supabase.calls.some((call) => call.path.includes('grant_type=password')), 'no session at registration')
    // The emailed link carries a token for this account, after "#"
    const token = decodeURIComponent(printed.match(/verificar-correo#token=([^\s]+)/)?.[1] || '')
    assert.equal(readEmailVerificationToken(token).sub, 'user-1')
  } finally {
    supabase.restore()
  }
})

test('registering with an email already in use says so and creates nothing', async () => {
  const supabase = fakeSupabase((call) => {
    if (call.path === '/auth/v1/admin/users') {
      return { status: 422, body: { code: 422, error_code: 'email_exists', msg: 'A user with this email address has already been registered' } }
    }
    return undefined
  })
  try {
    await assert.rejects(
      registerDbAccount({ email: 'ana@empresa.com', password: 'Salubel2026' }),
      (error: any) => error instanceof AppError && error.statusCode === 409 && /ya está en uso/.test(error.message),
    )
    assert.ok(!supabase.calls.some((call) => call.path.startsWith('/rest/v1/tenants')))
  } finally {
    supabase.restore()
  }
})

test('registering rejects a bad email or a weak password before calling Supabase', async () => {
  const supabase = fakeSupabase(() => undefined)
  try {
    await assert.rejects(registerDbAccount({ email: 'ana@empresa', password: 'Salubel2026' }), /correo válido/)
    await assert.rejects(registerDbAccount({ email: 'ana@empresa.com', password: 'abcdefgh' }), /letra y un número/)
    assert.equal(supabase.calls.length, 0)
  } finally {
    supabase.restore()
  }
})

test('an unconfirmed account cannot sign in, whatever the Supabase setting', async () => {
  for (const answer of [
    { status: 400, body: { error_code: 'email_not_confirmed', msg: 'Email not confirmed' } },
    { status: 200, body: { access_token: 'a', refresh_token: 'r', user: { id: 'user-1', email: 'ana@empresa.com', email_confirmed_at: null } } },
  ]) {
    const supabase = fakeSupabase((call) => (call.path.includes('grant_type=password') ? answer : undefined))
    try {
      await assert.rejects(
        loginDbAccount({ email: 'ana@empresa.com', password: 'Salubel2026' }),
        (error: any) => error instanceof AppError && error.statusCode === 403 && error.code === 'email_not_confirmed',
      )
    } finally {
      supabase.restore()
    }
  }
})

test('a confirmed account signs in as before', async () => {
  const supabase = fakeSupabase((call) => {
    if (call.path.includes('grant_type=password')) {
      return { body: { access_token: 'access', refresh_token: 'refresh', user: { id: 'user-1', email: 'ana@empresa.com', email_confirmed_at: '2026-01-01T00:00:00Z' } } }
    }
    if (call.path.startsWith('/rest/v1/tenants')) return { body: [{ id: 'tenant-1', slug: 'C-1', name: 'Cliente', created_by: 'user-1' }] }
    return undefined
  })
  try {
    const session = await loginDbAccount({ email: 'ana@empresa.com', password: 'Salubel2026' })
    assert.equal(session.token, 'access')
    assert.equal(session.user.tenantId, 'tenant-1')
  } finally {
    supabase.restore()
  }
})

test('opening the confirmation link confirms the account, and opening it again is harmless', async () => {
  let confirmed = false
  const supabase = fakeSupabase((call) => {
    if (call.path === '/auth/v1/admin/users/user-1' && call.method === 'GET') {
      return { body: { id: 'user-1', email: 'ana@empresa.com', email_confirmed_at: confirmed ? '2026-01-01T00:00:00Z' : null } }
    }
    if (call.path === '/auth/v1/admin/users/user-1' && call.method === 'PUT') {
      confirmed = true
      return { body: { id: 'user-1' } }
    }
    return undefined
  })
  try {
    const token = signEmailVerificationToken('user-1', 'ana@empresa.com')
    assert.deepEqual(await confirmDbAccountEmail(token), { email: 'ana@empresa.com' })
    assert.deepEqual(await confirmDbAccountEmail(token), { email: 'ana@empresa.com' })
    const updates = supabase.calls.filter((call) => call.method === 'PUT')
    assert.equal(updates.length, 1)
    assert.deepEqual(updates[0].body, { email_confirm: true })
  } finally {
    supabase.restore()
  }
})

test('asking for a reset of an unknown email sends nothing and does not fail', async () => {
  const supabase = fakeSupabase((call) => (call.path === '/auth/v1/admin/generate_link' ? { status: 404, body: { error_code: 'user_not_found', msg: 'User not found' } } : undefined))
  try {
    const { printed } = await quietly(() => sendDbPasswordResetEmail('nadie@empresa.com'))
    assert.equal(printed, '')
  } finally {
    supabase.restore()
  }
})

test('the reset link sets the new password once and closes the other sessions', async () => {
  const supabase = fakeSupabase((call) => {
    if (call.path === '/auth/v1/admin/generate_link') return { body: { hashed_token: 'abcdef0123456789abcdef0123456789', id: 'user-1' } }
    if (call.path === '/auth/v1/verify') {
      return call.body.token_hash === 'abcdef0123456789abcdef0123456789'
        ? { body: { access_token: 'recovery-access', user: { id: 'user-1' } } }
        : { status: 403, body: { error_code: 'otp_expired', msg: 'Token has expired or is invalid' } }
    }
    return undefined
  })
  try {
    const { printed } = await quietly(() => sendDbPasswordResetEmail('ana@empresa.com'))
    const tokenHash = decodeURIComponent(printed.match(/restablecer-contrasena#token=([^\s]+)/)?.[1] || '')
    assert.equal(tokenHash, 'abcdef0123456789abcdef0123456789')
    assert.equal(supabase.calls.find((call) => call.path === '/auth/v1/admin/generate_link')?.body.type, 'recovery')

    await resetDbPassword({ token: tokenHash, password: 'NuevaClave2026' })
    const update = supabase.calls.find((call) => call.path === '/auth/v1/admin/users/user-1' && call.method === 'PUT')
    assert.deepEqual(update?.body, { password: 'NuevaClave2026' })
    const logout = supabase.calls.find((call) => call.path === '/auth/v1/logout?scope=global')
    assert.equal(logout?.auth, 'Bearer recovery-access')

    await assert.rejects(
      resetDbPassword({ token: 'ffffffffffffffffffffffffffffffff', password: 'NuevaClave2026' }),
      (error: any) => error instanceof AppError && error.code === 'invalid_link',
    )
    await assert.rejects(resetDbPassword({ token: tokenHash, password: 'corta1' }), /8 caracteres/)
  } finally {
    supabase.restore()
  }
})
