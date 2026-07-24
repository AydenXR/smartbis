import { useEffect, useMemo, useState } from 'react'
import { FilePlus2, Save, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { DocumentSection, WorkspaceDocument } from '@/types/chat'

type DocumentDraft = {
  id: string | null
  section: DocumentSection
  title: string
  content: string
  isActive: boolean
  isNew: boolean
}

type DocumentsPanelProps = {
  documents: WorkspaceDocument[]
  isSaving: boolean
  isDeleting: boolean
  onCreate: (input: {
    section: DocumentSection
    title: string
    content: string
    isActive: boolean
  }) => Promise<WorkspaceDocument>
  onUpdate: (id: string, input: {
    title: string
    content: string
    isActive: boolean
  }) => Promise<WorkspaceDocument>
  onDelete: (id: string) => Promise<void>
}

const sections: Array<{ key: DocumentSection; label: string }> = [
  { key: 'general', label: 'General' },
  { key: 'cursos', label: 'Cursos' },
  { key: 'productos', label: 'Productos' },
]

function createEmptyDraft(section: DocumentSection): DocumentDraft {
  return {
    id: null,
    section,
    title: '',
    content: '',
    isActive: true,
    isNew: true,
  }
}

export default function DocumentsPanel({
  documents,
  isSaving,
  isDeleting,
  onCreate,
  onUpdate,
  onDelete,
}: DocumentsPanelProps) {
  const [activeSection, setActiveSection] = useState<DocumentSection>('general')
  const [draft, setDraft] = useState<DocumentDraft>(createEmptyDraft('general'))

  const documentsBySection = useMemo(
    () => ({
      general: documents.filter((document) => document.section === 'general'),
      cursos: documents.filter((document) => document.section === 'cursos'),
      productos: documents.filter((document) => document.section === 'productos'),
    }),
    [documents],
  )

  useEffect(() => {
    if (draft.isNew) {
      return
    }

    const selectedDocument = documents.find((document) => document.id === draft.id)

    if (!selectedDocument) {
      const nextDocument = documentsBySection[activeSection][0]
      setDraft(
        nextDocument
          ? {
              id: nextDocument.id,
              section: nextDocument.section,
              title: nextDocument.title,
              content: nextDocument.content,
              isActive: nextDocument.isActive,
              isNew: false,
            }
          : createEmptyDraft(activeSection),
      )
      return
    }

    setDraft({
      id: selectedDocument.id,
      section: selectedDocument.section,
      title: selectedDocument.title,
      content: selectedDocument.content,
      isActive: selectedDocument.isActive,
      isNew: false,
    })
  }, [activeSection, documents, documentsBySection, draft.id, draft.isNew])

  function selectDocument(document: WorkspaceDocument) {
    setActiveSection(document.section)
    setDraft({
      id: document.id,
      section: document.section,
      title: document.title,
      content: document.content,
      isActive: document.isActive,
      isNew: false,
    })
  }

  function startNewDocument(section: DocumentSection) {
    setActiveSection(section)
    setDraft(createEmptyDraft(section))
  }

  async function handleSave() {
    const title = draft.title.trim()
    const content = draft.content.trim()

    if (!title || !content) {
      return
    }

    if (draft.isNew) {
      const created = await onCreate({
        section: draft.section,
        title,
        content,
        isActive: draft.isActive,
      })
      selectDocument(created)
      return
    }

    if (!draft.id) {
      return
    }

    const updated = await onUpdate(draft.id, {
      title,
      content,
      isActive: draft.isActive,
    })

    selectDocument(updated)
  }

  async function handleDelete() {
    if (!draft.id || draft.isNew) {
      setDraft(createEmptyDraft(activeSection))
      return
    }

    await onDelete(draft.id)

    const remaining = documentsBySection[activeSection].filter((document) => document.id !== draft.id)
    const nextDocument = remaining[0]

    setDraft(
      nextDocument
        ? {
            id: nextDocument.id,
            section: nextDocument.section,
            title: nextDocument.title,
            content: nextDocument.content,
            isActive: nextDocument.isActive,
            isNew: false,
          }
        : createEmptyDraft(activeSection),
    )
  }

  return (
    <section className="flex h-full min-h-0 flex-col gap-5">
      <header className="flex flex-wrap items-start justify-between gap-4 rounded-3xl border border-white/10 bg-slate-950/80 p-6">
        <div className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-[0.35em] text-cyan-300/80">
            Documentos
          </p>
          <h2 className="font-display text-3xl font-semibold text-white">
            Base de conocimiento
          </h2>
          <p className="max-w-2xl text-sm text-slate-300">
            Administra documentos guardados en la base y separalos por General, Cursos y
            Productos.
          </p>
        </div>

        <div className="rounded-2xl border border-cyan-400/20 bg-cyan-400/10 px-4 py-3 text-sm text-cyan-100">
          {documents.length} documentos en total
        </div>
      </header>

      <div className="grid min-h-0 flex-1 gap-5 xl:grid-cols-[420px_minmax(0,1fr)]">
        <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-1">
          {sections.map((section) => {
            const items = documentsBySection[section.key]
            const isSelected = activeSection === section.key

            return (
              <div
                key={section.key}
                className={cn(
                  'rounded-3xl border p-4 transition',
                  isSelected
                    ? 'border-cyan-300/30 bg-slate-950/85'
                    : 'border-white/10 bg-slate-950/60',
                )}
              >
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-white">{section.label}</p>
                    <p className="text-xs text-slate-400">{items.length} documentos</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => startNewDocument(section.key)}
                    className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-slate-900 px-3 py-2 text-xs font-semibold text-slate-100 transition hover:border-cyan-300/40"
                  >
                    <FilePlus2 className="h-4 w-4" />
                    Nuevo
                  </button>
                </div>

                <div className="space-y-2">
                  {items.length === 0 ? (
                    <p className="rounded-2xl border border-dashed border-white/10 px-3 py-4 text-sm text-slate-400">
                      Sin documentos.
                    </p>
                  ) : (
                    items.map((document) => (
                      <button
                        key={document.id}
                        type="button"
                        onClick={() => selectDocument(document)}
                        className={cn(
                          'flex w-full items-center justify-between rounded-2xl border px-3 py-3 text-left text-sm transition',
                          draft.id === document.id && !draft.isNew
                            ? 'border-cyan-300/40 bg-cyan-500/10 text-white'
                            : 'border-white/10 bg-slate-900 text-slate-200 hover:border-cyan-300/30',
                        )}
                      >
                        <span className="truncate">{document.title}</span>
                        <span
                          className={cn(
                            'ml-3 text-[11px] font-semibold uppercase tracking-[0.2em]',
                            document.isActive ? 'text-cyan-300' : 'text-slate-500',
                          )}
                        >
                          {document.isActive ? 'On' : 'Off'}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              </div>
            )
          })}
        </div>

        <div className="flex min-h-[620px] flex-col overflow-hidden rounded-3xl border border-white/10 bg-slate-950/85">
          <div className="border-b border-white/10 px-5 py-4">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-400">
              Editor
            </p>
          </div>

          <div className="flex flex-1 flex-col gap-5 p-5">
            <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_180px]">
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-400">
                  Titulo
                </label>
                <input
                  value={draft.title}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      title: event.target.value,
                    }))
                  }
                  placeholder="Nombre del documento"
                  className="w-full rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-300/40"
                />
              </div>

              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-400">
                  Estado
                </label>
                <button
                  type="button"
                  onClick={() =>
                    setDraft((current) => ({
                      ...current,
                      isActive: !current.isActive,
                    }))
                  }
                  className={cn(
                    'w-full rounded-2xl border px-4 py-3 text-sm font-semibold transition',
                    draft.isActive
                      ? 'border-cyan-300/40 bg-cyan-500/10 text-cyan-100'
                      : 'border-white/10 bg-slate-900 text-slate-400',
                  )}
                >
                  {draft.isActive ? 'Activo' : 'Inactivo'}
                </button>
              </div>
            </div>

            <div className="flex flex-1 flex-col space-y-2">
              <label className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-400">
                Contenido
              </label>
              <textarea
                value={draft.content}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    content: event.target.value,
                  }))
                }
                placeholder="Pega aqui la informacion del documento"
                spellCheck={false}
                className="min-h-[380px] flex-1 resize-none rounded-2xl border border-white/10 bg-slate-900 px-4 py-4 font-mono text-sm leading-7 text-slate-100 outline-none transition focus:border-cyan-300/40"
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-slate-400">
                Seccion actual: <span className="text-slate-200">{draft.section}</span>
              </p>

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={isDeleting}
                  className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-sm font-semibold text-slate-100 transition hover:border-rose-300/40 hover:text-rose-200 disabled:cursor-not-allowed disabled:text-slate-500"
                >
                  <Trash2 className="h-4 w-4" />
                  {draft.isNew ? 'Descartar' : 'Eliminar'}
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={isSaving || !draft.title.trim() || !draft.content.trim()}
                  className="inline-flex items-center gap-2 rounded-2xl border border-cyan-300/40 bg-cyan-500 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-slate-800 disabled:text-slate-500"
                >
                  <Save className="h-4 w-4" />
                  {isSaving ? 'Guardando...' : draft.isNew ? 'Crear documento' : 'Guardar cambios'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
