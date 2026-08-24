import { useEffect, useRef } from 'react'
import { LoaderCircle, SendHorizontal, Sparkles, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ChatMessage, WorkspaceDocument } from '@/types/chat'
import MessageContent from '@/components/MessageContent'

type ChatPanelProps = {
  messages: ChatMessage[]
  documents: WorkspaceDocument[]
  value: string
  isLoading: boolean
  error: string
  onChange: (value: string) => void
  onSend: () => void
  onClear: () => void
}

export default function ChatPanel({
  messages,
  documents,
  value,
  isLoading,
  error,
  onChange,
  onSend,
  onClear,
}: ChatPanelProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const lastMessageIdRef = useRef<string | null>(null)
  const activeDocuments = documents.filter((document) => document.isActive)

  useEffect(() => {
    const scroller = scrollRef.current
    if (!scroller) return

    const lastMessage = messages[messages.length - 1]
    if (lastMessage && lastMessage.id !== lastMessageIdRef.current) {
      lastMessageIdRef.current = lastMessage.id
      requestAnimationFrame(() => {
        scroller.scrollTop = scroller.scrollHeight
      })
      return
    }
  }, [messages, isLoading])

  const scrollbarClasses =
    'tech-scrollbar'

  const sectionCounts = {
    general: activeDocuments.filter((document) => document.section === 'general').length,
    cursos: activeDocuments.filter((document) => document.section === 'cursos').length,
    productos: activeDocuments.filter((document) => document.section === 'productos').length,
  }

  return (
    <section className="flex h-full min-h-0 flex-col gap-5">
      <header className="flex flex-wrap items-start justify-between gap-4 rounded-3xl border border-white/10 bg-slate-950/80 p-6">
        <div className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-[0.35em] text-cyan-300/80">
            Chat
          </p>
          <h2 className="font-display text-3xl font-semibold text-white">
            Prueba del agente
          </h2>
          <p className="max-w-2xl text-sm text-slate-300">
            Usa el prompt guardado y los documentos activos de la base de datos.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="rounded-2xl border border-cyan-400/20 bg-cyan-400/10 px-4 py-3 text-right text-sm text-cyan-100">
            <p className="font-semibold">{activeDocuments.length} documentos activos</p>
            <p className="text-xs text-cyan-100/70">
              General {sectionCounts.general} · Cursos {sectionCounts.cursos} · Productos{' '}
              {sectionCounts.productos}
            </p>
          </div>
          <button
            type="button"
            onClick={onClear}
            className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-sm font-semibold text-slate-100 transition hover:border-cyan-300/40 hover:text-white"
          >
            <Trash2 className="h-4 w-4" />
            Limpiar
          </button>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 gap-5 xl:grid-cols-[minmax(0,1.65fr)_320px]">
        <div className="flex min-h-0 flex-col overflow-hidden rounded-3xl border border-white/10 bg-slate-950/85">
          <div className="border-b border-white/10 px-5 py-4">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-400">
              Conversacion
            </p>
          </div>

          <div className="flex min-h-0 flex-1 flex-col">
            <div
              ref={scrollRef}
              className={cn(
                'flex-1 space-y-4 overflow-y-auto px-5 py-5',
                scrollbarClasses,
                'overscroll-contain scroll-smooth',
              )}
            >
              {messages.length === 0 ? (
                <div className="flex h-full min-h-[360px] flex-col items-center justify-center rounded-3xl border border-dashed border-cyan-400/20 bg-slate-900/70 px-8 text-center">
                  <Sparkles className="h-10 w-10 text-cyan-300" />
                  <p className="mt-4 font-display text-2xl text-white">
                    Todo listo para probar
                  </p>
                  <p className="mt-2 max-w-md text-sm text-slate-300">
                    Enviale preguntas reales al agente y valida que responda con base en
                    el prompt y los documentos cargados.
                  </p>
                </div>
              ) : (
                messages.map((message) => (
                  <article
                    key={message.id}
                    className={cn(
                      'max-w-[85%] rounded-3xl border px-4 py-4 shadow-sm',
                      message.role === 'user'
                        ? 'ml-auto border-cyan-400/30 bg-cyan-500/15 text-cyan-50'
                        : 'border-white/10 bg-slate-900 text-slate-100',
                    )}
                  >
                    <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.22em] opacity-65">
                      {message.role === 'user' ? 'Tu' : 'Agente'}
                    </p>
                    <MessageContent content={message.content} />
                  </article>
                ))
              )}

              {isLoading ? (
                <div className="inline-flex items-center gap-3 rounded-2xl border border-cyan-400/20 bg-cyan-500/10 px-4 py-3 text-sm text-cyan-100">
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                  Pensando con el contexto activo...
                </div>
              ) : null}
            </div>

            <div className="border-t border-white/10 p-4">
              <div className="flex gap-3">
                <textarea
                  value={value}
                  onChange={(event) => onChange(event.target.value)}
                  placeholder="Escribe una pregunta..."
                  className="min-h-[88px] flex-1 resize-none rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-sm text-white outline-none ring-0 transition placeholder:text-slate-500 focus:border-cyan-300/50"
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault()
                      onSend()
                    }
                  }}
                />
                <button
                  type="button"
                  onClick={onSend}
                  disabled={isLoading}
                  className="inline-flex min-w-[108px] items-center justify-center gap-2 rounded-2xl border border-cyan-300/40 bg-cyan-500 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-slate-800 disabled:text-slate-500"
                >
                  <SendHorizontal className="h-4 w-4" />
                  Enviar
                </button>
              </div>

              {error ? <p className="mt-3 text-sm text-rose-300">{error}</p> : null}
            </div>
          </div>
        </div>

        <aside className={cn('min-h-0 flex-1 space-y-5 overflow-y-auto pr-1', scrollbarClasses)}>
          <div className="rounded-3xl border border-white/10 bg-slate-950/80 p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.35em] text-cyan-300/80">
              Regla activa
            </p>
            <ul className="mt-4 space-y-3 text-sm text-slate-300">
              <li>Responde solo con documentos activos.</li>
              <li>Si falta info, debe decirlo.</li>
              <li>Ideal para validar prompt y contenido.</li>
            </ul>
          </div>

          <div className="rounded-3xl border border-white/10 bg-slate-950/80 p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.35em] text-cyan-300/80">
              Documentos activos
            </p>
            <div className="mt-4 space-y-3">
              {activeDocuments.length === 0 ? (
                <p className="text-sm text-slate-400">No hay documentos activos.</p>
              ) : (
                activeDocuments.map((document) => (
                  <div
                    key={document.id}
                    className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-slate-900 px-3 py-3 text-sm"
                  >
                    <span className="truncate text-slate-200">{document.title}</span>
                    <span className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300">
                      {document.section}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </aside>
      </div>
    </section>
  )
}
