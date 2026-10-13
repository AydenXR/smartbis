import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { Request, Response, NextFunction } from 'express'
import dotenv from 'dotenv'
import { generateDbAgentAnswer } from './dbChat.js'
import { type DbAuthUser, loadDbWorkspace } from './dbWorkspace.js'
import { createAutoEval } from './posStore.js'
import { maybeAutoConfirmRegistration } from './paymentAutoConfirm.js'

dotenv.config()
dotenv.config({ path: '.env.local', override: true })

const APP_ID = process.env.FACEBOOK_APP_ID || ''
const APP_SECRET = process.env.FACEBOOK_APP_SECRET || ''
const VERIFY_TOKEN = process.env.FACEBOOK_WEBHOOK_VERIFY_TOKEN || 'smartbisfacebook_verify_token'
const WEBHOOK_SUBSCRIPTION_VERSION = 2
const GRAPH_VERSION = process.env.META_GRAPH_API_VERSION || 'v22.0'
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`
const OAUTH_REDIRECT =
  process.env.META_OAUTH_REDIRECT_URI ||
  'https://api.smartbis.ai/api/webhooks/facebook/oauth/callback'

const DATA_DIR = path.resolve(process.cwd(), 'clientsdata', '_meta_store')
if (!fs.existsSync(DATA_DIR)) {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }) } catch {}
}

// =========================
// Tipos
// =========================
export type MetaBotState = 'START' | 'PAUSE'

export interface TenantMetaConfig {
  tenantId: string
  appId: string
  appSecret?: string
  verifyToken: string
  graphVersion: string
  pageId?: string
  pageName?: string
  pageAccessToken?: string
  pageProfilePic?: string
  pageTokenExpiresAt?: string
  userLongLivedToken?: string
  userLLExtendsAt?: string
  state: MetaBotState
  testMode: boolean
  webhookSubscribed: boolean
  webhookSubscriptionVersion?: number
  linkedAt?: string
  updatedAt: string
}

export interface MetaMessageRow {
  id: string
  tenantId: string
  pageId: string
  psid: string
  mid?: string
  userFirstName?: string
  userLastName?: string
  userProfilePic?: string
  direction: 'IN' | 'OUT_BOT' | 'OUT_HUMAN'
  content: string
  attachments?: any[]
  sentToUser: boolean
  readByUserAt?: string
  deliveredAt?: string
  createdAt: string
  testMode?: boolean
  blockedByAutocurator?: boolean
  autoEvalId?: string
  autoEvalCategory?: 'correct' | 'error' | 'noinfo' | 'judge_failed'
  sendError?: string
  referral?: MetaReferral
}

export interface MetaReferral {
  source?: string
  type?: string
  ref?: string
  ad_id?: string
  referer_uri?: string
  ads_context_data?: {
    ad_title?: string
    photo_url?: string
    video_url?: string
    post_id?: string
    product_id?: string
    flow_id?: string
  }
  receivedAt?: string
}

export interface PSIDProfile {
  first_name?: string
  last_name?: string
  profile_pic?: string
  id?: string
}

// =========================
// Store JSON file simple (mientras tanto)
// =========================
function configPath(tenantId: string) { return path.join(DATA_DIR, `config_${safe(tenantId)}.json`) }
function messagesPath(tenantId: string) { return path.join(DATA_DIR, `messages_${safe(tenantId)}.json`) }
function referralsPath(tenantId: string) { return path.join(DATA_DIR, `referrals_${safe(tenantId)}.json`) }
function safe(s: string) { return String(s || 'default').replace(/[^A-Za-z0-9_\-]/g, '_') }

function readJSON<T>(file: string, fallback: T): T {
  try {
    if (!fs.existsSync(file)) return fallback
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as T
  } catch {
    return fallback
  }
}
function writeJSON(file: string, data: any) {
  try {
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8')
  } catch (e) {
    console.error('[metaStore] write fail', e)
  }
}

function nowISO() { return new Date().toISOString() }

export function defaultTenantMetaConfig(tenantId: string): TenantMetaConfig {
  return {
    tenantId,
    appId: APP_ID,
    verifyToken: VERIFY_TOKEN,
    graphVersion: GRAPH_VERSION,
    state: 'PAUSE',
    testMode: false,
    webhookSubscribed: false,
    updatedAt: nowISO(),
  }
}

export async function getTenantMetaConfig(tenantId: string): Promise<TenantMetaConfig> {
  const file = configPath(tenantId)
  const cfg = readJSON<TenantMetaConfig | null>(file, null)
  if (!cfg) {
    const nc = defaultTenantMetaConfig(tenantId)
    writeJSON(file, nc)
    return nc
  }
  if (!cfg.appId) cfg.appId = APP_ID
  if (!cfg.verifyToken) cfg.verifyToken = VERIFY_TOKEN
  if (!cfg.graphVersion) cfg.graphVersion = GRAPH_VERSION
  if (!cfg.state) cfg.state = 'PAUSE'
  if (cfg.testMode === undefined) cfg.testMode = false
  return cfg
}

export async function saveTenantMetaConfig(tenantId: string, next: Partial<TenantMetaConfig>): Promise<TenantMetaConfig> {
  const current = await getTenantMetaConfig(tenantId)
  const updated: TenantMetaConfig = { ...current, ...next, updatedAt: nowISO() }
  writeJSON(configPath(tenantId), updated)

  // Anti-ghost: si estamos guardando NUEVO pageId/pageAccessToken para este tenant,
  // invalidar pageId/pageAccessToken de CUALQUIER OTRO config_*.json (bug tenant hardcodeado)
  // para que findTenantConfigByPageId NUNCA seleccione el viejo config sin testMode.
  if (next.pageId || next.pageAccessToken) {
    try {
      if (!fs.existsSync(DATA_DIR)) return updated
      const files = fs.readdirSync(DATA_DIR).filter((f) => f.startsWith('config_') && f.endsWith('.json'))
      for (const f of files) {
        const fpath = path.join(DATA_DIR, f)
        try {
          const other = readJSON<TenantMetaConfig | null>(fpath, null)
          if (!other) continue
          if (other.tenantId === tenantId) continue // el actual, no tocar
          if (other.pageId && other.pageId === (next.pageId || updated.pageId)) {
            delete other.pageId
            delete other.pageName
            delete other.pageAccessToken
            delete other.pageProfilePic
            other.webhookSubscribed = false
            other.updatedAt = nowISO()
            writeJSON(fpath, other)
            console.warn(`[meta] saveTenantMetaConfig: invalidado ghost pageId en ${f} (mismo pageId que ${tenantId})`)
          }
        } catch {}
      }
    } catch {}
  }

  return updated
}

export async function getAllMessages(tenantId: string): Promise<MetaMessageRow[]> {
  return readJSON<MetaMessageRow[]>(messagesPath(tenantId), [])
}
export async function saveMessage(tenantId: string, msg: MetaMessageRow): Promise<void> {
  const list = await getAllMessages(tenantId)
  if (msg.mid) {
    const i = list.findIndex((m) => m.mid === msg.mid && m.direction === msg.direction)
    if (i >= 0) { list[i] = msg; writeJSON(messagesPath(tenantId), list); return }
  }
  list.push(msg)
  writeJSON(messagesPath(tenantId), list)
}

function normalizeReferral(value: any): MetaReferral | undefined {
  if (!value || typeof value !== 'object') return undefined
  const context = value.ads_context_data || value.adsContextData || {}
  const pick = (v: any, max = 500) => typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined
  const referral: MetaReferral = {
    source: pick(value.source, 80),
    type: pick(value.type, 80),
    ref: pick(value.ref, 500),
    ad_id: pick(value.ad_id || value.adId, 100),
    referer_uri: pick(value.referer_uri || value.refererUri, 1000),
    ads_context_data: {
      ad_title: pick(context.ad_title || context.adTitle, 500),
      photo_url: pick(context.photo_url || context.photoUrl, 1000),
      video_url: pick(context.video_url || context.videoUrl, 1000),
      post_id: pick(context.post_id || context.postId, 100),
      product_id: pick(context.product_id || context.productId, 100),
      flow_id: pick(context.flow_id || context.flowId, 100),
    },
    receivedAt: nowISO(),
  }
  if (!referral.source && !referral.ref && !referral.ad_id && !Object.values(referral.ads_context_data).some(Boolean)) return undefined
  return referral
}

async function getStoredReferral(tenantId: string, psid: string): Promise<MetaReferral | undefined> {
  const rows = readJSON<Record<string, MetaReferral>>(referralsPath(tenantId), {})
  const referral = rows[psid]
  if (!referral) return undefined
  const receivedAt = new Date(referral.receivedAt || 0).getTime()
  if (!Number.isFinite(receivedAt) || Date.now() - receivedAt > 24 * 60 * 60 * 1000) return undefined
  return referral
}

async function storeReferral(tenantId: string, psid: string, rawReferral: any): Promise<MetaReferral | undefined> {
  const referral = normalizeReferral(rawReferral)
  if (!referral) return undefined
  const rows = readJSON<Record<string, MetaReferral>>(referralsPath(tenantId), {})
  rows[psid] = referral
  writeJSON(referralsPath(tenantId), rows)

  // Si Meta entrega el evento separado después del mensaje, completa también
  // el último mensaje entrante para que el origen quede visible en el CRM.
  const messages = await getAllMessages(tenantId)
  const latestInbound = [...messages].reverse().find((m) => m.psid === psid && m.direction === 'IN')
  if (latestInbound) {
    latestInbound.referral = referral
    writeJSON(messagesPath(tenantId), messages)
  }
  return referral
}

function referralContextText(referral?: MetaReferral): string {
  if (!referral) return ''
  const fields = [
    referral.ad_id && `ID de anuncio ${referral.ad_id}`,
    referral.ads_context_data?.ad_title && `anuncio ${referral.ads_context_data.ad_title}`,
    referral.ads_context_data?.product_id && `producto ${referral.ads_context_data.product_id}`,
    referral.ref && `referencia ${referral.ref}`,
  ].filter(Boolean)
  return fields.length ? `El cliente llegó desde este anuncio. Usa su ID y título para buscar la ficha correspondiente en anuncios.md; interpreta preguntas breves (por ejemplo, “precio”) respecto al producto o tema anunciado y busca además en el catálogo. El anuncio sirve para identificar qué buscar, no para afirmar precio ni disponibilidad: ${fields.join(' · ')}` : ''
}

export async function getMessagesByPSID(tenantId: string, psid: string): Promise<MetaMessageRow[]> {
  const all = await getAllMessages(tenantId)
  return all.filter((m) => m.psid === psid).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

export interface ChatListItem {
  psid: string
  firstName?: string
  lastName?: string
  profilePic?: string
  lastMessage?: string
  lastActivityAt?: string
  unreadCount: number
  direction?: string
}

export async function listChats(tenantId: string, limit = 100): Promise<ChatListItem[]> {
  const all = await getAllMessages(tenantId)
  const byPSID = new Map<string, MetaMessageRow[]>()
  for (const m of all) {
    if (!byPSID.has(m.psid)) byPSID.set(m.psid, [])
    byPSID.get(m.psid)!.push(m)
  }
  const items: ChatListItem[] = []
  for (const [psid, msgs] of byPSID) {
    msgs.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    const last = msgs[msgs.length - 1]
    const lastIn = [...msgs].reverse().find((m) => m.direction === 'IN')
    const unread = lastIn && (!lastIn.readByUserAt) ? 1 : 0
    items.push({
      psid,
      firstName: lastIn?.userFirstName || last.userFirstName,
      lastName: lastIn?.userLastName || last.userLastName,
      profilePic: lastIn?.userProfilePic || last.userProfilePic,
      lastMessage: last.content,
      lastActivityAt: last.createdAt,
      unreadCount: unread,
      direction: last.direction,
    })
  }
  items.sort((a, b) => (b.lastActivityAt || '').localeCompare(a.lastActivityAt || ''))
  return items.slice(0, limit)
}

export async function markChatAsRead(tenantId: string, psid: string): Promise<void> {
  const all = await getAllMessages(tenantId)
  let changed = false
  for (const m of all) {
    if (m.psid === psid && m.direction === 'IN' && !m.readByUserAt) {
      m.readByUserAt = nowISO()
      changed = true
    }
  }
  if (changed) {
    writeJSON(messagesPath(tenantId), all)
  }
}

export async function deleteChatByPSID(tenantId: string, psid: string): Promise<void> {
  const all = await getAllMessages(tenantId)
  const filtered = all.filter((m) => m.psid !== psid)
  if (filtered.length !== all.length) {
    writeJSON(messagesPath(tenantId), filtered)
  }
}

// =========================
// Graph API helpers
// =========================
export async function fetchPSIDProfile(pageAccessToken: string, psid: string): Promise<PSIDProfile> {
  try {
    const url = `${GRAPH_BASE}/${psid}?fields=first_name,last_name,profile_pic&access_token=${encodeURIComponent(pageAccessToken)}`
    const r = await fetch(url, { headers: { 'Content-Type': 'application/json' } })
    if (!r.ok) return {}
    return await r.json() as PSIDProfile
  } catch (e) {
    console.error('[meta] fetchPSIDProfile fail', e)
    return {}
  }
}

export async function sendTextMessage(pageAccessToken: string, psid: string, text: string): Promise<{ mid?: string; error?: string }> {
  if (!pageAccessToken) return { error: 'No page_access_token' }
  try {
    const body = {
      messaging_type: 'RESPONSE',
      recipient: { id: psid },
      message: { text },
    }
    const url = `${GRAPH_BASE}/me/messages?access_token=${encodeURIComponent(pageAccessToken)}`
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await r.json() as any
    if (!r.ok || data?.error) {
      return { error: data?.error?.message || `HTTP ${r.status}` }
    }
    return { mid: data?.message_id }
  } catch (e: any) {
    return { error: e?.message || 'Send error' }
  }
}

// =========================
// Webhook GET handshake
// =========================
export function handleWebhookGet(req: Request, res: Response, cfg: TenantMetaConfig): void {
  const mode = String(req.query?.['hub.mode'] || '')
  const verify = String(req.query?.['hub.verify_token'] || '')
  const challenge = String(req.query?.['hub.challenge'] || '')
  if (mode === 'subscribe' && verify === (cfg.verifyToken || VERIFY_TOKEN)) {
    res.setHeader('Content-Type', 'text/plain')
    res.status(200).send(challenge)
    return
  }
  res.status(403).send('Invalid verify token')
}

// =========================
// Webhook POST inbound
// =========================
function computeHubSignature256(appSecret: string, rawBody: Buffer): string {
  return 'sha256=' + crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex')
}

export async function handleWebhookPost(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const sig256 = String(req.headers['x-hub-signature-256'] || '')
    const rawBody: Buffer | undefined = (req as any).rawBody
    const appSecret = APP_SECRET || cfgSecret()

    if (rawBody && appSecret) {
      if (!sig256) {
        res.status(403).send('Missing signature header')
        return
      }
      const expected = computeHubSignature256(appSecret, rawBody)
      let valid = false
      try {
        valid = crypto.timingSafeEqual(Buffer.from(sig256), Buffer.from(expected))
      } catch {
        valid = false
      }
      if (!valid) {
        console.warn('[meta] webhook HMAC signature mismatch, rejecting 403')
        res.status(403).send('Invalid HMAC signature')
        return
      }
    } else if (appSecret) {
      console.warn('[meta] handleWebhookPost: rawBody missing on webhook POST, cannot verify HMAC')
      res.status(400).send('rawBody required to verify webhook signature')
      return
    }

    const body = req.body
    const obj = body?.object
    if (obj !== 'page') { res.status(404).end(); return }

    res.status(200).json({ success: true })

    const entries = Array.isArray(body?.entry) ? body.entry : []
    for (const entry of entries) {
      const pageId = String(entry?.id || '')
      const cfg = await findTenantConfigByPageId(pageId)
      if (!cfg) continue

      const messagingEvents = Array.isArray(entry?.messaging) ? entry.messaging : []
      for (const evt of messagingEvents) {
        const senderPSID = String(evt?.sender?.id || '')
        if (!senderPSID) continue

        if (evt?.message && !evt.message.is_echo) {
          const eventReferral = evt?.message?.referral || evt?.referral || evt?.postback?.referral
          const referral = eventReferral
            ? await storeReferral(cfg.tenantId, senderPSID, eventReferral)
            : await getStoredReferral(cfg.tenantId, senderPSID)
          await processIncomingText(cfg, senderPSID, evt.message, pageId, referral)
        } else if (evt?.customer_information || evt?.messaging_customer_information || evt?.message?.customer_information) {
          await processCustomerInformation(cfg, senderPSID, evt.customer_information || evt.messaging_customer_information || evt.message?.customer_information)
        } else if (evt?.referral) {
          await storeReferral(cfg.tenantId, senderPSID, evt.referral)
        } else if (evt?.postback?.referral) {
          await storeReferral(cfg.tenantId, senderPSID, evt.postback.referral)
        } else if (evt?.delivery) {
          await processDelivery(cfg, senderPSID, evt.delivery)
        } else if (evt?.read) {
          await processRead(cfg, senderPSID, evt.read)
        } else if (evt?.message?.is_echo) {
          await processEcho(cfg, senderPSID, evt.message)
        }
      }
      const changes = Array.isArray(entry?.changes) ? entry.changes : []
      for (const change of changes) {
        if (change?.field === 'messaging_customer_information') {
          await processCustomerInformation(cfg, '', change.value)
        }
      }
    }
  } catch (e) { next(e) }
}

function cfgSecret(): string {
  return APP_SECRET || process.env.FACEBOOK_APP_SECRET || ''
}

async function findTenantConfigByPageId(pageId: string): Promise<TenantMetaConfig | null> {
  try {
    if (!fs.existsSync(DATA_DIR)) return null
    const files = fs.readdirSync(DATA_DIR).filter((f) => f.startsWith('config_') && f.endsWith('.json'))
    const matches: Array<{ cfg: TenantMetaConfig; path: string; updatedAt: number }> = []
    for (const f of files) {
      try {
        const cfg = readJSON<TenantMetaConfig>(path.join(DATA_DIR, f), null as any)
        if (cfg && cfg.pageId && cfg.pageId === pageId) {
          const ts = cfg.updatedAt ? new Date(cfg.updatedAt).getTime() : 0
          matches.push({ cfg, path: f, updatedAt: ts })
        }
      } catch {}
    }
    if (matches.length === 0) return null
    if (matches.length > 1) {
      console.warn(
        `[meta] findTenantConfigByPageId: ${matches.length} configs con mismo pageId=${pageId}. `
        + `Archivos: ${matches.map((m) => `${m.path}@${m.updatedAt}`).join(', ')} → eligiendo el más actualizado.`,
      )
    }
    matches.sort((a, b) => b.updatedAt - a.updatedAt)
    return matches[0].cfg
  } catch {}
  return null
}

async function processDelivery(cfg: TenantMetaConfig, psid: string, delivery: any) {
  const all = await getAllMessages(cfg.tenantId)
  const mids: string[] = Array.isArray(delivery?.mids) ? delivery.mids : []
  for (const m of all) {
    if (m.psid === psid && m.direction !== 'IN' && (!m.deliveredAt) && (mids.includes(m.mid || '') || !m.mid)) {
      m.deliveredAt = nowISO()
    }
  }
  writeJSON(messagesPath(cfg.tenantId), all)
}

async function processRead(cfg: TenantMetaConfig, psid: string, read: any) {
  const watermark = Number(read?.watermark || 0)
  const all = await getAllMessages(cfg.tenantId)
  for (const m of all) {
    if (m.psid === psid && m.direction !== 'IN' && !m.readByUserAt) {
      const ts = new Date(m.createdAt).getTime()
      if (!watermark || ts <= watermark) m.readByUserAt = nowISO()
    }
  }
  writeJSON(messagesPath(cfg.tenantId), all)
}

async function processEcho(_cfg: TenantMetaConfig, _psid: string, _msg: any) {
  // Por ahora solo evitamos dobles
}

async function processCustomerInformation(cfg: TenantMetaConfig, eventPSID: string, value: any): Promise<void> {
  const source = value?.customer_information || value?.customerInformation || value?.customer || value?.profile || value?.user || value || {}
  const psid = String(eventPSID || value?.sender?.id || value?.psid || value?.user_id || value?.userId || source?.id || '')
  if (!psid) return

  const firstName = String(source?.first_name || source?.firstName || value?.first_name || value?.firstName || '').trim()
  const lastName = String(source?.last_name || source?.lastName || value?.last_name || value?.lastName || '').trim()
  const fullName = String(source?.name || value?.name || '').trim()
  const pieces = fullName.split(/\s+/).filter(Boolean)
  const resolvedFirstName = firstName || pieces.shift() || ''
  const resolvedLastName = lastName || pieces.join(' ')
  const profilePic = String(source?.profile_pic || source?.profilePic || value?.profile_pic || value?.profilePic || '').trim()
  if (!resolvedFirstName && !resolvedLastName && !profilePic) return

  const messages = await getAllMessages(cfg.tenantId)
  let changed = false
  for (const row of messages) {
    if (row.psid !== psid) continue
    if (resolvedFirstName) row.userFirstName = resolvedFirstName
    if (resolvedLastName) row.userLastName = resolvedLastName
    if (profilePic) row.userProfilePic = profilePic
    changed = true
  }
  if (changed) writeJSON(messagesPath(cfg.tenantId), messages)
}

const processingInboundMids = new Set<string>()

async function processIncomingText(
  cfg: TenantMetaConfig,
  psid: string,
  message: any,
  _pageId: string,
  referral?: MetaReferral,
): Promise<void> {
  const text = String(message?.text || '')
  const attachments: any[] = Array.isArray(message?.attachments) ? message.attachments : []
  const mid = String(message?.mid || crypto.randomUUID())
  const pageId = cfg.pageId || _pageId || 'unknown-page'
  const dedupeKey = `${cfg.tenantId}:${mid}`
  if (processingInboundMids.has(dedupeKey)) return
  const existing = (await getAllMessages(cfg.tenantId)).some((m) => m.direction === 'IN' && m.mid === mid)
  if (existing) return
  processingInboundMids.add(dedupeKey)

  try {
    try { await ensureTenantFacebookConnection(cfg.tenantId) } catch {}
    let profile: PSIDProfile = {}
    if (cfg.pageAccessToken) profile = await fetchPSIDProfile(cfg.pageAccessToken, psid)
    const inMsg: MetaMessageRow = {
      id: crypto.randomUUID(), tenantId: cfg.tenantId, pageId, psid, mid,
      userFirstName: profile.first_name, userLastName: profile.last_name,
      userProfilePic: profile.profile_pic, direction: 'IN',
      content: text || (attachments?.length ? `[Adjunto: ${attachments[0]?.type}]` : ''),
      attachments: attachments.length ? attachments : undefined, referral,
      sentToUser: false, createdAt: nowISO(),
    }
    await saveMessage(cfg.tenantId, inMsg)
    const customerName = [profile.first_name, profile.last_name].filter(Boolean).join(' ').trim() || `Cliente ${psid.slice(-6)}`
    void getMessagesByPSID(cfg.tenantId, psid)
      .then((history) => maybeAutoConfirmRegistration(cfg.tenantId, psid, customerName, history))
      .catch((error) => console.error('[meta] payment auto-confirm failed', error))
    if (cfg.state !== 'START') return

    // No responder de inmediato: esperar por si el cliente sigue escribiendo.
    // Se agenda en cuanto llega el mensaje para invalidar cualquier respuesta en curso.
    scheduleBotReply(cfg.tenantId, psid, { pageId, profile, referral })
  } finally {
    processingInboundMids.delete(dedupeKey)
  }
}

// =========================
// Agrupación de mensajes seguidos (debounce por conversación)
// =========================
// Si el cliente manda varios mensajes seguidos, se espera a que deje de escribir
// y se genera UNA sola respuesta con todos ellos
const REPLY_DEBOUNCE_MS = (() => {
  const parsed = Number.parseInt(process.env.META_REPLY_DEBOUNCE_MS?.trim() || '', 10)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 6000
})()

type PendingReply = {
  timer: ReturnType<typeof setTimeout> | null
  generation: number
  pageId: string
  profile: PSIDProfile
  referral?: MetaReferral
}

const pendingReplies = new Map<string, PendingReply>()

function pendingReplyKey(tenantId: string, psid: string) {
  return `${tenantId}:${psid}`
}

function scheduleBotReply(
  tenantId: string,
  psid: string,
  ctx: { pageId: string; profile: PSIDProfile; referral?: MetaReferral },
) {
  const key = pendingReplyKey(tenantId, psid)
  const pending: PendingReply = pendingReplies.get(key) ?? { timer: null, generation: 0, ...ctx }
  if (pending.timer) clearTimeout(pending.timer)

  // Cada mensaje nuevo invalida cualquier respuesta en curso de esta conversación
  pending.generation += 1
  pending.pageId = ctx.pageId
  pending.profile = ctx.profile
  pending.referral = ctx.referral ?? pending.referral

  const generation = pending.generation
  pending.timer = setTimeout(() => {
    pending.timer = null
    replyToPendingMessages(tenantId, psid, generation).catch((e) => {
      console.error('[meta] reply error', e?.message || e)
    })
  }, REPLY_DEBOUNCE_MS)
  pendingReplies.set(key, pending)
}

function isReplyStale(tenantId: string, psid: string, generation: number) {
  return pendingReplies.get(pendingReplyKey(tenantId, psid))?.generation !== generation
}

async function replyToPendingMessages(tenantId: string, psid: string, generation: number): Promise<void> {
  const key = pendingReplyKey(tenantId, psid)
  const pending = pendingReplies.get(key)
  if (!pending || isReplyStale(tenantId, psid, generation)) return
  const { pageId, profile, referral } = pending

  // El bot pudo pausarse durante la espera
  const cfg = await getTenantMetaConfig(tenantId)
  if (cfg.state !== 'START') {
    pendingReplies.delete(key)
    return
  }

  // Mensajes sin responder = los IN posteriores a la última salida (bot o humano)
  const chatHistory = await getMessagesByPSID(tenantId, psid)
  let lastOutIndex = -1
  chatHistory.forEach((m, i) => { if (m.direction !== 'IN') lastOutIndex = i })
  const unanswered = chatHistory.slice(lastOutIndex + 1).filter((m) => m.direction === 'IN')
  if (!unanswered.length) {
    pendingReplies.delete(key)
    return
  }
  const text = unanswered.map((m) => m.content.trim()).filter(Boolean).join('\n')
  const mid = unanswered[unanswered.length - 1].mid

  // Historial previo para el LLM, sin las respuestas bloqueadas que el cliente nunca recibió
  const llmHistory: Array<{ role: 'user' | 'assistant'; content: string }> = chatHistory
    .slice(0, lastOutIndex + 1)
    .filter((m) => !m.blockedByAutocurator)
    .map((m) => ({
      role: (m.direction === 'IN' ? 'user' : 'assistant') as 'user' | 'assistant',
      content: m.content,
    }))
    .slice(-20)

  // 5) Cargar workspace/prompt del tenant
  let prompt = ''
  try {
    const ws = await loadDbWorkspace(cfg.tenantId)
    prompt = (ws as any)?.prompt || ''
  } catch {}
  if (!prompt) prompt = 'Eres un asistente de atención a clientes.'

  // 6) Invocar LLM (internamente ya corre el juez síncrono y devuelve autoEval)
  let answer = ''
  let autoEval: any = null
  try {
    const res: any = await generateDbAgentAnswer({
      tenantId: cfg.tenantId,
      prompt,
      message: text,
      history: llmHistory as any,
      referralContext: referralContextText(referral),
      psid,
      triggerMessageId: mid,
    })
    answer = typeof res === 'string' ? res : String(res?.answer || res?.text || '')
    autoEval = res?.autoEval || null
  } catch (e: any) {
    console.error('[meta] LLM error', e?.message || e)
    // Fail closed: si no se pudo generar y validar una respuesta respaldada,
    // no se envía un mensaje que pueda aparentar falta de información.
    answer = ''
    autoEval = {
      id: '',
      category: 'judge_failed',
      judgeReason: `Excepción en generateDbAgentAnswer: ${e?.message || String(e)}`.slice(0, 600),
      blocked: true,
    }
    try {
      const saved = await createAutoEval(cfg.tenantId, {
        psid,
        triggerMessageId: mid,
        triggerMessageText: text,
        botAnswerText: answer,
        category: 'judge_failed',
        judgeReason: 'No se envió respuesta porque falló la generación o validación de una respuesta respaldada.',
        matchedBlocks: [],
      })
      autoEval.id = saved.id
    } catch {}
  }

  const blockedByAutocurator = !!autoEval?.blocked
  const unsafeFallback = !answer.trim() || /no cuento con la información|whatsapp de mi superior/i.test(answer)
  if (!blockedByAutocurator && unsafeFallback) {
    autoEval = {
      ...(autoEval || {}),
      category: 'noinfo',
      blocked: true,
      judgeReason: 'Respuesta bloqueada porque no contiene información respaldada o usa una derivación de falta de información.',
    }
  }
  const evalCategory = autoEval?.category || undefined
  const evalId = autoEval?.id || undefined
  const evalReason = autoEval?.judgeReason || ''
  const effectiveBlockedByAutocurator = blockedByAutocurator || unsafeFallback

  // Si el cliente escribió de nuevo mientras se generaba, esta respuesta ya no aplica:
  // la siguiente ronda responderá a todos los mensajes juntos.
  if (isReplyStale(tenantId, psid, generation)) {
    console.log(`[meta] respuesta descartada para PSID ${psid}: llegó un mensaje nuevo durante la generación`)
    return
  }
  pendingReplies.delete(key)
  // Hora de la respuesta = momento de esta revisión, no el de fin del envío: un mensaje
  // que llegue mientras se envía queda después de la respuesta y se atiende en la siguiente ronda.
  const replyCreatedAt = nowISO()

  // 7) TEST MODE: NO ENVIAR. Guardar OUT_BOT sentToUser=false
  if (cfg.testMode) {
    const contentForLog = effectiveBlockedByAutocurator
      ? `[🧪 TEST MODE · BLOQUEADO POR AUTO-CURADOR · ${String(evalCategory).toUpperCase()}]\n${evalReason}\n--- Respuesta original no enviada ---\n${answer || '(sin texto)'}`
      : answer
    const outMsg: MetaMessageRow = {
      id: crypto.randomUUID(),
      tenantId: cfg.tenantId,
      pageId,
      psid,
      userFirstName: profile.first_name,
      userLastName: profile.last_name,
      userProfilePic: profile.profile_pic,
      direction: 'OUT_BOT',
      content: contentForLog,
      sentToUser: false,
      createdAt: replyCreatedAt,
      testMode: true,
      blockedByAutocurator: effectiveBlockedByAutocurator,
      autoEvalId: evalId,
      autoEvalCategory: evalCategory,
    }
    await saveMessage(cfg.tenantId, outMsg)
    console.log(
      `[meta] TEST MODE ON: NOT sending to PSID ${psid}. Tenant=${cfg.tenantId} pageName=${cfg.pageName || cfg.pageId}. `
      + `Answer length=${answer.length} chars. Badge 🧪 TEST NO ENVIADO. blocked=${blockedByAutocurator} cat=${evalCategory}`,
    )
    return
  }

  // 8) AUTO-CURADOR: si fue bloqueado (error / noinfo / judge_failed),
  //    NO ENVIAR NADA al cliente (silencio total). Guardar en el historial con
  //    etiqueta de bloqueado para que el humano lo vea y responda manualmente.
  if (effectiveBlockedByAutocurator) {
    const visibleContent =
      `[⛔ BLOQUEADO POR AUTO-CURADOR · ${String(evalCategory).toUpperCase()}]\n`
      + `Motivo: ${evalReason || '(sin justificación)'}\n`
      + `--- Respuesta original no enviada al cliente ---\n`
      + (answer || '(sin texto)')
    const outMsg: MetaMessageRow = {
      id: crypto.randomUUID(),
      tenantId: cfg.tenantId,
      pageId,
      psid,
      userFirstName: profile.first_name,
      userLastName: profile.last_name,
      userProfilePic: profile.profile_pic,
      direction: 'OUT_BOT',
      content: visibleContent,
      sentToUser: false,
      createdAt: replyCreatedAt,
      blockedByAutocurator: true,
      autoEvalId: evalId,
      autoEvalCategory: evalCategory,
    }
    await saveMessage(cfg.tenantId, outMsg)
    console.log(
      `[meta] AUTO-CURADOR bloqueó respuesta para PSID ${psid}. Tenant=${cfg.tenantId} category=${evalCategory}. NO ENVIADO.`,
    )
    return
  }

  // 9) START + no test + no bloqueado: enviar via Send API
  if (!cfg.pageAccessToken) {
    const outMsg: MetaMessageRow = {
      id: crypto.randomUUID(),
      tenantId: cfg.tenantId,
      pageId,
      psid,
      direction: 'OUT_BOT',
      content: answer,
      sentToUser: false,
      createdAt: replyCreatedAt,
      blockedByAutocurator: false,
      autoEvalId: evalId,
      autoEvalCategory: evalCategory,
      sendError: 'No hay página enlazada o token de envío configurado',
    }
    await saveMessage(cfg.tenantId, outMsg)
    return
  }

  const sent = await sendTextMessage(cfg.pageAccessToken, psid, answer)
  const outMsg: MetaMessageRow = {
    id: crypto.randomUUID(),
    tenantId: cfg.tenantId,
    pageId,
    psid,
    mid: sent.mid,
    userFirstName: profile.first_name,
    userLastName: profile.last_name,
    userProfilePic: profile.profile_pic,
    direction: 'OUT_BOT',
    content: answer,
    sentToUser: !sent.error,
    createdAt: replyCreatedAt,
    blockedByAutocurator: false,
    autoEvalId: evalId,
    autoEvalCategory: evalCategory,
    sendError: sent.error,
  }
  await saveMessage(cfg.tenantId, outMsg)
}

// =========================
// Manual admin send
// =========================
export async function adminSendMessage(
  user: DbAuthUser,
  psid: string,
  text: string,
): Promise<{ success: boolean; mid?: string; error?: string }> {
  const cfg = await ensureTenantFacebookConnection(user.tenantId)
  if (!cfg.pageAccessToken) return { success: false, error: 'No hay página enlazada' }
  const sent = await sendTextMessage(cfg.pageAccessToken, psid, text)
  const profile = await fetchPSIDProfile(cfg.pageAccessToken, psid)
  const outMsg: MetaMessageRow = {
    id: crypto.randomUUID(),
    tenantId: user.tenantId,
    pageId: cfg.pageId || 'unknown-page',
    psid,
    mid: sent.mid,
    userFirstName: profile.first_name,
    userLastName: profile.last_name,
    userProfilePic: profile.profile_pic,
    direction: 'OUT_HUMAN',
    content: text,
    sentToUser: !sent.error,
    createdAt: nowISO(),
    sendError: sent.error,
  }
  await saveMessage(user.tenantId, outMsg)
  return sent.error ? { success: false, error: sent.error } : { success: true, mid: sent.mid }
}

// =========================
// OAuth Login URLs
// =========================
export function buildOAuthLoginURL(tenantId: string, redirectFrontendSuccess = '/settings?meta=1'): string {
  const state = Buffer.from(JSON.stringify({ t: tenantId, n: crypto.randomBytes(6).toString('hex'), r: redirectFrontendSuccess })).toString('base64url')
  // ads_management includes read access to ad accounts and ads. Meta may not
  // expose ads_read for this app's current use case, so request the permission
  // that is actually available and include its Page permission dependency.
  const scope = 'pages_show_list,pages_messaging,pages_manage_metadata,pages_read_engagement,public_profile,ads_management'
  return `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth`
    + `?client_id=${encodeURIComponent(APP_ID)}`
    + `&redirect_uri=${encodeURIComponent(OAUTH_REDIRECT)}`
    + `&state=${encodeURIComponent(state)}`
    + `&response_type=code`
    + `&scope=${encodeURIComponent(scope)}`
}

export async function exchangeCodeForUserToken(code: string): Promise<{ access_token: string; token_type?: string; expires_in?: number } | null> {
  try {
    const url = `https://graph.facebook.com/${GRAPH_VERSION}/oauth/access_token`
      + `?client_id=${encodeURIComponent(APP_ID)}`
      + `&redirect_uri=${encodeURIComponent(OAUTH_REDIRECT)}`
      + `&client_secret=${encodeURIComponent(APP_SECRET)}`
      + `&code=${encodeURIComponent(code)}`
    const r = await fetch(url)
    const data = await r.json() as any
    if (!r.ok || data?.error) return null
    return data
  } catch { return null }
}

