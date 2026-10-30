import type { DocumentSection, WorkspaceDocument } from './workspace.js'

import { createHash } from 'node:crypto'

const MAX_CONTEXT_BLOCKS = 4
const MAX_CONTEXT_CHARS = 3200
const MAX_BLOCK_CHARS = 1300
const MAX_SUMMARY_ITEMS = 12
// A full course list ("que cursos tienen") must name every course, not the first 12
const MAX_LIST_ITEMS = 40
const NOISE_BLOCK_TITLE_MIN_SCORE = -99999
const MIN_STRONG_FAQ_SCORE = 12
const WEAK_BLOCK_RATIO = 0.6
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
  'gracias', 'dale', 'listo', 'solo', 'unicamente',
  'producto', 'productos', 'curso', 'cursos', 'precio', 'precios',
  'cuanto', 'cuantos', 'cuanta', 'cuantas', 'kit', 'kits',
  'informacion', 'info', 'detalle', 'detalles',
  // Particulas cortas: aparecen dentro de cualquier nombre ("Aguja en U", "Rejuveness")
  'en', 'es', 'al', 'a', 'me', 'te', 'se', 'le', 'les', 'lo', 'mi', 'mis', 'tu', 'tus', 'su', 'sus', 'nos',
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
  // "¿cuentas con...?", "¿tienes...?" preguntan si existe algo, no lo nombran
  'cuentas', 'cuenta', 'cuentan', 'tienes',
  // Palabras de "dame la lista": piden el catalogo, no nombran un elemento
  'catalogo', 'lista', 'opciones', 'menu', 'taller', 'talleres', 'procedimiento', 'procedimientos',
  'programados', 'actualmente', 'ahorita',
  // "temario de X" pide una parte de X; "temario" solo coincide con todos los temarios
  'temario', 'temarios',
  // Verbos de "¿que ofrecen?": preguntan por la oferta, no nombran un elemento
  'brindan', 'brindas', 'brindar', 'brindamos', 'ofreces', 'ofrecer', 'manejan', 'manejas', 'manejar',
  'imparten', 'impartes', 'realizas', 'haces', 'trabajan', 'trabajas', 'tienen', 'vendes', 'proporcionan',
  'disponen', 'dispones', 'disponemos', 'manejas', 'surten', 'comercializan', 'distribuyen',
  // Preguntas sobre un curso ya hablado ("¿que temas trata la clase?", "¿cuanto dura?")
  'tema', 'temas', 'trata', 'tratan', 'clase', 'clases', 'tiempo', 'dura', 'duran', 'duracion',
  'incluye', 'incluyen', 'contenido', 'contenidos', 'modulos', 'horas',
  // "¿cursos gratuitos?", "¿algo economico?": preguntan por el precio, no nombran un elemento
  'gratis', 'gratuito', 'gratuitos', 'gratuita', 'gratuitas', 'economico', 'economicos', 'economica',
  'economicas', 'barato', 'baratos', 'barata', 'baratas', 'pesos', 'peso', 'dolares', 'dolar',
  'muestra', 'muestras', 'regalo', 'regalan', 'regalas', 'cortesia',
  // Preguntas de seguimiento ("¿y en linea?", "¿cuanto cuesta?"): piden un dato del tema ya hablado
  'linea', 'presencial', 'presenciales', 'modalidad', 'modalidades', 'costo', 'costos', 'cuesta', 'cuestan',
  'fecha', 'fechas', 'proxima', 'proximo', 'proximas', 'proximos', 'empieza', 'empiezan', 'inicia', 'inician',
  'tambien', 'entonces', 'ademas', 'todos', 'todas', 'cada', 'ellos', 'estos', 'esos', 'esas', 'estas', 'cual',
])

// Body areas describe what a treatment is for ("tratamientos para la cara"),
// they never name a treatment
const TREATMENT_AREA_WORDS = new Set([
  'cara', 'rostro', 'facial', 'faciales', 'cuerpo', 'corporal', 'corporales', 'piel',
  'cuello', 'papada', 'abdomen', 'piernas', 'brazos', 'gluteos', 'espalda', 'manos',
  'ojos', 'ojeras', 'parpados', 'frente', 'labios',
])

