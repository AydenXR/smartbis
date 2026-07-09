import { useEffect, useState } from 'react'
import { ArrowLeft, LockKeyhole, Mail } from 'lucide-react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import logo from '@/assets/logosb.png'
import { useAuth } from '@/hooks/useAuth'
import { getAuthErrorMessage } from '@/lib/auth-errors'

export default function Login() {
  const navigate = useNavigate()
  const location = useLocation()
  const { signIn, user } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    if (user) {
      navigate('/workspace', { replace: true })
    }
  }, [navigate, user])

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (isSubmitting) {
      return
    }

    setError('')
    setIsSubmitting(true)

    try {
      await signIn(email.trim(), password)
      const nextPath =
        typeof location.state === 'object' &&
        location.state &&
        'from' in location.state &&
        typeof location.state.from === 'string'
          ? location.state.from
          : '/workspace'

      navigate(nextPath, { replace: true })
    } catch (authError) {
      setError(getAuthErrorMessage(authError))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <main className="min-h-screen mesh-background px-4 py-4 text-slate-50 md:px-6 md:py-6">
      <section className="mx-auto flex min-h-[calc(100vh-2rem)] max-w-3xl items-center justify-center">
        <div className="w-full max-w-[42rem]">
          <Link
            to="/"
            className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-sm font-semibold text-slate-200 transition hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60"
          >
            <ArrowLeft className="h-4 w-4" />
            Volver a la landing
          </Link>

          <div className="mt-6 rounded-[1.8rem] border border-white/10 bg-slate-950/65 p-6 shadow-[0_22px_70px_rgba(2,6,23,0.35)] backdrop-blur-md md:p-8">
            <img src={logo} alt="Smartbis" className="h-12 w-auto object-contain" />

            <h1 className="mt-6 font-display text-4xl font-semibold tracking-[-0.05em] text-white md:text-5xl">
              Iniciar sesión
            </h1>

            <form className="mt-8 space-y-5" onSubmit={handleSubmit}>
              <label className="block">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.26em] text-slate-400">
                  Correo electronico
                </span>
                <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-slate-900/70 px-4 py-4">
                  <Mail className="h-4 w-4 text-slate-400" />
                  <input
                    type="email"
                    placeholder="tu@empresa.com"
                    className="w-full border-none bg-transparent text-sm text-white outline-none placeholder:text-slate-500"
                    autoComplete="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    required
                  />
                </div>
              </label>

              <label className="block">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.26em] text-slate-400">
                  Contraseña
                </span>
                <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-slate-900/70 px-4 py-4">
                  <LockKeyhole className="h-4 w-4 text-slate-400" />
                  <input
                    type="password"
                    placeholder="••••••••"
                    className="w-full border-none bg-transparent text-sm text-white outline-none placeholder:text-slate-500"
                    autoComplete="current-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    required
                  />
                </div>
              </label>

              {error ? (
                <p className="rounded-2xl border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-200">
                  {error}
                </p>
              ) : null}

              <div className="flex items-center justify-end pt-1 text-xs text-slate-400">
                <a href="#" className="transition hover:text-cyan-300">
                  Recuperar acceso
                </a>
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="mt-3 inline-flex w-full items-center justify-center rounded-full bg-[linear-gradient(90deg,#22d3ee_0%,#0ea5e9_100%)] px-6 py-3.5 text-sm font-semibold text-slate-950 shadow-[0_16px_45px_rgba(14,165,233,0.22)] transition hover:shadow-[0_20px_55px_rgba(14,165,233,0.3)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70"
              >
                {isSubmitting ? 'Entrando...' : 'Continuar'}
              </button>
            </form>
          </div>
        </div>
      </section>
    </main>
  )
}
