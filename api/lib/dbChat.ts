import { keepDocumentWords, namesKnownTopic, normalizeText, searchIndex, type IndexedBlock, type SearchIndex } from './searchIndex.js'
import { getDbTenantSearchIndex } from './dbWorkspace.js'
import { DEFAULT_TIME_ZONE, describeTimeZone, detectTimeZoneSetting, getZonedDateParts } from './timeZone.js'
import {
  createAutoEval,
  type AutoEvalCategory,
  type AutoEvalMatchedBlockRef,
} from './posStore.js'
import crypto from 'node:crypto'

type Role = 'user' | 'assistant'

export type DbConversationMessage = {
  role: Role
  content: string
}

type DbChatInput = {
  tenantId: string
  prompt: string
  message: string
  history: DbConversationMessage[]
  referralContext?: string
  psid?: string
  triggerMessageId?: string
  botMessageId?: string
}

type GenAnswerOpts = { autocuratorEnabled?: boolean }

export type AutoEvalResult = {
  id: string
  category: AutoEvalCategory
  judgeReason: string
  blocked: boolean
}

const DEFAULT_BASE_URL = 'https://api.x.ai/v1/chat/completions'

function getConfiguredModel() {
  return process.env.LLM_MODEL_NAME?.trim() || process.env.XAI_MODEL?.trim() || 'openai/gpt-oss-120b'
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

  // default más generoso: cursos listando múltiples fechas + natural pueden requerir 900-1400 tokens
  return 1600
}

const DEFAULT_FALLBACK_MODEL_IF_NO_ENV = 'openai/gpt-oss-120b'

function getConfiguredFallbackModel(): string {
  return process.env.LLM_FALLBACK_MODEL?.trim() || DEFAULT_FALLBACK_MODEL_IF_NO_ENV
}

const MESES_ES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']
const DIAS_ES = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']

// Today in the business's own time zone (from its documents, Hermosillo by default)
function getCurrentDateTimeSpanish(timeZone = DEFAULT_TIME_ZONE): { fechaCompleta: string; fechaISO: string; anio: number; mes: number; dia: number } {
  const zoned = getZonedDateParts(new Date(), timeZone)
  const dia = zoned.day.toString().padStart(2, '0')
  const mes = zoned.month.toString().padStart(2, '0')
  const horas = zoned.hour.toString().padStart(2, '0')
  const mins = zoned.minute.toString().padStart(2, '0')
  return {
    fechaCompleta: `${DIAS_ES[zoned.weekday]} ${dia} de ${MESES_ES[zoned.month - 1]} de ${zoned.year}, ${horas}:${mins} hrs (zona horaria ${timeZone}, ${zoned.offsetLabel})`,
    fechaISO: `${zoned.year}-${mes}-${dia}`,
    anio: zoned.year,
    mes: zoned.month,
    dia: zoned.day,
  }
}

