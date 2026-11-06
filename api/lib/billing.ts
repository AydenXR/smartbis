import Stripe from 'stripe'
import { AppError } from './accountSecurity.js'
import { appPublicUrl, sendPlanPaidEmail } from './mailer.js'
import { restRequest } from './supabaseRest.js'

// Plans, subscriptions and the conversations the bot answers, from the Supabase
// tables plans, subscriptions, bot_conversations and the view
// tenant_billing_status. A conversation is a distinct Messenger contact in the
// subscription's period: a contact already counted is always answered, a new one
// only while the period has room.

// The free trial is a row of plans (inactive, so never offered for sale): its
// length and conversations are changed there, not here
export const TRIAL_PLAN_ID = 'trial'

const DAY_MS = 24 * 60 * 60 * 1000
const PLAN_CACHE_MS = 5 * 60 * 1000

export type TrialPlan = { days: number; conversations: number }

type PlanRow = { id: string; conversations: number; duration_days: number | null }

type BillingStatusRow = {
  subscription_id: string
  status: string
  has_access: boolean
  current_period_start: string
  current_period_end: string
  conversations_limit: number
  conversations_used: number
}

let trialPlanCache: { plan: TrialPlan; at: number } | null = null

export async function getTrialPlan(now = Date.now()): Promise<TrialPlan> {
  if (trialPlanCache && now - trialPlanCache.at < PLAN_CACHE_MS) return trialPlanCache.plan
  const rows = await restRequest<PlanRow[]>('plans', {
    query: { select: 'id,conversations,duration_days', id: `eq.${TRIAL_PLAN_ID}`, limit: '1' },
  })
  const row = rows[0]
  if (!row || !row.duration_days || row.duration_days < 1 || row.conversations < 1) {
    throw new Error(`Falta el plan "${TRIAL_PLAN_ID}" en la tabla plans (días y conversaciones de la prueba gratis)`)
  }
  const plan = { days: row.duration_days, conversations: row.conversations }
  trialPlanCache = { plan, at: now }
  return plan
}

function isUniqueViolation(error: unknown) {
  const { code, message } = (error || {}) as { code?: string; message?: string }
  return code === '23505' || /duplicate key/i.test(message || '')
}

// Starts the free trial of a business that never had a subscription. Running it
// again (the confirmation link opened twice) changes nothing.
export async function startTenantTrial(tenantId: string, userId: string, now = new Date()) {
  const existing = await restRequest<Array<{ id: string }>>('subscriptions', {
    query: { select: 'id', tenant_id: `eq.${tenantId}`, limit: '1' },
  })
  if (existing.length) return

  const plan = await getTrialPlan(now.getTime())
  const endsAt = new Date(now.getTime() + plan.days * DAY_MS).toISOString()
  try {
    await restRequest('subscriptions', {
      method: 'POST',
      body: {
        tenant_id: tenantId,
        plan_id: TRIAL_PLAN_ID,
        status: 'trialing',
        purchased_by: userId,
        trial_ends_at: endsAt,
        current_period_start: now.toISOString(),
        current_period_end: endsAt,
      },
      headers: { Prefer: 'return=minimal' },
    })
  } catch (error) {
    // Another request created it at the same moment (one trial per business)
    if (isUniqueViolation(error)) return
    throw error
  }
}

export type BotAllowance =
  // record: counts the contact once the bot has answered it (null: nothing to count)
  | { allowed: true; record: (() => Promise<void>) | null }
  | { allowed: false; reason: 'no_plan' | 'expired' | 'limit' }

async function isContactCounted(tenantId: string, contactId: string, periodStart: string) {
  const rows = await restRequest<Array<{ id: number }>>('bot_conversations', {
    query: {
      select: 'id',
      tenant_id: `eq.${tenantId}`,
      contact_id: `eq.${contactId}`,
      started_at: `gte.${periodStart}`,
      limit: '1',
    },
  })
  return rows.length > 0
}

// Whether the bot may answer this Messenger contact now
export async function checkBotAllowance(tenantId: string, contactId: string, pageId: string, now = new Date()): Promise<BotAllowance> {
  const [status] = await restRequest<BillingStatusRow[]>('tenant_billing_status', {
    query: {
      select: 'subscription_id,status,has_access,current_period_start,current_period_end,conversations_limit,conversations_used',
      tenant_id: `eq.${tenantId}`,
      limit: '1',
    },
  })

  if (!status) {
    // Businesses registered before plans existed keep the bot as they had it
    const anySubscription = await restRequest<Array<{ id: string }>>('subscriptions', {
      query: { select: 'id', tenant_id: `eq.${tenantId}`, limit: '1' },
    })
    return anySubscription.length ? { allowed: false, reason: 'no_plan' } : { allowed: true, record: null }
  }

  if (!status.has_access || new Date(status.current_period_end).getTime() <= now.getTime()) {
    return { allowed: false, reason: 'expired' }
  }

  const periodStart = status.current_period_start
  if (await isContactCounted(tenantId, contactId, periodStart)) return { allowed: true, record: null }
  if (Number(status.conversations_used) >= Number(status.conversations_limit)) return { allowed: false, reason: 'limit' }

  return {
    allowed: true,
    record: async () => {
      // A second reply to the same new contact may have counted it meanwhile
      if (await isContactCounted(tenantId, contactId, periodStart)) return
      await restRequest('bot_conversations', {
        method: 'POST',
        body: { tenant_id: tenantId, page_id: pageId, contact_id: contactId },
        headers: { Prefer: 'return=minimal' },
      })
    },
  }
}

