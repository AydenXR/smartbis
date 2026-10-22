import assert from 'node:assert/strict'
import test from 'node:test'
import { createSearchIndex, searchIndex } from './searchIndex.js'
import {
  buildClarificationReply,
  findBusinessPaymentBlocks,
  findPreviousTopicQuestion,
  hasCatalogInformation,
  shouldRewriteFollowUp,
  findBusinessProfileBlocks,
  isPaymentConversation,
  findRequirementBlockForCourses,
  buildEnrollmentInterestReply,
  buildEnrollmentModalityReply,
  isAuthorizedEnrollmentFlowAnswer,
  isAuthorizedOutOfScopeAnswer,
  isAuthorizedPaymentFlowAnswer,
  type DbConversationMessage,
} from './dbChat.js'

const courseHistory: DbConversationMessage[] = [
  {
    role: 'assistant',
    content: `Curso Lipoenzimas

El curso Lipoenzimas incluye modalidades online y presencial.

¿Te gustaría inscribirte en este curso, o requieres más detalles?`,
  },
]

test('converts 100 positive enrollment confirmations into a modality question', () => {
  const confirmations = [
    'Sí me interesa',
    'Si me interesa',
    'me interesa',
    'Sí',
    'si',
    'sii',
    'siii',
    'Claro',
    'Claro que sí',
    'Perfecto',
    'Excelente',
    'Quiero inscribirme',
    'Me quiero inscribir',
    'Quiero inscripción',
    'Quiero entrar',
  ]
  const decorations = ['', '!', '!!', '.', ' 😊']
  const cases = Array.from({ length: 100 }, (_, index) => `${confirmations[index % confirmations.length]}${decorations[Math.floor(index / confirmations.length) % decorations.length]}`)

  for (const message of cases) {
    assert.equal(
      buildEnrollmentInterestReply(message, courseHistory),
      '¡Excelente! Para avanzar con tu inscripción al curso de Lipoenzimas, ¿te interesa la modalidad online o presencial?',
      `Expected enrollment flow for: ${message}`,
    )
  }
})

test('does not treat unrelated messages as enrollment confirmations', () => {
  for (const message of ['USA', 'PayPal', '¿Cuánto cuesta?', 'No me interesa', 'Gracias']) {
    assert.equal(buildEnrollmentInterestReply(message, courseHistory), null)
  }
})

test('requires an enrollment invitation with a known course', () => {
  const genericHistory: DbConversationMessage[] = [{ role: 'assistant', content: '¿En qué te podemos apoyar?' }]
  assert.equal(buildEnrollmentInterestReply('Sí me interesa', genericHistory), null)
})

test('asks for location after online or presencial modality selection', () => {
  const modalityHistory: DbConversationMessage[] = [{
    role: 'assistant',
    content: '¡Excelente! Para avanzar con tu inscripción al curso de Lipoenzimas, ¿te interesa la modalidad online o presencial?',
  }]
  const expected = '¡Perfecto! Para enviarte los datos de inscripción y las opciones de pago, ¿nos puedes indicar desde qué ciudad o país nos escribes?'

  assert.equal(buildEnrollmentModalityReply('Me interesa la modalidad online', modalityHistory), expected)
  assert.equal(buildEnrollmentModalityReply('La presencial', modalityHistory), expected)
  assert.equal(
    buildEnrollmentModalityReply('Me interesa la modalidad online', [
      ...modalityHistory,
      { role: 'user', content: 'Soy de Hermosillo, Sonora' },
    ]),
    null,
  )
})

test('authorizes only the exact deterministic enrollment flow response', () => {
  const expected = '¡Perfecto! Para enviarte los datos de inscripción y las opciones de pago, ¿nos puedes indicar desde qué ciudad o país nos escribes?'

  assert.equal(isAuthorizedEnrollmentFlowAnswer(expected, expected), true)
  assert.equal(isAuthorizedEnrollmentFlowAnswer(expected.replace('Perfecto', 'Claro'), expected), false)
  assert.equal(isAuthorizedEnrollmentFlowAnswer('No cuento con esa información.', expected), false)
})

