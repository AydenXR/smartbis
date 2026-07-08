import { LoaderCircle, SendHorizontal, ShieldAlert, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ChatMessage, ContextFileStatus } from '@/types/chat'
import MessageContent from '@/components/MessageContent'
import { getSourceLabel } from '@/utils/context'

type ChatPanelProps = {
  messages: ChatMessage[]
  files: ContextFileStatus[]
  value: string
  isLoading: boolean
  error: string
  onChange: (value: string) => void
  onSend: () => void
  onClear: () => void
}

export default function ChatPanel({
  messages,
  files,
  value,
  isLoading,
  error,
  onChange,
  onSend,
  onClear,
}: ChatPanelProps) {
  return (
    <section className="flex h-full min-h-0 flex-col gap-6">
      <header className="flex items-start justify-between gap-4 border-b border-zinc-900/10 pb-5">
        <div className="space-y-2">
          <p className="font-display text-xs uppercase tracking-[0.35em] text-zinc-500">
            Chat
          </p>
          <h2 className="font-display text-3xl font-semibold text-zinc-950">
            Customer service agent
          </h2>
          <p className="max-w-2xl text-sm text-zinc-600">
            El agente responde con base en los archivos markdown locales y evita inventar
            informacion.
          </p>
        </div>

        <button
          type="button"
          onClick={onClear}
          className="inline-flex items-center gap-2 border border-zinc-900 bg-white px-4 py-3 text-sm font-semibold uppercase tracking-[0.08em] text-zinc-900 transition hover:bg-zinc-100"
        >
          <Trash2 className="h-4 w-4" />
          Limpiar
        </button>
      </header>

      <div className="grid min-h-0 flex-1 gap-5 xl:grid-cols-[minmax(0,1.5fr)_320px]">
        <div className="flex min-h-0 flex-col border border-zinc-900/10 bg-white shadow-[12px_12px_0_rgba(24,24,27,0.06)]">
          <div className="border-b border-zinc-900/10 px-5 py-4">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-zinc-500">
              Conversacion
            </p>
          </div>

          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
              {messages.length === 0 ? (
                <div className="flex h-full min-h-[320px] flex-col items-center justify-center border border-dashed border-zinc-300 bg-[#f7f5f1] px-8 text-center">
                  <ShieldAlert className="h-10 w-10 text-zinc-400" />
                  <p className="mt-4 font-display text-2xl text-zinc-900">
                    Listo para atender dudas sobre Salubel
                  </p>
                  <p className="mt-2 max-w-md text-sm text-zinc-600">
                    Puedes preguntar por cursos, ubicacion, instructoras, horarios o
                    informacion de la empresa.
                  </p>
                </div>
              ) : (
                messages.map((message) => (
                  <article
                    key={message.id}
                    className={cn(
                      'max-w-[80%] border px-4 py-4 shadow-sm',
                      message.role === 'user'
                        ? 'ml-auto border-zinc-950 bg-zinc-950 text-white'
                        : 'border-zinc-200 bg-[#f7f5f1] text-zinc-900',
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
                <div className="inline-flex items-center gap-3 border border-zinc-200 bg-[#f7f5f1] px-4 py-3 text-sm text-zinc-600">
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                  Pensando respuesta con las fuentes disponibles...
                </div>
              ) : null}
            </div>

            <div className="border-t border-zinc-900/10 p-4">
              <div className="flex gap-3">
                <textarea
                  value={value}
                  onChange={(event) => onChange(event.target.value)}
                  placeholder="Escribe una pregunta sobre Salubel Institute..."
                  className="min-h-[72px] flex-1 resize-none border border-zinc-300 bg-[#fcfbf8] px-4 py-3 text-sm text-zinc-900 outline-none ring-0 transition placeholder:text-zinc-400 focus:border-zinc-900"
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
                  className="inline-flex min-w-[88px] items-center justify-center gap-2 border border-zinc-950 bg-zinc-950 px-4 py-3 text-sm font-semibold uppercase tracking-[0.08em] text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:border-zinc-300 disabled:bg-zinc-200 disabled:text-zinc-500"
                >
                  <SendHorizontal className="h-4 w-4" />
                  Enviar
                </button>
              </div>

              {error ? <p className="mt-3 text-sm text-rose-600">{error}</p> : null}
            </div>
          </div>
        </div>

        <aside className="space-y-5">
          <div className="border border-zinc-900/10 bg-[#f7f5f1] p-5">
            <p className="font-display text-xs uppercase tracking-[0.35em] text-zinc-500">
              Alcance
            </p>
            <ul className="mt-4 space-y-3 text-sm text-zinc-700">
              <li>Informacion de empresa.</li>
              <li>Cursos disponibles.</li>
              <li>Productos y tratamientos solo si existen en los `.md`.</li>
              <li>Sin inventar precios, fechas o servicios.</li>
            </ul>
          </div>

          <div className="border border-zinc-900/10 bg-white p-5">
            <p className="font-display text-xs uppercase tracking-[0.35em] text-zinc-500">
              Contexto activo
            </p>
            <div className="mt-4 space-y-3">
              {files.map((file) => (
                <div key={file.file} className="flex items-center justify-between gap-3 text-sm">
                  <span className="truncate text-zinc-700">{getSourceLabel(file.file)}</span>
                  <span className={file.hasContent ? 'text-emerald-700' : 'text-amber-700'}>
                    {file.hasContent ? 'Activo' : 'Vacio'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </section>
  )
}
