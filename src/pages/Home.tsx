import { useEffect, useMemo, useState } from 'react'
import ChatPanel from '@/components/ChatPanel'
import PromptPanel from '@/components/PromptPanel'
import Sidebar from '@/components/Sidebar'
import { useAuth } from '@/hooks/useAuth'
import { defaultPrompt, useChatStore } from '@/store/useChatStore'
import type { ChatMessage, ChatResponse, ContextFileStatus } from '@/types/chat'

function createMessage(role: ChatMessage['role'], content: string): ChatMessage {
  return {
    id: `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role,
    content,
  }
}

const fallbackFiles: ContextFileStatus[] = [
  { file: 'cursos.md', hasContent: true, size: 0 },
  { file: 'empresa.md', hasContent: true, size: 0 },
  { file: 'productos.md', hasContent: false, size: 0 },
  { file: 'tratamiendos.md', hasContent: false, size: 0 },
]

type WorkspaceTenant = {
  id: string
  name: string
  slug: string
}

export default function Home() {
  const { user, session, signOut } = useAuth()
  const {
    activeView,
    prompt,
    messages,
    setActiveView,
    setPrompt,
    resetPrompt,
    addMessage,
    clearMessages,
  } = useChatStore()

  const [files, setFiles] = useState<ContextFileStatus[]>(fallbackFiles)
  const [draftPrompt, setDraftPrompt] = useState(prompt)
  const [input, setInput] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isSigningOut, setIsSigningOut] = useState(false)
  const [activeTenant, setActiveTenant] = useState<WorkspaceTenant | null>(null)

  useEffect(() => {
    setDraftPrompt(prompt)
  }, [prompt])

  useEffect(() => {
    let isMounted = true

    async function loadContextStatus() {
      try {
        const response = await fetch('/api/context-status')

        if (!response.ok) {
          throw new Error('No se pudo leer el estado de las fuentes')
        }

        const payload = await response.json()
        if (isMounted) {
          setFiles(payload.files || fallbackFiles)
        }
      } catch {
        if (isMounted) {
          setError('No pude cargar el estado de las fuentes markdown.')
        }
      }
    }

    loadContextStatus()

    return () => {
      isMounted = false
    }
  }, [])

  useEffect(() => {
    let isMounted = true

    async function loadWorkspaceContext() {
      if (!session?.access_token) {
        if (isMounted) {
          setActiveTenant(null)
        }
        return
      }

      try {
        const response = await fetch('/api/auth/me', {
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
        })

        if (!response.ok) {
          throw new Error('No se pudo cargar el workspace del usuario.')
        }

        const payload = (await response.json()) as {
          activeTenant?: WorkspaceTenant | null
        }

        if (isMounted) {
          setActiveTenant(payload.activeTenant || null)
        }
      } catch {
        if (isMounted) {
          setActiveTenant(null)
        }
      }
    }

    loadWorkspaceContext()

    return () => {
      isMounted = false
    }
  }, [session])

  const sourceSummary = useMemo(() => {
    const withContent = files.filter((file) => file.hasContent).length
    return `${withContent}/${files.length} fuentes activas`
  }, [files])

  async function handleSend() {
    const nextMessage = input.trim()
    const nextPrompt = draftPrompt.trim()

    if (!nextMessage || isLoading) {
      return
    }

    if (!nextPrompt) {
      setError('El prompt no puede estar vacio.')
      setActiveView('prompt')
      return
    }

    setError('')
    setIsLoading(true)

    const userMessage = createMessage('user', nextMessage)
    addMessage(userMessage)
    setInput('')

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt: nextPrompt,
          message: nextMessage,
          history: messages.map(({ role, content }) => ({ role, content })),
        }),
      })

      const payload = (await response.json()) as ChatResponse | { error?: string }

      if (!response.ok || !('answer' in payload)) {
        const apiError = 'error' in payload ? payload.error : undefined
        throw new Error(apiError || 'No se pudo obtener respuesta del agente')
      }

      addMessage(createMessage('assistant', payload.answer))

      if (Array.isArray(payload.sources) && payload.sources.length > 0) {
        setFiles((current) =>
          current.map((file) => {
            const source = payload.sources.find((item) => item.file === file.file)
            return source
              ? {
                  ...file,
                  hasContent: source.hasContent,
                }
              : file
          }),
        )
      }
    } catch (requestError) {
      const message =
        requestError instanceof Error
          ? requestError.message
          : 'Ocurrio un error enviando el mensaje.'

      setError(message)
      addMessage(
        createMessage(
          'assistant',
          'No pude responder en este momento. Verifica la API key o intenta de nuevo.',
        ),
      )
    } finally {
      setIsLoading(false)
    }
  }

  function handleSavePrompt() {
    setPrompt(draftPrompt || defaultPrompt)
    setError('')
  }

  function handleResetPrompt() {
    resetPrompt()
    setDraftPrompt(defaultPrompt)
    setError('')
  }

  async function handleSignOut() {
    if (isSigningOut) {
      return
    }

    setIsSigningOut(true)

    try {
      await signOut()
    } catch {
      setError('No pude cerrar la sesion en este momento.')
    } finally {
      setIsSigningOut(false)
    }
  }

  return (
    <main className="min-h-screen bg-[#d9d8d4] p-4 text-zinc-900 md:p-6">
      <div className="grid min-h-[calc(100vh-2rem)] overflow-hidden border border-zinc-950 bg-[#efede8] shadow-[16px_16px_0_rgba(24,24,27,0.12)] md:min-h-[calc(100vh-3rem)] md:grid-cols-[220px_minmax(0,1fr)]">
        <Sidebar activeView={activeView} onChangeView={setActiveView} files={files} />

        <section className="flex min-h-0 flex-col bg-[#efede8]">
          <div className="flex items-center justify-between border-b border-zinc-900/10 px-6 py-4">
            <div>
              <p className="font-display text-xs uppercase tracking-[0.35em] text-zinc-500">
                Smartbis Workspace
              </p>
              <p className="mt-1 text-sm text-zinc-600">
                {activeTenant
                  ? `Tenant activo: ${activeTenant.name}`
                  : 'Tu espacio de trabajo protegido ya esta conectado con Supabase.'}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <div className="hidden border border-zinc-900 bg-white px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-700 md:block">
                {user?.email || 'Sesion activa'}
              </div>
              <div className="border border-zinc-900 bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-zinc-700">
                {sourceSummary}
              </div>
              <button
                type="button"
                onClick={handleSignOut}
                className="border border-zinc-900 bg-zinc-950 px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-white transition hover:bg-zinc-800"
              >
                {isSigningOut ? 'Saliendo...' : 'Salir'}
              </button>
            </div>
          </div>

          <div className="min-h-0 flex-1 p-6">
            {activeView === 'prompt' ? (
              <PromptPanel
                prompt={draftPrompt}
                files={files}
                onChange={setDraftPrompt}
                onReset={handleResetPrompt}
                onSave={handleSavePrompt}
              />
            ) : (
              <ChatPanel
                messages={messages}
                files={files}
                value={input}
                isLoading={isLoading}
                error={error}
                onChange={setInput}
                onSend={handleSend}
                onClear={clearMessages}
              />
            )}
          </div>
        </section>
      </div>
    </main>
  )
}
