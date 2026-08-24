import { createSearchIndex, searchIndex } from './searchIndex.js'
import { loadDbAgentDocuments } from './dbWorkspace.js'
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

const FECHAS_OFICIALES_CALENDARIO = `### FECHAS OFICIALES DE CURSOS Salubel Institute (CALENDARIO OFICIAL 2026 — VERDAD ABSOLUTA, ESTOS DATOS GANAN SIEMPRE SOBRE CUALQUIER OTRO TEXTO EN "Fuentes de verdad" O EN CUALQUIER OTRO LUGAR):
NUNCA uses fechas inventadas, NUNCA uses fechas del Temario que no estén en esta lista, NUNCA asocies una fecha de otro curso por parecido. SOLO respondes con esta lista. Si un curso no está aquí, respondes "Consultar disponibilidad por WhatsApp al +52 1 662 335 8779."

FECHAS EN LÍNEA (ONLINE) — SOLAMENTE 11:
1. 05 Agosto: Rejuvenecimiento y eliminación de manchas con Dermapen.
2. 11 Agosto: Russian lips.
3. 12 Agosto: Hidrofacial.
4. 19 Agosto: Mesobotox.
5. 26 Agosto: Limpieza facial.
6. 01 Septiembre: Aplicación de toxina botulínica en tercio superior.
7. 02 Septiembre: Bioestimulación con PDRN.
8. 09 Septiembre: Limpomodelación con enzimas (también llamado Lipoenzimas en variante de nombre).
9. 22 Septiembre: Aplicación de toxina botulínica en tercio inferior.
10. 23 Septiembre: Eliminación de verrugas y manchas con Plasma Pen / Fibroblast.
11. 29 Septiembre: Aumento de glúteos con peptonas.

FECHAS PRESENCIAL — SOLAMENTE 7:
1. 15 Agosto: Rejuvenecimiento y eliminación de manchas con Dermapen.
2. 20 Agosto: Lipoenzimas (también llamado Limpomodelación con enzimas en variante de nombre).
3. 27 Agosto: Eliminación de verrugas y manchas con plasma pen / Fibroblast.
4. 03 Septiembre: Bioestimulación con PDRN.
5. 10 Septiembre: Relleno de labios con Hyaluron Pen / HP.
6. 17 Septiembre: Aumento de glúteos con peptonas.
7. 24 Septiembre: Limpieza facial.

MAPA DE ASOCIACIONES OBLIGATORIAS (nunca cambias esto):
- Limpiezas faciales → ONLINE = 26 Agosto, PRESENCIAL = 24 Septiembre. NUNCA 27 Agosto (27 Agosto es VERUGAS Y MANCHAS), NUNCA 12 Agosto (12 Agosto es HIDROFACIAL).
- Eliminación de verrugas y manchas (Plasma Pen / Fibroblast, verrugas, manchas, verruga, pp, plasma pen) → ONLINE = 23 Septiembre, PRESENCIAL = 27 Agosto. NUNCA 24 Septiembre para verrugas.
- Bioestimulación con PDRN / PDRN de salmón / pdrn → ONLINE 02 Septiembre, PRESENCIAL 03 Septiembre.
- Dermapen manchas (Rejuvenecimiento y eliminación de manchas con Dermapen, manchas dermapen, dermapen manchas) → ONLINE 05 Agosto, PRESENCIAL 15 Agosto.
- Hidrofacial / hidro facial / hidro → SOLO ONLINE 12 Agosto. NUNCA inventar presencial.
- Peptonas glúteos / Aumento de glúteos con peptonas / gluteos peptonas → ONLINE 29 Septiembre, PRESENCIAL 17 Septiembre.
- Relleno de labios con Hyaluron Pen / HP / Relleno HP / hyaluron pen / relleno labios / hp labial → SOLO PRESENCIAL 10 Septiembre. NUNCA inventar fecha online para éste.
- Russian lips / rusas → ONLINE 11 Agosto.
- Mesobotox / meso botox → ONLINE 19 Agosto.
- Toxina botulínica tercio superior / toxina superior / botox frente → ONLINE 01 Septiembre.
- Toxina botulínica tercio inferior / toxina inferior / botox inferior → ONLINE 22 Septiembre.
`

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

