import { notifyRegistration } from './whatsappNotifications.js'

type Msg = {
  direction: 'IN' | 'OUT_BOT' | 'OUT_HUMAN'
  content: string
  attachments?: any[]
  referral?: { ads_context_data?: { ad_title?: string } }
}

const PAYMENT_CLAIM_RE =
  /\b(comprobante|voucher|recibo de pago|ya pagu[eé]|ya hice (?:el|mi) (?:pago|dep[oó]sito|transferencia)|pago realizado|transferencia (?:realizada|hecha)|ya transferi|ya deposit[eé]|dep[oó]sito realizado)\b/i

const PAYMENT_INSTRUCTIONS_RE =
  /\b(clabe|cuenta|transferencia|dep[oó]sito|comprobante|n[uú]mero de tarjeta|referencia|spei|datos (?:bancarios|de pago)|forma de pago|pagar)\b/i

function hasProofAttachment(m: Msg) {
  return Array.isArray(m.attachments) && m.attachments.some((a) => a?.type === 'image' || a?.type === 'file')
}

// Una imagen/archivo solo cuenta como comprobante si la conversación reciente trataba sobre pagar;
// un texto solo cuenta si declara explícitamente que ya se pagó.
export function looksLikePaymentProof(history: Msg[]): boolean {
  const last = history[history.length - 1]
  if (!last || last.direction !== 'IN') return false
  if (!hasProofAttachment(last)) return PAYMENT_CLAIM_RE.test(last.content || '')
  const context = history.slice(-13, -1)
  return context.some((m) => (m.direction !== 'IN' || PAYMENT_CLAIM_RE.test(m.content || '')) && PAYMENT_INSTRUCTIONS_RE.test(m.content || ''))
}

async function extractCourse(history: Msg[]): Promise<{ course: string; modality: string }> {
  const adTitle = [...history].reverse().find((m) => m.referral?.ads_context_data?.ad_title)?.referral?.ads_context_data?.ad_title || ''
  const fallback = { course: adTitle.trim(), modality: '' }
  const apiKey = process.env.LLM_API_KEY?.trim() || process.env.XAI_API_KEY?.trim() || ''
  const baseUrl = process.env.LLM_BASE_URL?.trim() || process.env.XAI_BASE_URL?.trim() || ''
  const model = process.env.LLM_MODEL_NAME?.trim() || process.env.XAI_MODEL?.trim() || ''
  if (!apiKey || !baseUrl || !model) return fallback
  const transcript = history.slice(-20)
    .map((m) => `${m.direction === 'IN' ? 'Cliente' : 'Asesor'}: ${(m.content || '').slice(0, 400)}`)
    .join('\n')
  try {
    const res = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model, temperature: 0, max_tokens: 400,
        messages: [
          { role: 'system', content: 'Del chat de ventas extrae el curso al que el cliente se está inscribiendo/pagando y la modalidad (presencial, online, etc.). Responde SOLO JSON: {"course":"","modality":""}. Usa cadena vacía si no consta.' },
          { role: 'user', content: transcript + (adTitle ? `\n(Anuncio de origen: ${adTitle})` : '') },
        ],
      }),
      signal: AbortSignal.timeout(30000),
    })
    const payload: any = await res.json().catch(() => null)
    const raw = String(payload?.choices?.[0]?.message?.content || '')
    const json = raw.match(/\{[\s\S]*\}/)?.[0]
    if (!json) return fallback
    const parsed = JSON.parse(json)
    return {
      course: String(parsed.course || '').trim() || fallback.course,
      modality: String(parsed.modality || '').trim(),
    }
  } catch {
    return fallback
  }
}

export async function maybeAutoConfirmRegistration(tenantId: string, psid: string, customer: string, history: Msg[]): Promise<void> {
  try {
    if (!looksLikePaymentProof(history)) return
    const { course, modality } = await extractCourse(history)
    const result = await notifyRegistration(tenantId, {
      psid, customer, course: course || 'Por confirmar (revisar chat)', modality, confirmedBy: 'Automático', auto: true,
    })
    console.log('[payment-auto]', psid, result)
  } catch (error: any) {
    console.error('[payment-auto] failed', error?.message || error)
  }
}
