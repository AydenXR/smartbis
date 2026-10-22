import { loadLlmRuntimeConfig } from './runtimeConfig.js'
import { createSearchIndex, searchIndex, type SearchIndex } from './searchIndex.js'

const DEFAULT_PROMPT = `Eres el agente de este cliente. Responde solo con informacion respaldada por el prompt y los documentos disponibles en la base de datos.

Reglas:
- No inventes datos, precios, horarios, promociones o servicios.
- Si algo no aparece en los documentos, dilo con claridad.
- Mantente enfocado en la informacion real del cliente.
- Usa un tono claro, directo y amable.`

export type DocumentSection = 'general' | 'cursos' | 'productos'

type PromptConfigRow = {
  id: string
  tenant_id: string
  config_key: string
  config_value: { prompt?: string } | string | null
}

type DocumentRow = {
  id: string
  tenant_id: string
  title: string
  doc_type: string
  content_markdown: string
  is_active: boolean
  updated_at: string
}

export type WorkspaceDocument = {
  id: string
  title: string
  docType: string
  section: DocumentSection
  content: string
  isActive: boolean
  updatedAt: string
}

let cachedTenantId: string | null = null
const tenantSearchIndexCache = new Map<string, SearchIndex>()

function getSupabaseConfig() {
  const url = process.env.SUPABASE_URL
  const apiKey = process.env.SUPABASE_SECRET_KEY

  if (!url || !apiKey) {
    throw new Error('Falta la configuracion de Supabase en el servidor')
  }

  return { url, apiKey }
}

function getDocumentSection(docType: string): DocumentSection {
  if (docType === 'cursos') {
    return 'cursos'
  }

  if (docType === 'productos') {
    return 'productos'
  }

  return 'general'
}

function getDocTypeFromSection(section: DocumentSection) {
  if (section === 'cursos') {
    return 'cursos'
  }

  if (section === 'productos') {
    return 'productos'
  }

  return 'empresa'
}

function mapDocument(row: DocumentRow): WorkspaceDocument {
  return {
    id: row.id,
    title: row.title,
    docType: row.doc_type,
    section: getDocumentSection(row.doc_type),
    content: row.content_markdown || '',
    isActive: Boolean(row.is_active),
    updatedAt: row.updated_at,
  }
}

async function restRequest<T>(
  path: string,
  options?: {
    method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
    query?: Record<string, string>
    body?: unknown
    headers?: Record<string, string>
  },
) {
  const { url, apiKey } = getSupabaseConfig()
  const requestUrl = new URL(`/rest/v1/${path}`, url)

  for (const [key, value] of Object.entries(options?.query || {})) {
    requestUrl.searchParams.set(key, value)
  }

  const response = await fetch(requestUrl, {
    method: options?.method || 'GET',
    headers: {
      apikey: apiKey,
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...(options?.headers || {}),
    },
    body: options?.body ? JSON.stringify(options.body) : undefined,
    signal: AbortSignal.timeout(45000),
  })

  const text = await response.text()
  const payload = text ? JSON.parse(text) : null

  if (!response.ok) {
    const message =
      payload?.message || payload?.error_description || payload?.hint || 'Error en Supabase'

    throw new Error(message)
  }

  return payload as T
}

async function resolveTenantId() {
  if (cachedTenantId) {
    return cachedTenantId
  }

  if (process.env.DEFAULT_TENANT_ID) {
    cachedTenantId = process.env.DEFAULT_TENANT_ID
    return cachedTenantId
  }

  const [promptRows, documentRows, tenantRows] = await Promise.all([
    restRequest<Array<{ tenant_id: string }>>('crm_configs', {
      query: {
        select: 'tenant_id',
        config_key: 'eq.agent_prompt',
        limit: '1',
      },
    }),
    restRequest<Array<{ tenant_id: string }>>('documents', {
      query: {
        select: 'tenant_id',
        limit: '1',
      },
    }),
    restRequest<Array<{ id: string }>>('tenants', {
      query: {
        select: 'id',
        limit: '1',
      },
    }),
  ])

  cachedTenantId = promptRows[0]?.tenant_id || documentRows[0]?.tenant_id || tenantRows[0]?.id || null

  if (!cachedTenantId) {
    throw new Error('No se pudo resolver el tenant de trabajo')
  }

  return cachedTenantId
}

async function listDocumentsForTenant(tenantId: string) {
  const rows = await restRequest<DocumentRow[]>('documents', {
    query: {
      select: 'id,tenant_id,title,doc_type,content_markdown,is_active,updated_at',
      tenant_id: `eq.${tenantId}`,
      order: 'updated_at.desc',
    },
  })

  return rows.map(mapDocument)
}

