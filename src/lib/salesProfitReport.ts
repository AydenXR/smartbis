import type { PosCatalogItem, PosSale } from './api'

export type ReportPeriod = 'day' | 'week' | 'month' | 'year'

export type ReportDateRange = {
  from: string
  to: string
}

export type SalesProfitRow = {
  category: string
  sku: string
  name: string
  quantity: number
  grossSales: number
  discount: number
  netSales: number
  totalCost: number
  unitCost: number
  grossProfit: number
  margin: number
}

export type SalesProfitReport = {
  products: SalesProfitRow[]
  quantity: number
  grossSales: number
  discount: number
  netSales: number
  totalCost: number
  unitCost: number
  grossProfit: number
}

const normalizeMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100

function parseLocalDate(value: string) {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day, 12)
}

function localDateValue(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
}

export function getReportDateRange(anchor: string, period: ReportPeriod): ReportDateRange {
  const date = parseLocalDate(anchor)
  const start = new Date(date)
  const end = new Date(date)

  if (period === 'week') {
    const mondayOffset = (date.getDay() + 6) % 7
    start.setDate(date.getDate() - mondayOffset)
    end.setDate(start.getDate() + 6)
  } else if (period === 'month') {
    start.setDate(1)
    end.setMonth(date.getMonth() + 1, 0)
  } else if (period === 'year') {
    start.setMonth(0, 1)
    end.setMonth(11, 31)
  }

  return { from: localDateValue(start), to: localDateValue(end) }
}

function getCostTotal(sale: PosSale, line: PosSale['lines'][number], item?: PosCatalogItem) {
  const allocations = Array.isArray(line.costAllocations) ? line.costAllocations : []
  if (allocations.length > 0) {
    return normalizeMoney(allocations.reduce((sum, allocation) => {
      const quantity = Number(allocation.qty)
      const unitCost = Number(allocation.unitCost)
      return sum + (Number.isFinite(quantity) && Number.isFinite(unitCost) ? quantity * unitCost : 0)
    }, 0))
  }
  if (Number.isFinite(Number(line.costTotal))) return normalizeMoney(Number(line.costTotal))
  if (Number.isFinite(Number(line.unitCost))) return normalizeMoney(Number(line.qty) * Number(line.unitCost))
  return normalizeMoney(Number(line.qty) * Number(item?.costPrice ?? item?.lastPurchaseCost ?? 0))
}

function timeInRange(isoDate: string, fromTime: string, toTime: string) {
  const date = new Date(isoDate)
  if (!Number.isFinite(date.getTime())) return false
  const minutes = date.getHours() * 60 + date.getMinutes()
  const from = Number(fromTime.slice(0, 2)) * 60 + Number(fromTime.slice(3, 5))
  const to = Number(toTime.slice(0, 2)) * 60 + Number(toTime.slice(3, 5))
  return from <= to ? minutes >= from && minutes <= to : minutes >= from || minutes <= to
}

function localDateValueFromIso(isoDate: string) {
  const date = new Date(isoDate)
  if (!Number.isFinite(date.getTime())) return ''
  return localDateValue(date)
}

