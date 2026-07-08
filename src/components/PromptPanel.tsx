import { RotateCcw, Save } from 'lucide-react'
import type { ContextFileStatus } from '@/types/chat'
import { getSourceLabel } from '@/utils/context'

type PromptPanelProps = {
  prompt: string
  files: ContextFileStatus[]
  onChange: (value: string) => void
  onReset: () => void
  onSave: () => void
}

export default function PromptPanel({
  prompt,
  files,
  onChange,
  onReset,
  onSave,
}: PromptPanelProps) {
  return (
    <section className="flex h-full flex-col gap-6">
      <header className="flex items-start justify-between gap-4 border-b border-zinc-900/10 pb-5">
        <div className="space-y-2">
          <p className="font-display text-xs uppercase tracking-[0.35em] text-zinc-500">
            Prompt base
          </p>
          <h2 className="font-display text-3xl font-semibold text-zinc-950">
            Reglas del agente
          </h2>
          <p className="max-w-2xl text-sm text-zinc-600">
            Este texto define el comportamiento conversacional. El backend siempre agrega
            reglas duras para usar solo los markdown como fuente de verdad.
          </p>
        </div>

        <div className="flex gap-3">
          <button
            type="button"
            onClick={onReset}
            className="inline-flex items-center gap-2 border border-zinc-900 bg-white px-4 py-3 text-sm font-semibold uppercase tracking-[0.08em] text-zinc-900 transition hover:bg-zinc-100"
          >
            <RotateCcw className="h-4 w-4" />
            Restaurar
          </button>
          <button
            type="button"
            onClick={onSave}
            className="inline-flex items-center gap-2 border border-zinc-950 bg-zinc-950 px-4 py-3 text-sm font-semibold uppercase tracking-[0.08em] text-white transition hover:bg-zinc-800"
          >
            <Save className="h-4 w-4" />
            Guardar
          </button>
        </div>
      </header>

      <div className="grid h-full gap-5 xl:grid-cols-[minmax(0,1.4fr)_320px]">
        <div className="flex min-h-[520px] flex-col border border-zinc-900/10 bg-white shadow-[12px_12px_0_rgba(24,24,27,0.06)]">
          <div className="border-b border-zinc-900/10 px-5 py-4">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-zinc-500">
              Editor
            </p>
          </div>
          <textarea
            value={prompt}
            onChange={(event) => onChange(event.target.value)}
            className="min-h-[460px] flex-1 resize-none bg-transparent px-5 py-5 font-mono text-sm leading-7 text-zinc-800 outline-none"
            spellCheck={false}
          />
        </div>

        <div className="space-y-5">
          <div className="border border-zinc-900/10 bg-[#f7f5f1] p-5">
            <p className="font-display text-xs uppercase tracking-[0.35em] text-zinc-500">
              Reglas fijas
            </p>
            <ul className="mt-4 space-y-3 text-sm text-zinc-700">
              <li>No inventar precios, fechas o servicios.</li>
              <li>Responder solo con `content/cursos.md`, `content/empresa.md`, `content/productos.md` y `content/tratamiendos.md`.</li>
              <li>Redirigir preguntas fuera de Salubel Institute.</li>
              <li>Indicar cuando una respuesta no este disponible en las fuentes.</li>
            </ul>
          </div>

          <div className="border border-zinc-900/10 bg-white p-5">
            <p className="font-display text-xs uppercase tracking-[0.35em] text-zinc-500">
              Estado de fuentes
            </p>
            <div className="mt-4 space-y-3">
              {files.map((file) => (
                <div key={file.file} className="flex items-center justify-between gap-3 text-sm">
                  <span className="truncate text-zinc-700">{getSourceLabel(file.file)}</span>
                  <span className={file.hasContent ? 'text-emerald-700' : 'text-amber-700'}>
                    {file.hasContent ? 'Con contenido' : 'Sin contenido'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