export async function exchangeLongLivedUserToken(shortLivedToken: string): Promise<{ access_token: string; token_type?: string; expires_in?: number } | null> {
  try {
    const url = `https://graph.facebook.com/${GRAPH_VERSION}/oauth/access_token`
      + `?grant_type=fb_exchange_token`
      + `&client_id=${encodeURIComponent(APP_ID)}`
      + `&client_secret=${encodeURIComponent(APP_SECRET)}`
      + `&fb_exchange_token=${encodeURIComponent(shortLivedToken)}`
    const r = await fetch(url)
    const data = await r.json() as any
    if (!r.ok || data?.error) return null
    return data
  } catch { return null }
}

export async function listUserPages(longLivedUserToken: string): Promise<{ success: boolean; pages: any[]; error?: string }> {
  try {
    const url = `${GRAPH_BASE}/me/accounts?fields=id,name,access_token,category,cover,picture{url}&access_token=${encodeURIComponent(longLivedUserToken)}`
    const r = await fetch(url)
    const data = await r.json() as any
    if (!r.ok || data?.error) {
      const why = String(data?.error?.message || data?.error?.error_user_msg || `HTTP ${r.status} Graph API /me/accounts`)
      console.warn('[metaMessenger] listUserPages Graph error:', why, data?.error || null)
      const code = Number(data?.error?.code)
      if (code === 4 || data?.error?.is_transient || r.status === 429 || r.status >= 500) {
        return {
          success: false,
          pages: [],
          error: 'Meta limitó temporalmente las consultas de la app (#4). Espera a que se libere el límite y pulsa “Reintentar consulta de páginas”; no vuelvas a iniciar sesión todavía.',
        }
      }
      return { success: false, pages: [], error: why }
    }
    if (!Array.isArray(data?.data)) {
      return { success: false, pages: [], error: 'Respuesta /me/accounts inválida.' }
    }
    return { success: true, pages: data.data }
  } catch (e: any) {
    const err = e?.message ? String(e.message) : 'Error de red al consultar /me/accounts'
    console.warn('[metaMessenger] listUserPages exception:', err)
    return { success: false, pages: [], error: err }
  }
}