export function buildSalesProfitReport(
  sales: PosSale[],
  catalog: PosCatalogItem[],
  range: ReportDateRange & { fromTime: string; toTime: string },
): SalesProfitReport {
  const itemsById = new Map(catalog.map((item) => [item.id, item]))
  const productTotals = new Map<string, SalesProfitRow>()

  for (const sale of sales) {
    const saleDate = localDateValueFromIso(sale.createdAt)
    if (sale.status !== 'paid' || !saleDate || saleDate < range.from || saleDate > range.to) continue
    if (!timeInRange(sale.createdAt, range.fromTime, range.toTime)) continue

    const linesWithSales = sale.lines.map((line) => ({
      line,
      grossSales: Math.max(0, Number(line.importe) || 0),
    })).filter(({ line, grossSales }) => Number.isFinite(Number(line.qty)) && Number(line.qty) > 0 && grossSales > 0)
    const subtotal = linesWithSales.reduce((sum, { grossSales }) => sum + grossSales, 0)
    const saleDiscount = Math.min(subtotal, Math.max(0, Number(sale.discount) || 0))
    let remainingDiscount = normalizeMoney(saleDiscount)

    linesWithSales.forEach(({ line, grossSales }, lineIndex) => {
      const quantity = Number(line.qty)
      const item = itemsById.get(line.itemId)
      const category = item?.category?.trim() || 'Sin categoría'
      const sku = line.sku || item?.sku || ''
      const key = `${line.itemId}\u0000${category}\u0000${sku}\u0000${line.name}`
      const proportionalDiscount = lineIndex === linesWithSales.length - 1
        ? remainingDiscount
        : normalizeMoney(saleDiscount * grossSales / subtotal)
      const discount = Math.min(grossSales, remainingDiscount, proportionalDiscount)
      remainingDiscount = normalizeMoney(remainingDiscount - discount)
      const totalCost = getCostTotal(sale, line, item)
      const row = productTotals.get(key) || {
        category,
        sku,
        name: line.name,
        quantity: 0,
        grossSales: 0,
        discount: 0,
        netSales: 0,
        totalCost: 0,
        unitCost: 0,
        grossProfit: 0,
        margin: 0,
      }

      row.quantity += quantity
      row.grossSales += grossSales
      row.discount += discount
      row.totalCost += totalCost
      productTotals.set(key, row)
    })
  }

  const products = [...productTotals.values()]
    .map((row) => {
      row.quantity = normalizeMoney(row.quantity)
      row.grossSales = normalizeMoney(row.grossSales)
      row.discount = normalizeMoney(row.discount)
      row.netSales = normalizeMoney(row.grossSales - row.discount)
      row.totalCost = normalizeMoney(row.totalCost)
      row.unitCost = row.quantity > 0 ? normalizeMoney(row.totalCost / row.quantity) : 0
      row.grossProfit = normalizeMoney(row.netSales - row.totalCost)
      row.margin = row.netSales > 0 ? row.grossProfit / row.netSales : 0
      return row
    })
    .sort((a, b) => a.category.localeCompare(b.category, 'es') || a.name.localeCompare(b.name, 'es'))

  return products.reduce<SalesProfitReport>((report, row) => {
    report.quantity += row.quantity
    report.grossSales += row.grossSales
    report.discount += row.discount
    report.netSales += row.netSales
    report.totalCost += row.totalCost
    report.unitCost += row.unitCost
    report.grossProfit += row.grossProfit
    return report
  }, {
    products,
    quantity: 0,
    grossSales: 0,
    discount: 0,
    netSales: 0,
    totalCost: 0,
    unitCost: 0,
    grossProfit: 0,
  })
}

function formatReportDate(value: string) {
  const date = parseLocalDate(value)
  const month = new Intl.DateTimeFormat('en', { month: 'short' }).format(date)
  return `${String(date.getDate()).padStart(2, '0')}/${month}/${date.getFullYear()}`
}

const REPORT_COLORS = { header: 'FF1C3D7D', subtotal: 'FFC0C0C0', text: 'FF000000' }
const REPORT_FONT = 'Arial'
const MONEY_FORMAT = '"$"#,##0.00;("$"#,##0.00);"-"'
const NUMBER_FORMAT = '#,##0.00;(#,##0.00);"-"'
const PERCENT_FORMAT = '#,##0.00 %;-#,##0.00 %;"-"'
const sumBy = (rows: SalesProfitRow[], pick: (row: SalesProfitRow) => number) =>
  normalizeMoney(rows.reduce((sum, row) => sum + pick(row), 0))

// Columnas A-L; F y G se combinan (G es un separador mínimo) igual que en el reporte original.
function productValues(row: SalesProfitRow, category: string | null) {
  return [category ?? '', row.sku, row.name, row.quantity, row.grossSales, row.discount, null, row.netSales, row.totalCost, row.unitCost, row.grossProfit, row.margin]
}

function subtotalValues(rows: SalesProfitRow[]) {
  return ['', '', '', sumBy(rows, (row) => row.quantity), sumBy(rows, (row) => row.grossSales), sumBy(rows, (row) => row.discount), null,
    sumBy(rows, (row) => row.netSales), sumBy(rows, (row) => row.totalCost), sumBy(rows, (row) => row.unitCost), sumBy(rows, (row) => row.grossProfit), null]
}

