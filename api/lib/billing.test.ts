import test from 'node:test'
import assert from 'node:assert/strict'

process.env.SUPABASE_URL = 'https://supabase.test'
process.env.SUPABASE_SECRET_KEY = 'service-role-key-for-tests'
process.env.SUPABASE_PUBLISHABLE_KEY = 'anon-key-for-tests'
process.env.STRIPE_SECRET_KEY = 'sk_test_for_tests'
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_for_tests'
// Empty, not deleted: a module that loads .env on import would set it again
process.env.SMTP_HOST = ''

const { default: Stripe } = await import('stripe')
const { activatePaidPlan, checkBotAllowance, getTenantBillingStatus, getTrialPlan, handleStripeWebhook, startTenantTrial } =
  await import('./billing.js')

type Call = { method: string; table: string; query: URLSearchParams; body: Record<string, unknown> | undefined }

// A fake Supabase REST: each test says how it answers; every call is recorded
function fakeSupabase(answer: (call: Call) => { status?: number; body?: unknown } | undefined) {
  const calls: Call[] = []
  const original = globalThis.fetch
  globalThis.fetch = (async (input: string | URL, init: RequestInit = {}) => {
    const url = new URL(String(input))
    const call: Call = {
      method: init.method || 'GET',
      table: url.pathname.replace('/rest/v1/', ''),
      query: url.searchParams,
      body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
    }
    calls.push(call)
    const reply = answer(call) || { status: 200, body: [] }
    return new Response(reply.body === undefined ? '' : JSON.stringify(reply.body), { status: reply.status || 200 })
  }) as typeof fetch
  return { calls, restore: () => { globalThis.fetch = original } }
}

const trialPlan = { id: 'trial', conversations: 200, duration_days: 15 }
// Each test asks at its own time, so the 5-minute plan cache never carries over
let clock = Date.parse('2026-11-05T12:00:00Z')
const nextNow = () => new Date((clock += 60 * 60 * 1000))

test('without the trial plan in the table, the trial cannot start', async () => {
  const supabase = fakeSupabase(() => undefined)
  try {
    await assert.rejects(getTrialPlan(nextNow().getTime()), /Falta el plan "trial"/)
  } finally {
    supabase.restore()
  }
})

test('a new business gets a 15-day trial, only once', async () => {
  let created = false
  const supabase = fakeSupabase((call) => {
    if (call.table === 'plans') return { body: [trialPlan] }
    if (call.table === 'subscriptions' && call.method === 'GET') return { body: created ? [{ id: 'sub-1' }] : [] }
    if (call.table === 'subscriptions' && call.method === 'POST') {
      created = true
      return { status: 201 }
    }
    return undefined
  })
  try {
    const now = nextNow()
    await startTenantTrial('tenant-1', 'user-1', now)
    await startTenantTrial('tenant-1', 'user-1', now)
    const inserts = supabase.calls.filter((call) => call.table === 'subscriptions' && call.method === 'POST')
    assert.equal(inserts.length, 1)
    const endsAt = new Date(now.getTime() + 15 * 24 * 60 * 60 * 1000).toISOString()
    assert.deepEqual(inserts[0].body, {
      tenant_id: 'tenant-1',
      plan_id: 'trial',
      status: 'trialing',
      purchased_by: 'user-1',
      trial_ends_at: endsAt,
      current_period_start: now.toISOString(),
      current_period_end: endsAt,
    })
  } finally {
    supabase.restore()
  }
})

test('a trial created at the same moment by another request is not an error', async () => {
  const supabase = fakeSupabase((call) => {
    if (call.table === 'plans') return { body: [trialPlan] }
    if (call.table === 'subscriptions' && call.method === 'POST') {
      return { status: 409, body: { code: '23505', message: 'duplicate key value violates unique constraint "subscriptions_one_trial_per_tenant"' } }
    }
    return undefined
  })
  try {
    await startTenantTrial('tenant-1', 'user-1', nextNow())
  } finally {
    supabase.restore()
  }
})

