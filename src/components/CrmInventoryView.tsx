import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Package,
  Search,
  Plus,
  RefreshCw,
  Pencil,
  Trash2,
  X,
  Barcode,
  Tag,
  DollarSign,
  MapPinHouse,
  AlertCircle,
  ChevronUp,
  ChevronDown,
  Upload,
  FileText,
  FolderDown,
  Check,
  ChevronRight,
  Sparkles,
  Download,
  FileSpreadsheet,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  type ItemKind,
  type PosBranch,
  type PosCatalogItem,
  type PosMdFileInfo,
  posBranches,
  posCatalog,
  posCatalogSave,
  posCatalogDelete,
  posCatalogAdjustStock,
  posCatalogSyncFromDocs,
  posDocsList,
  posDocsWrite,
  posDocsRead,
  posCatalogImport,
} from '@/lib/api'

type TabKind = 'all' | ItemKind

const tabs: Array<{ id: TabKind; label: string; icon?: string }> = [
  { id: 'all', label: 'Todos' },
  { id: 'product', label: '💊 Productos' },
  { id: 'service', label: '🔧 Servicios' },
  { id: 'course', label: '🎓 Cursos' },
  { id: 'menu_item', label: '🍕 Menú' },
]

function kindBadgeClass(k: ItemKind) {
  switch (k) {
    case 'product':
      return 'border-violet-400/30 bg-violet-500/15 text-violet-200'
    case 'service':
      return 'border-emerald-400/30 bg-emerald-500/15 text-emerald-200'
    case 'course':
      return 'border-amber-400/30 bg-amber-500/15 text-amber-200'
    case 'menu_item':
      return 'border-rose-400/30 bg-rose-500/15 text-rose-200'
  }
}
function kindLabel(k: ItemKind) {
  switch (k) {
    case 'product':
      return 'Producto'
    case 'service':
      return 'Servicio'
    case 'course':
      return 'Curso'
    case 'menu_item':
      return 'Menú'
  }
}
function docHintForKind(k: ItemKind): string {
  switch (k) {
    case 'product': return 'productos.md'
    case 'service': return 'servicios.md'
    case 'course': return 'cursos.md'
    case 'menu_item': return 'menu.md'
  }
}

type ModalMode = 'create' | 'edit' | null

type FormState = {
  id?: string
  kind: ItemKind
  sku: string
  name: string
  family: string
  category: string
  costPrice: string
  salePrice: string
  volumePriceTiers: Array<{ minQty: string; price: string }>
  location: string
  active: boolean
  writeToDoc: boolean
  targetDoc: string
}

const emptyForm: FormState = {
  kind: 'product',
  sku: '',
  name: '',
  family: '',
  category: '',
  costPrice: '',
  salePrice: '',
  volumePriceTiers: [],
  location: '',
  active: true,
  writeToDoc: true,
  targetDoc: 'productos.md',
}

type StockAdjust = {
  item: PosCatalogItem
  branchId: string
} | null

