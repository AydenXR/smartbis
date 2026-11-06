import { useCallback, useEffect, useState } from 'react'
import { User, Mail, Building2, Shield, Calendar, Key, Pencil, X, Check, Lock, Package, Sparkles, Infinity as InfinityIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { getBillingStatus, requestPasswordReset, startPlanCheckout, type BillingStatus } from '@/lib/api'
import { PRICING_PLANS } from '@/lib/plans'
import PlanCard from '@/components/PlanCard'

type CrmMyProfileViewProps = {
  userEmail: string
  userName?: string
  displayName?: string
  userRole?: 'owner' | 'admin' | 'admin_pv' | 'admin_cs' | 'cashier' | 'cs_agent'
  branchName?: string
  memberSince?: string
}

const ROLE_LABELS: Record<string, string> = {
  owner: 'Propietario',
  admin: 'Administrador',
  admin_pv: 'Admin PV',
  admin_cs: 'Admin CS',
  cashier: 'Caja',
  cs_agent: 'Agente CS',
}

// A missing or broken date shows a dash instead of breaking the profile
function formatDate(iso: string) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'long', year: 'numeric' }).format(date)
}

// Stripe sends the customer back with "?pago=exitoso" or "?pago=cancelado"
function readPaymentReturn() {
  if (typeof window === 'undefined') return null
  const value = new URLSearchParams(window.location.search).get('pago')
  return value === 'exitoso' || value === 'cancelado' ? value : null
}

