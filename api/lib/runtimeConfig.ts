import { promises as fs } from 'fs'
import path from 'path'
import dotenv from 'dotenv'

const ENV_LOCAL_PATH = path.resolve(process.cwd(), '.env.local')
const DEFAULT_MODEL = 'grok-4.3'
const DEFAULT_BASE_URL = 'https://api.x.ai/v1/chat/completions'

export type LlmRuntimeConfig = {
  baseUrl: string
  model: string
  hasApiKey: boolean
  apiKeyPreview: string
}

function maskApiKey(apiKey: string) {
  const trimmed = apiKey.trim()

  if (!trimmed) {
    return ''
  }

  if (trimmed.length <= 8) {
    return 'Configurada'
  }

  return `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`
}

async function readEnvLocalRaw() {
  return fs.readFile(ENV_LOCAL_PATH, 'utf8').catch(() => '')
}

function upsertEnvVar(raw: string, key: string, value: string) {
  const normalized = value.trim()
  const line = `${key}=${normalized}`
  const matcher = new RegExp(`^${key}=.*$`, 'm')

  if (matcher.test(raw)) {
    return raw.replace(matcher, line)
  }

  const trimmed = raw.trimEnd()

  if (!trimmed) {
    return `${line}\n`
  }

  return `${trimmed}\n${line}\n`
}

export async function loadLlmRuntimeConfig(): Promise<LlmRuntimeConfig> {
  const apiKey = process.env.LLM_API_KEY?.trim() || process.env.XAI_API_KEY?.trim() || ''
  const model =
    process.env.LLM_MODEL_NAME?.trim() || process.env.XAI_MODEL?.trim() || DEFAULT_MODEL
  const baseUrl =
    process.env.LLM_BASE_URL?.trim() || process.env.XAI_BASE_URL?.trim() || DEFAULT_BASE_URL

  return {
    baseUrl,
    model,
    hasApiKey: Boolean(apiKey),
    apiKeyPreview: maskApiKey(apiKey),
  }
}

export async function saveLlmRuntimeConfig(input: {
  baseUrl: string
  model: string
  apiKey?: string
}) {
  const nextBaseUrl = input.baseUrl.trim()
  const nextModel = input.model.trim()

  if (!nextBaseUrl || !nextModel) {
    throw new Error('El endpoint y el modelo son obligatorios')
  }

  let raw = await readEnvLocalRaw()
  raw = upsertEnvVar(raw, 'LLM_BASE_URL', nextBaseUrl)
  raw = upsertEnvVar(raw, 'LLM_MODEL_NAME', nextModel)

  const nextApiKey = input.apiKey?.trim()
  if (typeof nextApiKey === 'string' && nextApiKey.length > 0) {
    raw = upsertEnvVar(raw, 'LLM_API_KEY', nextApiKey)
    process.env.LLM_API_KEY = nextApiKey
  }

  await fs.writeFile(ENV_LOCAL_PATH, raw, 'utf8')
  process.env.LLM_BASE_URL = nextBaseUrl
  process.env.LLM_MODEL_NAME = nextModel

  return loadLlmRuntimeConfig()
}

export async function syncEnvLocalToProcess() {
  const raw = await readEnvLocalRaw()

  if (!raw.trim()) {
    return
  }

  const parsed = dotenv.parse(raw)

  for (const [key, value] of Object.entries(parsed)) {
    if (value) {
      process.env[key] = value
    }
  }
}
