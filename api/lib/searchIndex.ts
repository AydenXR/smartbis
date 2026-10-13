import type { DocumentSection, WorkspaceDocument } from './workspace.js'

import { createHash } from 'node:crypto'

const MAX_CONTEXT_BLOCKS = 4
const MAX_CONTEXT_CHARS = 3200
const MAX_BLOCK_CHARS = 1300
const MAX_SUMMARY_ITEMS = 12
const NOISE_BLOCK_TITLE_MIN_SCORE = -99999
const NOISE_TITLE_PATTERNS: readonly RegExp[] = [
  /^\s*aqu[ií]\s+tienes\s+la\s+lista\s+de\s+los\s+primeros\s+\d+\s+productos/i,
  /^\s*aqu[ií]\s+tienes\s+la\s+lista\s+de\s+los\s+primeros\s+\d+/i,
  /^\s*lista\s+de\s+los\s+primeros\s+\d+\s+(productos|cursos|servicios)/i,
  /^\s*producto\s*_?\s*soluciones\s*_?\s*stayve\s*$/i,
  /^\s*producto\s*soluciones\s*stayve\s*$/i,
  /^\s*temario\s*$/i,
]
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
  'si', 'no', 'ok', 'okay', 'vale', 'perfecto', 'genial', 'bien', 'claro',
  'gracias', 'dale', 'listo',
  'producto', 'productos', 'curso', 'cursos', 'precio', 'precios',
  'cuanto', 'cuantos', 'cuanta', 'cuantas', 'kit', 'kits',
  'informacion', 'info', 'detalle', 'detalles',
])

const QUERY_ENTITY_STOP_WORDS = new Set([
  ...QUERY_STOP_WORDS,
  'quiero', 'necesito', 'busco', 'saber', 'dame', 'dime', 'favor',
  'tiene', 'tienen', 'hay', 'venden', 'vendemos', 'ofrecen', 'ofrecemos',
  'disponible', 'disponibles', 'existencia', 'existencias', 'stock',
  'online', 'contexto', 'respuesta', 'corta', 'mencionados', 'mencionadas',
  'asesor', 'asesora', 'mensajes', 'anteriores',
  // Saludos y relleno conversacional: no nombran un producto, curso ni servicio
  'hola', 'buenas', 'buenos', 'tardes', 'dias', 'noches', 'saludos', 'oye', 'disculpa', 'disculpe',
  'gustaria', 'quisiera', 'queria', 'podria', 'podrias', 'porfavor', 'pregunta', 'preguntar', 'informes',
  'esta', 'estan', 'cuando', 'donde',
  // Palabras de intencion sobre tratamientos: no nombran un tratamiento concreto
  'tratamiento', 'tratamientos', 'sesion', 'sesiones', 'ustedes', 'aplican', 'aplica', 'aplicas',
  'aplicar', 'ofrecen', 'realizan', 'hacen', 'servicio', 'servicios', 'cursos', 'agendar', 'cita', 'citas',
])

function queryEntityWords(query: string) {
  return normalizeText(query)
    .split(' ')
    .filter((word) => word.length >= 4 && !QUERY_ENTITY_STOP_WORDS.has(word))
}

function blockMatchesEntityWord(block: IndexedBlock, word: string) {
  const normalizedWord = normalizeText(word)
  const compactWord = normalizedWord.replace(/\s+/g, '')
  const compactTitle = block.normalizedTitle.replace(/\s+/g, '')
  const compactBody = block.normalizedBody.replace(/\s+/g, '')
  return Boolean(
    block.titleTokens.includes(normalizedWord) ||
    block.normalizedTitle.includes(normalizedWord) ||
    block.bodyTokens.includes(normalizedWord) ||
    block.normalizedBody.includes(normalizedWord) ||
    compactTitle.includes(compactWord) ||
    compactBody.includes(compactWord) ||
    (block.fields.name && normalizeText(block.fields.name).includes(normalizedWord)),
  )
}

