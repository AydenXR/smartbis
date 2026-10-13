import test from 'node:test'
import assert from 'node:assert/strict'
import { createSearchIndex, searchIndex } from './searchIndex.js'
import type { WorkspaceDocument } from './workspace.js'

const document: WorkspaceDocument = {
  id: 'products',
  title: 'Productos',
  docType: 'productos',
  section: 'productos',
  content: [
    'Producto: COLAGENASA PLUS PB SERUM',
    'Categoria: Enzimas',
    'Precio: $100',
    '',
    'Producto: ACIDO HIALURONICO',
    'Precio: $200',
    '',
    'Producto: PEPTONAS',
    'Precio: $300',
    '',
    'Producto: LIPOENZIMAS',
    'Precio: $400',
  ].join('\n'),
  isActive: true,
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const index = createSearchIndex({ tenantId: 'tenant', documents: [document] })

test('does not return an unrelated acid product for an absent tranexamic product', () => {
  const result = searchIndex(index, 'precio del acido tranexamico')

  assert.equal(result.matchedBlocks.length, 0)
  assert.equal(result.contextBlock, '(Sin documentos activos)')
})

test('keeps multiple requested product entities in the context', () => {
  const result = searchIndex(index, 'precio del kit de peptonas y lipoenzimas')
  const titles = result.matchedBlocks.map((block) => block.title)

  assert.deepEqual(titles, ['PEPTONAS', 'LIPOENZIMAS'])
})

test('matches PbSerum despite spacing and preserves its category context', () => {
  const result = searchIndex(index, 'informacion producto enzimas pbserum')

  assert.equal(result.matchedBlocks[0]?.title, 'COLAGENASA PLUS PB SERUM')
  assert.match(result.contextBlock, /Categoria: Enzimas/)
  assert.doesNotMatch(result.contextBlock, /ACIDO HIALURONICO/)
})