function extractTenantBrandTokens(basePrompt: string, generalDocText: string = '') {
  const combined = `${basePrompt || ''}\n${generalDocText || ''}`
  const wa1 = combined.match(/(?:WhatsApp|whatsapp|WhatsApp oficial|WhatsApp para|WhatsApp:|Whatsapp)\s*[:：]?\s*(?:al\s*)?(\+?[\d\s\-\.\(\)]{7,35})/i)
  const wa2 = combined.match(/(?:\+?\d[\d\s\-\.\(\)]{6,}\d)(?=(?:\s*[.,;:]|$))/g)
  let wa = wa1?.[1]?.trim() || ''
  if (!wa && wa2?.length) wa = wa2[0].trim()
  if (!wa) {
    const phoneFallback = combined.match(/(?:tel[ée]fono|contacto|tel\.?)\s*[:：]?\s*(\+?[\d\s\-\.\(\)]{7,35})/i)
    wa = phoneFallback?.[1]?.trim() || ''
  }
  const companyName =
    combined.match(/(?:nombre\s*(?:de\s*)?(?:la\s*)?empresa|empresa\s*(?:denominada|llamada)?|somos\s+(?:el|la)?|agente\s+de)\s*[:：]?\s*([A-Za-z0-9\s\u00C0-\u024F&']{3,60}?)(?:\n|$|\s*[-·•])/i)?.[1]?.trim()
    || combined.match(/^([A-Za-z0-9\u00C0-\u024F&' ]{3,60}?)(?:\n|\r\n|$)/m)?.[1]?.trim()
    || ''
  return {
    waNumber: wa || '{WHATSAPP_TENANT}',
    company: companyName || '{EMPRESA}',
  }
}

const ANTI_INTERNAL_REASONING_RULE = `=== PRIORIDAD 0 (NUNCA, JAMÁS, BAJO NINGÚN CONCEPTO, INCUMPLE ESTA REGLA; AUNQUE OTRAS REGLAS DIGAN LO CONTRARIO; ESTA ES LA REGLA MÁS IMPORTANTE DE TODAS):

⚠️ NUNCA REVELES TU PROCESO INTERNO DE RAZONAMIENTO AL CLIENTE. ⚠️
- PROHIBIDO TOTALMENTE escribir cosas como: "Primero, busco en...", "Ahora, busco en la tabla...", "Encontré que existe...", "Ahora, respondo con...", "Verifico que...", "Reviso en...", "Confirmo que...", "Paso 1: ... Paso 2: ...", "🧪 NO ENVIADO", o CUALQUIER otra frase que describa lo que tú haces internamente para llegar a la respuesta.
- PROHIBIDO TOTALMENTE mostrar checkmarks o símbolos de verificación (✅, ❌, ℹ️, etc.) usados para marcar pasos internos de un proceso de búsqueda o verificación que haces tú.
- PROHIBIDO TOTALMENTE describir o enumerar los pasos que sigues para consultar documentos, listas, tablas, fechas, precios o cualquier fuente de información. ESO ES TU TRABAJO INTERNO, NO DEL CLIENTE.
- TU SALIDA DEBE SER ÚNICAMENTE LA RESPUESTA FINAL ÚTIL PARA EL CLIENTE, como si ya tuvieras toda la información de forma inmediata y sin esfuerzo. El cliente NO le importa CÓMO llegaste a la respuesta, solo le importa CUÁL es la respuesta.
- EJEMPLO DE LO QUE NUNCA DEBES HACER:
  ❌ MAL: "Primero busco el curso Mesobotox. ✅ Encontré que existe. Ahora busco su fecha. ✅ Tiene fecha 19 de agosto. Ahora respondo: Nombre: Mesobotox..."
  ✅ BIEN: Directamente la ficha del curso o la información útil para el cliente SIN NINGÚN preámbulo sobre tu proceso interno.

=== FIN PRIORIDAD 0 ===

=== PRIORIDAD 0.1 (TOLERANCIA A ERRORES DE ESCRITURA DEL CLIENTE):
- ANTES DE BUSCAR o decidir que "no existe un curso/producto/servicio", CORRIGE INTERNAMENTE (sin decírselo al cliente) faltas de ortografía, acentos omitidos, letras repetidas ("ee", "oo", "nn"), letras intercambiadas ("aleguía" / "alegría"), o consonantes finales omitidas ("mesobotok" / "mesobotox", "peptonas" / "peptpnas", "lipoenzimas" / "lipoeenzimas").
- NUNCA le digas al cliente que su consulta estaba mal escrita ni le hagas notar la corrección. Simplemente úsala internamente para encontrar el curso/producto correcto y responde como si hubiera escrito el nombre bien.
- Si al corregir internamente hay varias opciones probables, menciona las 1-3 más cercanas sin confesar que corregiste nada.
- EJEMPLO:
  ❌ MAL: "No tenemos un curso llamado lipoeenzimas, pero sí tenemos Lipoenzimas..."
  ✅ BIEN: Directamente da la información del curso Lipoenzimas como si el cliente lo hubiera escrito correctamente.

=== FIN PRIORIDAD 0.1 ===
`

function buildSystemPrompt(prompt: string, contextBlock: string, referralContext = '', hasTreatments = false, timeZone = DEFAULT_TIME_ZONE) {
  const now = getCurrentDateTimeSpanish(timeZone)
  const timeAwarenessBlock = `=== PRIORIDAD 0.2 (CONCIENCIA TEMPORAL Y FECHAS — NUNCA, BAJO NINGÚN CONCEPTO, INCUMPLE ESTAS REGLAS):
- La fecha y hora ACTUAL en que transcurre esta conversación es: ${now.fechaCompleta} (formato ISO: ${now.fechaISO}).
- ESTA ES LA VERDAD ABSOLUTA SOBRE LA FECHA. NUNCA digas una fecha, ni hagas suposiciones, ni uses información de los documentos sin antes compararla contra HOY.
- REGLAS OBLIGATORIAS SOBRE FECHAS DE CURSOS, EVENTOS, PROMOCIONES, RESERVAS, CUALQUIER COSA CON FECHA:
  1) ANTES de mencionar CUALQUIER fecha que aparezca en los documentos, calcula mentalmente si ESA FECHA ya PASÓ respecto a HOY (${now.fechaCompleta}).
  2) Si la fecha ya PASÓ (por ejemplo: es 01 de Septiembre y el documento dice "20 de Agosto"), PROHIBIDO TOTALMENTE decir que "está programada para el X día" o que "hay curso el X día" o cualquier frase que sugiera que FALTA para esa fecha. ESA FECHA YA PASÓ.
  3) Si una fecha ya pasó, en vez de ofrecerla como disponible, dices lo siguiente (elige la variante que mejor encaje), usando el WhatsApp o teléfono de contacto que aparece en la información del negocio:
     - "La fecha pasada de [nombre curso/evento] fue [fecha]. Para las próximas fechas disponibles te invitamos a consultar por WhatsApp al [WhatsApp del negocio]."
     - O si el cliente preguntó directamente por esa fecha: "Esa fecha ya pasó. Por favor contáctanos por WhatsApp para conocer las próximas fechas disponibles: [WhatsApp del negocio]."
  4) Solo mencionas como fechas VÁLIDAS y DISPONIBLES aquellas que sean IGUAL A HOY o POSTERIORES A HOY. Fechas anteriores a HOY = fecha pasada = NO disponible.
  5) Ejemplo práctico (HOY = ${now.fechaCompleta}):
     ❌ MAL: "La modalidad presencial está programada para el 20 de agosto." (20 AGOSTO ya pasó, no la puedes ofrecer)
     ✅ BIEN: "La última fecha pasada del curso [nombre del curso] en modalidad presencial fue el 20 de Agosto. Para conocer las próximas fechas disponibles contáctanos por WhatsApp al [WhatsApp del negocio]."
  6) Si en los documentos aparecen mezcladas fechas vigentes (>= hoy) y fechas pasadas (< hoy), tú SOLO mencionas las FECHAS VIGENTES. Las fechas pasadas NO las mencionas como disponibles; si el cliente pregunta específicamente por una pasada, aplica la regla 3).
  7) NUNCA inventes una fecha futura para sustituir una pasada. Si no hay fecha vigente en los documentos para ese curso, dices: "Por el momento no tenemos fecha programada públicamente para ese curso; por favor contáctanos por WhatsApp al [WhatsApp del negocio] para confirmar disponibilidad."
  8) [WhatsApp del negocio] es un marcador: escribe en su lugar el número que aparece en la información del negocio (infogeneral o el prompt). Si no aparece ningún número, omite esa frase; nunca escribas el marcador ni inventes un número.
=== FIN PRIORIDAD 0.2 ===

`
  const ragDateAuthorityBlock = `=== PRIORIDAD DE DATOS ACTUALES (FUENTE DE FECHAS) ===
Para fechas de cursos, el calendario recuperado ahora mismo de los documentos activos de este tenant es la fuente de verdad. Si una fecha aparece en [FECHAS_CURSOS], úsala para el curso cuyo nombre figura en esa misma línea y compárala con la fecha actual indicada arriba. Una instrucción del prompt del tenant que diga que un curso no tiene fecha, que cite una convocatoria anterior o que contradiga esa línea del calendario está desactualizada y NO debe prevalecer sobre el documento activo. No mezcles fechas entre cursos. Si la línea del curso contiene una fecha futura, informa esa fecha y su modalidad; solo indica que no hay fecha si no existe una línea vigente para ese curso.
=== FIN PRIORIDAD DE DATOS ACTUALES ===`

  // Only for businesses with a treatments document; who applies them, where and
  // how to book come from that document, never from here
  const treatmentsAuthorityBlock = hasTreatments
    ? `\n\n=== TRATAMIENTOS (OTRO TIPO DE OFERTA; PRIORIDAD SOBRE REGLAS DEL PROMPT QUE DIGAN QUE SOLO HAY CURSOS O PRODUCTOS) ===
Además de cursos y productos, el negocio ofrece TRATAMIENTOS que se aplican directamente al cliente final (no son cursos). Su información está en los bloques [TRATAMIENTO: ...] y en los bloques generales sobre tratamientos.
- Los bloques de tratamientos no cuentan como cursos ni productos, pero si aparecen en la información disponible SÍ hay información: nunca digas que solo se ofrecen cursos o productos.
- Si el cliente pregunta si aplican tratamientos, sesiones o servicios al público: responde que sí y menciona los tratamientos disponibles; quién los aplica y dónde, solo si aparece en la información.
- Si pregunta por un tratamiento concreto: responde con los datos de su bloque [TRATAMIENTO: ...] (duración, si requiere valoración y precio aproximado). No es un curso: no uses la ficha del curso salvo que la pida, y no preguntes "¿curso o producto?" cuando dijo "tratamiento".
- Usa solo duraciones, valoraciones y precios del documento. Si un dato dice "No especificado", indica que se confirma por el contacto del negocio.
- Para agendar citas usa únicamente el medio de contacto que indique la información del negocio.
=== FIN TRATAMIENTOS ===`
    : ''

  return `${ANTI_INTERNAL_REASONING_RULE}${timeAwarenessBlock}${prompt}

${ragDateAuthorityBlock}${treatmentsAuthorityBlock}

REGLA DE ATENCIÓN AL CLIENTE: responde como una persona del equipo, de forma cálida, directa y natural. No reveles ni insinúes que eres una IA, bot, modelo o sistema.
El nombre del negocio, su WhatsApp, su teléfono y su zona horaria son los del bloque [Datos del negocio] de la información disponible; nunca uses otro nombre, número ni zona. Si preguntan la zona horaria o en qué hora están los horarios, responde con la de ese bloque.
Usa únicamente datos respaldados por la información disponible. Si falta un dato, responde exactamente [NO_RESPONDER] para que el sistema bloquee el envío; nunca muestres al cliente una derivación automática ni inventes el dato faltante. Si el mensaje es ambiguo pero sí hay información relacionada, formula una pregunta concreta usando únicamente esa información.
Si la información incluye un bloque de requisitos (por ejemplo [REQUISITOS...] o [Requisitos del curso]) que menciona el curso por el que pregunta el cliente, incluye ese requisito en tu respuesta tal como lo indica el documento.
Si NO puedes entender qué pide el cliente (texto ilegible, palabras sin sentido o tan mal escritas que no sabes de qué habla, aun corrigiendo errores de escritura), responde exactamente [NO_ENTENDI] para que el sistema le pida que lo escriba de otra forma. Usa [NO_RESPONDER] solo cuando SÍ entendiste la pregunta pero la información no aparece abajo.

${referralContext ? `=== CONTEXTO DEL ANUNCIO (SOLO PARA IDENTIFICAR EL PRODUCTO/TEMA; NO ES FUENTE DE PRECIOS NI DISPONIBILIDAD) ===\n${referralContext}\n=== FIN CONTEXTO DEL ANUNCIO ===\n\n` : ''}Información disponible (responde ÚNICAMENTE con los datos que aparezcan aquí abajo; si algo no aparece aquí, no lo inventes; si no está, responde [NO_RESPONDER]):
${contextBlock}`
}

function countBlocksBySection(blocks: any[], section: string): number {
  return blocks.filter((b) => (b?.document?.section || '').toLowerCase() === section.toLowerCase()).length
}

const PRODUCT_FICHA_TOKENS = [
  /(?:^|\n)[\s•\-\*]*Nombre\s*del?\s*producto\s*[:：]/i,
  /(?:^|\n)[\s•\-\*]*Código\s*[:：]/i,
  /(?:^|\n)[\s•\-\*]*Familia\s*[:：]/i,
  /(?:^|\n)[\s•\-\*]*Categoría\s*[:：]/i,
  /(?:^|\n)[\s•\-\*]*Precio\s*[:：]\s*\$?\s*\d+/i,
]
const COURSE_FICHA_TOKENS = [
  /(?:^|\n)[\s•\-\*]*Temario\b/i,
  /(?:^|\n)[\s•\-\*]*Modalidad\s*[:：]/i,
  /(?:^|\n)[\s•\-\*]*Curso\s+de\b/i,
  /(?:^|\n)[\s•\-\*]*Fecha\s*[:：].*(?:Enero|Febrero|Marzo|Abril|Mayo|Junio|Julio|Agosto|Septiembre|Octubre|Noviembre|Diciembre|Ags\.?|Sep\.?|Oct\.?)/i,
  /Incluye.*(?:constancia|práctica|modelo|materiales|protocolo)/i,
]

function blockLooksLikeProductFicha(b: any): boolean {
  const haystack = `${b?.title || ''}\n${b?.body || ''}`
  if ((b?.document?.section || '').toLowerCase() === 'productos') return true
  return PRODUCT_FICHA_TOKENS.some((re) => re.test(haystack))
}

function blockLooksLikeCourseFicha(b: any): boolean {
  const haystack = `${b?.title || ''}\n${b?.body || ''}`
  if ((b?.document?.section || '').toLowerCase() === 'cursos') return true
  return COURSE_FICHA_TOKENS.some((re) => re.test(haystack))
}

function contextBlockProductHints(ctx: string): number {
  const text = (ctx || '').slice(0, 5000)
  let hits = 0
  for (const re of PRODUCT_FICHA_TOKENS) { if (re.test(text)) hits++ }
  return hits
}

function looksLikeProductPriceInventoryQuery(normalizedMessage: string): boolean {
  const q = (normalizedMessage || '').toLowerCase()
  return /\b(existe|existencia|inventario|tienen|hay|stock|precio|precio\s*es|cuanto\s*cuesta|cuesta|costo|vale|valen|precio\s+total|a\s+como\s+esta|a\s+cuanto|precios|precio|codigo|código|código\s+del|familia|categoría|categoria|departamento|referencia|sku|precio\s+por|costo\s+por|disponible|disponibilidad|comprar|vender|pedido|pedir|adquirir|tienda|catalogo|catálogo|precio\s+de\s+venta)\b/.test(q)
}

function looksLikeCategoryFacetFollowUp(history: any[], q: string): boolean {
  const combined = `${((history||[]).slice(-6).map((m:any)=>String(m?.content||'')).join(' \n '))} \n ${q||''}`.toLowerCase()
  return /otra\s+marca|otra\s+opci[oó]n|otro\s+producto|otros\s+productos|m[áa]s\s+opciones|tienes\s+de\s+otro|solo\s+tienes|solo\s+cuentas|existe\s+otro|adem[áa]s\s+de|hay\s+otro|alguna\s+otra\s+categoria|alg[úu]n\s+otro/.test(combined)
}

function normalizeKeyword(q: string): string {
  return (q||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim()
}
function blockContainsKeyword(b: any, kw: string): boolean {
  const k = normalizeKeyword(kw)
  if (!k) return false
  const hay = normalizeKeyword(`${b?.title||''} ${b?.body||''} ${b?.document?.title||''} ${b?.document?.section||''}`)
  return k.split(' ').filter(s=>s.length>=2).every(t => hay.includes(` ${t} `) || hay.startsWith(t+' ') || hay.endsWith(' '+t) || hay === t)
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
  const modelsToTry: string[] = []
  if (args.model) modelsToTry.push(args.model)
  if (args.fallbackModel && args.fallbackModel !== args.model) modelsToTry.push(args.fallbackModel)

  // ===== AIRBAG INCONDICIONAL (solo para Groq provider): modelos que SÍEMPRE están disponibles =====
  // Si el usuario configuró en la UI/env modelos decommissioned (ej. llama-3.1-8b-instant,
  // llama-3.3-70b-versatile) se terminan los 2 y se cae al fallback. Esto agrega 3 nombres
  // probados y vigentes de Groq SÓLO si no estaban ya en la lista y la baseUrl es de Groq.
  // No es pool gigante, es un airbag pequeño (~3 modelos) para evitar pérdidas de servicio
  // cuando los nombres de los modelos se decommisionan y nadie actualizó el env.
  if (/groq\.com/i.test(args.baseUrl || '')) {
    const GROQ_ALWAYS_ON_DEFAULTS = [
      'openai/gpt-oss-120b',
      'openai/gpt-oss-20b',
      'qwen/qwen3.6-27b',
    ]
    for (const m of GROQ_ALWAYS_ON_DEFAULTS) {
      if (!modelsToTry.includes(m)) modelsToTry.push(m)
    }
  }

  let requestedMaxTokens = args.maxTokens

  const supportsReasoningEffort = /gpt-oss|deepseek|qwq|o1|o3/i.test(args.model || '') || /groq\.com/i.test(args.baseUrl || '')

  for (let mi = 0; mi < modelsToTry.length; mi += 1) {
    const activeModel = modelsToTry[mi]
    const modelSupportsReasoning = supportsReasoningEffort || /gpt-oss|deepseek|qwq|o1|o3/i.test(activeModel)
    for (let attempt = 0; attempt < 3; attempt += 1) {
      let response: Response | null = null
      try {
        const bodyPayload: any = {
          model: activeModel,
          temperature: 0.2,
          max_tokens: requestedMaxTokens,
          messages: args.messages,
        }
        if (modelSupportsReasoning) {
          bodyPayload.reasoning_effort = 'low'
        }
        response = await fetch(args.baseUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${args.apiKey}`,
          },
          body: JSON.stringify(bodyPayload),
          signal: AbortSignal.timeout(90000),
        })
      } catch (err: any) {
        const isTimeout = /timeout|timed?out|abort/i.test(err?.message || String(err))
        if (isTimeout && attempt < 2) {
          continue
        }
        continue
      }

      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        const message =
          (payload as any)?.error?.message ||
          (payload as any)?.message ||
          'No se pudo obtener respuesta del modelo'
        // eslint-disable-next-line no-console
        console.error('[requestCompletion] HTTP no OK', { status: response.status, model: activeModel, attempt, message: String(message).slice(0, 400) })

        // Modelo no válido / deprecado / bloqueado: saltar directamente al SIGUIENTE modelo
        const modelError =
          response.status === 404 ||
          response.status === 403 ||
          /model\s+(?:does\s+not\s+exist|not\s+found|invalid|unknown|is\s+not\s+available|has\s+been\s+decommissioned|no\s+longer\s+supported|you\s+do\s+not\s+have\s+access|unsupported\s+model|is\s+blocked\s+at\s+the\s+project\s+level|not\s+enabled)/i.test(String(message)) ||
          /unsupported\s+model|model_blocked|disabled|invalid_model|decommission/i.test(String((payload as any)?.error?.code || ''))
        if (modelError) break // sale del loop de attempts para este modelo

        const retryable =
          /rate limit|too many requests|429|5\d\d|timeout|server error|unavailable|temporarily|gateway|quota|overloaded/i.test(String(message)) ||
          response.status === 429 ||
          response.status >= 500
        if (retryable && attempt < 2) {
          const backoff = 1500 * (attempt + 1)
          await new Promise((r) => setTimeout(r, backoff))
          continue
        }
        continue
      }

      if (!payload || !Array.isArray((payload as any).choices) || (payload as any).choices.length === 0) {
        // eslint-disable-next-line no-console
        console.error('[requestCompletion] OK pero sin choices / payload inválido', {
          model: activeModel,
          attempt,
        })
        continue
      }

      const choice = (payload as any).choices[0]
      const answer = String(choice?.message?.content || '').trim()
      const finish = choice?.finish_reason
      if (!answer) {
        if (attempt < 2) {
          requestedMaxTokens = Math.max(80, Math.floor(requestedMaxTokens * 0.8))
          continue
        }
        continue
      }
      return { answer, finishReason: typeof finish === 'string' ? finish : null } satisfies CompletionChunk
    }
  }

  // Fallback honesto y multi-tenant (NO menciona IA ni modelos, solo dificultades técnicas + contacto humano)
  return {
    answer:
      'Por el momento tenemos dificultades técnicas temporales. Por favor contáctanos por WhatsApp y un asesor humano te atenderá de inmediato. ¡Gracias por tu comprensión!',
    finishReason: 'fallback_models_unavailable',
  } satisfies CompletionChunk
}

// =========================================================================
// AUTO-CURADO · JUEZ-LLM SÍNCRONO (último filtro ANTES de enviar al cliente)
// =========================================================================
// Reglas de negocio:
// - correct     → la respuesta usa la info de los docs recuperados, no es copia
//                 literal, sigue el tono/instrucciones del prompt. SE ENVÍA.
// - error       → la info SÍ estaba en los docs pero el bot NO la usó
//                 (omitió datos clave, se inventó cosas, respondió otra cosa,
//                 o dijo "no tengo info" cuando sí la tenía). NO SE ENVÍA.
// - noinfo      → la info NO estaba en los docs recuperados; el bot respondió
//                 con lo que pudo o derivó. NO SE ENVÍA.
// - judge_failed→ fallo al invocar al juez (timeout/error). Fail-closed:
//                 se trata como bloqueado, NO SE ENVÍA.

const AUTOJUDGE_SYSTEM_PROMPT = `Eres un auditor estricto e imparcial que clasifica respuestas de un chatbot en EXACTAMENTE UNA de estas 3 categorías, sin excepciones:

Categoría 1) correct
Cuándo usar:
  a) El sistema SÍ recuperó documentos relevantes (RAG > 0, o la respuesta cita datos que existen en esos documentos).
  b) La respuesta del bot SÍ utiliza esa información de forma correcta.
  c) NO es una copia literal/pegada del documento: el bot la parafrasea, estructura el mensaje de forma natural/informativa y respeta la voz/instrucciones del prompt del tenant (ej. saludo, despedida, muletillas naturales, formato texto plano).
  d) No inventa datos que no están en los documentos.
  e) SALUDOS, CORTESÍAS Y PREGUNTAS ACLARATORIAS SON "correct" SIEMPRE, aunque no usen información de los documentos:
     - "Hola", "Gracias", "De nada", "¿En qué te apoyamos?", "¿Qué curso buscas?", "¿Qué producto te interesa?" → SIEMPRE categoría correct.
     - Si el bot hace una pregunta de aclaración porque la pregunta del cliente es ambigua, NO es un error → es correct.
  f) VALIDACIÓN TEMPORAL OBLIGATORIA (SIEMPRE APLICAR, AUNQUE LAS DEMÁS REGLAS DIGAN LO CONTRARIO):
     - El bot SÍ respetó la fecha actual y NO ofreció fechas pasadas como disponibles.
     - Si una fecha en los documentos ya pasó respecto a HOY (se te indicará la fecha actual abajo), el bot debe: o no mencionarla como disponible, o decir que ya pasó y derivar a WhatsApp.
     - Si el bot hace esto bien → no penaliza, sigue siendo "correct".

Categoría 2) error (SOLO para ERRORES GRAVES. NUNCA marcar error por omisiones MENORES):
Cuándo SÍ marcar "error":
  a) El sistema SÍ recuperó documentos relevantes (RAG > 0) que contienen la información necesaria para responder la pregunta.
  b) Y el bot cometió UN ERROR GRAVE COMO UNO DE ESTOS:
     - INVENTÓ precios, fechas, nombres, códigos, datos que NO aparecen en los documentos,
     - DIJO "no tengo información" / "consulta por WhatsApp" cuando SÍ tenía la respuesta CLARA y EXPLÍCITA en los documentos recuperados,
     - Respondió algo COMPLETAMENTE DISTINTO a lo preguntado,
     - CITÓ UN PRECIO O FECHA EQUIVOCADA (no coincide con los documentos).
     - ERROR TEMPORAL (prioridad alta): El bot PRESENTÓ COMO DISPONIBLE UNA FECHA QUE YA PASÓ respecto a la fecha actual que se te indica (ej: dice "el curso es el 20 de Agosto" cuando HOY es 01 de Septiembre). ESTO ES "error" OBLIGATORIO, sin excepciones.
NUNCA marcar "error" por:
     - NO mencionar stock/inventario/disponibilidad A MENOS QUE EL CLIENTE PREGUNTARA EXPLÍCITAMENTE POR ELLO (palabras: stock, inventario, existencia, disponible, hay, quedan).
     - NO repetir TODOS los campos del documento; la información parcial correcta no es error.
     - NO dar información que el cliente NO pidió.
     - Preguntas de aclaración / muletillas naturales / saludos / despedidas.

Categoría 3) noinfo
Cuándo usar:
  a) Ni los documentos recuperados ni las reglas operativas autorizadas del prompt del tenant contienen la información para responder la pregunta,
     Y por lo tanto el bot tuvo que responder sin fuente, o pedir disculpas, o derivar a WhatsApp.