// ===== Status of the plan, for the profile =====

export type BillingStatus =
  // A business registered before plans existed: no limits, nothing to buy
  | { kind: 'unlimited' }
  | {
      kind: 'trial' | 'paid'
      planId: string
      planName: string
      active: boolean
      periodEnd: string
      conversationsUsed: number
      conversationsLimit: number
    }

type SubscriptionRow = {
  id: string
  plan_id: string
  status: string
  current_period_end: string
}

type FullPlanRow = PlanRow & { name: string; kind: string; price_cents: number; currency: string; is_active: boolean }

async function getPlan(planId: string) {
  const rows = await restRequest<FullPlanRow[]>('plans', {
    query: { select: 'id,name,kind,price_cents,currency,conversations,duration_days,is_active', id: `eq.${planId}`, limit: '1' },
  })
  return rows[0] || null
}

export async function getTenantBillingStatus(tenantId: string, now = new Date()): Promise<BillingStatus> {
  const [current] = await restRequest<Array<BillingStatusRow & { plan_id: string }>>('tenant_billing_status', {
    query: {
      select: 'plan_id,status,has_access,current_period_end,conversations_limit,conversations_used',
      tenant_id: `eq.${tenantId}`,
      limit: '1',
    },
  })
  // Without a current one, the last subscription the business had (canceled or expired)
  const last = current
    ? null
    : (await restRequest<SubscriptionRow[]>('subscriptions', {
        query: { select: 'id,plan_id,status,current_period_end', tenant_id: `eq.${tenantId}`, order: 'created_at.desc', limit: '1' },
      }))[0] || null
  const source = current || last
  if (!source) return { kind: 'unlimited' }

  const plan = await getPlan(source.plan_id)
  return {
    kind: source.plan_id === TRIAL_PLAN_ID ? 'trial' : 'paid',
    planId: source.plan_id,
    planName: plan?.name || source.plan_id,
    active: Boolean(current?.has_access) && new Date(source.current_period_end).getTime() > now.getTime(),
    periodEnd: source.current_period_end,
    conversationsUsed: Number(current?.conversations_used || 0),
    conversationsLimit: Number(current?.conversations_limit || plan?.conversations || 0),
  }
}

// ===== Payment with Stripe Checkout =====
// .env of the server: STRIPE_SECRET_KEY (sk_test_... / sk_live_...) and
// STRIPE_WEBHOOK_SECRET (whsec_..., from the webhook registered in Stripe)

let stripeClient: Stripe | null = null

function getStripe() {
  const secretKey = process.env.STRIPE_SECRET_KEY?.trim()
  if (!secretKey) throw new AppError(503, 'Los pagos no están disponibles por el momento. Inténtalo más tarde.', 'payments_unavailable')
  stripeClient ??= new Stripe(secretKey)
  return stripeClient
}

// Opens Stripe's payment page for a plan. The plan is activated by the webhook,
// never by the return to the app (that address can be opened without paying).
export async function createPlanCheckout(input: { tenantId: string; userId: string; email: string; planId: string }) {
  const status = await getTenantBillingStatus(input.tenantId)
  if (status.kind === 'unlimited') throw new AppError(403, 'Tu cuenta ya tiene el plan ilimitado.', 'plan_unlimited')

  const plan = await getPlan(input.planId)
  if (!plan || !plan.is_active || plan.kind !== 'base' || plan.price_cents <= 0 || !plan.duration_days) {
    throw new AppError(400, 'Ese paquete no está disponible.', 'plan_unavailable')
  }

  const metadata = { tenant_id: input.tenantId, plan_id: plan.id, user_id: input.userId }
  const session = await getStripe().checkout.sessions.create({
    mode: 'payment',
    locale: 'es',
    customer_email: input.email || undefined,
    client_reference_id: input.tenantId,
    line_items: [{
      quantity: 1,
      price_data: {
        currency: plan.currency,
        unit_amount: plan.price_cents,
        product_data: {
          name: `Smartbis · ${plan.name}`,
          description: `${plan.conversations} conversaciones del bot por ${plan.duration_days} días`,
        },
      },
    }],
    metadata,
    payment_intent_data: { metadata },
    success_url: `${appPublicUrl()}/?pago=exitoso`,
    cancel_url: `${appPublicUrl()}/?pago=cancelado`,
  })
  if (!session.url) throw new Error('Stripe no devolvió la página de pago')
  return { url: session.url }
}

