import { useEffect, useMemo, useRef, useState } from 'react'
import AuthPanel from '@/components/AuthPanel'
import Dashboard from '@/components/Dashboard'
import LandingPage from '@/components/LandingPage'
import DesktopPosShell from '@/components/DesktopPosShell'
import {
  clearStoredToken,
  createDocument,
  getCurrentUser,
  getWorkspace,
  loginAccount,
  logoutAccount,
  registerAccount,
  savePrompt,
  sendChatMessage,
  updateDocument,
  deleteDocument,
} from '@/lib/api'
import type { AuthUser, ChatMessage, WorkspaceDocument, WorkspacePayload } from '@/types/app'

type AuthMode = 'login' | 'register'

const INACTIVITY_TIMEOUT_MS = 10 * 60 * 1000

function sortDocuments(documents: WorkspaceDocument[]) {
  return [...documents].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
}

export default function App() {
  const [authMode, setAuthMode] = useState<AuthMode>('login')
  const [isBootstrapping, setIsBootstrapping] = useState(true)
  const [isSubmittingAuth, setIsSubmittingAuth] = useState(false)
  const [isSavingPrompt, setIsSavingPrompt] = useState(false)
  const [isSavingDocument, setIsSavingDocument] = useState(false)
  const [isDeletingDocument, setIsDeletingDocument] = useState(false)
  const [authError, setAuthError] = useState('')
  const [workspaceError, setWorkspaceError] = useState('')
  const [showAuthPanel, setShowAuthPanel] = useState(false)
  const [user, setUser] = useState<AuthUser | null>(null)
  const [workspace, setWorkspace] = useState<WorkspacePayload | null>(null)
  const inactivityTimerRef = useRef<number | null>(null)
  const isDesktopRef = useRef(false)

  const isDesktopShell = typeof window !== 'undefined' && Boolean(
    (window as Window & {
      __SMARTBIS_DESKTOP__?: boolean
      smartbisDesktop?: unknown
      __API_BASE__?: string
    }).smartbisDesktop,
  )

  const hasSession = useMemo(() => Boolean(user && workspace), [user, workspace])

  function resetToLogin(message = '') {
    setUser(null)
    setWorkspace(null)
    setWorkspaceError(message)
    setAuthError(message)
    setShowAuthPanel(false)
  }

  useEffect(() => {
    const anyWindow = window as Window & {
      __SMARTBIS_DESKTOP__?: boolean
      __API_BASE__?: string
      smartbisDesktop?: {
        onRuntime?: (handler: (data: { apiBase?: string; isDesktop?: boolean; isDev?: boolean }) => void) => void
      }
    }

    if (anyWindow.smartbisDesktop?.onRuntime) {
      anyWindow.smartbisDesktop.onRuntime((data) => {
        if (data?.apiBase) {
          anyWindow.__API_BASE__ = data.apiBase
        }

        if (data?.isDesktop || data?.apiBase || data?.isDev !== undefined) {
          anyWindow.__SMARTBIS_DESKTOP__ = true
        }
      })
    }

    if (anyWindow.smartbisDesktop) {
      anyWindow.__SMARTBIS_DESKTOP__ = true
    }
  }, [])

  useEffect(() => {
    let isMounted = true

    async function bootstrapSession() {
      try {
        const currentUser = await getCurrentUser()
        const currentWorkspace = await getWorkspace()

        if (!isMounted) {
          return
        }

        setUser(currentUser.user)
        setWorkspace(currentWorkspace)
      } catch {
        if (!isMounted) {
          return
        }

        resetToLogin()
      } finally {
        if (isMounted) {
          setIsBootstrapping(false)
        }
      }
    }

    void bootstrapSession()

    return () => {
      isMounted = false
    }
  }, [])

  function clearInactivityTimer() {
    if (inactivityTimerRef.current !== null) {
      try { window.clearTimeout(inactivityTimerRef.current) } catch (_) {}
      inactivityTimerRef.current = null
    }
  }

  function resetInactivityTimer(onTimeout: () => void) {
    clearInactivityTimer()
    inactivityTimerRef.current = window.setTimeout(() => {
      onTimeout()
    }, INACTIVITY_TIMEOUT_MS) as unknown as number
  }

  useEffect(() => {
    const anyWindow = window as Window & {
      __SMARTBIS_DESKTOP__?: boolean
      smartbisDesktop?: {
        onCloseRequested?: (handler: () => void) => void
        onRuntime?: (handler: (data: { isDesktop?: boolean }) => void) => void
      }
    }

    const isDesktop = Boolean(anyWindow.smartbisDesktop)
    isDesktopRef.current = isDesktop

    if (!user || !workspace) {
      clearInactivityTimer()
      return
    }

    async function handleAutoLogout() {
      clearInactivityTimer()
      try {
        await handleLogout()
      } catch (_) {
        clearStoredToken()
        resetToLogin('Sesión cerrada por inactividad.')
      }
    }

    if (!isDesktop) {
      const activityEvents = ['mousedown', 'mousemove', 'keydown', 'scroll', 'touchstart', 'click'] as const
      const onActivity = () => resetInactivityTimer(handleAutoLogout)

      for (const ev of activityEvents) {
        window.addEventListener(ev, onActivity, { passive: true })
      }

      resetInactivityTimer(handleAutoLogout)

      return () => {
        clearInactivityTimer()
        for (const ev of activityEvents) {
          window.removeEventListener(ev, onActivity)
        }
      }
    }

    function handleBeforeUnload(_e: BeforeUnloadEvent) {
      clearStoredToken()
    }
    window.addEventListener('beforeunload', handleBeforeUnload)

    return () => {
      clearInactivityTimer()
      window.removeEventListener('beforeunload', handleBeforeUnload)
    }
  }, [user, workspace])

  async function refreshWorkspace() {
    const payload = await getWorkspace()
    setUser(payload.user)
    setWorkspace(payload)
    setWorkspaceError('')
    return payload
  }

  async function handleLogin(input: { email: string; password: string }) {
    setIsSubmittingAuth(true)
    setAuthError('')

    try {
      const payload = await loginAccount(input)
      setUser(payload.user)
      await refreshWorkspace()
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'No se pudo iniciar sesion')
    } finally {
      setIsSubmittingAuth(false)
    }
  }

  async function handleRegister(input: { email: string; password: string }) {
    setIsSubmittingAuth(true)
    setAuthError('')

    try {
      const payload = await registerAccount(input)
      setUser(payload.user)
      await refreshWorkspace()
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'No se pudo crear la cuenta')
    } finally {
      setIsSubmittingAuth(false)
    }
  }

  async function handleSavePrompt(nextPrompt: string) {
    setIsSavingPrompt(true)
    setWorkspaceError('')

    try {
      const payload = await savePrompt(nextPrompt)

      setWorkspace((current) =>
        current
          ? {
              ...current,
              prompt: payload.prompt,
            }
          : current,
      )
    } catch (error) {
      setWorkspaceError(error instanceof Error ? error.message : 'No se pudo guardar el prompt')
      throw error
    } finally {
      setIsSavingPrompt(false)
    }
  }

  async function handleCreateDocument(input: { fileName: string; content: string }) {
    setIsSavingDocument(true)
    setWorkspaceError('')

    try {
      const payload = await createDocument(input)
      if (payload.ingestion && !payload.ingestion.ok) {
        const warning = `Documento guardado, pero no se pudo actualizar su índice: ${payload.ingestion.error || 'error desconocido'}. Se reintentará al siguiente mensaje o en la ingesta diaria.`
        setWorkspaceError(warning)
        console.error('[document-ingestion] save refresh failed', payload.ingestion.error)
      }

      setWorkspace((current) =>
        current
          ? {
              ...current,
              documents: sortDocuments([payload.document, ...current.documents]),
            }
          : current,
      )

      return payload.document
    } catch (error) {
      setWorkspaceError(error instanceof Error ? error.message : 'No se pudo crear el documento')
      throw error
    } finally {
      setIsSavingDocument(false)
    }
  }

  async function handleUpdateDocument(
    currentFileName: string,
    input: { fileName: string; content: string },
  ) {
    setIsSavingDocument(true)
    setWorkspaceError('')

    try {
      const payload = await updateDocument(currentFileName, input)
      if (payload.ingestion && !payload.ingestion.ok) {
        const warning = `Documento guardado, pero no se pudo actualizar su índice: ${payload.ingestion.error || 'error desconocido'}. Se reintentará al siguiente mensaje o en la ingesta diaria.`
        setWorkspaceError(warning)
        console.error('[document-ingestion] save refresh failed', payload.ingestion.error)
      }

      setWorkspace((current) =>
        current
          ? {
              ...current,
              documents: sortDocuments(
                current.documents
                  .filter((document) => document.fileName !== currentFileName)
                  .concat(payload.document),
              ),
            }
          : current,
      )

      return payload.document
    } catch (error) {
      setWorkspaceError(
        error instanceof Error ? error.message : 'No se pudo actualizar el documento',
      )
      throw error
    } finally {
      setIsSavingDocument(false)
    }
  }

  async function handleDeleteDocument(currentFileName: string) {
    setIsDeletingDocument(true)
    setWorkspaceError('')

    try {
      const payload = await deleteDocument(currentFileName)
      if (payload.ingestion && !payload.ingestion.ok) {
        const warning = `Documento eliminado, pero no se pudo actualizar su índice: ${payload.ingestion.error || 'error desconocido'}. Se reintentará al siguiente mensaje o en la ingesta diaria.`
        setWorkspaceError(warning)
        console.error('[document-ingestion] delete refresh failed', payload.ingestion.error)
      }

      setWorkspace((current) =>
        current
          ? {
              ...current,
              documents: current.documents.filter(
                (document) => document.fileName !== currentFileName,
              ),
            }
          : current,
      )
    } catch (error) {
      setWorkspaceError(error instanceof Error ? error.message : 'No se pudo eliminar el documento')
      throw error
    } finally {
      setIsDeletingDocument(false)
    }
  }

  async function handleLogout() {
    try {
      await logoutAccount()
    } catch {
      // La sesión debe terminar limpiamente en la UI aunque el endpoint de logout falle
      // o el token ya no esté presente. Eso evita quedar atrapado en la pantalla autenticada.
    } finally {
      clearStoredToken()
      resetToLogin()
    }
  }

  async function handleSendChatMessage(
    message: string,
    history: Array<Pick<ChatMessage, 'role' | 'content'>>,
  ) {
    if (!workspace) {
      throw new Error('No hay un workspace cargado')
    }

    try {
      const payload = await sendChatMessage({
        prompt: workspace.prompt,
        message,
        history,
      })

      return payload.answer
    } catch (error) {
      if (
        error instanceof Error &&
        /sesion vencio|inicia sesion nuevamente|jwt|token|expired/i.test(error.message)
      ) {
        resetToLogin('Tu sesion vencio. Inicia sesion nuevamente.')
      }

      throw error
    }
  }

  if (isBootstrapping) {
    return (
      <main className="flex h-screen w-screen items-center justify-center bg-[#0c2a47]">
        <div className="rounded-[20px] border border-[#1a3a5a] bg-[#0f3151] px-8 py-6 text-[13px] text-slate-200">
          Cargando Smartbis...
        </div>
      </main>
    )
  }

  if (hasSession && user && workspace) {
    if (isDesktopShell) {
      return (
        <DesktopPosShell
          user={user}
          onLogout={handleLogout}
          workspace={workspace}
          onSavePrompt={handleSavePrompt}
          onCreateDocument={handleCreateDocument}
          onUpdateDocument={handleUpdateDocument}
          onDeleteDocument={handleDeleteDocument}
          onSendChatMessage={handleSendChatMessage}
        />
      )
    }

    return (
      <main className="h-screen w-screen overflow-hidden bg-[#0c2a47]">
          {workspaceError ? (
            <div className="absolute top-3 left-3 right-3 z-50 rounded-xl border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-[13px] text-rose-100">
              {workspaceError}
            </div>
          ) : null}

          <Dashboard
            user={user}
            prompt={workspace.prompt}
            documents={workspace.documents}
            isSavingPrompt={isSavingPrompt}
            isSavingDocument={isSavingDocument}
            isDeletingDocument={isDeletingDocument}
            onSavePrompt={handleSavePrompt}
            onCreateDocument={handleCreateDocument}
            onUpdateDocument={handleUpdateDocument}
            onDeleteDocument={handleDeleteDocument}
            onSendChatMessage={handleSendChatMessage}
            onLogout={handleLogout}
          />
      </main>
    )
  }

  if (isDesktopShell) {
    return (
      <div className="flex min-h-screen w-full items-center justify-center bg-[#0c2a47] px-4 py-8">
        <div className="w-full max-w-xl">
          <AuthPanel
            mode={authMode}
            isSubmitting={isSubmittingAuth}
            error={authError}
            onModeChange={(mode) => {
              setAuthError('')
              setAuthMode(mode)
            }}
            onLogin={handleLogin}
            onRegister={handleRegister}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="relative min-h-screen w-full bg-[#0c2a47] text-slate-100">
      <LandingPage
        onLoginClick={() => {
          setAuthError('')
          setAuthMode('login')
          setShowAuthPanel(true)
          if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' })
        }}
        onRegisterClick={() => {
          setAuthError('')
          setAuthMode('register')
          setShowAuthPanel(true)
          if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' })
        }}
      />

      {showAuthPanel ? (
        <div className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-[#051628]/80 px-4 py-8 backdrop-blur-sm">
          <div className="w-full max-w-xl">
            <AuthPanel
              mode={authMode}
              isSubmitting={isSubmittingAuth}
              error={authError}
              onClose={() => {
                setShowAuthPanel(false)
                setAuthError('')
              }}
              onModeChange={(mode) => {
                setAuthError('')
                setAuthMode(mode)
              }}
              onLogin={handleLogin}
              onRegister={handleRegister}
            />
          </div>
        </div>
      ) : null}
    </div>
  )
}
