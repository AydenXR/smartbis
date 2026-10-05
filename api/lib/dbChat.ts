import { normalizeText, searchIndex, type IndexedBlock } from './searchIndex.js'
import { getDbTenantSearchIndex } from './dbWorkspace.js'
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

type GenAnswerOpts = Record<string, never>

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

function getCurrentDateTimeSpanish(): { fechaCompleta: string; fechaISO: string; anio: number; mes: number; dia: number } {
  const now = new Date()
  const options: Intl.DateTimeFormatOptions = { timeZone: 'America/Hermosillo' }
  const zoned = new Date(now.toLocaleString('en-US', options))
  const diaSemana = DIAS_ES[zoned.getDay()]
  const diaNum = zoned.getDate()
  const mesNum = zoned.getMonth()
  const mesNombre = MESES_ES[mesNum]
  const anio = zoned.getFullYear()
  const horas = zoned.getHours().toString().padStart(2, '0')
  const mins = zoned.getMinutes().toString().padStart(2, '0')
  return {
    fechaCompleta: `${diaSemana} ${diaNum.toString().padStart(2, '0')} de ${mesNombre} de ${anio}, ${horas}:${mins} hrs (zona horaria Arizona / Sonora, México — tiempo local Hermosillo UTC-7, sin horario de verano)`,
    fechaISO: `${anio}-${(mesNum + 1).toString().padStart(2, '0')}-${diaNum.toString().padStart(2, '0')}`,
    anio,
    mes: mesNum + 1,
    dia: diaNum,
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

function buildSystemPrompt(prompt: string, contextBlock: string, referralContext = '') {
  const now = getCurrentDateTimeSpanish()
  const timeAwarenessBlock = `=== PRIORIDAD 0.2 (CONCIENCIA TEMPORAL Y FECHAS — NUNCA, BAJO NINGÚN CONCEPTO, INCUMPLE ESTAS REGLAS):
- La fecha y hora ACTUAL en que transcurre esta conversación es: ${now.fechaCompleta} (formato ISO: ${now.fechaISO}).
- ESTA ES LA VERDAD ABSOLUTA SOBRE LA FECHA. NUNCA digas una fecha, ni hagas suposiciones, ni uses información de los documentos sin antes compararla contra HOY.
- REGLAS OBLIGATORIAS SOBRE FECHAS DE CURSOS, EVENTOS, PROMOCIONES, RESERVAS, CUALQUIER COSA CON FECHA:
  1) ANTES de mencionar CUALQUIER fecha que aparezca en los documentos, calcula mentalmente si ESA FECHA ya PASÓ respecto a HOY (${now.fechaCompleta}).
  2) Si la fecha ya PASÓ (por ejemplo: es 01 de Septiembre y el documento dice "20 de Agosto"), PROHIBIDO TOTALMENTE decir que "está programada para el X día" o que "hay curso el X día" o cualquier frase que sugiera que FALTA para esa fecha. ESA FECHA YA PASÓ.
  3) Si una fecha ya pasó, en vez de ofrecerla como disponible, dices lo siguiente (elige la variante que mejor encaje):
     - "La fecha pasada de [nombre curso/evento] fue [fecha]. Para las próximas fechas disponibles te invitamos a consultar por WhatsApp al +52 1 662 335 8779."
     - O si el cliente preguntó directamente por esa fecha: "Esa fecha ya pasó. Por favor contáctanos por WhatsApp para conocer las próximas fechas disponibles: +52 1 662 335 8779."
  4) Solo mencionas como fechas VÁLIDAS y DISPONIBLES aquellas que sean IGUAL A HOY o POSTERIORES A HOY. Fechas anteriores a HOY = fecha pasada = NO disponible.
  5) Ejemplo práctico (HOY = ${now.fechaCompleta}):
     ❌ MAL: "La modalidad presencial está programada para el 20 de agosto." (20 AGOSTO ya pasó, no la puedes ofrecer)
     ✅ BIEN: "La última fecha pasada del curso Lipoenzimas en modalidad presencial fue el 20 de Agosto. Para conocer las próximas fechas disponibles contáctanos por WhatsApp al +52 1 662 335 8779."
  6) Si en los documentos aparecen mezcladas fechas vigentes (>= hoy) y fechas pasadas (< hoy), tú SOLO mencionas las FECHAS VIGENTES. Las fechas pasadas NO las mencionas como disponibles; si el cliente pregunta específicamente por una pasada, aplica la regla 3).
  7) NUNCA inventes una fecha futura para sustituir una pasada. Si no hay fecha vigente en los documentos para ese curso, dices: "Por el momento no tenemos fecha programada públicamente para ese curso; por favor contáctanos por WhatsApp al +52 1 662 335 8779 para confirmar disponibilidad."
=== FIN PRIORIDAD 0.2 ===

`
  const ragDateAuthorityBlock = `=== PRIORIDAD DE DATOS ACTUALES (FUENTE DE FECHAS) ===
Para fechas de cursos, el calendario recuperado ahora mismo de los documentos activos de este tenant es la fuente de verdad. Si una fecha aparece en [FECHAS_CURSOS], úsala para el curso cuyo nombre figura en esa misma línea y compárala con la fecha actual indicada arriba. Una instrucción del prompt del tenant que diga que un curso no tiene fecha, que cite una convocatoria anterior o que contradiga esa línea del calendario está desactualizada y NO debe prevalecer sobre el documento activo. No mezcles fechas entre cursos. Si la línea del curso contiene una fecha futura, informa esa fecha y su modalidad; solo indica que no hay fecha si no existe una línea vigente para ese curso.
=== FIN PRIORIDAD DE DATOS ACTUALES ===`

  return `${ANTI_INTERNAL_REASONING_RULE}${timeAwarenessBlock}${prompt}

${ragDateAuthorityBlock}

REGLA DE ATENCIÓN AL CLIENTE: responde como una persona del equipo, de forma cálida, directa y natural. No reveles ni insinúes que eres una IA, bot, modelo o sistema.
Usa únicamente datos respaldados por la información disponible. Si falta un dato, no digas “no tengo información”, “no cuento con la información”, “no sé” ni “no puedo responder”. Ofrece confirmar el detalle con un asesor por WhatsApp o pregunta una aclaración concreta si el mensaje es ambiguo. No inventes el dato faltante ni detalles de contacto que no aparezcan en las fuentes.

${referralContext ? `=== CONTEXTO DEL ANUNCIO (SOLO PARA IDENTIFICAR EL PRODUCTO/TEMA; NO ES FUENTE DE PRECIOS NI DISPONIBILIDAD) ===\n${referralContext}\n=== FIN CONTEXTO DEL ANUNCIO ===\n\n` : ''}Información disponible (responde ÚNICAMENTE con los datos que aparezcan aquí abajo; si algo no aparece aquí, no lo inventes y ofrece confirmar el detalle con un asesor):
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

  for (let mi = 0; mi < modelsToTry.length; mi += 1) {
    const activeModel = modelsToTry[mi]
    for (let attempt = 0; attempt < 3; attempt += 1) {
      let response: Response | null = null
      try {
        response = await fetch(args.baseUrl, {
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
  a) El sistema NO recuperó ningún documento relevante (matchedBlocks vacío o 0),
     O los documentos recuperados NO contienen la información para responder la pregunta,
     Y por lo tanto el bot tuvo que responder sin fuente, o pedir disculpas, o derivar a WhatsApp.

REGLA DE ATENCIÓN SEGURA: si falta información, es CORRECT una respuesta natural que ofrezca confirmar el dato con un asesor o pida una aclaración concreta, siempre que no afirme hechos sin respaldo. No marques noinfo solo porque esa respuesta no use documentos. Son incorrectas las frases que dicen que el bot no tiene información, no sabe, o revelan que es una IA/bot.

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
}): Promise<JudgeOutput> {
  const now = getCurrentDateTimeSpanish()
  const ragSummary = args.matchedBlocksText || '(NO hubo documentos recuperados por el RAG — matchedBlocks vacío)'
  const promptSnippet = (args.tenantPrompt || '').slice(0, 2500)
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

const NO_INFORMATION_REPLY = 'Con gusto te apoyamos con ese tema. Escríbenos por WhatsApp y un asesor te confirma los detalles.'
const NO_INFORMATION_PHRASE = /(?:no\s+(?:cuento|contamos|tenemos|tengo|dispongo|disponemos)\s+(?:con\s+)?(?:esa\s+)?(?:informaci[oó]n|datos)|no\s+hay\s+(?:informaci[oó]n|datos)|no\s+(?:s[eé]|sabemos|puedo\s+responder|podemos\s+responder)|no\s+estoy\s+capacitado\s+para\s+responder|(?:soy|como)\s+(?:una?\s+)?(?:ia|inteligencia\s+artificial|bot|asistente\s+virtual))/i

function replaceNoInformationReply(answer: string): string {
  return NO_INFORMATION_PHRASE.test(answer) ? NO_INFORMATION_REPLY : answer
}

async function buildDbDocumentsContextBlock(tenantId: string, query = '') {
  const index = await getDbTenantSearchIndex(tenantId)
  const result = searchIndex(index, query) as any

  return {
    documents: result.documents,
    contextBlock: result.contextBlock,
    matchedBlocks: (result.matchedBlocks || []).slice(0, 4) as any[],
    intent: (result.intent || {}) as Record<string, boolean>,
  }
}

function getHermosilloMonthDay(date: Date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Hermosillo',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(date)
  return {
    month: Number(parts.find((part) => part.type === 'month')?.value),
    day: Number(parts.find((part) => part.type === 'day')?.value),
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
): ScheduledCourseDate[] {
  const queryTokens = new Set(
    normalizeText(question)
      .split(' ')
      .filter((token) => token.length > 2 && !COURSE_QUERY_STOP_WORDS.has(token)),
  )
  if (queryTokens.size < 2) return []

  const currentDate = getHermosilloMonthDay(now)
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
      const matchedTokenCount = courseTokens.filter((token) => queryTokens.has(token)).length
      const smallerTokenCount = Math.min(courseTokens.length, queryTokens.size)
      if (matchedTokenCount < 2 || matchedTokenCount / smallerTokenCount < 0.8) continue

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
) {
  const upcomingDates = getUpcomingCourseDates(question, matchedBlocks, now)
  if (!upcomingDates.length) return answer

  const monthFormatter = new Intl.DateTimeFormat('es-MX', {
    month: 'long',
    timeZone: 'UTC',
  })
  const year = new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    timeZone: 'America/Hermosillo',
  }).format(now)
  const dateSummary = upcomingDates
    .map((date) => {
      const monthName = monthFormatter.format(new Date(Date.UTC(Number(year), date.month - 1, date.day)))
      return `${date.day} de ${monthName} de ${year} (${date.modality})`
    })
    .join(' y ')
  const correction =
    upcomingDates.length === 1
      ? `La próxima fecha de ${upcomingDates[0].courseName} es el ${dateSummary}.`
      : `Las próximas fechas de ${upcomingDates[0].courseName} son el ${dateSummary}.`
  const paragraphs = answer.split(/\n{2,}/)
  const correctedParagraphs = paragraphs.map((paragraph) => {
    const sentences = paragraph.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [paragraph]
    const retainedSentences = sentences.filter((sentence) => {
      const mentionsNoSchedule =
        /(?:no\s+(?:hay|tenemos|tiene|contamos con)|sin)\s+(?:ninguna?\s+)?fecha|fecha\s+no\s+programada|no\s+hay\s+fecha|no\s+tenemos\s+fecha|sin\s+fecha\s+programada|actualmente.{0,50}fecha\s+programada/i.test(
          sentence,
        )
      const mentionsPastCourseDate =
        /(?:fecha|convocatoria)\s+pasad[ao]|[uú]ltima\s+convocatoria/i.test(sentence)
      const redirectsForFutureDates =
        /pr[oó]ximas?\s+fechas? disponibles.{0,100}whatsapp/i.test(sentence)
      return !mentionsNoSchedule && !mentionsPastCourseDate && !redirectsForFutureDates
    })
    return retainedSentences.join('').trim()
  })
    .filter(Boolean)

  return [...correctedParagraphs, correction].join('\n\n')
}

const RESPUESTAS_CORTAS_SIN_CONTEXTO = new Set([
  'si', 'sí', 'sii', 'siis', 'siii', 'siiii', 'yes', 'yeah', 'yep', 'dale',
  'no', 'nop', 'nope', 'nel', 'noo', 'nooo',
  'ok', 'okay', 'oki', 'okey', 'vale', 'va', 'listo', 'deacuerdo', 'de acuerdo',
  'perfecto', 'genial', 'excelente', 'bien', 'claro', 'claroquesi', 'claro que si',
  'suena bien', 'me interesa', 'interesado', 'interesada', 'quiero', 'voy',
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

function buildEnhancedQuery(userMessage: string, history: DbConversationMessage[], referralContext = ''): string {
  const normalizedMsg = (userMessage || '').replace(/\s+/g, ' ').trim()
  const recent = (history || []).slice(-8)
  const msgWords = normalizedMsg.split(/\s+/).filter((w) => w.length >= 2)
  const msgLowerSimple = normalizedMsg.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
  const esRespuestaCorta =
    msgWords.length <= 2 &&
    RESPUESTAS_CORTAS_SIN_CONTEXTO.has(msgLowerSimple)

  if (msgWords.length >= 3 && !esRespuestaCorta) return `${normalizedMsg}${referralContext ? `\nCONTEXTO DE BÚSQUEDA DEL ANUNCIO: ${referralContext}` : ''}`

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
  if (!context) return `${normalizedMsg}${pistasAdicionales}${referralContext ? `\nCONTEXTO DE BÚSQUEDA DEL ANUNCIO: ${referralContext}` : ''}`
  let combined = `${context}\nUSUARIO ACTUAL: ${normalizedMsg}${pistasAdicionales}`
  if (combined.length > 1500) {
    const tail = 1500 - pistasAdicionales.length
    combined = context.slice(Math.max(0, context.length - tail)) + `\nUSUARIO ACTUAL: ${normalizedMsg}${pistasAdicionales}`
  }
  return `${combined}${referralContext ? `\nCONTEXTO DE BÚSQUEDA DEL ANUNCIO: ${referralContext}` : ''}`
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

  const retrievalQuery = buildEnhancedQuery(input.message, input.history || [], input.referralContext || '')
  const { documents, contextBlock, matchedBlocks } = await buildDbDocumentsContextBlock(input.tenantId, retrievalQuery)

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
  const systemPrompt = buildSystemPrompt(input.prompt, contextBlock, input.referralContext || '')
  const messages = [
    { role: 'system' as const, content: systemPrompt },
    ...trimmedHistory.map((m) => ({ role: (m.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant', content: String(m.content || '') })),
    { role: 'user' as const, content: input.message },
  ]

  const completion = await requestCompletion({
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

  answer = applyUpcomingCourseDateCorrection(answer, input.message, matchedBlocks)
  // Evita que frases internas de incertidumbre lleguen al cliente. La respuesta
  // ofrece una vía humana sin inventar datos ni revelar automatización.
  answer = replaceNoInformationReply(answer)

  // ===== AUTO-CURADO · JUEZ SÍNCRONO (último filtro, antes de devolver respuesta) =====
  const matchedBlocksForJudge = matchedBlocks || []
  const matchedBlocksText = matchedBlocksToText(matchedBlocksForJudge)
  const matchedBlockRefs = matchedBlocksToRefs(matchedBlocksForJudge)

  let evalCategory: AutoEvalCategory = 'correct'
  let evalReason = ''
  let evalId = ''
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

  if ((evalCategory === 'noinfo' || evalCategory === 'judge_failed') && answer === NO_INFORMATION_REPLY) {
    // Una derivación neutral y segura es una respuesta válida aunque la base no
    // contenga el dato; así el cliente recibe una salida útil en vez de silencio.
    evalCategory = 'correct'
    evalReason = 'Se ofreció confirmación con un asesor porque las fuentes no respaldan el dato solicitado.'
  }

  const blocked = evalCategory !== 'correct'

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

  const autoEval: AutoEvalResult = {
    id: evalId,
    category: evalCategory,
    judgeReason: evalReason,
    blocked,
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
