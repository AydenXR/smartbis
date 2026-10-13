import type { MetaMessageRow } from '@/lib/api'

export type PaymentProofKind = 'image' | 'file' | 'text'

export type PaymentProofHit = {
  messageId: string
  kind: PaymentProofKind
  createdAt: string
}

const PAYMENT_TEXT_RE =
  /\b(comprobante|voucher|recibo|transferencia|transferi|transferí|deposit[eéo]|dep[oó]sito|pagu[eé]|pago realizado|ya pagu|ya hice el pago|ya realic[eé]|num(?:ero)? de (?:operaci[oó]n|referencia|transacci[oó]n)|referencia de pago|spei|clabe)\b/i

export function detectPaymentProofKind(msg: MetaMessageRow): PaymentProofKind | null {
  if (msg.direction !== 'IN') return null
  const attachments = Array.isArray(msg.attachments) ? msg.attachments : []
  if (attachments.some((a) => a?.type === 'image')) return 'image'
  if (attachments.some((a) => a?.type === 'file')) return 'file'
  if (msg.content && PAYMENT_TEXT_RE.test(msg.content)) return 'text'
  return null
}

export function findPaymentProofs(messages: MetaMessageRow[]): PaymentProofHit[] {
  const hits: PaymentProofHit[] = []
  for (const m of messages) {
    const kind = detectPaymentProofKind(m)
    if (kind) hits.push({ messageId: m.id, kind, createdAt: m.createdAt })
  }
  return hits
}
