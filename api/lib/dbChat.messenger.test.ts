import test from 'node:test'
import assert from 'node:assert/strict'
import { cutAtBoundary, MESSENGER_MAX_TEXT, shortenForMessenger } from './dbChat.js'

test('a short answer goes to Messenger unchanged', async () => {
  assert.equal(await shortenForMessenger('Hola, el curso cuesta $895 MXN.'), 'Hola, el curso cuesta $895 MXN.')
})

test('a long answer is cut at a sentence or paragraph, never mid-word or mid-price', () => {
  const sentences = Array.from({ length: 80 }, (_, i) => `El curso ${i + 1} cuesta $${800 + i} MXN.`).join(' ')
  const cut = cutAtBoundary(sentences)
  assert.ok(cut.length <= MESSENGER_MAX_TEXT)
  assert.match(cut, /MXN\.$/)

  const paragraphs = Array.from({ length: 40 }, (_, i) => `- Curso ${i + 1}: Online $895 MXN\n  Presencial $2,850 MXN`).join('\n\n')
  const byParagraph = cutAtBoundary(paragraphs)
  assert.ok(byParagraph.length <= MESSENGER_MAX_TEXT)
  assert.match(byParagraph, /\$2,850 MXN$/)
})

test('without the model, a long answer still fits in Messenger', async () => {
  const saved = { llm: process.env.LLM_API_KEY, xai: process.env.XAI_API_KEY }
  delete process.env.LLM_API_KEY
  delete process.env.XAI_API_KEY
  try {
    const long = 'Tenemos este curso disponible en línea y presencial. '.repeat(80)
    const result = await shortenForMessenger(long)
    assert.ok(result.length <= MESSENGER_MAX_TEXT)
    assert.ok(result.length > 900)
  } finally {
    if (saved.llm !== undefined) process.env.LLM_API_KEY = saved.llm
    if (saved.xai !== undefined) process.env.XAI_API_KEY = saved.xai
  }
})