export async function subscribePageToApp(pageAccessToken: string): Promise<boolean> {
  try {
    const url = `${GRAPH_BASE}/me/subscribed_apps?subscribed_fields=messages,messaging_postbacks,messaging_optins,messaging_optouts,message_reads,message_echoes,message_deliveries,messaging_referrals,messaging_customer_information&access_token=${encodeURIComponent(pageAccessToken)}`
    const r = await fetch(url, { method: 'POST' })
    const data = await r.json() as any
    return Boolean(data?.success)
  } catch { return false }
}

// =========================
// Token health & renovación preventiva (Solución: conexión no se pierde)
// =========================

type DebugTokenInfo = {
  isValid: boolean
  type?: string
  expires_at?: number
  scopes?: string[]
  granterScopes?: string[]
  error?: string
}

const DEBUG_TOKEN_CACHE_MS = 5 * 60 * 1000
const debugTokenCache = new Map<string, { expiresAt: number; value: DebugTokenInfo | null }>()

/**
 * Valida un access_token (page o user) contra debug_token y retorna
 * su info vigente (scopes, expire_at, type). Si es inválido/expirado retorna null.
 */
export async function debugAccessToken(accessToken: string): Promise<DebugTokenInfo | null> {
  if (!accessToken) return null
  const at = String(accessToken).trim()
  if (!at) return null
  const cached = debugTokenCache.get(at)
  if (cached && cached.expiresAt > Date.now()) return cached.value
  const remember = (value: DebugTokenInfo | null, ttl = DEBUG_TOKEN_CACHE_MS) => {
    if (debugTokenCache.size > 1000) {
      const now = Date.now()
      for (const [key, entry] of debugTokenCache) if (entry.expiresAt <= now) debugTokenCache.delete(key)
      if (debugTokenCache.size > 1000) debugTokenCache.clear()
    }
    debugTokenCache.set(at, { expiresAt: Date.now() + ttl, value })
    return value
  }
  try {
    const appToken = APP_ID && APP_SECRET ? `${APP_ID}|${APP_SECRET}` : ''
    if (!appToken) return remember({ isValid: true }) // sin credenciales app-wide no podemos debug, asumir ok
    const url = `${GRAPH_BASE}/debug_token?input_token=${encodeURIComponent(at)}&access_token=${encodeURIComponent(appToken)}`
    const r = await fetch(url)
    const data = await r.json() as any
    const d = data?.data
    if (!r.ok || data?.error || !d || d?.error) {
      const code = Number(data?.error?.code || d?.error?.code)
      if (code === 4 || code === 17 || data?.error?.is_transient || r.status === 429 || r.status >= 500) {
        console.warn(`[meta] debug_token temporarily unavailable (code=${code || r.status}); preserving page connection`)
      }
      // A failed inspection does not prove revocation; cache briefly to avoid
      // hammering Graph API while this app is rate limited or unreachable.
      return remember(null, code === 4 || code === 17 || r.status === 429 || r.status >= 500 ? 60_000 : 30_000)
    }
    return remember({
      isValid: Boolean(d.is_valid),
      type: d.type,
      expires_at: typeof d.expires_at === 'number' ? d.expires_at : undefined,
      scopes: Array.isArray(d.scopes) ? d.scopes : [],
      granterScopes: Array.isArray(d.granted_scopes) ? d.granted_scopes : [],
    })
  } catch {
    return remember(null, 60_000)
  }
}

