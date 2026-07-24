import { loadLlmRuntimeConfig } from './runtimeConfig.js'

const DEFAULT_PROMPT = `Eres el agente de Salubel Institute. Responde solo con informacion respaldada por los documentos cargados en la base de datos.

Reglas:
- No inventes precios, fechas, promociones, cursos, productos o procesos.
- Si la informacion no existe en los documentos, dilo con claridad.
- Mantente enfocado en informacion de Salubel Institute.
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
const MAX_CONTEXT_BLOCKS = 4
const MAX_CONTEXT_CHARS = 2600
const MAX_BLOCK_CHARS = 900
const MAX_SUMMARY_ITEMS = 12
const QUERY_STOP_WORDS = new Set([
  'de',
  'del',
  'la',
  'las',
  'el',
  'los',
  'y',
  'o',
  'un',
  'una',
  'unos',
  'unas',
  'para',
  'por',
  'con',
  'sin',
  'sobre',
  'que',
  'cual',
  'cuales',
  'como',
  'mas',
  'informacion',
  'info',
  'detalle',
  'detalles',
  'quiero',
  'necesito',
  'tienen',
  'algun',
  'alguna',
  'hay',
  'delos',
  'las',
])

function normalizeText(value: string) {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function extractQueryWords(query: string) {
  return normalizeText(query)
    .split(' ')
    .map((word) => word.trim())
    .filter((word) => word.length >= 2 && !QUERY_STOP_WORDS.has(word))
}

function analyzeQuery(query: string) {
  const normalizedQuery = normalizeText(query)

  return {
    wantsCourses: /\bcurso\b|\bcursos\b|\bdiplomado\b|\bdiplomados\b|\bcapacitacion\b|\bcapacitaciones\b/.test(
      normalizedQuery,
    ),
    wantsProducts: /\bproducto\b|\bproductos\b|\bserum\b|\bkit\b|\bampolla\b|\bampolletas\b/.test(
      normalizedQuery,
    ),
    wantsServices: /\bservicio\b|\bservicios\b|\btaller\b|\btalleres\b|\btratamiento\b|\btratamientos\b|\bprocedimiento\b|\bprocedimientos\b/.test(
      normalizedQuery,
    ),
    wantsLocation: /\bubicacion\b|\bdireccion\b|\bdonde\b|\bsede\b|\bsucursal\b|\bclinica\b|\bcontacto\b|\btelefono\b|\bhorario\b|\bhorarios\b/.test(
      normalizedQuery,
    ),
    wantsList: /\bdisponibles\b|\btienen\b|\bhay\b|\bofrecen\b|\bopciones\b|\bmenu\b|\bcatalogo\b|\blista\b|\bprogramados\b/.test(
      normalizedQuery,
    ),
    wantsDetails: /\bmas\b|\binformacion\b|\bficha\b|\bdetalle\b|\bdetalles\b/.test(
      normalizedQuery,
    ),
    mentionsPresential: /\bpresencial\b/.test(normalizedQuery),
    mentionsOnline: /\bonline\b|\ben linea\b/.test(normalizedQuery),
  }
}

function splitFallbackTextIntoBlocks(content: string) {
  const chunks = content
    .split(/\n{2,}/)
    .map((chunk) => chunk.trim())
    .filter(Boolean)

  if (chunks.length <= 1) {
    return [content.trim()]
  }

  const blocks: string[] = []
  let currentBlock = ''

  for (const chunk of chunks) {
    const nextBlock = currentBlock ? `${currentBlock}\n\n${chunk}` : chunk

    if (nextBlock.length > MAX_BLOCK_CHARS && currentBlock) {
      blocks.push(currentBlock.trim())
      currentBlock = chunk
      continue
    }

    currentBlock = nextBlock
  }

  if (currentBlock.trim()) {
    blocks.push(currentBlock.trim())
  }

  return blocks
}

function isStructuredHeading(line: string) {
  const trimmedLine = line.trim()

  return (
    Boolean(trimmedLine) &&
    trimmedLine.startsWith('[') &&
    trimmedLine.endsWith(']') &&
    trimmedLine.length <= 120
  )
}

function isNamedField(line: string) {
  return /^(?:Nombre del [^:]+|Nombre|Curso|Producto|Servicio|Taller|Tratamiento|Paquete)\s*:/i.test(
    line.trim(),
  )
}

function splitDocumentIntoBlocks(document: WorkspaceDocument) {
  const content = document.content.trim()

  if (!content) {
    return []
  }

  const lines = content.split('\n')
  const blocks: string[] = []
  let currentLines: string[] = []

  for (const line of lines) {
    const startsNewBlock =
      currentLines.length > 0 && (isStructuredHeading(line) || isNamedField(line))

    if (startsNewBlock) {
      const currentBlock = currentLines.join('\n').trim()
      if (currentBlock) {
        blocks.push(currentBlock)
      }
      currentLines = [line]
      continue
    }

    currentLines.push(line)
  }

  const lastBlock = currentLines.join('\n').trim()
  if (lastBlock) {
    blocks.push(lastBlock)
  }

  if (blocks.length <= 1) {
    return splitFallbackTextIntoBlocks(content)
  }

  return blocks.filter(Boolean)
}

function extractFieldValue(block: string, labels: string[]) {
  for (const label of labels) {
    const match = block.match(new RegExp(`(?:^|\\n)${label}\\s*:\\s*(.+)`, 'i'))
    if (match?.[1]) {
      return match[1].trim()
    }
  }

  return ''
}

function extractBlockTitle(block: string) {
  const headingWithValue = block.match(/^\[([^\]:]+)\s*:\s*([^\]]+)\]/m)
  if (headingWithValue?.[2]) {
    return headingWithValue[2].trim()
  }

  const namedField = extractFieldValue(block, [
    'Nombre del curso',
    'Nombre del producto',
    'Nombre del servicio',
    'Nombre del taller',
    'Nombre del tratamiento',
    'Nombre del paquete',
    'Nombre',
    'Curso',
    'Producto',
    'Servicio',
    'Taller',
    'Tratamiento',
    'Paquete',
  ])

  if (namedField) {
    return namedField
  }

  const firstLine = block
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean)

  if (!firstLine) {
    return ''
  }

  if (isStructuredHeading(firstLine)) {
    return firstLine.replace(/^\[/, '').replace(/\]$/, '').trim()
  }

  return firstLine
}

function sharedPrefixLength(left: string, right: string) {
  const limit = Math.min(left.length, right.length)
  let count = 0

  while (count < limit && left[count] === right[count]) {
    count += 1
  }

  return count
}

function isCatalogLikeBlock(block: string) {
  return (
    /(?:^|\n)(?:Nombre del [^:]+|Nombre|Curso|Producto|Servicio|Taller|Tratamiento|Paquete)\s*:/i.test(
      block,
    ) ||
    /^\[(?:CURSO|PRODUCTO|SERVICIO|TALLER|TRATAMIENTO|PAQUETE)\]$/im.test(block) ||
    /^\[[^\]:]{2,40}\s*:\s*[^\]]+\]$/im.test(block)
  )
}

type RankedBlockCandidate = {
  document: WorkspaceDocument
  block: string
  title: string
  score: number
}

function buildCatalogSummaryLine(candidate: RankedBlockCandidate) {
  const title = candidate.title.trim()

  if (!title) {
    return ''
  }

  const normalizedTitle = normalizeText(title)
  if (
    ['ubicacion', 'direccion', 'horarios', 'telefono oficial', 'mision', 'vision'].includes(
      normalizedTitle,
    )
  ) {
    return ''
  }

  const modality = extractFieldValue(candidate.block, ['Modalidades?', 'Modalidad'])
  const price = extractFieldValue(candidate.block, ['Precio', 'Costo', 'Tarifa'])
  const category = extractFieldValue(candidate.block, ['Categoria', 'Categoría', 'Familia'])
  const details = [modality && `Modalidades: ${modality}`, category && `Categoria: ${category}`, price && `Precio: ${price}`].filter(Boolean)

  return `- ${title}${details.length > 0 ? ` | ${details.join(' | ')}` : ''}`
}

function buildStructuredCatalogSummary(candidates: RankedBlockCandidate[], maxChars: number) {
  const lines: string[] = []
  const seenTitles = new Set<string>()
  let remainingChars = maxChars

  for (const candidate of candidates) {
    if (!isCatalogLikeBlock(candidate.block)) {
      continue
    }

    const normalizedTitle = normalizeText(candidate.title)
    if (!normalizedTitle || seenTitles.has(normalizedTitle)) {
      continue
    }

    const line = buildCatalogSummaryLine(candidate)
    if (!line) {
      continue
    }

    if (line.length + 1 > remainingChars) {
      break
    }

    lines.push(line)
    seenTitles.add(normalizedTitle)
    remainingChars -= line.length + 1

    if (lines.length >= MAX_SUMMARY_ITEMS) {
      break
    }
  }

  if (lines.length === 0) {
    return ''
  }

  return `Catalogo resumido encontrado en los documentos:\n${lines.join('\n')}`
}

function scoreBlockForQuery(block: string, query: string, document: WorkspaceDocument) {
  const queryIntent = analyzeQuery(query)
  const normalizedBlock = normalizeText(block)
  const queryWords = extractQueryWords(query)
  const blockTitle = extractBlockTitle(block)
  const normalizedTitle = normalizeText(blockTitle)
  const blockTokens = extractQueryWords(`${blockTitle} ${block}`)
  const titleTokens = extractQueryWords(blockTitle)
  let score = 0

  if (!query.trim()) {
    return document.section === 'general' ? 2 : 1
  }

  if (document.section === 'general') {
    score += 1
  }

  if (queryIntent.wantsCourses && document.section === 'cursos') {
    score += 10
  }

  if (queryIntent.wantsProducts && document.section === 'productos') {
    score += 10
  }

  if (queryIntent.wantsServices && document.section === 'general') {
    score += 6
  }

  if (queryIntent.wantsLocation && document.section === 'general') {
    score += 14
  }

  if (
    queryIntent.wantsLocation &&
    /\bubicacion\b|\bdireccion\b|\bmaps\b|\btelefono\b|\bcontacto\b|\bhorario\b|\bsede\b|\bsucursal\b/.test(
      normalizedBlock,
    )
  ) {
    score += 16
  }

  if (queryIntent.wantsDetails && isCatalogLikeBlock(block)) {
    score += 6
  }

  if (queryIntent.wantsList && isCatalogLikeBlock(block)) {
    score += 4
  }

  if (queryIntent.mentionsPresential && normalizedBlock.includes('presencial')) {
    score += 5
  }

  if (queryIntent.mentionsOnline && (normalizedBlock.includes('online') || normalizedBlock.includes('en linea'))) {
    score += 5
  }

  let exactMatches = 0
  let partialMatches = 0

  for (const word of queryWords) {
    if (titleTokens.includes(word) || normalizedTitle.includes(word)) {
      score += 8
      exactMatches += 1
      continue
    }

    if (blockTokens.includes(word) || normalizedBlock.includes(word)) {
      score += 4
      exactMatches += 1
      continue
    }

    const hasPartialTitleMatch = titleTokens.some((token) => sharedPrefixLength(token, word) >= 4)
    if (hasPartialTitleMatch) {
      score += 4
      partialMatches += 1
      continue
    }

    const hasPartialBlockMatch = blockTokens.some((token) => sharedPrefixLength(token, word) >= 4)
    if (hasPartialBlockMatch) {
      score += 2
      partialMatches += 1
    }
  }

  if (queryWords.length > 0 && exactMatches === queryWords.length) {
    score += 18
  } else if (exactMatches + partialMatches >= Math.max(2, Math.ceil(queryWords.length * 0.6))) {
    score += 10
  }

  if (normalizedBlock.includes('nombre del ')) {
    score += 2
  }

  return score
}

function scoreDocumentForQuery(document: WorkspaceDocument, query: string) {
  return splitDocumentIntoBlocks(document).reduce((bestScore, block) => {
    return Math.max(bestScore, scoreBlockForQuery(block, query, document))
  }, 0)
}

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
  const rows = await restRequest<DocumentRow[]>('documents', {
    query: {
      select: 'id,tenant_id,title,doc_type,content_markdown,is_active,updated_at',
      tenant_id: `eq.${tenantId}`,
      order: 'updated_at.desc',
    },
  })

  return rows.map(mapDocument)
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

  return mapDocument(rows[0])
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

  return mapDocument(rows[0])
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
  const documents = await listDocuments()
  const activeDocuments = documents.filter((document) => document.isActive)

  const rankedBlocks = activeDocuments
    .flatMap((document) =>
      splitDocumentIntoBlocks(document).map((block) => ({
        document,
        block,
        title: extractBlockTitle(block),
        score: scoreBlockForQuery(block, query, document),
      })),
    )
    .sort((left, right) => {
      const scoreDiff = right.score - left.score
      if (scoreDiff !== 0) {
        return scoreDiff
      }

      const documentScoreDiff =
        scoreDocumentForQuery(right.document, query) - scoreDocumentForQuery(left.document, query)

      if (documentScoreDiff !== 0) {
        return documentScoreDiff
      }

      return new Date(right.document.updatedAt).getTime() - new Date(left.document.updatedAt).getTime()
    })

  const queryIntent = analyzeQuery(query)
  if (queryIntent.wantsList) {
    const summary = buildStructuredCatalogSummary(rankedBlocks, MAX_CONTEXT_CHARS)

    if (summary) {
      const includedDocuments = Array.from(
        new Map(rankedBlocks.map((candidate) => [candidate.document.id, candidate.document])).values(),
      )

      return {
        documents: includedDocuments,
        contextBlock: summary,
      }
    }
  }

  let remainingChars = MAX_CONTEXT_CHARS
  const includedDocuments = new Map<string, WorkspaceDocument>()
  const selectedBlocks: string[] = []

  for (const candidate of rankedBlocks) {
    if (remainingChars <= 0 || selectedBlocks.length >= MAX_CONTEXT_BLOCKS) {
      break
    }

    const label = candidate.document.section.toUpperCase()
    const header = candidate.title
      ? `[SECCION: ${label} | DOCUMENTO: ${candidate.document.title} | BLOQUE: ${candidate.title}]`
      : `[SECCION: ${label} | DOCUMENTO: ${candidate.document.title}]`
    const reservedChars = header.length + 2
    const availableChars = Math.max(0, Math.min(MAX_BLOCK_CHARS, remainingChars - reservedChars))

    if (availableChars <= 0) {
      continue
    }

    const normalizedContent = candidate.block.trim()
    if (!normalizedContent) {
      continue
    }

    const content =
      normalizedContent.length > availableChars
        ? `${normalizedContent.slice(0, Math.max(availableChars - 1, 0)).trim()}...`
        : normalizedContent

    selectedBlocks.push(`${header}\n${content}`)
    remainingChars -= header.length + content.length + 2
    includedDocuments.set(candidate.document.id, candidate.document)
  }

  const contextBlock = selectedBlocks.length > 0 ? selectedBlocks.join('\n\n') : '(Sin documentos activos)'

  return {
    documents: Array.from(includedDocuments.values()),
    contextBlock,
  }
}
