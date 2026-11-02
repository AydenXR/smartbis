import test from 'node:test'
import assert from 'node:assert/strict'
import * as XLSX from 'xlsx'
import { buildSalesProfitReport, createSalesProfitWorkbook, getReportDateRange } from './salesProfitReport.ts'
import type { PosCatalogItem, PosSale } from './api.ts'

const item = {
  id: 'item-1',
  kind: 'product',
  sku: 'SKU-1',
  name: 'Producto A',
  category: 'Categoría A',
  costPrice: 70,
  salePrice: 120,
  currency: 'MXN',
  stocks: {},
  tags: [],
  active: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
} satisfies PosCatalogItem

function sale(input: Partial<PosSale> = {}): PosSale {
  return {
    id: 'sale-1',
    tenantId: 'tenant-1',
    branchId: 'branch-1',
    userEmail: 'cashier@example.com',
    userId: 'user-1',
    createdAt: '2026-11-02T17:00:00.000Z',
    requiresFactura: false,
    status: 'paid',
    subtotal: 240,
    ivaAmount: 0,
    discount: 24,
    total: 216,
    paidAmount: 216,
    pendingAmount: 0,
    lines: [{
      itemId: 'item-1',
      sku: 'SKU-1',
      name: 'Producto A',
      qty: 2,
      unitPrice: 120,
      importe: 240,
      costAllocations: [{ qty: 1, unitCost: 60 }, { qty: 1, unitCost: 80 }],
      costTotal: 140,
    }],
    payments: [],
    currency: 'MXN',
    ivaRate: 0,
    ...input,
  }
}

test('period presets use Monday-Sunday and complete calendar months and years', () => {
  assert.deepEqual(getReportDateRange('2026-11-04', 'week'), { from: '2026-11-02', to: '2026-11-08' })
  assert.deepEqual(getReportDateRange('2026-02-14', 'month'), { from: '2026-02-01', to: '2026-02-28' })
  assert.deepEqual(getReportDateRange('2026-04-14', 'year'), { from: '2026-01-01', to: '2026-12-31' })
})

test('report applies the daily time window, excludes unpaid sales, and computes discounted FIFO profit', () => {
  const report = buildSalesProfitReport([
    sale(),
    sale({ id: 'too-early', createdAt: new Date(2026, 10, 2, 8, 59).toISOString() }),
    sale({ id: 'unpaid', status: 'pending' }),
  ], [item], {
    from: '2026-11-02',
    to: '2026-11-02',
    fromTime: '09:00',
    toTime: '18:00',
  })

  assert.equal(report.products.length, 1)
  assert.deepEqual(report.products[0], {
    category: 'Categoría A',
    sku: 'SKU-1',
    name: 'Producto A',
    quantity: 2,
    grossSales: 240,
    discount: 24,
    netSales: 216,
    totalCost: 140,
    unitCost: 70,
    grossProfit: 76,
    margin: 76 / 216,
  })
  assert.equal(report.quantity, 2)
  assert.equal(report.grossProfit, 76)
})

test('report distributes sale discount proportionally across products', () => {
  const source = sale({
    discount: 30,
    subtotal: 300,
    lines: [
      { itemId: 'item-1', sku: 'SKU-1', name: 'Producto A', qty: 1, unitPrice: 100, importe: 100, unitCost: 20 },
      { itemId: 'item-2', sku: 'SKU-2', name: 'Producto B', qty: 2, unitPrice: 100, importe: 200, unitCost: 50 },
    ],
  })
  const report = buildSalesProfitReport([source], [item], {
    from: '2026-11-02',
    to: '2026-11-02',
    fromTime: '09:00',
    toTime: '18:00',
  })

  assert.deepEqual(report.products.map((row) => row.discount), [10, 20])
  assert.equal(report.discount, 30)
})

test('Excel preserves the provided columns, category subtotals, and grand total', async () => {
  const report = buildSalesProfitReport([sale()], [item], {
    from: '2026-11-02',
    to: '2026-11-02',
    fromTime: '09:00',
    toTime: '18:00',
  })
  const workbook = await createSalesProfitWorkbook(report, { from: '2026-11-02', to: '2026-11-02' })
  const worksheet = workbook.Sheets.Rpt_VentaUtilidad
  const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' }) as unknown[][]

  assert.equal(rows[0][0], 'Venta por producto con utilidad')
  assert.equal(rows[2][0], '02/Nov/2026 al 02/Nov/2026')
  assert.deepEqual(rows[7].slice(0, 12), [
    'CATEGORÍA', 'CÓDIGO', 'PRODUCTO', 'CANTIDAD', 'VENTA BRUTA', 'DESCUENTO TOTAL',
    '', 'VENTA NETA', 'COSTO TOTAL', 'COSTO UNITARIO (i)', 'UTILIDAD BRUTA', 'PORCENTAJE',
  ])
  assert.equal(rows[8][0], 'Categoría A')
  assert.equal(rows[9][3], 2)
  assert.equal(rows[10][0], 'TOTAL GENERAL')
  assert.equal(rows[10][10], 76)
  assert.equal(worksheet['!merges']?.length, 4)
})
