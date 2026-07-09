import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'

export default function ProtectedRoute({ children }: { children: JSX.Element }) {
  const { user, isLoading } = useAuth()
  const location = useLocation()

  if (isLoading) {
    return (
      <main className="mesh-background flex min-h-screen items-center justify-center px-6 text-slate-50">
        <div className="rounded-[1.6rem] border border-white/10 bg-slate-950/60 px-6 py-5 text-sm text-slate-200 backdrop-blur-md">
          Cargando sesion...
        </div>
      </main>
    )
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }

  return children
}
