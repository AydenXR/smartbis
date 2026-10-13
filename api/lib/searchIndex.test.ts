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

test('ignores greetings and filler words around a known product', () => {
  const result = searchIndex(index, 'hola buenas tardes, quisiera saber el precio de peptonas')

  assert.equal(result.matchedBlocks[0]?.title, 'PEPTONAS')
  assert.doesNotMatch(result.contextBlock, /ACIDO HIALURONICO/)
})

test('still returns nothing for an absent product asked with greetings', () => {
  const result = searchIndex(index, 'hola, tienen acido tranexamico?')

  assert.equal(result.matchedBlocks.length, 0)
})

const schoolIndex = createSearchIndex({
  tenantId: 'school',
  documents: [
    {
      id: 'courses',
      title: 'cursos.md',
      docType: 'cursos',
      section: 'cursos',
      content: [
        '[CURSO]',
        'Nombre del curso: Russian Lips',
        'Horario presencial: 10:00 AM a 2:00 PM',
        '',
        '[CURSO]',
        'Nombre del curso: Mesobotox',
        'Horario presencial: 9:00 AM a 6:00 PM',
      ].join('\n'),
      isActive: true,
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 'general',
      title: 'infogeneral.md',
      docType: 'general',
      section: 'general',
      content: [
        '[UBICACION]',
        'Nuestra ubicacion es Av. Principal 123, Hermosillo.',
        '',
        '[TELEFONO]',
        'Telefono: 662 000 0000',
      ].join('\n'),
      isActive: true,
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  ],
})

test('answers a course schedule asked in natural language', () => {
  const result = searchIndex(schoolIndex, 'hola buenas tardes, me gustaria saber el horario del curso de russian lips')

  assert.match(result.contextBlock, /Russian Lips/)
  assert.match(result.contextBlock, /10:00 AM a 2:00 PM/)
})

test('answers a location question whose words are not in the documents', () => {
  const result = searchIndex(schoolIndex, 'donde estan ubicados')

  assert.match(result.contextBlock, /Av\. Principal 123/)
  assert.doesNotMatch(result.contextBlock, /Russian Lips|Mesobotox/)
})

test('does not offer another course for an absent course schedule', () => {
  const result = searchIndex(schoolIndex, 'cual es el horario del curso de microblading')

  assert.doesNotMatch(result.contextBlock, /Russian Lips|Mesobotox/)
})
