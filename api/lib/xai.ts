import { buildDocumentsContextBlock } from './workspace.js'

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

const DEFAULT_BASE_URL = 'https://api.x.ai/v1/chat/completions'

function getConfiguredModel() {
  return process.env.LLM_MODEL_NAME?.trim() || process.env.XAI_MODEL?.trim() || 'grok-4.3'
}

function getConfiguredBaseUrl() {
  return process.env.LLM_BASE_URL?.trim() || process.env.XAI_BASE_URL?.trim() || DEFAULT_BASE_URL
}

function getConfiguredApiKey() {
  return process.env.LLM_API_KEY?.trim() || process.env.XAI_API_KEY?.trim() || ''
}

function getConfiguredMaxTokens() {
  const rawValue = process.env.LLM_MAX_TOKENS?.trim()
  const parsedValue = rawValue ? Number.parseInt(rawValue, 10) : Number.NaN

  if (Number.isFinite(parsedValue) && parsedValue > 0) {
    return parsedValue
  }

  return 420
}

function getConfiguredFallbackModel() {
  const explicitFallback = process.env.LLM_FALLBACK_MODEL?.trim()

  if (explicitFallback) {
    return explicitFallback
  }

  return ''
}

function buildSystemPrompt(prompt: string, contextBlock: string) {
  return `${prompt}

Fuentes de verdad:
${contextBlock}`
}

type CompletionChunk = {
  answer: string
  finishReason: string | null
}

async function requestCompletion(args: {
  apiKey: string
  baseUrl: string
  model: string
  fallbackModel?: string
  maxTokens: number
  messages: Array<{ role: string; content: string }>
}) {
  let requestedMaxTokens = args.maxTokens
  let activeModel = args.model

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(args.baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${args.apiKey}`,
      },
      body: JSON.stringify({
        model: activeModel,
        temperature: 0.2,
        max_tokens: requestedMaxTokens,
        messages: args.messages,
      }),
      signal: AbortSignal.timeout(45000),
    })

    const payload = await response.json().catch(() => null)

    if (!response.ok) {
      const message =
        payload?.error?.message ||
        payload?.message ||
        'No se pudo obtener respuesta del modelo'

      const insufficientCredits = /insufficient credits|never purchased credits/i.test(message)
      if (insufficientCredits && args.fallbackModel && activeModel !== args.fallbackModel) {
        activeModel = args.fallbackModel
        requestedMaxTokens = Math.min(requestedMaxTokens, 320)
        continue
      }

      const affordableMatch = message.match(/can only afford\s+(\d+)/i)
      if (affordableMatch?.[1]) {
        const affordableTokens = Number.parseInt(affordableMatch[1], 10)

        if (Number.isFinite(affordableTokens) && affordableTokens > 32) {
          requestedMaxTokens = Math.max(32, affordableTokens - 8)
          continue
        }
      }

      throw new Error(message)
    }

    const choice = payload?.choices?.[0]
    const answer = choice?.message?.content?.trim()

    if (!answer) {
      if (attempt < 2) {
        requestedMaxTokens = Math.max(64, Math.floor(requestedMaxTokens * 0.75))
        continue
      }

      throw new Error('El modelo no devolvio contenido')
    }

    return {
      answer,
      finishReason: typeof choice?.finish_reason === 'string' ? choice.finish_reason : null,
    } satisfies CompletionChunk
  }

  throw new Error('No se pudo obtener respuesta del modelo')
}

export async function generateAgentAnswer(input: ChatInput) {
  const apiKey = getConfiguredApiKey()
  const baseUrl = getConfiguredBaseUrl()
  const model = getConfiguredModel()
  const fallbackModel = getConfiguredFallbackModel()
  const maxTokens = getConfiguredMaxTokens()

  if (!apiKey) {
    throw new Error('LLM_API_KEY no esta configurada')
  }

  const { documents, contextBlock } = await buildDocumentsContextBlock(input.message)
  const trimmedHistory = input.history.slice(-6)
  const systemPrompt = buildSystemPrompt(input.prompt, contextBlock)
  const baseMessages = [
    {
      role: 'system',
      content: systemPrompt,
    },
    ...trimmedHistory,
    {
      role: 'user',
      content: input.message,
    },
  ]

  const chunks: string[] = []
  let continuationMessages = baseMessages

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const completion = await requestCompletion({
      apiKey,
      baseUrl,
      model,
      fallbackModel,
      maxTokens,
      messages: continuationMessages,
    })

    chunks.push(completion.answer)

    if (completion.finishReason !== 'length') {
      break
    }

    continuationMessages = [
      ...baseMessages,
      {
        role: 'assistant',
        content: chunks.join('\n').trim(),
      },
      {
        role: 'user',
        content:
          'Continua exactamente desde donde te quedaste y termina la respuesta de forma completa, sin repetir lo anterior.',
      },
    ]
  }

  const answer = chunks.join('\n').trim()

  return {
    answer,
    sources: documents.map((document) => ({
      id: document.id,
      title: document.title,
      section: document.section,
      isActive: document.isActive,
    })),
  }
}