export async function fetchCurrentPageAds(cfg: TenantMetaConfig): Promise<{
  ads: Array<{ id: string; name: string; status: string; campaign?: string; title?: string; body?: string; description?: string; callToAction?: string }>
  accountsChecked: number
}> {
  const token = String(cfg.userLongLivedToken || '').trim()
  if (!token) throw new Error('Configuración inválida: vuelve a conectar Facebook para autorizar el acceso a cuentas publicitarias.')
  const tokenInfo = await debugAccessToken(token)
  if (tokenInfo?.isValid === false) throw new Error('Configuración inválida: la autorización de Facebook venció. Vuelve a conectar la cuenta.')
  const adReadPermissions = new Set([...(tokenInfo?.scopes || []), ...(tokenInfo?.granterScopes || [])])
  if (tokenInfo?.scopes && !adReadPermissions.has('ads_read') && !adReadPermissions.has('ads_management')) {
    throw new Error('Facebook no concedió ads_management (o ads_read). Vuelve a conectar Facebook y acepta el permiso de administración de anuncios.')
  }

  async function graphGet(url: URL) {
    let current: URL | null = url
    const pages: any[] = []
    for (let page = 0; current && page < 20; page += 1) {
      if (current.hostname !== 'graph.facebook.com') throw new Error('Meta devolvió una página de resultados inválida.')
      const response = await fetch(current)
      const payload = await response.json() as any
      if (!response.ok || payload?.error) {
        const code = payload?.error?.code
        const message = String(payload?.error?.error_user_msg || payload?.error?.message || `HTTP ${response.status}`)
        if (code === 10 || code === 100 || /permission|ads_read|ads_management|advertising account/i.test(message)) {
          throw new Error('Meta rechazó la consulta de anuncios. Confirma que autorizaste ads_management y que tu usuario tiene acceso a la cuenta publicitaria; después vuelve a conectar Facebook.')
        }
        throw new Error(`Meta no pudo consultar los anuncios: ${message.slice(0, 300)}`)
      }
      if (Array.isArray(payload?.data)) pages.push(...payload.data)
      const next = payload?.paging?.next
      current = typeof next === 'string' ? new URL(next) : null
    }
    return pages
  }

  const accountsUrl = new URL(`${GRAPH_BASE}/me/adaccounts`)
  accountsUrl.searchParams.set('fields', 'id,name,account_status')
  accountsUrl.searchParams.set('limit', '100')
  accountsUrl.searchParams.set('access_token', token)
  const accounts = await graphGet(accountsUrl)
  const activeStatuses = ['ACTIVE', 'PAUSED', 'IN_PROCESS', 'WITH_ISSUES']
  const effectiveStatuses = JSON.stringify(activeStatuses)
  const ads: Array<{ id: string; name: string; status: string; campaign?: string; title?: string; body?: string; description?: string; callToAction?: string }> = []

  for (const account of accounts) {
    const accountId = String(account?.id || '')
    if (!accountId) continue
    const adsUrl = new URL(`${GRAPH_BASE}/${accountId}/ads`)
    adsUrl.searchParams.set('fields', 'id,name,status,effective_status,campaign{name},creative{id,name,title,body,link_description,call_to_action_type,actor_id,object_story_id,effective_object_story_id,object_story_spec,asset_feed_spec}')
    adsUrl.searchParams.set('effective_status', effectiveStatuses)
    adsUrl.searchParams.set('limit', '100')
    adsUrl.searchParams.set('access_token', token)
    const accountAds = await graphGet(adsUrl)
    for (const ad of accountAds) {
      const creative = ad?.creative || {}
      const storySpec = creative.object_story_spec || {}
      const pageId = String(cfg.pageId || '')
      const storyId = String(creative.effective_object_story_id || creative.object_story_id || '')
      const belongsToPage = !pageId || String(creative.actor_id || '') === pageId
        || String(storySpec.page_id || '') === pageId || storyId.startsWith(`${pageId}_`)
      if (!belongsToPage) continue

      const linkData = storySpec.link_data || {}
      const videoData = storySpec.video_data || {}
      const photoData = storySpec.photo_data || {}
      const dynamic = creative.asset_feed_spec || {}
      const collect = (values: any[]) => Array.from(new Set(values.flatMap((value) => {
        if (typeof value === 'string') return [value.trim()]
        if (Array.isArray(value)) return value.map((item) => typeof item === 'string' ? item.trim() : String(item?.text || '').trim())
        return []
      }).filter(Boolean))).join('\n')

      ads.push({
        id: String(ad?.id || ''),
        name: String(ad?.name || creative.name || 'Anuncio sin nombre'),
        status: String(ad?.effective_status || ad?.status || 'UNKNOWN'),
        campaign: String(ad?.campaign?.name || ''),
        title: collect([creative.title, linkData.name, videoData.title, photoData.title, dynamic.titles]),
        body: collect([creative.body, linkData.message, videoData.message, photoData.caption, dynamic.bodies]),
        description: collect([creative.link_description, linkData.description, dynamic.descriptions]),
        callToAction: String(creative.call_to_action_type || linkData.call_to_action?.type || ''),
      })
    }
  }

  const uniqueAds = Array.from(new Map(ads.filter((ad) => ad.id).map((ad) => [ad.id, ad])).values())
  return { ads: uniqueAds, accountsChecked: accounts.length }
}

