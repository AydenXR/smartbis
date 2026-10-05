import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { Request, Response, NextFunction } from 'express'
import dotenv from 'dotenv'
import { generateDbAgentAnswer } from './dbChat.js'
import { type DbAuthUser, loadDbWorkspace } from './dbWorkspace.js'

dotenv.config()
dotenv.config({ path: '.env.local', override: true })

const APP_ID = process.env.FACEBOOK_APP_ID || ''
const APP_SECRET = process.env.FACEBOOK_APP_SECRET || ''
const VERIFY_TOKEN = process.env.FACEBOOK_WEBHOOK_VERIFY_TOKEN || 'smartbisfacebook_verify_token'
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
          await processIncomingText(cfg, senderPSID, evt.message, pageId)
        } else if (evt?.delivery) {
          await processDelivery(cfg, senderPSID, evt.delivery)
        } else if (evt?.read) {
          await processRead(cfg, senderPSID, evt.read)
        } else if (evt?.message?.is_echo) {
          await processEcho(cfg, senderPSID, evt.message)
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

async function processIncomingText(
  cfg: TenantMetaConfig,
  psid: string,
  message: any,
  _pageId: string,
): Promise<void> {
  const text = String(message?.text || '')
  const attachments: any[] = Array.isArray(message?.attachments) ? message.attachments : []
  const mid = String(message?.mid || crypto.randomUUID())
  const pageId = cfg.pageId || _pageId || 'unknown-page'

  // 0) Pre-health: asegurar vigencia antes de guardar (si falla la conexión al menos guardamos el mensaje)
  try { await ensureTenantFacebookConnection(cfg.tenantId) } catch {}

  // 1) Perfil del PSID (si tenemos token)
  let profile: PSIDProfile = {}
  if (cfg.pageAccessToken) profile = await fetchPSIDProfile(cfg.pageAccessToken, psid)

  // 2) Guardar mensaje IN — multi-tenant estricto: tenantId + pageId + psid
  const inMsg: MetaMessageRow = {
    id: crypto.randomUUID(),
    tenantId: cfg.tenantId,
    pageId,
    psid,
    mid,
    userFirstName: profile.first_name,
    userLastName: profile.last_name,
    userProfilePic: profile.profile_pic,
    direction: 'IN',
    content: text || (attachments?.length ? `[Adjunto: ${attachments[0]?.type}]` : ''),
    attachments: attachments.length ? attachments : undefined,
    sentToUser: false,
    createdAt: nowISO(),
  }
  await saveMessage(cfg.tenantId, inMsg)

  // 3) Evaluar bot state
  if (cfg.state !== 'START') return

  // 4) Construir historial del chat para el LLM
  const chatHistory = await getMessagesByPSID(cfg.tenantId, psid)
  const llmHistory: Array<{ role: 'user' | 'assistant'; content: string }> = chatHistory
    .filter((m) => m.direction !== 'IN' || m.id !== inMsg.id)
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
      psid,
      triggerMessageId: mid,
    })
    answer = typeof res === 'string' ? res : String(res?.answer || res?.text || '')
    autoEval = res?.autoEval || null
  } catch (e: any) {
    console.error('[meta] LLM error', e?.message || e)
    // Fail-closed también ante excepción del bot/llamada: no enviamos nada al cliente,
    // guardamos registro para que el humano atienda.
    autoEval = {
      id: '',
      category: 'judge_failed',
      judgeReason: `Excepción en generateDbAgentAnswer: ${e?.message || String(e)}`.slice(0, 600),
      blocked: true,
    }
    answer = ''
  }

  const blockedByAutocurator = !!autoEval?.blocked
  const evalCategory = autoEval?.category || undefined
  const evalId = autoEval?.id || undefined
  const evalReason = autoEval?.judgeReason || ''

  // 7) TEST MODE: NO ENVIAR. Guardar OUT_BOT sentToUser=false
  if (cfg.testMode) {
    const contentForLog = blockedByAutocurator
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
      createdAt: nowISO(),
      testMode: true,
      blockedByAutocurator,
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
  if (blockedByAutocurator) {
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
      createdAt: nowISO(),
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
      createdAt: nowISO(),
      blockedByAutocurator: false,
      autoEvalId: evalId,
      autoEvalCategory: evalCategory,
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
    createdAt: nowISO(),
    blockedByAutocurator: false,
    autoEvalId: evalId,
    autoEvalCategory: evalCategory,
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
  }
  await saveMessage(user.tenantId, outMsg)
  return sent.error ? { success: false, error: sent.error } : { success: true, mid: sent.mid }
}

// =========================
// OAuth Login URLs
// =========================
export function buildOAuthLoginURL(tenantId: string, redirectFrontendSuccess = '/settings?meta=1'): string {
  const state = Buffer.from(JSON.stringify({ t: tenantId, n: crypto.randomBytes(6).toString('hex'), r: redirectFrontendSuccess })).toString('base64url')
  const scope = 'pages_show_list,pages_messaging,pages_manage_metadata,public_profile'
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
    const url = `${GRAPH_BASE}/me/subscribed_apps?subscribed_fields=messages,messaging_postbacks,messaging_optins,messaging_optouts,message_reads,message_echoes,message_deliveries,messaging_referrals&access_token=${encodeURIComponent(pageAccessToken)}`
    const r = await fetch(url, { method: 'POST' })
    const data = await r.json() as any
    return Boolean(data?.success)
  } catch { return false }
}

// =========================
// Token health & renovación preventiva (Solución: conexión no se pierde)
// =========================

/**
 * Valida un access_token (page o user) contra debug_token y retorna
 * su info vigente (scopes, expire_at, type). Si es inválido/expirado retorna null.
 */
export async function debugAccessToken(accessToken: string): Promise<{
  isValid: boolean
  type?: string
  expires_at?: number
  scopes?: string[]
  granterScopes?: string[]
  error?: string
} | null> {
  if (!accessToken) return null
  const at = String(accessToken).trim()
  if (!at) return null
  try {
    const appToken = APP_ID && APP_SECRET ? `${APP_ID}|${APP_SECRET}` : ''
    if (!appToken) return { isValid: true } // sin credenciales app-wide no podemos debug, asumir ok
    const url = `${GRAPH_BASE}/debug_token?input_token=${encodeURIComponent(at)}&access_token=${encodeURIComponent(appToken)}`
    const r = await fetch(url)
    const data = await r.json() as any
    const d = data?.data
    if (!d) return { isValid: false, error: 'no_data' }
    if (d?.error) return { isValid: false, error: String(d.error?.message || 'debug error') }
    return {
      isValid: Boolean(d.is_valid),
      type: d.type,
      expires_at: typeof d.expires_at === 'number' ? d.expires_at : undefined,
      scopes: Array.isArray(d.scopes) ? d.scopes : [],
      granterScopes: Array.isArray(d.granted_scopes) ? d.granted_scopes : [],
    }
  } catch (e: any) {
    return { isValid: false, error: e?.message || 'network' }
  }
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
      if (!cfg.webhookSubscribed) {
        const ok = await subscribePageToApp(cfg.pageAccessToken)
        cfg.webhookSubscribed = ok
        if (ok) void saveTenantMetaConfig(cfg.tenantId, { webhookSubscribed: true })
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
