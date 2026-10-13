import assert from 'node:assert/strict'
import test from 'node:test'
import {
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

test('authorizes the exact official out-of-scope responses', () => {
  const general = 'No estoy capacitado para responder dudas externas a Salubel Institute, pero te puedo ayudar con cualquier curso, producto o información oficial de Salubel Institute. ¿En qué te puedo apoyar?'
  const recommendation = `${general}\nPara cualquier recomendación o asesoría personalizada, por favor envía un mensaje al WhatsApp de Salubel Institute al +52 1 662 335 8779.`

  assert.equal(isAuthorizedOutOfScopeAnswer(general), true)
  assert.equal(isAuthorizedOutOfScopeAnswer(recommendation), true)
  assert.equal(isAuthorizedOutOfScopeAnswer(`${general} ¿Te ayudo con algo más?`), false)
  assert.equal(isAuthorizedOutOfScopeAnswer('No cuento con la información en este momento.'), false)
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
