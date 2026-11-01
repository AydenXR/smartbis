import crypto from 'node:crypto'
import { promises as dns } from 'node:dns'
import type { Request } from 'express'

// An error whose status and code reach the client as they are (the generic
// handler guesses the status from the message otherwise)
export class AppError extends Error {
  statusCode: number
  code?: string

  constructor(statusCode: number, message: string, code?: string) {
    super(message)
    this.name = 'AppError'
    this.statusCode = statusCode
    this.code = code
  }
}

// =========================
// Email addresses
// =========================

// Same rule as src/lib/validation.ts; the server is the one that decides
const EMAIL_PATTERN =
  /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/

export function normalizeEmail(value: unknown) {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

export function isValidEmailFormat(email: string) {
  if (!email || email.length > 254) return false
  const [local] = email.split('@')
  return local.length <= 64 && EMAIL_PATTERN.test(email)
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(Object.assign(new Error('dns timeout'), { code: 'ETIMEOUT' })), ms)),
  ])
}

// Whether the domain can receive mail: an MX record, or an address record when it
// has none (RFC 5321). A DNS outage or timeout does not block a registration.
export async function domainReceivesMail(domain: string): Promise<boolean> {
  // Tests and offline development can skip the lookup
  if (process.env.EMAIL_DOMAIN_CHECK === 'off') return true
  const missing = (error: unknown) =>
    ['ENOTFOUND', 'ENODATA', 'ENONAME', 'NXDOMAIN'].includes(String((error as { code?: string } | null)?.code || ''))
  try {
    const records = await withTimeout(dns.resolveMx(domain), 4000)
    // A "null MX" (exchange "" or ".") says the domain accepts no mail
    return records.some((record) => record.exchange && record.exchange !== '.')
  } catch (error) {
    if (!missing(error)) return true
  }
  for (const resolve of [(name: string) => dns.resolve4(name), (name: string) => dns.resolve6(name)]) {
    try {
      const addresses = await withTimeout(resolve(domain), 4000)
      if (addresses.length > 0) return true
    } catch (error) {
      if (!missing(error)) return true
    }
  }
  return false
}

export async function assertRegistrableEmail(email: string) {
  if (!isValidEmailFormat(email)) {
    throw new AppError(400, 'Ingresa un correo válido, por ejemplo nombre@empresa.com', 'invalid_email')
  }
  if (!(await domainReceivesMail(email.split('@')[1]))) {
    throw new AppError(400, 'El dominio de ese correo no existe o no recibe correos. Revisa que esté bien escrito.', 'invalid_email')
  }
}

// =========================
// Passwords
// =========================

// Supabase hashes with bcrypt, which ignores anything past 72 bytes
export const PASSWORD_MIN_LENGTH = 8
export const PASSWORD_MAX_BYTES = 72

export function passwordProblem(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) return `La contraseña debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres`
  if (Buffer.byteLength(password, 'utf8') > PASSWORD_MAX_BYTES) return 'La contraseña es demasiado larga (máximo 72 caracteres)'
  if (!/[A-Za-zÀ-ÿ]/.test(password) || !/\d/.test(password)) return 'La contraseña debe incluir al menos una letra y un número'
  return null
}

export function assertValidNewPassword(password: string) {
  const problem = passwordProblem(password)
  if (problem) throw new AppError(400, problem, 'weak_password')
}

// =========================
// Signed email-confirmation links
// =========================

const EMAIL_LINK_TTL_MS = 48 * 60 * 60 * 1000

// A dedicated secret, or one derived from the Supabase service key (server-only).
// Never a constant: anyone could sign links with it.
function emailLinkSecret() {
  const own = process.env.EMAIL_LINK_SECRET?.trim()
  if (own && own.length >= 32) return own
  const serviceKey = process.env.SUPABASE_SECRET_KEY?.trim()
  if (!serviceKey) throw new Error('Falta EMAIL_LINK_SECRET o SUPABASE_SECRET_KEY para firmar los enlaces de correo')
  return crypto.createHmac('sha256', serviceKey).update('smartbis-email-link-v1').digest('hex')
}

type EmailLinkPayload = { sub: string; email: string; purpose: 'verify-email'; exp: number }

export function signEmailVerificationToken(userId: string, email: string, now = Date.now()) {
  const payload: EmailLinkPayload = { sub: userId, email, purpose: 'verify-email', exp: now + EMAIL_LINK_TTL_MS }
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const signature = crypto.createHmac('sha256', emailLinkSecret()).update(body).digest('base64url')
  return `${body}.${signature}`
}

export function invalidEmailLinkError() {
  return new AppError(
    400,
    'El enlace de confirmación no es válido o ya venció. Si ya confirmaste tu correo, solo inicia sesión; si no, pide un enlace nuevo.',
    'invalid_link',
  )
}

export function readEmailVerificationToken(token: unknown, now = Date.now()): EmailLinkPayload {
  const invalid = invalidEmailLinkError()
  if (typeof token !== 'string' || token.length > 2000) throw invalid
  const [body, signature, extra] = token.split('.')
  if (!body || !signature || extra !== undefined) throw invalid

  const expected = crypto.createHmac('sha256', emailLinkSecret()).update(body).digest()
  const given = Buffer.from(signature, 'base64url')
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) throw invalid

  let payload: EmailLinkPayload
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
  } catch {
    throw invalid
  }
  if (payload?.purpose !== 'verify-email' || !payload.sub || !payload.email || !(payload.exp > now)) throw invalid
  return payload
}

// =========================
// Rate limiting (per server process)
// =========================

const hits = new Map<string, number[]>()

// true while the key is under its limit; each allowed call counts
export function takeRateLimit(key: string, limit: number, windowMs: number, now = Date.now()) {
  const recent = (hits.get(key) || []).filter((time) => now - time < windowMs)
  if (recent.length >= limit) {
    hits.set(key, recent)
    return false
  }
  recent.push(now)
  hits.set(key, recent)
  if (hits.size > 10000) {
    for (const [other, times] of hits) {
      if (times.every((time) => now - time >= 60 * 60 * 1000)) hits.delete(other)
    }
  }
  return true
}

export function assertRateLimit(key: string, limit: number, windowMs: number) {
  if (!takeRateLimit(key, limit, windowMs)) {
    throw new AppError(429, 'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.', 'rate_limited')
  }
}

// The visitor's address behind the Cloudflare tunnel
export function clientIp(req: Request) {
  const cloudflare = req.headers['cf-connecting-ip']
  if (typeof cloudflare === 'string' && cloudflare) return cloudflare
  const forwarded = req.headers['x-forwarded-for']
  if (typeof forwarded === 'string' && forwarded) return forwarded.split(',')[0].trim()
  return req.socket?.remoteAddress || 'unknown'
}