test('authorizes only official phrases written word for word in the tenant prompt', () => {
  const general = 'No estoy capacitado para responder dudas externas a Clínica Ejemplo, pero te puedo ayudar con cualquier servicio o información oficial de Clínica Ejemplo. ¿En qué te puedo apoyar?'
  const recommendation = `${general}\nPara cualquier recomendación personalizada, por favor envía un mensaje al WhatsApp de Clínica Ejemplo al 55 1234 5678.`
  const tenantPrompt = `Eres el asistente de Clínica Ejemplo.\nSi preguntan algo externo responde: "${general}"\nSi piden recomendación responde:\n${recommendation}\nNo inventes datos.`

  assert.equal(isAuthorizedOutOfScopeAnswer(general, tenantPrompt), true)
  assert.equal(isAuthorizedOutOfScopeAnswer(recommendation, tenantPrompt), true)
  assert.equal(isAuthorizedOutOfScopeAnswer(`${general} ¿Te ayudo con algo más?`, tenantPrompt), false)
  assert.equal(isAuthorizedOutOfScopeAnswer('No inventes datos.', tenantPrompt), false)
  // another business's phrase is not official for this one
  assert.equal(isAuthorizedOutOfScopeAnswer(general, 'Eres el asistente de Otra Tienda.'), false)
})

test('approves only prompt-authorized payment data after a location reply', () => {
  const paymentHistory: DbConversationMessage[] = [{
    role: 'assistant',
    content: '¡Perfecto! Para enviarte los datos de inscripción y las opciones de pago, ¿nos puedes indicar desde qué ciudad o país nos escribes?',
  }]
  const prompt = `Pago con tarjeta vía Stripe: https://buy.stripe.com/bIY8zf5f962jgyA9HZ
PayPal: https://paypal.me/salubel?locale.x=es_XC
CLABE: 014760655040786599
OXXO: 4830 3045 0694 7021
Banamex: 5204 1653 7821 9095`
  const answer = `Para el curso online puedes pagar con los siguientes métodos:
- Depósito o transferencia bancaria.
- Pago con tarjeta vía Stripe: https://buy.stripe.com/bIY8zf5f962jgyA9HZ
- PayPal: https://paypal.me/salubel?locale.x=es_XC
CLABE 014760655040786599
OXXO 4830 3045 0694 7021
Banamex 5204 1653 7821 9095
Una vez realizado tu pago por favor envía el comprobante por WhatsApp.`

  assert.equal(isAuthorizedPaymentFlowAnswer('Soy de Hermosillo, Sonora', paymentHistory, answer, prompt), true)
  assert.equal(
    isAuthorizedPaymentFlowAnswer(
      'Soy de Hermosillo, Sonora',
      paymentHistory,
      answer.replace('bIY8zf5f962jgyA9HZ', 'enlace-no-autorizado'),
      prompt,
    ),
    false,
  )
})

test('approves prompt-authorized payment data for presencial courses in Mexico without URLs', () => {
  const paymentHistory: DbConversationMessage[] = [{
    role: 'assistant',
    content: '¡Perfecto! Para enviarte los datos de inscripción y las opciones de pago, ¿nos puedes indicar desde qué ciudad o país nos escribes?',
  }]
  const prompt = `CLABE: 014760655040786599
Cuenta: 65-50407865-9
OXXO: 4830 3045 0694 7021
Banamex: 5204 1653 7821 9095`
  const answer = `¡Claro! Aquí tienes los datos para el curso presencial:

Para reservar tu lugar puedes pagar un anticipo de $500 MXN y liquidar el resto un día antes del curso.

Datos de la cuenta y métodos de pago (México):
- Depósito o transferencia bancaria (Santander):
  Banco: Santander
  CLABE interbancaria: 014760655040786599
  Cuenta: 65-50407865-9
- Depósitos en OXXO:
  HSBC 4830 3045 0694 7021
- Pagos en tiendas de autoservicio (Banamex):
  5204 1653 7821 9095

Una vez realizado tu pago, por favor envía el comprobante al WhatsApp oficial +52 1 662 335 8779 junto con tu nombre completo y correo para confirmar tu inscripción.`

  assert.equal(isAuthorizedPaymentFlowAnswer('Hermosillo', paymentHistory, answer, prompt), true)

  // Rejects if account number is invented
  assert.equal(
    isAuthorizedPaymentFlowAnswer(
      'Hermosillo',
      paymentHistory,
      answer.replace('4830 3045 0694 7021', '4830 0000 0000 0000'),
      prompt,
    ),
    false,
  )
})

