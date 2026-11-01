import { type FormEvent, useMemo, useState } from 'react'
import { cn } from '@/lib/utils'
import { requestPasswordReset, resendVerificationEmail } from '@/lib/api'
import { emailProblem, normalizeEmail, PASSWORD_RULES, passwordProblem } from '@/lib/validation'
import LogoSb from '../assets/logosb.png'
import { Lock, Mail, UserPlus, LogIn, MailCheck, KeyRound } from 'lucide-react'

type AuthMode = 'login' | 'register'

type AuthPanelProps = {
  mode: AuthMode
  isSubmitting: boolean
  error: string
  // "email_not_confirmed" offers to send the confirmation link again
  errorCode?: string
  // Set after a registration: the panel asks to open the emailed link
  registration?: { email: string; emailSent: boolean } | null
  // Opens on "forgot password" (from an expired reset link)
  initialForgot?: boolean
  onClose?: () => void
  onModeChange: (mode: AuthMode) => void
  onLogin: (input: { email: string; password: string }) => Promise<void>
  onRegister: (input: { email: string; password: string }) => Promise<void>
}

const inputClass =
  'tech-scrollbar w-full rounded-[16px] border border-[#1a3a5a] bg-[#0b2641] px-4 py-3.5 text-[13px] leading-relaxed text-slate-100 placeholder:text-slate-500 outline-none transition focus:border-[#1090D0]/50 focus:bg-[#0c2c4c]'
const primaryButtonClass =
  'w-full rounded-[16px] bg-[#1090D0] px-5 py-3.5 text-[13px] font-extrabold text-white shadow-lg shadow-[#1090D0]/20 transition hover:bg-[#0f80b8] disabled:cursor-not-allowed disabled:bg-[#1090D0]/50 disabled:shadow-none'
const linkButtonClass = 'font-bold text-[#4FC3F7] transition hover:text-white disabled:opacity-50'

const tabItems: Array<{ id: AuthMode; label: string; icon: typeof LogIn }> = [
  { id: 'login', label: 'Iniciar sesión', icon: LogIn },
  { id: 'register', label: 'Registrarse', icon: UserPlus },
]