const period = { start: '2026-11-01T00:00:00.000Z', end: '2026-11-16T00:00:00.000Z' }
const during = new Date('2026-11-05T12:00:00Z')

function billingStatus(overrides: Record<string, unknown> = {}) {
  return {
    subscription_id: 'sub-1',
    status: 'trialing',
    has_access: true,
    current_period_start: period.start,
    current_period_end: period.end,
    conversations_limit: 200,
    conversations_used: 10,
    ...overrides,
  }
}

test('a business registered before plans existed keeps its bot, nothing counted', async () => {
  const supabase = fakeSupabase(() => undefined)
  try {
    assert.deepEqual(await checkBotAllowance('tenant-1', 'psid-1', 'page-1', during), { allowed: true, record: null })
  } finally {
    supabase.restore()
  }
})

test('without a current plan, or with the trial over, the bot does not answer', async () => {
  const ended = fakeSupabase((call) => (call.table === 'subscriptions' ? { body: [{ id: 'sub-1' }] } : undefined))
  try {
    assert.deepEqual(await checkBotAllowance('tenant-1', 'psid-1', 'page-1', during), { allowed: false, reason: 'no_plan' })
  } finally {
    ended.restore()
  }
  const expired = fakeSupabase((call) => (call.table === 'tenant_billing_status' ? { body: [billingStatus({ has_access: false })] } : undefined))
  try {
    assert.deepEqual(await checkBotAllowance('tenant-1', 'psid-1', 'page-1', during), { allowed: false, reason: 'expired' })
  } finally {
    expired.restore()
  }
})

test('a new contact is answered while there is room and counted once the bot answered', async () => {
  const supabase = fakeSupabase((call) => (call.table === 'tenant_billing_status' ? { body: [billingStatus()] } : undefined))
  try {
    const allowance = await checkBotAllowance('tenant-1', 'psid-1', 'page-1', during)
    assert.equal(allowance.allowed, true)
    assert.ok(allowance.allowed && allowance.record)
    assert.ok(!supabase.calls.some((call) => call.method === 'POST'), 'nothing counted before the answer is sent')

    await allowance.record()
    const insert = supabase.calls.find((call) => call.table === 'bot_conversations' && call.method === 'POST')
    assert.deepEqual(insert?.body, { tenant_id: 'tenant-1', page_id: 'page-1', contact_id: 'psid-1' })
    const lookup = supabase.calls.find((call) => call.table === 'bot_conversations' && call.method === 'GET')
    assert.equal(lookup?.query.get('started_at'), `gte.${period.start}`)
  } finally {
    supabase.restore()
  }
})

test('with the limit reached, a contact already counted is answered and a new one is not', async () => {
  const supabase = fakeSupabase((call) => {
    if (call.table === 'tenant_billing_status') return { body: [billingStatus({ conversations_used: 200 })] }
    if (call.table === 'bot_conversations') return { body: call.query.get('contact_id') === 'eq.psid-known' ? [{ id: 1 }] : [] }
    return undefined
  })
  try {
    assert.deepEqual(await checkBotAllowance('tenant-1', 'psid-known', 'page-1', during), { allowed: true, record: null })
    assert.deepEqual(await checkBotAllowance('tenant-1', 'psid-new', 'page-1', during), { allowed: false, reason: 'limit' })
  } finally {
    supabase.restore()
  }
})

const basePlan = { id: 'base_849', name: 'Paquete Básico', kind: 'base', price_cents: 84900, currency: 'mxn', conversations: 200, duration_days: 30, is_active: true }

