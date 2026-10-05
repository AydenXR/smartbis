import { Fragment, useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Plus, Settings2, Trash2, X } from 'lucide-react'
import { posAdministrationConfig, posAdministrationConfigSave, posCatalog, posPurchases, posSales, type PosCatalogItem, type PosPurchaseOrder, type PosSale } from '@/lib/api'

type Config = import('@/lib/api').PosAdministrationConfig
const defaults: Config = { workingDaysByMonth: {}, expenses: [{ id: 'luz', name: 'Luz', amount: 0 }, { id: 'agua', name: 'Agua', amount: 0 }, { id: 'internet', name: 'Internet', amount: 0 }, { id: 'salary-1', name: 'Salario · Persona 1', amount: 0 }] }
const currency = (n: number) => `$${n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const monthName = (d: Date) => new Intl.DateTimeFormat('es-MX', { month: 'long', year: 'numeric' }).format(d)
const localMonth = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }

export default function CrmAdministrationView() {
  const [sales, setSales] = useState<PosSale[]>([])
  const [purchases, setPurchases] = useState<PosPurchaseOrder[]>([])
  const [catalog, setCatalog] = useState<PosCatalogItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [month, setMonth] = useState(localMonth)
  const [config, setConfig] = useState<Config>(defaults)
  const [draft, setDraft] = useState<Config>(defaults)
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState(false)
  const [expandedDay, setExpandedDay] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    const [year, mon] = month.split('-').map(Number)
    const from = `${month}-01T00:00:00`
    const to = `${month}-${String(new Date(year, mon, 0).getDate()).padStart(2, '0')}T23:59:59.999`
    setLoading(true); setError('')
    Promise.all([posSales({ from, to }), posPurchases(), posCatalog({ activeOnly: false }), posAdministrationConfig()])
      .then(([s, p, c, configResult]) => {
        if (cancelled) return
        setSales(s.sales || []); setPurchases(p.purchases || []); setCatalog(c.items || [])
        if (configResult.config) {
          const loaded = { ...defaults, ...configResult.config, workingDaysByMonth: configResult.config.workingDaysByMonth || {} }
          loaded.expenses = loaded.expenses.filter(item => !(item.id.match(/^salary-[123]$/) && item.amount === 0 && /^Salarios · Persona [123]$/.test(item.name)))
          if (!loaded.expenses.some(item => item.id.startsWith('salary-'))) loaded.expenses.push({ id: 'salary-1', name: 'Salario · Persona 1', amount: 0 })
          setConfig(loaded)
        }
      })
      .catch(e => { if (!cancelled) setError(e?.message || 'No se pudieron cargar los movimientos.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [month])
  const costById = useMemo(() => new Map(catalog.map(i => [i.id, Number(i.costPrice || i.lastPurchaseCost || 0)])), [catalog])
  const report = useMemo(() => {
    const [year, mon] = month.split('-').map(Number)
    const days = new Date(year, mon, 0).getDate()
    const selectedWorkDays = config.workingDaysByMonth[month] || Array.from({ length: days }, (_, index) => index + 1)
    const validWorkDays = selectedWorkDays.filter(day => Number.isInteger(day) && day >= 1 && day <= days)
    const workingDaySet = new Set(validWorkDays)
    const workDays = validWorkDays.length
    const today = new Date()
    const currentMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`
    const lastElapsedDay = month < currentMonth ? days : month > currentMonth ? 0 : today.getDate()
    const fixed = config.expenses.reduce((sum, e) => sum + (Number(e.amount) || 0), 0)
    const inMonth = (iso: string) => iso.slice(0, 7) === month
    const monthSales = sales.filter(s => s.status === 'paid' && inMonth(s.createdAt))
    const monthPurchases = purchases.filter(p => inMonth(p.date || p.createdAt))
    const rows = Array.from({ length: days }, (_, index) => {
      const day = `${month}-${String(index + 1).padStart(2, '0')}`
      const saleRows = monthSales.filter(s => s.createdAt.slice(0, 10) === day)
      const purchaseRows = monthPurchases.filter(p => (p.date || p.createdAt).slice(0, 10) === day)
      const revenue = saleRows.reduce((sum, s) => sum + Number(s.total || 0), 0)
      const cost = saleRows.reduce((sum, s) => sum + s.lines.reduce((v, l) => v + Number(l.costTotal ?? Number(l.qty || 0) * (costById.get(l.itemId) || 0)), 0), 0)
      const purchaseTotal = purchaseRows.reduce((sum, p) => sum + Number(p.total || 0), 0)
      const gross = revenue - cost
      const fixedDaily = workDays ? fixed / workDays : 0
      return { day, revenue, gross, purchases: purchaseTotal, fixedDaily, net: gross - fixedDaily, saleRows, purchaseRows }
    })
    const workRows = rows.filter(row => {
      const dayNumber = Number(row.day.slice(-2))
      return dayNumber <= lastElapsedDay && workingDaySet.has(dayNumber)
    })
    const totalRevenue = rows.reduce((a, r) => a + r.revenue, 0)
    const totalGross = rows.reduce((a, r) => a + r.gross, 0)
    const net = totalGross - fixed
    return { days, workDays, fixed, rows: workRows, totalRevenue, totalGross, totalPurchases: rows.reduce((a, r) => a + r.purchases, 0), net, dailyNetAverage: workDays ? net / workDays : 0 }
  }, [catalog, config, month, purchases, sales])
  const daysInMonth = report.days
  const draftWorkDays = draft.workingDaysByMonth[month] || Array.from({ length: daysInMonth }, (_, index) => index + 1)
  const draftWorkDaySet = new Set(draftWorkDays)
  const firstWeekdayOffset = (new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 1).getDay() + 6) % 7
  function toggleWorkday(day: number) {
    const nextDays = draftWorkDaySet.has(day) ? draftWorkDays.filter(item => item !== day) : [...draftWorkDays, day].sort((a, b) => a - b)
    setDraft({ ...draft, workingDaysByMonth: { ...draft.workingDaysByMonth, [month]: nextDays } })
  }
  async function saveConfig(next: Config) { setSaving(true); setError(''); try { const result = await posAdministrationConfigSave(next); setConfig(result.config); setEditing(false) } catch (e: any) { setError(e?.message || 'No se pudo guardar la configuración.') } finally { setSaving(false) } }
  return <div className="h-full overflow-y-auto bg-[#0c2a47] p-5 text-white md:p-8">
    <div className="mx-auto max-w-7xl space-y-5">
      <header className="flex flex-wrap items-center gap-3"><div className="flex-1"><p className="text-[11px] font-bold uppercase tracking-[.2em] text-[#5bbfe5]">Punto de Venta · #7</p><h1 className="mt-1 text-2xl font-extrabold">Administración</h1><p className="mt-1 text-sm text-slate-400">Ventas, costo de producto, compras y utilidad después de gastos fijos.</p></div><input type="month" value={month} onChange={e => setMonth(e.target.value)} className="rounded-xl border border-[#255074] bg-[#0b2641] px-3 py-2 text-sm"/><button onClick={() => { setDraft({ ...config, workingDaysByMonth: { ...config.workingDaysByMonth }, expenses: config.expenses.map(item => ({ ...item })) }); setEditing(true) }} className="inline-flex items-center gap-2 rounded-xl border border-[#255074] bg-[#0f3151] px-4 py-2 text-sm font-bold"><Settings2 className="h-4 w-4"/> Configurar gastos</button></header>
      {error && <div className="rounded-xl border border-rose-400/30 bg-rose-400/10 p-3 text-sm text-rose-200">{error}</div>}
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[[`Días del mes`, report.days], ['Días laborables', report.workDays], ['Ventas', currency(report.totalRevenue)], ['Utilidad bruta estimada', currency(report.totalGross)], ['Gastos mensuales', currency(report.fixed)], ['Utilidad mensual neta', currency(report.net)], ['Utilidad neta promedio por día laborable', currency(report.dailyNetAverage)]].map(([label, value]) => <div key={String(label)} className="rounded-2xl border border-[#1a3a5a] bg-[#0f3151] p-4"><p className="text-xs text-slate-400">{label}</p><p className="mt-2 text-xl font-extrabold">{value}</p></div>)}</section>
      <div className="rounded-2xl border border-[#1a3a5a] bg-[#0f3151] p-4 text-sm text-slate-300">{monthName(new Date(`${month}-02T12:00:00`))}: {report.days} días · {report.days - report.workDays} descansos · {report.workDays} días laborables. Luz, agua, internet y salarios son montos mensuales; el total de {currency(report.fixed)} se distribuye entre los días marcados como laborables ({report.workDays ? currency(report.fixed / report.workDays) : '—'} por día). La utilidad mensual resta esos gastos una sola vez.</div>
      <div className="overflow-x-auto rounded-2xl border border-[#1a3a5a] bg-[#0f3151]"><table className="w-full min-w-[900px] text-left text-sm"><thead className="bg-[#0b2641] text-xs uppercase tracking-wide text-slate-400"><tr>{['Día','Ventas','Ganancia de venta','Compras','Gasto fijo asignado por día laboral','Utilidad estimada si fue laborable'].map(x => <th key={x} className="px-4 py-3">{x}</th>)}</tr></thead><tbody>{report.rows.map(r => <Fragment key={r.day}><tr tabIndex={0} aria-expanded={expandedDay === r.day} onClick={() => setExpandedDay(expandedDay === r.day ? null : r.day)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpandedDay(expandedDay === r.day ? null : r.day) } }} className="cursor-pointer border-t border-[#1a3a5a] transition hover:bg-[#164064] focus:bg-[#164064] focus:outline-none"><td className="px-4 py-3"><span className="inline-flex items-center gap-2">{expandedDay === r.day ? <ChevronDown className="h-4 w-4 text-[#5bbfe5]"/> : <ChevronRight className="h-4 w-4 text-slate-500"/>}{new Date(`${r.day}T12:00:00`).toLocaleDateString('es-MX', { day: '2-digit', month: 'short' })}<span className="text-xs text-slate-500">· Ver desglose</span></span></td><td className="px-4 py-3">{currency(r.revenue)}</td><td className="px-4 py-3">{currency(r.gross)}</td><td className="px-4 py-3">{currency(r.purchases)}</td><td className="px-4 py-3">{currency(r.fixedDaily)}</td><td className={`px-4 py-3 font-bold ${r.net >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>{currency(r.net)}</td></tr>{expandedDay === r.day && <tr key={`${r.day}-details`} className="border-t border-[#1a3a5a] bg-[#0b2641]/70"><td colSpan={6} className="p-4"><div className="grid gap-4 lg:grid-cols-2"><section><h3 className="mb-2 text-sm font-bold text-[#7fd2ff]">Ventas del día ({r.saleRows.length})</h3>{r.saleRows.length ? <div className="space-y-3">{r.saleRows.map(s => <div key={s.id} className="rounded-xl border border-[#255074] p-3"><div className="mb-2 flex flex-wrap justify-between gap-2 text-xs text-slate-400"><span>{new Date(s.createdAt).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })} · {s.customerName || 'Venta mostrador'} · {s.userEmail}</span><span className="font-bold text-white">Total {currency(s.total)}</span></div><div className="space-y-1">{s.lines.map((l, i) => { const itemCost = Number(l.costTotal ?? Number(l.qty || 0) * (costById.get(l.itemId) || 0)); return <div key={`${s.id}-${i}`} className="grid grid-cols-[1fr_auto] gap-2 text-xs"><span>{l.name} × {l.qty} <span className="text-slate-500">(venta {currency(l.importe)} · costo {currency(itemCost)})</span></span><span className="text-emerald-300">{currency(l.importe - itemCost)}</span></div> })}</div></div>)}</div> : <p className="text-xs text-slate-500">No hubo ventas registradas.</p>}</section><section><h3 className="mb-2 text-sm font-bold text-[#7fd2ff]">Compras del día ({r.purchaseRows.length})</h3>{r.purchaseRows.length ? <div className="space-y-3">{r.purchaseRows.map(p => <div key={p.id} className="rounded-xl border border-[#255074] p-3"><div className="mb-2 flex flex-wrap justify-between gap-2 text-xs text-slate-400"><span>{p.providerName || 'Proveedor'}{p.folio ? ` · Folio ${p.folio}` : ''}</span><span className="font-bold text-white">Total {currency(p.total)}</span></div><div className="space-y-1">{p.lines.map((l, i) => <div key={`${p.id}-${i}`} className="grid grid-cols-[1fr_auto] gap-2 text-xs"><span>{l.productName || l.newItemName || catalog.find(item => item.id === l.itemId)?.name || 'Producto'} × {l.qty} <span className="text-slate-500">(costo unitario {currency(l.unitCost)})</span></span><span>{currency(l.totalCost ?? l.qty * l.unitCost + Number(l.shippingCost || 0))}</span></div>)}</div></div>)}</div> : <p className="text-xs text-slate-500">No hubo compras registradas.</p>}<div className="mt-4 rounded-xl border border-[#255074] p-3"><h4 className="mb-1 text-xs font-bold text-slate-300">Gasto fijo distribuido</h4>{config.expenses.filter(exp => exp.amount > 0).length ? config.expenses.filter(exp => exp.amount > 0).map(exp => <div key={exp.id} className="flex justify-between gap-2 text-xs text-slate-400"><span>{exp.name}</span><span>{currency(report.workDays ? exp.amount / report.workDays : 0)}</span></div>) : <p className="text-xs text-slate-500">No hay gastos fijos configurados.</p>}<div className="mt-1 flex justify-between border-t border-[#255074] pt-1 text-xs font-bold"><span>Total del día laborable</span><span>{currency(r.fixedDaily)}</span></div></div></section></div></td></tr>}</Fragment>)}</tbody></table></div>
      {loading && <div className="text-sm text-slate-400">Cargando movimientos...</div>}
      <p className="text-xs text-slate-500">Las ventas nuevas calculan su costo real por lote usando FIFO (primero se vende la existencia más antigua); las ventas previas a este control se estiman con el costo del catálogo. La utilidad neta diaria promedio es (utilidad bruta del mes − gastos mensuales) ÷ días laborables. Compras se muestran por fecha sin descontarse otra vez, porque el costo del producto vendido ya está en la ganancia bruta.</p>
    </div>
    {editing && <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4" onMouseDown={e => { if (e.target === e.currentTarget && !saving) setEditing(false) }}>
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-[#255074] bg-[#0f3151] p-5 shadow-2xl">
        <div className="mb-4 flex items-center"><div className="flex-1"><h2 className="text-lg font-extrabold">Configuración mensual</h2><p className="text-xs text-slate-400">Selecciona los días que se trabaja. Los días sin marcar cuentan como descanso.</p></div><button onClick={() => setEditing(false)} aria-label="Cerrar"><X className="h-5 w-5"/></button></div>
        <section className="rounded-xl border border-[#255074] bg-[#0b2641]/70 p-4">
          <div className="mb-3 flex flex-wrap items-center gap-2"><p className="mr-auto text-sm font-bold">Días laborables · {monthName(new Date(`${month}-02T12:00:00`))}</p><button type="button" onClick={() => setDraft({ ...draft, workingDaysByMonth: { ...draft.workingDaysByMonth, [month]: Array.from({ length: daysInMonth }, (_, index) => index + 1) } })} className="text-xs font-semibold text-[#7fd2ff]">Marcar todos</button><button type="button" onClick={() => setDraft({ ...draft, workingDaysByMonth: { ...draft.workingDaysByMonth, [month]: [] } })} className="text-xs font-semibold text-slate-300">Desmarcar todos</button></div>
          <div className="grid grid-cols-7 justify-items-center gap-2">{['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'].map(day => <span key={day} className="mb-1 text-[10px] font-bold uppercase text-slate-500">{day}</span>)}{Array.from({ length: firstWeekdayOffset }, (_, index) => <span key={`empty-${index}`} />)}{Array.from({ length: daysInMonth }, (_, index) => { const day = index + 1; const works = draftWorkDaySet.has(day); return <button key={day} type="button" aria-pressed={works} aria-label={`${day} de ${monthName(new Date(`${month}-02T12:00:00`))}: ${works ? 'laborable' : 'descanso'}`} title={works ? 'Laborable · pulsa para marcar descanso' : 'Descanso · pulsa para marcar laborable'} onClick={() => toggleWorkday(day)} className={`flex h-9 w-9 items-center justify-center rounded-full border text-xs font-bold transition ${works ? 'border-emerald-300 bg-emerald-400/20 text-emerald-100' : 'border-[#35516c] bg-[#102c47] text-slate-500 hover:border-slate-400'}`}>{day}</button> })}</div>
          <div className="mt-3 flex items-center gap-4 text-[11px] text-slate-400"><span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded-full border border-emerald-300 bg-emerald-400/20"/> Se trabaja</span><span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded-full border border-[#35516c]"/> Descanso</span></div>
          <p className="mt-2 text-xs text-slate-400">{draftWorkDays.length} laborables · {daysInMonth - draftWorkDays.length} descansos</p>
        </section>
        <p className="mb-3 mt-5 text-xs text-slate-400">Importes mensuales de gastos fijos y salarios.</p>
        <div className="space-y-3">{draft.expenses.map(exp => <div key={exp.id} className="grid grid-cols-[1fr_130px_36px] items-center gap-2 text-sm"><input aria-label="Concepto del gasto" value={exp.name} onChange={e => setDraft({ ...draft, expenses: draft.expenses.map(item => item.id === exp.id ? { ...item, name: e.target.value } : item) })} className="min-w-0 rounded-lg border border-[#255074] bg-[#0b2641] px-3 py-2"/><input aria-label={`Importe mensual de ${exp.name}`} type="number" min="0" step="0.01" value={exp.amount} onChange={e => setDraft({ ...draft, expenses: draft.expenses.map(item => item.id === exp.id ? { ...item, amount: Number(e.target.value) } : item) })} className="min-w-0 rounded-lg border border-[#255074] bg-[#0b2641] px-3 py-2"/><button type="button" aria-label={`Quitar ${exp.name}`} onClick={() => setDraft({ ...draft, expenses: draft.expenses.filter(item => item.id !== exp.id) })} className="flex h-9 w-9 items-center justify-center rounded-lg text-rose-300 hover:bg-rose-400/10"><Trash2 className="h-4 w-4"/></button></div>)}</div>
        <button type="button" onClick={() => setDraft({ ...draft, expenses: [...draft.expenses, { id: `expense-${Date.now()}`, name: 'Nuevo gasto fijo', amount: 0 }] })} className="mt-4 inline-flex items-center gap-2 rounded-lg border border-[#255074] px-3 py-2 text-sm font-bold"><Plus className="h-4 w-4"/> Agregar gasto fijo</button>
        <button disabled={saving} onClick={() => void saveConfig(draft)} className="mt-5 w-full rounded-xl bg-[#1090D0] px-4 py-2.5 font-bold disabled:opacity-60">{saving ? 'Guardando...' : 'Guardar configuración'}</button>
      </div>
    </div>}
  </div>
}
