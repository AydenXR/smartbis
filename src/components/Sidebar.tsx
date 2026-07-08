import { MessageSquareText, Settings2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ContextFileStatus, PanelView } from '@/types/chat'
import { getSourceLabel } from '@/utils/context'

type SidebarProps = {
  activeView: PanelView
  onChangeView: (view: PanelView) => void
  files: ContextFileStatus[]
}

const items: Array<{
  id: PanelView
  label: string
  icon: typeof Settings2
}> = [
  { id: 'prompt', label: 'prompt', icon: Settings2 },
  { id: 'chat', label: 'chat', icon: MessageSquareText },
]

export default function Sidebar({ activeView, onChangeView, files }: SidebarProps) {
  const availableSources = files.filter((file) => file.hasContent).length

  return (
    <aside className="flex h-full w-full max-w-[220px] flex-col justify-between border-r border-zinc-900/15 bg-[#e8e6e2] px-5 py-6">
      <div className="space-y-8">
        <div className="space-y-2">
          <p className="font-display text-xs uppercase tracking-[0.35em] text-zinc-500">
            Salubel
          </p>
          <h1 className="font-display text-2xl font-semibold text-zinc-900">
            Agent Desk
          </h1>
          <p className="max-w-[14rem] text-sm text-zinc-600">
            Navegacion simple para editar el prompt o hablar con el agente.
          </p>
        </div>

        <nav className="space-y-3">
          {items.map((item) => {
            const Icon = item.icon

            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onChangeView(item.id)}
                className={cn(
                  'flex w-full items-center gap-3 border px-4 py-3 text-left text-base font-semibold uppercase tracking-[0.08em] transition',
                  activeView === item.id
                    ? 'border-zinc-950 bg-zinc-950 text-white shadow-[6px_6px_0_rgba(24,24,27,0.18)]'
                    : 'border-zinc-900 bg-white text-zinc-900 hover:bg-zinc-100',
                )}
              >
                <Icon className="h-4 w-4" />
                <span>{item.label}</span>
              </button>
            )
          })}
        </nav>
      </div>

      <div className="space-y-3 border border-zinc-900/10 bg-white/70 p-4 text-sm text-zinc-700">
        <p className="font-display text-xs uppercase tracking-[0.28em] text-zinc-500">
          Fuentes
        </p>
        <p>
          {availableSources} de {files.length || 4} archivos con contenido.
        </p>
        <div className="space-y-2">
          {files.map((file) => (
            <div key={file.file} className="flex items-center justify-between gap-3 text-xs">
              <span className="truncate text-zinc-600">{getSourceLabel(file.file)}</span>
              <span
                className={cn(
                  'rounded-full px-2 py-1 font-medium uppercase tracking-[0.18em]',
                  file.hasContent
                    ? 'bg-emerald-100 text-emerald-700'
                    : 'bg-amber-100 text-amber-700',
                )}
              >
                {file.hasContent ? 'ok' : 'vacio'}
              </span>
            </div>
          ))}
        </div>
      </div>
    </aside>
  )
}