function queryEntityWords(query: string) {
  return normalizeText(query)
    .split(' ')
    .filter((word) => word.length >= 4 && !QUERY_ENTITY_STOP_WORDS.has(word) && !/^\d+$/.test(word))
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

// Words that point to a body area in a course card, by the area the query names
const AREA_TERM_GROUPS: Array<{ queryWords: string[]; terms: string[] }> = [
  {
    queryWords: ['cara', 'rostro', 'facial', 'faciales', 'cutis'],
    terms: [
      'cara', 'rostro', 'facial', 'faciales', 'hidrofacial', 'cutis', 'tercio', 'labios', 'parpados',
      'periocular', 'ojeras', 'papada', 'mandibular', 'menton', 'nariz', 'rinomodelacion', 'acne', 'rosacea',
    ],
  },
  {
    queryWords: ['cuerpo', 'corporal', 'corporales', 'abdomen', 'piernas', 'brazos', 'gluteos', 'espalda'],
    terms: ['cuerpo', 'corporal', 'corporales', 'abdomen', 'abdominal', 'piernas', 'brazos', 'gluteos', 'celulitis', 'estrias', 'grasa'],
  },
  { queryWords: ['labios'], terms: ['labios', 'labial'] },
  { queryWords: ['ojos', 'ojeras', 'parpados'], terms: ['parpados', 'periocular', 'ojeras', 'ojos'] },
]

function areaTermsForQuery(query: string) {
  const words = new Set(normalizeText(query).split(' '))
  return [...new Set(AREA_TERM_GROUPS.filter((group) => group.queryWords.some((word) => words.has(word))).flatMap((group) => group.terms))]
}

// "cursos para la cara", "cursos de tratamiento facial": every course card that
// mentions that area, one line each, so the bot can list them all
function buildCourseAreaSummary(blocks: IndexedBlock[], query: string) {
  const terms = areaTermsForQuery(query)
  if (terms.length === 0) return null
  if (!queryEntityWords(query).every((word) => TREATMENT_AREA_WORDS.has(word) || terms.includes(word))) return null

  const courses = blocks.filter((block) =>
    block.document.section === 'cursos' &&
    block.fields.name &&
    terms.some((term) => block.titleTokens.includes(term) || block.bodyTokens.includes(term)),
  )
  const seen = new Set<string>()
  const lines = courses
    .filter((block) => !seen.has(block.normalizedTitle) && Boolean(seen.add(block.normalizedTitle)))
    .map(buildCatalogSummaryLine)
    .filter(Boolean)
    .slice(0, MAX_SUMMARY_ITEMS)
  if (lines.length === 0) return null

  return {
    contextBlock: `Catalogo resumido encontrado en los documentos (cursos para la zona que pregunta el cliente; menciona solo estos cursos, y si hay calendario, solo las fechas de estos cursos):\n${lines.join('\n')}`.slice(0, MAX_CONTEXT_CHARS * 2),
    blocks: courses,
  }
}

// Areas that cover many treatments; a narrower one ("labios") can name a single
// treatment ("Relleno de labios")
const GENERAL_AREA_WORDS = new Set(['cara', 'rostro', 'facial', 'faciales', 'cuerpo', 'corporal', 'corporales', 'piel'])

function isTreatmentOverviewQuery(index: SearchIndex, query: string) {
  const normalized = normalizeText(query)
  const entities = queryEntityWords(query)
  const namesTreatment = entities.some((word) =>
    !GENERAL_AREA_WORDS.has(word) &&
    index.blocks.some((block) => isTreatmentBlock(block) && block.titleTokens.includes(word)),
  )
  return (
    // "cursos para tratamiento facial" asks about courses, not the treatments offered
    !/\bcursos?\b|\bdiplomados?\b|\bcapacitacion(?:es)?\b/.test(normalized) &&
    /\btratamientos?\b|\bsesion(?:es)?\b/.test(normalized) &&
    entities.every((word) => TREATMENT_AREA_WORDS.has(word)) &&
    !namesTreatment
  )
}

function buildTreatmentOverview(index: SearchIndex) {
  const treatmentBlocks = index.blocks.filter(isTreatmentBlock)
  if (treatmentBlocks.length === 0) return null

  // The business's general block about its treatments ("[TRATAMIENTOS_DIRECTOS_...]",
  // "[TRATAMIENTOS]"): who applies them, where, how to book
  const intro = index.blocks.find((block) =>
    /^tratamientos\b/.test(block.normalizedTitle) && !treatmentBlocks.includes(block),
  )
  const lines = treatmentBlocks.map((block) => {
    const price = block.body.match(/PRECIO APROXIMADO:\s*(.+)/i)?.[1]?.trim() || ''
    const shortPrice = price.length > 70 ? `${price.slice(0, 69).trim()}...` : price
    // The body area lets the bot answer "tratamientos para la cara" without guessing
    const area = block.body.match(/^(?:ZONA|[AÁ]REA)S?:\s*(.+)$/im)?.[1]?.trim() || ''
    return `- ${block.title.replace(/\.$/, '')}${area ? ` | Zona: ${area}` : ''}${shortPrice ? ` | ${shortPrice}` : ''}`
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
    /\bmas\b|\binformacion\b|\bficha\b|\bdetalle\b|\bdetalles\b|\btemario\b|\btemarios\b|\btema\b|\btemas\b|\bcontenido\b|\bcontenidos\b|\bmodulo\b|\bmodulos\b|\bduracion\b|\bdura\b|\bduran\b|\btiempo\b|\bhoras?\b/.test(
      normalizedQuery,
    )
  const mentionsPluralCatalog =
    /\bproductos\b|\bcursos\b|\bservicios\b|\btalleres\b|\btratamientos\b|\bprocedimientos\b/.test(
      normalizedQuery,
    )

  const wantsDates =
    /\bfecha\b|\bfechas\b|\bproxima\b|\bproximo\b|\bcuando\b|\bdisponible\b|\bdisponibles\b|\bcalendario\b|\bdia\b|\bdias\b|\bprogramado\b|\bprogramados\b|\bagendado\b|\bagendados\b|\bturno\b|\bcupo\b|\bcupos\b/.test(
      normalizedQuery,
    )
  const wantsCourses = /\bcurso\b|\bcursos\b|\bdiplomado\b|\bdiplomados\b|\bcapacitacion\b|\bcapacitaciones\b|\baprendizaje\b|\baprender\b|\bestudiar\b|\bcapacitarme\b|\binscribirme\b|\binscripcion\b|\btemario\b/.test(
    normalizedQuery,
  )
  const wantsDirectTreatment =
    !wantsCourses &&
    /\b(?:quiero|quisiera|me gustaria|busco)\b.{0,40}\b(?:aplicarme|aplicar|que me apliquen|que me hagan|hacerme|recibir|agendar|atenderme|(?:el|un|una)?\s*tratamiento|una sesion|una cita|el procedimiento)\b/.test(
      normalizedQuery,
    )
  const namesProducts = /\bproducto\b|\bproductos\b|\bserum\b|\bkit\b|\bampolla\b|\bampolletas\b|\bexistencia\b|\bexistencias\b|\binventario\b|\binventarios\b|\bstock\b|\bcomprar\b|\bcompro\b|\bcompras\b|\bvendemos\b|\bvenden\b|\bvender\b|\btienda\b|\btiendas\b|\bcodigo\b|\bcodigos\b|\bfamilia\b|\bfamilias\b|\bcategoria\b|\bcategorias\b/.test(
    normalizedQuery,
  )
  const wantsServices = wantsDirectTreatment || /\bservicio\b|\bservicios\b|\btaller\b|\btalleres\b|\btratamiento\b|\btratamientos\b|\bprocedimiento\b|\bprocedimientos\b/.test(
    normalizedQuery,
  )
  // Price, availability or ordering words apply to courses and treatments too:
  // they only point to products when nothing else is named ("precio del revofil")
  const asksCommerce = /\bcatalogo\b|\bcatalogos\b|\bpedir\b|\bpedido\b|\bpedidos\b|\badquirir\b|\badquiero\b|\bdisponibilidad\b|\bprecio\b|\bprecios\b|\bcosto\b|\bcostos\b/.test(
    normalizedQuery,
  )
  const wantsProducts = namesProducts || (asksCommerce && !wantsCourses && !wantsServices)

  return {
    wantsCourses,
    wantsProducts,
    wantsServices,
    wantsDirectTreatment,
    wantsLocation,
    wantsSchedule,
    wantsDates,
    // "que cursos tienen", "que productos venden": asks for the catalog, names no item
    wantsList:
      !wantsLocation &&
      !wantsSchedule &&
      !wantsDetails &&
      /\bproductos\b|\bcursos\b|\bservicios\b|\btalleres\b|\btratamientos\b|\bprocedimientos\b|\bdisponibles\b|\bofrecen\b|\bofreces\b|\bbrindan\b|\bbrindas\b|\bopciones\b|\bmenu\b|\bcatalogo\b|\blista\b|\bprogramados\b/.test(
        normalizedQuery,
      ) &&
      queryEntityWords(query).length === 0,
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

// Removes and returns the last line of the block when it is a paragraph of its
// own that reads as a title: short, no field, no list marker, no final period
function takeTrailingTitleLine(lines: string[]) {
  let last = lines.length - 1
  while (last >= 0 && !lines[last].trim()) last -= 1
  if (last < 1 || lines[last - 1].trim()) return null

  const candidate = lines[last].trim()
  const looksLikeTitle =
    candidate.length <= 80 &&
    !candidate.includes(':') &&
    !/[.!?]$/.test(candidate) &&
    !/^[-*•✨\d]/.test(candidate) &&
    !isStructuredHeading(candidate)
  if (!looksLikeTitle) return null

  lines.splice(last)
  return candidate
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
    // "[CURSO]" followed by "Nombre del curso: ..." is one card, not an empty
    // heading block plus the card
    const onlyHeadingSoFar = currentLines.filter((current) => current.trim()).every(isStructuredHeading)
    const startsNewBlock =
      currentLines.length > 0 &&
      (isStructuredHeading(line) || (isNamedField(line) && !onlyHeadingSoFar))

    if (startsNewBlock) {
      // A short title paragraph right above a heading names the new block
      // ("FIBROBLAST" above "[Temario]"), so it moves along with it
      const carriedTitle = isStructuredHeading(line) ? takeTrailingTitleLine(currentLines) : null
      const currentBlock = currentLines.join('\n').trim()
      if (currentBlock) {
        blocks.push(currentBlock)
      }
      currentLines = carriedTitle ? [carriedTitle, line] : [line]
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
    // Lines may start with spaces (" Nombre del curso: ..."), as in the database documents
    const match = block.match(new RegExp(`(?:^|\\n)[ \\t]*${label}\\s*:\\s*(.+)`, 'i'))
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
    /(?:^|\n)[ \t]*(?:Nombre del [^:]+|Nombre|Curso|Producto|Servicio|Taller|Tratamiento|Paquete)\s*:/i.test(
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

const FAQ_QUESTION_TOKENS = new WeakMap<IndexedBlock, string[]>()

function isFaqBlock(block: IndexedBlock) {
  return /^\[FAQ\]/i.test(block.body)
}

// The question (or customer message) of a FAQ is what a customer will resemble,
// so its words weigh like a title; the answer's words are only body text
function faqQuestionTokens(block: IndexedBlock) {
  let tokens = FAQ_QUESTION_TOKENS.get(block)
  if (!tokens) {
    const lines = block.body.split(/\r?\n/).filter((line) => /^\s*(?:Pregunta|Mensaje)\s*:/i.test(line))
    tokens = extractQueryWords(lines.join(' '))
    FAQ_QUESTION_TOKENS.set(block, tokens)
  }
  return tokens
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

  if (queryIntent.wantsDetails && queryIntent.wantsCourses && block.kind === 'schedule') {
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
  let faqQuestionHits = 0
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
    // Short words only count as whole words: "hp" must not match inside "shampoo"
    const allowsSubstring = word.length >= 4
    if (block.titleTokens.includes(word) || (allowsSubstring && block.normalizedTitle.includes(word))) {
      score += 8
      exactMatches += 1
      continue
    }

    // "grabado" asks what the question "grabada" asks: a shared start of 5+ letters
    if (
      isFaqBlock(block) &&
      faqQuestionTokens(block).some((token) => token === word || (word.length >= 5 && sharedPrefixLength(token, word) >= 5))
    ) {
      score += 8
      exactMatches += 1
      faqQuestionHits += 1
      continue
    }

    if (
      block.bodyTokens.includes(word) ||
      (allowsSubstring && block.normalizedBody.includes(word))
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

  // The customer's question is the FAQ's question: nothing else answers it better
  if (queryWords.length >= 1 && faqQuestionHits === queryWords.length) {
    score += 20
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

function itemName(block: IndexedBlock) {
  return (block.fields.name || block.title).trim().replace(/\.$/, '')
}

function uniqueNames(blocks: IndexedBlock[]) {
  return [...new Set(blocks.map(itemName).filter(Boolean))]
}

// Everything the business offers, one line per section: courses and treatments
// by name, products by name or, for a large catalog, by category
function buildOfferOverview(blocks: IndexedBlock[]) {
  const named = blocks.filter((block) => isCatalogLikeBlock(block) && block.fields.name)
  const treatments = blocks.filter(isTreatmentBlock)
  const courses = named.filter((block) => block.document.section === 'cursos')
  const products = named.filter((block) => block.document.section === 'productos')
  const otherServices = named.filter((block) => block.document.section === 'general' && !treatments.includes(block))

  const lines: string[] = []
  const courseNames = uniqueNames(courses)
  if (courseNames.length > 0) lines.push(`- Cursos (${courseNames.length}): ${courseNames.join(', ')}`)
  const treatmentNames = uniqueNames(treatments)
  if (treatmentNames.length > 0) lines.push(`- Tratamientos (${treatmentNames.length}): ${treatmentNames.join(', ')}`)
  const serviceNames = uniqueNames(otherServices)
  if (serviceNames.length > 0) lines.push(`- Servicios (${serviceNames.length}): ${serviceNames.join(', ')}`)
  if (products.length > MAX_SUMMARY_ITEMS) {
    const counts = new Map<string, number>()
    for (const block of products) {
      const category = block.fields.category.trim() || 'Otros'
      counts.set(category, (counts.get(category) || 0) + 1)
    }
    const categories = [...counts.entries()].sort((left, right) => right[1] - left[1])
    lines.push(`- Productos (${products.length}), por categoria: ${categories.map(([category, count]) => `${category} (${count})`).join(', ')}`)
  } else if (products.length > 0) {
    lines.push(`- Productos (${products.length}): ${uniqueNames(products).join(', ')}`)
  }
  if (lines.length === 0) return null

  return {
    contextBlock: `Catalogo resumido encontrado en los documentos (todo lo que ofrece el negocio, por tipo; si el cliente quiere detalles, pregunta que le interesa):\n${lines.join('\n')}`.slice(0, MAX_CONTEXT_CHARS * 2),
    blocks: [...courses, ...treatments, ...otherServices, ...products],
  }
}

// A catalog too long to list item by item is summarized by category, so the
// bot never presents the first few items as the whole catalog
function buildCategoryCatalogSummary(blocks: IndexedBlock[]) {
  const counts = new Map<string, number>()
  const lowestPrices = new Map<string, { amount: number; text: string }>()
  for (const block of blocks) {
    const category = block.fields.category.trim()
    if (!category) continue
    counts.set(category, (counts.get(category) || 0) + 1)
    const price = lowestPrice(block.fields.price)
    const known = lowestPrices.get(category)
    if (price && (!known || price.amount < known.amount)) lowestPrices.set(category, price)
  }
  if (counts.size === 0) return ''

  // The lowest price per category answers "¿tienen algo gratis / de 100 pesos?"
  // without listing hundreds of products
  const lines = [...counts.entries()]
    .sort((left, right) => right[1] - left[1])
    .map(([category, count]) => {
      const price = lowestPrices.get(category)
      return `- ${category} (${count} ${count === 1 ? 'producto' : 'productos'}${price ? `, desde ${price.text}` : ''})`
    })
  return `Catalogo resumido encontrado en los documentos (${blocks.length} productos en total, por categoria; pregunta al cliente que categoria o producto busca):\n${lines.join('\n')}`
}

// "$1,350 MXN" or "Online: $595 MXN / Presencial: $1350 MXN" to its lowest amount;
// $0 is a price nobody filled in, not a free item
function lowestPrice(price: string) {
  return priceAmounts(price).sort((left, right) => left.amount - right.amount)[0] || null
}

// Every amount of a price ("Online: $595 MXN ($33 USD) / Presencial: $1350 MXN");
// the dollar equivalents only when the price has nothing else
function priceAmounts(price: string) {
  const amounts: Array<{ amount: number; text: string; dollars: boolean }> = []
  for (const match of price.matchAll(/\$\s*(\d[\d,]*(?:\.\d+)?)(?:\s*(MXN|USD|pesos|dolares|dólares))?/gi)) {
    const amount = Number(match[1].replace(/,/g, ''))
    if (Number.isFinite(amount) && amount > 0) {
      amounts.push({ amount, text: match[0].trim(), dollars: /^(?:usd|dolares|dólares)$/i.test(match[2] || '') })
    }
  }
  const local = amounts.filter((item) => !item.dollars)
  return (local.length > 0 ? local : amounts).map(({ amount, text }) => ({ amount, text }))
}

function buildStructuredCatalogSummary(blocks: IndexedBlock[], maxChars: number) {
  const catalogBlocks = blocks.filter((block) => isCatalogLikeBlock(block) && block.fields.name)
  if (
    catalogBlocks.length > MAX_SUMMARY_ITEMS &&
    catalogBlocks.every((block) => block.document.section === 'productos')
  ) {
    const categorySummary = buildCategoryCatalogSummary(catalogBlocks)
    if (categorySummary) return categorySummary
  }

  const lines: string[] = []
  const seenTitles = new Set<string>()
  let remainingChars = maxChars

  // Item cards ("Nombre del curso: ...") when the documents have them, so section
  // headings, syllabi and calendars are not listed as if they were items
  for (const block of catalogBlocks.length > 0 ? catalogBlocks : blocks) {
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

    if (lines.length >= MAX_LIST_ITEMS) {
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


// Edit distance counting a swap of two neighbor letters as one edit ("apra" -> "para")
function typoDistance(a: string, b: string, max: number) {
  if (Math.abs(a.length - b.length) > max) return max + 1
  const rows = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  )
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      rows[i][j] = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        rows[i][j] = Math.min(rows[i][j], rows[i - 2][j - 2] + 1)
      }
    }
  }
  return rows[a.length][b.length]
}

// Words customers use to ask, whatever the business: a typo in them ("crsos",
// "dispinbile", "cra") hides the whole question from the search
const QUESTION_VOCABULARY = [
  'curso', 'cursos', 'producto', 'productos', 'servicio', 'servicios', 'tratamiento', 'tratamientos',
  'taller', 'talleres', 'diplomado', 'diplomados', 'sesion', 'sesiones',
  'gratis', 'gratuito', 'gratuitos', 'gratuita', 'gratuitas', 'economico', 'barato',
  'tienes', 'tienen', 'cuentas', 'cuentan', 'ofrecen', 'venden', 'manejan', 'hacen', 'aplican',
  'brindan', 'brindas', 'ofreces', 'manejas', 'imparten', 'realizan', 'trabajan', 'proporcionan',
  'disponen', 'dispones', 'venden', 'vendes',
  'temas', 'trata', 'clase', 'clases', 'tiempo', 'dura', 'duracion', 'incluye', 'contenido',
  'disponible', 'disponibles', 'disponibilidad', 'existencia', 'precio', 'precios', 'costo', 'cuanto', 'cuesta',
  'horario', 'horarios', 'fecha', 'fechas', 'cuando', 'donde', 'ubicacion', 'direccion',
  'online', 'linea', 'presencial', 'modalidad', 'informacion', 'quiero', 'necesito', 'busco',
  'para', 'sobre', 'tambien', 'hola', 'gracias', 'favor',
  'cara', 'rostro', 'facial', 'faciales', 'cuerpo', 'corporal', 'corporales', 'piel', 'cabello', 'capilar',
]

type TypoVocabulary = { known: Set<string>; names: string[]; places: string[] }
const typoVocabularies = new WeakMap<SearchIndex, TypoVocabulary>()

function getTypoVocabulary(index: SearchIndex): TypoVocabulary {
  const cached = typoVocabularies.get(index)
  if (cached) return cached

  // Every word already in the documents is right as written: never "corrected"
  const known = new Set<string>([...QUERY_ENTITY_STOP_WORDS, ...QUESTION_VOCABULARY])
  const names = new Set<string>()
  // Cities and places the business writes in its location blocks ("Hermosillo",
  // "Guadalajara"): customers misspell them as often as item names
  const places = new Set<string>()
  const counts = new Map<string, number>()
  for (const block of index.blocks) {
    // Every word, also those left out of the tokens ("productos")
    for (const word of normalizeText(`${block.title} ${block.body}`).split(' ')) {
      if (word) counts.set(word, (counts.get(word) || 0) + 1)
    }
  }
  for (const block of index.blocks) {
    for (const token of block.bodyTokens) {
      if (!known.has(token) && !isDocumentTypo(token, counts)) known.add(token)
    }
    // Item names only: a general block title ("[PERSONAL_CLAVE]") would turn
    // "clase" into "clave"
    if (block.document.section !== 'general' || isTreatmentBlock(block)) {
      for (const token of block.titleTokens) if (token.length >= 5) names.add(token)
    }
    if (isLocationBlock(block)) {
      for (const token of block.bodyTokens) if (token.length >= 5 && !/\d/.test(token)) places.add(token)
    }
  }
  const vocabulary = { known, names: [...names], places: [...places] }
  typoVocabularies.set(index, vocabulary)
  return vocabulary
}

// Documents have typos too ("¿Como puedo adquirir sus produtos?" in a FAQ): a word
// written once or twice that is one edit from a question word the documents use
// far more ("productos") is that word misspelled, not a word to keep as written
function isDocumentTypo(token: string, counts: Map<string, number>) {
  const count = counts.get(token) || 0
  if (token.length < 6 || count > 2) return false
  return QUESTION_VOCABULARY.some(
    (word) => word !== token && (counts.get(word) || 0) >= count * 10 && typoDistance(token, word, 1) <= 1,
  )
}

function correctWord(word: string, vocabulary: TypoVocabulary) {
  if (word.length < 3 || /\d/.test(word) || vocabulary.known.has(word)) return word

  // Item names: one edit, long words only (peptomas -> peptonas)
  // Question words: one edit, or two in longer words (tiness -> tienes);
  // 3-letter words only gain a missing letter (cra -> cara)
  // Places: one edit, or two in long names (hermosiyo -> hermosillo)
  const candidates: Array<{ token: string; maxEdits: number }> = [
    ...(word.length >= 5 ? vocabulary.names.map((token) => ({ token, maxEdits: 1 })) : []),
    ...(word.length >= 5 ? vocabulary.places.map((token) => ({ token, maxEdits: word.length >= 8 ? 2 : 1 })) : []),
    ...QUESTION_VOCABULARY
      .filter((token) => word.length > 3 || token.length === word.length + 1)
      .map((token) => ({ token, maxEdits: word.length >= 6 ? 2 : 1 })),
  ]
  let best: { token: string; distance: number } | null = null
  for (const { token, maxEdits } of candidates) {
    const distance = typoDistance(word, token, maxEdits)
    if (distance <= maxEdits && (!best || distance < best.distance)) best = { token, distance }
  }
  return best?.token || word
}

// Corrige errores de dedo usando las palabras de los documentos y de las preguntas
function correctQueryTypos(index: SearchIndex, query: string) {
  const vocabulary = getTypoVocabulary(index)
  return normalizeText(query)
    .split(' ')
    .map((word) => correctWord(word, vocabulary))
    .join(' ')
}

const SECTION_TOPIC_WORDS =
  // "temario" alone ("¿y el temario?") is about the course already talked about
  /\b(?:cursos?|productos?|tratamientos?|servicios?|talleres|taller|diplomados?|kits?|ubicacion|direccion|donde|sucursal(?:es)?|sede|horarios?|telefono|whatsapp|pagos?)\b/

// Whether a message says what it is about: a section ("cursos", "horarios") or
// an item the documents name. "¿Cuales son los precios?" or "¿y en linea?" do
// not: they continue the topic of the previous question
// The words of a text that the business's documents use. Meta ad titles carry
// campaign codes ("Relleno de arrugas MXMSVI 1026_Group_1_Image") that would be
// taken for part of an item name; no document uses them, so they drop out
export function keepDocumentWords(index: SearchIndex, text: string) {
  const { known } = getTypoVocabulary(index)
  const words = normalizeText(text).split(' ').filter((word) => word && !/\d/.test(word) && known.has(word))
  const namesSomething = words.some((word) => word.length >= 4 && !QUERY_ENTITY_STOP_WORDS.has(word))
  return namesSomething ? words.join(' ') : ''
}

export function namesKnownTopic(index: SearchIndex, message: string) {
  const query = correctQueryTypos(index, message)
  // "¿ustedes venden?" is about the products, not a follow-up of the previous question
  if (SECTION_TOPIC_WORDS.test(query) || SELLING_QUESTION.test(query)) return true
  return queryEntityWords(query).some((word) => index.blocks.some((block) => blockNameHasWord(block, word)))
}

function isLocationBlock(block: IndexedBlock) {
  return (
    block.document.section === 'general' &&
    (block.kind === 'location' || /\b(?:ubicacion|direccion|sucursal|sucursales|sede|sedes)\b/.test(block.normalizedTitle))
  )
}

// "cursos en Hermosillo": a place that only the location blocks mention says
// where, it does not name an item. So does an unknown word right after "en"
// ("cursos en Monterrey"), a city where the business may have no branch
function findPlaceWords(index: SearchIndex, query: string) {
  const tokens = query.split(' ')
  const followsEn = (word: string) => tokens.some((token, i) => token === word && tokens[i - 1] === 'en')
  return queryEntityWords(query).filter((word) =>
    !index.blocks.some((block) => block.document.section !== 'general' && blockNameHasWord(block, word)) &&
    (
      index.blocks.some((block) => isLocationBlock(block) && block.bodyTokens.includes(word)) ||
      (followsEn(word) && !index.blocks.some((block) => block.bodyTokens.includes(word)))
    ),
  )
}

export function searchIndex(index: SearchIndex, rawQuery: string): SearchContextResult {
  const correctedQuery = correctQueryTypos(index, rawQuery)
  const placeWords = findPlaceWords(index, correctedQuery)
  if (placeWords.length === 0) return searchCorrectedQuery(index, correctedQuery)

  // The place is searched apart: the items without it, plus where the business is
  const withoutPlaces = correctedQuery
    .split(' ')
    .filter((word) => !placeWords.includes(word))
    .join(' ')
  const result = searchCorrectedQuery(index, withoutPlaces)
  // The blocks that mention the place; for a city the business is not in, its
  // location blocks, so the bot can say where it is
  const mentioningPlace = index.blocks.filter((block) =>
    isLocationBlock(block) && placeWords.some((word) => block.bodyTokens.includes(word)),
  )
  const namesPlace = (block: IndexedBlock) => /\b(?:ubicacion|direccion|sucursal|sucursales|sede|sedes)\b/.test(block.normalizedTitle)
  const placeBlocks = (mentioningPlace.length > 0 ? mentioningPlace : index.blocks.filter(isLocationBlock))
    .filter((block) => !result.matchedBlocks.includes(block))
    // "[UBICACION]", "[CURSOS_SUCURSALES]" before a phone block that is also of kind location
    .sort((left, right) => Number(namesPlace(right)) - Number(namesPlace(left)))
    .slice(0, 2)
  if (placeBlocks.length === 0) return result

  const placeContext = placeBlocks
    .map((block) => `[SECCION: GENERAL | DOCUMENTO: ${block.document.title} | BLOQUE: ${block.title}]\n${block.body}`)
    .join('\n\n')
  return {
    ...result,
    documents: Array.from(new Map([...result.documents, ...placeBlocks.map((block) => block.document)].map((document) => [document.id, document])).values()),
    contextBlock: result.matchedBlocks.length > 0 || /^Catalogo resumido/.test(result.contextBlock)
      ? `${result.contextBlock}\n\n${placeContext}`
      : placeContext,
    matchedBlocks: [...result.matchedBlocks, ...placeBlocks],
  }
}

const AMOUNT_WORDS: Record<string, number> = {
  cien: 100, ciento: 100, doscientos: 200, trescientos: 300, cuatrocientos: 400, quinientos: 500,
  seiscientos: 600, setecientos: 700, ochocientos: 800, novecientos: 900,
  un: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10,
}

// The amount a question asks about: "1000", "1,500 pesos", "$500", "mil",
// "dos mil", "quinientos pesos". A small number needs a currency word or "$",
// and a number with a unit ("aguja 30 g", "toxina 100 u", "500 ml") is not a price
const AMOUNT_UNITS = new Set(['g', 'gr', 'mg', 'kg', 'ml', 'l', 'u', 'ui', 'mm', 'cm', 'cap', 'piezas', 'pzas', 'unidades', 'puntas', 'horas', 'dias'])

function findAskedAmount(query: string): number | null {
  // The search gets "1,500" already normalized to "1 500"
  const words = normalizeText(query.replace(/(\d),(\d{3})\b/g, '$1$2'))
    .replace(/\b(\d{1,3}) (\d{3})\b/g, '$1$2')
    .split(' ')
  const mentionsMoney = /\$|\b(?:pesos?|mxn|dolares?|usd|precio|precios|cuesten|cuestan|cueste|cuesta)\b/i.test(query)
  for (let i = 0; i < words.length; i++) {
    const word = words[i]
    if (/^\d+$/.test(word)) {
      if (AMOUNT_UNITS.has(words[i + 1])) continue
      const amount = Number(word) * (words[i + 1] === 'mil' ? 1000 : 1)
      if (amount >= 10 && (mentionsMoney || amount >= 100)) return amount
      continue
    }
    if (word === 'mil') {
      const before = AMOUNT_WORDS[words[i - 1]] || 0
      const after = AMOUNT_WORDS[words[i + 1]] >= 100 ? AMOUNT_WORDS[words[i + 1]] : 0
      return (before > 0 && before < 100 ? before : 1) * 1000 + after
    }
    if ((AMOUNT_WORDS[word] || 0) >= 100 && mentionsMoney) return AMOUNT_WORDS[word]
  }
  return null
}

// The items whose price is close to the asked amount (±25%), or else the nearest
// ones, so the bot can say "around $1,000 we have..." or "our prices start at..."
function buildPriceRangeSummary(blocks: IndexedBlock[], amount: number) {
  const priced = blocks
    .filter((block) => isCatalogLikeBlock(block) && block.fields.name)
    // A course priced online and in person counts by the price closest to the amount
    .map((block) => ({
      block,
      price: priceAmounts(block.fields.price).sort((left, right) => Math.abs(left.amount - amount) - Math.abs(right.amount - amount))[0],
    }))
    .filter((item): item is { block: IndexedBlock; price: { amount: number; text: string } } => Boolean(item.price))
  if (priced.length === 0) return null

  const near = priced.filter(({ price }) => Math.abs(price.amount - amount) <= amount * 0.25)
  // The closest to the amount first, then listed from cheapest to most expensive
  const chosen = [...(near.length > 0 ? near : priced)]
    .sort((left, right) => Math.abs(left.price.amount - amount) - Math.abs(right.price.amount - amount))
    .slice(0, 25)
    .sort((left, right) => left.price.amount - right.price.amount)
  const amounts = priced.flatMap(({ block }) => priceAmounts(block.fields.price).map((price) => price.amount))
  const header = near.length > 0
    ? `Catalogo con precio cercano a $${amount} encontrado en los documentos (${near.length} en total${near.length > chosen.length ? ', se muestran algunos' : ''}):`
    : `Ningun elemento cuesta cerca de $${amount}; los precios van de $${Math.min(...amounts)} a $${Math.max(...amounts)}. Los mas cercanos:`
  const lines = chosen.map(({ block }) => `- ${block.fields.name} | Precio: ${block.fields.price}`)
  return { contextBlock: `${header}\n${lines.join('\n')}`, blocks: chosen.map(({ block }) => block) }
}

const SELLING_QUESTION = /\b(?:venden|vendes|vendemos|vender|venta|ventas|comercializan|distribuyen)\b/

function searchCorrectedQuery(index: SearchIndex, query: string): SearchContextResult {
  const intent = analyzeQuery(query)
  // Scored once per block: scoring inside the comparator repeated it on every comparison
  const scores = new Map(index.blocks.map((block) => [block, scoreIndexedBlock(block, query)]))
  const rankedBlocks = [...index.blocks].sort((left, right) => {
    const scoreDiff = scores.get(right)! - scores.get(left)!
    if (scoreDiff !== 0) {
      return scoreDiff
    }

    return new Date(right.document.updatedAt).getTime() - new Date(left.document.updatedAt).getTime()
  })
  const candidateBlocks = intent.wantsLocation
    ? rankedBlocks.filter((block) => block.document.section === 'general')
    : rankedBlocks
  const filteredBlocks = intent.wantsList
    ? candidateBlocks
    : filterToEntityMatches(candidateBlocks, query, intent)
  // A FAQ that answers the question well must not be diluted by weak matches
  // (every product matches "precio"): they distract the model into "no information"
  const topBlock = filteredBlocks[0]
  const topScore = topBlock ? scores.get(topBlock) ?? 0 : 0
  const entityMatchedBlocks =
    !intent.wantsList && topBlock && isFaqBlock(topBlock) && topScore >= MIN_STRONG_FAQ_SCORE
      ? filteredBlocks.filter((block) => isFaqBlock(block) || (scores.get(block) ?? 0) >= topScore * WEAK_BLOCK_RATIO)
      : filteredBlocks

  // "¿Ustedes venden?", "¿darán datos de proveedores o venden?": whether the
  // business sells. Unless a product is named, the catalog by category answers
  // it, though other words of the question are not in the documents
  // Only products, courses and treatments count: "datos" also titles general
  // blocks like [DATOS_BANCARIOS_PUBLICOS], which are not something for sale
  const namesItem = queryEntityWords(query).some((word) =>
    index.blocks.some((block) => (block.document.section !== 'general' || isTreatmentBlock(block)) && blockNameHasWord(block, word)),
  )
  // "¿venden cursos?" asks about courses: their own list answers it
  if (SELLING_QUESTION.test(query) && !namesItem && !intent.wantsCourses && !intent.wantsServices) {
    const products = candidateBlocks.filter((block) => block.document.section === 'productos')
    const summary = products.length > 0 ? buildStructuredCatalogSummary(products, MAX_CONTEXT_CHARS * 2) : ''
    if (summary) {
      return {
        documents: Array.from(new Map(products.map((block) => [block.document.id, block.document])).values()),
        contextBlock: summary,
        matchedBlocks: products.slice(0, MAX_CONTEXT_BLOCKS),
        intent,
      }
    }
  }

  // "¿productos de mil pesos?", "¿cursos de 500?": the items priced around that
  // amount, since a summary by category cannot say which ones cost it
  const askedAmount = findAskedAmount(query)
  if (askedAmount && !namesItem && (intent.wantsProducts || intent.wantsCourses)) {
    const section = intent.wantsCourses && !intent.wantsProducts ? 'cursos' : 'productos'
    const summary = buildPriceRangeSummary(candidateBlocks.filter((block) => block.document.section === section), askedAmount)
    if (summary) {
      return {
        documents: Array.from(new Map(summary.blocks.map((block) => [block.document.id, block.document])).values()),
        contextBlock: summary.contextBlock,
        matchedBlocks: summary.blocks.slice(0, MAX_CONTEXT_BLOCKS),
        intent,
      }
    }
  }

  const courseAreaSummary = intent.wantsCourses && !intent.wantsDetails
    ? buildCourseAreaSummary(candidateBlocks, query)
    : null
  if (courseAreaSummary) {
    return {
      documents: Array.from(new Map(courseAreaSummary.blocks.map((block) => [block.document.id, block.document])).values()),
      contextBlock: courseAreaSummary.contextBlock,
      matchedBlocks: courseAreaSummary.blocks.slice(0, MAX_CONTEXT_BLOCKS),
      intent,
    }
  }

  if (isTreatmentOverviewQuery(index, query)) {
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

  // "que servicios brindan", "que ofrecen": no section named, so every section
  // in short, instead of the first 40 items of a mix of all of them
  if (intent.wantsList && !intent.wantsCourses && !intent.wantsProducts) {
    const overview = buildOfferOverview(candidateBlocks)
    if (overview) {
      return {
        documents: Array.from(new Map(overview.blocks.map((block) => [block.document.id, block.document])).values()),
        contextBlock: overview.contextBlock,
        matchedBlocks: overview.blocks.slice(0, MAX_CONTEXT_BLOCKS),
        intent,
      }
    }
  }

  if (intent.wantsList) {
    // "que cursos tienen" lists only courses
    const listSection = intent.wantsCourses ? 'cursos' : intent.wantsProducts ? 'productos' : null
    const listBlocks = listSection
      ? candidateBlocks.filter((block) => block.document.section === listSection)
      : candidateBlocks
    const summary = buildStructuredCatalogSummary(listBlocks, MAX_CONTEXT_CHARS * 2)

    if (summary) {
      return {
        documents: Array.from(
          new Map(listBlocks.map((block) => [block.document.id, block.document])).values(),
        ),
        contextBlock: summary,
        matchedBlocks: listBlocks.slice(0, MAX_CONTEXT_BLOCKS),
        intent,
      }
    }
  }

  // "Más información del curso rejuvenecimiento facial tercio superior": a
  // treatment named like that is not what was asked when there is a course for
  // it ("Toxina Botulínica: Tercio superior"); with both, the bot may answer
  // that the course does not exist
  const asksForCourse = intent.wantsCourses && !intent.wantsServices
  const selectableBlocks = intent.wantsDirectTreatment
    ? entityMatchedBlocks.filter(isTreatmentBlock)
    : asksForCourse && entityMatchedBlocks.some((block) => block.document.section === 'cursos')
      ? entityMatchedBlocks.filter((block) => !isTreatmentBlock(block))
      : entityMatchedBlocks

  let remainingChars = MAX_CONTEXT_CHARS
  const documents = new Map<string, WorkspaceDocument>()
  const matchedBlocks: IndexedBlock[] = []
  const selectedBlocks: string[] = []

  for (const block of selectableBlocks) {
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
