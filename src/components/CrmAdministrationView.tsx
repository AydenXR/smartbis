import { Fragment, useEffect, useMemo, useState } from 'react'
import { Download, RefreshCw } from 'lucide-react'
import { posCatalog, posSales, type PosCatalogItem, type PosSale } from '@/lib/api'
import {
  buildSalesProfitReport,
  createSalesProfitWorkbook,
  getReportDateRange,
  type ReportPeriod,
  type SalesProfitRow,
} from '@/lib/salesProfitReport'

const today = () => {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function localDateTimeToIso(date: string, time: string, endOfMinute = false) {
  const value = new Date(`${date}T${time}:${endOfMinute ? '59.999' : '00.000'}`)
  return Number.isNaN(value.getTime()) ? '' : value.toISOString()
}

const currency = (value: number) => value.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })
const dateLabel = (value: string) => new Date(`${value}T12:00:00`).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })
const percent = (value: number) => `${(value * 100).toLocaleString('es-MX', { maximumFractionDigits: 2 })}%`
const marginClass = (margin: number) =>
  margin >= 0.5 ? 'bg-emerald-400/20 text-emerald-300' : margin >= 0.2 ? 'bg-amber-400/20 text-amber-300' : 'bg-rose-400/20 text-rose-300'
const tableHeadings = ['Categoría', 'Código', 'Producto', 'Cantidad', 'Venta bruta', 'Descuento', 'Venta neta', 'Costo total', 'Costo unit.', 'Utilidad bruta', 'Margen']
const inputClass = 'rounded-xl border border-[#255074] bg-[#0b2641] px-3 py-2 text-sm text-white'

const periodOptions: Array<{ value: ReportPeriod; label: string }> = [
  { value: 'day', label: 'Día' },
  { value: 'week', label: 'Semana' },
  { value: 'month', label: 'Mes' },
  { value: 'year', label: 'Año' },
]

