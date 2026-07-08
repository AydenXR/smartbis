import { buildSourcesContextBlock } from './context.js'

type Role = 'user' | 'assistant'

export type ConversationMessage = {
  role: Role
  content: string
}

type ChatInput = {
  prompt: string
  message: string
  history: ConversationMessage[]
}

const XAI_ENDPOINT = 'https://api.x.ai/v1/chat/completions'
const DEFAULT_MODEL = process.env.XAI_MODEL || 'grok-4.3'

function buildSystemPrompt(prompt: string, contextBlock: string) {
  return `${prompt}

Reglas obligatorias:
- Usa unicamente la informacion de los archivos proporcionados como fuente de verdad.
- No inventes precios, fechas, promociones, productos, cursos, tratamientos, horarios o servicios que no esten en los archivos.
- Si la informacion no aparece en las fuentes, responde claramente que no lo sabes o que no esta disponible en la informacion actual.
- Si la pregunta no se relaciona con Salubel Institute, redirige amablemente la conversacion a temas de la empresa.
- No respondas como si pudieras agendar, vender, cobrar o confirmar disponibilidad en tiempo real.
- Si una categoria esta vacia, no supongas contenido.

Fuentes de verdad:
${contextBlock}`
}

export async function generateAgentAnswer(input: ChatInput) {
  const apiKey = process.env.XAI_API_KEY

  if (!apiKey) {
    throw new Error('XAI_API_KEY no esta configurada')
  }

  const { sources, contextBlock } = await buildSourcesContextBlock()
  const systemPrompt = buildSystemPrompt(input.prompt, contextBlock)
  const trimmedHistory = input.history.slice(-8)

  const response = await fetch(XAI_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: DEFAULT_MODEL,
      temperature: 0.2,
      max_tokens: 500,
      messages: [
        {
          role: 'system',
          content: systemPrompt,
        },
        ...trimmedHistory,
        {
          role: 'user',
          content: input.message,
        },
      ],
    }),
    signal: AbortSignal.timeout(45000),
  })

  const payload = await response.json().catch(() => null)

  if (!response.ok) {
    const message =
      payload?.error?.message ||
      payload?.message ||
      'No se pudo obtener respuesta del modelo'

    throw new Error(message)
  }

  const answer = payload?.choices?.[0]?.message?.content?.trim()

  if (!answer) {
    throw new Error('El modelo no devolvio contenido')
  }

  return {
    answer,
    sources: sources.map((source) => ({
      file: source.file,
      hasContent: source.hasContent,
    })),
  }
}