function blockNameHasWord(block: IndexedBlock, word: string) {
  return (
    block.titleTokens.includes(word) ||
    Boolean(block.fields.name && normalizeText(block.fields.name).split(' ').includes(word))
  )
}


function isTreatmentBlock(block: IndexedBlock) {
  return /tratamiento/i.test(block.document.title) && block.title.trim().length > 0
}

function isTreatmentOverviewQuery(query: string) {
  const normalized = normalizeText(query)
  return /\btratamientos?\b|\bsesion(?:es)?\b/.test(normalized) && queryEntityWords(query).length === 0
}

function buildTreatmentOverview(index: SearchIndex) {
  const treatmentBlocks = index.blocks.filter(isTreatmentBlock)
  if (treatmentBlocks.length === 0) return null

  const intro = index.blocks.find((block) => block.normalizedTitle.includes('tratamientos directos'))
  const lines = treatmentBlocks.map((block) => {
    const price = block.body.match(/PRECIO APROXIMADO:\s*(.+)/i)?.[1]?.trim() || ''
    const shortPrice = price.length > 70 ? `${price.slice(0, 69).trim()}...` : price
    return `- ${block.title.replace(/\.$/, '')}${shortPrice ? ` | ${shortPrice}` : ''}`
  })

  const parts = [
    ...(intro ? [`[SECCION: GENERAL | DOCUMENTO: ${intro.document.title} | BLOQUE: ${intro.title}]\n${intro.body}`] : []),
    `[SECCION: GENERAL | DOCUMENTO: ${treatmentBlocks[0].document.title} | BLOQUE: LISTA DE TRATAMIENTOS]\n${lines.join('\n')}`,
  ]

  return {
    contextBlock: parts.join('\n\n'),
    blocks: [...(intro ? [intro] : []), ...treatmentBlocks],
  }
}

function filterToEntityMatches(blocks: IndexedBlock[], query: string, intent: SearchIntent) {
  const entities = queryEntityWords(query)
  if (entities.length === 0) return blocks

  const coveredEntities = new Set(
    entities.filter((entity) => blocks.some((block) => blockMatchesEntityWord(block, entity))),
  )
  const matchesCovered = (block: IndexedBlock) =>
    [...coveredEntities].some((entity) => blockMatchesEntityWord(block, entity))

  if (coveredEntities.size === entities.length) return blocks.filter(matchesCovered)

  // Avoid returning accidental matches when the query names an absent item:
  // an unknown word right after a word of an indexed name ("acido tranexamico"
  // when only "Acido hialuronico" exists).
  const tokens = normalizeText(query).split(' ')
  const namesAbsentItem = tokens.some((token, i) =>
    i > 0 &&
    entities.includes(token) &&
    !coveredEntities.has(token) &&
    coveredEntities.has(tokens[i - 1]) &&
    blocks.some((block) => blockNameHasWord(block, tokens[i - 1])),
  )
  if (namesAbsentItem) return []

  // The query names an indexed item, so the unknown words are conversational
  // ("hola buenas tardes, horario de russian lips").
  const namesKnownItem = [...coveredEntities].some((entity) =>
    blocks.some((block) => blockNameHasWord(block, entity)),
  )
  if (namesKnownItem) return blocks.filter(matchesCovered)

  // Only generic words matched, so the unknown word is likely an absent item
  // ("horario del curso de microblading"). Location, schedule and date questions
  // can still be answered from general info blocks, never from other items.
  if (!intent.wantsLocation && !intent.wantsSchedule && !intent.wantsDates) return []
  return blocks.filter((block) =>
    block.document.section === 'general' &&
    (block.kind === 'location' || block.kind === 'contact' || block.kind === 'schedule'),
  )
}

