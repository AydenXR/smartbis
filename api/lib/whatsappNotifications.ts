import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import QRCode from 'qrcode'
import type { Client as WhatsAppClient } from 'whatsapp-web.js'

const whatsappWeb = createRequire(import.meta.url)('whatsapp-web.js') as typeof import('whatsapp-web.js')
const { Client, LocalAuth } = whatsappWeb

const STORE_DIR = path.resolve(process.cwd(), 'clientsdata', '_whatsapp_store')
const SESSION_DIR = path.resolve(process.cwd(), 'clientsdata', '_whatsapp_auth')
fs.mkdirSync(STORE_DIR, { recursive: true })

type Store = { recipient: string; sent: Record<string, { at: string; course: string; psid: string }> }
type TenantWhatsAppState = {
  client: WhatsAppClient | null
  initializing: Promise<void> | null
  connectionState: string
  qrDataUrl: string
  linkedNumber: string
}
const tenantStates = new Map<string, TenantWhatsAppState>()

function safe(s: string) { return String(s || '').replace(/[^A-Za-z0-9_-]/g, '_') }
function getTenantState(tenantId: string): TenantWhatsAppState {
  const key = safe(tenantId)
  let state = tenantStates.get(key)
  if (!state) {
    state = {
      client: null,
      initializing: null,
      connectionState: 'DISCONNECTED',
      qrDataUrl: '',
      linkedNumber: '',
    }
    tenantStates.set(key, state)
  }
  return state
}
function storePath(tenantId: string) { return path.join(STORE_DIR, `${safe(tenantId)}.json`) }
function readStore(tenantId: string): Store {
  try { return JSON.parse(fs.readFileSync(storePath(tenantId), 'utf8')) as Store }
  catch { return { recipient: '', sent: {} } }
}
function writeStore(tenantId: string, store: Store) {
  fs.writeFileSync(storePath(tenantId), JSON.stringify(store, null, 2), { mode: 0o600 })
}

export async function startWhatsApp(tenantId: string): Promise<void> {
  const state = getTenantState(tenantId)
  if (state.client || state.initializing) return state.initializing || Promise.resolve()
  state.initializing = (async () => {
    const c = new Client({
      authStrategy: new LocalAuth({ clientId: `tenant-${safe(tenantId)}`, dataPath: SESSION_DIR }),
      puppeteer: {
        executablePath: process.env.WHATSAPP_CHROME_PATH || '/usr/bin/chromium',
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      },
    })
    c.on('qr', async (qr) => { state.qrDataUrl = await QRCode.toDataURL(qr); state.connectionState = 'QR' })
    c.on('authenticated', () => { state.connectionState = 'AUTHENTICATED'; state.qrDataUrl = '' })
    c.on('ready', () => { state.connectionState = 'CONNECTED'; state.linkedNumber = c.info?.wid?.user || '' })
    c.on('auth_failure', () => { state.connectionState = 'AUTH_FAILURE'; state.qrDataUrl = ''; if (state.client === c) state.client = null })
    c.on('disconnected', () => { state.connectionState = 'DISCONNECTED'; state.linkedNumber = ''; state.qrDataUrl = ''; if (state.client === c) state.client = null })
    state.client = c
    try { await c.initialize() }
    catch (error) { state.client = null; state.connectionState = 'ERROR'; throw error }
  })()
  try { await state.initializing } finally { state.initializing = null }
}

export async function getWhatsAppStatus(tenantId: string) {
  const state = getTenantState(tenantId)
  return {
    state: state.connectionState,
    qr: state.qrDataUrl,
    linkedNumber: state.linkedNumber,
    recipient: readStore(tenantId).recipient,
  }
}

export async function setWhatsAppRecipient(tenantId: string, recipient: string) {
  const normalized = String(recipient || '').replace(/\D/g, '')
  if (normalized.length < 10 || normalized.length > 15) throw new Error('Escribe el número destino con lada internacional, solo dígitos (10 a 15).')
  const store = readStore(tenantId)
  store.recipient = normalized
  writeStore(tenantId, store)
  return normalized
}

export async function sendWhatsAppTest(tenantId: string) {
  await startWhatsApp(tenantId)
  const state = getTenantState(tenantId)
  if (!state.client || state.connectionState !== 'CONNECTED') throw new Error('WhatsApp no está conectado. Enlaza el teléfono desde Inscripciones.')
  const recipient = readStore(tenantId).recipient
  if (!recipient) throw new Error('Configura y guarda primero el número que recibirá los avisos.')
  const timestamp = new Date().toLocaleString('es-MX', { timeZone: 'America/Hermosillo' })
  await state.client.sendMessage(`${recipient}@c.us`, `🧪 PRUEBA DE NOTIFICACIONES SMARTBIS\nLa conexión de WhatsApp está funcionando.\nFecha: ${timestamp}\n\nEste mensaje es una simulación; no corresponde a una inscripción.`)
  return { sent: true, recipient }
}

export async function notifyRegistration(tenantId: string, input: { psid: string; customer: string; course: string; modality?: string; confirmedBy: string; auto?: boolean }) {
  await startWhatsApp(tenantId)
  const state = getTenantState(tenantId)
  if (!state.client || state.connectionState !== 'CONNECTED') throw new Error('WhatsApp no está conectado. Enlaza el teléfono desde Configuración.')
  const store = readStore(tenantId)
  if (!store.recipient) throw new Error('Configura primero el teléfono que recibirá las notificaciones.')
  const course = String(input.course || '').trim().slice(0, 120)
  if (!course) throw new Error('Indica el curso de la inscripción.')
  const key = `${input.psid}:${course.toLocaleLowerCase('es-MX')}`
  if (store.sent[key]) return { sent: false, duplicate: true }
  if (input.auto) {
    const cutoff = Date.now() - 6 * 3600_000
    const recent = Object.values(store.sent).some((v: any) => v?.psid === input.psid && Date.parse(v?.at || '') > cutoff)
    if (recent) return { sent: false, duplicate: true }
  }
  const customer = String(input.customer || 'Cliente').trim().slice(0, 100)
  const modality = String(input.modality || '').trim().slice(0, 60)
  const msg = [
    input.auto ? '💳 PAGO DETECTADO · NUEVA INSCRIPCIÓN (automático)' : '✅ INSCRIPCIÓN CONFIRMADA',
    `Cliente: ${customer}`,
    `Curso: ${course}`,
    modality ? `Modalidad: ${modality}` : '',
    `PSID: ${input.psid}`,
    input.auto ? 'Comprobante recibido en el chat (monto sin verificar)' : `Confirmó: ${input.confirmedBy}`,
    `Fecha: ${new Date().toLocaleString('es-MX', { timeZone: 'America/Hermosillo' })}`,
  ].filter(Boolean).join('\n')
  await state.client.sendMessage(`${store.recipient}@c.us`, msg)
  store.sent[key] = { at: new Date().toISOString(), course, psid: input.psid }
  writeStore(tenantId, store)
  return { sent: true, duplicate: false }
}
