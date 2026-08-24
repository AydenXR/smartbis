import { useEffect, useState } from 'react'
import { ScrollText, Search, Calendar, ChevronDown, ChevronUp, RefreshCw, AlertCircle, X, Building2, Clock } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  type PosAuditLog,
  type PosBranch,
  posAudit,
  posBranches,
} from '@/lib/api'

function formatDateTime(iso: string) {
  try {
    const d = new Date(iso)
    const dd = String(d.getDate()).padStart(2, '0')
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const yyyy = d.getFullYear()
    const HH = String(d.getHours()).padStart(2, '0')
    const Mi = String(d.getMinutes()).padStart(2, '0')
    return `${dd}/${mm}/${yyyy} ${HH}:${Mi}`
  } catch {
    return iso
  }
}

function kindBadgeClass(kind: string) {
  const k = kind.toLowerCase()
  if (k.includes('sale') || k.includes('venta')) {
    return 'border-emerald-400/30 bg-emerald-500/15 text-emerald-200'
  }
  if (k.includes('purchase') || k.includes('compra')) {
    return 'border-violet-400/30 bg-violet-500/15 text-violet-200'
  }
  if (k.includes('stock') || k.includes('invent')) {
    return 'border-amber-400/30 bg-amber-500/15 text-amber-200'
  }
  if (k.includes('login') || k.includes('auth') || k.includes('session')) {
    return 'border-[#1090D0]/40 bg-[#1090D0]/15 text-[#5bbfe5]'
  }
  if (k.includes('delete') || k.includes('cancel') || k.includes('error')) {
    return 'border-rose-500/30 bg-rose-500/15 text-rose-200'
  }
  if (k.includes('shift') || k.includes('turno') || k.includes('withdraw')) {
    return 'border-cyan-400/30 bg-cyan-500/15 text-cyan-200'
  }
  if (k.includes('user') || k.includes('cuenta') || k.includes('account')) {
    return 'border-indigo-400/30 bg-indigo-500/15 text-indigo-200'
  }
  if (k.includes('branch') || k.includes('sucurs')) {
    return 'border-teal-400/30 bg-teal-500/15 text-teal-200'
  }
  return 'border-slate-500/40 bg-slate-500/15 text-slate-200'
}