function invalidateTenantSearchIndex(tenantId: string) {
  tenantSearchIndexCache.delete(tenantId)
}

async function getTenantSearchIndex(tenantId: string, documents?: WorkspaceDocument[]) {
  const nextDocuments = documents || (await listDocumentsForTenant(tenantId))
  const nextIndex = createSearchIndex({
    tenantId,
    documents: nextDocuments,
  })
  const cachedIndex = tenantSearchIndexCache.get(tenantId)

  if (cachedIndex && cachedIndex.signature === nextIndex.signature) {
    return cachedIndex
  }

  tenantSearchIndexCache.set(tenantId, nextIndex)
  return nextIndex
}

export async function loadPrompt() {
  const tenantId = await resolveTenantId()
  const rows = await restRequest<PromptConfigRow[]>('crm_configs', {
    query: {
      select: 'id,tenant_id,config_key,config_value',
      tenant_id: `eq.${tenantId}`,
      config_key: 'eq.agent_prompt',
      limit: '1',
    },
  })

  const configValue = rows[0]?.config_value

  if (typeof configValue === 'string' && configValue.trim()) {
    return configValue
  }

  if (configValue && typeof configValue === 'object' && typeof configValue.prompt === 'string') {
    return configValue.prompt.trim() || DEFAULT_PROMPT
  }

  return DEFAULT_PROMPT
}

export async function savePrompt(prompt: string) {
  const tenantId = await resolveTenantId()
  const rows = await restRequest<PromptConfigRow[]>('crm_configs', {
    query: {
      select: 'id',
      tenant_id: `eq.${tenantId}`,
      config_key: 'eq.agent_prompt',
      limit: '1',
    },
  })

  const configValue = { prompt }
  const updatedAt = new Date().toISOString()

  if (rows[0]?.id) {
    await restRequest('crm_configs', {
      method: 'PATCH',
      query: {
        id: `eq.${rows[0].id}`,
      },
      body: {
        config_value: configValue,
        updated_at: updatedAt,
      },
      headers: {
        Prefer: 'return=minimal',
      },
    })
  } else {
    await restRequest('crm_configs', {
      method: 'POST',
      body: {
        tenant_id: tenantId,
        config_key: 'agent_prompt',
        config_value: configValue,
        updated_at: updatedAt,
      },
      headers: {
        Prefer: 'return=minimal',
      },
    })
  }

  return prompt
}

export async function listDocuments() {
  const tenantId = await resolveTenantId()
  return listDocumentsForTenant(tenantId)
}

export async function createDocument(input: {
  section: DocumentSection
  title: string
  content: string
  isActive: boolean
}) {
  const tenantId = await resolveTenantId()
  const rows = await restRequest<DocumentRow[]>('documents', {
    method: 'POST',
    body: {
      tenant_id: tenantId,
      title: input.title,
      doc_type: getDocTypeFromSection(input.section),
      content_markdown: input.content,
      is_active: input.isActive,
      updated_at: new Date().toISOString(),
    },
    headers: {
      Prefer: 'return=representation',
    },
  })

  const document = mapDocument(rows[0])
  invalidateTenantSearchIndex(tenantId)
  return document
}

export async function updateDocument(
  id: string,
  input: {
    title: string
    content: string
    isActive: boolean
  },
) {
  const tenantId = await resolveTenantId()
  const rows = await restRequest<DocumentRow[]>('documents', {
    method: 'PATCH',
    query: {
      id: `eq.${id}`,
      tenant_id: `eq.${tenantId}`,
    },
    body: {
      title: input.title,
      content_markdown: input.content,
      is_active: input.isActive,
      updated_at: new Date().toISOString(),
    },
    headers: {
      Prefer: 'return=representation',
    },
  })

  const document = mapDocument(rows[0])
  invalidateTenantSearchIndex(tenantId)
  return document
}

export async function deleteDocument(id: string) {
  const tenantId = await resolveTenantId()

  await restRequest('documents', {
    method: 'DELETE',
    query: {
      id: `eq.${id}`,
      tenant_id: `eq.${tenantId}`,
    },
    headers: {
      Prefer: 'return=minimal',
    },
  })

  invalidateTenantSearchIndex(tenantId)
}

export async function loadWorkspace() {
  const [prompt, documents, llmConfig] = await Promise.all([
    loadPrompt(),
    listDocuments(),
    loadLlmRuntimeConfig(),
  ])

  return {
    prompt,
    documents,
    llmConfig,
  }
}

export async function buildDocumentsContextBlock(query = '') {
  const tenantId = await resolveTenantId()
  const index = await getTenantSearchIndex(tenantId)
  const result = searchIndex(index, query)

  return {
    documents: result.documents,
    contextBlock: result.contextBlock,
  }
}
