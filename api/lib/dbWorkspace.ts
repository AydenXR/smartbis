import {
  createSearchIndex,
  getSearchIndexSignature,
  type SearchIndex,
} from './searchIndex.js'
import { loginSubuser, verifyLocalJwt } from './posStore.js'

type TenantRow = {
  id: string
  name: string
  slug: string
  created_by: string
  created_at?: string
  updated_at?: string
}

type DocumentRow = {
  id: string
  tenant_id: string
  title: string
  doc_type: string
  content_markdown: string
  is_active: boolean
  created_at?: string
  updated_at: string
}

type PromptConfigRow = {
  id: string
  tenant_id: string
  config_key: string
  config_value: { prompt?: string } | string | null
  created_at?: string
  updated_at?: string
}

type AuthUserResponse = {
  id: string
  email?: string
}

export type DbAuthUser = {
  id: string
  email: string
  clientId: string
  tenantId: string
  posRole?: 'owner' | 'admin' | 'admin_pv' | 'admin_cs' | 'cashier' | 'cs_agent'
  posBranchId?: string
  subuserId?: string
  displayName?: string
  authKind?: 'tenant_owner' | 'pos_subuser'
}

export type DbWorkspaceDocument = {
  id: string
  fileName: string
  label: string
  content: string
  updatedAt: string
}

export type DbAgentDocument = {
  id: string
  title: string
  docType: string
  section: 'general' | 'cursos' | 'productos'
  content: string
  isActive: boolean
  updatedAt: string
}

export type DbIngestionStatus = {
  ok: boolean
  indexedAt?: string
  documents?: number
  activeDocuments?: number
  blocks?: number
  error?: string
}

const tenantSearchIndexCache = new Map<string, { signature: string; index: SearchIndex }>()

const DEFAULT_PROMPT = `Eres el agente de este cliente. Responde solo con informacion respaldada por el prompt y los documentos disponibles en la base de datos.

Reglas:
- No inventes datos, precios, horarios, promociones o servicios.
- Si algo no aparece en los documentos, dilo con claridad.
- Mantente enfocado en la informacion real del cliente.
- Usa un tono claro, directo y amable.`

const DEFAULT_DOCUMENTS: Array<{ fileName: string; content: string }> = [
  {
    fileName: 'infogeneral.md',
    content: `[NOMBRE_DE_EMPRESA]
Nueva cuenta Smartbis

[DESCRIPCION]
Agrega aqui la informacion general del cliente.

[CONTACTO]
Correo de acceso: {{EMAIL}}

[NOTAS]
Edita este documento con la informacion real del negocio.`,
  },
  {
    fileName: 'productos.md',
    content: `[PRODUCTOS]
Agrega aqui el catalogo de productos del cliente.`,
  },
  {
    fileName: 'cursos.md',
    content: `[CURSOS]
Agrega aqui la informacion de cursos o capacitaciones del cliente.`,
  },
  {
    fileName: 'faqs.md',
    content: `[FAQS]
Agrega aqui preguntas frecuentes y sus respuestas.`,
  },
]

function getSupabaseConfig() {
  const url = process.env.SUPABASE_URL?.trim()
  const serviceRoleKey = process.env.SUPABASE_SECRET_KEY?.trim()
  const anonKey =
    process.env.SUPABASE_PUBLISHABLE_KEY?.trim() || process.env.VITE_SUPABASE_ANON_KEY?.trim()

  if (!url || !serviceRoleKey || !anonKey) {
    throw new Error('Falta la configuracion manual de Supabase en el servidor')
  }

  return {
    url,
    serviceRoleKey,
    anonKey,
  }
}

function slugify(value: string) {
  const asciiValue = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()

  const slug = asciiValue
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return slug || 'documento'
}

function normalizeDocumentFileName(fileName: string) {
  const rawStem = fileName.replace(/\.md$/i, '').trim()
  return `${slugify(rawStem)}.md`
}

function humanizeFileName(fileName: string) {
  const stem = fileName.replace(/\.md$/i, '')

  return stem
    .split(/[-_]+/)
    .filter(Boolean)
    .map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1))
    .join(' ')
}

function mapPromptValue(configValue: PromptConfigRow['config_value']) {
  if (typeof configValue === 'string' && configValue.trim()) {
    return configValue.trim()
  }

  if (configValue && typeof configValue === 'object' && typeof configValue.prompt === 'string') {
    return configValue.prompt.trim() || DEFAULT_PROMPT
  }

  return DEFAULT_PROMPT
}

