import assert from 'node:assert/strict'
import test from 'node:test'
import { extractMarkdownField, isMisparsedCatalogItem, isUsableCatalogDocumentName } from './catalogDocument.js'

test('rejects generic unit and placeholder labels as product names', () => {
  for (const name of ['Pieza', ' unidad ', 'Unidades', 'Producto', 'Artículo', 'Sin nombre', '100', '10 pz', '25 pi']) {
    assert.equal(isUsableCatalogDocumentName(name), false, `should reject ${name}`)
  }
})

test('recognizes only zero-stock placeholder records from the corrupted product document', () => {
  assert.equal(isMisparsedCatalogItem({ name: 'Pieza', sku: 'B8C821C8', sourceDocId: 'productos.md', stocks: { main: 0 } }), true)
  assert.equal(isMisparsedCatalogItem({ name: 'Pieza', sku: 'B8C821C8', sourceDocId: 'productos.md', stocks: { main: 2 } }), false)
  assert.equal(isMisparsedCatalogItem({ name: 'Pieza', sku: 'B8C821C8', sourceDocId: 'other.md', stocks: { main: 0 } }), false)
  assert.equal(isMisparsedCatalogItem({ name: 'Pieza 5 ml', sku: 'B8C821C8', sourceDocId: 'productos.md', stocks: { main: 0 } }), false)
  assert.equal(isMisparsedCatalogItem({ name: '100', sku: 'C524423E', sourceDocId: 'productos.md', family: '- Categoría: GUM', category: 'GUM', stocks: { main: 0 } }), true)
  assert.equal(isMisparsedCatalogItem({ name: '100', sku: 'GUANTES01', sourceDocId: 'productos.md', stocks: { main: 0 } }), false)
})

test('an empty markdown field never consumes the next label', () => {
  const block = '- Familia: \n- Categoría: \n- Precio costo: \n- Precio venta: 15'
  assert.equal(extractMarkdownField(block, ['familia']), undefined)
  assert.equal(extractMarkdownField(block, ['categoría']), undefined)
  assert.equal(extractMarkdownField(block, ['precio costo']), undefined)
  assert.equal(extractMarkdownField(block, ['precio venta']), '15')
})

test('keeps specific product names even when they mention pieces or units', () => {
  for (const name of ['Piel sintética (5 PIEZAS)', 'Anillo chico 100 piezas', 'Unidad de radiofrecuencia']) {
    assert.equal(isUsableCatalogDocumentName(name), true, `should keep ${name}`)
  }
})