REGLA DE SILENCIO: si falta información para responder, la categoría DEBE ser "noinfo", aunque el bot ofrezca confirmar el dato con un asesor o derive a WhatsApp. Las respuestas que dicen que no hay información, que no se sabe el dato o que derivan una pregunta no respaldada por documentos NO son correctas: deben bloquearse para que no se envíen al cliente. Solo clasifica como "correct" una derivación cuando los documentos sí respaldan la información principal solicitada.

REGLA DE FUENTE AUTORIZADA PARA PAGOS: las reglas explícitas del prompt del tenant sobre inscripción, ubicación, modalidad, métodos de pago, PayPal, Stripe, cuentas y enlaces oficiales son una fuente autorizada de primer nivel. No marques como "error" o "noinfo" una respuesta de pagos solo porque esos datos no aparezcan en matchedBlocks, siempre que la respuesta respete literalmente el bloque autorizado del prompt. Si el prompt contiene un flujo específico para la situación actual, una respuesta de falta de información es incorrecta.

INSTRUCCIONES DE SALIDA (OBLIGATORIO, SIN TEXTO EXTRA):
Responde ÚNICAMENTE con un bloque JSON que tenga esta estructura y NADA MÁS:
{
  "category": "correct | error | noinfo",
  "reason": "explicación corta en español de por qué tomaste esa decisión (máximo 2 frases)"
}
EJEMPLO DE SALIDA VÁLIDA:
{"category": "correct", "reason": "El bot usó la dirección del documento y pidió aclarar el precio."}
No escribas explicaciones fuera del JSON, no uses markdown, no agregues texto antes ni después. No agregues comentarios. NADA excepto el JSON.`

type JudgeOutput = { category: 'correct' | 'error' | 'noinfo'; reason: string }

function safeJsonParseJudge(text: string): JudgeOutput | null {
  try {
    let cleaned = String(text || '').trim()
    if (!cleaned) return fallbackRegexJudge('')
    cleaned = cleaned
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim()
    const start = cleaned.indexOf('{')
    const end = cleaned.lastIndexOf('}')
    if (start < 0 || end < 0 || end <= start) return fallbackRegexJudge(String(text || '').trim())
    let candidate = cleaned.slice(start, end + 1)
    let json: any = null
    try {
      json = JSON.parse(candidate)
    } catch {
      const repaired = candidate
        .replace(/,\s*([}\]])/g, '$1')
        .replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:/g, '$1"$2":')
        .replace(/:\s*"((?:[^"\\]|\\.)*)$/s, (_, p1) => `:"${p1.replace(/"/g, '\\"')}"}`)
      try { json = JSON.parse(repaired) } catch { json = null }
      if (!json) return fallbackRegexJudge(String(text || '').trim())
    }
    if (!json || typeof json !== 'object') return fallbackRegexJudge(String(text || '').trim())
    let category = String(json.category || '').trim().toLowerCase() as 'correct' | 'error' | 'noinfo'
    if (category !== 'correct' && category !== 'error' && category !== 'noinfo') {
      const alt = String((json as any).cat || (json as any).categoria || '').trim().toLowerCase()
      if (alt === 'correcto' || alt === 'ok') category = 'correct'
      else if (alt === 'error' || alt === 'incorrecto') category = 'error'
      else if (alt === 'noinfo' || alt === 'no_info' || alt === 'sin-info') category = 'noinfo'
    }
    if (category !== 'correct' && category !== 'error' && category !== 'noinfo') return fallbackRegexJudge(String(text || '').trim())
    const reason = String(json.reason || (json as any).razon || '').trim()
    return { category, reason: reason || 'Sin justificación' }
  } catch {
    return fallbackRegexJudge(String(text || '').trim())
  }
}

