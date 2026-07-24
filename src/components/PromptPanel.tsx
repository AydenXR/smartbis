import { RotateCcw, Save } from 'lucide-react'

type PromptPanelProps = {
  prompt: string
  baseUrl: string
  model: string
  apiKey: string
  apiKeyPreview: string
  hasApiKey: boolean
  isSavingPrompt: boolean
  isSavingConfig: boolean
  hasPromptChanges: boolean
  hasConfigChanges: boolean
  onChange: (value: string) => void
  onChangeBaseUrl: (value: string) => void
  onChangeModel: (value: string) => void
  onChangeApiKey: (value: string) => void
  onReset: () => void
  onSave: () => void
  onResetConfig: () => void
  onSaveConfig: () => void
}

export default function PromptPanel({
  prompt,
  baseUrl,
  model,
  apiKey,
  apiKeyPreview,
  hasApiKey,
  isSavingPrompt,
  isSavingConfig,
  hasPromptChanges,
  hasConfigChanges,
  onChange,
  onChangeBaseUrl,
  onChangeModel,
  onChangeApiKey,
  onReset,
  onSave,
  onResetConfig,
  onSaveConfig,
}: PromptPanelProps) {
  return (
    <section className="flex h-full flex-col gap-5">
      <header className="flex flex-wrap items-start justify-between gap-4 rounded-3xl border border-white/10 bg-slate-950/80 p-6">
        <div className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-[0.35em] text-cyan-300/80">
            Prompt
          </p>
          <h2 className="font-display text-3xl font-semibold text-white">
            Comportamiento del agente
          </h2>
          <p className="max-w-2xl text-sm text-slate-300">
            Edita el prompt principal y guardalo directo en la base de datos.
          </p>
        </div>

        <div className="flex gap-3">
          <button
            type="button"
            onClick={onReset}
            className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-sm font-semibold text-slate-100 transition hover:border-cyan-300/40"
          >
            <RotateCcw className="h-4 w-4" />
            Restaurar
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={isSavingPrompt || !hasPromptChanges}
            className="inline-flex items-center gap-2 rounded-2xl border border-cyan-300/40 bg-cyan-500 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-slate-800 disabled:text-slate-500"
          >
            <Save className="h-4 w-4" />
            {isSavingPrompt ? 'Guardando...' : 'Guardar prompt'}
          </button>
        </div>
      </header>

      <div className="grid h-full gap-5 xl:grid-cols-[minmax(0,1.5fr)_320px]">
        <div className="flex min-h-[560px] flex-col overflow-hidden rounded-3xl border border-white/10 bg-slate-950/85">
          <div className="border-b border-white/10 px-5 py-4">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-400">
              Editor
            </p>
          </div>
          <textarea
            value={prompt}
            onChange={(event) => onChange(event.target.value)}
            className="min-h-[460px] flex-1 resize-none bg-transparent px-5 py-5 font-mono text-sm leading-7 text-slate-100 outline-none"
            spellCheck={false}
          />
        </div>

        <div className="space-y-5">
          <div className="rounded-3xl border border-white/10 bg-slate-950/80 p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.35em] text-cyan-300/80">
                  Modelo y API key
                </p>
                <p className="mt-2 text-sm text-slate-300">
                  Cambia el modelo usado y define tu propia API key.
                </p>
              </div>
            </div>

            <div className="mt-5 space-y-4">
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-400">
                  Endpoint
                </label>
                <input
                  value={baseUrl}
                  onChange={(event) => onChangeBaseUrl(event.target.value)}
                  placeholder="https://api.x.ai/v1/chat/completions"
                  className="w-full rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-300/40"
                />
              </div>

              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-400">
                  Modelo
                </label>
                <input
                  value={model}
                  onChange={(event) => onChangeModel(event.target.value)}
                  placeholder="grok-4.3"
                  className="w-full rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-300/40"
                />
              </div>

              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-400">
                  API key
                </label>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(event) => onChangeApiKey(event.target.value)}
                  placeholder={hasApiKey ? `Actual: ${apiKeyPreview}` : 'Pega aqui tu API key'}
                  className="w-full rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-300/40"
                />
                <p className="text-xs text-slate-500">
                  Si no escribes una nueva key, se conserva la actual.
                </p>
              </div>
            </div>

            <div className="mt-5 flex gap-3">
              <button
                type="button"
                onClick={onResetConfig}
                className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-sm font-semibold text-slate-100 transition hover:border-cyan-300/40"
              >
                <RotateCcw className="h-4 w-4" />
                Restaurar
              </button>
              <button
                type="button"
                onClick={onSaveConfig}
                disabled={isSavingConfig || !hasConfigChanges}
                className="inline-flex items-center gap-2 rounded-2xl border border-cyan-300/40 bg-cyan-500 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-slate-800 disabled:text-slate-500"
              >
                <Save className="h-4 w-4" />
                {isSavingConfig ? 'Guardando...' : 'Guardar config'}
              </button>
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-slate-950/80 p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.35em] text-cyan-300/80">
              Uso
            </p>
            <ul className="mt-4 space-y-3 text-sm text-slate-300">
              <li>Define tono, limites y estilo del agente.</li>
              <li>La base de conocimiento viene de los documentos activos.</li>
              <li>Guardado directo en `crm_configs`.</li>
              <li>La configuracion del proveedor usa endpoint, modelo y API key.</li>
            </ul>
          </div>

          <div className="rounded-3xl border border-white/10 bg-slate-950/80 p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.35em] text-cyan-300/80">
              Estado
            </p>
            <p className="mt-4 text-sm text-slate-300">
              {hasPromptChanges || hasConfigChanges
                ? 'Tienes cambios sin guardar.'
                : 'Prompt, modelo y API key estan sincronizados.'}
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}