// The paid plan is active from the day of the payment, and its conversations
// count from that day. It lasts its days (30) from the payment, or from the end
// of a trial still running: paying early does not lose the free days left.
export async function activatePaidPlan(
  input: { tenantId: string; planId: string; userId?: string; stripeCustomerId?: string },
  now = new Date(),
) {
  const plan = await getPlan(input.planId)
  if (!plan || plan.kind !== 'base' || !plan.duration_days) throw new Error(`El plan pagado "${input.planId}" no existe en plans`)

  // The trial (or the previous month) becomes the paid plan: one current row per business
  const [current] = await restRequest<Array<{ id: string; status: string; current_period_end: string }>>('subscriptions', {
    query: { select: 'id,status,current_period_end', tenant_id: `eq.${input.tenantId}`, status: 'in.(trialing,active,past_due)', limit: '1' },
  })
  const trialEnd = current?.status === 'trialing' ? new Date(current.current_period_end).getTime() : NaN
  const paidFrom = Number.isFinite(trialEnd) && trialEnd > now.getTime() ? trialEnd : now.getTime()

  const start = now.toISOString()
  const end = new Date(paidFrom + plan.duration_days * DAY_MS).toISOString()
  const period = {
    plan_id: plan.id,
    status: 'active',
    current_period_start: start,
    current_period_end: end,
    canceled_at: null,
    ...(input.userId ? { purchased_by: input.userId } : {}),
    ...(input.stripeCustomerId ? { stripe_customer_id: input.stripeCustomerId } : {}),
    updated_at: start,
  }

  if (current) {
    await restRequest('subscriptions', {
      method: 'PATCH',
      query: { id: `eq.${current.id}` },
      body: period,
      headers: { Prefer: 'return=minimal' },
    })
  } else {
    await restRequest('subscriptions', {
      method: 'POST',
      body: { tenant_id: input.tenantId, ...period },
      headers: { Prefer: 'return=minimal' },
    })
  }
  return { planName: plan.name, periodEnd: end }
}

// Each Stripe event is applied once: its id is recorded before the work and
// removed if the work fails, so Stripe's retry can apply it again
async function claimStripeEvent(event: Stripe.Event) {
  try {
    await restRequest('stripe_events', {
      method: 'POST',
      body: { id: event.id, type: event.type },
      headers: { Prefer: 'return=minimal' },
    })
    return true
  } catch (error) {
    if (isUniqueViolation(error)) return false
    throw error
  }
}

async function sendPlanPaidEmailOnce(input: { tenantId: string; sessionId: string; email: string; planName: string; periodEnd: string }) {
  try {
    await restRequest('billing_emails', {
      method: 'POST',
      body: { tenant_id: input.tenantId, kind: 'plan_paid', reference_id: input.sessionId, sent_to: input.email },
      headers: { Prefer: 'return=minimal' },
    })
  } catch (error) {
    if (isUniqueViolation(error)) return
    throw error
  }
  await sendPlanPaidEmail(input.email, { planName: input.planName, periodEnd: input.periodEnd })
}

export async function handleStripeWebhook(rawBody: Buffer | undefined, signature: string) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim()
  if (!webhookSecret) throw new AppError(503, 'Webhook de Stripe no configurado', 'webhook_unconfigured')
  if (!rawBody?.length || !signature) throw new AppError(400, 'Falta la firma de Stripe', 'invalid_signature')

  let event: Stripe.Event
  try {
    event = getStripe().webhooks.constructEvent(rawBody, signature, webhookSecret)
  } catch {
    throw new AppError(400, 'Firma de Stripe inválida', 'invalid_signature')
  }

  // A card is paid at once; a delayed method (OXXO) arrives with async_payment_succeeded
  const isPaidCheckout =
    (event.type === 'checkout.session.completed' && event.data.object.payment_status === 'paid') ||
    event.type === 'checkout.session.async_payment_succeeded'
  if (!isPaidCheckout) return

  const session = event.data.object as Stripe.Checkout.Session
  const tenantId = session.metadata?.tenant_id
  const planId = session.metadata?.plan_id
  if (!tenantId || !planId) {
    console.error('[billing] pago de Stripe sin negocio o plan en metadata', { sessionId: session.id })
    return
  }

  if (!(await claimStripeEvent(event))) return
  let activated: { planName: string; periodEnd: string }
  try {
    activated = await activatePaidPlan({
      tenantId,
      planId,
      userId: session.metadata?.user_id || undefined,
      stripeCustomerId: typeof session.customer === 'string' ? session.customer : undefined,
    })
  } catch (error) {
    await restRequest('stripe_events', { method: 'DELETE', query: { id: `eq.${event.id}` } }).catch(() => {})
    throw error
  }
  console.log(`[billing] plan ${planId} activado para tenant ${tenantId} hasta ${activated.periodEnd} (sesión ${session.id})`)

  // The plan is already active: a failed email does not undo it
  const email = session.customer_details?.email || session.customer_email
  if (email) {
    await sendPlanPaidEmailOnce({ tenantId, sessionId: session.id, email, ...activated }).catch((error: unknown) => {
      console.error('[billing] no se pudo enviar el correo del pago', { tenantId, error: error instanceof Error ? error.message : error })
    })
  }
}
