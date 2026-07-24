import { useEffect, useMemo, useState } from 'react'
import { BookText, MessageSquareText, Settings2 } from 'lucide-react'
import ChatPanel from '@/components/ChatPanel'
import DocumentsPanel from '@/components/DocumentsPanel'
import PromptPanel from '@/components/PromptPanel'
import { defaultPrompt, useChatStore } from '@/store/useChatStore'
import type {
  ChatMessage,
  ChatResponse,
  LlmConfig,
  PanelView,
  WorkspaceDocument,
  WorkspacePayload,
} from '@/types/chat'
import { cn } from '@/lib/utils'

function createMessage(role: ChatMessage['role'], content: string): ChatMessage {
  return {
    id: `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role,
    content,
  }
}

const navigationItems: Array<{
  id: PanelView
  label: string
  icon: typeof MessageSquareText
}> = [
  { id: 'chat', label: 'Chat', icon: MessageSquareText },
  { id: 'prompt', label: 'Prompt', icon: Settings2 },
  { id: 'documents', label: 'Documentos', icon: BookText },
]

export default function Home() {
  const { activeView, messages, setActiveView, addMessage, clearMessages } = useChatStore()
  const [savedPrompt, setSavedPrompt] = useState(defaultPrompt)
  const [draftPrompt, setDraftPrompt] = useState(defaultPrompt)
  const [savedLlmConfig, setSavedLlmConfig] = useState<LlmConfig>({
    baseUrl: 'https://api.x.ai/v1/chat/completions',
    model: 'grok-4.3',
    hasApiKey: false,
    apiKeyPreview: '',
  })
  const [draftBaseUrl, setDraftBaseUrl] = useState('https://api.x.ai/v1/chat/completions')
  const [draftModel, setDraftModel] = useState('grok-4.3')
  const [draftApiKey, setDraftApiKey] = useState('')
  const [documents, setDocuments] = useState<WorkspaceDocument[]>([])
  const [input, setInput] = useState('')
  const [error, setError] = useState('')
  const [statusMessage, setStatusMessage] = useState('')
  const [isBootstrapping, setIsBootstrapping] = useState(true)
  const [isLoading, setIsLoading] = useState(false)
  const [isSavingPrompt, setIsSavingPrompt] = useState(false)
  const [isSavingLlmConfig, setIsSavingLlmConfig] = useState(false)
  const [isSavingDocument, setIsSavingDocument] = useState(false)
  const [isDeletingDocument, setIsDeletingDocument] = useState(false)

  useEffect(() => {
    let isMounted = true

    async function loadWorkspace() {
      try {
        const response = await fetch('/api/workspace')

        if (!response.ok) {
          throw new Error('No se pudo cargar la configuracion')
        }

        const payload = (await response.json()) as WorkspacePayload
        if (isMounted) {
          setSavedPrompt(payload.prompt || defaultPrompt)
          setDraftPrompt(payload.prompt || defaultPrompt)
          setSavedLlmConfig(
            payload.llmConfig || {
              baseUrl: 'https://api.x.ai/v1/chat/completions',
              model: 'grok-4.3',
              hasApiKey: false,
              apiKeyPreview: '',
            },
          )
          setDraftBaseUrl(
            payload.llmConfig?.baseUrl || 'https://api.x.ai/v1/chat/completions',
          )
          setDraftModel(payload.llmConfig?.model || 'grok-4.3')
          setDraftApiKey('')
          setDocuments(payload.documents || [])
          setError('')
        }
      } catch (workspaceError) {
        if (isMounted) {
          const message =
            workspaceError instanceof Error
              ? workspaceError.message
              : 'No pude cargar la configuracion inicial.'
          setError(message)
        }
      } finally {
        if (isMounted) {
          setIsBootstrapping(false)
        }
      }
    }

    loadWorkspace()

    return () => {
      isMounted = false
    }
  }, [])

  const activeDocuments = useMemo(
    () => documents.filter((document) => document.isActive).length,
    [documents],
  )
  const hasPromptChanges = draftPrompt.trim() !== savedPrompt.trim()
  const hasConfigChanges =
    draftBaseUrl.trim() !== savedLlmConfig.baseUrl.trim() ||
    draftModel.trim() !== savedLlmConfig.model.trim() ||
    draftApiKey.trim().length > 0

  async function handleSend() {
    const nextMessage = input.trim()
    const nextPrompt = savedPrompt.trim()

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
    } catch (requestError) {
      const message =
        requestError instanceof Error
          ? requestError.message
          : 'Ocurrio un error enviando el mensaje.'

      setError(message)
      addMessage(
        createMessage(
          'assistant',
          'No pude responder en este momento. Revisa el prompt, los documentos o la configuracion de la API.',
        ),
      )
    } finally {
      setIsLoading(false)
    }
  }

  async function handleSavePrompt() {
    const nextPrompt = draftPrompt.trim()

    if (!nextPrompt) {
      setError('El prompt no puede estar vacio.')
      return
    }

    setIsSavingPrompt(true)
    setError('')
    setStatusMessage('')

    try {
      const response = await fetch('/api/prompt', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt: nextPrompt,
        }),
      })

      const payload = (await response.json()) as { prompt?: string; error?: string }

      if (!response.ok || !payload.prompt) {
        throw new Error(payload.error || 'No se pudo guardar el prompt')
      }

      setSavedPrompt(payload.prompt)
      setDraftPrompt(payload.prompt)
      setStatusMessage('Prompt guardado.')
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'No se pudo guardar el prompt.')
    } finally {
      setIsSavingPrompt(false)
    }
  }

  function handleResetPrompt() {
    setDraftPrompt(defaultPrompt)
    setError('')
    setStatusMessage('')
  }

  function handleResetLlmConfig() {
    setDraftBaseUrl(savedLlmConfig.baseUrl)
    setDraftModel(savedLlmConfig.model)
    setDraftApiKey('')
    setError('')
    setStatusMessage('')
  }

  async function handleSaveLlmConfig() {
    const nextBaseUrl = draftBaseUrl.trim()
    const nextModel = draftModel.trim()

    if (!nextBaseUrl || !nextModel) {
      setError('El endpoint y el modelo no pueden estar vacios.')
      return
    }

    setIsSavingLlmConfig(true)
    setError('')
    setStatusMessage('')

    try {
      const response = await fetch('/api/llm-config', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          baseUrl: nextBaseUrl,
          model: nextModel,
          apiKey: draftApiKey,
        }),
      })

      const payload = (await response.json()) as {
        llmConfig?: LlmConfig
        error?: string
      }

      if (!response.ok || !payload.llmConfig) {
        throw new Error(payload.error || 'No se pudo guardar la configuracion del modelo')
      }

      setSavedLlmConfig(payload.llmConfig)
      setDraftBaseUrl(payload.llmConfig.baseUrl)
      setDraftModel(payload.llmConfig.model)
      setDraftApiKey('')
      setStatusMessage('Configuracion del modelo guardada.')
    } catch (configError) {
      setError(
        configError instanceof Error
          ? configError.message
          : 'No se pudo guardar la configuracion del modelo.',
      )
    } finally {
      setIsSavingLlmConfig(false)
    }
  }

  async function handleCreateDocument(input: {
    section: 'general' | 'cursos' | 'productos'
    title: string
    content: string
    isActive: boolean
  }) {
    setIsSavingDocument(true)
    setError('')
    setStatusMessage('')

    try {
      const response = await fetch('/api/documents', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(input),
      })

      const payload = (await response.json()) as {
        document?: WorkspaceDocument
        error?: string
      }

      if (!response.ok || !payload.document) {
        throw new Error(payload.error || 'No se pudo crear el documento')
      }

      setDocuments((current) => [payload.document as WorkspaceDocument, ...current])
      setStatusMessage('Documento creado.')

      return payload.document as WorkspaceDocument
    } catch (documentError) {
      const message =
        documentError instanceof Error ? documentError.message : 'No se pudo crear el documento.'
      setError(message)
      throw new Error(message)
    } finally {
      setIsSavingDocument(false)
    }
  }

  async function handleUpdateDocument(
    id: string,
    input: {
      title: string
      content: string
      isActive: boolean
    },
  ) {
    setIsSavingDocument(true)
    setError('')
    setStatusMessage('')

    try {
      const response = await fetch(`/api/documents/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(input),
      })

      const payload = (await response.json()) as {
        document?: WorkspaceDocument
        error?: string
      }

      if (!response.ok || !payload.document) {
        throw new Error(payload.error || 'No se pudo actualizar el documento')
      }

      const updatedDocument = payload.document as WorkspaceDocument
      setDocuments((current) =>
        current.map((document) => (document.id === id ? updatedDocument : document)),
      )
      setStatusMessage('Documento actualizado.')

      return updatedDocument
    } catch (documentError) {
      const message =
        documentError instanceof Error
          ? documentError.message
          : 'No se pudo actualizar el documento.'
      setError(message)
      throw new Error(message)
    } finally {
      setIsSavingDocument(false)
    }
  }

  async function handleDeleteDocument(id: string) {
    setIsDeletingDocument(true)
    setError('')
    setStatusMessage('')

    try {
      const response = await fetch(`/api/documents/${id}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        let apiMessage = 'No se pudo eliminar el documento'

        try {
          const payload = (await response.json()) as { error?: string }
          apiMessage = payload.error || apiMessage
        } catch {
          apiMessage = 'No se pudo eliminar el documento'
        }

        throw new Error(apiMessage)
      }

      setDocuments((current) => current.filter((document) => document.id !== id))
      setStatusMessage('Documento eliminado.')
    } catch (documentError) {
      const message =
        documentError instanceof Error
          ? documentError.message
          : 'No se pudo eliminar el documento.'
      setError(message)
      throw new Error(message)
    } finally {
      setIsDeletingDocument(false)
    }
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,#0f3b82_0%,#07111f_42%,#030712_100%)] p-4 text-white md:p-6">
      <div className="mx-auto flex min-h-[calc(100vh-2rem)] max-w-[1600px] flex-col gap-5 md:min-h-[calc(100vh-3rem)]">
        <header className="rounded-[28px] border border-white/10 bg-slate-950/80 px-6 py-5 backdrop-blur">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.35em] text-cyan-300/80">
                Salubel Institute
              </p>
              <h1 className="font-display mt-2 text-3xl font-semibold text-white">
                Panel del agente
              </h1>
              <p className="mt-2 text-sm text-slate-300">
                Solo tres vistas: Chat, Prompt y Documentos.
              </p>
            </div>

            <div className="rounded-2xl border border-cyan-400/20 bg-cyan-400/10 px-4 py-3 text-sm text-cyan-100">
              {activeDocuments} documentos activos
            </div>
          </div>

          <div className="mt-5 flex flex-wrap gap-3">
            {navigationItems.map((item) => {
              const Icon = item.icon

              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveView(item.id)}
                  className={cn(
                    'inline-flex items-center gap-2 rounded-2xl border px-4 py-3 text-sm font-semibold transition',
                    activeView === item.id
                      ? 'border-cyan-300/40 bg-cyan-500 text-slate-950'
                      : 'border-white/10 bg-slate-900 text-slate-100 hover:border-cyan-300/40',
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </button>
              )
            })}
          </div>
        </header>

        {(error || statusMessage) && !isBootstrapping ? (
          <div
            className={cn(
              'rounded-2xl border px-4 py-3 text-sm',
              error
                ? 'border-rose-300/20 bg-rose-500/10 text-rose-100'
                : 'border-cyan-300/20 bg-cyan-500/10 text-cyan-100',
            )}
          >
            {error || statusMessage}
          </div>
        ) : null}

        <section className="min-h-0 flex-1">
          {isBootstrapping ? (
            <div className="flex h-full min-h-[520px] items-center justify-center rounded-3xl border border-white/10 bg-slate-950/75 text-slate-300">
              Cargando configuracion...
            </div>
          ) : activeView === 'prompt' ? (
            <PromptPanel
              prompt={draftPrompt}
              baseUrl={draftBaseUrl}
              model={draftModel}
              apiKey={draftApiKey}
              apiKeyPreview={savedLlmConfig.apiKeyPreview}
              hasApiKey={savedLlmConfig.hasApiKey}
              isSavingPrompt={isSavingPrompt}
              isSavingConfig={isSavingLlmConfig}
              hasPromptChanges={hasPromptChanges}
              hasConfigChanges={hasConfigChanges}
              onChange={setDraftPrompt}
              onChangeBaseUrl={setDraftBaseUrl}
              onChangeModel={setDraftModel}
              onChangeApiKey={setDraftApiKey}
              onReset={handleResetPrompt}
              onSave={handleSavePrompt}
              onResetConfig={handleResetLlmConfig}
              onSaveConfig={handleSaveLlmConfig}
            />
          ) : activeView === 'documents' ? (
            <DocumentsPanel
              documents={documents}
              isSaving={isSavingDocument}
              isDeleting={isDeletingDocument}
              onCreate={handleCreateDocument}
              onUpdate={handleUpdateDocument}
              onDelete={handleDeleteDocument}
            />
          ) : (
            <ChatPanel
              messages={messages}
              documents={documents}
              value={input}
              isLoading={isLoading}
              error={error}
              onChange={setInput}
              onSend={handleSend}
              onClear={clearMessages}
            />
          )}
        </section>
      </div>
    </main>
  )
}
