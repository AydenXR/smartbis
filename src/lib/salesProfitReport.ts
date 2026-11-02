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

function productWorksheetRow(row: SalesProfitRow, category: string | null) {
  return [
    category ?? '',
    row.sku,
    row.name,
    row.quantity,
    row.grossSales,
    row.discount > 0 ? row.discount : '-',
    '',
    row.netSales,
    row.totalCost,
    row.unitCost,
    row.grossProfit,
    row.margin,
    '',
  ]
}

function subtotalWorksheetRow(rows: SalesProfitRow[]) {
  return [
    '',
    '',
    '',
    normalizeMoney(rows.reduce((sum, row) => sum + row.quantity, 0)),
    normalizeMoney(rows.reduce((sum, row) => sum + row.grossSales, 0)),
    rows.some((row) => row.discount > 0) ? normalizeMoney(rows.reduce((sum, row) => sum + row.discount, 0)) : '-',
    '',
    normalizeMoney(rows.reduce((sum, row) => sum + row.netSales, 0)),
    normalizeMoney(rows.reduce((sum, row) => sum + row.totalCost, 0)),
    normalizeMoney(rows.reduce((sum, row) => sum + row.unitCost, 0)),
    normalizeMoney(rows.reduce((sum, row) => sum + row.grossProfit, 0)),
    '',
    '',
  ]
}

const COLORS = {
  title: 'FF0B2641',
  header: 'FF1090D0',
  subtotal: 'FFFFF2CC',
  total: 'FF0B2641',
  border: 'FFB8C7D6',
}

export async function createSalesProfitWorkbook(report: SalesProfitReport, range: ReportDateRange) {
  const ExcelJS = (await import('exceljs')).default
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Rpt_VentaUtilidad')
  const lastCol = 13
  const money = '"$"#,##0.00;[Red]-"$"#,##0.00'
  const thin = { style: 'thin' as const, color: { argb: COLORS.border } }
  const fill = (argb: string) => ({ type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb } })

  sheet.columns = [28, 14, 48, 12, 16, 19, 3, 16, 16, 20, 17, 14, 3].map((width) => ({ width }))

  const titleLine = (rowNumber: number, text: string, size: number, bold: boolean, color: string) => {
    const cell = sheet.getCell(rowNumber, 1)
    cell.value = text
    cell.font = { bold, size, color: { argb: color } }
    cell.alignment = { horizontal: 'left', vertical: 'middle' }
  }
  titleLine(1, 'Venta por producto con utilidad', 16, true, COLORS.title)
  titleLine(3, `${formatReportDate(range.from)} al ${formatReportDate(range.to)}`, 11, false, 'FF475569')
  titleLine(5, 'SALUBEL INSTITUTE', 12, true, COLORS.title)

  const headerRow = sheet.getRow(8)
  headerRow.values = ['CATEGORÍA', 'CÓDIGO', 'PRODUCTO', 'CANTIDAD', 'VENTA BRUTA', 'DESCUENTO TOTAL', '', 'VENTA NETA', 'COSTO TOTAL', 'COSTO UNITARIO (i)', 'UTILIDAD BRUTA', 'PORCENTAJE', '']
  headerRow.height = 24
  headerRow.eachCell({ includeEmpty: true }, (cell, col) => {
    if (col > lastCol - 1) return
    cell.fill = fill(COLORS.header)
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    cell.alignment = { horizontal: col >= 4 ? 'right' : 'left', vertical: 'middle' }
  })

  const style = (row: ExcelJSRow, argb: string | null, bold: boolean, fontColor = 'FF1E293B') => {
    for (let col = 1; col <= lastCol - 1; col += 1) {
      const cell = row.getCell(col)
      if (argb) cell.fill = fill(argb)
      cell.font = { bold, color: { argb: fontColor } }
      cell.border = { top: thin, bottom: thin }
      cell.alignment = { horizontal: col >= 4 ? 'right' : 'left' }
      if ([5, 6, 8, 9, 10, 11].includes(col)) cell.numFmt = money
      if (col === 12) cell.numFmt = '0.00%'
      if (col === 4) cell.numFmt = '#,##0'
    }
  }

  const categories = new Map<string, SalesProfitRow[]>()
  for (const product of report.products) {
    const categoryRows = categories.get(product.category) || []
    categoryRows.push(product)
    categories.set(product.category, categoryRows)
  }

  for (const [category, products] of categories) {
    products.forEach((product, index) => {
      const row = sheet.addRow(productWorksheetRow(product, index === 0 ? category : null))
      style(row, null, false)
      const profitColor = product.grossProfit < 0 ? 'FFC0392B' : 'FF15803D'
      row.getCell(11).font = { bold: true, color: { argb: profitColor } }
      const marginColor = product.margin >= 0.5 ? 'FF15803D' : product.margin >= 0.2 ? 'FFB45309' : 'FFC0392B'
      row.getCell(12).font = { bold: true, color: { argb: marginColor } }
    })
    const subtotal = sheet.addRow(subtotalWorksheetRow(products))
    style(subtotal, COLORS.subtotal, true)
    subtotal.getCell(1).value = `Subtotal ${category}`
    subtotal.getCell(1).alignment = { horizontal: 'left' }
  }

  const total = sheet.addRow(subtotalWorksheetRow(report.products).map((value, index) => index === 0 ? 'TOTAL GENERAL' : value))
  style(total, COLORS.total, true, 'FFFFFFFF')
  total.height = 22
  total.getCell(1).alignment = { horizontal: 'left', vertical: 'middle' }

  sheet.addRow([])
  titleLine(sheet.addRow([]).number, '* El costo unitario de cada producto es el promedio del costo unitario en el periodo establecido.', 10, false, 'FF64748B')
  return workbook
}

type ExcelJSRow = import('exceljs').Row