function mapDocument(row: DocumentRow): DbWorkspaceDocument {
  const fileName = normalizeDocumentFileName(row.title || 'documento')

  return {
    id: row.id,
    fileName,
    label: humanizeFileName(fileName),
    content: row.content_markdown || '',
    updatedAt: row.updated_at,
  }
}

function resolveDocumentSection(row: DocumentRow): DbAgentDocument['section'] {
  const normalizedType = row.doc_type.trim().toLowerCase()
  const normalizedTitle = row.title.trim().toLowerCase()

  if (normalizedType === 'cursos' || normalizedTitle === 'cursos.md') {
    return 'cursos'
  }

  if (normalizedType === 'productos' || normalizedTitle === 'productos.md') {
    return 'productos'
  }

  return 'general'
}

function mapAgentDocument(row: DocumentRow): DbAgentDocument {
  return {
    id: row.id,
    title: row.title || 'documento.md',
    docType: row.doc_type || 'markdown',
    section: resolveDocumentSection(row),
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
  const { url, serviceRoleKey } = getSupabaseConfig()
  const requestUrl = new URL(`/rest/v1/${path}`, url)

  for (const [key, value] of Object.entries(options?.query || {})) {
    requestUrl.searchParams.set(key, value)
  }

  const response = await fetch(requestUrl, {
    method: options?.method || 'GET',
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
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
      payload?.msg ||
      payload?.message ||
      payload?.error_description ||
      payload?.hint ||
      'Error consultando Supabase'

    throw new Error(message)
  }

  return payload as T
}

async function authRequest<T>(
  path: string,
  options?: {
    method?: 'GET' | 'POST'
    body?: unknown
    bearerToken?: string
    useServiceRole?: boolean
  },
) {
  const { url, anonKey, serviceRoleKey } = getSupabaseConfig()
  const response = await fetch(new URL(`/auth/v1/${path}`, url), {
    method: options?.method || 'GET',
    headers: {
      apikey: options?.useServiceRole ? serviceRoleKey : anonKey,
      Authorization: `Bearer ${options?.bearerToken || (options?.useServiceRole ? serviceRoleKey : anonKey)}`,
      'Content-Type': 'application/json',
    },
    body: options?.body ? JSON.stringify(options.body) : undefined,
    signal: AbortSignal.timeout(45000),
  })

  const text = await response.text()
  const payload = text ? JSON.parse(text) : null

  if (!response.ok) {
    const message =
      payload?.msg ||
      payload?.message ||
      payload?.error_description ||
      payload?.error ||
      'Error consultando Auth en Supabase'

    throw new Error(message)
  }

  return payload as T
}

async function listTenantsByPrefix(prefix: string) {
  return restRequest<TenantRow[]>('tenants', {
    query: {
      select: 'id,name,slug,created_by,created_at,updated_at',
      slug: `like.${prefix}%`,
      order: 'slug.asc',
    },
  })
}

async function getTenantByUserId(userId: string) {
  const rows = await restRequest<TenantRow[]>('tenants', {
    query: {
      select: 'id,name,slug,created_by,created_at,updated_at',
      created_by: `eq.${userId}`,
      order: 'created_at.desc',
      limit: '1',
    },
  })

  return rows[0] || null
}

async function getPromptRow(tenantId: string) {
  const rows = await restRequest<PromptConfigRow[]>('crm_configs', {
    query: {
      select: 'id,tenant_id,config_key,config_value,created_at,updated_at',
      tenant_id: `eq.${tenantId}`,
      config_key: 'eq.agent_prompt',
      limit: '1',
    },
  })

  return rows[0] || null
}

async function getDocuments(tenantId: string) {
  const rows = await restRequest<DocumentRow[]>('documents', {
    query: {
      select: 'id,tenant_id,title,doc_type,content_markdown,is_active,created_at,updated_at',
      tenant_id: `eq.${tenantId}`,
      order: 'updated_at.desc',
    },
  })

  return rows.map(mapDocument)
}

function createClientCodePrefix(date: Date) {
  const day = `${date.getDate()}`.padStart(2, '0')
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const year = `${date.getFullYear()}`.slice(-2)

  return `${day}${month}${year}`
}

async function generateNextClientCode() {
  const prefix = createClientCodePrefix(new Date())
  const tenants = await listTenantsByPrefix(prefix)
  let maxSequence = 0

  for (const tenant of tenants) {
    const match = tenant.slug?.match(new RegExp(`^${prefix}(\\d+)$`))

    if (!match?.[1]) {
      continue
    }

    const sequence = Number.parseInt(match[1], 10)

    if (Number.isFinite(sequence)) {
      maxSequence = Math.max(maxSequence, sequence)
    }
  }

  return `${prefix}${maxSequence + 1}`
}

async function createTenantForUser(input: { userId: string; email: string }) {
  const clientCode = await generateNextClientCode()
  const timestamp = new Date().toISOString()
  const rows = await restRequest<TenantRow[]>('tenants', {
    method: 'POST',
    body: {
      name: `Cliente ${clientCode}`,
      slug: clientCode,
      created_by: input.userId,
      created_at: timestamp,
      updated_at: timestamp,
    },
    headers: {
      Prefer: 'return=representation',
    },
  })

  const tenant = rows[0]

  if (!tenant?.id) {
    throw new Error('No se pudo crear el tenant del cliente')
  }

  await seedTenantWorkspace(tenant.id, input.email)
  return tenant
}

async function seedTenantWorkspace(tenantId: string, email: string) {
  const timestamp = new Date().toISOString()

  await restRequest('crm_configs', {
    method: 'POST',
    body: {
      tenant_id: tenantId,
      config_key: 'agent_prompt',
      config_value: { prompt: DEFAULT_PROMPT },
      created_at: timestamp,
      updated_at: timestamp,
    },
    headers: {
      Prefer: 'return=minimal',
    },
  })

  await restRequest('documents', {
    method: 'POST',
    body: DEFAULT_DOCUMENTS.map((document) => ({
      tenant_id: tenantId,
      title: document.fileName,
      doc_type: 'markdown',
      content_markdown: document.content.replace('{{EMAIL}}', email),
      is_active: true,
      created_at: timestamp,
      updated_at: timestamp,
    })),
    headers: {
      Prefer: 'return=minimal',
    },
  })
}

async function createAuthUser(input: { email: string; password: string }) {
  return authRequest<{
    id: string
    email: string
  }>('admin/users', {
    method: 'POST',
    useServiceRole: true,
    body: {
      email: input.email,
      password: input.password,
      email_confirm: true,
    },
  })
}

async function loginAuthUser(input: { email: string; password: string }) {
  return authRequest<{
    access_token: string
    refresh_token: string
    expires_in: number
    user: { id: string; email?: string }
  }>('token?grant_type=password', {
    method: 'POST',
    body: {
      email: input.email,
      password: input.password,
    },
  })
}

async function getAuthUser(accessToken: string) {
  return authRequest<AuthUserResponse>('user', {
    method: 'GET',
    bearerToken: accessToken,
  })
}

export async function registerDbAccount(input: { email: string; password: string }) {
  const email = input.email.trim().toLowerCase()
  const password = input.password.trim()

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Ingresa un correo valido')
  }

  if (password.length < 8) {
    throw new Error('La contrasena debe tener al menos 8 caracteres')
  }

  const authUser = await createAuthUser({
    email,
    password,
  })

  await createTenantForUser({
    userId: authUser.id,
    email,
  })

  return loginDbAccount({
    email,
    password,
  })
}

export async function loginDbAccount(input: { email: string; password: string }) {
  const email = input.email.trim().toLowerCase()
  const password = input.password.trim()

  // Ruta 1: intentar login en sistema principal (Supabase). Sólo si falla por credenciales inválidas, intentar subusuarios POS.
  let supabaseError: any = null
  try {
    const session = await loginAuthUser({ email, password })
    const tenant = await getTenantByUserId(session.user.id)
    if (!tenant) {
      throw new Error('No encontramos un workspace asociado a este usuario')
    }
    return {
      token: session.access_token,
      refreshToken: session.refresh_token,
      user: {
        id: session.user.id,
        email: session.user.email || email,
        clientId: tenant.slug,
        tenantId: tenant.id,
        posRole: 'owner',
        authKind: 'tenant_owner',
        displayName: session.user.email?.split('@')[0] || email.split('@')[0],
      } satisfies DbAuthUser,
    }
  } catch (e: any) {
    supabaseError = e
    const msg = (e?.message || '').toLowerCase()
    const isCredsError = /invalid|credentials|email|password|user|not found|unauthorized|signup|login|auth/.test(msg)
    if (!isCredsError) throw e
  }

  // Ruta 2: Subusuario POS (admin/caja) de CUALQUIER tenant
  try {
    const subRes = await loginSubuser(email, password)
    if (subRes) return subRes as any
  } catch {}

  // Lanzar error original si nada funcionó
  throw supabaseError || new Error('Credenciales inválidas')
}

export async function getDbUserFromToken(accessToken: string) {
  if (!accessToken.trim()) {
    return null
  }

  // Ruta A: JWT LOCAL (subusuario POS). Checamos primero porque no necesita red externa.
  const local = verifyLocalJwt(accessToken)
  if (local && local.authKind === 'pos_subuser' && local.tenantId && local.email) {
    return {
      id: local.subuserId || local.id,
      email: local.email,
      clientId: `tenant-${String(local.tenantId || '').replace(/[^A-Za-z0-9_\-]/g, '_')}`,
      tenantId: String(local.tenantId),
      posRole: local.posRole as 'owner' | 'admin' | 'admin_pv' | 'admin_cs' | 'cashier' | 'cs_agent' | undefined,
      posBranchId: typeof local.posBranchId === 'string' ? local.posBranchId : undefined,
      subuserId: local.subuserId,
      displayName: local.displayName,
      authKind: 'pos_subuser',
    } satisfies DbAuthUser
  }

  // Ruta B: Supabase token (propietario del tenant)
  let authUser: AuthUserResponse
  try {
    authUser = await getAuthUser(accessToken)
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (/jwt|token|expired|auth|signature|malformed|invalid/i.test(message)) {
      return null
    }
    throw error
  }

  const tenant = await getTenantByUserId(authUser.id)
  if (!tenant) {
    return null
  }

  return {
    id: authUser.id,
    email: authUser.email || '',
    clientId: tenant.slug,
    tenantId: tenant.id,
    posRole: 'owner',
    authKind: 'tenant_owner',
    displayName: authUser.email?.split('@')[0],
  } satisfies DbAuthUser
}

export async function loadDbWorkspace(tenantId: string) {
  const [promptRow, documents] = await Promise.all([getPromptRow(tenantId), getDocuments(tenantId)])

  return {
    prompt: mapPromptValue(promptRow?.config_value ?? null),
    documents,
  }
}

export async function loadDbAgentDocuments(tenantId: string) {
  const rows = await restRequest<DocumentRow[]>('documents', {
    query: {
      select: 'id,tenant_id,title,doc_type,content_markdown,is_active,created_at,updated_at',
      tenant_id: `eq.${tenantId}`,
      is_active: 'eq.true',
      order: 'updated_at.desc',
    },
  })

  return rows.map(mapAgentDocument)
}

export async function listDbTenantIds() {
  const pageSize = 500
  const tenantIds: string[] = []

  for (let offset = 0; ; offset += pageSize) {
    const rows = await restRequest<Array<{ id: string }>>('tenants', {
      query: {
        select: 'id',
        order: 'id.asc',
        limit: String(pageSize),
        offset: String(offset),
      },
    })

    tenantIds.push(...rows.map((row) => row.id))
    if (rows.length < pageSize) {
      return tenantIds
    }
  }
}

function buildDbTenantSearchIndex(tenantId: string, documents: DbAgentDocument[]) {
  const index = createSearchIndex({ tenantId, documents })
  tenantSearchIndexCache.set(tenantId, { signature: index.signature, index })
  return index
}

export async function ingestDbTenantDocuments(tenantId: string): Promise<DbIngestionStatus> {
  try {
    const documents = await loadDbAgentDocuments(tenantId)
    const index = buildDbTenantSearchIndex(tenantId, documents)

    return {
      ok: true,
      indexedAt: new Date().toISOString(),
      ...index.stats,
    }
  } catch (error) {
    tenantSearchIndexCache.delete(tenantId)
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

export async function getDbTenantSearchIndex(tenantId: string) {
  const documents = await loadDbAgentDocuments(tenantId)
  const signature = getSearchIndexSignature(documents)
  const cachedIndex = tenantSearchIndexCache.get(tenantId)

  if (cachedIndex?.signature === signature) {
    return cachedIndex.index
  }

  const nextIndex = createSearchIndex({ tenantId, documents })
  tenantSearchIndexCache.set(tenantId, {
    signature,
    index: nextIndex,
  })
  return nextIndex
}

export async function ingestAllDbTenants() {
  const tenantIds = await listDbTenantIds()
  const failures: Array<{ tenantId: string; error: string }> = []
  let successCount = 0

  const batchSize = 5
  for (let offset = 0; offset < tenantIds.length; offset += batchSize) {
    const batch = tenantIds.slice(offset, offset + batchSize)
    const results = await Promise.all(
      batch.map(async (tenantId) => ({
        tenantId,
        result: await ingestDbTenantDocuments(tenantId),
      })),
    )

    for (const { tenantId, result } of results) {
      if (result.ok) {
        successCount += 1
      } else {
        failures.push({ tenantId, error: result.error || 'No se pudo actualizar el índice' })
      }
    }
  }

  return {
    tenantCount: tenantIds.length,
    successCount,
    failures,
  }
}

export async function saveDbPrompt(tenantId: string, prompt: string) {
  const nextPrompt = prompt.trim()

  if (!nextPrompt) {
    throw new Error('El prompt no puede estar vacio')
  }

  const existingPrompt = await getPromptRow(tenantId)
  const timestamp = new Date().toISOString()

  if (existingPrompt?.id) {
    await restRequest('crm_configs', {
      method: 'PATCH',
      query: {
        id: `eq.${existingPrompt.id}`,
      },
      body: {
        config_value: { prompt: nextPrompt },
        updated_at: timestamp,
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
        config_value: { prompt: nextPrompt },
        created_at: timestamp,
        updated_at: timestamp,
      },
      headers: {
        Prefer: 'return=minimal',
      },
    })
  }

  return nextPrompt
}

async function ensureDocumentTitleAvailable(tenantId: string, normalizedTitle: string, excludeId?: string) {
  const rows = await restRequest<Array<{ id: string }>>('documents', {
    query: {
      select: 'id',
      tenant_id: `eq.${tenantId}`,
      title: `eq.${normalizedTitle}`,
    },
  })

  return rows.every((row) => row.id === excludeId)
}

export async function createDbDocument(
  tenantId: string,
  input: { fileName?: string; content: string },
) {
  const fileName = normalizeDocumentFileName(input.fileName?.trim() || 'documento')
  const content = input.content.trim()

  if (!content) {
    throw new Error('El contenido del documento no puede estar vacio')
  }

  const available = await ensureDocumentTitleAvailable(tenantId, fileName)

  if (!available) {
    throw new Error('Ya existe un documento con ese nombre')
  }

  const rows = await restRequest<DocumentRow[]>('documents', {
    method: 'POST',
    body: {
      tenant_id: tenantId,
      title: fileName,
      doc_type: 'markdown',
      content_markdown: content,
      is_active: true,
      updated_at: new Date().toISOString(),
    },
    headers: {
      Prefer: 'return=representation',
    },
  })

  return mapDocument(rows[0])
}

export async function upsertDbDocument(
  tenantId: string,
  input: { fileName: string; content: string },
) {
  const fileName = normalizeDocumentFileName(input.fileName)
  const existingRows = await restRequest<DocumentRow[]>('documents', {
    query: {
      select: 'id,tenant_id,title,doc_type,content_markdown,is_active,created_at,updated_at',
      tenant_id: `eq.${tenantId}`,
      title: `eq.${fileName}`,
      limit: '1',
    },
  })

  if (existingRows[0]?.id) {
    return updateDbDocument(tenantId, fileName, { fileName, content: input.content })
  }

  return createDbDocument(tenantId, { fileName, content: input.content })
}

export async function updateDbDocument(
  tenantId: string,
  currentFileName: string,
  input: { fileName: string; content: string },
) {
  const currentTitle = normalizeDocumentFileName(currentFileName)
  const nextTitle = normalizeDocumentFileName(input.fileName)
  const nextContent = input.content.trim()

  if (!nextContent) {
    throw new Error('El contenido del documento no puede estar vacio')
  }

  const existingRows = await restRequest<DocumentRow[]>('documents', {
    query: {
      select: 'id,tenant_id,title,doc_type,content_markdown,is_active,created_at,updated_at',
      tenant_id: `eq.${tenantId}`,
      title: `eq.${currentTitle}`,
      limit: '1',
    },
  })

  const existingDocument = existingRows[0]

  if (!existingDocument?.id) {
    throw new Error('Documento no encontrado')
  }

  if (currentTitle !== nextTitle) {
    const available = await ensureDocumentTitleAvailable(tenantId, nextTitle, existingDocument.id)

    if (!available) {
      throw new Error('Ya existe un documento con ese nombre')
    }
  }

  const updatedRows = await restRequest<DocumentRow[]>('documents', {
    method: 'PATCH',
    query: {
      id: `eq.${existingDocument.id}`,
      tenant_id: `eq.${tenantId}`,
    },
    body: {
      title: nextTitle,
      content_markdown: nextContent,
      updated_at: new Date().toISOString(),
    },
    headers: {
      Prefer: 'return=representation',
    },
  })

  return mapDocument(updatedRows[0])
}

export async function deleteDbDocument(tenantId: string, fileName: string) {
  const title = normalizeDocumentFileName(fileName)

  await restRequest('documents', {
    method: 'DELETE',
    query: {
      tenant_id: `eq.${tenantId}`,
      title: `eq.${title}`,
    },
    headers: {
      Prefer: 'return=minimal',
    },
  })
}