test('asks to rephrase twice in a row, then leaves the conversation to a person', () => {
  const first = buildClarificationReply([{ role: 'user', content: 'ksdj fcl?' }])
  assert.ok(first)

  const afterOne: DbConversationMessage[] = [
    { role: 'user', content: 'ksdj fcl?' },
    { role: 'assistant', content: first },
    { role: 'user', content: 'xx crs' },
  ]
  const second = buildClarificationReply(afterOne)
  assert.ok(second)
  assert.notEqual(second, first)

  const afterTwo: DbConversationMessage[] = [...afterOne, { role: 'assistant', content: second }, { role: 'user', content: 'zz' }]
  assert.equal(buildClarificationReply(afterTwo), null)
})

test('a real answer between requests to rephrase resets the count', () => {
  const first = buildClarificationReply([])!
  const second = buildClarificationReply([{ role: 'assistant', content: first }])!
  const history: DbConversationMessage[] = [
    { role: 'assistant', content: first },
    { role: 'assistant', content: second },
    { role: 'user', content: 'cursos faciales' },
    { role: 'assistant', content: 'Tenemos Hidrofacial y Russian Lips.' },
    { role: 'user', content: 'asdf' },
  ]
  assert.equal(buildClarificationReply(history), first)
})

test('a tenant without a courses document is not offered courses when asked to rephrase', () => {
  const first = buildClarificationReply([], false)!
  assert.doesNotMatch(first, /curso/i)
  assert.match(first, /producto o servicio/)
  assert.match(buildClarificationReply([], true)!, /curso, producto o servicio/)

  // the no-courses wording still counts toward the limit of two in a row
  const second = buildClarificationReply([{ role: 'assistant', content: first }], false)!
  assert.doesNotMatch(second, /curso/i)
  assert.equal(buildClarificationReply([{ role: 'assistant', content: first }, { role: 'assistant', content: second }], false), null)
})

test('a course listed in the business requirements block brings that block along', () => {
  const index = createSearchIndex({
    tenantId: 'tenant',
    documents: [{
      id: 'courses',
      title: 'cursos.md',
      docType: 'cursos',
      section: 'cursos',
      isActive: true,
      updatedAt: '2026-01-01T00:00:00.000Z',
      content: [
        '[REQUISITOS_PARA_TOMAR_CURSOS]',
        'Se requiere titulo medico para aplicar los tratamientos de estos cursos:',
        '- Rinomodelacion con acido hialuronico',
        '- Aplicacion de Botox en tercio superior',
        '',
        '[CURSO]', 'Nombre del curso: Rinomodelación.', 'Precio: $895 MXN', '',
        '[CURSO]', 'Nombre del curso: Toxina Botulínica: Tercio superior.', 'Precio: $895 MXN', '',
        '[CURSO]', 'Nombre del curso: Mesobotox.', 'Precio: $895 MXN',
      ].join('\n'),
    }] as any,
  })
  const card = (name: string) => index.blocks.find((block) => block.fields.name.startsWith(name))!

  assert.match(findRequirementBlockForCourses(index.blocks, [card('Rinomodelación')])?.body || '', /titulo medico/)
  assert.match(findRequirementBlockForCourses(index.blocks, [card('Toxina')])?.body || '', /titulo medico/)
  assert.equal(findRequirementBlockForCourses(index.blocks, [card('Mesobotox')]), null)
})