export default function CrmAdministrationView() {
  const [fromDate, setFromDate] = useState(today)
  const [toDate, setToDate] = useState(today)
  const [fromTime, setFromTime] = useState('09:00')
  const [toTime, setToTime] = useState('18:00')
  const [sales, setSales] = useState<PosSale[]>([])
  const [catalog, setCatalog] = useState<PosCatalogItem[]>([])
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)

  const from = localDateTimeToIso(fromDate, fromTime)
  const to = localDateTimeToIso(toDate, toTime, true)
  const validRange = Boolean(from && to && from <= to)

  useEffect(() => {
    let cancelled = false
    if (!validRange) {
      setSales([])
      setError('Revisa el rango: la fecha y hora inicial deben ser anteriores a las finales.')
      setLoading(false)
      return
    }

    setLoading(true)
    setError('')
    Promise.all([
      posSales({ from, to, status: 'paid' }),
      posCatalog({ activeOnly: false }),
    ])
      .then(([salesResult, catalogResult]) => {
        if (cancelled) return
        setSales(salesResult.sales || [])
        setCatalog(catalogResult.items || [])
      })
      .catch((cause: unknown) => {
        if (cancelled) return
        setError(cause instanceof Error ? cause.message : 'No se pudo cargar el reporte.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [from, to, validRange, refreshKey])

  const report = useMemo(
    () => buildSalesProfitReport(sales, catalog, { from: fromDate, to: toDate, fromTime, toTime }),
    [sales, catalog, fromDate, toDate, fromTime, toTime],
  )

  function applyPeriod(period: ReportPeriod) {
    const range = getReportDateRange(fromDate || today(), period)
    setFromDate(range.from)
    setToDate(range.to)
  }

  async function downloadReport() {
    setExporting(true)
    setError('')
    try {
      const [workbook, XLSX] = await Promise.all([
        createSalesProfitWorkbook(report, { from: fromDate, to: toDate }),
        import('xlsx'),
      ])
      const safeFrom = fromDate.replace(/-/g, '')
      const safeTo = toDate.replace(/-/g, '')
      XLSX.writeFile(workbook, `reporte-venta-utilidad-${safeFrom}-${safeTo}.xlsx`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo generar el archivo de Excel.')
    } finally {
      setExporting(false)
    }
  }

  const groups = useMemo(() => {
    const map = new Map<string, SalesProfitRow[]>()
    for (const row of report.products) {
      map.set(row.category, [...(map.get(row.category) || []), row])
    }
    return [...map.entries()].map(([category, rows]) => {
      const sum = (pick: (row: SalesProfitRow) => number) => rows.reduce((total, row) => total + pick(row), 0)
      const netSales = sum((row) => row.netSales)
      const grossProfit = sum((row) => row.grossProfit)
      return {
        category,
        rows,
        quantity: sum((row) => row.quantity),
        grossSales: sum((row) => row.grossSales),
        discount: sum((row) => row.discount),
        netSales,
        totalCost: sum((row) => row.totalCost),
        grossProfit,
        margin: netSales ? grossProfit / netSales : 0,
      }
    })
  }, [report.products])

  const summary = [
    { label: 'Productos vendidos', value: report.products.length.toLocaleString('es-MX'), accent: 'border-l-slate-400', text: 'text-white' },
    { label: 'Unidades', value: report.quantity.toLocaleString('es-MX'), accent: 'border-l-slate-400', text: 'text-white' },
    { label: 'Venta bruta', value: currency(report.grossSales), accent: 'border-l-sky-400', text: 'text-sky-300' },
    { label: 'Descuentos', value: currency(report.discount), accent: 'border-l-amber-400', text: 'text-amber-300' },
    { label: 'Venta neta', value: currency(report.netSales), accent: 'border-l-cyan-300', text: 'text-cyan-200' },
    { label: 'Costo total', value: currency(report.totalCost), accent: 'border-l-rose-400', text: 'text-rose-300' },
    { label: 'Utilidad bruta', value: currency(report.grossProfit), accent: 'border-l-emerald-400', text: report.grossProfit < 0 ? 'text-rose-400' : 'text-emerald-300' },
  ]

  return (
    <div className="h-full overflow-y-auto bg-[#0c2a47] p-5 text-white md:p-8">
      <div className="mx-auto max-w-7xl space-y-5">
        <header className="flex flex-wrap items-center gap-3">
          <div className="min-w-[220px] flex-1">
            <p className="text-[11px] font-bold uppercase tracking-[.2em] text-[#5bbfe5]">Punto de Venta · #7</p>
            <h1 className="mt-1 text-2xl font-extrabold">Reporte de venta con utilidad</h1>
            <p className="mt-1 text-sm text-slate-400">Ventas pagadas, productos, descuentos y costo real de lo vendido.</p>
          </div>
          <button
            type="button"
            onClick={() => setRefreshKey((key) => key + 1)}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-xl border border-[#255074] bg-[#0f3151] px-4 py-2 text-sm font-bold disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Actualizar
          </button>
          <button
            type="button"
            onClick={downloadReport}
            disabled={!validRange || loading || exporting}
            className="inline-flex items-center gap-2 rounded-xl bg-[#1090D0] px-4 py-2 text-sm font-bold text-white hover:bg-[#0b80bb] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Download className="h-4 w-4" />
            {exporting ? 'Generando Excel...' : 'Descargar Excel'}
          </button>
        </header>

        <section className="space-y-4 rounded-2xl border border-[#1a3a5a] bg-[#0f3151] p-4">
          <div className="flex flex-wrap gap-2" aria-label="Periodos del reporte">
            {periodOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => applyPeriod(option.value)}
                className="rounded-lg border border-[#255074] px-3 py-1.5 text-sm font-semibold text-slate-200 transition hover:bg-[#164064]"
              >
                {option.label}
              </button>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="space-y-1 text-xs font-semibold text-slate-300">
              <span>Desde</span>
              <input aria-label="Fecha inicial" className={`${inputClass} block w-full`} type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} />
            </label>
            <label className="space-y-1 text-xs font-semibold text-slate-300">
              <span>Hasta</span>
              <input aria-label="Fecha final" className={`${inputClass} block w-full`} type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} />
            </label>
            <label className="space-y-1 text-xs font-semibold text-slate-300">
              <span>Hora inicial diaria</span>
              <input aria-label="Hora inicial diaria" className={`${inputClass} block w-full`} type="time" value={fromTime} onChange={(event) => setFromTime(event.target.value)} />
            </label>
            <label className="space-y-1 text-xs font-semibold text-slate-300">
              <span>Hora final diaria</span>
              <input aria-label="Hora final diaria" className={`${inputClass} block w-full`} type="time" value={toTime} onChange={(event) => setToTime(event.target.value)} />
            </label>
          </div>
          <p className="text-xs text-slate-400">
            {fromDate && toDate ? `${dateLabel(fromDate)} al ${dateLabel(toDate)}` : 'Selecciona un rango de fechas'} ·
            {' '}se aplica el horario {fromTime}–{toTime} a cada día. Al abrir, queda seleccionado hoy de 09:00 a 18:00.
          </p>
        </section>

        {error && <div role="alert" className="rounded-xl border border-rose-400/30 bg-rose-400/10 p-3 text-sm text-rose-200">{error}</div>}
        {loading && <div role="status" className="text-sm text-slate-400">Cargando ventas...</div>}

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {summary.map((card) => (
            <div key={card.label} className={`rounded-2xl border border-l-4 border-[#1a3a5a] bg-[#0f3151] p-4 ${card.accent}`}>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{card.label}</p>
              <p className={`mt-2 text-xl font-extrabold ${card.text}`}>{card.value}</p>
            </div>
          ))}
        </section>

        <section className="max-h-[70vh] overflow-auto rounded-2xl border border-[#255074] bg-[#0f3151]">
          <table className="w-full min-w-[1100px] border-collapse text-sm tabular-nums">
            <thead className="sticky top-0 z-10 bg-[#1090D0] text-xs uppercase tracking-wide text-white">
              <tr>
                {tableHeadings.map((heading, index) => (
                  <th key={heading} className={`px-3 py-3 font-bold ${index >= 3 ? 'text-right' : 'text-left'}`}>{heading}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => (
                <Fragment key={group.category}>
                  <tr className="bg-[#164064]">
                    <td colSpan={11} className="border-t-2 border-[#5bbfe5]/60 px-3 py-2 text-xs font-extrabold uppercase tracking-wider text-[#5bbfe5]">
                      {group.category} <span className="ml-2 font-semibold normal-case text-slate-400">{group.rows.length} producto{group.rows.length === 1 ? '' : 's'}</span>
                    </td>
                  </tr>
                  {group.rows.map((row, index) => (
                    <tr key={`${row.sku}-${row.name}-${index}`} className={`border-t border-[#1a3a5a] transition hover:bg-[#1c4a73] ${index % 2 ? 'bg-[#0d2c4a]' : 'bg-[#0f3151]'}`}>
                      <td className="px-3 py-2 text-slate-500">{row.category}</td>
                      <td className="px-3 py-2 font-mono text-xs text-slate-400">{row.sku || '—'}</td>
                      <td className="px-3 py-2 font-semibold text-white">{row.name}</td>
                      <td className="px-3 py-2 text-right font-bold text-white">{row.quantity}</td>
                      <td className="px-3 py-2 text-right text-sky-300">{currency(row.grossSales)}</td>
                      <td className="px-3 py-2 text-right text-amber-300">{row.discount > 0 ? currency(row.discount) : '—'}</td>
                      <td className="px-3 py-2 text-right font-semibold text-cyan-200">{currency(row.netSales)}</td>
                      <td className="px-3 py-2 text-right text-rose-300">{currency(row.totalCost)}</td>
                      <td className="px-3 py-2 text-right text-slate-300">{currency(row.unitCost)}</td>
                      <td className={`px-3 py-2 text-right font-bold ${row.grossProfit < 0 ? 'text-rose-400' : 'text-emerald-300'}`}>{currency(row.grossProfit)}</td>
                      <td className="px-3 py-2 text-right"><span className={`inline-block min-w-[64px] rounded-full px-2 py-0.5 text-xs font-bold ${marginClass(row.margin)}`}>{percent(row.margin)}</span></td>
                    </tr>
                  ))}
                  <tr className="border-t border-[#255074] bg-[#12395c] font-bold">
                    <td colSpan={3} className="px-3 py-2 text-right text-xs uppercase tracking-wide text-slate-300">Subtotal {group.category}</td>
                    <td className="px-3 py-2 text-right">{group.quantity}</td>
                    <td className="px-3 py-2 text-right text-sky-300">{currency(group.grossSales)}</td>
                    <td className="px-3 py-2 text-right text-amber-300">{currency(group.discount)}</td>
                    <td className="px-3 py-2 text-right text-cyan-200">{currency(group.netSales)}</td>
                    <td className="px-3 py-2 text-right text-rose-300">{currency(group.totalCost)}</td>
                    <td className="px-3 py-2" />
                    <td className={`px-3 py-2 text-right ${group.grossProfit < 0 ? 'text-rose-400' : 'text-emerald-300'}`}>{currency(group.grossProfit)}</td>
                    <td className="px-3 py-2 text-right"><span className={`inline-block min-w-[64px] rounded-full px-2 py-0.5 text-xs ${marginClass(group.margin)}`}>{percent(group.margin)}</span></td>
                  </tr>
                </Fragment>
              ))}
              {report.products.length > 0 && (
                <tr className="sticky bottom-0 border-t-2 border-[#5bbfe5] bg-[#0b2641] text-base font-extrabold">
                  <td className="px-3 py-3 text-[#5bbfe5]" colSpan={3}>TOTAL GENERAL</td>
                  <td className="px-3 py-3 text-right">{report.quantity}</td>
                  <td className="px-3 py-3 text-right text-sky-300">{currency(report.grossSales)}</td>
                  <td className="px-3 py-3 text-right text-amber-300">{currency(report.discount)}</td>
                  <td className="px-3 py-3 text-right text-cyan-200">{currency(report.netSales)}</td>
                  <td className="px-3 py-3 text-right text-rose-300">{currency(report.totalCost)}</td>
                  <td className="px-3 py-3" />
                  <td className={`px-3 py-3 text-right ${report.grossProfit < 0 ? 'text-rose-400' : 'text-emerald-300'}`}>{currency(report.grossProfit)}</td>
                  <td className="px-3 py-3 text-right"><span className={`inline-block min-w-[64px] rounded-full px-2 py-0.5 text-xs ${marginClass(report.netSales ? report.grossProfit / report.netSales : 0)}`}>{percent(report.netSales ? report.grossProfit / report.netSales : 0)}</span></td>
                </tr>
              )}
              {report.products.length === 0 && !loading && (
                <tr><td className="px-4 py-8 text-center text-slate-400" colSpan={11}>No hay ventas pagadas en las fechas y horario seleccionados.</td></tr>
              )}
            </tbody>
          </table>
        </section>
        <p className="text-xs text-slate-500">
          El reporte incluye ventas pagadas. Los descuentos de una venta se distribuyen proporcionalmente entre sus productos.
          El costo usa las asignaciones FIFO guardadas en la venta; para registros antiguos sin ese detalle se usa el costo disponible del producto.
          El porcentaje es utilidad bruta ÷ venta neta. El Excel conserva las columnas, subtotales por categoría y total general del formato de referencia.
        </p>
      </div>
    </div>
  )
}
