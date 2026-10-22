/**
 * Last-mile Messenger gate for answers that admit the bot lacks the requested
 * information. This is independent of the LLM judge: a false "correct" from
 * the judge must never expose a no-information fallback to a customer.
 */
  export const ADMIN_HANDOFF_REPLY = ''

export function isMissingInformationAnswer(answer: string): boolean {
  const normalized = String(answer || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()

  if (!normalized) return true
  if (/\[\s*no[_\s-]*responder\s*\]/i.test(normalized)) return true

  const explicitLack = /\b(?:no\s+(?:tengo|tenemos|tienen|cuento|contamos|dispongo|disponemos|hay|existe|puedo|podemos|estoy|estamos|me\s+es\s+posible)|desconozco|ignoro)\b.{0,100}\b(?:informacion|info|datos?|respuesta|responder|ayudarte|ayudarle|ayudarles|confirmar|decirte|decirle|acceso|capacitado|capacitada|seguro|segura|certeza)\b/i.test(normalized)
  const unknownFact = /\b(?:no\s+(?:se|sabemos)|no\s+sabria\s+decirte|desconozco|ignoro)\b.{0,100}\b(?:informacion|info|datos?|respuesta|precio|costo|fecha|horario|existencia|disponibilidad|ubicacion|direccion|nombre)\b/i.test(normalized)
  const englishLack = /\b(?:i\s+don't\s+have|i\s+do\s+not\s+have|i\s+can't\s+(?:answer|help|confirm)|i\s+cannot\s+(?:answer|help|confirm))\b.{0,100}\b(?:information|info|data|answer|help|confirm)\b/i.test(normalized)
  const technicalFallback = /\b(?:dificultades|problemas)\s+tecnic[oa]s?\b|\bno\s+puedo\s+responder\s+(?:ahora|en\s+este\s+momento)\b/i.test(normalized)
  return explicitLack || unknownFact || englishLack || technicalFallback
}

/** The exact final send gate shared by production and Messenger simulations. */
export function shouldSendMessengerAnswer(answer: string, autocuratorBlocked: boolean): boolean {
  return !autocuratorBlocked && !isMissingInformationAnswer(answer)
}