export async function createSalesProfitWorkbook(report: SalesProfitReport, range: ReportDateRange) {
  const ExcelJS = (await import('exceljs')).default
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Rpt_VentaUtilidad')
  const lastCol = 12
  const fill = (argb: string) => ({ type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb } })

  sheet.columns = [23.07, 20.5, 47.5, 13.07, 14.93, 17.21, 1.07, 14.79, 14.93, 18.79, 16.79, 13.07].map((width) => ({ width }))

  const titleLine = (rowNumber: number, text: string, size: number, bold: boolean) => {
    sheet.mergeCells(rowNumber, 1, rowNumber, lastCol)
    const cell = sheet.getCell(rowNumber, 1)
    cell.value = text
    cell.font = { name: REPORT_FONT, bold, size, color: { argb: REPORT_COLORS.text } }
    cell.alignment = { horizontal: 'left', vertical: 'middle' }
    sheet.getRow(rowNumber).height = 25
  }
  titleLine(1, 'Venta por producto con utilidad', 16, true)
  titleLine(3, `${formatReportDate(range.from)} al ${formatReportDate(range.to)}`, 12, false)
  titleLine(5, 'SALUBEL INSTITUTE', 14, true)
  ;[2, 4].forEach((row) => { sheet.getRow(row).height = 6 })
  sheet.getRow(6).height = 6
  sheet.getRow(7).height = 6

  const header = sheet.getRow(8)
  header.values = ['CATEGORÍA', 'CÓDIGO', 'PRODUCTO', 'CANTIDAD', 'VENTA BRUTA', 'DESCUENTO TOTAL', '', 'VENTA NETA', 'COSTO TOTAL', 'COSTO UNITARIO (i)', 'UTILIDAD BRUTA', 'PORCENTAJE']
  header.height = 25
  sheet.mergeCells(8, 6, 8, 7)
  for (let col = 1; col <= lastCol; col += 1) {
    const cell = header.getCell(col)
    cell.fill = fill(REPORT_COLORS.header)
    cell.font = { name: REPORT_FONT, bold: true, size: 11, color: { argb: 'FFFFFFFF' } }
    cell.alignment = { horizontal: 'left', vertical: 'middle' }
  }

  const styleRow = (row: ExcelJSRow, subtotal: boolean) => {
    sheet.mergeCells(row.number, 6, row.number, 7)
    for (let col = 1; col <= lastCol; col += 1) {
      const cell = row.getCell(col)
      if (subtotal) cell.fill = fill(REPORT_COLORS.subtotal)
      cell.font = { name: REPORT_FONT, bold: subtotal, size: 10, color: { argb: REPORT_COLORS.text } }
      cell.alignment = { horizontal: 'left', vertical: 'middle' }
      if (col === 4) cell.numFmt = NUMBER_FORMAT
      if ([5, 6, 8, 9, 10, 11].includes(col)) cell.numFmt = MONEY_FORMAT
      if (col === 12) cell.numFmt = PERCENT_FORMAT
    }
  }

  const categories = new Map<string, SalesProfitRow[]>()
  for (const product of report.products) {
    const categoryRows = categories.get(product.category) || []
    categoryRows.push(product)
    categories.set(product.category, categoryRows)
  }

  for (const [category, products] of categories) {
    const firstRow = sheet.rowCount + 1
    products.forEach((product, index) => styleRow(sheet.addRow(productValues(product, index === 0 ? category : null)), false))
    styleRow(sheet.addRow(subtotalValues(products)), true)
    const lastRow = sheet.rowCount
    sheet.mergeCells(firstRow, 1, lastRow, 1)
    const categoryCell = sheet.getCell(firstRow, 1)
    categoryCell.fill = fill(REPORT_COLORS.subtotal)
    categoryCell.alignment = { horizontal: 'left', vertical: 'top', wrapText: true }
  }

  styleRow(sheet.addRow(subtotalValues(report.products)), true)

  const noteRow = sheet.addRow(['* El costo unitario de cada producto es el promedio del costo unitario en el periodo establecido.'])
  sheet.mergeCells(noteRow.number, 1, noteRow.number, 6)
  noteRow.getCell(1).font = { name: REPORT_FONT, size: 10, color: { argb: REPORT_COLORS.text } }
  noteRow.getCell(1).alignment = { horizontal: 'left', vertical: 'middle' }
  return workbook
}

type ExcelJSRow = import('exceljs').Row
