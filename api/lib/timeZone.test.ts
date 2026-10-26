import test from 'node:test'
import assert from 'node:assert/strict'
import { createSearchIndex } from './searchIndex.js'
import { DEFAULT_TIME_ZONE, describeTimeZone, detectTimeZone, detectTimeZoneSetting, getZonedDateParts, resolveTimeZone } from './timeZone.js'
import { applyUpcomingCourseDateCorrection } from './dbChat.js'

function indexWith(title: string, section: 'general' | 'cursos', content: string) {
  return createSearchIndex({
    tenantId: 'tenant',
    documents: [{ id: title, title, docType: section, section, content, isActive: true, updatedAt: '2026-01-01T00:00:00.000Z' }],
  })
}

test('the time zone written in a schedule block is used', () => {
  const index = indexWith('cursos.md', 'cursos', '[HORARIOS]\nLunes a viernes de 9:00 a 18:00\nZona horaria: America/Mexico_City\n\n[CURSO]\nNombre del curso: Mesobotox')
  assert.equal(detectTimeZone(index), 'America/Mexico_City')
})

test('a [ZONA_HORARIA] block in infogeneral is used', () => {
  const index = indexWith('infogeneral.md', 'general', '[UBICACION]\nAv. Principal 123\n\n[ZONA_HORARIA]\nCiudad de México')
  assert.equal(detectTimeZone(index), 'America/Mexico_City')
})

test('without a time zone in the documents, Hermosillo is the default', () => {
  const index = indexWith('infogeneral.md', 'general', '[HORARIOS]\nLunes a viernes de 9:00 a 18:00')
  assert.equal(detectTimeZone(index), DEFAULT_TIME_ZONE)
  assert.equal(DEFAULT_TIME_ZONE, 'America/Hermosillo')
})

test('an unknown time zone name falls back to Hermosillo', () => {
  const index = indexWith('infogeneral.md', 'general', '[HORARIOS]\nZona horaria: la de aqui')
  assert.equal(detectTimeZone(index), DEFAULT_TIME_ZONE)
})

test('time zones can be written as IANA names, UTC offsets or city names', () => {
  assert.equal(resolveTimeZone('America/Tijuana'), 'America/Tijuana')
  assert.equal(resolveTimeZone('UTC-6'), 'Etc/GMT+6')
  assert.equal(resolveTimeZone('GMT +1'), 'Etc/GMT-1')
  assert.equal(resolveTimeZone('Hora de Cancún'), 'America/Cancun')
  assert.equal(resolveTimeZone('Madrid, España'), 'Europe/Madrid')
  assert.equal(resolveTimeZone('Marte'), null)
})

test('"today" depends on the business time zone', () => {
  // 05:30 UTC on Nov 1st is still Oct 31st in Hermosillo (UTC-7) but Nov 1st in Madrid
  const instant = new Date(Date.UTC(2026, 10, 1, 5, 30))
  assert.deepEqual([getZonedDateParts(instant, 'America/Hermosillo').month, getZonedDateParts(instant, 'America/Hermosillo').day], [10, 31])
  assert.deepEqual([getZonedDateParts(instant, 'Europe/Madrid').month, getZonedDateParts(instant, 'Europe/Madrid').day], [11, 1])
})

test('a course date that is today in the business zone is still offered', () => {
  const index = indexWith('cursos.md', 'cursos', '[FECHAS_CURSOS]\nEn línea:\n✨ 31 Octubre - Mesobotox')
  const instant = new Date(Date.UTC(2026, 10, 1, 5, 30))
  const answer = 'El curso de Mesobotox se imparte en línea.'

  const inHermosillo = applyUpcomingCourseDateCorrection(answer, 'fecha del curso de mesobotox', index.blocks, instant, 'America/Hermosillo')
  assert.match(inHermosillo, /31 de octubre/)
  const inMadrid = applyUpcomingCourseDateCorrection(answer, 'fecha del curso de mesobotox', index.blocks, instant, 'Europe/Madrid')
  assert.doesNotMatch(inMadrid, /31 de octubre/)
})

test('a past date is removed when the course has no upcoming date', () => {
  const index = indexWith('cursos.md', 'cursos', '[FECHAS_CURSOS]\nEn línea:\n✨ 21 Octubre 2026 - Hidrofacial\n✨ 4 Noviembre 2026 - Limpiezas faciales')
  const instant = new Date(Date.UTC(2026, 9, 26, 22))
  const answer = 'El costo online es de $595 MXN.\n\nLa próxima fecha disponible es el 21 de octubre de 2026 (en línea). ¿Te gustaría reservar?'

  const result = applyUpcomingCourseDateCorrection(answer, 'es con hidrafacial', index.blocks, instant, 'America/Hermosillo')
  assert.doesNotMatch(result, /21 de octubre/)
  assert.match(result, /\$595 MXN/)
  assert.match(result, /WhatsApp/)
})

test('the bot gets a quotable time zone line: the business one or Hermosillo', () => {
  const winter = new Date(Date.UTC(2026, 0, 15, 18))

  const fromDocuments = detectTimeZoneSetting(indexWith('infogeneral.md', 'general', '[HORARIOS]\n9 a 18 hrs\nZona horaria: Ciudad de México'))
  assert.equal(
    describeTimeZone(fromDocuments, winter),
    'Zona horaria del negocio (todos sus horarios y fechas están en esta zona): Ciudad de México (America/Mexico_City), UTC-6',
  )

  const byDefault = detectTimeZoneSetting(indexWith('infogeneral.md', 'general', '[HORARIOS]\n9 a 18 hrs'))
  assert.equal(byDefault.fromDocuments, false)
  assert.equal(
    describeTimeZone(byDefault, winter),
    'Zona horaria del negocio (todos sus horarios y fechas están en esta zona): Hermosillo, Sonora, México (America/Hermosillo), UTC-7',
  )
})
