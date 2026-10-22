import { normalizeText, type SearchIndex } from './searchIndex.js'

// Used when the business's documents do not state their time zone
export const DEFAULT_TIME_ZONE = 'America/Hermosillo'

// Names a business may write instead of an IANA zone ("Zona horaria: Ciudad de Mexico")
const TIME_ZONE_ALIASES: Array<{ names: string[]; zone: string }> = [
  { names: ['hermosillo', 'sonora', 'arizona'], zone: 'America/Hermosillo' },
  {
    names: ['ciudad de mexico', 'cdmx', 'mexico', 'centro', 'centro de mexico', 'guadalajara', 'monterrey', 'puebla', 'queretaro', 'leon'],
    zone: 'America/Mexico_City',
  },
  { names: ['tijuana', 'mexicali', 'baja california', 'pacifico'], zone: 'America/Tijuana' },
  { names: ['mazatlan', 'culiacan', 'sinaloa', 'la paz', 'baja california sur', 'nayarit', 'tepic'], zone: 'America/Mazatlan' },
  { names: ['chihuahua'], zone: 'America/Chihuahua' },
  { names: ['ciudad juarez', 'juarez'], zone: 'America/Ciudad_Juarez' },
  { names: ['cancun', 'quintana roo', 'chetumal'], zone: 'America/Cancun' },
  { names: ['bogota', 'colombia'], zone: 'America/Bogota' },
  { names: ['lima', 'peru'], zone: 'America/Lima' },
  { names: ['santiago', 'chile'], zone: 'America/Santiago' },
  { names: ['buenos aires', 'argentina'], zone: 'America/Argentina/Buenos_Aires' },
  { names: ['madrid', 'espana'], zone: 'Europe/Madrid' },
]

function isValidTimeZone(zone: string) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone })
    return true
  } catch {
    return false
  }
}

// "America/Mexico_City", "UTC-6", "GMT -7" or a city or region name, to an IANA zone
export function resolveTimeZone(value: string): string | null {
  const raw = String(value || '').trim()
  if (!raw) return null

  const iana = raw.match(/\b[A-Za-z]+\/[A-Za-z_]+(?:\/[A-Za-z_]+)?\b/)?.[0]
  if (iana && isValidTimeZone(iana)) return iana

  // Etc/GMT zones have the opposite sign: UTC-7 is Etc/GMT+7
  const offset = raw.match(/\b(?:utc|gmt)\s*([+-−])\s*(\d{1,2})(?::00)?\b/i)
  if (offset) {
    const hours = Number(offset[2])
    const zone = `Etc/GMT${offset[1] === '+' ? '-' : '+'}${hours}`
    if (hours <= 14 && isValidTimeZone(zone)) return zone
  }

  const normalized = ` ${normalizeText(raw)} `
  for (const alias of TIME_ZONE_ALIASES) {
    if (alias.names.some((name) => normalized.includes(` ${name} `))) return alias.zone
  }
  return null
}

export type TimeZoneSetting = {
  zone: string
  // How the business wrote it ("Ciudad de México"), or the default's name
  label: string
  fromDocuments: boolean
}

const DEFAULT_TIME_ZONE_LABEL = 'Hermosillo, Sonora, México'
const timeZoneSettings = new WeakMap<SearchIndex, TimeZoneSetting>()

// The zone the business states in its documents: a "Zona horaria: ..." line in any
// block ([HORARIOS], [UBICACION]...) or a [ZONA_HORARIA] block; Hermosillo otherwise
export function detectTimeZoneSetting(index: SearchIndex): TimeZoneSetting {
  const cached = timeZoneSettings.get(index)
  if (cached) return cached

  let setting: TimeZoneSetting = { zone: DEFAULT_TIME_ZONE, label: DEFAULT_TIME_ZONE_LABEL, fromDocuments: false }
  for (const block of index.blocks) {
    const labeled = block.body.match(/zona\s+horaria\s*[:：-]\s*(.+)/i)?.[1]?.trim()
    const titled = /\bzona horaria\b/.test(block.normalizedTitle)
      ? block.body.split(/\r?\n/).map((line) => line.trim()).find((line) => line && !line.startsWith('['))
      : undefined
    const written = [labeled, titled].find((value) => value && resolveTimeZone(value))
    if (written) {
      setting = { zone: resolveTimeZone(written)!, label: written.slice(0, 80), fromDocuments: true }
      break
    }
  }

  timeZoneSettings.set(index, setting)
  return setting
}

export function detectTimeZone(index: SearchIndex): string {
  return detectTimeZoneSetting(index).zone
}

// The line the bot can quote when a customer asks for the business's time zone
export function describeTimeZone(setting: TimeZoneSetting, now = new Date()) {
  const offset = getZonedDateParts(now, setting.zone).offsetLabel
  const name = setting.label === setting.zone ? setting.zone : `${setting.label} (${setting.zone})`
  return `Zona horaria del negocio (todos sus horarios y fechas están en esta zona): ${name}, ${offset}`
}

// For code that has only the tenant id (notifications); never fails, at worst
// it answers the default zone
export async function getTenantTimeZone(tenantId: string): Promise<string> {
  try {
    const { getDbTenantSearchIndex } = await import('./dbWorkspace.js')
    return detectTimeZone(await getDbTenantSearchIndex(tenantId))
  } catch {
    return DEFAULT_TIME_ZONE
  }
}

export type ZonedDateParts = {
  year: number
  month: number
  day: number
  weekday: number
  hour: number
  minute: number
  offsetLabel: string
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export function getZonedDateParts(date: Date, timeZone: string): ZonedDateParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
    timeZoneName: 'shortOffset',
  }).formatToParts(date)
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value || ''
  return {
    year: Number(part('year')),
    month: Number(part('month')),
    day: Number(part('day')),
    weekday: WEEKDAYS.indexOf(part('weekday')),
    hour: Number(part('hour')),
    minute: Number(part('minute')),
    offsetLabel: part('timeZoneName').replace('GMT', 'UTC') || 'UTC',
  }
}
