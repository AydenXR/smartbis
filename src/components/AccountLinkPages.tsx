import { type FormEvent, type ReactNode, useEffect, useRef, useState } from 'react'
import { CheckCircle2, Eye, EyeOff, KeyRound, Loader2, Lock, Mail, XCircle } from 'lucide-react'
import LogoSb from '../assets/logosb.png'
import { ApiError, confirmEmail, resendVerificationEmail, resetPassword } from '@/lib/api'
import { emailProblem, normalizeEmail, PASSWORD_RULES, passwordProblem } from '@/lib/validation'

// Pages opened from the account emails: /verificar-correo and /restablecer-contrasena

const inputClass =
  'w-full rounded-[16px] border border-[#1a3a5a] bg-[#0b2641] px-4 py-3.5 text-[13px] text-slate-100 placeholder:text-slate-500 outline-none transition focus:border-[#1090D0]/50 focus:bg-[#0c2c4c]'
const primaryButtonClass =
  'flex w-full items-center justify-center gap-2 rounded-[16px] bg-[#1090D0] px-5 py-3.5 text-[13px] font-extrabold text-white shadow-lg shadow-[#1090D0]/20 transition hover:bg-[#0f80b8] disabled:cursor-not-allowed disabled:bg-[#1090D0]/50 disabled:shadow-none'

// The token travels after "#" (never sent to the server or written in its
// logs); once read, it is removed from the address bar and the history
function takeLinkToken() {
  const token = new URLSearchParams(window.location.hash.slice(1)).get('token') || ''
  if (window.location.hash) window.history.replaceState(null, '', window.location.pathname)
  return token
}

function goToLogin(options: { forgot?: boolean } = {}) {
  window.location.assign(options.forgot ? '/?login=1&recuperar=1' : '/?login=1')
}

