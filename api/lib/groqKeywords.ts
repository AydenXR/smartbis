import { createHash } from 'node:crypto'

export type KeywordChunk = { hash: string; keywords: string[] }
export type StoredKeywordChunks = {
  version: 1
  contentHash: string
  chunks: KeywordChunk[]
  status?: 'ok' | 'failed'
  retryAt?: string
}

const GROQ_CHAT_COMPLETIONS_URL = 'https://api.groq.com/openai/v1/chat/completions'
const MAX_CHUNKS_PER_REQUEST = 8

function parseJsonObject(text: string) {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
  try { return JSON.parse(cleaned) } catch { /* try extracting the JSON object */ }
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('Groq no devolvió un objeto JSON completo')
  return JSON.parse(cleaned.slice(start, end + 1))
}

function getGroqConfig() {
  const baseUrl = process.env.LLM_BASE_URL?.trim() || process.env.XAI_BASE_URL?.trim() || ''
  const key = process.env.GROQ_API_KEY?.trim() ||
    (/groq\.com/i.test(baseUrl) ? (process.env.LLM_API_KEY?.trim() || process.env.XAI_API_KEY?.trim()) : '')
  if (!key) return null
  return {
    key,
    model: process.env.GROQ_KEYWORD_MODEL?.trim() || process.env.LLM_MODEL_NAME?.trim() || process.env.XAI_MODEL?.trim() || 'llama-3.3-70b-versatile',
  }
}

function contentHash(content: string) {
  return createHash('sha256').update(content).digest('hex')
}

export function getKeywordContentHash(content: string) {
  return contentHash(content)
}

function normalizeKeywords(value: unknown) {
  if (!Array.isArray(value)) return []
  return [...new Set(value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim().toLocaleLowerCase('es').replace(/\s+/g, ' '))
    .filter((item) => item.length >= 2 && item.length <= 64))].slice(0, 12)
}

async function generateBatch(chunks: Array<{ hash: string; text: string }>, config: { key: string; model: string }) {
  let lastError: unknown
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(GROQ_CHAT_COMPLETIONS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.key}` },
        body: JSON.stringify({
          model: config.model,
          temperature: 0,
          max_tokens: Math.min(2400, Math.max(1200, chunks.length * 240)),
          reasoning_effort: 'low',
          messages: [
            { role: 'system', content: 'Devuelve únicamente JSON válido con la forma {"items":[{"hash":"...","keywords":["..."]}]}. Extrae términos de búsqueda concisos en español para encontrar cada fragmento. Usa únicamente conceptos, nombres propios, sinónimos directos y atributos respaldados explícitamente por el fragmento. No agregues hechos ni valores. Máximo 10 keywords por fragmento.' },
            { role: 'user', content: JSON.stringify({ chunks }) },
          ],
        }),
        signal: AbortSignal.timeout(30000),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.error?.message || `Groq keywords respondió ${response.status}`)
      const text = String(payload?.choices?.[0]?.message?.content || '')
      const parsed = parseJsonObject(text)
      if (!Array.isArray(parsed.items)) throw new Error('Groq no devolvió items de keywords')
      const byHash = new Map<string, string[]>()
      for (const item of parsed.items) {
        if (typeof item?.hash === 'string') byHash.set(item.hash, normalizeKeywords(item.keywords))
      }
      return chunks.map(({ hash }) => ({ hash, keywords: byHash.get(hash) || [] }))
    } catch (error) {
      lastError = error
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError || 'Falló la generación de keywords'))
}

export async function generateDocumentKeywordChunks(content: string, chunks: Array<{ hash: string; text: string }>): Promise<StoredKeywordChunks | null> {
  const config = getGroqConfig()
  if (!config || chunks.length === 0) return null

  const result: KeywordChunk[] = []
  for (let offset = 0; offset < chunks.length; offset += MAX_CHUNKS_PER_REQUEST) {
    result.push(...await generateBatch(chunks.slice(offset, offset + MAX_CHUNKS_PER_REQUEST), config))
  }
  return { version: 1, contentHash: contentHash(content), chunks: result, status: 'ok' }
}

export function storedKeywordsMatchContent(stored: unknown, content: string) {
  if (!stored || typeof stored !== 'object') return false
  const candidate = stored as Partial<StoredKeywordChunks>
  return candidate.version === 1 && candidate.contentHash === contentHash(content) && Array.isArray(candidate.chunks)
}
