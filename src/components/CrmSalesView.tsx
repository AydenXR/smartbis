import { useEffect, useMemo, useState } from 'react'
import {
  Search,
  RefreshCw,
  Filter,
  Calendar,
  CreditCard,
  Banknote,
  Send,
  ShoppingCart,
  Receipt,
  TrendingUp,
  Package,
  UserCircle,
  XCircle,
  CheckCircle2,
  PackageCheck,
  FileText,
  Trash2,
  X,
  ChevronRight,
  ChevronLeft,
  Clock,
  Sparkles,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  type PosSale,
  type PosBranch,
  type PaymentMethod,
  type SaleStatus,
  posSales,
  posSaleGet,
  posSaleCancel,
  posBranches,
} from '@/lib/api'

type RangePreset = 'today' | 'yesterday' | '7d' | '30d' | 'all' | 'custom'

function toISOStr(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}
function startOfDay(d: Date) {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}
function endOfDay(d: Date) {
  const x = new Date(d)
  x.setHours(23, 59, 59, 999)
  return x
}
function fmt$(n: number) {
  return `$${(n || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

const methodLabel: Record<PaymentMethod, string> = {
  cash: 'Efectivo',
  card: 'Tarjeta',
  transfer: 'Transfer',
  whatsapp: 'WhatsApp',
  pending: 'Pendiente',
}

function MethodBadge({ m }: { m: PaymentMethod }) {
  const t: Record<PaymentMethod, string> = {
    cash: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200',
    card: 'border-indigo-400/30 bg-indigo-400/10 text-indigo-200',
    transfer: 'border-sky-400/30 bg-sky-400/10 text-sky-200',
    whatsapp: 'border-[#25D366]/30 bg-[#25D366]/10 text-[#8bf0b0]',
    pending: 'border-amber-400/30 bg-amber-400/10 text-amber-200',
  }
  const Icon =
    m === 'cash' ? Banknote
    : m === 'card' ? CreditCard
    : m === 'transfer' ? Send
    : m === 'whatsapp' ? Sparkles
    : Clock
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-wider', t[m])}>
      <Icon className="h-3 w-3" /> {methodLabel[m]}
    </span>
  )
}

function SaleStatusBadge({ s }: { s: PosSale['status'] }) {
  if (s === 'paid') return (
    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-200">
      <CheckCircle2 className="h-3 w-3" /> Cobrada
    </span>
  )
  if (s === 'quote') return (
    <span className="inline-flex items-center gap-1 rounded-full border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-200">
      <FileText className="h-3 w-3" /> Cotización
    </span>
  )
  if (s === 'own_use') return (
    <span className="inline-flex items-center gap-1 rounded-full border border-violet-400/30 bg-violet-400/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-violet-200">
      <PackageCheck className="h-3 w-3" /> Uso propio
    </span>
  )
  if (s === 'pending') return (
    <span className="inline-flex items-center gap-1 rounded-full border border-sky-400/30 bg-sky-400/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-sky-200">
      <Clock className="h-3 w-3" /> Parcial
    </span>
  )
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-rose-400/30 bg-rose-400/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-rose-200">
      <XCircle className="h-3 w-3" /> Cancelada
    </span>
  )
}

export default function CrmSalesView() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [sales, setSales] = useState<PosSale[]>([])
  const [branches, setBranches] = useState<PosBranch[]>([])
  const [openSale, setOpenSale] = useState<PosSale | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [cancelling, setCancelling] = useState(false)

  // Filtros
  const [range, setRange] = useState<RangePreset>('7d')
  const [fromISO, setFromISO] = useState('')
  const [toISO, setToISO] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | PosSale['status']>('all')
  const [branchFilter, setBranchFilter] = useState<string>('all')
  const [search, setSearch] = useState('')
  const [methodFilter, setMethodFilter] = useState<'all' | PaymentMethod>('all')

  const [page, setPage] = useState(0)
  const PAGE_SIZE = 25

  async function loadAll() {
    setLoading(true)
    setError('')
    try {
      const [sRes, bRes] = await Promise.all([posSales(), posBranches()])
      setSales(sRes.sales)
      setBranches(bRes.branches || [])
    } catch (e: any) {
      setError(e?.message || 'Error cargando ventas')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void loadAll() }, [])

  const filtered = useMemo(() => {
    const now = new Date()
    let from: Date | null = null
    let to: Date | null = null
    if (range === 'today') { from = startOfDay(now); to = endOfDay(now) }
    else if (range === 'yesterday') { const y = new Date(now); y.setDate(y.getDate() - 1); from = startOfDay(y); to = endOfDay(y) }
    else if (range === '7d') { const x = new Date(now); x.setDate(x.getDate() - 6); from = startOfDay(x); to = endOfDay(now) }
    else if (range === '30d') { const x = new Date(now); x.setDate(x.getDate() - 29); from = startOfDay(x); to = endOfDay(now) }
    else if (range === 'custom') {
      if (fromISO) from = new Date(fromISO)
      if (toISO) to = new Date(toISO)
    }

    const q = search.trim().toLowerCase()
    return sales.filter((s) => {
      if (from && s.createdAt < toISOStr(from)) return false
      if (to && s.createdAt > toISOStr(to)) return false
      if (statusFilter !== 'all' && s.status !== statusFilter) return false
      if (branchFilter !== 'all' && s.branchId !== branchFilter) return false
      if (methodFilter !== 'all') {
        const has = s.payments?.some(p => p.method === methodFilter)
        if (!has) return false
      }
      if (q) {
        const hay = [
          s.id, s.customerName || '', s.userEmail || '',
          s.lines.map(l => `${l.name} ${l.sku || ''}`).join(' '),
        ].join(' ').toLowerCase().includes(q)
        if (!hay) return false
      }
      return true
    })
  }, [sales, range, fromISO, toISO, statusFilter, branchFilter, methodFilter, search])

  const stats = useMemo(() => {
    const tickets = filtered.filter(s => s.status === 'paid').length
    const quotes = filtered.filter(s => s.status === 'quote').length
    const canceled = filtered.filter(s => s.status === 'cancelled').length
    const totalPaid = filtered.filter(s => s.status === 'paid').reduce((acc, s) => acc + (s.total || 0), 0)
    const itemsCount = filtered.reduce((acc, s) => acc + s.lines.reduce((a, l) => a + (l.qty || 0), 0), 0)
    const avg = tickets > 0 ? totalPaid / tickets : 0
    const byMethod: Record<PaymentMethod, number> = { cash: 0, card: 0, transfer: 0, whatsapp: 0, pending: 0 }
    filtered.filter(s => s.status === 'paid').forEach((s) => {
      s.payments.forEach(p => { byMethod[p.method] = (byMethod[p.method] || 0) + (p.amount || 0) })
    })
    return { totalPaid, tickets, quotes, canceled, itemsCount, avg, byMethod }
  }, [filtered])

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const pageItems = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  async function openDetail(id: string) {
    const existing = sales.find(s => s.id === id)
    setOpenSale(existing || null)
    setLoadingDetail(true)
    try {
      const r = await posSaleGet(id)
      setOpenSale(r.sale)
    } catch (e: any) {
      setError(e?.message || 'Error cargando detalle')
    } finally {
      setLoadingDetail(false)
    }
  }

  async function onCancel(id: string) {
    if (!confirm('¿Cancelar esta venta? (no descuenta ajustes, solo marca como cancelada)')) return
    setCancelling(true)
    try {
      await posSaleCancel(id)
      await loadAll()
      if (openSale?.id === id) setOpenSale(null)
    } catch (e: any) {
      setError(e?.message || 'Error cancelando venta')
    } finally {
      setCancelling(false)
    }
  }

  const presets: Array<{ id: RangePreset; label: string }> = [
    { id: 'today', label: 'Hoy' },
    { id: 'yesterday', label: 'Ayer' },
    { id: '7d', label: '7 días' },
    { id: '30d', label: '30 días' },
    { id: 'all', label: 'Todas' },
    { id: 'custom', label: 'Personalizado' },
  ]

  return (
    <div className="grid h-full min-h-0 w-full grid-cols-1 gap-0 overflow-hidden lg:grid-cols-[minmax(540px,1fr)_minmax(440px,520px)]">
      {/* ===== IZQUIERDA: Filtros, Stats, Lista ===== */}
      <section className="flex min-h-0 w-full flex-col overflow-hidden border-r border-[#1a3a5a] bg-[#0c2a47]">
        {/* Header */}
        <div className="border-b border-[#1a3a5a] bg-[#0f3151] px-5 py-4 flex-shrink-0">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#1090D0]/15 text-[#5bbfe5] border border-[#1090D0]/30">
                <Receipt className="h-5.5 w-5.5" />
              </div>
              <div>
                <h2 className="text-[15px] font-extrabold text-white tracking-tight">Ventas del Punto de Venta</h2>
                <p className="text-[10.5px] text-slate-400 mt-0.5">
                  Historial completo de ventas y cotizaciones del POS · Filtra por periodo, sucursal, método o estatus.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => { setPage(0); void loadAll() }}
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-xl border border-[#1a3a5a] bg-[#11375a] px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-slate-200 hover:border-[#1090D0]/40 hover:text-white disabled:opacity-50"
            >
              <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} /> Refrescar
            </button>
          </div>
        </div>

        <div className="min-h-0 h-full flex-1 overflow-y-auto px-4 py-3 space-y-3 tech-scrollbar">
          {/* STATS */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="flex items-center gap-2.5 rounded-2xl border border-emerald-400/25 bg-emerald-400/8 px-3 py-2.5 ring-1 ring-emerald-400/15">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#0c2a47]/50 border border-white/5">
                <TrendingUp className="h-4 w-4 text-emerald-300" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-extrabold uppercase tracking-wider text-emerald-200/80">Total cobrado</p>
                <p className="font-mono text-[15px] font-extrabold text-emerald-100">{fmt$(stats.totalPaid)}</p>
              </div>
            </div>
            <div className="flex items-center gap-2.5 rounded-2xl border border-[#1090D0]/25 bg-[#1090D0]/8 px-3 py-2.5 ring-1 ring-[#1090D0]/15">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#0c2a47]/50 border border-white/5">
                <ShoppingCart className="h-4 w-4 text-[#5bbfe5]" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-extrabold uppercase tracking-wider text-[#7fd2ff]/80">Tickets pagados</p>
                <p className="font-mono text-[15px] font-extrabold text-white">{stats.tickets}</p>
                {stats.quotes > 0 ? <p className="text-[9.5px] text-amber-300 mt-0.5">+ {stats.quotes} cotizaciones</p> : null}
              </div>
            </div>
            <div className="flex items-center gap-2.5 rounded-2xl border border-purple-400/25 bg-purple-400/8 px-3 py-2.5 ring-1 ring-purple-400/15">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#0c2a47]/50 border border-white/5">
                <Sparkles className="h-4 w-4 text-purple-200" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-extrabold uppercase tracking-wider text-purple-200/80">Ticket promedio</p>
                <p className="font-mono text-[15px] font-extrabold text-purple-100">{fmt$(stats.avg)}</p>
              </div>
            </div>
            <div className="flex items-center gap-2.5 rounded-2xl border border-amber-400/25 bg-amber-400/8 px-3 py-2.5 ring-1 ring-amber-400/15">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#0c2a47]/50 border border-white/5">
                <Package className="h-4 w-4 text-amber-300" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-extrabold uppercase tracking-wider text-amber-200/80">Piezas vendidas</p>
                <p className="font-mono text-[15px] font-extrabold text-amber-100">{stats.itemsCount}</p>
                {stats.canceled > 0 ? <p className="text-[9.5px] text-rose-300 mt-0.5">{stats.canceled} canceladas</p> : null}
              </div>
            </div>
          </div>

          {/* MÉTODOS DE PAGO */}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {(['cash','card','transfer'] as PaymentMethod[]).map((m) => (
              <div key={m} className="flex items-center justify-between rounded-xl border border-[#1a3a5a] bg-[#0e2d4c]/70 px-3 py-2">
                <div className="flex items-center gap-2 min-w-0">
                  <MethodBadge m={m} />
                </div>
                <p className="font-mono text-[13px] font-bold text-slate-100">{fmt$(stats.byMethod[m] || 0)}</p>
              </div>
            ))}
          </div>

          {/* FILTROS */}
          <div className="rounded-2xl border border-[#1a3a5a] bg-[#0e2d4c]/80 p-3 space-y-2.5">
            <div className="flex items-center gap-1.5 mb-0.5">
              <Filter className="h-3.5 w-3.5 text-slate-400" />
              <p className="text-[10.5px] font-extrabold uppercase tracking-wider text-slate-300">Filtros</p>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {presets.map(p => (
                <button key={p.id} type="button"
                  onClick={() => { setRange(p.id); setPage(0) }}
                  className={cn(
                    'rounded-lg border px-2.5 py-1.5 text-[10.5px] font-bold tracking-wide transition',
                    range === p.id
                      ? 'border-[#1090D0]/60 bg-[#1090D0]/15 text-[#7fd2ff] shadow-inner'
                      : 'border-[#1a3a5a] bg-[#0c2a47] text-slate-300 hover:border-[#2a5589] hover:text-white'
                  )}>
                  {p.label}
                </button>
              ))}
            </div>

            {range === 'custom' ? (
              <div className="grid grid-cols-2 gap-2">
                <label className="flex flex-col gap-1">
                  <span className="text-[9.5px] font-bold uppercase tracking-widest text-slate-400 flex items-center gap-1"><Calendar className="h-3.5 w-3.5" /> Desde</span>
                  <input type="datetime-local" value={fromISO} onChange={(e) => { setFromISO(e.target.value); setPage(0) }}
                    className="rounded-lg border border-[#1a3a5a] bg-[#0c2a47] px-2 py-1.5 text-[11px] text-white focus:border-[#1090D0]/60 focus:outline-none" />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[9.5px] font-bold uppercase tracking-widest text-slate-400 flex items-center gap-1"><Clock className="h-3.5 w-3.5" /> Hasta</span>
                  <input type="datetime-local" value={toISO} onChange={(e) => { setToISO(e.target.value); setPage(0) }}
                    className="rounded-lg border border-[#1a3a5a] bg-[#0c2a47] px-2 py-1.5 text-[11px] text-white focus:border-[#1090D0]/60 focus:outline-none" />
                </label>
              </div>
            ) : null}

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
              <div className="sm:col-span-2 relative min-w-0">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(0) }}
                  placeholder="Buscar por folio, cliente, cajero, SKU/artículo…"
                  className="w-full rounded-lg border border-[#1a3a5a] bg-[#0c2a47] pl-9 pr-3 py-2 text-[11.5px] text-white placeholder:text-slate-500 focus:border-[#1090D0]/60 focus:outline-none" />
              </div>
              <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value as any); setPage(0) }}
                className="rounded-lg border border-[#1a3a5a] bg-[#0c2a47] px-2 py-2 text-[11px] text-white focus:border-[#1090D0]/60 focus:outline-none">
                <option value="all">Todos estatus</option>
                <option value="paid">Cobradas</option>
                <option value="quote">Cotizaciones</option>
                <option value="own_use">Uso propio</option>
                <option value="cancelled">Canceladas</option>
                <option value="pending">Pago parcial</option>
              </select>
              <select value={branchFilter} onChange={(e) => { setBranchFilter(e.target.value); setPage(0) }}
                className="rounded-lg border border-[#1a3a5a] bg-[#0c2a47] px-2 py-2 text-[11px] text-white focus:border-[#1090D0]/60 focus:outline-none">
                <option value="all">Todas sucursales</option>
                {(branches || []).map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>

            <div className="flex flex-wrap gap-1.5">
              <button type="button" onClick={() => { setMethodFilter('all'); setPage(0) }}
                className={cn('rounded-lg border px-2 py-1 text-[10px] font-bold tracking-wide',
                  methodFilter === 'all'
                    ? 'border-[#1090D0]/50 bg-[#1090D0]/15 text-[#7fd2ff]'
                    : 'border-[#1a3a5a] bg-[#0c2a47] text-slate-400 hover:text-white')}>
                Todos métodos
              </button>
              {(['cash','card','transfer'] as PaymentMethod[]).map(m => (
                <button key={m} type="button" onClick={() => { setMethodFilter(m); setPage(0) }}
                  className={cn('rounded-lg px-2 py-1 text-[10px] font-bold tracking-wide border',
                    methodFilter === m
                      ? 'border-[#1090D0]/50 bg-[#1090D0]/15 text-[#7fd2ff]'
                      : 'border-[#1a3a5a] bg-[#0c2a47] text-slate-300 hover:text-white')}>
                  {methodLabel[m]}
                </button>
              ))}
            </div>
          </div>

          {/* ERROR */}
          {error ? (
            <div className="flex items-start gap-2 rounded-xl border border-rose-400/20 bg-rose-400/10 px-3 py-2 text-[11.5px] text-rose-200">
              <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <div className="flex-1">{error}</div>
              <button type="button" onClick={() => setError('')} className="rounded-md p-1 hover:bg-white/10"><X className="h-3.5 w-3.5" /></button>
            </div>
          ) : null}

          {/* PAGINACIÓN */}
          <div className="flex items-center justify-between gap-2 rounded-xl border border-[#1a3a5a] bg-[#0e2d4c]/70 px-3 py-2">
            <p className="text-[11px] text-slate-300 font-mono">
              {filtered.length} resultado{filtered.length === 1 ? '' : 's'} · Página {page + 1} / {pageCount}
            </p>
            <div className="flex items-center gap-1">
              <button type="button" disabled={page <= 0} onClick={() => setPage(p => Math.max(0, p - 1))}
                className="rounded-lg border border-[#1a3a5a] bg-[#0c2a47] px-2 py-1 text-[11px] font-bold text-slate-200 hover:text-white disabled:opacity-40">
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
              <span className="font-mono text-[11px] text-slate-300 px-2">{page + 1}</span>
              <button type="button" disabled={page + 1 >= pageCount} onClick={() => setPage(p => p + 1)}
                className="rounded-lg border border-[#1a3a5a] bg-[#0c2a47] px-2 py-1 text-[11px] font-bold text-slate-200 hover:text-white disabled:opacity-40">
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {/* LISTA */}
          {loading ? (
            <div className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-[#25507c] bg-white/[0.02] px-4 py-10 text-[11.5px] text-slate-400">
              <RefreshCw className="h-4 w-4 animate-spin text-[#1090D0]" /> Cargando ventas…
            </div>
          ) : pageItems.length === 0 ? (
            <div className="rounded-xl border border-dashed border-[#25507c] bg-white/[0.02] px-4 py-12 text-center">
              <Receipt className="mx-auto h-9 w-9 text-slate-500 opacity-60 mb-2" />
              <p className="text-[12px] font-semibold text-slate-200 mb-1">No hay ventas en el periodo/filtros elegidos.</p>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                Registra una venta desde el <span className="font-bold text-[#7fd2ff]">#1 Punto de Venta</span> y aparecerá aquí automáticamente.
              </p>
            </div>
          ) : (
            <ul className="space-y-1.5">
              {pageItems.map(s => {
                const branchName = branches.find(b => b.id === s.branchId)?.name || `Sucursal ${s.branchId.slice(-4)}`
                return (
                  <li key={s.id}>
                    <button type="button" onClick={() => void openDetail(s.id)}
                      className={cn(
                        'w-full flex items-start gap-3 rounded-2xl border px-3 py-2.5 text-left transition',
                        openSale?.id === s.id
                          ? 'border-[#1090D0]/40 bg-[#1090D0]/8 ring-1 ring-[#1090D0]/20'
                          : 'border-transparent bg-transparent hover:border-[#1a3a5a] hover:bg-[#123659]/60')}>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap mb-1">
                          <p className="font-mono text-[10.5px] text-slate-400 mr-1">#{s.id.slice(0, 8).toUpperCase()}</p>
                          <SaleStatusBadge s={s.status} />
                          {s.payments.map(p => <MethodBadge key={p.id + p.method} m={p.method} />)}
                          {s.requiresFactura ? (
                            <span className="inline-flex items-center gap-1 rounded-full border border-purple-400/30 bg-purple-400/10 px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-wider text-purple-200">
                              <FileText className="h-3 w-3" /> Factura
                            </span>
                          ) : null}
                          <span className="ml-auto font-mono text-[10.5px] text-slate-500">
                            {new Date(s.createdAt).toLocaleString('es-MX', { hour12: false })}
                          </span>
                        </div>
                        <div className="flex items-baseline gap-3">
                          <p className="font-mono text-[17px] font-extrabold text-white">{fmt$(s.total)}</p>
                          {s.status === 'paid' && s.paidAmount < s.total ? (
                            <span className="text-[10px] font-bold text-amber-300">Pendiente {fmt$(s.pendingAmount)}</span>
                          ) : null}
                          {s.discount > 0 ? (
                            <span className="text-[10px] font-bold text-rose-300">Desc {fmt$(s.discount)}</span>
                          ) : null}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10.5px] text-slate-400 leading-snug">
                          <span className="inline-flex items-center gap-1"><UserCircle className="h-3 w-3" /> {s.customerName || 'Mostrador'}</span>
                          <span className="inline-flex items-center gap-1"><ShoppingCart className="h-3 w-3" /> {s.lines.length} art · {s.lines.reduce((a,l)=>a+l.qty,0)} pzs</span>
                          <span className="inline-flex items-center gap-1"><Package className="h-3 w-3" /> {branchName}</span>
                          <span className="inline-flex items-center gap-1 text-slate-500">{s.userEmail}</span>
                        </div>
                      </div>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </section>

      {/* ===== DERECHA: DETALLE VENTA ===== */}
      <aside className="flex min-h-0 w-full flex-col overflow-hidden bg-[#0b2540]">
        {!openSale ? (
          <div className="h-full w-full flex items-center justify-center px-8">
            <div className="max-w-lg text-center">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-[#1090D0]/20 bg-[#1090D0]/10 text-[#7fd2ff] shadow-inner">
                <Receipt className="h-6 w-6" />
              </div>
              <h3 className="text-[15px] font-extrabold text-white mb-1.5 tracking-tight">
                Selecciona una venta para ver el detalle
              </h3>
              <p className="text-[12px] leading-relaxed text-slate-400 mb-5">
                Aquí verás el ticket completo: artículos vendidos, subtotal, IVA, descuento, método de pago, datos del cliente, cajero y opción de cancelar si es necesario.
              </p>
              <div className="grid grid-cols-1 gap-2 text-[11px] text-left sm:grid-cols-3">
                <div className="rounded-2xl border border-[#1a3a5a] bg-[#0e2d4c]/80 p-3">
                  <div className="flex items-center gap-2 mb-1"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-300" /> <p className="text-[11px] font-extrabold text-white">🟢 Cobrada</p></div>
                  <p className="text-[10.5px] leading-snug text-slate-400">Venta pagada (Efectivo / Tarjeta / Transfer). Descuenta stock y queda registrada.</p>
                </div>
                <div className="rounded-2xl border border-[#1a3a5a] bg-[#0e2d4c]/80 p-3">
                  <div className="flex items-center gap-2 mb-1"><FileText className="h-3.5 w-3.5 text-amber-300" /> <p className="text-[11px] font-extrabold text-white">🟡 Cotización</p></div>
                  <p className="text-[10.5px] leading-snug text-slate-400">Solo es una cotización, NO descuenta stock ni cuenta en reportes de venta.</p>
                </div>
                <div className="rounded-2xl border border-[#1a3a5a] bg-[#0e2d4c]/80 p-3">
                  <div className="flex items-center gap-2 mb-1"><XCircle className="h-3.5 w-3.5 text-rose-300" /> <p className="text-[11px] font-extrabold text-white">🔴 Cancelada</p></div>
                  <p className="text-[10.5px] leading-snug text-slate-400">Marcada manualmente; se conserva historial pero no entra en totales.</p>
                </div>
              </div>
            </div>
          </div>
        ) : loadingDetail ? (
          <div className="h-full w-full flex items-center justify-center gap-2 text-[12px] text-slate-400">
            <RefreshCw className="h-4 w-4 animate-spin text-[#1090D0]" />
            Cargando detalle…
          </div>
        ) : (
          <div className="flex h-full min-h-0 w-full flex-col overflow-hidden">
            <div className="border-b border-[#1a3a5a] bg-[#0f3151]/80 px-5 py-3.5 flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <p className="font-mono text-[12px] font-bold text-[#7fd2ff]">Ticket #{openSale.id.toUpperCase()}</p>
                  <SaleStatusBadge s={openSale.status} />
                  {openSale.payments.map(p => <MethodBadge key={p.id + p.method} m={p.method} />)}
                </div>
                <p className="text-[11px] text-slate-400 font-mono">
                  {new Date(openSale.createdAt).toLocaleString('es-MX', { hour12: false })} · {branches.find(b=>b.id===openSale.branchId)?.name || openSale.branchId}
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                {openSale.status !== 'cancelled' ? (
                  <button type="button" onClick={() => void onCancel(openSale.id)} disabled={cancelling}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-rose-200 hover:bg-rose-500/20 disabled:opacity-50">
                    <Trash2 className="h-3.5 w-3.5" /> Cancelar
                  </button>
                ) : null}
                <button type="button" onClick={() => setOpenSale(null)}
                  className="rounded-lg border border-[#1a3a5a] bg-[#11375a] p-2 text-slate-300 hover:text-white">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            <div className="min-h-0 h-full flex-1 overflow-y-auto px-5 py-4 space-y-4 tech-scrollbar">
              {/* Totales */}
              <div className="rounded-2xl border border-[#1a3a5a] bg-[#0e2d4c]/80 p-3.5 space-y-1.5">
                <div className="grid grid-cols-3 gap-1.5 text-[11px]">
                  <div className="rounded-lg border border-[#1a3a5a] bg-[#0c2a47] px-2 py-2">
                    <p className="text-[9px] font-extrabold uppercase tracking-[0.22em] text-slate-400">Subtotal</p>
                    <p className="mt-0.5 font-mono font-bold text-slate-100">{fmt$(openSale.subtotal)}</p>
                  </div>
                  <div className="rounded-lg border border-[#1a3a5a] bg-[#0c2a47] px-2 py-2">
                    <p className="text-[9px] font-extrabold uppercase tracking-[0.22em] text-slate-400">IVA {Math.round(openSale.ivaRate*100)}%</p>
                    <p className="mt-0.5 font-mono font-bold text-emerald-200">{fmt$(openSale.ivaAmount)}</p>
                  </div>
                  <div className="rounded-lg border border-[#1a3a5a] bg-[#0c2a47] px-2 py-2">
                    <p className="text-[9px] font-extrabold uppercase tracking-[0.22em] text-slate-400">Descuento</p>
                    <p className="mt-0.5 font-mono font-bold text-rose-200">-{fmt$(openSale.discount)}</p>
                  </div>
                </div>
                <div className="flex items-center justify-between rounded-xl border border-[#1090D0]/60 bg-[#1090D0]/15 px-3 py-2.5 mt-2">
                  <span className="text-[12px] font-extrabold uppercase tracking-wider text-[#8fd2ec]">Total</span>
                  <span className="font-mono text-[22px] font-extrabold text-white drop-shadow-[0_0_6px_rgba(16,144,208,0.5)]">{fmt$(openSale.total)}</span>
                </div>
                <div className="grid grid-cols-2 gap-1.5 pt-0.5">
                  <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/5 px-2 py-1.5">
                    <p className="text-[9.5px] font-extrabold uppercase tracking-widest text-emerald-200/80">Pagado</p>
                    <p className="font-mono text-[12px] font-bold text-emerald-100">{fmt$(openSale.paidAmount)}</p>
                  </div>
                  <div className="rounded-lg border border-amber-500/25 bg-amber-500/5 px-2 py-1.5">
                    <p className="text-[9.5px] font-extrabold uppercase tracking-widest text-amber-200/80">Pendiente</p>
                    <p className="font-mono text-[12px] font-bold text-amber-100">{fmt$(openSale.pendingAmount)}</p>
                  </div>
                </div>
              </div>

              {/* Datos generales */}
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-xl border border-[#1a3a5a] bg-[#0e2d4c]/60 px-3 py-2">
                  <p className="text-[9px] font-extrabold uppercase tracking-[0.22em] text-slate-400">Cliente</p>
                  <p className="mt-0.5 text-[11.5px] text-slate-100 leading-tight">{openSale.customerName || 'Cliente mostrador'}</p>
                </div>
                <div className="rounded-xl border border-[#1a3a5a] bg-[#0e2d4c]/60 px-3 py-2">
                  <p className="text-[9px] font-extrabold uppercase tracking-[0.22em] text-slate-400">Cajero</p>
                  <p className="mt-0.5 text-[11px] text-slate-100 break-all">{openSale.userEmail}</p>
                </div>
                <div className="rounded-xl border border-[#1a3a5a] bg-[#0e2d4c]/60 px-3 py-2">
                  <p className="text-[9px] font-extrabold uppercase tracking-[0.22em] text-slate-400">Factura</p>
                  <p className="mt-0.5 text-[11.5px] text-slate-100">{openSale.requiresFactura ? 'Sí, solicitada' : 'No requerida'}</p>
                </div>
                <div className="rounded-xl border border-[#1a3a5a] bg-[#0e2d4c]/60 px-3 py-2">
                  <p className="text-[9px] font-extrabold uppercase tracking-[0.22em] text-slate-400">Moneda / IVA</p>
                  <p className="mt-0.5 text-[11.5px] text-slate-100 font-mono">{openSale.currency || 'MXN'} · {Math.round(openSale.ivaRate*100)}%</p>
                </div>
              </div>

              {/* Pagos */}
              <div className="rounded-2xl border border-[#1a3a5a] bg-[#0e2d4c]/80 p-3.5">
                <div className="flex items-center gap-1.5 mb-2">
                  <CreditCard className="h-3.5 w-3.5 text-[#5bbfe5]" />
                  <h4 className="text-[11px] font-extrabold uppercase tracking-widest text-slate-200">Pagos aplicados</h4>
                </div>
                {(!openSale.payments || openSale.payments.length === 0) ? (
                  <p className="text-[11px] text-slate-400 rounded-lg border border-dashed border-[#25507c] bg-white/[0.02] px-3 py-3 text-center">Sin pagos registrados (cotización sin pago).</p>
                ) : (
                  <ul className="space-y-1.5">
                    {openSale.payments.map(p => (
                      <li key={p.id} className="flex items-center justify-between rounded-xl border border-[#1a3a5a] bg-[#0c2a47] px-3 py-2">
                        <div className="flex items-center gap-2"><MethodBadge m={p.method} /> <span className="text-[10px] font-mono text-slate-400">{new Date(p.at).toLocaleString('es-MX',{hour12:false})}</span></div>
                        <p className="font-mono text-[12.5px] font-bold text-slate-100">{fmt$(p.amount)}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Artículos */}
              <div className="rounded-2xl border border-[#1a3a5a] bg-[#0e2d4c]/80 p-3.5">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-1.5">
                    <Package className="h-3.5 w-3.5 text-amber-300" />
                    <h4 className="text-[11px] font-extrabold uppercase tracking-widest text-slate-200">Artículos</h4>
                  </div>
                  <span className="font-mono text-[10.5px] text-slate-400">{openSale.lines.length} línea{openSale.lines.length===1?'':'s'}</span>
                </div>
                <ul className="divide-y divide-[#1a3a5a] rounded-xl border border-[#1a3a5a] bg-[#0c2a47] overflow-hidden">
                  {openSale.lines.map((l, i) => (
                    <li key={`${l.itemId}-${i}`} className="px-3 py-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-[12px] font-semibold text-slate-100 leading-snug">{l.name}</p>
                          <div className="flex items-center gap-2 mt-1 flex-wrap">
                            {l.sku ? <span className="text-[10px] font-mono text-slate-400 rounded-md border border-[#1a3a5a] bg-white/[0.02] px-1.5 py-0.5">SKU: {l.sku}</span> : null}
                            <span className="text-[10.5px] text-slate-300 font-semibold">
                              {l.qty} × {fmt$(l.unitPrice)}
                            </span>
                          </div>
                        </div>
                        <p className="font-mono text-[13px] font-bold text-white whitespace-nowrap">{fmt$(l.importe)}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        )}
      </aside>
    </div>
  )
}