export default function CrmMyProfileView(props: CrmMyProfileViewProps) {
  const {
    userEmail,
    userName: initialName,
    displayName,
    userRole = 'admin',
    branchName = 'Sucursal Principal',
    memberSince = '01/01/2025',
  } = props
  const defaultName = displayName || userEmail?.split('@')[0] || 'Usuario'
  const nameSource = typeof initialName === 'string' && initialName.length ? initialName : defaultName

  const [editingName, setEditingName] = useState(false)
  const [name, setName] = useState(nameSource)
  const [tempName, setTempName] = useState(nameSource)
  const [showPasswordModal, setShowPasswordModal] = useState(false)
  const [sendingReset, setSendingReset] = useState(false)
  const [resetNotice, setResetNotice] = useState('')
  const [resetError, setResetError] = useState('')
  // The account owner signs in with Supabase and can get the reset email; point
  // of sale users have their password changed by the owner in "Cuentas"
  const canResetByEmail = userRole === 'owner'

  const [billing, setBilling] = useState<BillingStatus | null>(null)
  const [billingError, setBillingError] = useState('')
  const [showPlansModal, setShowPlansModal] = useState(false)
  const [checkoutPlanId, setCheckoutPlanId] = useState('')
  const [checkoutError, setCheckoutError] = useState('')
  const [paymentReturn, setPaymentReturn] = useState(readPaymentReturn)

  const loadBilling = useCallback(async () => {
    try {
      const status = await getBillingStatus()
      setBilling(status)
      setBillingError('')
      return status
    } catch (error) {
      setBillingError(error instanceof Error ? error.message : 'No se pudo cargar tu paquete')
      return null
    }
  }, [])

  useEffect(() => {
    if (paymentReturn) window.history.replaceState(null, '', window.location.pathname)
    let cancelled = false
    let timer: number | undefined
    // Stripe confirms the payment to the server a few seconds after the return:
    // the status is asked again until the paid plan shows up
    let attempts = paymentReturn === 'exitoso' ? 10 : 0
    const poll = async () => {
      const status = await loadBilling()
      if (cancelled) return
      const paid = status?.kind === 'paid' && status.active
      if (!paid && attempts-- > 0) timer = window.setTimeout(() => void poll(), 3000)
    }
    void poll()
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
    // Only once, when the profile opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Only the owner pays; a business without limits has nothing to buy, and a paid
  // plan still current has no other plan to move to yet
  const canBuyPlan =
    userRole === 'owner' && Boolean(billing) && billing?.kind !== 'unlimited' && !(billing?.kind === 'paid' && billing.active)
  const buyLabel = billing?.kind === 'paid' ? 'Renovar paquete' : 'Mejorar paquete'
  const currentPlanTitle =
    billing?.kind === 'trial' ? 'Paquete gratis · 15 días' : billing?.kind === 'paid' ? billing.planName : 'Plan ilimitado'

  async function buyPlan(planId: string) {
    setCheckoutPlanId(planId)
    setCheckoutError('')
    try {
      const { url } = await startPlanCheckout(planId)
      // Stripe's payment page; it sends the customer back to the profile
      window.location.assign(url)
    } catch (error) {
      setCheckoutError(error instanceof Error ? error.message : 'No se pudo abrir el pago')
      setCheckoutPlanId('')
    }
  }

  const initials = (name || userEmail || 'U')
    .split(' ')
    .map((s) => s[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase()

  function startEditName() {
    setTempName(name)
    setEditingName(true)
  }

  function cancelEditName() {
    setTempName(name)
    setEditingName(false)
  }

  function saveName() {
    if (tempName.trim()) {
      setName(tempName.trim())
    }
    setEditingName(false)
  }

  function closePasswordModal() {
    setShowPasswordModal(false)
    setResetNotice('')
    setResetError('')
  }

  async function sendResetEmail() {
    setSendingReset(true)
    setResetError('')
    try {
      const result = await requestPasswordReset(userEmail)
      setResetNotice(result.message)
    } catch (error) {
      setResetError(error instanceof Error ? error.message : 'No se pudo enviar el correo')
    } finally {
      setSendingReset(false)
    }
  }

  return (
    <section className="flex min-h-0 w-full flex-col overflow-auto bg-[#0c2a47] px-6 py-6 text-white">
      <header className="mb-6 flex items-center justify-between">
        <h2 className="text-[22px] font-bold tracking-tight text-slate-50">Mi perfil</h2>
      </header>

      <div className="mx-auto w-full max-w-3xl">
        <div className="rounded-[20px] border border-[#1a3a5a] bg-[#0f3151] p-6 shadow-lg shadow-black/20">
          <div className="flex flex-col items-start gap-6 sm:flex-row sm:items-center">
            <div className="relative flex h-24 w-24 shrink-0 items-center justify-center rounded-full border-2 border-[#1090D0]/40 bg-gradient-to-br from-[#1090D0]/20 to-[#0c2a47] text-[28px] font-bold text-[#5bbfe5]">
              {initials}
            </div>

            <div className="min-w-0 flex-1 space-y-3">
              <div className="flex flex-wrap items-center gap-3">
                {editingName ? (
                  <div className="flex items-center gap-2 rounded-[14px] border border-[#1090D0]/40 bg-[#0b2641] px-3 py-1.5">
                    <User className="h-4 w-4 text-slate-300" />
                    <input
                      type="text"
                      value={tempName}
                      onChange={(e) => setTempName(e.target.value)}
                      className="w-48 bg-transparent text-[15px] font-semibold text-slate-50 placeholder:text-slate-500 focus:outline-none"
                      autoFocus
                    />
                    <button
                      type="button"
                      onClick={saveName}
                      className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500/80 text-white transition hover:bg-emerald-500"
                    >
                      <Check className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={cancelEditName}
                      className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-500/60 text-white transition hover:bg-slate-500"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <h3 className="text-[20px] font-bold text-slate-50">{name}</h3>
                    <button
                      type="button"
                      onClick={startEditName}
                      className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#1a3a5a] bg-[#0b2641] text-slate-300 transition hover:border-[#1090D0]/40 hover:text-[#5bbfe5]"
                      title="Editar nombre"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2 rounded-[14px] border border-[#1a3a5a] bg-[#0b2641]/60 px-3 py-2">
                <Mail className="h-4 w-4 text-slate-400" />
                <span className="text-[13px] text-slate-200">{userEmail}</span>
              </div>

              <div className="flex flex-wrap gap-2.5">
                <div className="flex items-center gap-2 rounded-[14px] border border-[#1090D0]/30 bg-[#1090D0]/10 px-3 py-2">
                  <Shield className="h-4 w-4 text-[#5bbfe5]" />
                  <span className="text-[12.5px] font-semibold uppercase tracking-wider text-[#5bbfe5]">
                    {ROLE_LABELS[userRole] || 'Administrador'}
                  </span>
                </div>
                <div className="flex items-center gap-2 rounded-[14px] border border-[#1a3a5a] bg-[#11375a] px-3 py-2">
                  <Building2 className="h-4 w-4 text-slate-300" />
                  <span className="text-[12.5px] text-slate-200">{branchName}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-[18px] border border-[#1a3a5a] bg-[#0b2641]/50 p-4">
              <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                <Calendar className="h-3.5 w-3.5" />
                Miembro desde
              </div>
              <p className="text-[14px] font-semibold text-slate-100">{memberSince}</p>
            </div>

            <button
              type="button"
              onClick={() => setShowPasswordModal(true)}
              className="flex items-center gap-3 rounded-[18px] border border-[#1a3a5a] bg-[#0b2641]/50 p-4 text-left transition hover:border-[#1090D0]/40 hover:bg-[#10304e]"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px] bg-[#1090D0]/15 text-[#5bbfe5]">
                <Key className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[13.5px] font-semibold text-slate-100">Restablecer contraseña</p>
                <p className="text-[11.5px] text-slate-400">Recibe un enlace en tu correo para cambiarla</p>
              </div>
            </button>
          </div>

          {paymentReturn === 'exitoso' ? (
            <div className="mt-6 rounded-[14px] border border-emerald-400/25 bg-emerald-400/10 px-4 py-3 text-[13px] text-emerald-100">
              {billing?.kind === 'paid' && billing.active
                ? '¡Pago recibido! Tu paquete ya está activo.'
                : 'Recibimos tu pago. Estamos activando tu paquete; puede tardar unos segundos.'}
            </div>
          ) : paymentReturn === 'cancelado' ? (
            <div className="mt-6 flex items-start justify-between gap-3 rounded-[14px] border border-amber-400/25 bg-amber-400/10 px-4 py-3 text-[13px] text-amber-100">
              <span>El pago no se completó y no se hizo ningún cargo. Puedes intentarlo de nuevo cuando quieras.</span>
              <button type="button" onClick={() => setPaymentReturn(null)} className="shrink-0 text-amber-200 hover:text-white">
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : null}

          <div className="mt-6 rounded-[18px] border border-[#1a3a5a] bg-[#0b2641]/50 p-5">
            <div className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
              <Package className="h-3.5 w-3.5" />
              Mi paquete
            </div>

            {!billing ? (
              <p className="text-[13px] text-slate-400">{billingError || 'Cargando tu paquete...'}</p>
            ) : billing.kind === 'unlimited' ? (
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px] bg-[#1090D0]/15 text-[#5bbfe5]">
                  <InfinityIcon className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-[15px] font-bold text-slate-50">Ilimitado</p>
                  <p className="text-[12px] text-slate-400">Tu cuenta tiene acceso al bot sin límite de conversaciones ni vencimiento.</p>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                <div className="flex flex-wrap items-center gap-3">
                  <p className="text-[16px] font-bold text-slate-50">{currentPlanTitle}</p>
                  <span
                    className={cn(
                      'rounded-full border px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider',
                      billing.active
                        ? 'border-emerald-400/40 bg-emerald-400/10 text-emerald-300'
                        : 'border-rose-400/40 bg-rose-400/10 text-rose-300',
                    )}
                  >
                    {billing.active ? 'Activo' : 'Vencido'}
                  </span>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <p className="text-[11.5px] text-slate-400">{billing.active ? 'Vence el' : 'Venció el'}</p>
                    <p className="text-[14px] font-semibold text-slate-100">{formatDate(billing.periodEnd)}</p>
                  </div>
                  {billing.active ? (
                    <div>
                      <p className="text-[11.5px] text-slate-400">Conversaciones del bot</p>
                      <p className="text-[14px] font-semibold text-slate-100">
                        {billing.conversationsUsed} de {billing.conversationsLimit}
                      </p>
                      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-[#123150]">
                        <div
                          className={cn(
                            'h-full rounded-full',
                            billing.conversationsUsed >= billing.conversationsLimit ? 'bg-rose-400' : 'bg-[#1090D0]',
                          )}
                          style={{
                            width: `${Math.min(100, billing.conversationsLimit ? (billing.conversationsUsed / billing.conversationsLimit) * 100 : 0)}%`,
                          }}
                        />
                      </div>
                    </div>
                  ) : null}
                </div>

                {!billing.active ? (
                  <p className="text-[12.5px] text-rose-200">
                    Tu bot ya no responde a tus clientes. {canBuyPlan ? 'Contrata un paquete para reactivarlo.' : 'Pide al propietario de la cuenta que contrate un paquete.'}
                  </p>
                ) : null}

                {canBuyPlan ? (
                  <button
                    type="button"
                    onClick={() => {
                      setCheckoutError('')
                      setShowPlansModal(true)
                    }}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-[14px] bg-[#1090D0] px-5 py-3 text-[13.5px] font-bold text-white shadow-lg shadow-[#1090D0]/20 transition hover:bg-[#0c79ae] sm:w-auto sm:self-start"
                  >
                    <Sparkles className="h-4 w-4" />
                    {buyLabel}
                  </button>
                ) : null}
              </div>
            )}
          </div>
        </div>
      </div>

      {showPlansModal && billing && billing.kind !== 'unlimited' ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="flex max-h-[92vh] w-full max-w-xl flex-col overflow-hidden rounded-[22px] border border-[#1a3a5a] bg-[#0f3151] shadow-2xl shadow-black/50">
            <div className="flex items-start justify-between gap-3 border-b border-[#1a3a5a] px-5 py-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Tu paquete actual</p>
                <h3 className="mt-1 text-[17px] font-bold text-slate-50">{currentPlanTitle}</h3>
                <p className="mt-1 text-[12px] text-slate-400">
                  {billing.active ? 'Vence el' : 'Venció el'} {formatDate(billing.periodEnd)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowPlansModal(false)}
                disabled={Boolean(checkoutPlanId)}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-slate-400 transition hover:bg-[#0b2641] hover:text-slate-100"
              >
                <X className="h-4.5 w-4.5" />
              </button>
            </div>

            <div className="overflow-y-auto px-5 py-6">
              <p className="mb-5 text-center text-[13px] leading-relaxed text-slate-300">
                {billing.kind === 'trial' && billing.active
                  ? 'Elige tu paquete. Se activa el día de tu pago y tus días de prueba restantes se suman al mes pagado.'
                  : 'Elige tu paquete. Se activa el día de tu pago y dura un mes.'}
              </p>
              <div className="flex flex-wrap justify-center gap-5">
                {PRICING_PLANS.map((plan) => (
                  <PlanCard
                    key={plan.planId}
                    plan={plan}
                    showTrial={false}
                    buttonLabel={checkoutPlanId === plan.planId ? 'Abriendo pago seguro...' : 'Pagar con tarjeta'}
                    busy={checkoutPlanId === plan.planId}
                    onSelect={() => void buyPlan(plan.planId)}
                  />
                ))}
              </div>
              {checkoutError ? (
                <div className="mt-5 rounded-[14px] border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[12px] text-rose-200">
                  {checkoutError}
                </div>
              ) : null}
              <p className="mt-5 flex items-center justify-center gap-1.5 text-center text-[11.5px] text-slate-400">
                <Lock className="h-3.5 w-3.5" />
                Pago seguro procesado por Stripe. Smartbis no guarda los datos de tu tarjeta.
              </p>
            </div>
          </div>
        </div>
      ) : null}

      {showPasswordModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md overflow-hidden rounded-[20px] border border-[#1a3a5a] bg-[#0f3151] shadow-2xl shadow-black/50">
            <div className="flex items-center justify-between border-b border-[#1a3a5a] px-5 py-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-[14px] bg-[#1090D0]/15 text-[#5bbfe5]">
                  <Lock className="h-5 w-5" />
                </div>
                <h3 className="text-[16px] font-bold text-slate-50">Restablecer contraseña</h3>
              </div>
              <button
                type="button"
                onClick={closePasswordModal}
                className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-400 transition hover:bg-[#0b2641] hover:text-slate-100"
              >
                <X className="h-4.5 w-4.5" />
              </button>
            </div>

            <div className="space-y-4 p-5">
              {canResetByEmail ? (
                <p className="text-[13px] leading-relaxed text-slate-300">
                  Te enviaremos un enlace a <strong className="text-slate-100">{userEmail}</strong> para que elijas una
                  contraseña nueva. Por seguridad, el enlace funciona una sola vez y vence en 1 hora.
                </p>
              ) : (
                <p className="text-[13px] leading-relaxed text-slate-300">
                  Tu usuario lo administra el propietario de la cuenta. Pídele que cambie tu contraseña desde
                  <strong className="text-slate-100"> Cuentas</strong>.
                </p>
              )}
              {resetNotice ? (
                <div className="rounded-[14px] border border-emerald-400/25 bg-emerald-400/10 px-3 py-2 text-[12px] text-emerald-100">
                  {resetNotice}
                </div>
              ) : null}
              {resetError ? (
                <div className="rounded-[14px] border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[12px] text-rose-200">
                  {resetError}
                </div>
              ) : null}
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[#1a3a5a] px-5 py-4">
              <button
                type="button"
                onClick={closePasswordModal}
                className="rounded-[14px] border border-[#1a3a5a] bg-[#11375a] px-4 py-2 text-[12.5px] font-semibold text-slate-200 transition hover:border-[#1090D0]/40 hover:text-white"
              >
                {resetNotice || !canResetByEmail ? 'Cerrar' : 'Cancelar'}
              </button>
              {canResetByEmail && !resetNotice ? (
                <button
                  type="button"
                  disabled={sendingReset}
                  onClick={() => void sendResetEmail()}
                  className={cn(
                    'rounded-[14px] px-4 py-2 text-[12.5px] font-bold text-white transition',
                    sendingReset ? 'bg-[#1090D0]/50 opacity-60' : 'bg-[#1090D0] hover:bg-[#0c79ae]',
                  )}
                >
                  {sendingReset ? 'Enviando...' : 'Enviar enlace'}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  )
}