/**
 * Refresca un PAGE access_token a uno nuevo sin caducidad (siempre que se tenga
 * un User Long-Lived Token vigente asociado al tenant). Documentación META:
 * page access tokens generados con Graph API >= v18 desde un LLT caducan nunca
 * siempre que el user LL token siga vigente. Por seguridad cada N días lo re-swap
 * de todas formas y guardamos pageTokenExpiresAt ~60 días.
 */
export async function refreshPageAccessToken(cfg: TenantMetaConfig): Promise<{
  success: boolean
  pageAccessToken?: string
  pageTokenExpiresAt?: string
  error?: string
}> {
  if (!cfg.userLongLivedToken || !cfg.pageId) return { success: false, error: 'missing_llt_or_pageid' }
  try {
    const url = `${GRAPH_BASE}/${cfg.pageId}?fields=access_token,name,category,cover,picture{url}&access_token=${encodeURIComponent(cfg.userLongLivedToken)}`
    const r = await fetch(url)
    const data = await r.json() as any
    if (!r.ok || data?.error || !data?.access_token) {
      return { success: false, error: data?.error?.message || `HTTP ${r.status} refresh_page_token` }
    }
    const expiry = new Date(Date.now() + 1000 * 60 * 60 * 24 * 60) // 60 días
    return {
      success: true,
      pageAccessToken: String(data.access_token),
      pageTokenExpiresAt: expiry.toISOString(),
    }
  } catch (e: any) {
    return { success: false, error: e?.message || 'network' }
  }
}