function PageShell({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-screen w-full items-center justify-center bg-[#0c2a47] px-4 py-10 text-slate-100">
      <div className="w-full max-w-md overflow-hidden rounded-[26px] border border-[#1a3a5a] bg-[#0f3151] shadow-2xl shadow-[#050a18]/40">
        <a href="/" className="flex items-center gap-3 border-b border-[#1a3a5a] bg-[#0b2540] px-7 py-5">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] border border-[#1a3a5a] bg-[#0f3151] p-1.5">
            <img src={LogoSb} alt="Smartbis" className="h-full w-full object-contain" />
          </div>
          <div className="font-display text-[17px] font-extrabold tracking-[0.2em] text-[#1090D0]">SMARTBIS</div>
        </a>
        <div className="space-y-4 p-7 sm:p-8">{children}</div>
      </div>
    </main>
  )
}

function StatusIcon({ kind }: { kind: 'loading' | 'ok' | 'error' | 'key' }) {
  const styles = {
    loading: 'bg-[#1090D0]/15 text-[#4FC3F7]',
    ok: 'bg-emerald-400/15 text-emerald-300',
    error: 'bg-rose-400/15 text-rose-300',
    key: 'bg-[#1090D0]/15 text-[#4FC3F7]',
  }[kind]
  const Icon = { loading: Loader2, ok: CheckCircle2, error: XCircle, key: KeyRound }[kind]
  return (
    <div className={`flex h-12 w-12 items-center justify-center rounded-[16px] ${styles}`}>
      <Icon className={`h-6 w-6 ${kind === 'loading' ? 'animate-spin' : ''}`} />
    </div>
  )
}

function Message({ kind, children }: { kind: 'ok' | 'error'; children: ReactNode }) {
  const styles = kind === 'ok'
    ? 'border-emerald-400/25 bg-emerald-400/10 text-emerald-100'
    : 'border-rose-400/25 bg-rose-400/10 text-rose-100'
  return <div className={`rounded-[16px] border px-4 py-3 text-[13px] ${styles}`}>{children}</div>
}

export function VerifyEmailPage() {
  const started = useRef(false)
  const [state, setState] = useState<{ kind: 'loading' } | { kind: 'ok'; email: string } | { kind: 'error'; message: string }>({ kind: 'loading' })
  const [email, setEmail] = useState('')
  const [resendNotice, setResendNotice] = useState('')
  const [resendError, setResendError] = useState('')
  const [isResending, setIsResending] = useState(false)

  useEffect(() => {
    if (started.current) return
    started.current = true
    const token = takeLinkToken()
    if (!token) {
      setState({ kind: 'error', message: 'Este enlace está incompleto. Ábrelo de nuevo desde el correo que te enviamos.' })
      return
    }
    confirmEmail(token)
      .then((result) => setState({ kind: 'ok', email: result.email }))
      .catch((error) => setState({ kind: 'error', message: error instanceof Error ? error.message : 'No pudimos confirmar tu correo.' }))
  }, [])

  async function handleResend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setResendNotice('')
    const problem = emailProblem(email)
    if (problem) {
      setResendError(problem)
      return
    }
    setResendError('')
    setIsResending(true)
    try {
      const result = await resendVerificationEmail(normalizeEmail(email))
      setResendNotice(result.message)
    } catch (error) {
      setResendError(error instanceof Error ? error.message : 'No se pudo enviar el correo')
    } finally {
      setIsResending(false)
    }
  }

  if (state.kind === 'loading') {
    return (
      <PageShell>
        <StatusIcon kind="loading" />
        <h1 className="font-display text-[24px] font-extrabold text-white">Confirmando tu correo...</h1>
      </PageShell>
    )
  }

  if (state.kind === 'ok') {
    return (
      <PageShell>
        <StatusIcon kind="ok" />
        <h1 className="font-display text-[24px] font-extrabold leading-tight text-white">¡Te has registrado correctamente!</h1>
        <p className="text-[13px] leading-relaxed text-slate-300">
          Tu correo <strong className="text-white">{state.email}</strong> quedó confirmado y tu cuenta de Smartbis ya está activa. Ya puedes iniciar sesión.
        </p>
        <button type="button" className={primaryButtonClass} onClick={() => goToLogin()}>
          Iniciar sesión
        </button>
      </PageShell>
    )
  }

  return (
    <PageShell>
      <StatusIcon kind="error" />
      <h1 className="font-display text-[24px] font-extrabold leading-tight text-white">No pudimos confirmar tu correo</h1>
      <Message kind="error">{state.message}</Message>
      <form className="space-y-3" onSubmit={handleResend} noValidate>
        <p className="text-[13px] text-slate-300">Escribe tu correo y te enviaremos un enlace nuevo:</p>
        <label className="block">
          <span className="sr-only">Correo electrónico</span>
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className={inputClass}
            placeholder="tu@tuempresa.com"
            autoComplete="email"
            maxLength={254}
          />
        </label>
        {resendError ? <Message kind="error">{resendError}</Message> : null}
        {resendNotice ? <Message kind="ok">{resendNotice}</Message> : null}
        <button type="submit" disabled={isResending} className={primaryButtonClass}>
          {isResending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
          {isResending ? 'Enviando...' : 'Enviar enlace nuevo'}
        </button>
      </form>
      <p className="text-center text-[12px] text-slate-400">
        ¿Ya confirmaste tu correo?{' '}
        <button type="button" className="font-bold text-[#4FC3F7] hover:text-white" onClick={() => goToLogin()}>
          Inicia sesión
        </button>
      </p>
    </PageShell>
  )
}

export function ResetPasswordPage() {
  // Read once on load: the token leaves the address bar right away
  const [token] = useState(() => takeLinkToken())
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [linkInvalid, setLinkInvalid] = useState(!token)
  const [isSaving, setIsSaving] = useState(false)
  const [done, setDone] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const problem = passwordProblem(password)
    if (problem) {
      setError(problem)
      return
    }
    if (password !== confirmPassword) {
      setError('Las contraseñas no coinciden')
      return
    }
    setError('')
    setIsSaving(true)
    try {
      await resetPassword(token, password.trim())
      setDone(true)
      setPassword('')
      setConfirmPassword('')
    } catch (saveError) {
      if (saveError instanceof ApiError && saveError.code === 'invalid_link') setLinkInvalid(true)
      setError(saveError instanceof Error ? saveError.message : 'No se pudo cambiar la contraseña')
    } finally {
      setIsSaving(false)
    }
  }

  if (done) {
    return (
      <PageShell>
        <StatusIcon kind="ok" />
        <h1 className="font-display text-[24px] font-extrabold leading-tight text-white">Tu contraseña se cambió correctamente</h1>
        <p className="text-[13px] leading-relaxed text-slate-300">
          Ya puedes iniciar sesión con tu contraseña nueva. Por seguridad, cerramos las sesiones que tenías abiertas en otros dispositivos.
        </p>
        <button type="button" className={primaryButtonClass} onClick={() => goToLogin()}>
          Iniciar sesión
        </button>
      </PageShell>
    )
  }

  if (linkInvalid) {
    return (
      <PageShell>
        <StatusIcon kind="error" />
        <h1 className="font-display text-[24px] font-extrabold leading-tight text-white">Este enlace ya no funciona</h1>
        <Message kind="error">
          {error || 'El enlace está incompleto o ya se usó. Pide uno nuevo; por seguridad, cada enlace funciona una sola vez y vence en 1 hora.'}
        </Message>
        <button type="button" className={primaryButtonClass} onClick={() => goToLogin({ forgot: true })}>
          Pedir un enlace nuevo
        </button>
      </PageShell>
    )
  }

  return (
    <PageShell>
      <StatusIcon kind="key" />
      <h1 className="font-display text-[24px] font-extrabold leading-tight text-white">Elige tu contraseña nueva</h1>
      <form className="space-y-4" onSubmit={handleSubmit} noValidate>
        <label className="block space-y-2">
          <span className="inline-flex items-center gap-1.5 text-[12px] font-bold text-slate-200">
            <Lock className="h-3.5 w-3.5 text-[#4FC3F7]" />
            Contraseña nueva
          </span>
          <div className="relative">
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className={`${inputClass} pr-12`}
              placeholder="Mínimo 8 caracteres"
              autoComplete="new-password"
              autoFocus
            />
            <button
              type="button"
              aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
              onClick={() => setShowPassword((value) => !value)}
              className="absolute inset-y-0 right-0 flex w-12 items-center justify-center text-slate-400 hover:text-white"
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          <span className="block text-[11.5px] text-slate-400">{PASSWORD_RULES}</span>
        </label>
        <label className="block space-y-2">
          <span className="inline-flex items-center gap-1.5 text-[12px] font-bold text-slate-200">
            <Lock className="h-3.5 w-3.5 text-[#4FC3F7]" />
            Confirmar contraseña
          </span>
          <input
            type={showPassword ? 'text' : 'password'}
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            className={inputClass}
            placeholder="Repite la misma contraseña"
            autoComplete="new-password"
          />
        </label>
        {error ? <Message kind="error">{error}</Message> : null}
        <button type="submit" disabled={isSaving} className={primaryButtonClass}>
          {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {isSaving ? 'Guardando...' : 'Cambiar contraseña'}
        </button>
      </form>
    </PageShell>
  )
}