export default function CrmAuditRecordsView() {
  const [logs, setLogs] = useState<PosAuditLog[]>([])
  const [branches, setBranches] = useState<PosBranch[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [limit, setLimit] = useState<50 | 200 | 500>(50)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  async function loadBranches() {
    try {
      const res = await posBranches()
      setBranches(res.branches)
    } catch {}
  }

  async function loadLogs() {
    setLoading(true)
    setError('')
    try {
      const res = await posAudit({
        limit,
        search: search.trim() || undefined,
        from: fromDate || undefined,
        to: toDate || undefined,
      })
      setLogs(res.logs)
    } catch (e: any) {
      setError(e?.message || 'No se pudieron cargar los registros')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadBranches()
    void loadLogs()
  }, [])

  function branchName(id?: string) {
    if (!id) return null
    return branches.find((b) => b.id === id)?.name || null
  }

  return (
    <section className="flex min-h-0 w-full flex-col overflow-hidden bg-[#0c2a47] px-6 py-6 text-white">
      <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-[16px] bg-[#1090D0]/15 text-[#5bbfe5]">
            <ScrollText className="h-5 w-5" />
          </div>
          <h2 className="text-[22px] font-bold tracking-tight text-slate-50">
            Registros · Auditoría
          </h2>
        </div>
        <div className="flex items-center gap-2">
          {error ? (
            <div className="flex items-center gap-2 rounded-[14px] border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-[11.5px] text-rose-200">
              <AlertCircle className="h-3.5 w-3.5" />
              {error}
            </div>
          ) : null}
          <button
            type="button"
            onClick={() => void loadLogs()}
            disabled={loading}
            className="flex h-9 items-center gap-2 rounded-[14px] border border-[#1a3a5a] bg-[#11375a] px-3.5 text-[12px] font-semibold text-slate-200 transition hover:border-[#1090D0]/40 disabled:opacity-50"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
            Refrescar
          </button>
        </div>
      </header>

      <div className="mb-4 flex flex-wrap items-end gap-3 rounded-[20px] border border-[#1a3a5a] bg-[#0f3151] p-4">
        <div className="flex-1 min-w-[200px]">
          <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
            Búsqueda
          </label>
          <div className="flex items-center gap-2 rounded-[14px] border border-[#1a3a5a] bg-[#0b2641] px-3 py-2.5 focus-within:border-[#1090D0]/50">
            <Search className="h-4 w-4 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void loadLogs()
              }}
              placeholder="Buscar por usuario, mensaje, tipo..."
              className="flex-1 bg-transparent text-[13.5px] text-slate-100 placeholder:text-slate-500 focus:outline-none"
            />
          </div>
        </div>

        <div className="w-full sm:w-auto">
          <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
            Desde
          </label>
          <div className="flex items-center gap-2 rounded-[14px] border border-[#1a3a5a] bg-[#0b2641] px-3 py-2.5 focus-within:border-[#1090D0]/50">
            <Calendar className="h-4 w-4 text-slate-400" />
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="bg-transparent text-[13.5px] text-slate-100 focus:outline-none [color-scheme:dark]"
            />
          </div>
        </div>

        <div className="w-full sm:w-auto">
          <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
            Hasta
          </label>
          <div className="flex items-center gap-2 rounded-[14px] border border-[#1a3a5a] bg-[#0b2641] px-3 py-2.5 focus-within:border-[#1090D0]/50">
            <Calendar className="h-4 w-4 text-slate-400" />
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="bg-transparent text-[13.5px] text-slate-100 focus:outline-none [color-scheme:dark]"
            />
          </div>
        </div>

        <div className="w-full sm:w-auto">
          <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
            Límite
          </label>
          <div className="flex gap-1 rounded-[14px] border border-[#1a3a5a] bg-[#0b2641] p-1">
            {([50, 200, 500] as const).map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setLimit(n)}
                className={cn(
                  'rounded-[10px] px-3.5 py-1.5 text-[12px] font-bold transition',
                  limit === n
                    ? 'bg-[#1090D0] text-white shadow-inner'
                    : 'text-slate-300 hover:text-white',
                )}
              >
                {n}
              </button>
            ))}
          </div>
        </div>

        <button
          type="button"
          onClick={() => void loadLogs()}
          disabled={loading}
          className="h-[42px] rounded-[14px] bg-[#1090D0] px-5 text-[12.5px] font-bold text-white transition hover:bg-[#0c79ae] disabled:opacity-50"
        >
          Aplicar filtros
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-[20px] border border-[#1a3a5a] bg-[#0f3151]">
        {loading && logs.length === 0 ? (
          <div className="flex items-center justify-center py-12 text-[12.5px] text-slate-400">
            <RefreshCw className="mr-2 h-4 w-4 animate-spin text-[#1090D0]" />
            Cargando registros...
          </div>
        ) : logs.length === 0 ? (
          <div className="py-16 text-center text-[12.5px] text-slate-400">
            No se encontraron registros de auditoría.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead className="sticky top-0 z-10 border-b border-[#1a3a5a] bg-[#0b2641]/90 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400 backdrop-blur">
                <tr>
                  <th className="px-5 py-3 w-[170px]">Fecha</th>
                  <th className="px-5 py-3">Usuario</th>
                  <th className="px-5 py-3">Sucursal</th>
                  <th className="px-5 py-3">Tipo</th>
                  <th className="px-5 py-3">Mensaje</th>
                  <th className="px-5 py-3 w-10"></th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log, idx) => {
                  const expanded = expandedId === log.id
                  return (
                    <>
                      <tr
                        key={log.id}
                        className={cn(
                          'border-b border-[#1a3a5a]/40 hover:bg-[#11375a]/40 cursor-pointer',
                          expanded && 'bg-[#11375a]/60',
                        )}
                        onClick={() => setExpandedId(expanded ? null : log.id)}
                      >
                        <td className="px-5 py-3 align-top">
                          <div className="flex items-center gap-2 text-slate-200">
                            <Clock className="h-3.5 w-3.5 text-slate-400" />
                            <span className="font-mono text-[12.5px]">{formatDateTime(log.at)}</span>
                          </div>
                          {idx === 0 ? null : null}
                        </td>
                        <td className="px-5 py-3 align-top">
                          <div className="font-medium text-slate-100">{log.userEmail}</div>
                          {log.role ? (
                            <div className="text-[11px] text-slate-400">
                              {log.role === 'admin' ? 'Admin' : 'Caja'}
                            </div>
                          ) : null}
                        </td>
                        <td className="px-5 py-3 align-top">
                          {branchName(log.branchId) ? (
                            <span className="inline-flex items-center gap-1.5 rounded-[10px] bg-[#0b2641]/70 px-2.5 py-1 text-[11.5px] text-slate-200">
                              <Building2 className="h-3 w-3 text-slate-400" />
                              {branchName(log.branchId)}
                            </span>
                          ) : (
                            <span className="text-slate-500">—</span>
                          )}
                        </td>
                        <td className="px-5 py-3 align-top">
                          <span
                            className={cn(
                              'inline-flex rounded-full border px-2.5 py-1 text-[10.5px] font-bold uppercase tracking-wider',
                              kindBadgeClass(log.kind),
                            )}
                          >
                            {log.kind}
                          </span>
                        </td>
                        <td className="px-5 py-3 align-top">
                          <div className="max-w-xl text-[13px] text-slate-200">{log.message}</div>
                        </td>
                        <td className="px-5 py-3 align-top text-right">
                          <button
                            type="button"
                            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition hover:bg-[#0b2641] hover:text-[#5bbfe5]"
                          >
                            {expanded ? (
                              <ChevronUp className="h-4 w-4" />
                            ) : (
                              <ChevronDown className="h-4 w-4" />
                            )}
                          </button>
                        </td>
                      </tr>
                      {expanded && log.details ? (
                        <tr key={`${log.id}-details`} className="bg-[#0b2641]/60">
                          <td colSpan={6} className="px-5 py-4">
                            <div className="flex items-start gap-3">
                              <div className="flex-1 overflow-hidden rounded-[14px] border border-[#1a3a5a] bg-[#0c2a47] p-4">
                                <div className="mb-2 flex items-center justify-between">
                                  <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                                    Detalles (JSON)
                                  </div>
                                </div>
                                <pre className="overflow-x-auto font-mono text-[11.5px] leading-relaxed text-slate-200">
                                  {JSON.stringify(log.details, null, 2)}
                                </pre>
                              </div>
                              <button
                                type="button"
                                onClick={() => setExpandedId(null)}
                                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[#1a3a5a] bg-[#0f3151] text-slate-400 transition hover:bg-[#11375a] hover:text-white"
                              >
                                <X className="h-4 w-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  )
}