/**
 * Extiende un User Long-Lived Token existente MÁS su fecha de caducidad
 * (Graph API v22 renueva la caducidad al hacer GET /oauth/access_token
 * ?grant_type=fb_exchange_token cuando el actual sigue vigente).
 */
export async function renewUserLongLivedToken(currentLLT: string): Promise<{
  success: boolean
  access_token?: string
  expires_at?: string
  error?: string
}> {
  if (!currentLLT) return { success: false, error: 'no_llt' }
  try {
    const url = `${GRAPH_BASE}/oauth/access_token?grant_type=fb_exchange_token`
      + `&client_id=${encodeURIComponent(APP_ID)}`
      + `&client_secret=${encodeURIComponent(APP_SECRET)}`
      + `&fb_exchange_token=${encodeURIComponent(currentLLT)}`
    const r = await fetch(url)
    const data = await r.json() as any
    if (!r.ok || data?.error) {
      return { success: false, error: data?.error?.message || `HTTP ${r.status}` }
    }
    const secondsExpireIn = typeof data?.expires_in === 'number' ? data.expires_in : 60 * 24 * 60 * 60
    return {
      success: true,
      access_token: String(data.access_token),
      expires_at: new Date(Date.now() + secondsExpireIn * 1000).toISOString(),
    }
  } catch (e: any) {
    return { success: false, error: e?.message || 'network' }
  }
}

