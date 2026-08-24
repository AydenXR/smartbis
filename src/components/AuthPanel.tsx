import { type FormEvent, useMemo, useState } from 'react'
import { cn } from '@/lib/utils'
import LogoSb from '../assets/logosb.png'
import { Lock, Mail, UserPlus, LogIn } from 'lucide-react'

type AuthMode = 'login' | 'register'

type AuthPanelProps = {
  mode: AuthMode
  isSubmitting: boolean
  error: string
  onClose?: () => void
  onModeChange: (mode: AuthMode) => void
  onLogin: (input: { email: string; password: string }) => Promise<void>
  onRegister: (input: { email: string; password: string }) => Promise<void>
}

const tabItems: Array<{ id: AuthMode; label: string; icon: typeof LogIn }> = [
  { id: 'login', label: 'Iniciar sesión', icon: LogIn },
  { id: 'register', label: 'Registrarse', icon: UserPlus },
]

export default function AuthPanel({
  mode,
  isSubmitting,
  error,
  onClose,
  onModeChange,
  onLogin,
  onRegister,
}: AuthPanelProps) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [localError, setLocalError] = useState('')

  const activeError = useMemo(() => error || localError, [error, localError])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setLocalError('')

    if (!email.trim() || !password.trim()) {
      setLocalError('Completa correo y contraseña')
      return
    }

    if (mode === 'register' && password !== confirmPassword) {
      setLocalError('Las contraseñas no coinciden')
      return
    }

    if (mode === 'register') {
      await onRegister({ email, password })
      return
    }

    await onLogin({ email, password })
  }

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
                onClick={() => {
                  setLocalError('')
                  onModeChange(tab.id)
                }}
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

          <form className="space-y-4" onSubmit={handleSubmit}>
            <label className="block space-y-2">
              <span className="inline-flex items-center gap-1.5 text-[12px] font-bold text-slate-200">
                <Mail className="h-3.5 w-3.5 text-[#4FC3F7]" />
                Correo electrónico
              </span>
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="tech-scrollbar w-full rounded-[16px] border border-[#1a3a5a] bg-[#0b2641] px-4 py-3.5 text-[13px] leading-relaxed text-slate-100 placeholder:text-slate-500 outline-none transition focus:border-[#1090D0]/50 focus:bg-[#0c2c4c]"
                placeholder="tu@tuempresa.com"
                autoComplete="email"
              />
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
                className="tech-scrollbar w-full rounded-[16px] border border-[#1a3a5a] bg-[#0b2641] px-4 py-3.5 text-[13px] leading-relaxed text-slate-100 placeholder:text-slate-500 outline-none transition focus:border-[#1090D0]/50 focus:bg-[#0c2c4c]"
                placeholder="Mínimo 8 caracteres"
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              />
            </label>

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
                  className="tech-scrollbar w-full rounded-[16px] border border-[#1a3a5a] bg-[#0b2641] px-4 py-3.5 text-[13px] leading-relaxed text-slate-100 placeholder:text-slate-500 outline-none transition focus:border-[#1090D0]/50 focus:bg-[#0c2c4c]"
                  placeholder="Repite la misma contraseña"
                  autoComplete="new-password"
                />
              </label>
            ) : null}

            {activeError ? (
              <div className="rounded-[16px] border border-rose-400/25 bg-rose-400/10 px-4 py-3 text-[13px] text-rose-100">
                {activeError}
              </div>
            ) : null}

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full rounded-[16px] bg-[#1090D0] px-5 py-3.5 text-[13px] font-extrabold text-white shadow-lg shadow-[#1090D0]/20 transition hover:bg-[#0f80b8] disabled:cursor-not-allowed disabled:bg-[#1090D0]/50 disabled:shadow-none"
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
                    onClick={() => {
                      setLocalError('')
                      onModeChange('register')
                    }}
                    className="font-bold text-[#4FC3F7] transition hover:text-white"
                  >
                    Crea una gratis
                  </button>
                </>
              ) : (
                <>¿Ya tienes cuenta?{' '}
                  <button
                    type="button"
                    onClick={() => {
                      setLocalError('')
                      onModeChange('login')
                    }}
                    className="font-bold text-[#4FC3F7] transition hover:text-white"
                  >
                    Inicia sesión
                  </button>
                </>
              )}
            </p>
          </form>
        </div>
      </div>
    </section>
  )
}
