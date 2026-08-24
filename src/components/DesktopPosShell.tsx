import { useEffect, useMemo, useState } from 'react'
import CrmPosView from '@/components/CrmPosView'
import AuthPanel from '@/components/AuthPanel'
import type { AuthUser, WorkspacePayload } from '@/types/app'
import { saveStoredToken, clearStoredToken } from '@/lib/api'

type DesktopPosShellProps = {
  user: AuthUser
  workspace: WorkspacePayload
  onLogout: () => Promise<void>
  onSavePrompt: (prompt: string) => Promise<void>
  onCreateDocument: (input: { fileName: string; content: string }) => Promise<unknown>
  onUpdateDocument: (currentFileName: string, input: { fileName: string; content: string }) => Promise<unknown>
  onDeleteDocument: (fileName: string) => Promise<void>
  onSendChatMessage: (message: string, history: Array<{ role: 'user' | 'assistant'; content: string }>) => Promise<string>
}

function DesktopPosShell({ user, onLogout }: DesktopPosShellProps) {
  const [loginMode, setLoginMode] = useState<'login' | 'register'>('login')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [authError, setAuthError] = useState('')
  const [isReady, setIsReady] = useState(false)
  const [desktopRuntime, setDesktopRuntime] = useState<{ isDesktop?: boolean; apiBase?: string; isDev?: boolean } | null>(null)
  const [needsUpdate, setNeedsUpdate] = useState(false)
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null)
  const [updateVersion, setUpdateVersion] = useState('')

  useEffect(() => {
    const anyWindow = window as Window & {
      smartbisDesktop?: {
        onRuntime?: (handler: (data: any) => void) => void
        onUpdateAvailable?: (handler: (data: any) => void) => void
        onUpdateDownloaded?: (handler: () => void) => void
        onUpdateProgress?: (handler: (data: any) => void) => void
        onUpdateError?: (handler: (data: any) => void) => void
        checkForUpdates?: () => Promise<any>
        restartAndInstall?: () => Promise<any>
      }
      __SMARTBIS_DESKTOP__?: boolean
      __API_BASE__?: string
    }

    if (anyWindow.smartbisDesktop?.onRuntime) {
      anyWindow.smartbisDesktop.onRuntime((data) => {
        setDesktopRuntime(data)
        setIsReady(true)
        if (data?.apiBase) {
          ;(window as any).__API_BASE__ = data.apiBase
        }
      })
    }

    if (anyWindow.smartbisDesktop?.onUpdateAvailable) {
      anyWindow.smartbisDesktop.onUpdateAvailable((data) => {
        setUpdateVersion(data?.version || '')
        setNeedsUpdate(true)
      })
    }

    if (anyWindow.smartbisDesktop?.onUpdateDownloaded) {
      anyWindow.smartbisDesktop.onUpdateDownloaded(() => {
        setNeedsUpdate(true)
      })
    }

    if (anyWindow.smartbisDesktop?.onUpdateProgress) {
      anyWindow.smartbisDesktop.onUpdateProgress((data) => {
        const pct = typeof data?.percent === 'number' ? data.percent : null
        setDownloadProgress(pct)
      })
    }

    if (anyWindow.smartbisDesktop?.onUpdateError) {
      anyWindow.smartbisDesktop.onUpdateError((data) => {
        console.warn('Desktop update error', data)
      })
    }

    ;(window as any).__SMARTBIS_DESKTOP__ = true
    setIsReady(true)
  }, [])

  const canAccessPos = useMemo(() => user.posRole === 'owner' || user.posRole === 'admin' || user.posRole === 'cashier', [user.posRole])

  async function handleDesktopLogin(input: { email: string; password: string }) {
    setIsSubmitting(true)
    setAuthError('')

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })

      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload?.error || 'No se pudo iniciar sesión')
      }

      if (payload?.token) {
        saveStoredToken(payload.token)
        window.location.reload()
      }
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'No se pudo iniciar sesión')
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleDesktopRegister(input: { email: string; password: string }) {
    setIsSubmitting(true)
    setAuthError('')

    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })

      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload?.error || 'No se pudo crear la cuenta')
      }

      if (payload?.token) {
        saveStoredToken(payload.token)
        window.location.reload()
      }
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'No se pudo crear la cuenta')
    } finally {
      setIsSubmitting(false)
    }
  }

  if (!canAccessPos) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-[#0c2a47] px-6 text-slate-100">
        <div className="max-w-md rounded-[22px] border border-[#1a3a5a] bg-[#0f3151] p-8 text-center">
          <h1 className="text-2xl font-bold text-[#1090D0]">Acceso restringido</h1>
          <p className="mt-3 text-sm text-slate-300">Este escritorio solo permite acceso a usuarios del POS. Contacta al administrador.</p>
          <button
            type="button"
            onClick={async () => { clearStoredToken(); await onLogout(); }}
            className="mt-6 rounded-xl bg-[#1090D0] px-4 py-2.5 text-sm font-bold text-white"
          >
            Cerrar sesión
          </button>
        </div>
      </div>
    )
  }

  if (!isReady) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-[#0c2a47] text-slate-100">
        <div className="rounded-[20px] border border-[#1a3a5a] bg-[#0f3151] px-8 py-6 text-sm text-slate-200">
          Iniciando Smartbis POS...
        </div>
      </div>
    )
  }

  if (needsUpdate) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-[#0c2a47] px-6 text-slate-100">
        <div className="w-full max-w-lg rounded-[22px] border border-[#1a3a5a] bg-[#0f3151] p-8">
          <h1 className="text-2xl font-bold text-[#1090D0]">Actualización disponible</h1>
          <p className="mt-3 text-sm text-slate-300">Se encontró una nueva versión {updateVersion || 'de la aplicación'}.</p>
          {downloadProgress !== null ? (
            <div className="mt-5">
              <div className="mb-2 text-xs text-slate-400">Descargando {downloadProgress.toFixed(0)}%</div>
              <div className="h-2.5 overflow-hidden rounded-full bg-[#0b2641]">
                <div className="h-full rounded-full bg-[#1090D0]" style={{ width: `${Math.min(100, Math.max(0, downloadProgress))}%` }} />
              </div>
            </div>
          ) : null}
          <button
            type="button"
            onClick={async () => {
              const api = (window as any).smartbisDesktop
              if (api?.restartAndInstall) {
                await api.restartAndInstall()
              }
            }}
            className="mt-6 rounded-xl bg-[#1090D0] px-4 py-2.5 text-sm font-bold text-white"
          >
            Instalar actualización
          </button>
        </div>
      </div>
    )
  }

  return (
    <main className="h-screen w-screen overflow-hidden bg-[#0c2a47] text-slate-100">
      <div className="absolute right-5 top-5 z-50 flex items-center gap-3 rounded-full border border-[#1a3a5a] bg-[#0f3151]/90 px-3 py-2 text-xs text-slate-200 backdrop-blur-sm">
        <span className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-400" />
        {desktopRuntime?.isDev ? 'Desktop DEV' : 'Desktop PROD'}
      </div>
      <CrmPosView />
    </main>
  )
}

export default DesktopPosShell