function fallbackRegexJudge(text: string): JudgeOutput | null {
  const norm = String(text || '')
    .replace(/\s+/g, ' ')
    .replace(/[“”"'`]/g, '"')
    .trim()
  if (!norm) return null
  const catRe = /category["'\s:]*\s*["']?\s*(correct|error|noinfo)\b/i
  const reasonRe = /reason["'\s:]*\s*["']?\s*([^"'\n\r\t}]{1,500}?)\s*["'}]?\s*$/i
  const reasonAltRe = /reason["'\s:]*\s*["']?\s*([^"'\n\r\t}]{1,500})/i
  const catMatch = norm.match(catRe)
  if (!catMatch) return null
  const category = catMatch[1].toLowerCase() as 'correct' | 'error' | 'noinfo'
  if (category !== 'correct' && category !== 'error' && category !== 'noinfo') return null
  let reason = ''
  const rm = norm.match(reasonRe) || norm.match(reasonAltRe)
  if (rm && rm[1]) reason = rm[1].trim().replace(/\s+$/, '').replace(/["']+$/, '').trim()
  return { category, reason: reason.slice(0, 600) || '(Sin justificación - parseo regex fallback)' }
}

async function runAutocuratorJudge(args: {
  apiKey: string
  baseUrl: string
  model: string
  fallbackModel?: string
  maxTokens: number
  tenantPrompt: string
  userQuestion: string
  conversationContext: string
  referralContext: string
  botAnswer: string
  matchedBlocksText: string
  timeZone: string
}): Promise<JudgeOutput> {
  const now = getCurrentDateTimeSpanish(args.timeZone)
  const ragSummary = args.matchedBlocksText || '(NO hubo documentos recuperados por el RAG — matchedBlocks vacío)'
  const promptSnippet = (args.tenantPrompt || '').slice(0, 2500)
  const paymentStart =
    /(?:===+\s*)?flujos?\s+de\s+inscripci[oó]n\s*\((?:cursos|solo)|(?:===+\s*)?flujo\s+a\)\s*inscripci[oó]n|bloque\s+m[eé]xico|(?:===+\s*)?reglas\s+(?:prioritarias\s+de\s+)?inscripci[oó]n\s+y\s+pago/i.exec(args.tenantPrompt || '')
    || /flujos?\s+de\s+inscripci[oó]n|m[eé]todos?\s+de\s+pago|bloque\s+internacional/i.exec(args.tenantPrompt || '')
  const paymentPolicy = paymentStart
    ? (args.tenantPrompt || '').slice(paymentStart.index, Math.min((args.tenantPrompt || '').length, paymentStart.index + 16000)).trim()
    : ''
  const fechaHoyBlock = `=== FECHA ACTUAL (HOY) — REFERENCIA OBLIGATORIA PARA VALIDACIÓN TEMPORAL ===
Fecha y hora actual: ${now.fechaCompleta} (ISO: ${now.fechaISO}).
Esto significa que CUALQUIER fecha de curso/evento/promoción ANTERIOR a ${now.fechaISO} = FECHA PASADA = NO DISPONIBLE.
Si la respuesta del bot ofrece como disponible una fecha anterior a HOY → categoría "error" OBLIGATORIO.
=== FIN FECHA ACTUAL ===

`
  const messages = [
    { role: 'system' as const, content: AUTOJUDGE_SYSTEM_PROMPT },
    {
      role: 'user' as const,
      content:
`${fechaHoyBlock}=== PROMPT DEL TENANT (primeras ~2500 chars) ===
${promptSnippet || '(sin prompt del tenant)'}

=== REGLAS AUTORIZADAS DE PAGOS DEL PROMPT ===
${paymentPolicy || '(no se encontró una sección de pagos explícita)'}

=== DOCUMENTOS RECUPERADOS POR RAG (matchedBlocks) ===
${ragSummary}

=== PREGUNTA DEL CLIENTE ===
${args.userQuestion}

=== CONTEXTO RECIENTE DE LA CONVERSACIÓN ===
${args.conversationContext || '(sin mensajes anteriores)'}

=== CONTEXTO DEL ANUNCIO (PISTA DE INTENCIÓN, NO FUENTE DE PRECIO) ===
${args.referralContext || '(sin referencia de anuncio)'}

=== RESPUESTA DEL BOT ===
${args.botAnswer}

=== FIN DE LA ENTRADA ===
Ahora devuelve EXCLUSIVAMENTE el JSON con "category" y "reason".`,
    },
  ]
  const judgeMaxTokens = Math.min(1000, Math.max(700, args.maxTokens))
  const userPromptHardened = [
    { role: 'system' as const, content: AUTOJUDGE_SYSTEM_PROMPT + '\n\nREGLA FINAL INQUEBRANTABLE: DEBES terminar tu respuesta EXACTAMENTE con el cierre } del JSON. NADA después.' },
    {
      role: 'user' as const,
      content: args.model.includes('openai/') || /gpt|sonar|groq/i.test(args.model + args.fallbackModel || '')
        ? messages[1].content
        : messages[1].content + '\n\n[CONSEJO TÉCNICO] Envía solo el JSON sin preámbulos. Empieza directamente con {"category": ... termina con }.',
    },
  ]
  let parsed: JudgeOutput | null = null
  const attempts = 3
  for (let i = 0; i < attempts && !parsed; i++) {
    const res = await requestCompletion({
      apiKey: args.apiKey,
      baseUrl: args.baseUrl,
      model: i === 2 && args.fallbackModel ? args.fallbackModel : args.model,
      fallbackModel: args.fallbackModel,
      maxTokens: judgeMaxTokens,
      messages: (i === 0 ? [messages[0], messages[1]] : userPromptHardened) as any,
    })
    parsed = safeJsonParseJudge(res.answer)
  }
  if (!parsed) throw new Error('Juez no devolvió JSON válido después de 3 intentos')
  return parsed
}

function matchedBlocksToText(blocks: any[]): string {
  const arr = Array.isArray(blocks) ? blocks : []
  if (!arr.length) return ''
  return arr
    .map((b, i) => {
      const title = String(b?.title || b?.documentTitle || 'Documento sin título').trim()
      const section = String(b?.section || '').trim()
      const body = String(b?.block || b?.body || b?.snippet || b?.content || '').trim()
      return `[Documento ${i + 1}]${title ? ` Título: ${title}` : ''}${section ? ` · Sección: ${section}` : ''}\nContenido:\n${body}`
    })
    .join('\n\n---\n\n')
}

function matchedBlocksToRefs(blocks: any[]): AutoEvalMatchedBlockRef[] {
  const arr = Array.isArray(blocks) ? blocks : []
  return arr.map((b) => {
    const title = String(b?.title || b?.documentTitle || '').trim()
    const section = String(b?.section || '').trim()
    const body = String(b?.block || b?.body || b?.snippet || b?.content || '').trim()
    const snippet = body.length > 300 ? body.slice(0, 300) + '…' : body
    const raw = `${title}|${section}|${body}`
    const hash = crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16)
    return { hash, title: title || undefined, section: section || undefined, snippet: snippet || undefined }
  })
}

const NO_INFORMATION_PHRASE = /(?:no\s+(?:cuento|contamos|tenemos|tengo|dispongo|disponemos)\s+(?:con\s+)?(?:esa\s+)?(?:informaci[oó]n|datos)|no\s+hay\s+(?:informaci[oó]n|datos)|no\s+(?:s[eé]|sabemos|puedo\s+responder|podemos\s+responder)|no\s+estoy\s+capacitado\s+para\s+responder|(?:soy|como)\s+(?:una?\s+)?(?:ia|inteligencia\s+artificial|bot|asistente\s+virtual))/i

function significantNameTokens(value: string) {
  return normalizeText(value)
    .split(' ')
    .filter((token) => token.length >= 4 && !COURSE_QUERY_STOP_WORDS.has(token))
}

// A requirements block ("[REQUISITOS_PARA_TOMAR_CURSOS...]") whose list names one
// of the courses found, so the bot states the condition the business wrote
// ("se requiere titulo medico para aplicar...") for that course
export function findRequirementBlockForCourses(blocks: IndexedBlock[], matchedBlocks: IndexedBlock[]) {
  const courseNames = matchedBlocks
    .filter((block) => block.document.section === 'cursos' && block.fields.name)
    .map((block) => significantNameTokens(block.fields.name))
    .filter((tokens) => tokens.length > 0)
  if (courseNames.length === 0) return null

  return blocks.find((block) => {
    if (!/requisito/i.test(block.title) || matchedBlocks.includes(block)) return false
    const listedNames = block.body
      .split(/\r?\n/)
      .filter((line) => /^\s*[-*•]/.test(line))
      .map(significantNameTokens)
    return listedNames.some((listed) =>
      courseNames.some((course) => {
        const shared = course.filter((token) => listed.includes(token)).length
        return shared >= Math.min(2, course.length, listed.length)
      }),
    )
  }) || null
}

const MAX_PROFILE_BLOCK_CHARS = 400
const MAX_PAYMENT_BLOCK_CHARS = 2000

function findGeneralBlocks(blocks: IndexedBlock[], matchedBlocks: IndexedBlock[], title: RegExp, maxChars: number) {
  return blocks.filter((block) =>
    block.document.section === 'general' &&
    title.test(block.normalizedTitle) &&
    block.body.length <= maxChars &&
    !matchedBlocks.includes(block),
  )
}

// The business's name and contact from its general documents ("[NOMBRE_DE_EMPRESA]",
// "[WHATSAPP_OFICIAL]", "[TELEFONO]"): every answer may need them (past dates,
// bookings, payments) and the code never holds them
export function findBusinessProfileBlocks(blocks: IndexedBlock[], matchedBlocks: IndexedBlock[]) {
  return [
    ...findGeneralBlocks(blocks, matchedBlocks, /\bnombre (?:de (?:la )?|del )?(?:empresa|negocio)\b/, MAX_PROFILE_BLOCK_CHARS).slice(0, 1),
    ...findGeneralBlocks(blocks, matchedBlocks, /\b(?:whatsapp|telefono|contacto)\b/, MAX_PROFILE_BLOCK_CHARS).slice(0, 2),
  ]
}

// The business's payment blocks ("[DATOS_BANCARIOS_PUBLICOS]", "[FORMAS_DE_PAGO_ACEPTADAS]"):
// the only source of accounts, amounts and links the bot may give
export function findBusinessPaymentBlocks(blocks: IndexedBlock[], matchedBlocks: IndexedBlock[]) {
  return findGeneralBlocks(blocks, matchedBlocks, /\b(?:pago|pagos|bancari[oa]s?)\b/, MAX_PAYMENT_BLOCK_CHARS).slice(0, 3)
}

// Payment or enrollment talk: the message asks about paying, or the bot was
// already walking the customer through enrollment and payment
export function isPaymentConversation(userMessage: string, history: DbConversationMessage[]) {
  const asksPayment = /(?:\bpag(?:o|os|ar|ue)\b|\bcuentas?\b|dep[oó]sito|transferencia|tarjeta|paypal|stripe|oxxo|\bspei\b|clabe|\bapart(?:ar|ado|o)\b|inscrib|inscripci[oó]n|comprobante)/i
  if (asksPayment.test(String(userMessage || ''))) return true
  const lastAssistant = [...(history || [])]
    .reverse()
    .find((message) => message.role === 'assistant' && String(message.content || '').trim())
  return Boolean(
    lastAssistant &&
    /pago|inscrip|ciudad\s+o\s+pa[ií]s|desde\s+qu[eé]\s+(?:ciudad|pa[ií]s)|modalidad\s+(?:online|presencial)/i.test(lastAssistant.content),
  )
}

function buildDbDocumentsContextBlock(index: SearchIndex, query = '', includePayment = false) {
  const result = searchIndex(index, query) as any
  const matchedBlocks = Array.isArray(result.matchedBlocks) ? result.matchedBlocks : []
  const queryTokens = normalizeText(query)
    .split(' ')
    .filter((token) => token.length > 2 && !COURSE_QUERY_STOP_WORDS.has(token))
  // Date questions and course lists need the whole calendar, also to tell which
  // listed course has a date ("cursos para la cara")
  const needsCalendar =
    Boolean(result.intent?.wantsDates) ||
    // a product catalog list has nothing to do with course dates
    Boolean(result.intent?.wantsList && !result.intent?.wantsProducts) ||
    (Boolean(result.intent?.wantsCourses) && /^Catalogo resumido/.test(String(result.contextBlock || '')))
  const scheduleBlock = index.blocks.find((block) => {
    if (!/^\[FECHAS_CURSOS\]/im.test(block.body)) return false
    return needsCalendar || queryTokens.some((token) => normalizeText(block.body).includes(token))
  })
  // Only the calendar counts: an [HORARIOS] block is also kind 'schedule' but has no dates
  const hasScheduleBlock = matchedBlocks.some((block: IndexedBlock) => /^\[FECHAS_CURSOS\]/im.test(block.body))
  const completeMatchedBlocks =
    scheduleBlock && !hasScheduleBlock
      ? [...matchedBlocks.slice(0, 3), scheduleBlock]
      : matchedBlocks
  const contextWithCalendar =
    scheduleBlock && !hasScheduleBlock
      ? `${String(result.contextBlock || '').trim()}\n\n[Documento de calendario]\n${scheduleBlock.body}`.trim()
      : result.contextBlock
  const requirementBlock = findRequirementBlockForCourses(index.blocks, matchedBlocks)
  const contextWithRequirements = requirementBlock
    ? `${String(contextWithCalendar || '').trim()}\n\n[Requisitos del curso]\n${requirementBlock.body}`.trim()
    : contextWithCalendar
  const profileBlocks = findBusinessProfileBlocks(index.blocks, completeMatchedBlocks)
  const paymentBlocks = includePayment ? findBusinessPaymentBlocks(index.blocks, completeMatchedBlocks) : []
  // The zone is a business fact like its name: the one in its documents, or the default
  const timeZoneSetting = detectTimeZoneSetting(index)
  const businessFacts = [...profileBlocks.map((block) => block.body), describeTimeZone(timeZoneSetting)].join('\n\n')
  const contextBlock = [
    String(contextWithRequirements || '').trim(),
    `[Datos del negocio]\n${businessFacts}`,
    paymentBlocks.length > 0 && `[Pagos del negocio]\n${paymentBlocks.map((block) => block.body).join('\n\n')}`,
  ].filter(Boolean).join('\n\n').trim()

  return {
    documents: result.documents,
    contextBlock,
    matchedBlocks: [
      ...completeMatchedBlocks.slice(0, 4),
      ...(requirementBlock ? [requirementBlock] : []),
      // the judge checks the answer against the same business data the bot saw
      ...profileBlocks,
      ...paymentBlocks,
    ] as IndexedBlock[],
    // every payment block, also one the search already found
    paymentText: includePayment
      ? findBusinessPaymentBlocks(index.blocks, []).map((block) => block.body).join('\n')
      : '',
    intent: (result.intent || {}) as Record<string, boolean>,
    hasCourses: index.documents.some((document) => document.isActive && document.section === 'cursos'),
    // Same rule the search uses to tell a treatments document (tratamientos.md)
    hasTreatments: index.documents.some((document) => document.isActive && /tratamiento/i.test(document.title)),
    timeZone: timeZoneSetting.zone,
    // the judge must see the same business facts the bot saw, the time zone included
    businessFacts,
  }
}

const COURSE_DATE_MONTHS = new Map([
  ['enero', 1],
  ['febrero', 2],
  ['marzo', 3],
  ['abril', 4],
  ['mayo', 5],
  ['junio', 6],
  ['julio', 7],
  ['agosto', 8],
  ['septiembre', 9],
  ['setiembre', 9],
  ['octubre', 10],
  ['noviembre', 11],
  ['diciembre', 12],
])
const COURSE_QUERY_STOP_WORDS = new Set([
  'curso', 'cursos', 'mas', 'informacion', 'info', 'detalles', 'detalle',
  'precio', 'precios', 'costo', 'fecha', 'fechas', 'disponible', 'disponibles',
  'online', 'presencial', 'modalidad', 'de', 'del', 'la', 'las', 'el', 'los',
  'y', 'con', 'para', 'sobre',
  'bot', 'asesor', 'usuario', 'cliente', 'instituto', 'institute',
  'mexico', 'hermosillo', 'sonora', 'hora', 'horas', 'dias', 'dia', 'hola', 'gracias',
])

type ScheduledCourseDate = {
  day: number
  month: number
  courseName: string
  modality: string
}

function getUpcomingCourseDates(
  question: string,
  matchedBlocks: IndexedBlock[],
  now = new Date(),
  timeZone = DEFAULT_TIME_ZONE,
): ScheduledCourseDate[] {
  const queryTokens = new Set(
    normalizeText(question)
      .split(' ')
      .filter((token) => token.length > 2 && !COURSE_QUERY_STOP_WORDS.has(token)),
  )
  if (!queryTokens.size) return []

  const currentDate = getZonedDateParts(now, timeZone)
  const matchingDates = new Map<string, ScheduledCourseDate>()

  for (const block of matchedBlocks) {
    if (!/^\[FECHAS_CURSOS\]/im.test(block.body)) continue

    let modality = 'programada'
    for (const line of block.body.split(/\r?\n/)) {
      if (/en\s+l[ií]nea|online/i.test(line)) {
        modality = 'en línea'
        continue
      }
      if (/presencial/i.test(line)) {
        modality = 'presencial'
        continue
      }

      const match = /^\s*(?:[✨*•-]\s*)?(\d{1,2})\s+([a-záéíóú]+)\s*[-–:]\s*(.+?)\s*$/i.exec(line)
      if (!match) continue

      const day = Number(match[1])
      const month = COURSE_DATE_MONTHS.get(normalizeText(match[2]))
      if (!month || day < 1 || day > 31) continue

      const courseName = match[3].replace(/[.。]\s*$/, '').trim()
      const courseTokens = normalizeText(courseName)
        .split(' ')
        .filter((token) => token.length > 2 && !COURSE_QUERY_STOP_WORDS.has(token))
      const matchedTokenCount = courseTokens.filter((token) =>
        Array.from(queryTokens).some((queryToken) => queryToken === token || (queryToken.length >= 5 && token.length >= 5 && (token.startsWith(queryToken) || queryToken.startsWith(token)))),
      ).length
      const smallerTokenCount = Math.min(courseTokens.length, queryTokens.size)
      const requiredMatches = Math.min(2, courseTokens.length, queryTokens.size)
      if (matchedTokenCount < requiredMatches || matchedTokenCount / smallerTokenCount < 0.8) continue

      if (month < currentDate.month || (month === currentDate.month && day < currentDate.day)) continue

      const scheduledDate = { day, month, courseName, modality }
      matchingDates.set(`${day}-${month}-${normalizeText(courseName)}-${modality}`, scheduledDate)
    }
  }

  return Array.from(matchingDates.values())
}

export function applyUpcomingCourseDateCorrection(
  answer: string,
  question: string,
  matchedBlocks: IndexedBlock[],
  now = new Date(),
  timeZone = DEFAULT_TIME_ZONE,
) {
  // En mensajes de flujo de pagos autorizados, nunca agregar fechas de cursos arbitrarias
  const isPaymentAnswer =
    /(?:santander|clabe|oxxo|banamex|stripe|paypal)/i.test(answer) &&
    /(?:cuenta|dep[oó]sito|transferencia|comprobante)/i.test(answer)
  if (isPaymentAnswer) return answer

  const upcomingDates = getUpcomingCourseDates(question, matchedBlocks, now, timeZone)
  if (!upcomingDates.length) return answer

  // Agrupar fechas por curso para no mezclar nombres con fechas ajenas
  const datesByCourse = new Map<string, ScheduledCourseDate[]>()
  for (const date of upcomingDates) {
    const list = datesByCourse.get(date.courseName) || []
    list.push(date)
    datesByCourse.set(date.courseName, list)
  }

  const normAnswer = normalizeText(answer)
  // Filtrar solo los cursos que realmente se mencionan en la respuesta o de los que se preguntó
  const relevantCourseEntries = Array.from(datesByCourse.entries()).filter(([cName]) => {
    const normC = normalizeText(cName)
    if (normAnswer.includes(normC)) return true
    const significantTokens = normC.split(' ').filter((t) => t.length > 3 && !COURSE_QUERY_STOP_WORDS.has(t))
    return significantTokens.length > 0 && significantTokens.every((t) => normAnswer.includes(t))
  })
  if (!relevantCourseEntries.length) return answer

  const monthFormatter = new Intl.DateTimeFormat('es-MX', {
    month: 'long',
    timeZone: 'UTC',
  })
  const year = String(getZonedDateParts(now, timeZone).year)

  const corrections = relevantCourseEntries.map(([courseName, dates]) => {
    const dateSummary = dates
      .map((date) => {
        const monthName = monthFormatter.format(new Date(Date.UTC(Number(year), date.month - 1, date.day)))
        return `${date.day} de ${monthName} de ${year} (${date.modality})`
      })
      .join(' y ')
    return dates.length === 1
      ? `La próxima fecha de ${courseName} es el ${dateSummary}.`
      : `Las próximas fechas de ${courseName} son el ${dateSummary}.`
  })

  const paragraphs = answer.split(/\n{2,}/)
  const correctedParagraphs = paragraphs.map((paragraph) => {
    const sentences = paragraph.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [paragraph]
    const retainedSentences = sentences.filter((sentence) => {
      const repeatsAuthoritativeDate = upcomingDates.some((date) => {
        const monthName = monthFormatter.format(new Date(Date.UTC(Number(year), date.month - 1, date.day)))
        const escapedMonth = monthName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        return new RegExp(`\\b(?:el\\s+)?(?:d[ií]a\\s+)?0?${date.day}\\s+(?:de\\s+)?${escapedMonth}\\b`, 'i').test(sentence)
      })
      const mentionsNoSchedule =
        /(?:no\s+(?:hay|tenemos|tiene|contamos con)|sin)\s+(?:ninguna?\s+)?fecha|fecha\s+no\s+programada|no\s+hay\s+fecha|no\s+tenemos\s+fecha|sin\s+fecha\s+programada|actualmente.{0,50}fecha\s+programada/i.test(
          sentence,
        )
      const mentionsPastCourseDate =
        /(?:fecha|convocatoria)\s+pasad[ao]|[uú]ltima\s+convocatoria/i.test(sentence)
      const redirectsForFutureDates =
        /pr[oó]ximas?\s+fechas? disponibles.{0,100}whatsapp/i.test(sentence)
      return !repeatsAuthoritativeDate && !mentionsNoSchedule && !mentionsPastCourseDate && !redirectsForFutureDates
    })
    return retainedSentences.join('').trim()
  })
    .filter(Boolean)

  return [...correctedParagraphs, ...corrections].join('\n\n')
}

const RESPUESTAS_CORTAS_SIN_CONTEXTO = new Set([
  'si', 'sí', 'sii', 'siis', 'siii', 'siiii', 'yes', 'yeah', 'yep', 'dale',
  'no', 'nop', 'nope', 'nel', 'noo', 'nooo',
  'ok', 'okay', 'oki', 'okey', 'vale', 'va', 'listo', 'deacuerdo', 'de acuerdo',
  'perfecto', 'genial', 'excelente', 'bien', 'claro', 'claroquesi', 'claro que si',
  'suena bien', 'me interesa', 'si me interesa', 'sí me interesa', 'me gustaría', 'me gustaria',
  'interesado', 'interesada', 'quiero', 'voy',
  'gracias', 'muchas gracias', 'ty', 'thx',
])

function extraerNombreCursoDeMensaje(texto: string): string[] {
  if (!texto) return []
  const t = String(texto || '')
  const nombres: string[] = []
  const patrones = [
    /curso\s+(?:de\s+)?(?:manej[ao]\s+de\s+)?([A-Za-z\u00C0-\u024F][A-Za-z\u00C0-\u024F\s\-&]{3,60}?)(?:\s*(?:en\s+linea|online|presencial|modalidad|precio|costo|$|\.|\n|,|;|:))/gim,
    /(?:temario|taller|diplomado|capacitacion)\s+(?:de\s+)?([A-Za-z\u00C0-\u024F][A-Za-z\u00C0-\u024F\s\-&]{3,60}?)(?:\s*(?:en\s+linea|online|presencial|modalidad|precio|costo|$|\.|\n|,|;|:))/gim,
  ]
  for (const re of patrones) {
    let m: RegExpExecArray | null
    while ((m = re.exec(t)) !== null) {
      const cand = (m[1] || '').trim().replace(/\s+/g, ' ')
      if (cand.length >= 4) nombres.push(cand)
    }
  }
  const reFicha = /(?:Nombre\s*(?:del\s+curso|curso|del\s+taller|taller|del\s+diplomado|diplomado|de\s+la\s+capacitacion|capacitacion)\s*[:：]\s*)([^\n\r]{3,120})/gim
  let f: RegExpExecArray | null
  while ((f = reFicha.exec(t)) !== null) {
    const cand = (f[1] || '').trim().replace(/\s+/g, ' ').replace(/[.。]\s*$/, '')
    if (cand.length >= 4) nombres.push(cand)
  }
  const unicos: string[] = []
  const vistos = new Set<string>()
  for (const n of nombres) {
    const norm = n.toLowerCase().trim()
    if (!vistos.has(norm) && norm.length >= 4) {
      vistos.add(norm)
      unicos.push(n)
    }
  }
  return unicos
}

const ENROLLMENT_INTEREST_RESPONSES = new Set([
  'si me interesa', 'sí me interesa', 'me interesa', 'si', 'sí', 'sii', 'siii',
  'claro', 'claro que si', 'claro que sí', 'perfecto', 'excelente', 'quiero inscribirme',
  'me quiero inscribir', 'quiero inscripcion', 'quiero inscripción', 'quiero entrar',
])

function normalizeConversationReply(value: string): string {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function buildEnrollmentInterestReply(userMessage: string, history: DbConversationMessage[]): string | null {
  const normalizedReply = normalizeConversationReply(userMessage)
  const isInterestConfirmation =
    ENROLLMENT_INTEREST_RESPONSES.has(normalizedReply) ||
    /^(?:si|claro|perfecto)?\s*(?:me\s+)?(?:interesa|gustaria|interesad[oa])$/.test(normalizedReply)
  if (!isInterestConfirmation) return null

  const lastAssistantMessage = [...(history || [])]
    .reverse()
    .find((message) => message.role === 'assistant' && String(message.content || '').trim())
  if (!lastAssistantMessage) return null

  const askedForEnrollment = /(?:te\s+gustar[ií]a\s+inscribirte|quieres?\s+inscribirte|avanzar\s+con\s+la\s+inscripci[oó]n|datos\s+de\s+inscripci[oó]n)/i
    .test(lastAssistantMessage.content)
  const courseName = extraerNombreCursoDeMensaje(lastAssistantMessage.content)[0]
  if (!askedForEnrollment || !courseName) return null

  return `¡Excelente! Para avanzar con tu inscripción al curso de ${courseName}, ¿te interesa la modalidad online o presencial?`
}

// Words a customer may wrap a bare modality choice in ("la online por favor",
// "prefiero presencial"); anything else means they are asking for something
const MODALITY_CHOICE_FILLER = new Set([
  'online', 'en', 'linea', 'presencial', 'la', 'el', 'modalidad', 'me', 'interesa', 'quiero', 'prefiero',
  'seria', 'mejor', 'gustaria', 'quisiera', 'por', 'favor', 'porfavor', 'si', 'claro', 'ok', 'pues', 'que', 'sea', 'opcion', 'gracias',
])

export function buildEnrollmentModalityReply(userMessage: string, history: DbConversationMessage[]): string | null {
  const normalizedMessage = normalizeConversationReply(userMessage)
  const modality = /\b(online|en linea|presencial)\b/.exec(normalizedMessage)?.[1]
  if (!modality) return null
  // "Mas informacion curso online limpieza facial" asks for information, it does not choose
  if (!normalizedMessage.split(' ').every((word) => MODALITY_CHOICE_FILLER.has(word))) return null

  // Only an answer to the bot asking which modality ("¿te interesa la modalidad
  // online o presencial?"), not to an answer that merely mentions modalities
  const lastAssistantMessage = [...(history || [])]
    .reverse()
    .find((message) => message.role === 'assistant' && String(message.content || '').trim())
  const askedForModality = /¿[^?]*\b(?:online|en\s+l[ií]nea)\s+o\s+presencial\b[^?]*\?|¿[^?]*\bpresencial\s+o\s+(?:online|en\s+l[ií]nea)\b[^?]*\?/i
  if (!lastAssistantMessage || !askedForModality.test(lastAssistantMessage.content)) return null

  const hasLocationAlready =
    (history || []).some((message) =>
      message.role === 'user' &&
      /(?:soy\s+de|vivo\s+en|desde)\s+.+|(?:hermosillo|sonora|mexico|méxico|usa|estados\s+unidos|canad[aá]|espa[nñ]a)/i.test(message.content),
    )
  if (hasLocationAlready) return null

  return `¡Perfecto! Para enviarte los datos de inscripción y las opciones de pago, ¿nos puedes indicar desde qué ciudad o país nos escribes?`
}

function normalizeEnrollmentAnswer(value: string): string {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

export function isAuthorizedEnrollmentFlowAnswer(answer: string, expectedAnswer: string | null): boolean {
  return Boolean(expectedAnswer) && normalizeEnrollmentAnswer(answer) === normalizeEnrollmentAnswer(expectedAnswer || '')
}

// An official phrase is one the business wrote word for word in its own prompt
// ("No estoy capacitado para responder dudas externas a ..."). Short answers do
// not count: any few words could appear somewhere in a long prompt
const MIN_OFFICIAL_PHRASE_CHARS = 60

export function isAuthorizedOutOfScopeAnswer(answer: string, tenantPrompt: string): boolean {
  const normalizedAnswer = normalizeEnrollmentAnswer(answer)
  return (
    normalizedAnswer.length >= MIN_OFFICIAL_PHRASE_CHARS &&
    normalizeEnrollmentAnswer(tenantPrompt).includes(normalizedAnswer)
  )
}

function normalizePaymentPolicy(value: string): string {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '')
}

export function isAuthorizedPaymentFlowAnswer(
  userMessage: string,
  history: DbConversationMessage[],
  answer: string,
  tenantPrompt: string,
): boolean {
  const previousAssistantMessage = [...(history || [])]
    .reverse()
    .find((message) => message.role === 'assistant' && String(message.content || '').trim())
  if (!previousAssistantMessage) return false

  const requestedLocationForPayment =
    /(?:desde\s+qu[eé]\s+(?:ciudad|pa[ií]s)|ciudad\s+o\s+pa[ií]s|opciones?\s+de\s+pago|datos\s+de\s+inscripci[oó]n|formas?\s+de\s+pago|m[eé]todos?\s+de\s+pago)/i
      .test(previousAssistantMessage.content)
  const isLocationReply =
    /(?:soy\s+de|vivo\s+en|desde)\s+.+|(?:hermosillo|sonora|mexico|méxico|usa|estados\s+unidos|canad[aá]|espa[nñ]a|colombia|per[uú]|chile|argentina)/i
      .test(String(userMessage || ''))
  const isPaymentFollowUp =
    /(?:paypal|stripe|m[eé]todo[s]?\s+de\s+pago|forma[s]?\s+de\s+pago|d[oó]nde\s+(?:pago|deposito)|datos\s+de\s+pago|cuenta|banco|tarjeta)/i
      .test(String(userMessage || ''))
  if ((!requestedLocationForPayment && !isPaymentFollowUp) || (!isLocationReply && !isPaymentFollowUp)) return false

  const hasTransferOrBank =
    /(?:dep[oó]sito|transferencia)\s+bancaria|santander|oxxo|banamex|clabe/i.test(answer)
  const hasCardOrOnline =
    /(?:pago\s+con\s+tarjeta(?:\s+v[ií]a\s+stripe)?)|stripe|paypal/i.test(answer)
  const hasClosing =
    /una\s+vez\s+realizado\s+tu\s+pago|enviar?\s+el\s+comprobante|confirmar\s+tu\s+inscripci[oó]n|whatsapp\s+oficial/i.test(answer)
  const hasOfficialPaymentStructure = (hasTransferOrBank || hasCardOrOnline) && hasClosing
  if (!hasOfficialPaymentStructure) return false

  const policy = normalizePaymentPolicy(tenantPrompt)
  const answerUrls = Array.from(answer.matchAll(/https?:\/\/[^\s)\]]+/gi), (match) => match[0])
  // A contact number is not payment data: any business's phone, by the word before it
  const answerWithoutPhones = answer.replace(/(?:whatsapp|tel[eé]fono|celular|\btel\b|contacto|llamar|ll[aá]manos)[^\d\n]{0,20}\+?\d[\d\s().-]{6,}\d/gi, '')
  const answerAccountNumbers = Array.from(answerWithoutPhones.matchAll(/\b(?:\d[\d\s-]{7,}\d)\b/g), (match) => match[0])
  if (!answerUrls.length && !answerAccountNumbers.length) return false

  return [...answerUrls, ...answerAccountNumbers].every((fact) => policy.includes(normalizePaymentPolicy(fact)))
}