function extractHintedCourseNames(query: string): { hintedNames: string[]; hasContextMarker: boolean } {
  if (!query) return { hintedNames: [], hasContextMarker: false }
  const q = String(query)
  const hasContextMarker =
    /\[CONTEXTO RESPUESTA CORTA/i.test(q) ||
    /CONTEXTO RESPUESTA CORTA/.test(q)
  const hintedNames: string[] = []
  const markerRe = /mencionados por el asesor en los mensajes anteriores:\s*([^\].\n]+)\]/i
  const m = markerRe.exec(q)
  if (m && m[1]) {
    const raw = m[1]
    for (const part of raw.split(/\s*\|\s*/)) {
      const n = part.trim()
      if (n.length >= 4) hintedNames.push(n)
    }
  }
  const normHinted = hintedNames
    .map((n) => normalizeText(n))
    .filter((s) => s && s.length >= 4)
  return { hintedNames: normHinted, hasContextMarker }
}

export type SearchIntent = ReturnType<typeof analyzeQuery>

export type IndexedBlock = {
  id: string
  document: WorkspaceDocument
  title: string
  body: string
  normalizedTitle: string
  normalizedBody: string
  titleTokens: string[]
  bodyTokens: string[]
  fields: Record<string, string>
  kind: 'catalog_item' | 'location' | 'contact' | 'schedule' | 'plain'
}

export type SearchIndex = {
  tenantId: string
  documents: WorkspaceDocument[]
  blocks: IndexedBlock[]
  signature: string
  stats: {
    documents: number
    activeDocuments: number
    blocks: number
  }
}

export type SearchContextResult = {
  documents: WorkspaceDocument[]
  contextBlock: string
  matchedBlocks: IndexedBlock[]
  intent: SearchIntent
}

export function getSearchIndexSignature(documents: WorkspaceDocument[]) {
  const signature = createHash('sha256')
  const activeDocuments = documents
    .filter((document) => document.isActive)
    .sort((left, right) => left.id.localeCompare(right.id))

  for (const document of activeDocuments) {
    signature.update(document.id)
    signature.update('\0')
    signature.update(document.title)
    signature.update('\0')
    signature.update(document.section)
    signature.update('\0')
    signature.update(document.updatedAt)
    signature.update('\0')
    signature.update(document.content)
    signature.update('\0')
  }

  return signature.digest('hex')
}

export function normalizeText(value: string) {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    // Colapsa letras repetidas (ej: ee->e, oo->o, nn->n). Tolerancia a typos
    // como "lipoeenzimas" -> "lipoenzimas", "peptpnas" -> "peptonas", "mesobotoox" -> "mesobotox".
    // Solo colapsa de 3+ repeticiones a 2 para NO romper palabras legítimas con
    // doble letra (ej: "llamada", "carro", "casa" no cambian). 3+ ("eeee") pasa a 1 letra,
    // y 2+ idénticas en vocabulario sensible (a,e,o,i,u) se reduce a 1 también.
    .replace(/([a-z])\1{2,}/g, '$1')
    .replace(/([aeiou])\1+/g, '$1')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// Levenshtein distancia N (controlado). Solo para typo-tolerant retrieval.
// Optimizado: si |len(a)-len(b)| > maxDiff -> false rápido.
export function isLevenshteinDistanceWithin(a: string, b: string, maxDiff: number): boolean {
  const al = a.length
  const bl = b.length
  if (Math.abs(al - bl) > maxDiff) return false
  if (al <= 3 || bl <= 3) return false
  let prev = Array.from({ length: bl + 1 }, (_, i) => i)
  for (let i = 1; i <= al; i += 1) {
    const curr = new Array<number>(bl + 1)
    curr[0] = i
    for (let j = 1; j <= bl; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + cost,
      )
    }
    if (curr.every((v) => v > maxDiff)) return false
    prev = curr
  }
  return prev[bl] <= maxDiff
}

export function extractQueryWords(query: string) {
  return normalizeText(query)
    .split(' ')
    .map((word) => word.trim())
    .filter((word) => word.length >= 2 && !QUERY_STOP_WORDS.has(word))
}