test('the profile shows unlimited, the current trial, or the plan that expired', async () => {
  const legacy = fakeSupabase(() => undefined)
  try {
    assert.deepEqual(await getTenantBillingStatus('tenant-1', during), { kind: 'unlimited' })
  } finally {
    legacy.restore()
  }

  const trial = fakeSupabase((call) => {
    if (call.table === 'tenant_billing_status') return { body: [{ ...billingStatus(), plan_id: 'trial' }] }
    if (call.table === 'plans') return { body: [{ ...trialPlan, name: 'Prueba gratis' }] }
    return undefined
  })
  try {
    assert.deepEqual(await getTenantBillingStatus('tenant-1', during), {
      kind: 'trial', planId: 'trial', planName: 'Prueba gratis', active: true,
      periodEnd: period.end, conversationsUsed: 10, conversationsLimit: 200,
    })
  } finally {
    trial.restore()
  }

  const expired = fakeSupabase((call) => {
    if (call.table === 'subscriptions') return { body: [{ id: 'sub-1', plan_id: 'base_849', status: 'expired', current_period_end: period.start }] }
    if (call.table === 'plans') return { body: [basePlan] }
    return undefined
  })
  try {
    const status = await getTenantBillingStatus('tenant-1', during)
    assert.ok(status.kind === 'paid' && !status.active)
  } finally {
    expired.restore()
  }
})

const DAY = 24 * 60 * 60 * 1000

test('paying during the trial keeps the free days left: the 30 paid days start when the trial ends', async () => {
  // Trial ends on day 16 (period.end); paid on day 5 (during)
  const supabase = fakeSupabase((call) => {
    if (call.table === 'plans') return { body: [basePlan] }
    if (call.table === 'subscriptions' && call.method === 'GET') {
      return { body: [{ id: 'sub-trial', status: 'trialing', current_period_end: period.end }] }
    }
    return undefined
  })
  try {
    const result = await activatePaidPlan({ tenantId: 'tenant-1', planId: 'base_849', userId: 'user-1', stripeCustomerId: 'cus_1' }, during)
    const end = new Date(Date.parse(period.end) + 30 * DAY).toISOString()
    assert.deepEqual(result, { planName: 'Paquete Básico', periodEnd: end })
    const lookup = supabase.calls.find((call) => call.table === 'subscriptions' && call.method === 'GET')
    assert.equal(lookup?.query.get('status'), 'in.(trialing,active,past_due)')
    const update = supabase.calls.find((call) => call.method === 'PATCH')
    assert.equal(update?.query.get('id'), 'eq.sub-trial')
    assert.deepEqual(update?.body, {
      plan_id: 'base_849', status: 'active', current_period_start: during.toISOString(), current_period_end: end,
      canceled_at: null, purchased_by: 'user-1', stripe_customer_id: 'cus_1', updated_at: during.toISOString(),
    })
    assert.ok(!supabase.calls.some((call) => call.table === 'subscriptions' && call.method === 'POST'))
  } finally {
    supabase.restore()
  }
})

test('paying after the trial ended, or renewing a paid month, lasts 30 days from the payment', async () => {
  for (const current of [
    { id: 'sub-1', status: 'trialing', current_period_end: period.start },
    { id: 'sub-1', status: 'active', current_period_end: period.end },
    { id: 'sub-1', status: 'trialing', current_period_end: 'not a date' },
  ]) {
    const supabase = fakeSupabase((call) => {
      if (call.table === 'plans') return { body: [basePlan] }
      if (call.table === 'subscriptions' && call.method === 'GET') return { body: [current] }
      return undefined
    })
    try {
      const result = await activatePaidPlan({ tenantId: 'tenant-1', planId: 'base_849' }, during)
      assert.equal(result.periodEnd, new Date(during.getTime() + 30 * DAY).toISOString(), current.status)
    } finally {
      supabase.restore()
    }
  }
})

