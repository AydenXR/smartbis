import assert from 'node:assert/strict'
import test from 'node:test'
import { createSearchIndex } from './searchIndex.js'
import { buildBareMoreInfoReply, buildCourseListReply, isBareMoreInfoRequest, isCourseListRequest } from './dbChat.js'
import { shouldSendMessengerAnswer } from './messengerReplyPolicy.js'

const prompt = `EX1) Termina con: "Estos son los únicos cursos con fecha disponible. Tenemos más de 30 cursos en total; si quieres la lista completa, envíanos un WhatsApp al +52 1 662 335 8779."
EX2) Si la pregunta es "información" o "más información" SIN contexto, contesta: "Tenemos cursos, productos y tratamientos estéticos. ¿Sobre qué te gustaría información? (cursos en específico, productos, o tratamientos con Lydia)"`

const doc = `[FECHAS_CURSOS]
En línea tenemos tentativamente programados para 2026:
25 de noviembre de 2026 - Lipoenzimas
11 de noviembre de 2026 - Peeling químico
4 de enero de 2027 - Hidrofacial

Presencial tenemos programados para 2026:
5 de octubre de 2026 - Lipoenzimas
29 de octubre de 2026 - Eliminación de verrugas y manchas con Fibroblast
`

const blocks = createSearchIndex({
  tenantId: 't',
  documents: [{ id: 'd1', title: 'cursos.md', docType: 'cursos', section: 'cursos', isActive: true, updatedAt: '2026-01-01T00:00:00.000Z', content: doc }],
} as any).blocks
const now = new Date('2026-10-26T18:00:00Z')

test('detects bare more-info requests with greetings', () => {
  assert.ok(isBareMoreInfoRequest('Hola, buenas tardes, mas informacion por favor'))
  assert.ok(isBareMoreInfoRequest('información'))
  assert.ok(!isBareMoreInfoRequest('más información del curso de peeling'))
  assert.match(buildBareMoreInfoReply('Hola, más info', prompt) || '', /Sobre qué te gustaría información/)
  assert.equal(buildBareMoreInfoReply('más info', 'sin ex2'), null)
})

test('detects generic course list requests only', () => {
  assert.ok(isCourseListRequest('Hola buenas tardes mas informacion cursos por favor'))
  assert.ok(isCourseListRequest('qué cursos tienen?'))
  assert.ok(!isCourseListRequest('cursos de peeling'))
})

test('course list drops past dates, groups by modality and sends', () => {
  const reply = buildCourseListReply('qué cursos tienen', prompt, blocks, now) || ''
  assert.match(reply, /fechas tentativas/)
  assert.match(reply, /11 de noviembre de 2026: Peeling químico/)
  assert.match(reply, /4 de enero de 2027: Hidrofacial/)
  assert.match(reply, /29 de octubre de 2026/)
  assert.doesNotMatch(reply, /5 de octubre/)
  assert.match(reply, /Estos son los únicos cursos con fecha disponible\. Tenemos más de 30/)
  assert.ok(shouldSendMessengerAnswer(reply, false))
})

test('course list without current dates does not derive to WhatsApp', () => {
  const reply = buildCourseListReply('cursos', prompt, blocks, new Date('2027-06-01T12:00:00Z')) || ''
  assert.match(reply, /no hay fechas vigentes/)
  assert.doesNotMatch(reply, /WhatsApp/i)
})
