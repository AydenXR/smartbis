import assert from 'node:assert/strict'
import test from 'node:test'
import { createSearchIndex } from './searchIndex.js'
import { applyUpcomingCourseDateCorrection, buildAskedCourseDatesBlock, getUpcomingCourseDates } from './dbChat.js'

// The calendar as the business writes it: no year, "✨", leading zeros
const calendar = `[FECHAS_CURSOS]
En línea tenemos tentativamente programados:
✨ 11 Noviembre - Peeling químico
✨ 24 Noviembre - Rejuvenecimiento facial en tercio inferior (Botox inferior)
✨ 02 Diciembre - Mesobotox
✨ 09 Diciembre - Eliminación de verrugas y manchas con Plasma Pen
✨ 16 Diciembre - Aumento de glúteos con Peptonas
✨ 13 Enero 2027 - Hidrofacial

Presencial tenemos programados:
✨ 05 Noviembre - Rejuvenecimiento y eliminación de manchas con Dermapen
✨ 12 Noviembre - Eliminación de verrugas y manchas con plasma Pen
✨ 19 Noviembre - Limpieza facial
✨ 10 Diciembre - Relleno de labios con Hyaluron Pen

[CURSO]
Nombre del curso: Eliminación de verrugas y manchas con Fibroblast.
Precio: Online: $595 MXN
`

const blocks = createSearchIndex({
  tenantId: 't',
  documents: [{ id: 'd1', title: 'cursos.md', docType: 'cursos', section: 'cursos', isActive: true, updatedAt: '2026-11-01T00:00:00.000Z', content: calendar }],
}).blocks
const now = new Date('2026-11-04T18:00:00Z')
const zone = 'America/Hermosillo'
const describe = (question: string, at = now) =>
  getUpcomingCourseDates(question, blocks, at, zone).map((date) => `${date.year}-${date.month}-${date.day} ${date.modality} ${date.courseName}`).sort()

test('a question about warts and spots finds both calendar dates, whatever the course card is called', () => {
  assert.deepEqual(describe('tienes cursos de verrugas y manchas?'), [
    '2026-11-12 presencial Eliminación de verrugas y manchas con plasma Pen',
    '2026-12-9 en línea Eliminación de verrugas y manchas con Plasma Pen',
  ])
  assert.equal(describe('cursos de verrugas').length, 2)
  assert.equal(describe('cuándo es el curso de eliminación de verrugas con plasma pen').length, 2)
})

test('a calendar date without a year is of the current year; a written year is kept', () => {
  assert.deepEqual(describe('hay curso de mesobotox?'), ['2026-12-2 en línea Mesobotox'])
  assert.deepEqual(describe('fechas de hidrofacial'), ['2027-1-13 en línea Hidrofacial'])
})

test('dates that already passed are left out', () => {
  assert.deepEqual(describe('tienes cursos de verrugas y manchas?', new Date('2026-11-20T18:00:00Z')), [
    '2026-12-9 en línea Eliminación de verrugas y manchas con Plasma Pen',
  ])
})

test('other courses do not match', () => {
  assert.deepEqual(describe('curso de glúteos'), ['2026-12-16 en línea Aumento de glúteos con Peptonas'])
  assert.deepEqual(describe('tienes cursos de verrugas y manchas?').filter((line) => /Dermapen|labios/.test(line)), [])
  assert.deepEqual(describe('cursos de microblading'), [])
  assert.deepEqual(describe('tienes cursos?'), [])
})

test('the asked-dates block lists each date with its year, modality and calendar name', () => {
  const block = buildAskedCourseDatesBlock(getUpcomingCourseDates('tienes cursos de verrugas y manchas?', blocks, now, zone))
  assert.match(block, /^\[FECHAS DEL CURSO PREGUNTADO\]/)
  assert.match(block, /- 12 de noviembre de 2026 \(presencial\): Eliminación de verrugas y manchas con plasma Pen\n- 9 de diciembre de 2026 \(en línea\): Eliminación de verrugas y manchas con Plasma Pen$/)
  assert.equal(buildAskedCourseDatesBlock([]), '')
})

test('a calendar course without a card of its own name is marked as such', () => {
  const dates = getUpcomingCourseDates('tienes cursos de verrugas y manchas?', blocks, now, zone)
  const block = buildAskedCourseDatesBlock(dates, ['Eliminación de verrugas y manchas con Fibroblast.'])
  assert.equal(block.match(/sin ficha \[CURSO\] con este nombre/g)?.length, 2)
  const withCard = buildAskedCourseDatesBlock(dates, ['Eliminación de verrugas y manchas con Plasma Pen.'])
  assert.doesNotMatch(withCard, /sin ficha/)
})

test('an answer that already gives the right dates is left as written', () => {
  const answer = [
    'Tenemos estos cursos:',
    '',
    '**1. Eliminación de verrugas y manchas con Plasma Pen**',
    '- En línea: 9 de diciembre de 2026',
    '- Presencial: 12 de noviembre de 2026',
    '',
    '¿Te interesa alguno?',
  ].join('\n')
  assert.equal(applyUpcomingCourseDateCorrection(answer, 'tienes cursos de verrugas y manchas?', blocks, now, zone), answer)
})

test('an answer about a differently named card that says there is no date gets the calendar dates', () => {
  const answer = 'Tenemos el curso Eliminación de verrugas y manchas con Fibroblast. En este momento no hay una fecha programada para este curso.'
  const corrected = applyUpcomingCourseDateCorrection(answer, 'tienes cursos de verrugas y manchas?', blocks, now, zone)
  // The Fibroblast sentence stays (that card has no date); the calendar course is added
  assert.match(corrected, /^Tenemos el curso Eliminación de verrugas y manchas con Fibroblast\./)
  assert.match(corrected, /Plasma Pen es el 9 de diciembre de 2026 \(en línea\)/)
  assert.match(corrected, /plasma Pen es el 12 de noviembre de 2026 \(presencial\)/)
  // A question about another course adds nothing
  assert.equal(applyUpcomingCourseDateCorrection('No hay fecha para microblading.', 'curso de microblading', blocks, now, zone), 'No hay fecha para microblading.')
})

test('an answer that denies the dates is still corrected', () => {
  const answer = 'El curso de Eliminación de verrugas y manchas con Plasma Pen no tiene fecha programada. Escríbenos por WhatsApp.'
  const corrected = applyUpcomingCourseDateCorrection(answer, 'tienes cursos de verrugas y manchas?', blocks, now, zone)
  assert.doesNotMatch(corrected, /no tiene fecha/)
  assert.match(corrected, /12 de noviembre de 2026 \(presencial\)/)
  assert.match(corrected, /9 de diciembre de 2026 \(en línea\)/)
})