test('a payment after the plan ended creates a new current subscription', async () => {
  const supabase = fakeSupabase((call) => (call.table === 'plans' ? { body: [basePlan] } : undefined))
  try {
    await activatePaidPlan({ tenantId: 'tenant-1', planId: 'base_849' }, during)
    const insert = supabase.calls.find((call) => call.table === 'subscriptions' && call.method === 'POST')
    assert.equal(insert?.body?.tenant_id, 'tenant-1')
    assert.equal(insert?.body?.status, 'active')
  } finally {
    supabase.restore()
  }
})

function signedCheckoutEvent(id: string, overrides: Record<string, unknown> = {}) {
  const payload = JSON.stringify({
    id,
    object: 'event',
    type: 'checkout.session.completed',
    data: {
      object: {
        id: 'cs_test_1',
        object: 'checkout.session',
        payment_status: 'paid',
        customer: 'cus_1',
        customer_details: { email: 'ana@empresa.com' },
        metadata: { tenant_id: 'tenant-1', plan_id: 'base_849', user_id: 'user-1' },
        ...overrides,
      },
    },
  })
  const signature = new Stripe('sk_test_for_tests').webhooks.generateTestHeaderString({ payload, secret: 'whsec_for_tests' })
  return { body: Buffer.from(payload), signature }
}

test('a webhook without a valid Stripe signature changes nothing', async () => {
  const supabase = fakeSupabase(() => undefined)
  try {
    const { body } = signedCheckoutEvent('evt_forged')
    await assert.rejects(handleStripeWebhook(body, 't=1,v1=forged'), (error: { statusCode?: number }) => error.statusCode === 400)
    assert.equal(supabase.calls.length, 0)
  } finally {
    supabase.restore()
  }
})

test('a paid checkout activates the plan once, also when Stripe sends the event again', async () => {
  const seen = new Set<string>()
  const warn = console.warn
  const log = console.log
  console.warn = () => {}
  console.log = () => {}
  const supabase = fakeSupabase((call) => {
    if (call.table === 'stripe_events' && call.method === 'POST') {
      const id = String(call.body?.id)
      if (seen.has(id)) return { status: 409, body: { code: '23505', message: 'duplicate key value' } }
      seen.add(id)
      return { status: 201 }
    }
    if (call.table === 'plans') return { body: [basePlan] }
    if (call.table === 'subscriptions' && call.method === 'GET') return { body: [{ id: 'sub-trial' }] }
    return undefined
  })
  try {
    const event = signedCheckoutEvent('evt_paid')
    await handleStripeWebhook(event.body, event.signature)
    await handleStripeWebhook(event.body, event.signature)
    assert.equal(supabase.calls.filter((call) => call.method === 'PATCH').length, 1)
    const email = supabase.calls.find((call) => call.table === 'billing_emails')
    assert.deepEqual(email?.body, { tenant_id: 'tenant-1', kind: 'plan_paid', reference_id: 'cs_test_1', sent_to: 'ana@empresa.com' })
  } finally {
    supabase.restore()
    console.warn = warn
    console.log = log
  }
})

test('an unpaid checkout activates nothing, and a failed activation can be retried', async () => {
  const unpaid = fakeSupabase(() => undefined)
  try {
    const event = signedCheckoutEvent('evt_unpaid', { payment_status: 'unpaid' })
    await handleStripeWebhook(event.body, event.signature)
    assert.equal(unpaid.calls.length, 0)
  } finally {
    unpaid.restore()
  }

  const failing = fakeSupabase((call) => {
    if (call.table === 'stripe_events' && call.method === 'POST') return { status: 201 }
    if (call.table === 'plans') return { status: 500, body: { message: 'Supabase caído' } }
    return undefined
  })
  try {
    const event = signedCheckoutEvent('evt_retry')
    await assert.rejects(handleStripeWebhook(event.body, event.signature), /Supabase caído/)
    const release = failing.calls.find((call) => call.table === 'stripe_events' && call.method === 'DELETE')
    assert.equal(release?.query.get('id'), 'eq.evt_retry')
  } finally {
    failing.restore()
  }
})