function analyzeQuery(query: string) {
  const normalizedQuery = normalizeText(query)
  const wantsLocation =
    /\bubicacion\b|\bdireccion\b|\bdonde\b|\bsede\b|\bsucursal\b|\bclinica\b|\bcontacto\b|\btelefono\b/.test(
      normalizedQuery,
    )
  const wantsSchedule = /\bhorario\b|\bhorarios\b/.test(normalizedQuery)
  const wantsDetails =
    /\bmas\b|\binformacion\b|\bficha\b|\bdetalle\b|\bdetalles\b/.test(normalizedQuery)
  const mentionsPluralCatalog =
    /\bproductos\b|\bcursos\b|\bservicios\b|\btalleres\b|\btratamientos\b|\bprocedimientos\b/.test(
      normalizedQuery,
    )

  const wantsDates =
    /\bfecha\b|\bfechas\b|\bproxima\b|\bproximo\b|\bcuando\b|\bdisponible\b|\bdisponibles\b|\bcalendario\b|\bdia\b|\bdias\b|\bprogramado\b|\bprogramados\b|\bagendado\b|\bagendados\b|\bturno\b|\bcupo\b|\bcupos\b/.test(
      normalizedQuery,
    )
  const wantsCourses = /\bcurso\b|\bcursos\b|\bdiplomado\b|\bdiplomados\b|\bcapacitacion\b|\bcapacitaciones\b/.test(
    normalizedQuery,
  )
  const wantsProducts = /\bproducto\b|\bproductos\b|\bserum\b|\bkit\b|\bampolla\b|\bampolletas\b|\bexistencia\b|\bexistencias\b|\binventario\b|\binventarios\b|\bstock\b|\bcomprar\b|\bcompro\b|\bcompras\b|\bvendemos\b|\bvender\b|\bcatalogo\b|\bcatalogos\b|\btienda\b|\btiendas\b|\bpedir\b|\bpedido\b|\bpedidos\b|\badquirir\b|\badquiero\b|\bdisponibilidad\b|\bdisponibles\b|\bprecio\b|\bprecios\b|\bcosto\b|\bcostos\b|\bcodigo\b|\bcodigos\b|\bfamilia\b|\bfamilias\b|\bcategoria\b|\bcategorias\b/.test(
    normalizedQuery,
  )
  const wantsServices = /\bservicio\b|\bservicios\b|\btaller\b|\btalleres\b|\btratamiento\b|\btratamientos\b|\bprocedimiento\b|\bprocedimientos\b/.test(
    normalizedQuery,
  )

  return {
    wantsCourses,
    wantsProducts,
    wantsServices,
    wantsLocation,
    wantsSchedule,
    wantsDates,
    wantsList:
      !wantsLocation &&
      !wantsSchedule &&
      !wantsProducts &&
      !wantsCourses &&
      !wantsServices &&
      !wantsDates &&
      !wantsDetails &&
      (/\bproductos\b|\bcursos\b|\bservicios\b|\btalleres\b|\btratamientos\b|\bprocedimientos\b|\bdisponibles\b|\bofrecen\b|\bopciones\b|\bmenu\b|\bcatalogo\b|\blista\b|\bprogramados\b/.test(
        normalizedQuery,
      )),
    wantsDetails,
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

function extractBlockFields(block: string) {
  return {
    name: extractFieldValue(block, [
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
    ]),
    category: extractFieldValue(block, ['Categoria', 'Categoría', 'Familia']),
    modality: extractFieldValue(block, ['Modalidades?', 'Modalidad']),
    price: extractFieldValue(block, ['Precio', 'Costo', 'Tarifa']),
    code: extractFieldValue(block, ['Codigo', 'Código', 'SKU']),
  }
}

function extractBlockTitle(block: string) {
  const headingWithValue = block.match(/^\[([^\]:]+)\s*:\s*([^\]]+)\]/m)
  if (headingWithValue?.[2]) {
    return headingWithValue[2].trim()
  }

  const fields = extractBlockFields(block)
  if (fields.name) {
    return fields.name
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

  while (count < limit && left[count] === right[count]) count += 1

  return count
}

// Levenshtein distancia-1 (typos físicos: sustitución, inserción o borrado de SOLO 1 caracter).
// Usa la implementación genérica isLevenshteinDistanceWithin con maxDiff=1.
function isLevenshteinDistanceOne(a: string, b: string): boolean {
  return isLevenshteinDistanceWithin(a, b, 1)
}

function detectBlockKind(block: string, fields: Record<string, string>, section: DocumentSection) {
  const normalizedBlock = normalizeText(block)
  const normalizedTitle = normalizeText(fields.name || extractBlockTitle(block))

  if (
    /\bubicacion\b|\bdireccion\b|\bmaps\b|\bmapa\b|\btelefono\b|\bcontacto\b/.test(
      normalizedBlock,
    ) ||
    ['ubicacion', 'direccion', 'telefono oficial'].includes(normalizedTitle)
  ) {
    return /\bhorario\b/.test(normalizedBlock) ? 'schedule' : 'location'
  }

  if (/\bhorario\b|\bhorarios\b/.test(normalizedBlock) || normalizedTitle === 'horarios') {
    return 'schedule'
  }

  if (/\btelefono\b|\bwhatsapp\b|\bcontacto\b/.test(normalizedBlock) || normalizedTitle === 'contacto') {
    return 'contact'
  }

  if (
    section !== 'general' ||
    /(?:^|\n)(?:Nombre del [^:]+|Nombre|Curso|Producto|Servicio|Taller|Tratamiento|Paquete)\s*:/i.test(
      block,
    )
  ) {
    return 'catalog_item'
  }

  return 'plain'
}

function toIndexedBlock(document: WorkspaceDocument, block: string, index: number): IndexedBlock {
  const fields = extractBlockFields(block)
  const title = extractBlockTitle(block)
  const body = block.trim()
  const normalizedTitle = normalizeText(title)
  const normalizedBody = normalizeText(body)

  return {
    id: `${document.id}:${index}`,
    document,
    title,
    body,
    normalizedTitle,
    normalizedBody,
    titleTokens: extractQueryWords(title),
    bodyTokens: extractQueryWords(`${title} ${body}`),
    fields,
    kind: detectBlockKind(body, fields, document.section),
  }
}

function isCatalogLikeBlock(block: IndexedBlock) {
  return block.kind === 'catalog_item'
}

function scoreIndexedBlock(block: IndexedBlock, query: string) {
  const queryIntent = analyzeQuery(query)
  const queryWords = extractQueryWords(query)
  let score = 0
  const { hintedNames, hasContextMarker } = extractHintedCourseNames(query)

  if (!query.trim()) {
    return block.document.section === 'general' ? 2 : 1
  }

  if (hintedNames.length > 0) {
    const blockNorm = `${block.normalizedTitle} ${block.normalizedBody}`
    for (const hn of hintedNames) {
      if (!hn) continue
      if (block.normalizedTitle.includes(hn) || blockNorm.includes(` ${hn} `) || blockNorm.startsWith(hn + ' ') || blockNorm.endsWith(' ' + hn) || blockNorm === hn) {
        score += 65
        break
      }
      const hnWords = hn.split(' ').filter((w) => w.length >= 4)
      let coincidencias = 0
      for (const w of hnWords) {
        if (block.titleTokens.includes(w) || block.bodyTokens.includes(w) || block.normalizedTitle.includes(w) || block.normalizedBody.includes(w)) {
          coincidencias += 1
        }
      }
      if (coincidencias >= Math.max(1, Math.ceil(hnWords.length * 0.5))) {
        score += 40 + coincidencias * 5
        break
      }
    }
  }

  const querySignificativa = queryWords.length >= 2
  if (!querySignificativa && hasContextMarker && hintedNames.length === 0) {
    const s = String(block.document.section || '').toLowerCase()
    if (s === 'productos' || s === 'cursos' || s === 'servicios' || s === 'tratamientos') {
      score -= 6
    }
  }

  // BOOST OBLIGATORIO: Bloque especial de FECHAS de cursos [FECHAS_CURSOS_DISPONIBLES] tiene que ser SIEMPRE el TOP 1
  // si la consulta tiene que ver con fechas, cursos o servicios (evita que se quede fuera del MAX_CONTEXT_BLOCKS=4
  // y por lo tanto el agente hallucine fechas por nunca ver el bloque real).
  if (block.normalizedTitle === 'fechas cursos disponibles') {
    score += 80
    if (queryIntent.wantsDates) score += 60
    if (queryIntent.wantsCourses) score += 20
    if (queryIntent.wantsServices) score += 10
  }

  if (block.document.section === 'general') {
    score += 1
  }

  if (queryIntent.wantsCourses && block.document.section === 'cursos') {
    score += 10
  }

  // Boost PRODUCTOS ligeramente más alto que cursos cuando wantsProducts=true, para evitar
  // que queries de existencia/stock de producto (ej: "pdrn menisco existencia") pierdan
  // slots top4 frente al temario genérico de cursos con "PDRN" genérico. Curso boost=10
  // vs producto boost=14 (4 extra) → diferencia controlada, nunca supera el bloque
  // FECHAS_CURSOS_DISPONIBLES (80 base) que tiene blindaje L365-L373.
  if (queryIntent.wantsProducts && block.document.section === 'productos') {
    score += 14
  }

  if (queryIntent.wantsServices && block.document.section === 'general') {
    score += 6
  }

  if (queryIntent.wantsServices && isTreatmentBlock(block)) {
    score += 16
  }

  if ((queryIntent.wantsLocation || queryIntent.wantsSchedule) && (block.kind === 'location' || block.kind === 'contact' || block.kind === 'schedule')) {
    score += 18
  }

  if (queryIntent.wantsDetails && isCatalogLikeBlock(block)) {
    score += 6
  }

  if (queryIntent.wantsList && isCatalogLikeBlock(block)) {
    score += 4
  }

  if (queryIntent.mentionsPresential && block.normalizedBody.includes('presencial')) {
    score += 5
  }

  if (
    queryIntent.mentionsOnline &&
    (block.normalizedBody.includes('online') || block.normalizedBody.includes('en linea'))
  ) {
    score += 5
  }

  let exactMatches = 0
  let partialMatches = 0
  let isNoiseBlock = false
  for (const pattern of NOISE_TITLE_PATTERNS) {
    if (pattern.test(block.title || '')) {
      isNoiseBlock = true
      break
    }
  }
  if (isNoiseBlock) {
    return NOISE_BLOCK_TITLE_MIN_SCORE
  }

  for (const word of queryWords) {
    if (block.titleTokens.includes(word) || block.normalizedTitle.includes(word)) {
      score += 8
      exactMatches += 1
      continue
    }

    if (
      block.bodyTokens.includes(word) ||
      block.normalizedBody.includes(word) ||
      Object.values(block.fields).some((value) => normalizeText(value).includes(word))
    ) {
      score += 4
      exactMatches += 1
      continue
    }

    const hasPartialTitleMatch = block.titleTokens.some((token) => sharedPrefixLength(token, word) >= 4)
    if (hasPartialTitleMatch) {
      score += 4
      partialMatches += 1
      continue
    }

    // Fallback Levenshtein distancia-1 (typos físicos tipo menisco vs medisco).
    // - Solo aplica a palabras query >= 5 chars (evita falsos positivos en palabras cortas).
    // - Score: 5 title / 2 body. Peso INTERMEDIO entre match exacto (8/4) y partial prefix (4/2).
    //   Motivo: un typo 1-letra en nombre de producto (p.ej. mENisco vs mEDisco) es casi tan
    //   fuerte una señal como un partial prefix de 4 chars shared, debe subir lo suficiente
    //   para pasar de puesto #7 a puesto ≤4 en el ranking.
    const wordLen = word.length
    if (wordLen >= 5) {
      const hasFuzzyTitleMatch = block.titleTokens.some((token) => isLevenshteinDistanceOne(token, word))
      if (hasFuzzyTitleMatch) {
        score += 5
        partialMatches += 1
        continue
      }
      const hasFuzzyBodyMatch = block.bodyTokens.some((token) => isLevenshteinDistanceOne(token, word))
      if (hasFuzzyBodyMatch) {
        score += 2
        partialMatches += 1
        continue
      }

      // === DOBLE SEGURO (si Lev-1 no matcheó por 2 typos, Ej: lipoeenzimas → lipoenzimas) ===
      // Normalización ya colapsó vocales repetidas (ej: ee -> e). Si aquí aún no hay match,
      // se aplica Lev ≤ 2 a palabras ≥ 6 chars (menos falsos positivos que Lev-1).
      // Puntuación reducida porque es una suposición más débil.
      if (wordLen >= 6) {
        const hasFuzzy2TitleMatch = block.titleTokens.some((token) =>
          isLevenshteinDistanceWithin(token, word, 2),
        )
        if (hasFuzzy2TitleMatch) {
          score += 4
          partialMatches += 1
          continue
        }
        const hasFuzzy2BodyMatch = block.bodyTokens.some((token) =>
          isLevenshteinDistanceWithin(token, word, 2),
        )
        if (hasFuzzy2BodyMatch) {
          score += 2
          partialMatches += 1
          continue
        }
      }
    }

    const hasPartialBodyMatch = block.bodyTokens.some((token) => sharedPrefixLength(token, word) >= 4)
    if (hasPartialBodyMatch) {
      score += 2
      partialMatches += 1
    }
  }

  if (queryWords.length > 0 && exactMatches === queryWords.length) {
    score += 18
  } else if (exactMatches + partialMatches >= Math.max(2, Math.ceil(queryWords.length * 0.6))) {
    score += 10
  }

  return score
}

function buildCatalogSummaryLine(block: IndexedBlock) {
  const title = block.title.trim()

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

  const details = [
    block.fields.modality && `Modalidades: ${block.fields.modality}`,
    block.fields.category && `Categoria: ${block.fields.category}`,
    block.fields.price && `Precio: ${block.fields.price}`,
  ].filter(Boolean)

  return `- ${title}${details.length > 0 ? ` | ${details.join(' | ')}` : ''}`
}

function buildStructuredCatalogSummary(blocks: IndexedBlock[], maxChars: number) {
  const lines: string[] = []
  const seenTitles = new Set<string>()
  let remainingChars = maxChars

  for (const block of blocks) {
    if (!isCatalogLikeBlock(block)) {
      continue
    }

    const normalizedTitle = normalizeText(block.title)
    if (!normalizedTitle || seenTitles.has(normalizedTitle)) {
      continue
    }

    const line = buildCatalogSummaryLine(block)
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

export function createSearchIndex(input: { tenantId: string; documents: WorkspaceDocument[] }) {
  const activeDocuments = input.documents.filter((document) => document.isActive)
  const blocks = activeDocuments.flatMap((document) =>
    splitDocumentIntoBlocks(document).map((block, index) => toIndexedBlock(document, block, index)),
  )

  return {
    tenantId: input.tenantId,
    documents: input.documents,
    blocks,
    signature: getSearchIndexSignature(activeDocuments),
    stats: {
      documents: input.documents.length,
      activeDocuments: activeDocuments.length,
      blocks: blocks.length,
    },
  } satisfies SearchIndex
}


function withinOneEdit(a: string, b: string) {
  if (a === b) return true
  if (Math.abs(a.length - b.length) > 1) return false
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1)
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1)
}

// Corrige errores de dedo de una letra (peptomas -> peptonas) usando los titulos indexados
function correctQueryTypos(index: SearchIndex, query: string) {
  const titleTokens = new Set<string>()
  for (const block of index.blocks) {
    for (const token of block.titleTokens) if (token.length >= 5) titleTokens.add(token)
  }
  const known = new Set(titleTokens)
  return normalizeText(query)
    .split(' ')
    .map((word) => {
      if (word.length < 5 || QUERY_ENTITY_STOP_WORDS.has(word) || known.has(word)) return word
      for (const token of titleTokens) if (withinOneEdit(word, token)) return token
      return word
    })
    .join(' ')
}

export function searchIndex(index: SearchIndex, rawQuery: string): SearchContextResult {
  const query = correctQueryTypos(index, rawQuery)
  const intent = analyzeQuery(query)
  const rankedBlocks = [...index.blocks].sort((left, right) => {
    const scoreDiff = scoreIndexedBlock(right, query) - scoreIndexedBlock(left, query)
    if (scoreDiff !== 0) {
      return scoreDiff
    }

    return new Date(right.document.updatedAt).getTime() - new Date(left.document.updatedAt).getTime()
  })
  const candidateBlocks = intent.wantsLocation
    ? rankedBlocks.filter((block) => block.document.section === 'general')
    : rankedBlocks
  const entityMatchedBlocks = intent.wantsList
    ? candidateBlocks
    : filterToEntityMatches(candidateBlocks, query, intent)

  if (isTreatmentOverviewQuery(query)) {
    const overview = buildTreatmentOverview(index)
    if (overview) {
      return {
        documents: Array.from(new Map(overview.blocks.map((block) => [block.document.id, block.document])).values()),
        contextBlock: overview.contextBlock.slice(0, MAX_CONTEXT_CHARS * 2),
        matchedBlocks: overview.blocks.slice(0, MAX_CONTEXT_BLOCKS),
        intent,
      }
    }
  }

  if (intent.wantsList) {
    const summary = buildStructuredCatalogSummary(candidateBlocks, MAX_CONTEXT_CHARS)

    if (summary) {
      return {
        documents: Array.from(
          new Map(candidateBlocks.map((block) => [block.document.id, block.document])).values(),
        ),
        contextBlock: summary,
        matchedBlocks: candidateBlocks.slice(0, MAX_CONTEXT_BLOCKS),
        intent,
      }
    }
  }

  let remainingChars = MAX_CONTEXT_CHARS
  const documents = new Map<string, WorkspaceDocument>()
  const matchedBlocks: IndexedBlock[] = []
  const selectedBlocks: string[] = []

  for (const block of entityMatchedBlocks) {
    if (remainingChars <= 0 || selectedBlocks.length >= MAX_CONTEXT_BLOCKS) {
      break
    }

    const label = block.document.section.toUpperCase()
    const header = block.title
      ? `[SECCION: ${label} | DOCUMENTO: ${block.document.title} | BLOQUE: ${block.title}]`
      : `[SECCION: ${label} | DOCUMENTO: ${block.document.title}]`
    const reservedChars = header.length + 2
    const availableChars = Math.max(0, Math.min(MAX_BLOCK_CHARS, remainingChars - reservedChars))

    if (availableChars <= 0) {
      continue
    }

    const content =
      block.body.length > availableChars
        ? `${block.body.slice(0, Math.max(availableChars - 1, 0)).trim()}...`
        : block.body

    if (!content) {
      continue
    }

    selectedBlocks.push(`${header}\n${content}`)
    matchedBlocks.push(block)
    documents.set(block.document.id, block.document)
    remainingChars -= header.length + content.length + 2
  }

  return {
    documents: Array.from(documents.values()),
    contextBlock:
      selectedBlocks.length > 0 ? selectedBlocks.join('\n\n') : '(Sin documentos activos)',
    matchedBlocks,
    intent,
  }
}
