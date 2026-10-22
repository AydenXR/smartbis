const GENERIC_CATALOG_NAMES = new Set([
  'pieza',
  'unidad',
  'unidades',
  'producto',
  'productos',
  'articulo',
  'articulos',
  'item',
  'items',
  'sin nombre',
])

/** Rejects unit labels accidentally parsed as product names, without rejecting
 * real names such as "Piel sintética (5 piezas)". */
export function isUsableCatalogDocumentName(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const name = value.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  const countOnly = /^(?:\d+|\d+\s*p(?:z|i|zs|zas))$/i.test(name)
  return name.length > 1 && !GENERIC_CATALOG_NAMES.has(name) && !countOnly
}

export function extractMarkdownField(block: string, labels: string[]): string | undefined {
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const match = block.match(new RegExp(`(?:^|\\n)[ \\t]*[-*]?[ \\t]*${escaped}[ \\t]*[:：][ \\t]*([^\\r\\n]*)`, 'i'))
    const value = match?.[1]?.trim()
    if (value) return value
  }
  return undefined
}

export function isMisparsedCatalogItem(item: {
  name?: string
  sku?: string
  sourceDocId?: string
  family?: string
  category?: string
  stocks?: Record<string, number>
}): boolean {
  if (String(item.sourceDocId || '').trim().toLowerCase() !== 'productos.md') return false
  if (!/^[a-f0-9]{8}$/i.test(String(item.sku || '').trim())) return false
  if (Object.values(item.stocks || {}).some((qty) => Number(qty) > 0)) return false
  const name = String(item.name || '').trim().toLowerCase()
  const unitOrCountName = /^(?:pieza|unidad|producto|articulo|item|\d+|\d+\s*p(?:z|i|zs|zas))$/.test(name)
  const familyContainsCategory = /^\s*[-*]?\s*categor[ií]a\s*:/i.test(String(item.family || ''))
  return name === 'pieza' || (unitOrCountName && familyContainsCategory && Boolean(item.category))
}
