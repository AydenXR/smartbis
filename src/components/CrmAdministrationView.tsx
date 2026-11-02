import { useEffect, useMemo, useState } from 'react'
import { Download, RefreshCw } from 'lucide-react'
import { posCatalog, posSales, type PosCatalogItem, type PosSale } from '@/lib/api'
import {
  buildSalesProfitReport,
  createSalesProfitWorkbook,
  getReportDateRange,
  type ReportPeriod,
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

  const summary = [
    { label: 'Productos vendidos', value: report.products.length.toLocaleString('es-MX') },
    { label: 'Unidades', value: report.quantity.toLocaleString('es-MX') },
    { label: 'Venta bruta', value: currency(report.grossSales) },
    { label: 'Descuentos', value: currency(report.discount) },
    { label: 'Venta neta', value: currency(report.netSales) },
    { label: 'Costo total', value: currency(report.totalCost) },
    { label: 'Utilidad bruta', value: currency(report.grossProfit) },
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
            <div key={card.label} className="rounded-2xl border border-[#1a3a5a] bg-[#0f3151] p-4">
              <p className="text-xs text-slate-400">{card.label}</p>
              <p className="mt-2 text-xl font-extrabold">{card.value}</p>
            </div>
          ))}
        </section>

        <section className="overflow-x-auto rounded-2xl border border-[#1a3a5a] bg-[#0f3151]">
          <table className="w-full min-w-[1150px] text-left text-sm">
            <thead className="bg-[#0b2641] text-xs uppercase tracking-wide text-slate-400">
              <tr>
                {['Categoría', 'Código', 'Producto', 'Cantidad', 'Venta bruta', 'Descuento total', 'Venta neta', 'Costo total', 'Costo unitario', 'Utilidad bruta', 'Porcentaje'].map((heading) => (
                  <th key={heading} className="px-3 py-3">{heading}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {report.products.map((row, index) => (
                <tr key={`${row.category}-${row.sku}-${row.name}-${index}`} className="border-t border-[#1a3a5a]">
                  <td className="px-3 py-3">{row.category}</td>
                  <td className="px-3 py-3">{row.sku || '—'}</td>
                  <td className="px-3 py-3">{row.name}</td>
                  <td className="px-3 py-3">{row.quantity}</td>
                  <td className="px-3 py-3">{currency(row.grossSales)}</td>
                  <td className="px-3 py-3">{row.discount > 0 ? currency(row.discount) : '—'}</td>
                  <td className="px-3 py-3">{currency(row.netSales)}</td>
                  <td className="px-3 py-3">{currency(row.totalCost)}</td>
                  <td className="px-3 py-3">{currency(row.unitCost)}</td>
                  <td className="px-3 py-3">{currency(row.grossProfit)}</td>
                  <td className="px-3 py-3">{(row.margin * 100).toLocaleString('es-MX', { maximumFractionDigits: 2 })}%</td>
                </tr>
              ))}
              {report.products.length > 0 && (
                <tr className="border-t-2 border-[#5bbfe5] bg-[#0b2641] font-extrabold">
                  <td className="px-3 py-3" colSpan={3}>TOTAL GENERAL</td>
                  <td className="px-3 py-3">{report.quantity}</td>
                  <td className="px-3 py-3">{currency(report.grossSales)}</td>
                  <td className="px-3 py-3">{currency(report.discount)}</td>
                  <td className="px-3 py-3">{currency(report.netSales)}</td>
                  <td className="px-3 py-3">{currency(report.totalCost)}</td>
                  <td className="px-3 py-3">{currency(report.unitCost)}</td>
                  <td className="px-3 py-3">{currency(report.grossProfit)}</td>
                  <td className="px-3 py-3">—</td>
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