const NOT_UNDERSTOOD_MARKER = /\[\s*NO[_\s]ENTEND[IÍ]\s*\]/i
const NO_ANSWER_MARKER = /\[\s*NO[_\s]RESPONDER\s*\]/i

// One wording per attempt, so a second request does not read as a repeated robot line.
// Courses are offered only by tenants with a courses document
function clarificationReplies(hasCourses: boolean) {
  const offer = hasCourses ? 'curso, producto o servicio' : 'producto o servicio'
  return [
    `Disculpa, no logré entender bien tu mensaje. ¿Me lo podrías escribir de otra forma? Cuéntame qué ${offer} te interesa y con gusto te ayudo.`,
    `Perdón, sigo sin entenderte bien. ¿Me podrías decir en pocas palabras qué estás buscando? Por ejemplo, el nombre del ${offer}.`,
  ]
}

const MAX_CLARIFICATIONS = clarificationReplies(true).length

export function isAuthorizedClarificationAnswer(answer: string): boolean {
  return [...clarificationReplies(true), ...clarificationReplies(false)].some(
    (reply) => normalizeEnrollmentAnswer(answer) === normalizeEnrollmentAnswer(reply),
  )
}

// Asks the customer to rephrase, at most MAX_CLARIFICATIONS times in a row;
// after that returns null so a person picks up the conversation
export function buildClarificationReply(history: DbConversationMessage[], hasCourses = true): string | null {
  let consecutive = 0
  for (const message of [...(history || [])].reverse()) {
    if (message.role !== 'assistant') continue
    if (!isAuthorizedClarificationAnswer(String(message.content || ''))) break
    consecutive += 1
  }
  return clarificationReplies(hasCourses)[consecutive] || null
}

