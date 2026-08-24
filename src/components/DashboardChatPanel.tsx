import { useEffect, useMemo, useRef, useState } from 'react'
import { LoaderCircle, SendHorizontal, Sparkles, Trash2 } from 'lucide-react'
import MessageContent from '@/components/MessageContent'
import { cn } from '@/lib/utils'
import type { ChatMessage, WorkspaceDocument } from '@/types/app'

type DashboardChatPanelProps = {
  prompt: string
  documents: WorkspaceDocument[]
  onSendMessage: (
    message: string,
    history: Array<Pick<ChatMessage, 'role' | 'content'>>,
  ) => Promise<string>
}

function createMessage(role: ChatMessage['role'], content: string): ChatMessage {
  return {
    id: `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role,
    content,
  }
}

export default function DashboardChatPanel({
  prompt,
  documents,
  onSendMessage,
}: DashboardChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const lastMessageIdRef = useRef<string | null>(null)

  const activeDocuments = useMemo(() => documents.length, [documents])

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return

    const lastMessage = messages[messages.length - 1]
    if (lastMessage && lastMessage.id !== lastMessageIdRef.current) {
      lastMessageIdRef.current = lastMessage.id
      requestAnimationFrame(() => {
        viewport.scrollTop = viewport.scrollHeight
      })
      return
    }
    if (isLoading) {
      requestAnimationFrame(() => {
        viewport.scrollTop = viewport.scrollHeight
      })
    }
  }, [messages, isLoading])

  async function handleSend() {
    const nextMessage = input.trim()

    if (!nextMessage || isLoading) {
      return
    }

    if (!prompt.trim()) {
      setError('Guarda un prompt antes de probar el agente.')
      return
    }

    const nextHistory = [...messages]
    const userMessage = createMessage('user', nextMessage)

    setMessages((current) => [...current, userMessage])
    setInput('')
    setError('')
    setIsLoading(true)

    try {
      const answer = await onSendMessage(
        nextMessage,
        nextHistory.map(({ role, content }) => ({ role, content })),
      )

      setMessages((current) => [...current, createMessage('assistant', answer)])
    } catch (requestError) {
      const message =
        requestError instanceof Error
          ? requestError.message
          : 'No se pudo obtener respuesta del agente.'

      setError(message)
      setMessages((current) => [
        ...current,
        createMessage(
          'assistant',
          message.includes('/api/chat')
            ? 'No pude responder porque el endpoint /api/chat no esta disponible en este momento.'
            : 'No pude responder en este momento. Revisa el prompt, los documentos o la configuracion del modelo.',
        ),
      ])
    } finally {
      setIsLoading(false)
    }
  }

  function handleClear() {
    setMessages([])
    setInput('')
    setError('')
  }

  return (
    <section className="flex flex-col h-full w-full overflow-hidden gap-3">
      <div className="flex min-h-0 w-full flex-1 flex-col overflow-hidden rounded-[20px] border border-[#1a3a5a] bg-[#0f3151]">
        <div className="flex items-center justify-between gap-3 border-b border-[#1a3a5a] px-5 py-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-[#6bb8dd]">
              Chat workspace
            </p>
            <h2 className="mt-2 font-display text-[18px] font-bold text-white">
              Prueba del agente
            </h2>
          </div>

          <button
            type="button"
            onClick={handleClear}
            className="inline-flex items-center gap-2 rounded-xl border border-[#1a3a5a] bg-[#11375a] px-4 py-2 text-[12px] font-semibold text-slate-200 transition hover:border-[#1090D0]/50 hover:bg-[#143f67]"
          >
            <Trash2 className="h-4 w-4" />
            Limpiar
          </button>
        </div>

        <div
          ref={viewportRef}
          className={cn(
            'min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4 bg-[#0e2d4c]',
            'tech-scrollbar overscroll-contain scroll-smooth',
          )}
        >
          {messages.length === 0 ? (
            <div className="flex h-full min-h-[320px] flex-col items-center justify-center rounded-[18px] border border-dashed border-[#2a5589] bg-[#0b2641]/80 px-8 text-center">
              <Sparkles className="h-10 w-10 text-[#6bb8dd]" />
              <p className="mt-4 font-display text-[18px] font-bold text-white">Todo listo para probar</p>
              <p className="mt-2 max-w-md text-[12px] text-slate-300">
                Escribe preguntas reales y valida la respuesta usando el prompt y los documentos
                cargados en este tenant.
              </p>
            </div>
          ) : (
            messages.map((message) => (
              <article
                key={message.id}
                className={cn(
                  'max-w-[85%] rounded-[18px] border px-4 py-4 shadow-sm',
                  message.role === 'user'
                    ? 'ml-auto border-[#1090D0]/35 bg-[#1090D0]/18 text-slate-50'
                    : 'border-[#1a3a5a] bg-[#0b2641] text-slate-100',
                )}
              >
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-300/80">
                  {message.role === 'user' ? 'Tu' : 'Agente'}
                </p>
                <MessageContent content={message.content} />
              </article>
            ))
          )}

          {isLoading ? (
            <div className="inline-flex items-center gap-3 rounded-xl border border-[#1090D0]/30 bg-[#1090D0]/10 px-4 py-3 text-[12px] text-slate-100">
              <LoaderCircle className="h-4 w-4 animate-spin" />
              Pensando con el contexto actual...
            </div>
          ) : null}
        </div>

        <div className="border-t border-[#1a3a5a] bg-[#0f3151] p-4">
          <div className="flex gap-3">
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Escribe un mensaje..."
              className="min-h-[72px] max-h-[100px] flex-1 resize-none rounded-[18px] border border-[#1a3a5a] bg-[#0b2641] px-4 py-3 text-[13px] text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-[#1090D0]/50 focus:bg-[#0c2c4c]"
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  void handleSend()
                }
              }}
            />

            <button
              type="button"
              onClick={() => void handleSend()}
              disabled={isLoading}
              className="inline-flex min-w-[110px] items-center justify-center gap-2 rounded-xl bg-[#1090D0] px-4 py-3 text-[12px] font-bold text-white shadow transition hover:bg-[#0c79ae] disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
            >
              <SendHorizontal className="h-4 w-4" />
              Enviar
            </button>
          </div>

          {error ? <p className="mt-3 text-[12px] text-rose-300">{error}</p> : null}
        </div>
      </div>
    </section>
  )
}