export default function AuthPanel({
  mode,
  isSubmitting,
  error,
  errorCode,
  registration,
  initialForgot = false,
  onClose,
  onModeChange,
  onLogin,
  onRegister,
}: AuthPanelProps) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [localError, setLocalError] = useState('')
  const [emailTouched, setEmailTouched] = useState(false)
  // "Forgot password" replaces the login form until the user goes back
  const [forgotOpen, setForgotOpen] = useState(initialForgot)
  const [notice, setNotice] = useState('')
  const [isSendingEmail, setIsSendingEmail] = useState(false)

  const activeError = useMemo(() => error || localError, [error, localError])
  const emailError = emailTouched ? emailProblem(email) : null

  function switchMode(next: AuthMode) {
    setLocalError('')
    setNotice('')
    setForgotOpen(false)
    onModeChange(next)
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setLocalError('')
    setNotice('')
    setEmailTouched(true)

    const badEmail = emailProblem(email)
    if (badEmail) {
      setLocalError(badEmail)
      return
    }

    if (!password.trim()) {
      setLocalError('Escribe tu contraseña')
      return
    }

    if (mode === 'register') {
      const badPassword = passwordProblem(password)
      if (badPassword) {
        setLocalError(badPassword)
        return
      }
      if (password !== confirmPassword) {
        setLocalError('Las contraseñas no coinciden')
        return
      }
      await onRegister({ email: normalizeEmail(email), password })
      return
    }

    await onLogin({ email: normalizeEmail(email), password })
  }

  async function sendEmail(kind: 'reset' | 'verification', address: string) {
    const badEmail = emailProblem(address)
    if (badEmail) {
      setLocalError(badEmail)
      return
    }
    setIsSendingEmail(true)
    setLocalError('')
    setNotice('')
    try {
      const result = kind === 'reset'
        ? await requestPasswordReset(normalizeEmail(address))
        : await resendVerificationEmail(normalizeEmail(address))
      setNotice(result.message)
    } catch (sendError) {
      setLocalError(sendError instanceof Error ? sendError.message : 'No se pudo enviar el correo')
    } finally {
      setIsSendingEmail(false)
    }
  }

  const noticeBox = notice ? (
    <div className="rounded-[16px] border border-emerald-400/25 bg-emerald-400/10 px-4 py-3 text-[13px] text-emerald-100">
      {notice}
    </div>
  ) : null
  const errorBox = (text: string) => (
    <div className="rounded-[16px] border border-rose-400/25 bg-rose-400/10 px-4 py-3 text-[13px] text-rose-100">{text}</div>
  )

  return (
    <section className="w-full">
      <div className="overflow-hidden rounded-[26px] border border-[#1a3a5a] bg-[#0b2540] shadow-2xl shadow-[#050a18]/40">
        <div className="flex items-center gap-3 border-b border-[#1a3a5a] bg-[#0b2540]/80 px-7 py-5">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] border border-[#1a3a5a] bg-[#0f3151] p-1.5">
            <img src={LogoSb} alt="Smartbis Logo" className="h-full w-full object-contain" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate font-display text-[17px] font-extrabold tracking-[0.2em] text-[#1090D0]">
              SMARTBIS
            </div>
            <div className="mt-0.5 truncate text-[11px] font-medium tracking-wider text-slate-400">
              CRM MESSENGER · AI
            </div>
          </div>
          {onClose ? (
            <button
              type="button"
              aria-label="Cerrar"
              onClick={() => {
                setLocalError('')
                onClose()
              }}
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] border border-[#1a3a5a] bg-[#0f3151] text-slate-300 transition hover:text-white"
            >
              ✕
            </button>
          ) : null}
        </div>

        <div className="flex items-stretch gap-2 px-5 pt-5">
          {tabItems.map((tab) => {
            const isActive = tab.id === mode
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => switchMode(tab.id)}
                className={cn(
                  'group flex flex-1 items-center justify-center gap-2 rounded-t-[18px] border border-b-0 px-4 py-3 text-[13px] font-bold transition',
                  isActive
                    ? 'border-[#1a3a5a] border-b-transparent bg-[#0f3151] text-white'
                    : 'border-transparent text-slate-400 hover:text-slate-200',
                )}
              >
                <tab.icon
                  className={cn(
                    'h-4.5 w-4.5 transition',
                    isActive ? 'text-[#4FC3F7]' : 'text-slate-500 group-hover:text-slate-300',
                  )}
                />
                {tab.label}
              </button>
            )
          })}
        </div>

        <div className="rounded-b-[26px] border-x border-b border-[#1a3a5a] border-t-0 bg-[#0f3151] p-7 sm:p-8">
          {registration ? (
            <div className="space-y-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-[16px] bg-[#1090D0]/15 text-[#4FC3F7]">
                <MailCheck className="h-6 w-6" />
              </div>
              <h2 className="font-display text-[24px] font-extrabold leading-tight text-white">Revisa tu correo</h2>
              <p className="text-[13px] leading-relaxed text-slate-300">
                {registration.emailSent ? (
                  <>Te enviamos un enlace a <strong className="text-white">{registration.email}</strong>. Ábrelo para activar tu cuenta; después podrás iniciar sesión.</>
                ) : (
                  <>Tu cuenta <strong className="text-white">{registration.email}</strong> se creó, pero no pudimos enviar el correo de confirmación. Pulsa «Reenviar correo».</>
                )}
              </p>
              <p className="text-[12px] leading-relaxed text-slate-400">Si no lo ves en unos minutos, revisa tu carpeta de spam o promociones.</p>
              {noticeBox}
              {localError ? errorBox(localError) : null}
              <button type="button" className={primaryButtonClass} onClick={() => switchMode('login')}>
                Ir a iniciar sesión
              </button>
              <p className="text-center text-[12px] text-slate-400">
                ¿No te llegó?{' '}
                <button type="button" disabled={isSendingEmail} className={linkButtonClass} onClick={() => void sendEmail('verification', registration.email)}>
                  {isSendingEmail ? 'Enviando...' : 'Reenviar correo'}
                </button>
              </p>
            </div>
          ) : mode === 'login' && forgotOpen ? (
            <form
              noValidate
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault()
                setEmailTouched(true)
                void sendEmail('reset', email)
              }}
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-[16px] bg-[#1090D0]/15 text-[#4FC3F7]">
                <KeyRound className="h-6 w-6" />
              </div>
              <h2 className="font-display text-[24px] font-extrabold leading-tight text-white">Recupera tu contraseña</h2>
              <p className="text-[13px] leading-relaxed text-slate-300">
                Escribe el correo de tu cuenta y te enviaremos un enlace para elegir una contraseña nueva.
              </p>
              <label className="block space-y-2">
                <span className="inline-flex items-center gap-1.5 text-[12px] font-bold text-slate-200">
                  <Mail className="h-3.5 w-3.5 text-[#4FC3F7]" />
                  Correo electrónico
                </span>
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  onBlur={() => setEmailTouched(true)}
                  className={inputClass}
                  placeholder="tu@tuempresa.com"
                  autoComplete="email"
                  maxLength={254}
                />
                {emailError ? <span className="block text-[12px] text-rose-200">{emailError}</span> : null}
              </label>
              {noticeBox}
              {localError ? errorBox(localError) : null}
              <button type="submit" disabled={isSendingEmail} className={primaryButtonClass}>
                {isSendingEmail ? 'Enviando...' : 'Enviarme el enlace'}
              </button>
              <p className="text-center text-[12px] text-slate-400">
                <button
                  type="button"
                  className={linkButtonClass}
                  onClick={() => {
                    setForgotOpen(false)
                    setNotice('')
                    setLocalError('')
                  }}
                >
                  Volver a iniciar sesión
                </button>
              </p>
            </form>
          ) : (
          <>
          <div className="mb-6">
            <p className="text-[11px] font-bold uppercase tracking-[0.28em] text-[#4FC3F7]">
              Acceso privado
            </p>
            <h2 className="mt-3 font-display text-[24px] font-extrabold leading-tight text-white">
              {mode === 'login' ? 'Entra a tu CRM Messenger' : 'Crea tu espacio de cliente'}
            </h2>
            <p className="mt-2 text-[13px] leading-relaxed text-slate-300">
              {mode === 'login'
                ? 'Accede a tus conversaciones, prompt y documentos del cliente.'
                : 'Crea tu cuenta gratis en menos de un minuto. Multi-tenant y privado.'}
            </p>
          </div>

          <form className="space-y-4" onSubmit={handleSubmit} noValidate>
            <label className="block space-y-2">
              <span className="inline-flex items-center gap-1.5 text-[12px] font-bold text-slate-200">
                <Mail className="h-3.5 w-3.5 text-[#4FC3F7]" />
                Correo electrónico
              </span>
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                onBlur={() => setEmailTouched(true)}
                className={inputClass}
                placeholder="tu@tuempresa.com"
                autoComplete="email"
                maxLength={254}
                aria-invalid={Boolean(emailError)}
              />
              {emailError ? <span className="block text-[12px] text-rose-200">{emailError}</span> : null}
            </label>

            <label className="block space-y-2">
              <span className="inline-flex items-center gap-1.5 text-[12px] font-bold text-slate-200">
                <Lock className="h-3.5 w-3.5 text-[#4FC3F7]" />
                Contraseña
              </span>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className={inputClass}
                placeholder={mode === 'login' ? 'Tu contraseña' : 'Mínimo 8 caracteres'}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              />
              {mode === 'register' ? <span className="block text-[11.5px] text-slate-400">{PASSWORD_RULES}</span> : null}
            </label>

            {mode === 'login' ? (
              <div className="-mt-1 text-right">
                <button
                  type="button"
                  className={cn(linkButtonClass, 'text-[12px]')}
                  onClick={() => {
                    setForgotOpen(true)
                    setLocalError('')
                    setNotice('')
                  }}
                >
                  ¿Olvidaste tu contraseña?
                </button>
              </div>
            ) : null}

            {mode === 'register' ? (
              <label className="block space-y-2">
                <span className="inline-flex items-center gap-1.5 text-[12px] font-bold text-slate-200">
                  <Lock className="h-3.5 w-3.5 text-[#4FC3F7]" />
                  Confirmar contraseña
                </span>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  className={inputClass}
                  placeholder="Repite la misma contraseña"
                  autoComplete="new-password"
                />
              </label>
            ) : null}

            {activeError ? (
              <div className="rounded-[16px] border border-rose-400/25 bg-rose-400/10 px-4 py-3 text-[13px] text-rose-100">
                {activeError}
                {mode === 'login' && errorCode === 'email_not_confirmed' && !localError ? (
                  <button
                    type="button"
                    disabled={isSendingEmail}
                    className={cn(linkButtonClass, 'mt-2 block')}
                    onClick={() => void sendEmail('verification', email)}
                  >
                    {isSendingEmail ? 'Enviando...' : 'Reenviar correo de confirmación'}
                  </button>
                ) : null}
              </div>
            ) : null}
            {noticeBox}

            <button
              type="submit"
              disabled={isSubmitting}
              className={primaryButtonClass}
            >
              {isSubmitting
                ? 'Procesando...'
                : mode === 'login'
                  ? 'Entrar a mi CRM'
                  : 'Crear cuenta gratis'}
            </button>

            <p className="pt-1 text-center text-[12px] leading-relaxed text-slate-400">
              {mode === 'login' ? (
                <>¿No tienes cuenta?{' '}
                  <button
                    type="button"
                    onClick={() => switchMode('register')}
                    className="font-bold text-[#4FC3F7] transition hover:text-white"
                  >
                    Crea una gratis
                  </button>
                </>
              ) : (
                <>¿Ya tienes cuenta?{' '}
                  <button
                    type="button"
                    onClick={() => switchMode('login')}
                    className="font-bold text-[#4FC3F7] transition hover:text-white"
                  >
                    Inicia sesión
                  </button>
                </>
              )}
            </p>
          </form>
          </>
          )}
        </div>
      </div>
    </section>
  )
}