test('the business name, contact and payment blocks come from its general documents', () => {
  const index = createSearchIndex({
    tenantId: 'tenant',
    documents: [{
      id: 'general',
      title: 'infogeneral.md',
      docType: 'general',
      section: 'general',
      isActive: true,
      updatedAt: '2026-01-01T00:00:00.000Z',
      content: [
        '[NOMBRE_DE_EMPRESA]', 'Clinica Ejemplo', '',
        '[UBICACION]', 'Av. Principal 123', '',
        '[WHATSAPP_OFICIAL]', '+52 55 1234 5678', '',
        '[DATOS_BANCARIOS_PUBLICOS]', 'BBVA cuenta 0123 4567 8901 2345', '',
        '[FORMAS_DE_PAGO_ACEPTADAS]', 'Transferencia, tarjeta o efectivo.', '',
        '[MISION]', 'Ayudar a nuestros clientes.',
      ].join('\n'),
    }] as any,
  })

  const profile = findBusinessProfileBlocks(index.blocks, []).map((block) => block.body)
  assert.deepEqual(profile, ['[NOMBRE_DE_EMPRESA]\nClinica Ejemplo', '[WHATSAPP_OFICIAL]\n+52 55 1234 5678'])
  const payment = findBusinessPaymentBlocks(index.blocks, []).map((block) => block.body)
  assert.deepEqual(payment, [
    '[DATOS_BANCARIOS_PUBLICOS]\nBBVA cuenta 0123 4567 8901 2345',
    '[FORMAS_DE_PAGO_ACEPTADAS]\nTransferencia, tarjeta o efectivo.',
  ])
})

test('payment blocks are sent only in payment or enrollment conversations', () => {
  assert.equal(isPaymentConversation('como puedo pagar?', []), true)
  assert.equal(isPaymentConversation('Hermosillo', [{ role: 'assistant', content: '¿Desde qué ciudad o país nos escribes?' }]), true)
  assert.equal(isPaymentConversation('que cursos tienen para la cara', [{ role: 'assistant', content: 'Hola, ¿en qué te ayudo?' }]), false)
})

const followUpIndex = createSearchIndex({
  tenantId: 'tenant',
  documents: [
    {
      id: 'courses',
      title: 'cursos.md',
      docType: 'cursos',
      section: 'cursos',
      isActive: true,
      updatedAt: '2026-01-01T00:00:00.000Z',
      content: '[CURSO]\nNombre del curso: Hidrofacial\nModalidades: Presencial\nPrecio: $2850 MXN\n\n[CURSO]\nNombre del curso: Mesobotox\nPrecio: $895 MXN',
    },
    {
      id: 'general',
      title: 'infogeneral.md',
      docType: 'general',
      section: 'general',
      isActive: true,
      updatedAt: '2026-01-01T00:00:00.000Z',
      content: '[CURSOS_SUCURSALES]\nLos cursos presenciales se imparten solo en Hermosillo.',
    },
  ] as any,
})

test('a follow-up that names nothing is searched with the earlier question that did', () => {
  const history: DbConversationMessage[] = [
    { role: 'user', content: 'hola' },
    { role: 'user', content: 'tiene scursos en hermosillo?' },
    { role: 'assistant', content: 'Sí, en Hermosillo impartimos Hidrofacial de forma presencial.' },
  ]
  assert.equal(findPreviousTopicQuestion(followUpIndex, history), 'tiene scursos en hermosillo?')
  assert.equal(findPreviousTopicQuestion(followUpIndex, [{ role: 'user', content: 'hola' }]), null)
})

test('the model rewrites a follow-up only when the rules found no course, product or treatment', () => {
  const history: DbConversationMessage[] = [{ role: 'assistant', content: 'Tenemos el curso Hidrofacial.' }]
  // only general blocks (location, FAQ), as "¿cuales son los precios?" got with the real documents
  const generalBlock = followUpIndex.blocks.find((block) => block.document.section === 'general')!
  const nothing = { contextBlock: generalBlock.body, matchedBlocks: [generalBlock] }
  const courses = searchIndex(followUpIndex, 'que cursos tienen')
  assert.equal(hasCatalogInformation(nothing), false)
  assert.equal(hasCatalogInformation({ contextBlock: '(Sin documentos activos)', matchedBlocks: [] }), false)
  assert.equal(hasCatalogInformation(courses), true)

  assert.equal(shouldRewriteFollowUp('y eso cuanto es?', history, false, nothing), true)
  // the rules already found the courses
  assert.equal(shouldRewriteFollowUp('y eso cuanto es?', history, false, courses), false)
  // the message says what it is about, or is a greeting or a "si", or there is no conversation yet
  assert.equal(shouldRewriteFollowUp('precio del hidrofacial', history, true, nothing), false)
  assert.equal(shouldRewriteFollowUp('gracias!', history, false, nothing), false)
  assert.equal(shouldRewriteFollowUp('si', history, false, nothing), false)
  assert.equal(shouldRewriteFollowUp('y eso cuanto es?', [], false, nothing), false)
})
