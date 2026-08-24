import { useEffect, useMemo, useState } from 'react'
import AuthPanel from '@/components/AuthPanel'
import Dashboard from '@/components/Dashboard'
import LandingPage from '@/components/LandingPage'
import DesktopPosShell from '@/components/DesktopPosShell'
import {
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

  const isDesktopShell = typeof window !== 'undefined' && Boolean((window as Window & { __SMARTBIS_DESKTOP__?: boolean }).__SMARTBIS_DESKTOP__)
  const hasSession = useMemo(() => Boolean(user && workspace), [user, workspace])

  function resetToLogin(message = '') {
    setUser(null)
    setWorkspace(null)
    setWorkspaceError(message)
    setAuthError(message)
    setShowAuthPanel(false)
  }

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
      await deleteDocument(currentFileName)

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
    await logoutAccount()
    resetToLogin()
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