export default function CrmInventoryView() {
  const [items, setItems] = useState<PosCatalogItem[]>([])
  const [branches, setBranches] = useState<PosBranch[]>([])
  const [mdFiles, setMdFiles] = useState<PosMdFileInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [toast, setToast] = useState<string>('')
  const [tab, setTab] = useState<TabKind>('all')
  const [search, setSearch] = useState('')
  const [modalMode, setModalMode] = useState<ModalMode>(null)
  const [form, setForm] = useState<FormState>({ ...emptyForm })
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<PosCatalogItem | null>(null)
  const [stockAdjust, setStockAdjust] = useState<StockAdjust>(null)
  const [stockDelta, setStockDelta] = useState(1)
  const [stockReason, setStockReason] = useState('')
  const [savingStock, setSavingStock] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [importing, setImporting] = useState(false)

  // Import state
  const [importTargetDoc, setImportTargetDoc] = useState<string>('')
  const [importNewDocName, setImportNewDocName] = useState<string>('')
  const [importFileName, setImportFileName] = useState('')
  const [importPreview, setImportPreview] = useState<string>('')
  const [importModalOpen, setImportModalOpen] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Preview markdown doc modal
  const [previewDocName, setPreviewDocName] = useState<string | null>(null)
  const [previewDocContent, setPreviewDocContent] = useState<string>('')
  const [loadingPreview, setLoadingPreview] = useState(false)

  async function loadAll() {
    setLoading(true)
    setError('')
    try {
      const [cRes, bRes, docs] = await Promise.all([
        posCatalog({
          kinds: tab !== 'all' ? [tab] : undefined,
          search: search.trim() || undefined,
        }),
        posBranches(),
        posDocsList().catch(() => ({ files: [] })),
      ])
      setItems(cRes.items)
      setBranches(bRes.branches)
      setMdFiles(docs.files || [])
      if (importTargetDoc && docs.files?.length && !docs.files.find((f) => f.fileName === importTargetDoc)) {
        setImportTargetDoc('')
      }
    } catch (e: any) {
      setError(e?.message || 'No se pudieron cargar los datos')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function showToast(msg: string) {
    setToast(msg)
    window.setTimeout(() => setToast(''), 3500)
  }

  async function handleSync() {
    setSyncing(true)
    setError('')
    try {
      const r = await posCatalogSyncFromDocs()
      showToast(
        `Sincronización total: creados ${r.created.length}, actualizados ${r.updated.length}, omitidos ${r.skipped.length}`,
      )
      void loadAll()
    } catch (e: any) {
      setError(e?.message || 'No se pudo sincronizar')
    } finally {
      setSyncing(false)
    }
  }

  const [singleSyncDoc, setSingleSyncDoc] = useState<string>('')
  const [singleSyncing, setSingleSyncing] = useState(false)

  async function handleSingleSync() {
    if (!singleSyncDoc) {
      setError('Selecciona un documento (.md) para cargar su contenido al inventario')
      return
    }
    setSingleSyncing(true)
    setError('')
    try {
      const r = await posCatalogSyncFromDocs(singleSyncDoc)
      const total = r.created.length + r.updated.length
      if (total === 0 && r.skipped.length === 0) {
        showToast(`El documento "${singleSyncDoc}" está vacío o no contiene items reconocibles. Agrega productos/servicios y vuelve a intentar.`)
      } else {
        showToast(
          `Cargado desde ${singleSyncDoc}: creados ${r.created.length}, actualizados ${r.updated.length}, omitidos ${r.skipped.length}`,
        )
      }
      void loadAll()
    } catch (e: any) {
      setError(e?.message || 'No se pudo cargar el documento')
    } finally {
      setSingleSyncing(false)
    }
  }

  function openCreate() {
    setForm({
      ...emptyForm,
      targetDoc: mdFiles[0]?.fileName || importTargetDoc || 'productos.md',
      volumePriceTiers: [],
    })
    setModalMode('create')
  }

  function openEdit(it: PosCatalogItem) {
    setForm({
      id: it.id,
      kind: it.kind,
      sku: it.sku,
      name: it.name,
      family: it.family || '',
      category: it.category || '',
      costPrice: String(it.costPrice ?? ''),
      salePrice: String(it.salePrice),
      volumePriceTiers: (it.volumePriceTiers || []).map(t => ({ minQty: String(t.minQty), price: String(t.price) })),
      location: it.location || '',
      active: it.active,
      writeToDoc: true,
      targetDoc: it.sourceDocId || mdFiles[0]?.fileName || docHintForKind(it.kind),
    })
    setModalMode('edit')
  }

  function closeModal() {
    setModalMode(null)
    setForm({ ...emptyForm })
  }

  async function handleSave() {
    if (!form.name.trim() || !form.salePrice) return
    setSaving(true)
    setError('')
    try {
      const volumePriceTiers = form.volumePriceTiers
        .map((t) => ({
          minQty: Math.max(1, Math.floor(Number(t.minQty) || 0)),
          price: Number(t.price) || 0,
        }))
        .filter((t) => t.minQty >= 2 && t.price > 0)
        .sort((a, b) => a.minQty - b.minQty)
        .filter((t, i, arr) => arr.findIndex((x) => x.minQty === t.minQty) === i)
      const payload: any = {
        kind: form.kind,
        sku: form.sku.trim() || undefined,
        name: form.name.trim(),
        family: form.family.trim() || undefined,
        category: form.category.trim() || undefined,
        costPrice: form.costPrice ? Number(form.costPrice) : undefined,
        salePrice: Number(form.salePrice) || 0,
        volumePriceTiers: volumePriceTiers.length ? volumePriceTiers : [],
        location: form.location.trim() || undefined,
        active: form.active,
        syncToMdDoc: form.writeToDoc ? form.targetDoc || null : null,
        sourceDocId: form.writeToDoc ? form.targetDoc : undefined,
      }
      if (modalMode === 'edit' && form.id) payload.id = form.id
      await posCatalogSave(payload)
      closeModal()
      void loadAll()
    } catch (e: any) {
      setError(e?.message || 'No se pudo guardar')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!confirmDelete) return
    try {
      await posCatalogDelete(confirmDelete.id)
      setConfirmDelete(null)
      void loadAll()
    } catch (e: any) {
      setError(e?.message || 'No se pudo eliminar')
    }
  }

  function openStockAdjust(item: PosCatalogItem, branchId: string) {
    setStockAdjust({ item, branchId })
    setStockDelta(1)
    setStockReason('')
  }

  async function handleSaveStock() {
    if (!stockAdjust) return
    if (!stockDelta) return
    setSavingStock(true)
    try {
      const r = await posCatalogAdjustStock(
        stockAdjust.item.id,
        stockAdjust.branchId,
        stockDelta,
        stockReason.trim() || undefined,
      )
      showToast(
        `Stock ajustado. Nuevo stock en ${branches.find((b) => b.id === stockAdjust.branchId)?.name}: ${r.stock}`,
      )
      setStockAdjust(null)
      void loadAll()
    } catch (e: any) {
      setError(e?.message || 'No se pudo ajustar el stock')
    } finally {
      setSavingStock(false)
    }
  }

  // ====== IMPORT FILE ======
  async function onPickImportFile(ev: React.ChangeEvent<HTMLInputElement>) {
    const f = ev.target.files?.[0]
    if (!f) return
    setImportFileName(f.name)
    try {
      const buf = await f.arrayBuffer()
      const b64 = arrayBufferToBase64(buf)
      void b64
      const ext = f.name.toLowerCase().split('.').pop()
      if (ext === 'pdf') {
        // mostramos tamaño y extensión (no extraemos en front, lo hacemos en back)
        setImportPreview(`PDF · ${(f.size / 1024).toFixed(1)} KB\n\nLa extracción de tablas y texto se ejecutará en el servidor al confirmar Importar.`)
      } else if (ext === 'json' || ext === 'csv' || ext === 'tsv' || ext === 'txt') {
        const text = new TextDecoder('utf-8').decode(buf.slice(0, 8192))
        setImportPreview(text.slice(0, 800))
      } else {
        const text = new TextDecoder('utf-8', { fatal: false }).decode(buf.slice(0, 2048))
        setImportPreview(text.slice(0, 800) || '(vista previa no disponible)')
      }
    } catch {
      setImportPreview('(archivo binario, sin preview)')
    }
  }

  function openImportModal() {
    setImportTargetDoc('productos.md')
    setImportNewDocName('')
    setImportFileName('')
    setImportPreview('')
    if (fileInputRef.current) fileInputRef.current.value = ''
    setImportModalOpen(true)
  }
  function closeImportModal() {
    setImportModalOpen(false)
    setImporting(false)
  }

  async function handleCreateNewDocFromName(keepExtension = true) {
    let raw = (importNewDocName || '').trim()
    if (!raw) return false
    if (!keepExtension || !raw.toLowerCase().endsWith('.md')) raw = raw + '.md'
    const existing = mdFiles.find((f) => f.fileName === raw)
    if (!existing) {
      try {
        await posDocsWrite(raw, `# ${raw.replace(/\.md$/i, '')}\n\n`)
        showToast(`Documento nuevo creado: ${raw} (vacío). Agrega items al doc y pulsa "Cargar este doc" para que aparezcan en inventario.`)
        await loadAll()
        setSingleSyncDoc(raw)
      } catch (e: any) {
        setError(e?.message || 'No se pudo crear el documento')
        return false
      }
    }
    setImportTargetDoc(raw)
    setImportNewDocName('')
    return true
  }

  async function handleRunImport() {
    if (!importFileName) { setError('Selecciona un archivo para importar'); return }
    const f = fileInputRef.current?.files?.[0]
    if (!f) { setError('Archivo no disponible, vuelve a seleccionarlo'); return }
    // Si se escribió un nombre nuevo y no existe doc, crearlo primero
    let targetForImport = importTargetDoc
    if (importNewDocName.trim() && !targetForImport) {
      const ok = await handleCreateNewDocFromName(true)
      if (!ok) return
      targetForImport = importTargetDoc
    }
    if (!targetForImport) { setError('Selecciona un documento destino o crea uno nuevo (.md)'); return }
    setImporting(true)
    setError('')
    try {
      const b64 = arrayBufferToBase64(await f.arrayBuffer())
      const res = await posCatalogImport({
        fileName: importFileName,
        fileBase64: b64,
        targetDoc: targetForImport,
        writeBack: true,
      })
      if (res.count === 0) {
        const msg = (res as any).warning
          ? `⚠️ No se importó ningún producto. ${(res as any).warning}`
          : `⚠️ No se detectaron productos válidos en ${importFileName}. Revisa que tenga encabezados: Nombre (obligatorio) · Precio (obligatorio) · SKU · Costo · Stock · Familia · Categoría.`
        showToast(msg)
      } else {
        showToast(
          `Importado ${res.count} items → ${res.targetDoc}. Creados ${res.created.length}, actualizados ${res.updated.length}. Errores ${res.skipped.length}.`,
        )
      }
      setImportFileName('')
      setImportPreview('')
      setImportTargetDoc('')
      setImportNewDocName('')
      if (fileInputRef.current) fileInputRef.current.value = ''
      closeImportModal()
      void loadAll()
    } catch (e: any) {
      setError(e?.message || 'No se pudo importar')
    } finally {
      setImporting(false)
    }
  }

  // ====== PREVIEW DOC ======
  async function handlePreviewDoc(name: string) {
    setPreviewDocName(name)
    setLoadingPreview(true)
    setPreviewDocContent('')
    try {
      const r = await posDocsRead(name)
      setPreviewDocContent(r?.content || '(vacio)')
    } catch (e: any) {
      setPreviewDocContent(`Error: ${e?.message || 'no se pudo leer'}`)
    } finally {
      setLoadingPreview(false)
    }
  }

  async function handleExportItemsAsDoc(targetName?: string) {
    const t = targetName || (tab === 'all' ? 'catalogo-completo.md' : docHintForKind(tab as ItemKind))
    if (!t) return
    const list = filteredItems
    const head = `# ${t.replace(/\.md$/i, '')} · ${list.length} items\n\nGenerado ${new Date().toLocaleString()}\n\n`
    const body = list.map((it) => renderItemBlockPlain(it, branches)).join('\n\n')
    try {
      await posDocsWrite(t, head + body + '\n')
      showToast(`Exportados ${list.length} items → ${t}`)
      void loadAll()
    } catch (e: any) {
      setError(e?.message || 'No se pudo exportar')
    }
  }

  async function handleExportExcel() {
    setError('')
    try {
      const token = window.localStorage.getItem('smartbis.auth.token') || ''
      const params = new URLSearchParams()
      if (tab !== 'all') params.set('kinds', tab)
      if (search.trim()) params.set('search', search.trim())
      const qs = params.toString()
      const url = `/api/pos/catalog/export.xlsx${qs ? `?${qs}` : ''}`
      const resp = await fetch(url, {
        method: 'GET',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      if (!resp.ok) {
        const txt = await resp.text().catch(() => '')
        let msg = 'No se pudo descargar el Excel'
        try { const j = JSON.parse(txt); if (j?.error) msg = j.error } catch { /* ignore */ }
        throw new Error(msg)
      }
      const blob = await resp.blob()
      const disposition = resp.headers.get('Content-Disposition') || ''
      let fileName = ''
      const m = /filename[^;=\n]*=\s*"?([^";\n]+)"?/i.exec(disposition)
      if (m) fileName = decodeURIComponent(m[1])
      if (!fileName) {
        const today = new Date()
        const dd = String(today.getDate()).padStart(2, '0')
        const mm = String(today.getMonth() + 1).padStart(2, '0')
        const yy = String(today.getFullYear()).slice(-2)
        fileName = `EXISTENCIA AL DÍA ${dd}-${mm}-${yy}.xlsx`
      }
      const a = document.createElement('a')
      const objUrl = URL.createObjectURL(blob)
      a.href = objUrl
      a.download = fileName
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(objUrl), 1500)
      showToast(`Excel generado correctamente: ${fileName} (${filteredItems.length} items)`)
    } catch (e: any) {
      setError(e?.message || 'No se pudo exportar Excel')
    }
  }

  // ===============

  const filteredItems = useMemo(() => {
    let list = items
    if (tab !== 'all') list = list.filter((i) => i.kind === tab)
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter(
        (i) =>
          i.name.toLowerCase().includes(q) ||
          i.sku.toLowerCase().includes(q) ||
          (i.family || '').toLowerCase().includes(q) ||
          (i.category || '').toLowerCase().includes(q),
      )
    }
    return list
  }, [items, tab, search])

  function stockCellClass(stock: number, kind: ItemKind) {
    if (kind === 'service' || kind === 'course') return 'text-slate-400'
    if (stock <= 0) return 'text-rose-300/80 line-through'
    if (stock <= 3) return 'text-rose-400 font-bold'
    return 'text-slate-200'
  }

  return (
    <section className="flex min-h-0 w-full flex-col overflow-hidden bg-[#0c2a47] px-6 py-6 text-white">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-[16px] bg-[#1090D0]/15 text-[#5bbfe5]">
            <Package className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-[22px] font-bold tracking-tight text-slate-50">
              Inventario · Catálogo
            </h2>
            <span className="rounded-full border border-[#1090D0]/40 bg-[#1090D0]/10 px-2.5 py-0.5 text-[10.5px] font-bold uppercase tracking-wider text-[#5bbfe5]">
              Importar / Exportar · docs .md
            </span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {error ? (
            <div className="flex items-center gap-2 rounded-[14px] border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-[11.5px] text-rose-200">
              <AlertCircle className="h-3.5 w-3.5" />
              {error}
            </div>
          ) : null}
          <button
            type="button"
            onClick={() => void loadAll()}
            disabled={loading}
            className="flex h-9 items-center gap-2 rounded-[14px] border border-[#1a3a5a] bg-[#11375a] px-3.5 text-[12px] font-semibold text-slate-200 transition hover:border-[#1090D0]/40 disabled:opacity-50"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
            Refrescar
          </button>
          <button
            type="button"
            onClick={() => void handleSync()}
            disabled={syncing}
            className="flex h-9 items-center gap-2 rounded-[14px] border border-[#1090D0]/40 bg-[#1090D0]/10 px-3.5 text-[12px] font-semibold text-[#5bbfe5] transition hover:bg-[#1090D0]/20 disabled:opacity-50"
            title="Lee TODOS los documentos .md del tenant y carga/sincroniza items al inventario (el de arriba es SOLO el seleccionado)."
          >
            <RefreshCw className={cn('h-3.5 w-3.5', syncing && 'animate-spin')} />
            Sincronizar TODOS los documentos
          </button>
          <button
            type="button"
            onClick={() => void handleExportExcel()}
            className="flex h-9 items-center gap-2 rounded-[14px] border border-sky-500/40 bg-sky-500/10 px-3.5 text-[12px] font-bold text-sky-300 transition hover:bg-sky-500/20 hover:text-white"
          >
            <FileSpreadsheet className="h-3.5 w-3.5" />
            Descargar Excel
          </button>
          <button
            type="button"
            onClick={openImportModal}
            className="flex h-9 items-center gap-2 rounded-[14px] border border-emerald-500/40 bg-emerald-500/10 px-3.5 text-[12px] font-bold text-emerald-300 transition hover:bg-emerald-500/20 hover:text-white"
          >
            <Upload className="h-3.5 w-3.5" />
            Importar productos
          </button>
          <button
            type="button"
            onClick={openCreate}
            className="flex h-9 items-center gap-2 rounded-[14px] bg-[#1090D0] px-4 text-[12px] font-bold text-white transition hover:bg-[#0c79ae]"
          >
            <Plus className="h-4 w-4" />
            Nuevo item
          </button>
        </div>
      </header>

      {/* IMPORT PANEL removido (ahora es modal) */}

      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-[20px] border border-[#1a3a5a] bg-[#0f3151] p-3">
        <div className="flex items-center gap-1 rounded-[14px] border border-[#1a3a5a] bg-[#0b2641] p-1">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                setTab(t.id)
                void loadAll()
              }}
              className={cn(
                'rounded-[10px] px-3.5 py-2 text-[12px] font-semibold transition whitespace-nowrap',
                tab === t.id
                  ? 'bg-[#1090D0] text-white shadow-inner'
                  : 'text-slate-300 hover:text-white',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex-1 min-w-[240px]">
          <div className="flex items-center gap-2 rounded-[14px] border border-[#1a3a5a] bg-[#0b2641] px-3 py-2.5 focus-within:border-[#1090D0]/50">
            <Search className="h-4 w-4 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void loadAll()
              }}
              placeholder="Buscar por nombre, SKU, familia, categoría..."
              className="flex-1 bg-transparent text-[13.5px] text-slate-100 placeholder:text-slate-500 focus:outline-none"
            />
          </div>
        </div>

        <div className="rounded-[12px] border border-[#1a3a5a] bg-[#0b2641]/60 px-3 py-1.5 text-[11.5px] text-slate-300">
          {filteredItems.length} items
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-[20px] border border-[#1a3a5a] bg-[#0f3151]">
        {loading && filteredItems.length === 0 ? (
          <div className="flex items-center justify-center py-12 text-[12.5px] text-slate-400">
            <RefreshCw className="mr-2 h-4 w-4 animate-spin text-[#1090D0]" />
            Cargando catálogo...
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="py-16 text-center text-[12.5px] text-slate-400">
            No hay artículos en el catálogo. Puedes <span className="font-semibold text-[#5bbfe5]">importar desde CSV/JSON</span> o crear uno nuevo.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead className="sticky top-0 z-10 border-b border-[#1a3a5a] bg-[#0b2641]/90 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400 backdrop-blur">
                <tr>
                  <th className="px-4 py-3">SKU</th>
                  <th className="px-4 py-3">Tipo</th>
                  <th className="px-4 py-3">Nombre</th>
                  <th className="px-4 py-3">Familia</th>
                  <th className="px-4 py-3 whitespace-nowrap">Doc fuente</th>
                  <th className="px-4 py-3 text-right">Costo</th>
                  <th className="px-4 py-3 text-right">Precio Venta</th>
                  {branches.map((b) => (
                    <th key={b.id} className="px-4 py-3 text-right whitespace-nowrap">
                      Stock {b.name.length > 14 ? `${b.name.slice(0, 14)}…` : b.name}
                    </th>
                  ))}
                  <th className="px-4 py-3 text-center">Activo</th>
                  <th className="px-4 py-3 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {filteredItems.map((it) => (
                  <tr
                    key={it.id}
                    className="border-b border-[#1a3a5a]/40 last:border-0 hover:bg-[#11375a]/40"
                  >
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1.5 rounded-[10px] bg-[#0b2641] px-2 py-1 font-mono text-[11.5px] text-slate-200">
                        <Barcode className="h-3 w-3 text-slate-400" />
                        {it.sku || '—'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={cn(
                          'inline-flex rounded-full border px-2.5 py-1 text-[10.5px] font-bold uppercase tracking-wider',
                          kindBadgeClass(it.kind),
                        )}
                      >
                        {kindLabel(it.kind)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-100">{it.name}</div>
                      {it.category ? (
                        <div className="text-[11px] text-slate-400">{it.category}</div>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-slate-300">
                      {it.family ? (
                        <span className="inline-flex items-center gap-1.5 rounded-[10px] bg-[#0b2641]/60 px-2 py-1 text-[11.5px]">
                          <Tag className="h-3 w-3 text-slate-400" />
                          {it.family}
                        </span>
                      ) : (
                        <span className="text-slate-500">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {it.sourceDocId ? (
                        <button
                          type="button"
                          onClick={() => handlePreviewDoc(it.sourceDocId!)}
                          className="inline-flex items-center gap-1.5 rounded-[10px] border border-[#1090D0]/30 bg-[#1090D0]/10 px-2 py-1 text-[11px] font-semibold text-[#5bbfe5] transition hover:bg-[#1090D0]/25"
                        >
                          <FileText className="h-3 w-3" />
                          {it.sourceDocId}
                        </button>
                      ) : (
                        <span className="text-slate-500 text-[11.5px]">Sin doc</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-slate-300">
                      {it.costPrice !== undefined && it.costPrice !== null
                        ? `$${Number(it.costPrice).toFixed(2)}`
                        : <span className="text-slate-500">—</span>}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="font-mono font-semibold text-[#5bbfe5]">
                        ${Number(it.salePrice).toFixed(2)}
                      </span>
                    </td>
                    {branches.map((b) => {
                      const stock = it.stocks?.[b.id] ?? 0
                      return (
                        <td key={b.id} className="px-4 py-3 text-right">
                          <button
                            type="button"
                            onClick={() => openStockAdjust(it, b.id)}
                            className={cn(
                              'inline-flex min-w-[56px] items-center justify-end gap-1 rounded-[10px] bg-[#0b2641]/60 px-2.5 py-1 font-mono text-[12.5px] transition hover:ring-1 hover:ring-[#1090D0]/50',
                              stockCellClass(stock, it.kind),
                            )}
                            title="Clic para ajustar stock"
                          >
                            {stock}
                          </button>
                        </td>
                      )
                    })}
                    <td className="px-4 py-3 text-center">
                      <span
                        className={cn(
                          'inline-flex h-2.5 w-2.5 rounded-full',
                          it.active ? 'bg-emerald-400 shadow-[0_0_0_4px_rgba(52,211,153,0.15)]' : 'bg-slate-500',
                        )}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => openEdit(it)}
                          className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#1a3a5a] bg-[#0b2641] text-slate-300 transition hover:border-[#1090D0]/40 hover:text-[#5bbfe5]"
                          title="Editar"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDelete(it)}
                          className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#1a3a5a] bg-[#0b2641] text-slate-300 transition hover:border-rose-500/40 hover:bg-rose-500/10 hover:text-rose-300"
                          title="Eliminar (también borra del .md si estaba asociado)"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {toast ? (
        <div className="pointer-events-none fixed bottom-6 left-1/2 z-[100] -translate-x-1/2 rounded-[16px] border border-emerald-400/30 bg-emerald-500/90 px-4 py-2.5 text-[12.5px] font-semibold text-white shadow-xl shadow-black/30">
          {toast}
        </div>
      ) : null}

      {modalMode ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm">
          <div className="w-full max-w-2xl overflow-hidden rounded-[20px] border border-[#1a3a5a] bg-[#0f3151] shadow-2xl shadow-black/50">
            <div className="flex items-center justify-between border-b border-[#1a3a5a] px-5 py-4">
              <h3 className="text-[16px] font-bold text-slate-50">
                {modalMode === 'create' ? 'Nuevo artículo' : 'Editar artículo'}
              </h3>
              <button
                type="button"
                onClick={closeModal}
                className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-400 transition hover:bg-[#0b2641] hover:text-slate-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4 p-5 max-h-[72vh] overflow-y-auto">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-[11.5px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                    Tipo
                  </label>
                  <div className="rounded-[14px] border border-[#1a3a5a] bg-[#0b2641] p-1.5">
                    <select
                      value={form.kind}
                      onChange={(e) => setForm({
                        ...form,
                        kind: e.target.value as ItemKind,
                        targetDoc: docHintForKind(e.target.value as ItemKind),
                      })}
                      className="w-full bg-transparent px-2 py-1.5 text-[13.5px] text-slate-100 focus:outline-none"
                    >
                      <option value="product" className="bg-[#0f3151]">💊 Producto</option>
                      <option value="service" className="bg-[#0f3151]">🔧 Servicio</option>
                      <option value="course" className="bg-[#0f3151]">🎓 Curso</option>
                      <option value="menu_item" className="bg-[#0f3151]">🍕 Menú</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="mb-1.5 block text-[11.5px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                    SKU
                  </label>
                  <div className="flex items-center gap-2 rounded-[14px] border border-[#1a3a5a] bg-[#0b2641] px-3 py-2.5 focus-within:border-[#1090D0]/50">
                    <Barcode className="h-4 w-4 text-slate-400" />
                    <input
                      type="text"
                      value={form.sku}
                      onChange={(e) => setForm({ ...form, sku: e.target.value })}
                      placeholder="SKU-0001"
                      className="flex-1 bg-transparent font-mono text-[13.5px] text-slate-100 placeholder:text-slate-500 focus:outline-none"
                    />
                  </div>
                </div>

                <div className="sm:col-span-2">
                  <label className="mb-1.5 block text-[11.5px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                    Nombre *
                  </label>
                  <div className="flex items-center gap-2 rounded-[14px] border border-[#1a3a5a] bg-[#0b2641] px-3 py-2.5 focus-within:border-[#1090D0]/50">
                    <Tag className="h-4 w-4 text-slate-400" />
                    <input
                      type="text"
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      placeholder="Nombre del artículo"
                      className="flex-1 bg-transparent text-[13.5px] text-slate-100 placeholder:text-slate-500 focus:outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label className="mb-1.5 block text-[11.5px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                    Familia
                  </label>
                  <div className="rounded-[14px] border border-[#1a3a5a] bg-[#0b2641] px-3 py-2.5 focus-within:border-[#1090D0]/50">
                    <input
                      type="text"
                      value={form.family}
                      onChange={(e) => setForm({ ...form, family: e.target.value })}
                      placeholder="Ej. Medicamentos"
                      className="w-full bg-transparent text-[13.5px] text-slate-100 placeholder:text-slate-500 focus:outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label className="mb-1.5 block text-[11.5px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                    Categoría
                  </label>
                  <div className="rounded-[14px] border border-[#1a3a5a] bg-[#0b2641] px-3 py-2.5 focus-within:border-[#1090D0]/50">
                    <input
                      type="text"
                      value={form.category}
                      onChange={(e) => setForm({ ...form, category: e.target.value })}
                      placeholder="Ej. Genéricos"
                      className="w-full bg-transparent text-[13.5px] text-slate-100 placeholder:text-slate-500 focus:outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label className="mb-1.5 block text-[11.5px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                    Precio costo
                  </label>
                  <div className="flex items-center gap-2 rounded-[14px] border border-[#1a3a5a] bg-[#0b2641] px-3 py-2.5 focus-within:border-[#1090D0]/50">
                    <DollarSign className="h-4 w-4 text-slate-400" />
                    <input
                      type="number"
                      step="0.01"
                      min={0}
                      value={form.costPrice}
                      onChange={(e) => setForm({ ...form, costPrice: e.target.value })}
                      placeholder="0.00"
                      className="flex-1 bg-transparent font-mono text-[13.5px] text-slate-100 placeholder:text-slate-500 focus:outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label className="mb-1.5 block text-[11.5px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                    Precio venta *
                  </label>
                  <div className="flex items-center gap-2 rounded-[14px] border border-[#1a3a5a] bg-[#0b2641] px-3 py-2.5 focus-within:border-[#1090D0]/50">
                    <DollarSign className="h-4 w-4 text-[#5bbfe5]" />
                    <input
                      type="number"
                      step="0.01"
                      min={0}
                      value={form.salePrice}
                      onChange={(e) => setForm({ ...form, salePrice: e.target.value })}
                      placeholder="0.00"
                      className="flex-1 bg-transparent font-mono font-semibold text-[13.5px] text-slate-100 placeholder:text-slate-500 focus:outline-none"
                    />
                  </div>
                </div>

                <div className="sm:col-span-2">
                  <div className="mb-1.5 flex items-center justify-between">
                    <label className="flex items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                      <Sparkles className="h-3.5 w-3.5 text-amber-300" />
                      Precios por volumen (promociones por cantidad)
                    </label>
                    <button
                      type="button"
                      onClick={() => setForm({
                        ...form,
                        volumePriceTiers: [...form.volumePriceTiers, { minQty: '2', price: String(Number(form.salePrice || 0) * 0.9 || 0) }],
                      })}
                      className="inline-flex items-center gap-1 rounded-full border border-[#1090D0]/40 bg-[#1090D0]/10 px-2.5 py-1 text-[10.5px] font-bold uppercase tracking-wider text-[#7fd2ff] hover:bg-[#1090D0]/20"
                    >
                      <Plus className="h-3 w-3" /> Agregar nivel
                    </button>
                  </div>
                  <div className="rounded-[14px] border border-[#1a3a5a] bg-[#0b2641] p-3">
                    <div className="grid grid-cols-[auto_1fr_1fr_auto] gap-2 items-center text-[10.5px] font-extrabold uppercase tracking-widest text-slate-400 px-2 pb-2 border-b border-[#1a3a5a]">
                      <span className="w-6 text-center">#</span>
                      <span>Desde pzs</span>
                      <span>Precio c/u</span>
                      <span className="w-9"></span>
                    </div>
                    {form.volumePriceTiers.length === 0 ? (
                      <div className="px-2 py-6 text-center rounded-xl border border-dashed border-[#25507c] bg-white/[0.02] my-2">
                        <p className="text-[11.5px] text-slate-400 leading-relaxed">
                          Aún no hay promociones por cantidad.<br />
                          <span className="text-slate-300 font-semibold">Ejemplo:</span> 3+ pzs = $830 c/u · 5+ pzs = $790 c/u · 10+ pzs = $720 c/u.
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-1.5 pt-2">
                        {[...form.volumePriceTiers]
                          .map((t, i) => ({ t, i }))
                          .sort((a, b) => (Number(a.t.minQty) || 0) - (Number(b.t.minQty) || 0))
                          .map(({ t, i: _origIdx }, displayIdx) => {
                            const basePrice = Number(form.salePrice) || 0
                            const qty = Math.max(2, Math.floor(Number(t.minQty) || 0))
                            const pu = Number(t.price) || 0
                            const pct = basePrice > 0 ? Math.max(0, Math.round((1 - pu / basePrice) * 100)) : 0
                            return (
                              <div key={_origIdx} className="grid grid-cols-[auto_1fr_1fr_auto] gap-2 items-center">
                                <span className="w-6 text-center text-[12px] font-mono font-bold text-slate-500">{displayIdx + 1}</span>
                                <div className="flex items-center gap-2 rounded-[12px] border border-[#1a3a5a] bg-[#0f3151] px-2.5 py-2 focus-within:border-[#1090D0]/50">
                                  <Package className="h-3.5 w-3.5 text-slate-400" />
                                  <input
                                    type="number"
                                    min={2}
                                    step={1}
                                    value={t.minQty}
                                    onChange={(e) => {
                                      const next = [...form.volumePriceTiers]
                                      next[_origIdx] = { ...next[_origIdx], minQty: e.target.value }
                                      setForm({ ...form, volumePriceTiers: next })
                                    }}
                                    placeholder="3"
                                    className="flex-1 bg-transparent font-mono text-[12.5px] text-slate-100 focus:outline-none w-20"
                                  />
                                  <span className="text-[10.5px] text-slate-500 font-bold">pzs+</span>
                                </div>
                                <div className="flex items-center gap-2 rounded-[12px] border border-[#1a3a5a] bg-[#0f3151] px-2.5 py-2 focus-within:border-[#1090D0]/50">
                                  <DollarSign className={cn('h-3.5 w-3.5', pct > 0 ? 'text-emerald-300' : 'text-slate-400')} />
                                  <input
                                    type="number"
                                    min={0}
                                    step="0.01"
                                    value={t.price}
                                    onChange={(e) => {
                                      const next = [...form.volumePriceTiers]
                                      next[_origIdx] = { ...next[_origIdx], price: e.target.value }
                                      setForm({ ...form, volumePriceTiers: next })
                                    }}
                                    placeholder="0.00"
                                    className="flex-1 bg-transparent font-mono text-[12.5px] font-semibold text-slate-100 focus:outline-none"
                                  />
                                  {pct > 0 && qty >= 2 ? (
                                    <span className="inline-flex items-center rounded-full border border-emerald-400/30 bg-emerald-400/10 px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wider text-emerald-200 whitespace-nowrap">
                                      -{pct}%
                                    </span>
                                  ) : null}
                                </div>
                                <button
                                  type="button"
                                  onClick={() => {
                                    const next = form.volumePriceTiers.filter((_, idx) => idx !== _origIdx)
                                    setForm({ ...form, volumePriceTiers: next })
                                  }}
                                  className="flex h-9 w-9 items-center justify-center rounded-[12px] border border-rose-500/20 bg-rose-500/5 text-rose-300 hover:bg-rose-500/15"
                                  title="Borrar nivel"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            )
                          })}
                      </div>
                    )}
                    <p className="mt-3 rounded-xl border border-[#1a3a5a] bg-white/[0.02] px-3 py-2 text-[10.5px] leading-relaxed text-slate-400">
                      📌 En el <span className="font-bold text-[#7fd2ff]">Punto de Venta</span> se aplica el nivel con la cantidad más alta que alcance la línea.
                      Si cambias el Precio Venta, los niveles guardados <span className="font-bold text-slate-200">no cambian automáticamente</span>.
                    </p>
                  </div>
                </div>

                <div className="sm:col-span-2">
                  <label className="mb-1.5 block text-[11.5px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                    Ubicación
                  </label>
                  <div className="flex items-center gap-2 rounded-[14px] border border-[#1a3a5a] bg-[#0b2641] px-3 py-2.5 focus-within:border-[#1090D0]/50">
                    <MapPinHouse className="h-4 w-4 text-slate-400" />
                    <input
                      type="text"
                      value={form.location}
                      onChange={(e) => setForm({ ...form, location: e.target.value })}
                      placeholder="Ej. Anaquel B-3"
                      className="flex-1 bg-transparent text-[13.5px] text-slate-100 placeholder:text-slate-500 focus:outline-none"
                    />
                  </div>
                </div>

                <div className="sm:col-span-2 rounded-[14px] border border-[#1090D0]/30 bg-[#1090D0]/10 px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <label className="flex cursor-pointer items-center gap-2.5">
                      <button
                        type="button"
                        onClick={() => setForm({ ...form, writeToDoc: !form.writeToDoc })}
                        className={cn(
                          'relative inline-flex h-6 w-11 items-center rounded-full transition',
                          form.writeToDoc ? 'bg-[#1090D0]' : 'bg-slate-600/60',
                        )}
                      >
                        <span
                          className={cn(
                            'inline-block h-5 w-5 transform rounded-full bg-white shadow-md transition',
                            form.writeToDoc ? 'translate-x-5' : 'translate-x-0.5',
                          )}
                        />
                      </button>
                      <div>
                        <div className="text-[12px] font-bold text-white">
                          Guardar también como texto plano en documento
                        </div>
                        <div className="text-[11px] text-slate-400">
                          {form.writeToDoc ? `Se escribirá en: ${form.targetDoc || docHintForKind(form.kind)}` : 'Solo se guarda en el catálogo'}
                        </div>
                      </div>
                    </label>
                    {form.writeToDoc ? (
                      <div className="flex min-w-[220px] flex-1 items-center gap-2 rounded-[12px] border border-[#1a3a5a] bg-[#0b2641] px-3 py-2">
                        <FileText className="h-4 w-4 text-[#5bbfe5]" />
                        <select
                          value={form.targetDoc}
                          onChange={(e) => setForm({ ...form, targetDoc: e.target.value })}
                          className="flex-1 bg-transparent text-[12.5px] font-semibold text-slate-100 focus:outline-none"
                        >
                          {mdFiles.length === 0 ? (
                            <option value={docHintForKind(form.kind)} className="bg-[#0f3151]">
                              {docHintForKind(form.kind)} (se crea)
                            </option>
                          ) : (
                            mdFiles.map((f) => (
                              <option key={f.fileName} value={f.fileName} className="bg-[#0f3151]">
                                {f.fileName}
                              </option>
                            ))
                          )}
                        </select>
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="sm:col-span-2">
                  <label className="mb-1.5 flex items-center justify-between rounded-[14px] border border-[#1a3a5a] bg-[#0b2641] px-3 py-2.5">
                    <span className="text-[11.5px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                      Activo
                    </span>
                    <button
                      type="button"
                      onClick={() => setForm({ ...form, active: !form.active })}
                      className={cn(
                        'relative inline-flex h-6 w-11 items-center rounded-full transition',
                        form.active ? 'bg-[#1090D0]' : 'bg-slate-600/60',
                      )}
                    >
                      <span
                        className={cn(
                          'inline-block h-5 w-5 transform rounded-full bg-white shadow-md transition',
                          form.active ? 'translate-x-5' : 'translate-x-0.5',
                        )}
                      />
                    </button>
                  </label>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[#1a3a5a] px-5 py-4">
              <button
                type="button"
                onClick={closeModal}
                className="rounded-[14px] border border-[#1a3a5a] bg-[#11375a] px-4 py-2 text-[12.5px] font-semibold text-slate-200 transition hover:border-[#1090D0]/40 hover:text-white"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={saving || !form.name.trim() || !form.salePrice}
                onClick={() => void handleSave()}
                className={cn(
                  'rounded-[14px] px-5 py-2 text-[12.5px] font-bold text-white transition',
                  saving || !form.name.trim() || !form.salePrice
                    ? 'bg-[#1090D0]/50 opacity-60'
                    : 'bg-[#1090D0] hover:bg-[#0c79ae]',
                )}
              >
                {saving
                  ? 'Guardando...'
                  : modalMode === 'create'
                  ? (form.writeToDoc ? 'Crear + agregar a doc' : 'Crear artículo')
                  : (form.writeToDoc ? 'Guardar + actualizar doc' : 'Guardar cambios')}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {confirmDelete ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md overflow-hidden rounded-[20px] border border-[#1a3a5a] bg-[#0f3151] shadow-2xl shadow-black/50">
            <div className="p-5">
              <div className="flex items-start gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] bg-rose-500/15 text-rose-300">
                  <Trash2 className="h-6 w-6" />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="text-[15.5px] font-bold text-slate-50">Eliminar artículo</h3>
                  <p className="mt-1.5 text-[12.5px] leading-relaxed text-slate-300">
                    Se eliminará permanentemente{' '}
                    <span className="font-semibold text-white">{confirmDelete.name}</span> del catálogo
                    {confirmDelete.sourceDocId ? (
                      <> y su bloque de texto en{' '}
                      <span className="font-semibold text-[#5bbfe5]">{confirmDelete.sourceDocId}</span>
                      </>
                    ) : null}.
                  </p>
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[#1a3a5a] px-5 py-4">
              <button
                type="button"
                onClick={() => setConfirmDelete(null)}
                className="rounded-[14px] border border-[#1a3a5a] bg-[#11375a] px-4 py-2 text-[12.5px] font-semibold text-slate-200 transition hover:border-[#1090D0]/40 hover:text-white"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void handleDelete()}
                className="rounded-[14px] border border-rose-500/30 bg-rose-500 px-4 py-2 text-[12.5px] font-bold text-white transition hover:bg-rose-600"
              >
                <span className="inline-flex items-center gap-1.5">
                  <Trash2 className="h-4 w-4" />
                  Eliminar
                </span>
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {stockAdjust ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md overflow-hidden rounded-[20px] border border-[#1a3a5a] bg-[#0f3151] shadow-2xl shadow-black/50">
            <div className="flex items-center justify-between border-b border-[#1a3a5a] px-5 py-4">
              <div>
                <h3 className="text-[15.5px] font-bold text-slate-50">Ajuste de stock</h3>
                <p className="mt-0.5 text-[11.5px] text-slate-400">
                  {stockAdjust.item.name} · {branches.find((b) => b.id === stockAdjust.branchId)?.name}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setStockAdjust(null)}
                className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-400 transition hover:bg-[#0b2641] hover:text-slate-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4 p-5">
              <div>
                <label className="mb-1.5 block text-[11.5px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                  Ajuste
                </label>
                <div className="flex items-stretch gap-2">
                  <button
                    type="button"
                    onClick={() => setStockDelta((v) => v - 1)}
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] border border-rose-500/30 bg-rose-500/15 text-rose-200 transition hover:bg-rose-500/25"
                  >
                    <ChevronDown className="h-5 w-5" />
                  </button>
                  <div className="flex flex-1 items-center justify-center rounded-[14px] border border-[#1a3a5a] bg-[#0b2641]">
                    <span
                      className={cn(
                        'font-mono text-[22px] font-bold',
                        stockDelta < 0 ? 'text-rose-300' : stockDelta > 0 ? 'text-emerald-300' : 'text-slate-300',
                      )}
                    >
                      {stockDelta > 0 ? '+' : ''}
                      {stockDelta}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setStockDelta((v) => v + 1)}
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] border border-emerald-500/30 bg-emerald-500/15 text-emerald-200 transition hover:bg-emerald-500/25"
                  >
                    <ChevronUp className="h-5 w-5" />
                  </button>
                </div>
                <div className="mt-2 grid grid-cols-4 gap-1.5">
                  {[-10, -1, 1, 10].map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setStockDelta(n)}
                      className={cn(
                        'rounded-[10px] px-2 py-1.5 font-mono text-[11.5px] font-bold transition',
                        n < 0
                          ? 'border border-rose-500/20 bg-rose-500/10 text-rose-200 hover:bg-rose-500/20'
                          : 'border border-emerald-500/20 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20',
                      )}
                    >
                      {n > 0 ? '+' : ''}
                      {n}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-[11.5px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                  Motivo
                </label>
                <div className="rounded-[14px] border border-[#1a3a5a] bg-[#0b2641] px-3 py-2.5 focus-within:border-[#1090D0]/50">
                  <input
                    type="text"
                    value={stockReason}
                    onChange={(e) => setStockReason(e.target.value)}
                    placeholder="Ej. Conteo físico, merma, recepción..."
                    className="w-full bg-transparent text-[13.5px] text-slate-100 placeholder:text-slate-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="rounded-[14px] border border-[#1a3a5a] bg-[#0b2641]/50 px-4 py-3 text-[12px] text-slate-300">
                Stock actual:{' '}
                <span className="font-mono font-semibold text-slate-100">
                  {stockAdjust.item.stocks?.[stockAdjust.branchId] ?? 0}
                </span>
                {' · '}
                Resultado:{' '}
                <span className="font-mono font-bold text-[#5bbfe5]">
                  {Math.max(0, (stockAdjust.item.stocks?.[stockAdjust.branchId] ?? 0) + stockDelta)}
                </span>
                <div className="mt-1.5 text-[10.5px] text-slate-500">
                  Al confirmar se actualizará también el documento .md asociado ({stockAdjust.item.sourceDocId || docHintForKind(stockAdjust.item.kind)}).
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[#1a3a5a] px-5 py-4">
              <button
                type="button"
                onClick={() => setStockAdjust(null)}
                className="rounded-[14px] border border-[#1a3a5a] bg-[#11375a] px-4 py-2 text-[12.5px] font-semibold text-slate-200 transition hover:border-[#1090D0]/40 hover:text-white"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void handleSaveStock()}
                disabled={savingStock || stockDelta === 0}
                className={cn(
                  'rounded-[14px] px-5 py-2 text-[12.5px] font-bold text-white transition',
                  savingStock || stockDelta === 0
                    ? 'bg-[#1090D0]/50 opacity-60'
                    : 'bg-[#1090D0] hover:bg-[#0c79ae]',
                )}
              >
                {savingStock ? (
                  <span className="inline-flex items-center gap-2">
                    <RefreshCw className="h-4 w-4 animate-spin" /> Guardando...
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5">
                    <Check className="h-4 w-4" /> Aplicar ajuste
                  </span>
                )}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Preview doc modal */}
      {previewDocName ? (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm">
          <div className="w-full max-w-4xl overflow-hidden rounded-[20px] border border-[#1a3a5a] bg-[#0f3151] shadow-2xl shadow-black/50">
            <div className="flex items-center justify-between border-b border-[#1a3a5a] px-5 py-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-[14px] bg-[#1090D0]/15 text-[#5bbfe5]">
                  <FileText className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-[16px] font-bold text-slate-50">{previewDocName}</h3>
                  <div className="text-[11px] text-slate-400">
                    Vista previa del documento markdown
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleExportItemsAsDoc(previewDocName)}
                  className="flex h-9 items-center gap-1.5 rounded-[12px] border border-[#1a3a5a] bg-[#0b2641] px-3 py-2 text-[11.5px] font-semibold text-slate-200 transition hover:border-[#1090D0]/40 hover:text-white"
                >
                  <Download className="h-3.5 w-3.5" /> Sobreescribir con catálogo
                </button>
                <button
                  type="button"
                  onClick={() => { setPreviewDocName(null); setPreviewDocContent('') }}
                  className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-400 transition hover:bg-[#0b2641] hover:text-slate-100"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>
            <div className="max-h-[70vh] overflow-auto p-5">
              {loadingPreview ? (
                <div className="flex items-center gap-2 text-slate-400 text-[12.5px]">
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  Cargando documento...
                </div>
              ) : (
                <pre className="whitespace-pre-wrap font-mono text-[12.5px] leading-relaxed text-slate-200 rounded-[14px] border border-[#1a3a5a] bg-[#0b2641] p-4">
                  {previewDocContent || '(documento vacío)'}
                </pre>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {/* IMPORT MODAL */}
      {importModalOpen ? (
        <div className="fixed inset-0 z-[85] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-3xl overflow-hidden rounded-[22px] border border-[#1a3a5a] bg-gradient-to-b from-[#0f3151] to-[#0d2e4d] shadow-2xl shadow-black/60">
            <div className="flex items-center justify-between border-b border-[#1a3a5a] px-5 py-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-[14px] bg-emerald-500/15 text-emerald-300">
                  <Upload className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-[16px] font-bold text-slate-50">
                    Importar productos
                  </h3>
                  <div className="text-[11px] text-slate-400">
                    CSV · JSON · TSV · TXT · Excel (copiado) · PDF
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={closeImportModal}
                className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-400 transition hover:bg-[#0b2641] hover:text-slate-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="max-h-[75vh] overflow-auto px-5 py-5">
              <div className="flex flex-col gap-4">
                {/* Elegir archivo */}
                <div className="flex items-center gap-3 rounded-[16px] border border-dashed border-[#1090D0]/40 bg-[#0b2641] px-4 py-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] bg-[#1090D0]/15 text-[#5bbfe5]">
                    <Upload className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-[#5bbfe5]">
                      1 · Selecciona tu archivo
                    </div>
                    <div className="truncate text-[12.5px] text-slate-200">
                      {importFileName || 'Arrastra o elige un archivo de tu equipo'}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="rounded-[11px] border border-[#1090D0]/50 bg-[#1090D0]/10 px-3 py-1.5 text-[11.5px] font-bold text-[#5bbfe5] transition hover:bg-[#1090D0]/25 whitespace-nowrap"
                  >
                    {importFileName ? 'Cambiar' : 'Seleccionar…'}
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    className="hidden"
                    accept=".csv,.tsv,.json,.xlsx,.xls,.txt,.pdf"
                    onChange={(e) => void onPickImportFile(e)}
                  />
                </div>

                {/* Doc destino (forzado a productos.md, único) */}
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="rounded-[16px] border border-[#1a3a5a] bg-[#0b2641] px-4 py-3">
                    <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-slate-400">
                      2 · Documento destino (único)
                    </div>
                    <div className="flex items-center gap-2">
                      <FolderDown className="h-4 w-4 text-[#5bbfe5]" />
                      <select
                        value={importTargetDoc === 'productos.md' ? 'productos.md' : (importTargetDoc || 'productos.md')}
                        onChange={(e) => setImportTargetDoc(e.target.value || 'productos.md')}
                        className="flex-1 rounded-[10px] border border-[#1a3a5a] bg-[#0f3151] px-2.5 py-2 text-[12.5px] font-semibold text-slate-100 focus:outline-none focus:border-[#1090D0]/50"
                        title="Todos los productos nuevos se guardan siempre en productos.md para ser consistentes con el chat."
                      >
                        <option value="productos.md" className="bg-[#0f3151]">
                          productos.md · Productos / Cursos / Servicios
                        </option>
                        {(mdFiles || []).filter(f => f.fileName !== 'productos.md').slice(0, 9).map((f) => (
                          <option key={f.fileName} value={f.fileName} className="bg-[#0f3151]">
                            {f.fileName}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Info derecha (no editable, solo info) */}
                  <div className="rounded-[16px] border border-[#1090D0]/40 bg-[#1090D0]/5 px-4 py-3 flex items-center gap-2">
                    <Check className="h-4 w-4 text-[#1090D0]" />
                    <div className="text-[12px] text-slate-300 leading-snug">
                      Se usará <span className="font-bold text-[#5bbfe5]">productos.md</span> como fuente única de verdad para el agente conversacional. Todos los productos nuevos se agregan aquí.
                    </div>
                  </div>
                </div>

                {/* Shortcuts chips docs */}
                {mdFiles.length > 0 ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[10.5px] font-semibold uppercase tracking-wider text-slate-500 mr-1">
                      Recientes:
                    </span>
                    {['productos.md', ...mdFiles.filter(f => f.fileName !== 'productos.md').map(f => f.fileName)].slice(0, 6).map((fn) => (
                      <button
                        key={fn}
                        type="button"
                        onClick={() => { setImportTargetDoc(fn); setImportNewDocName('') }}
                        className={cn(
                          'group flex items-center gap-1.5 rounded-[11px] border px-2.5 py-1.5 text-[11px] transition',
                          importTargetDoc === fn
                            ? 'border-[#1090D0]/50 bg-[#1090D0]/15 text-[#5bbfe5]'
                            : 'border-[#1a3a5a] bg-[#0b2641]/60 text-slate-300 hover:border-[#1090D0]/40 hover:text-white',
                        )}
                      >
                        <FileText className="h-3 w-3" />
                        <span className="font-semibold">{fn}</span>
                      </button>
                    ))}
                  </div>
                ) : null}

                {/* Preview */}
                {importPreview ? (
                  <div className="rounded-[16px] border border-[#1a3a5a] bg-[#0b2641] p-4">
                    <div className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                      <FileText className="h-3.5 w-3.5" />
                      Vista previa · primeras líneas
                    </div>
                    <pre className="max-h-52 overflow-auto whitespace-pre-wrap rounded-[12px] border border-[#1a3a5a]/60 bg-[#0a2238] p-3 font-mono text-[11.5px] leading-relaxed text-slate-300">
                      {importPreview}
                    </pre>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-[#1a3a5a] bg-[#0b2641]/60 px-5 py-4">
              <div className="text-[11.5px] text-slate-400">
                Si los productos ya existen (mismo SKU) se actualizarán; de lo contrario se crearán.
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={closeImportModal}
                  className="rounded-[12px] border border-[#1a3a5a] bg-[#0f3151] px-4 py-2 text-[12px] font-semibold text-slate-200 transition hover:border-[#1090D0]/40"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={() => void handleRunImport()}
                  disabled={
                    importing ||
                    !importFileName ||
                    !(importTargetDoc || importNewDocName.trim())
                  }
                  className="flex h-10 items-center gap-2 rounded-[12px] bg-emerald-500 px-5 text-[12.5px] font-bold text-white transition hover:bg-emerald-600 disabled:bg-slate-500/50 disabled:opacity-60"
                >
                  {importing ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                  Importar y agregar a doc
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  )
}

// ===== helpers =====
function arrayBufferToBase64(buf: ArrayBuffer): string {
  let binary = ''
  const bytes = new Uint8Array(buf)
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i])
  // btoa is browser-only
  return (typeof btoa === 'function' ? btoa(binary) : Buffer.from(bytes).toString('base64'))
}
function renderItemBlockPlain(it: PosCatalogItem, branches: PosBranch[]): string {
  const stocks = branches && branches.length
    ? branches.map((b) => `- Stock ${b.name}: ${it.stocks?.[b.id] ?? 0}`).join('\n')
    : Object.entries(it.stocks || {}).map(([bid, q]) => `- Stock ${bid}: ${q}`).join('\n') || '- Stock: 0'
  return [
    `## ${it.name}`,
    `- SKU: ${it.sku}`,
    `- Tipo: ${it.kind}`,
    `- Nombre: ${it.name}`,
    `- Familia: ${it.family || ''}`,
    `- Categoría: ${it.category || ''}`,
    `- Precio costo: ${it.costPrice ?? ''}`,
    `- Precio venta: ${it.salePrice}`,
    `- Moneda: ${it.currency || 'MXN'}`,
    stocks,
    it.location ? `- Ubicación: ${it.location}` : null,
    it.description ? `- Descripción: ${String(it.description).slice(0, 500)}` : null,
    `- Activo: ${it.active ? 'Sí' : 'No'}`,
    '',
  ]
    .filter(Boolean)
    .join('\n')
}