// Course, product or treatment information, beyond general blocks (location, FAQ)
export function hasCatalogInformation(retrieval: { contextBlock: string; matchedBlocks: IndexedBlock[] }) {
  return (
    /^Catalogo resumido|BLOQUE: LISTA DE TRATAMIENTOS\]/.test(String(retrieval.contextBlock || '')) ||
    retrieval.matchedBlocks.some((block) => block.document.section !== 'general' || /tratamiento/i.test(block.document.title))
  )
}

const COURTESY_MESSAGE = /^(?:hola|buen[oa]s?(?:\s+(?:d[ií]as|tardes|noches))?|gracias|muchas\s+gracias|ok|okey|vale|adi[oó]s|bye|hasta\s+luego|saludos)[\s.!?¡¿]*$/i

// Only for a real follow-up in a conversation: not a greeting, a "si"/"ok"
// reply or a message that already names what it is about
export function shouldRewriteFollowUp(
  userMessage: string,
  history: DbConversationMessage[],
  messageNamesTopic: boolean,
  retrieval: { contextBlock: string; matchedBlocks: IndexedBlock[] },
) {
  const normalized = normalizeConversationReply(userMessage)
  return (
    !messageNamesTopic &&
    normalized.length > 0 &&
    !RESPUESTAS_CORTAS_SIN_CONTEXTO.has(normalized) &&
    !COURTESY_MESSAGE.test(String(userMessage || '').trim()) &&
    (history || []).some((message) => message.role === 'assistant' && String(message.content || '').trim()) &&
    !hasCatalogInformation(retrieval)
  )
}

const FOLLOW_UP_REWRITE_PROMPT = `Reescribe el último mensaje del cliente como UNA sola pregunta completa que se entienda sin leer la conversación, nombrando el curso, producto, tratamiento o servicio del que se está hablando.
Usa únicamente lo que aparece en la conversación; no agregues datos, precios ni nombres que no estén ahí.
Responde solo con la pregunta reescrita, sin comillas ni explicaciones.`

