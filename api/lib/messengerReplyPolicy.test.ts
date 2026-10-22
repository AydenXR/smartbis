import assert from 'node:assert/strict'
import test from 'node:test'
import { isMissingInformationAnswer, shouldSendMessengerAnswer } from './messengerReplyPolicy.js'

const missingInformationReplies = [
  'No tengo información sobre ese dato.',
  'No tengo la información en este momento.',
  'No cuento con esa información.',
  'No contamos con esos datos.',
  'No tenemos información disponible.',
  'No hay información sobre ese producto.',
  'No existe información de ese servicio.',
  'No sé cuál es el precio.',
  'No sabemos la fecha de inicio.',
  'Desconozco el horario de atención.',
  'No puedo responder esa pregunta.',
  'No podemos ayudarte con ese tema.',
  'No puedo ayudarte con eso, disculpa.',
  'No puedo confirmar ese dato.',
  'No me es posible confirmar el costo.',
  'No dispongo de esos datos.',
  'No tengo acceso a esa información.',
  'No estoy seguro de la respuesta.',
  'No estoy capacitada para responder.',
  'No sabría decirte qué fecha es.',
  'Lo siento, no tengo info sobre eso.',
  'No cuento con la informacion por ahora.',
  '[NO_RESPONDER]',
  'La respuesta es $500, pero no tengo información adicional.',
  "I don't have that information right now.",
  "I can't confirm that data.",
]

test('silencia respuestas de falta de información en el último paso de Messenger aunque el juez las aprobara', () => {
  for (const answer of missingInformationReplies) {
    assert.equal(isMissingInformationAnswer(answer), true, `debe detectar: ${answer}`)
    assert.equal(shouldSendMessengerAnswer(answer, false), false, `no debe enviar: ${answer}`)
  }
})

test('silencia cualquier respuesta que el autocurador haya bloqueado', () => {
  assert.equal(shouldSendMessengerAnswer('La fecha es el 18 de noviembre.', true), false)
})

test('permite respuestas respaldables y preguntas de aclaración sin admitir falta de información', () => {
  const allowed = [
    'El curso cuesta $500 MXN.',
    '¿Te interesa la modalidad presencial o en línea?',
    'Las citas se agendan por WhatsApp.',
    'No hay cursos presenciales esta semana; la próxima fecha es el 18 de noviembre.',
    'Con gusto te ayudo. ¿Qué tratamiento te interesa?',
  ]
  for (const answer of allowed) {
    assert.equal(isMissingInformationAnswer(answer), false, `no debe confundir con falta de información: ${answer}`)
    assert.equal(shouldSendMessengerAnswer(answer, false), true, `debe pasar al juez de contenido: ${answer}`)
  }
})