/**
 * Health-check preventivo de la conexión Facebook de UN tenant.
 * Esta función DEBE ser llamada antes de responder /api/meta/status,
 * al recibir un webhook, y en un scheduled job periódico en app.ts.
 *
 * Política:
 * - User LLT: si le quedan < 15 días → renovar.
 * - Page Access Token: si le quedan < 14 días → refrescar.
 * - Webhook subscribe: si no está suscrito → re-suscribir.
 * - Fallback: si el Page Access Token es invalidado (permisos revocados en FB),
 *   limpiar pageId/pageAccessToken + webhookSubscribed=false para que el frontend
 *   muestre "No conectado" honestamente y el usuario vuelva a OAuth.
 *
 * Retorna el tenant cfg actualizado (y ya lo persiste a disco).
 */
export async function ensureTenantFacebookConnection(tenantId: string): Promise<TenantMetaConfig> {
  const cfg = await getTenantMetaConfig(tenantId)
  const nowMs = Date.now()
  const ONE_DAY_MS = 24 * 60 * 60 * 1000

  // 1. Renovar User LLT si: no hay extendsAt O le quedan < 15 días
  if (cfg.userLongLivedToken) {
    let needRenew = !cfg.userLLExtendsAt
    if (!needRenew && cfg.userLLExtendsAt) {
      const leftMs = new Date(cfg.userLLExtendsAt).getTime() - nowMs
      needRenew = leftMs < 15 * ONE_DAY_MS
    }
    if (needRenew) {
      const r = await renewUserLongLivedToken(cfg.userLongLivedToken)
      if (r.success && r.access_token) {
        Object.assign(cfg, {
          userLongLivedToken: r.access_token,
          userLLExtendsAt: r.expires_at || cfg.userLLExtendsAt,
        })
        await saveTenantMetaConfig(cfg.tenantId, {
          userLongLivedToken: cfg.userLongLivedToken,
          userLLExtendsAt: cfg.userLLExtendsAt,
        })
      }
    }
  }

  // 2. Refrescar Page Access Token si hay pageId+userLLT y (falta expiry O expiry <14 días)
  if (cfg.pageId && cfg.userLongLivedToken) {
    let needRefresh = !cfg.pageAccessToken || !cfg.pageTokenExpiresAt
    if (!needRefresh && cfg.pageTokenExpiresAt) {
      const leftMs = new Date(cfg.pageTokenExpiresAt).getTime() - nowMs
      needRefresh = leftMs < 14 * ONE_DAY_MS
    }
    if (needRefresh) {
      const r = await refreshPageAccessToken(cfg)
      if (r.success && r.pageAccessToken) {
        Object.assign(cfg, {
          pageAccessToken: r.pageAccessToken,
          pageTokenExpiresAt: r.pageTokenExpiresAt,
        })
        await saveTenantMetaConfig(cfg.tenantId, {
          pageAccessToken: cfg.pageAccessToken,
          pageTokenExpiresAt: cfg.pageTokenExpiresAt,
        })
      }
    }
  }

  // 3. Validar honestamente Page Access Token con debug_token si existe
  if (cfg.pageAccessToken) {
    const dbg = await debugAccessToken(cfg.pageAccessToken)
    // A rate limit, network failure, or app configuration error is not proof
    // of revocation. Preserve the page connection and skip further Graph calls.
    if (!dbg) return cfg
    const pageTokenInvalid = dbg && !dbg.isValid
    if (pageTokenInvalid) {
      console.warn(`[meta] ensureTenantFacebookConnection: tenant=${cfg.tenantId} pageAccessToken INVALIDADO: ${dbg?.error || 'revoked'}. Limpiando pageId para marcar desconectado honestamente.`)
      const cleared: Partial<TenantMetaConfig> = {
        webhookSubscribed: false,
      }
      // Solo limpiar pageId/name/token si realmente NO es válido (error permanente).
      // Si es fallo de red (dbg==null) lo dejamos.
      if (dbg !== null && !dbg.isValid && dbg.error !== 'network') {
        cleared.pageId = undefined as any
        cleared.pageName = undefined as any
        cleared.pageAccessToken = undefined as any
        cleared.pageProfilePic = undefined as any
        cleared.pageTokenExpiresAt = undefined as any
      }
      Object.assign(cfg, cleared)
      await saveTenantMetaConfig(cfg.tenantId, cleared)
    } else {
      // El token sigue válido → asegurarse webhookSubscribed true
      if (!cfg.webhookSubscribed || cfg.webhookSubscriptionVersion !== WEBHOOK_SUBSCRIPTION_VERSION) {
        const ok = await subscribePageToApp(cfg.pageAccessToken)
        cfg.webhookSubscribed = ok
        if (ok) {
          cfg.webhookSubscriptionVersion = WEBHOOK_SUBSCRIPTION_VERSION
          void saveTenantMetaConfig(cfg.tenantId, { webhookSubscribed: true, webhookSubscriptionVersion: WEBHOOK_SUBSCRIPTION_VERSION })
        }
      }
      // Propagar expires_at si debug_token nos lo dice (más preciso).
      if (dbg?.expires_at && cfg.pageTokenExpiresAt) {
        const real = new Date(dbg.expires_at * 1000)
        if (real.getTime() < new Date(cfg.pageTokenExpiresAt).getTime()) {
          cfg.pageTokenExpiresAt = real.toISOString()
          void saveTenantMetaConfig(cfg.tenantId, { pageTokenExpiresAt: cfg.pageTokenExpiresAt })
        }
      }
    }
  }

  return cfg
}