async function rewriteFollowUpQuestion(args: {
  apiKey: string
  baseUrl: string
  model: string
  fallbackModel: string
  message: string
  history: DbConversationMessage[]
}): Promise<string | null> {
  const conversation = args.history
    .slice(-6)
    .map((message) => `${message.role === 'user' ? 'CLIENTE' : 'ASESOR'}: ${String(message.content || '').slice(0, 600)}`)
    .join('\n')
  const completion = await requestCompletion({
    apiKey: args.apiKey,
    baseUrl: args.baseUrl,
    model: args.model,
    fallbackModel: args.fallbackModel,
    maxTokens: 400,
    messages: [
      { role: 'system', content: FOLLOW_UP_REWRITE_PROMPT },
      { role: 'user', content: `${conversation}\nCLIENTE (último mensaje): ${args.message}` },
    ],
  })
  if (completion.finishReason === 'fallback_models_unavailable') return null

  const question = String(completion.answer || '').split('\n')[0].trim().replace(/^["'«“]+|["'»”]+$/g, '')
  return question && question.length <= 300 ? question : null
}

// The customer's latest earlier question that said what it was about, for a
// follow-up that does not ("¿cuales son los precios?" after "¿tienen cursos en Hermosillo?")
export function findPreviousTopicQuestion(index: SearchIndex, history: DbConversationMessage[]): string | null {
  const earlierQuestions = (history || [])
    .filter((message) => message.role === 'user' && String(message.content || '').trim())
    .slice(-4)
    .reverse()
  return earlierQuestions.find((message) => namesKnownTopic(index, message.content))?.content.trim() || null
}

// What the ad was about, for the search: its title and product, without the
// instructions written for the model ("Usa su ID y titulo para buscar..."),
// whose words would be taken for item names
export function adSearchText(referralContext: string): string {
  const facts = String(referralContext || '').split(/:\s/).pop() || ''
  return facts
    .split('·')
    .map((fact) => fact.trim())
    .filter((fact) => fact && !/^ID de anuncio\b/i.test(fact))
    .map((fact) => fact.replace(/^(?:anuncio|producto|referencia)\s+/i, ''))
    .join(' ')
    // bare numbers are the ad's own numbering ("Revofil 1026"), not part of a product name
    .replace(/(?:^|\s)\d+(?=\s|$)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function buildEnhancedQuery(
  userMessage: string,
  history: DbConversationMessage[],
  previousTopicQuestion: string | null = null,
): string {
  const normalizedMsg = (userMessage || '').replace(/\s+/g, ' ').trim()
  const recent = (history || []).slice(-8)
  const msgWords = normalizedMsg.split(/\s+/).filter((w) => w.length >= 2)
  const msgLowerSimple = normalizedMsg.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
  const esConfirmacionDeInteres =
    /^(?:si|sí|claro|perfecto)?\s*(?:me\s+)?(?:interesa|gustar[ií]a|interesad[oa])$/.test(msgLowerSimple)
  const isLocationReply =
    /(?:soy\s+de|vivo\s+en|desde)\s+.+|(?:hermosillo|sonora|mexico|méxico|usa|estados\s+unidos|canad[aá]|espa[nñ]a|colombia|per[uú]|chile|argentina)/i
      .test(normalizedMsg)
  const previousAssistantMessage = [...recent]
    .reverse()
    .find((m) => m.role === 'assistant' && String(m.content || '').trim())
  const previousAskedLocationOrPayment = previousAssistantMessage
    ? /(?:desde\s+qu[eé]\s+(?:ciudad|pa[ií]s)|ciudad\s+o\s+pa[ií]s|opciones?\s+de\s+pago|datos\s+de\s+inscripci[oó]n|formas?\s+de\s+pago|m[eé]todos?\s+de\s+pago)/i
        .test(previousAssistantMessage.content)
    : false
  const esRespuestaCorta =
    (msgWords.length <= 4 && (RESPUESTAS_CORTAS_SIN_CONTEXTO.has(msgLowerSimple) || esConfirmacionDeInteres)) ||
    (isLocationReply && previousAskedLocationOrPayment)

  // A follow-up that names nothing is searched together with the question it follows
  if (previousTopicQuestion && !esRespuestaCorta) {
    return `${previousTopicQuestion}\n${normalizedMsg}`
  }

  if (msgWords.length >= 3 && !esRespuestaCorta) return `${normalizedMsg}`

  const ultimosMensajesAsesor = recent
    .filter((m) => m.role === 'assistant')
    .slice(-3)
    .map((m) => String(m.content || ''))

  let pistasAdicionales = ''
  if (esRespuestaCorta && ultimosMensajesAsesor.length > 0) {
    const candidatosCurso: string[] = []
    for (const t of ultimosMensajesAsesor) candidatosCurso.push(...extraerNombreCursoDeMensaje(t))
    if (candidatosCurso.length > 0) {
      pistasAdicionales = ` [CONTEXTO RESPUESTA CORTA: el usuario está confirmando interés en el/los siguiente(s) curso(s) mencionados por el asesor en los mensajes anteriores: ${candidatosCurso.join(' | ')}. INCLUYE ESTOS NOMBRES EN LA BÚSQUEDA RAG COMO PALABRAS CLAVE PRINCIPALES, con prioridad MUY ALTA.]`
    } else {
      pistasAdicionales = ` [CONTEXTO RESPUESTA CORTA: el usuario está confirmando interés sobre el tema que el asesor acaba de explicar. Prioriza los documentos que aparecen en los siguientes mensajes del asesor del historial, y NO busques cursos aleatorios.]`
    }
  }

  const context = recent.map((m) => `${m.role === 'user' ? 'USUARIO' : 'ASESOR'}: ${m.content}`).join('\n')
  if (!context) return `${normalizedMsg}${pistasAdicionales}`
  let combined = `${context}\nUSUARIO ACTUAL: ${normalizedMsg}${pistasAdicionales}`
  if (combined.length > 1500) {
    const tail = 1500 - pistasAdicionales.length
    combined = context.slice(Math.max(0, context.length - tail)) + `\nUSUARIO ACTUAL: ${normalizedMsg}${pistasAdicionales}`
  }
  return `${combined}`
}

function buildPaymentFlowGuard(userMessage: string, history: DbConversationMessage[]): string {
  const current = String(userMessage || '').trim().toLowerCase()
  const recentText = (history || []).slice(-10).map((m) => String(m.content || '')).join('\n').toLowerCase()
  const isInternationalLocation =
    /^(?:usa|eeuu|u\.s\.a\.|estados unidos|united states|canad[aá]|espa[nñ]a|argentina|chile|colombia|per[uú]|otro pa[ií]s)\.?$/i.test(current)
  const isMexicoLocation =
    /^(?:hermosillo|sonora|m[eé]xico|cdmx|guadalajara|monterrey|puebla|tijuana|culiac[aá]n|mazatl[aá]n|nogales|obreg[oó]n|mexicali|quer[eé]taro|m[eé]rida|canc[uú]n|le[oó]n|toluca|chihuahua|ju[aá]rez|veracruz|acapulco|cuernavaca|saltillo|tampico|morelia|san luis potos[ií]|aguascalientes|zacatecas|durango|villahermosa|oaxaca|tuxtla|campeche|chetumal|pachuca|colima|tepic|la paz|tlaxcala)\.?$/i.test(current) ||
    /^(?:soy\s+de|vivo\s+en|desde)\s+.+/i.test(current)
  const isPaymentFollowUp = /(?:paypal|stripe|m[eé]todo[s]?\s+de\s+pago|forma[s]?\s+de\s+pago|d[oó]nde\s+(?:pago|deposito)|datos\s+de\s+pago|cuenta)/i.test(current)
  const paymentConversation =
    /(?:desde\s+qu[eé]\s+(?:pa[ií]s|ciudad)|de\s+qu[eé]\s+(?:pa[ií]s|ciudad)|m[eé]todo[s]?\s+de\s+pago|forma[s]?\s+de\s+pago|datos\s+de\s+inscripci[oó]n)/i.test(recentText) &&
    /(?:me\s+interesa|interesa|inscrib|curso|pago|paypal|stripe|cuenta|apartado)/i.test(recentText)

  if (!((isInternationalLocation || isMexicoLocation || isPaymentFollowUp) && paymentConversation)) return ''

  // The accounts, links and rules per location or modality are the business's own:
  // they come from its prompt or documents, never from here
  return `\n\n=== CONTROL DETERMINISTA DEL FLUJO DE PAGOS ===
La conversación ya está dentro del flujo de inscripción o compra. No respondas con frases de falta de información, no derives al contacto por no encontrar un bloque de documentos y no reinicies la conversación preguntando si busca cursos o productos.
Entrega los métodos de pago que el prompt del negocio o el bloque [Pagos del negocio] indiquen para la ubicación que confirmó el cliente (y para la modalidad, si el negocio distingue presencial y en línea), copiando cuentas, montos y enlaces tal como están escritos ahí, sin agregar métodos que no correspondan a ese caso.
Nunca inventes cuentas, precios ni enlaces. Si el negocio indica cómo enviar el comprobante, cierra pidiéndolo por ese medio con los datos que solicite.
Cuando el cliente ya envió su comprobante y faltan sus datos, solicita siempre nombre completo, correo electrónico y número de teléfono con WhatsApp (los tres, solo los que falten).
=== FIN CONTROL DETERMINISTA DEL FLUJO DE PAGOS ===`
}

export async function generateDbAgentAnswer(input: DbChatInput, opts: GenAnswerOpts = {}) {
  const apiKey = getConfiguredApiKey()
  const baseUrl = getConfiguredBaseUrl()
  const model = getConfiguredModel()
  const fallbackModel = getConfiguredFallbackModel()
  const maxTokens = getConfiguredMaxTokens()

  if (!apiKey) {
    throw new Error('LLM_API_KEY no esta configurada')
  }

  const index = await getDbTenantSearchIndex(input.tenantId)
  const includePayment = isPaymentConversation(input.message, input.history || [])
  const messageNamesTopic = namesKnownTopic(index, input.message)
  // A message that names nothing ("¿precio?") is about the previous question or,
  // for a customer who came from an ad, about what the ad showed
  const previousTopicQuestion = messageNamesTopic
    ? null
    : findPreviousTopicQuestion(index, input.history || []) || keepDocumentWords(index, adSearchText(input.referralContext || '')) || null
  let retrievalQuery = buildEnhancedQuery(input.message, input.history || [], previousTopicQuestion)
  let retrieval = buildDbDocumentsContextBlock(index, retrievalQuery, includePayment)

  // The rules found no course, product or treatment for a follow-up: the model
  // rewrites it as a full question from the conversation and it is searched again
  if (shouldRewriteFollowUp(input.message, input.history || [], messageNamesTopic, retrieval)) {
    const rewritten = await rewriteFollowUpQuestion({ apiKey, baseUrl, model, fallbackModel, message: input.message, history: input.history || [] })
    if (rewritten) {
      const retry = buildDbDocumentsContextBlock(index, rewritten, includePayment)
      if (hasCatalogInformation(retry)) {
        retrievalQuery = rewritten
        retrieval = retry
      }
    }
  }
  const { documents, contextBlock, matchedBlocks, hasCourses, hasTreatments, paymentText, timeZone, businessFacts } = retrieval

  const generalDocText = (documents || []).map((d: any) => {
    const s = (d?.section || '').toLowerCase()
    if (s === 'general' || s === 'infogeneral' || s === 'info_general' || /general|empresa|nosotros|contacto|ubicaci[oó]n/.test(d?.title || '')) return `${d.title || ''}\n${d.body || ''}`
    return ''
  }).filter(Boolean).join('\n')
  // Extraemos marca (whatsapp / empresa) solo por si el provider falla; NO inyectamos nada en la respuesta normal.
  void extractTenantBrandTokens(input.prompt || '', generalDocText)

  // ===== LOGS TEMPORALES PARA DEBUG ===== (quitar cuando todo funcione)
  try {
    // eslint-disable-next-line no-console
    console.error('[generateDbAgentAnswer] DEBUG:', {
      tenantId: input.tenantId,
      retrievalQuery,
      inputMessage: (input.message || '').slice(0, 200),
      model,
      fallbackModel,
      baseUrl,
      documentsCount: documents?.length || 0,
      matchedBlocksCount: matchedBlocks?.length || 0,
      contextBlockChars: (contextBlock || '').length,
      promptTenantChars: (input.prompt || '').length,
      promptTenantPreview: (input.prompt || '').slice(0, 500),
      contextBlockPreview: (contextBlock || '').slice(0, 1200),
    })
  } catch (_e) { /* no-op */ }

  const trimmedHistory = input.history.slice(-12)
  const paymentFlowGuard = buildPaymentFlowGuard(input.message, input.history || [])
  const systemPrompt = buildSystemPrompt(input.prompt, contextBlock, input.referralContext || '', hasTreatments, timeZone) + paymentFlowGuard
  const messages = [
    { role: 'system' as const, content: systemPrompt },
    ...trimmedHistory.map((m) => ({ role: (m.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant', content: String(m.content || '') })),
    { role: 'user' as const, content: input.message },
  ]

  const enrollmentReply =
    buildEnrollmentModalityReply(input.message, input.history || []) ||
    buildEnrollmentInterestReply(input.message, input.history || [])
  const completion = enrollmentReply
    ? {
        answer: enrollmentReply,
        finishReason: 'enrollment-interest-flow',
        modelUsed: 'deterministic-enrollment-flow',
      }
    : await requestCompletion({
        apiKey,
        baseUrl,
        model,
        fallbackModel,
        maxTokens,
        messages,
      })

  // ===== LOG TEMPORAL respuesta cruda =====
  try {
    // eslint-disable-next-line no-console
    console.error('[generateDbAgentAnswer] LLM crudo:', {
      finishReason: completion.finishReason,
      modelUsed: (completion as any).modelUsed,
      rawAnswerChars: (completion.answer || '').length,
      rawAnswerPreview: (completion.answer || '').slice(0, 1400),
    })
  } catch (_e) { /* no-op */ }

  let answer = String(completion.answer || '')
    .replace(/SIMBOLO_DOLAR/g, '$')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  if (!answer) {
    // Respuesta vacía del modelo → fallback educado multi-tenant (sin menciones a IA/modelos)
    answer =
      'Por el momento tenemos dificultades técnicas temporales. Por favor contáctanos por WhatsApp y un asesor humano te atenderá de inmediato. ¡Gracias por tu comprensión!'
  }

  // The model's markers are never sent as text: a message it could not
  // understand gets a request to rephrase, a missing answer is always blocked.
  // Both are decided here, without the judge.
  let markerEval: { category: AutoEvalCategory; reason: string } | null = null
  if (NOT_UNDERSTOOD_MARKER.test(answer)) {
    const clarification = buildClarificationReply(input.history || [], hasCourses)
    if (clarification) {
      answer = clarification
      markerEval = {
        category: 'correct',
        reason: 'El modelo no entendió el mensaje del cliente; se le pide que lo escriba de otra forma con la plantilla autorizada.',
      }
    } else {
      answer = '[NO_RESPONDER]'
      markerEval = {
        category: 'noinfo',
        reason: `El cliente ya recibió ${MAX_CLARIFICATIONS} pedidos seguidos de aclaración y el mensaje sigue sin entenderse; lo atiende una persona.`,
      }
    }
  } else if (NO_ANSWER_MARKER.test(answer)) {
    answer = '[NO_RESPONDER]'
    markerEval = {
      category: 'noinfo',
      reason: 'El modelo respondió [NO_RESPONDER]: entendió la pregunta pero la información no está en los documentos.',
    }
  }

  if (!markerEval && opts.autocuratorEnabled !== false) {
    answer = applyUpcomingCourseDateCorrection(answer, retrievalQuery, matchedBlocks, new Date(), timeZone)
  }

  // ===== AUTO-CURADO · JUEZ SÍNCRONO (último filtro, antes de devolver respuesta) =====
  const matchedBlocksForJudge = matchedBlocks || []
  // A treatment list or catalog summary covers every item, more than the top
  // blocks: the judge checks the answer against the same text the bot saw
  const contextText = String(contextBlock || '')
  const matchedBlocksText = /^Catalogo resumido|BLOQUE: LISTA DE TRATAMIENTOS\]/.test(contextText)
    ? contextText
    : `${matchedBlocksToText(matchedBlocksForJudge)}\n\n---\n\n[Datos del negocio]\n${businessFacts}`.trim()
  const matchedBlockRefs = matchedBlocksToRefs(matchedBlocksForJudge)

  let evalCategory: AutoEvalCategory = 'correct'
  let evalReason = ''
  let evalId = ''
  if (markerEval) {
    evalCategory = markerEval.category
    evalReason = markerEval.reason
  } else {
    try {
      const judgeRes = await runAutocuratorJudge({
        apiKey,
        baseUrl,
        model,
        fallbackModel,
        maxTokens,
        tenantPrompt: input.prompt,
        userQuestion: input.message,
        conversationContext: (input.history || []).slice(-8).map((m) => `${m.role === 'user' ? 'CLIENTE' : 'ASESOR'}: ${String(m.content || '').slice(0, 700)}`).join('\n').slice(-5000),
        referralContext: input.referralContext || '',
        botAnswer: answer,
        matchedBlocksText,
        timeZone,
      })
      evalCategory = judgeRes.category
      evalReason = judgeRes.reason
    } catch (e: any) {
      const q = (input.message || '').trim()
      const qLower = q.toLowerCase()
      const a = (answer || '').trim()
      const aLower = a.toLowerCase()
      const ragCount = (matchedBlocksForJudge || []).length

      const esSoloSaludo = /^(hola|buen[oa]s?(\s*(d[ií]as|tardes|noches))?|gracias|de\s*nada|ok|vale|bye|adi[oó]s|si|s[íi]|no|claro|quiz[áa]s|muchas\s+gracias)$/.test(qLower)
      const esSoloCierre = /^(hasta luego|nos vemos|excelente\s*d[ií]a|cu[eé]ntame\s*luego|ok\s*gracias|gracias\s*,?\s*(bye|adi[oó]s)|de\s*nada\s*,?\s*(bye|adi|ok|claro))\s*[.!?]*$/i.test(qLower)

      const tieneDatoSospechoso = /(\$|precio|fecha|disponible|stock|mxn|usd|d[ií]a\s*\d+|sep[^t]|ago|oct|nov|dic|enero|febrero|marzo|abril|mayo|junio|julio)/i.test(aLower)

      const contradiceRagTeniendoDocs =
        ragCount >= 1 &&
        (/(?:no\s*(?:tengo|cuento|dispon(?:go|emos)?)|no\s+hay\s+(?:informaci[oó]n|datos|registros)|no\s*pod(?:emos|emos)\s+(?:ayudar|decir|responder|atender)|dificultades\s*t[eé]cnicas|problemas\s*t[eé]cnicos)/i.test(aLower) ||
          /cont[áa]cten?(?:os)?\s*(?:al|a\s+l[oa]s?)\s*whatsapp|whatsapp\s*(?:de|por|directo|inmediato)/i.test(aLower))

      const derivaWhatsAppSinInfo =
        !esSoloSaludo &&
        /(?:whatsapp|wa\.me|\+?\d[\d\s\-\.\(\)]{8,}\d)/i.test(aLower) &&
        !(
          /(?:direcci[oó]n|ubicaci[oó]n|curso|tratamiento|producto|servicio|precio|fecha|horario|costo|promoci[oó]n|paquete|cita|reserva|informaci[oó]n\s*(?:del|de\s+el?\s+|acerca\s*de))/i.test(aLower) ||
            /(?:dudas|m[áa]s\s+informaci[oó]n|detalles|alguna\s+otra\s+duda|quieres\s+mas\s+info|necesitas\s+(?:algo\s+)?m[aá]s)/i.test(aLower)
        )

      const esAclaracion = !tieneDatoSospechoso && !contradiceRagTeniendoDocs && !derivaWhatsAppSinInfo && a.length < 320 &&
        (a.includes('¿') || a.includes('?')) &&
        /^(con\s*gusto|claro|por\s*supuesto|c[uú]al\s*(?:es\s*el|de\s+el|es\s*tu|de\s+tu|es\s*esta|de\s*esta)?|qu[eé]\s*(?:curso|producto|servicio|fecha|precio|informaci[oó]n)|te\s*refer[ií]a\s+a\s+(?:qu[eé]|cu[aá]l)|(?:a\s+qu[eé]|sobre\s+qu[eé])\s+(?:te\s+)?refieres?)/i.test(aLower)

      const esCortesiaPura =
        !tieneDatoSospechoso &&
        !contradiceRagTeniendoDocs &&
        !derivaWhatsAppSinInfo &&
        a.length < 380 &&
        /(de nada|fue un placer|con gusto|nos\s+alegra|excelente d[ií]a|hasta luego|un gusto|placer ayudarte|gracias a (?:ti|ustedes?)|cuenta\s+con\s+nosotros)/i.test(aLower)

      const puedeAprobarPorHeuristica =
        (esSoloSaludo || esSoloCierre || esAclaracion || esCortesiaPura) &&
        !contradiceRagTeniendoDocs &&
        !derivaWhatsAppSinInfo

      if (puedeAprobarPorHeuristica) {
        evalCategory = 'correct'
        const tags = [esSoloSaludo && 'saludo', esSoloCierre && 'cierre', esAclaracion && 'aclaracion', esCortesiaPura && 'cortesia'].filter(Boolean)
        evalReason = `Juez falló pero respuesta aprobada por heurística (${tags.join('/') || 'segura'}). Error original: ${e?.message || String(e)}`.slice(0, 600)
      } else {
        evalCategory = 'judge_failed'
        const tags = [
          contradiceRagTeniendoDocs && `contradice-RAG-${ragCount}`,
          derivaWhatsAppSinInfo && 'deriva-WA-sin-info',
          tieneDatoSospechoso && 'datos-sospechosos',
        ].filter(Boolean)
        evalReason = `Bloqueado por fail-closed (judge_failed${tags.length ? ' · ' + tags.join(' · ') : ''}). Error original: ${e?.message || String(e || 'error desconocido')}`.slice(0, 600)
      }
    }
  }

  // Accounts and links are authorized when the business wrote them in its prompt
  // or in its general documents' payment blocks
  if (isAuthorizedPaymentFlowAnswer(input.message, input.history || [], answer, `${input.prompt}\n${paymentText}`)) {
    evalCategory = 'correct'
    evalReason = 'La respuesta de pago sigue el flujo de inscripción y sus enlaces y datos coinciden con el prompt autorizado.'
  }

  if (opts.autocuratorEnabled !== false && matchedBlocksForJudge.length === 0 && NO_INFORMATION_PHRASE.test(answer)) {
    evalCategory = 'noinfo'
    evalReason = 'La respuesta reconoce que no hay información respaldada por documentos.'
  }

  if (opts.autocuratorEnabled !== false && isAuthorizedEnrollmentFlowAnswer(answer, enrollmentReply)) {
    evalCategory = 'correct'
    evalReason = 'La respuesta pertenece al flujo determinista de inscripción y coincide con la plantilla autorizada.'
  }

  if (opts.autocuratorEnabled !== false && isAuthorizedOutOfScopeAnswer(answer, input.prompt)) {
    evalCategory = 'correct'
    evalReason = 'La respuesta coincide palabra por palabra con una frase oficial escrita en el prompt del negocio.'
  }

  const blocked = evalCategory !== 'correct'

  if (opts.autocuratorEnabled !== false) {
    // Guardamos la evaluación siempre (tanto si pasa como si se bloquea) para auditoría
    try {
      const savedEval = await createAutoEval(input.tenantId, {
        psid: input.psid,
        triggerMessageId: input.triggerMessageId,
        botMessageId: input.botMessageId,
        triggerMessageText: input.message,
        botAnswerText: answer,
        category: evalCategory,
        judgeReason: evalReason,
        matchedBlocks: matchedBlockRefs,
      })
      evalId = savedEval.id
    } catch (_e) {
      // Si falla el guardado, no propagamos el error al flujo principal, pero conservamos la decisión.
    }
  }

  const autoEval: AutoEvalResult = {
    id: evalId,
    category: opts.autocuratorEnabled === false ? 'correct' : evalCategory,
    judgeReason: evalReason,
    blocked: opts.autocuratorEnabled === false ? false : blocked,
  }

  return {
    answer,
    sources: documents.map((document) => ({
      id: document.id,
      title: document.title,
      section: document.section,
      isActive: document.isActive,
    })),
    autoEval,
  }
}