function buildSystemPrompt(prompt: string, contextBlock: string) {
  return `${ANTI_INTERNAL_REASONING_RULE}${prompt}

Información disponible (responde ÚNICAMENTE con los datos que aparezcan aquí abajo; si algo no aparece aquí, NO lo inventes y pide confirmar por WhatsApp o comenta que no dispones de esa información pública):
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

Categoría 2) error
Cuándo usar:
  a) El sistema SÍ recuperó documentos relevantes (RAG > 0) que contienen la información necesaria para responder la pregunta.
  b) Pero el bot:
     - OMITIÓ datos clave que sí estaban en los documentos,
     - INVENTÓ precios/fechas/datos que NO aparecen en los documentos,
     - Respondió "no tengo información" / "consulta por WhatsApp" cuando SÍ tenía la respuesta en los documentos recuperados,
     - Respondió algo completamente distinto a lo preguntado pese a tener la info.

Categoría 3) noinfo
Cuándo usar:
  a) El sistema NO recuperó ningún documento relevante (matchedBlocks vacío o 0),
     O los documentos recuperados NO contienen la información para responder la pregunta,
     Y por lo tanto el bot tuvo que responder sin fuente, o pedir disculpas, o derivar a WhatsApp.

INSTRUCCIONES DE SALIDA (OBLIGATORIO, SIN TEXTO EXTRA):
Responde ÚNICAMENTE con un bloque JSON que tenga esta estructura y NADA MÁS:
{
  "category": "correct | error | noinfo",
  "reason": "explicación corta en español de por qué tomaste esa decisión (máximo 2 frases)"
}
No escribas explicaciones fuera del JSON, no uses markdown, no agregues texto antes ni después.`

type JudgeOutput = { category: 'correct' | 'error' | 'noinfo'; reason: string }

function safeJsonParseJudge(text: string): JudgeOutput | null {
  try {
    const trimmed = String(text || '').trim()
    const start = trimmed.indexOf('{')
    const end = trimmed.lastIndexOf('}')
    if (start < 0 || end < 0 || end <= start) return fallbackRegexJudge(trimmed)
    const json = JSON.parse(trimmed.slice(start, end + 1))
    if (!json || typeof json !== 'object') return fallbackRegexJudge(trimmed)
    const category = String(json.category || '').toLowerCase() as 'correct' | 'error' | 'noinfo'
    if (category !== 'correct' && category !== 'error' && category !== 'noinfo') return fallbackRegexJudge(trimmed)
    const reason = String(json.reason || '').trim()
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
  botAnswer: string
  matchedBlocksText: string
}): Promise<JudgeOutput> {
  const ragSummary = args.matchedBlocksText || '(NO hubo documentos recuperados por el RAG — matchedBlocks vacío)'
  const promptSnippet = (args.tenantPrompt || '').slice(0, 2500)
  const messages = [
    { role: 'system' as const, content: AUTOJUDGE_SYSTEM_PROMPT },
    {
      role: 'user' as const,
      content:
`=== PROMPT DEL TENANT (primeras ~2500 chars) ===
${promptSnippet || '(sin prompt del tenant)'}

=== DOCUMENTOS RECUPERADOS POR RAG (matchedBlocks) ===
${ragSummary}

=== PREGUNTA DEL CLIENTE ===
${args.userQuestion}

=== RESPUESTA DEL BOT ===
${args.botAnswer}

=== FIN DE LA ENTRADA ===
Ahora devuelve EXCLUSIVAMENTE el JSON con "category" y "reason".`,
    },
  ]
  const res = await requestCompletion({
    apiKey: args.apiKey,
    baseUrl: args.baseUrl,
    model: args.model,
    fallbackModel: args.fallbackModel,
    maxTokens: Math.min(350, args.maxTokens),
    messages,
  })
  const parsed = safeJsonParseJudge(res.answer)
  if (!parsed) throw new Error('Juez no devolvió JSON válido')
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

async function buildDbDocumentsContextBlock(tenantId: string, query = '') {
  const documents = await loadDbAgentDocuments(tenantId)
  const index = createSearchIndex({
    tenantId,
    documents,
  })
  const result = searchIndex(index, query) as any

  return {
    documents: result.documents,
    contextBlock: result.contextBlock,
    matchedBlocks: (result.matchedBlocks || []).slice(0, 4) as any[],
    intent: (result.intent || {}) as Record<string, boolean>,
  }
}

function buildEnhancedQuery(userMessage: string, history: DbConversationMessage[]): string {
  const normalizedMsg = (userMessage || '').replace(/\s+/g, ' ').trim()
  const recent = (history || []).slice(-6)
  const msgWords = normalizedMsg.split(/\s+/).filter((w) => w.length >= 2)
  if (msgWords.length >= 3) return normalizedMsg
  const context = recent.map((m) => `${m.role === 'user' ? 'USUARIO' : 'ASESOR'}: ${m.content}`).join('\n')
  if (!context) return normalizedMsg
  const combined = `${context}\nUSUARIO ACTUAL: ${normalizedMsg}`
  if (combined.length > 1500) return combined.slice(-1500)
  return combined
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

  const retrievalQuery = buildEnhancedQuery(input.message, input.history || [])
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
  const systemPrompt = buildSystemPrompt(input.prompt, contextBlock)
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
      botAnswer: answer,
      matchedBlocksText,
    })
    evalCategory = judgeRes.category
    evalReason = judgeRes.reason
  } catch (e: any) {
    // Fail-closed: si el juez falla (timeout / JSON inválido / error), se bloquea.
    evalCategory = 'judge_failed'
    evalReason = `Juez falló: ${e?.message || String(e || 'error desconocido')}`.slice(0, 600)
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
