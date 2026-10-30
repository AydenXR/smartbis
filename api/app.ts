import express, { type NextFunction, type Request, type Response } from 'express'
import cors from 'cors'
import fs from 'node:fs'
import path from 'node:path'
import { timingSafeEqual } from 'node:crypto'
import dotenv from 'dotenv'
import {
  createDbDocument,
  deleteDbDocument,
  getDbUserFromToken,
  ingestAllDbTenants,
  ingestDbTenantDocuments,
  loadDbWorkspace,
  loginDbAccount,
  registerDbAccount,
  saveDbPrompt,
  updateDbDocument,
  upsertDbDocument,
  type DbAuthUser,
} from './lib/dbWorkspace.js'
import { generateDbAgentAnswer } from './lib/dbChat.js'
import { isUsableCatalogDocumentName } from './lib/catalogDocument.js'
import { getWhatsAppStatus, notifyRegistration, sendWhatsAppTest, setWhatsAppRecipient, startWhatsApp } from './lib/whatsappNotifications.js'
import {
  adminSendMessage,
  buildOAuthLoginURL,
  ensureTenantFacebookConnection,
  exchangeCodeForUserToken,
  exchangeLongLivedUserToken,
  getTenantMetaConfig,
  fetchCurrentPageAds,
  handleWebhookGet,
  handleWebhookPost,
  listChats,
  listUserPages,
  renewUserLongLivedToken,
  saveTenantMetaConfig,
  subscribePageToApp,
  refreshPageAccessToken,
  getMessagesByPSID,
  markChatAsRead,
  deleteChatByPSID,
  getAllMessages,
  type MetaBotState,
} from './lib/metaMessenger.js'
import {
  listBranches,
  upsertBranch,
  deleteBranch,
  getBranch,
  listCatalog,
  getCatalogItem,
  upsertCatalogItem,
  deleteCatalogItem,
  listInventoryLosses,
  createInventoryLoss,
  listPromoGroups,
  getPromoGroup,
  upsertPromoGroup,
  deletePromoGroup,
  listPurchases,
  createPurchase,
  deletePurchase,
  getOpenShift,
  openShift,
  withdrawCash,
  closeShift,
  listSales,
  getSale,
  createSale,
  cancelSale,
  getFrequentProducts,
  listSubusers,
  createSubuser,
  updateSubuser,
  deleteSubuser,
  listAudit,
  syncCatalogFromDocuments,
  appendAudit,
  listTenantMdFiles,
  readTenantMdFile,
  writeTenantMdFile,
  logDocumentEdit,
  upsertItemIntoMd,
  removeItemFromMd,
  parseImportBuffer,
  listAutoEvals,
  getAutoEval,
  getAdministrationConfig,
  setAdministrationConfig,
  type PosRole,
  type PosPurchaseLine,
  type PosInventoryLossReason,
} from './lib/posStore.js'

dotenv.config()

const resolvedEnvFiles = [
  path.resolve(process.cwd(), '.env.local'),
  path.resolve(process.cwd(), 'resources', 'app.asar', '.env.local'),
  path.resolve(process.cwd(), 'resources', 'app.asar.unpacked', '.env.local'),
  path.resolve(process.cwd(), 'app.asar', '.env.local'),
]

const resolvedEnvFile = resolvedEnvFiles.find((file) => fs.existsSync(file))

if (resolvedEnvFile) {
  dotenv.config({ path: resolvedEnvFile, override: true })
} else {
  dotenv.config({ path: '.env.local', override: true })
}

const app: express.Application = express()

app.use(cors())
// Middleware: captura rawBody PARA POST /api/webhooks/facebook (validar firma HMAC Meta)
app.use((req, _res, next) => {
  if (req.path === '/api/webhooks/facebook' && req.method === 'POST') {
    const chunks: Buffer[] = []
    let done = false
    req.on('data', (chunk: Buffer) => {
      if (done) return
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (done) return
      done = true
      const raw = Buffer.concat(chunks)
      ;(req as any).rawBody = raw
      try {
        if (raw.length) req.body = JSON.parse(raw.toString('utf-8'))
      } catch {
        req.body = req.body || {}
      }
      next()
    })
    req.on('error', () => { if (!done) { done = true; next() } })
    return
  }
  next()
})
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true, limit: '10mb' }))

function getBearerToken(req: Request) {
  const authorization = req.headers.authorization?.trim() || ''

  if (!authorization.toLowerCase().startsWith('bearer ')) {
    return ''
  }

  return authorization.slice(7).trim()
}

async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const token = getBearerToken(req)

    if (!token) {
      res.status(401).json({
        error: 'Necesitas iniciar sesion',
      })
      return
    }

    const user = await getDbUserFromToken(token)

    if (!user) {
      res.status(401).json({
        error: 'La sesion ya no es valida',
      })
      return
    }

    res.locals.user = user satisfies DbAuthUser
    res.locals.token = token
    next()
  } catch (error) {
    next(error)
  }
}

// Middleware requireRole(opcional). Si rol=owner/admin permite TODO. Si cashier: solo lo suyo.
function cashierGuard(allowed: PosRole[]) {
  return async function (req: Request, res: Response, next: NextFunction): Promise<void> {
    const user = res.locals.user as DbAuthUser & {
      posRole?: PosRole
      posBranchId?: string
      authKind?: string
      subuserId?: string | number
    }
    if (!user) {
      res.status(401).json({ error: 'Sesion inválida' })
      return
    }
    // --- Owner del tenant (Supabase o posRole=owner) → TODOS los permisos ---
    if (user.authKind === 'tenant_owner' || user.posRole === 'owner') {
      next()
      return
    }
    // Subusuarios: mapear role, default cashier si viene vacío
    const rawRole = (user.posRole as PosRole) || undefined
    const effectiveRole: PosRole = rawRole || 'cashier'
    if (!allowed.includes(effectiveRole)) {
      res.status(403).json({ error: 'No tienes permiso para realizar esta acción' })
      return
    }
    next()
  }
}

// Roles con control de Punto de Venta (inventario, compras, sucursales, catálogo).
// 'admin' se conserva por compatibilidad con cuentas creadas antes de separar los roles.
const POS_ADMIN_ROLES: PosRole[] = ['admin', 'admin_pv']
// Roles con control TOTAL de Atención al cliente (documentos, prompt, chats, pruebas, conexión).
const CS_ADMIN_ROLES: PosRole[] = ['admin', 'admin_cs']
// Roles que pueden administrar chats y documentos (incluye auto-ingesta), pero NO prompt,
// pruebas de chat interno ni la configuración de conexión con Messenger.
const CS_AGENT_ROLES: PosRole[] = ['admin', 'admin_cs', 'cs_agent']
// Ambos tipos de admin pueden crear/gestionar sub-usuarios (Cuentas).
const ANY_ADMIN_ROLES: PosRole[] = ['admin', 'admin_pv', 'admin_cs']
app.get('/api/pos/administration/config', requireAuth, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const user = res.locals.user as DbAuthUser
    res.json({ config: await getAdministrationConfig(user.tenantId) })
  } catch (e) { next(e) }
})
app.put('/api/pos/administration/config', requireAuth, cashierGuard(POS_ADMIN_ROLES), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = res.locals.user as DbAuthUser
    const body = req.body || {}
    const workingDaysByMonth = body.workingDaysByMonth
    if (!workingDaysByMonth || typeof workingDaysByMonth !== 'object' || Array.isArray(workingDaysByMonth) || !Array.isArray(body.expenses)) {
      res.status(400).json({ error: 'Configuración de gastos inválida' }); return
    }
    const calendarEntries = Object.entries(workingDaysByMonth)
    if (calendarEntries.some(([month, days]) => !/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || !Array.isArray(days) || days.some((day: any) => !Number.isInteger(day) || day < 1 || day > 31) || new Set(days as number[]).size !== (days as number[]).length)) {
      res.status(400).json({ error: 'La selección de días laborables no es válida' }); return
    }
    const expenses = body.expenses.map((item: any) => ({ id: String(item?.id || ''), name: String(item?.name || '').trim(), amount: Number(item?.amount) }))
    if (expenses.some((item: any) => !item.id || !item.name || !Number.isFinite(item.amount) || item.amount < 0)) {
      res.status(400).json({ error: 'Revisa los nombres y montos de gastos fijos' }); return
    }
    res.json({ config: await setAdministrationConfig(user.tenantId, { workingDaysByMonth: workingDaysByMonth as Record<string, number[]>, expenses }) })
  } catch (e) { next(e) }
})
// Roles que se pueden asignar al crear/editar un sub-usuario (nunca 'owner').
const ASSIGNABLE_SUBUSER_ROLES: PosRole[] = ['admin', 'admin_pv', 'admin_cs', 'cashier', 'cs_agent']
// Reutiliza la misma lógica de permisos para la zona de Atención al cliente.
const csGuard = cashierGuard

app.get('/api/health', (_req: Request, res: Response): void => {
  res.status(200).json({
    success: true,
    message: 'ok1',
  })
})

app.get('/api/cron/document-ingestion', async (req: Request, res: Response, next: NextFunction) => {
  const expectedSecret = process.env.CRON_SECRET?.trim()
  if (!expectedSecret) {
    res.status(503).json({ error: 'CRON_SECRET no esta configurado' })
    return
  }

  const authorization = req.headers.authorization || ''
  const suppliedSecret = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : ''
  const supplied = Buffer.from(suppliedSecret)
  const expected = Buffer.from(expectedSecret)
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    res.status(401).json({ error: 'No autorizado' })
    return
  }

  try {
    const result = await ingestAllDbTenants()
    res.status(result.failures.length > 0 ? 500 : 200).json(result)
  } catch (error) {
    next(error)
  }
})

type CheckResult = {
  ok: boolean
  warn?: boolean
  label: string
  status?: string
  detail?: string
  latencyMs?: number
  raw?: any
}
async function runWithTimeout<T>(p: Promise<T>, ms: number, fallback: T | null = null): Promise<T | null> {
  let tm: NodeJS.Timeout | null = null
  try {
    return await Promise.race([
      p,
      new Promise<T | null>((resolve) => {
        tm = setTimeout(() => resolve(fallback), ms)
      }),
    ]) as T | null
  } catch {
    return fallback
  } finally {
    if (tm) clearTimeout(tm)
  }
}
app.get('/api/status/overview', requireAuth, async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const user = res.locals.user as DbAuthUser
    const tenantId = String(user.tenantId || '')
    const checks: CheckResult[] = []

    const llmBase = String(process.env.LLM_BASE_URL || process.env.XAI_BASE_URL || '').trim()
    const llmKey = String(process.env.LLM_API_KEY || process.env.XAI_API_KEY || '').trim()
    const llmModel = String(process.env.LLM_MODEL_NAME || process.env.XAI_MODEL || '').trim()
    if (llmBase && llmKey && llmModel) {
      const t0 = Date.now()
      try {
        const testRsp = await runWithTimeout(fetch(llmBase.replace(/\/$/, '') + '/models', {
          method: 'GET',
          headers: { Authorization: `Bearer ${llmKey}` },
        }), 4200, null)
        const ok = !!testRsp && testRsp.ok
        checks.push({
          ok,
          label: /groq/i.test(llmBase) ? 'Groq / API LLM' : 'Proveedor LLM',
          status: ok ? 'Conectado' : 'HTTP no 2xx',
          detail: llmModel + ' · ' + llmBase.replace(/^https?:\/\//, '').split('/')[0],
          latencyMs: Date.now() - t0,
          raw: ok ? undefined : { status: (testRsp as any)?.status },
        })
      } catch (e: any) {
        checks.push({
          ok: false,
          label: 'Proveedor LLM / Groq',
          status: 'Error',
          detail: String(e?.message || e).slice(0, 200),
          latencyMs: Date.now() - t0,
        })
      }
    } else {
      checks.push({
        ok: false,
        warn: true,
        label: 'Proveedor LLM / Groq',
        status: 'No configurado',
        detail: 'Falta LLM_BASE_URL / LLM_API_KEY / LLM_MODEL_NAME en .env',
      })
    }

    const cfg = await runWithTimeout(getTenantMetaConfig(tenantId), 2000, null)
    const linked = Boolean(cfg?.linkedAt || cfg?.pageAccessToken || cfg?.pageId)
    const metaCheck: CheckResult = {
      ok: linked,
      warn: !linked,
      label: 'Meta Graph API',
      status: linked ? 'Página vinculada' : 'Sin vincular',
      detail: linked
        ? [cfg?.pageName || '', cfg?.pageId ? `pageId ${cfg.pageId}` : '', cfg?.webhookSubscribed ? 'webhook ok' : ''].filter(Boolean).join(' · ')
        : 'Abre la sección Conectar Messenger para vincular la página de Facebook/Instagram.',
    }
    if (linked && cfg?.pageAccessToken) {
      const t1 = Date.now()
      try {
        const r = await runWithTimeout(fetch(
          `https://graph.facebook.com/${cfg.graphVersion || 'v22.0'}/me?fields=id,name&access_token=${encodeURIComponent(cfg.pageAccessToken)}`,
        ), 4000, null)
        const fetchR = r as any
        const data = fetchR?.ok ? await fetchR.json?.()?.catch?.(() => null) ?? null : null
        metaCheck.latencyMs = Date.now() - t1
        if (data?.id) {
          metaCheck.ok = true
          metaCheck.status = 'Página OK'
          metaCheck.detail = (cfg.pageName || data.name || 'Página') + ' · id ' + data.id
        } else {
          metaCheck.ok = false
          metaCheck.warn = false
          metaCheck.status = 'Token inválido / expirado'
          metaCheck.detail = 'Refresh del token necesario en Conectar Messenger.'
        }
      } catch (e: any) {
        metaCheck.latencyMs = Date.now() - t1
        metaCheck.status = 'Network error'
        metaCheck.detail = String(e?.message || e).slice(0, 220)
      }
    }
    checks.push(metaCheck)

    const supUrl = String(process.env.SUPABASE_URL || '').trim()
    const supKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY || '').trim()
    if (supUrl && supKey) {
      const t2 = Date.now()
      try {
        const r = await runWithTimeout(fetch(
          supUrl.replace(/\/$/, '') + '/rest/v1/?apikey=' + encodeURIComponent(supKey),
          { headers: { apikey: supKey, Authorization: `Bearer ${supKey}` } },
        ), 4000, null)
        checks.push({
          ok: !!(r && (r.ok || (r as any).status === 400 || (r as any).status === 401)),
          warn: false,
          label: 'Supabase / Base de datos',
          status: r?.ok ? 'OK' : ((r as any)?.status ? `HTTP ${(r as any).status}` : 'Timeout'),
          detail: supUrl.replace(/^https?:\/\//, '').split('/')[0] || '',
          latencyMs: Date.now() - t2,
        })
      } catch (e: any) {
        checks.push({
          ok: false,
          label: 'Supabase / Base de datos',
          status: 'Error',
          detail: String(e?.message || e).slice(0, 200),
          latencyMs: Date.now() - t2,
        })
      }
    } else {
      checks.push({
        ok: false,
        warn: true,
        label: 'Supabase / Base de datos',
        status: 'No configurada',
        detail: 'Falta SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en .env',
      })
    }

    try {
      const t3 = Date.now()
      const branches = await listBranches(tenantId)
      const openShift = await getOpenShift(tenantId, user.id)
      checks.push({
        ok: true,
        label: 'POS · Turnos',
        status: openShift?.id ? 'Turno abierto' : 'Sin turno abierto',
        warn: !openShift?.id,
        detail: `${branches.length || 0} sucursal(es) · ${openShift?.salesCount || 0} ventas · ${openShift?.salesTotal ? '$' + Number(openShift.salesTotal).toLocaleString('es-MX', { minimumFractionDigits: 2 }) : '$0.00'}`,
        latencyMs: Date.now() - t3,
        raw: openShift?.id ? undefined : { branches: branches.length },
      })
    } catch (e: any) {
      checks.push({
        ok: false,
        label: 'POS · Turnos',
        status: 'Error interno',
        detail: String(e?.message || e).slice(0, 220),
      })
    }

    try {
      const t4 = Date.now()
      const { execSync } = await import('node:child_process')
      const ps = String(execSync('docker ps --format "{{.Names}}|{{.Status}}" 2>/dev/null || true').toString() || '').trim().split('\n').filter(Boolean)
      const containers = ps.map(line => {
        const [name, status] = line.split('|')
        return { name: (name || '').trim(), status: (status || '').trim() }
      })
      const unhealthy = containers.filter(c => /(unhealthy|restarting|exited|dead|start)/i.test(c.status))
      checks.push({
        ok: unhealthy.length === 0,
        warn: containers.length === 0,
        label: 'Contenedores Docker',
        status: containers.length
          ? (unhealthy.length ? `${unhealthy.length} en alerta / ${containers.length} totales` : `${containers.length} sanos`)
          : 'Sin información',
        detail: containers.length ? containers.map(c => `${c.name}: ${c.status}`).join('  ·  ') : 'No hay docker info disponible en el host.',
        latencyMs: Date.now() - t4,
      })
    } catch (e: any) {
      checks.push({
        ok: true,
        warn: true,
        label: 'Contenedores Docker',
        status: 'Sin acceso docker',
        detail: String(e?.message || e).slice(0, 220) || 'No se puede ejecutar docker ps desde este contenedor.',
      })
    }

    try {
      const t5 = Date.now()
      const audit = await listAudit(tenantId, { limit: 5 })
      const docs = await loadDbWorkspace(tenantId)
      checks.push({
        ok: true,
        warn: !docs?.prompt || String(docs.prompt).length < 200,
        label: 'Autocurador · Prompt · Docs',
        status: 'OK',
        detail: [
          `Prompt ${docs?.prompt?.length || 0} chars`,
          `${(docs?.documents || []).length} doc(s)`,
          `Auditoría últ ${audit?.length || 0}`,
        ].join(' · '),
        latencyMs: Date.now() - t5,
      })
    } catch (e: any) {
      checks.push({
        ok: false,
        label: 'Autocurador · Prompt · Docs',
        status: 'Error',
        detail: String(e?.message || e).slice(0, 220),
      })
    }

    const overallOk = checks.every(c => c.ok || c.warn)
    const anyFatal = checks.some(c => !c.ok && !c.warn)
    res.status(200).json({
      ok: overallOk && !anyFatal,
      generatedAt: new Date().toISOString(),
      summary: {
        total: checks.length,
        ok: checks.filter(c => c.ok).length,
        warn: checks.filter(c => !c.ok && c.warn).length,
        error: checks.filter(c => !c.ok && !c.warn).length,
      },
      checks,
    })
    return
  } catch (e) {
    next(e)
  }
})

// Dashboard supervisión de métricas + kpis
app.get('/api/status/dashboard', requireAuth, async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const user = res.locals.user as DbAuthUser
    const tenantId = String(user.tenantId || '')
    const now = new Date()
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()

    const [
      metaCfg,
      allMessages,
      chatItems,
      branches,
      openShift,
      allSales,
      workspace,
      auditAll,
      autoEvalsLatest,
    ] = await Promise.all([
      runWithTimeout(getTenantMetaConfig(tenantId), 2000, null),
      runWithTimeout(getAllMessages(tenantId), 3500, [] as any[]),
      runWithTimeout(listChats(tenantId, 500), 3000, [] as any[]),
      listBranches(tenantId),
      getOpenShift(tenantId, user.id),
      listSales(tenantId),
      loadDbWorkspace(tenantId),
      listAudit(tenantId, { limit: 2000 }),
      listAutoEvals(tenantId, { limit: 500 }),
    ])

    const msgs = Array.isArray(allMessages) ? allMessages as any[] : []
    const chats = Array.isArray(chatItems) ? chatItems as any[] : []
    const sales = Array.isArray(allSales) ? allSales as any[] : []
    const audits = Array.isArray(auditAll) ? auditAll as any[] : []
    const evals = Array.isArray(autoEvalsLatest) ? autoEvalsLatest as any[] : []

    const todayMsgs = msgs.filter(m => m && m.createdAt && m.createdAt >= startOfDay)
    const inMsgs = msgs.filter(m => m?.direction === 'IN')
    const outMsgs = msgs.filter(m => m?.direction === 'OUT_BOT' || m?.direction === 'OUT_HUMAN')
    const todayIn = todayMsgs.filter(m => m?.direction === 'IN').length
    const todayOut = todayMsgs.filter(m => m?.direction === 'OUT_BOT' || m?.direction === 'OUT_HUMAN').length

    const blockedBy = msgs.filter(m => m?.blockedByAutocurador === true).length
    const unreadChats = chats.filter(c => typeof c?.unreadCount === 'number' && c.unreadCount > 0).length

    const salesToday = sales.filter(s => s && s.createdAt && s.createdAt >= startOfDay)
    const salesMonth = sales.filter(s => s && s.createdAt && s.createdAt >= startOfMonth)
    const sumAmount = (arr: any[]) => arr.reduce((a, s) => a + (Number(s?.total) || 0), 0)

    const closedShiftsCount = sales.filter((s: any) => s && s.shiftId).length
    const evalCategorized = {
      total: evals.length,
      correct: evals.filter((e: any) => e?.category === 'correct').length,
      error: evals.filter((e: any) => e?.category === 'error').length,
      noinfo: evals.filter((e: any) => e?.category === 'noinfo').length,
      judgeFailed: evals.filter((e: any) => e?.category === 'judge_failed').length,
      ratioCorrect: evals.length
        ? Math.round((evals.filter((e: any) => e?.category === 'correct').length * 1000) / evals.length) / 10
        : 0,
    }
    const login24h = audits.filter(a => a?.kind === 'login' && a?.at && a.at >= new Date(Date.now() - 24 * 3600 * 1000).toISOString()).length

    const stats = {
      meta: {
        pageName: metaCfg?.pageName || null,
        pageId: metaCfg?.pageId || null,
        linked: Boolean(metaCfg?.linkedAt || (metaCfg as any)?.linked || metaCfg?.pageAccessToken),
        state: metaCfg?.state || 'PAUSE',
        testMode: Boolean(metaCfg?.testMode),
        botState: metaCfg?.state === 'START' && Boolean(metaCfg?.pageAccessToken),
      },
      messages: {
        total: msgs.length,
        today: todayMsgs.length,
        receivedTotal: inMsgs.length,
        sentTotal: outMsgs.length,
        todayReceived: todayIn,
        todaySent: todayOut,
        blockedByAutocurador: blockedBy,
      },
      chats: {
        total: chats.length,
        unread: unreadChats,
        active24h: chats.filter(c => c?.lastMessageAt && c.lastMessageAt >= new Date(Date.now() - 24 * 3600 * 1000).toISOString()).length,
      },
      pos: {
        branches: branches.length,
        openShiftId: openShift?.id || null,
        openShiftSalesCount: openShift?.salesCount || 0,
        openShiftSalesTotal: openShift?.salesTotal ? Number(openShift.salesTotal) : 0,
        salesTotal: sumAmount(sales),
        salesToday: sumAmount(salesToday),
        salesMonth: sumAmount(salesMonth),
        salesCount: sales.length,
        salesCountToday: salesToday.length,
        salesCountMonth: salesMonth.length,
        shiftsWithSales: closedShiftsCount,
      },
      workspace: {
        promptChars: String(workspace?.prompt || '').length,
        documentsCount: Array.isArray(workspace?.documents) ? workspace.documents.length : 0,
        hasPrompt: Boolean(workspace?.prompt && String(workspace.prompt).length >= 200),
      },
      audit: {
        last2000: audits.length,
        logins24h: login24h,
        salesCreated: audits.filter(a => a?.kind === 'sale_create').length,
        shiftsOpened: audits.filter(a => a?.kind === 'shift_open').length,
        shiftsClosed: audits.filter(a => a?.kind === 'shift_close').length,
        withdrawals: audits.filter(a => a?.kind === 'cash_withdrawal').length,
      },
      autocurador: {
        ...evalCategorized,
      },
    }

    const quick = [
      { key: 'mensajes_hoy', label: 'Mensajes hoy', value: todayMsgs.length, tone: 'info' as const },
      { key: 'chats_sin_leer', label: 'Chats sin leer', value: unreadChats, tone: unreadChats > 0 ? ('warn' as const) : ('ok' as const) },
      { key: 'ventas_hoy', label: 'Ventas hoy $', value: Math.round(sumAmount(salesToday)), prefix: '$', tone: 'ok' as const },
      { key: 'turno_abierto', label: 'Turno abierto', value: openShift?.id ? 1 : 0, tone: openShift?.id ? ('ok' as const) : ('warn' as const) },
    ]

    res.status(200).json({
      generatedAt: new Date().toISOString(),
      stats,
      quick,
    })
    return
  } catch (e) {
    next(e)
  }
})

// ============================================
// META MESSENGER: Webhook (publico, Meta lo llama)
// ============================================
app.get('/api/webhooks/facebook', async (req: Request, res: Response): Promise<void> => {
  try {
    const tenantIdGuess = (req.query?.tenantId as string) || '0308261'
    const cfg = await getTenantMetaConfig(tenantIdGuess)
    handleWebhookGet(req, res, cfg)
  } catch (e) {
    res.status(500).send('Webhook error')
  }
})

app.post('/api/webhooks/facebook', (req: Request, res: Response, next: NextFunction): void => {
  void handleWebhookPost(req, res, next)
})

// Callback OAuth Login Facebook (después de aceptar permisos)
//
// IMPORTANTE TENANT ID: NO hardcodear tenantId a '0308261' xq el JWT del
// usuario autenticado tiene su tenant REAL (ej. 988d43bb-2d2c-4f07-a731-a0a02c9a3060
// segun screenshot del user). Leer SIEMPRE tenantId del stateB64 que enviamos
// nosotros mismos via buildOAuthLoginURL(user.tenantId) = { t: tenantId, n, r }
// para que saveTenantMetaConfig guarde en el archivo CORRECTO y GET /api/meta/status
// del requireAuth JWT sí lo vea linked:true.
app.get('/api/webhooks/facebook/oauth/callback', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const code = String(req.query?.code || '')
    const error = String(req.query?.error || '')
    const stateB64 = String(req.query?.state || '')
    let tenantId: string | null = null
    let redirectFront = '/'
    try {
      const s = JSON.parse(Buffer.from(stateB64, 'base64url').toString('utf-8'))
      if (s?.t) tenantId = String(s.t)
      if (s?.r) redirectFront = String(s.r)
    } catch {}
    if (!tenantId) {
      // Si no viniera state o falla parse, el fallback solo debemos responder
      // un error JSON limpio (nunca guardar en tenant default wrong).
      throw new Error('OAuth state inválido: sin tenantId.')
    }

    // IMPORTANTE: smartbis.ai (apex sin www) da 522 Cloudflare timeout.
    // Usar SIEMPRE www.smartbis.ai (funciona 100% 200 OK).
    // Si META_FRONTEND_URL no esta definido o es smartbis.ai sin www → forzar www.
    let fb = String(process.env.META_FRONTEND_URL || '').trim()
    if (!fb) fb = 'https://www.smartbis.ai'
    if (/^https?:\/\/smartbis\.ai(\/|$)/i.test(fb)) {
      fb = fb.replace(/^(https?:\/\/)smartbis\.ai/i, '$1www.smartbis.ai')
    }
    const frontendBase = fb.replace(/\/$/, '')
    const settingsPath = String(process.env.META_FRONTEND_SETTINGS_PATH || '/').replace(/^\/?/, '/')

    type Payload = {
      source: 'smartbis_fb_oauth'
      ok: number
      error?: string
      fbpages?: string
      llt_ok?: '1'
      pages_error?: string
      pages_empty?: '1'
      tenantId?: string
    }
    let payload: Payload
    if (error) {
      payload = { source: 'smartbis_fb_oauth', ok: 0, error }
    } else if (!code) {
      payload = { source: 'smartbis_fb_oauth', ok: 0, error: 'no_code' }
    } else {
      const short = await exchangeCodeForUserToken(code)
      const userTok = short?.access_token ? (await exchangeLongLivedUserToken(short.access_token)) || short : null
      if (!userTok?.access_token) {
        payload = { source: 'smartbis_fb_oauth', ok: 0, error: 'token_exchange' }
      } else {
        const secs = typeof userTok.expires_in === 'number' ? userTok.expires_in : 60 * 24 * 60 * 60
        const userLLExtendsAt = new Date(Date.now() + secs * 1000).toISOString()
        // También: forzar renovación adicional para asegurar máx caducidad Graph API
        const extended = await renewUserLongLivedToken(userTok.access_token)
        const finalLLT = extended.success && extended.access_token
          ? extended.access_token
          : userTok.access_token
        const finalExpiry = (extended.success && extended.expires_at) || userLLExtendsAt
        await saveTenantMetaConfig(tenantId, {
          userLongLivedToken: finalLLT,
          userLLExtendsAt: finalExpiry,
        })
        const pagesResult = await listUserPages(finalLLT)
        console.log('[fb_oauth_callback] listUserPages result:', {
          success: pagesResult.success,
          count: Array.isArray(pagesResult.pages) ? pagesResult.pages.length : -1,
          error: pagesResult.error || null,
        })
        const pagesB64 = Buffer.from(JSON.stringify(pagesResult.pages || [])).toString('base64url')
        payload = {
          source: 'smartbis_fb_oauth',
          ok: 1,
          fbpages: pagesB64,
          llt_ok: '1',
          tenantId,
        }
        if (!pagesResult.success) {
          payload.pages_error = String(pagesResult.error || 'Error consultando páginas').slice(0, 400)
        } else if (!Array.isArray(pagesResult.pages) || pagesResult.pages.length === 0) {
          payload.pages_empty = '1'
        }
      }
    }

    // Fallback URL: si no hay window.opener, el popup MISMO redirige al CRM
    // con estos query params (igual que el flujo anterior).
    const fallbackURL = (() => {
      const u = new URL(frontendBase + settingsPath)
      Object.entries(payload).forEach(([k, v]) => {
        if (k === 'source' || k === 'ok' || v === undefined) return
        u.searchParams.set(k, typeof v === 'string' ? encodeURIComponent(v) : String(v))
      })
      return u.toString()
    })()

    const payloadSafe = JSON.stringify(payload)
      .replace(/</g, '\\u003C')
      .replace(/>/g, '\\u003E')
      .replace(/`/g, '\\`')
    const fallbackSafe = JSON.stringify(fallbackURL)
    const title = payload.ok
      ? 'Facebook conectado'
      : payload.error === 'access_denied' ? 'Acceso cancelado' : 'Error de conexión'
    const msg = payload.ok
      ? 'Conexión exitosa. Cerrando ventana…'
      : payload.error === 'access_denied'
        ? 'Cancelaste el acceso. Cerrando ventana…'
        : 'No se pudo completar el login. Regresando al CRM…'

    const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${title} · Smartbis</title>
<meta http-equiv="refresh" content="1.5;url=${fallbackURL}"/>
<style>
*{box-sizing:border-box}html,body{margin:0;padding:0;min-height:100vh;background:#0b1220;color:#e2e8f0;font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Inter,"Helvetica Neue",Arial}
.wrap{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:28px}
.card{max-width:520px;width:100%;border-radius:22px;border:1px solid rgba(255,255,255,0.08);background:rgba(255,255,255,0.02);padding:28px;text-align:center;box-shadow:0 20px 60px -20px rgba(0,0,0,0.4)}
.dot{display:inline-flex;width:12px;height:12px;border-radius:9999px;background:${payload.ok ? '#34d399' : '#fbbf24'};box-shadow:0 0 0 6px ${payload.ok ? 'rgba(52,211,153,0.12)' : 'rgba(251,191,36,0.12)'};margin-bottom:14px}
h1{margin:0 0 10px;font-size:18px;font-weight:700;color:#f8fafc}p{margin:0;color:#94a3b8;font-size:14px;line-height:1.5}
a{color:#60a5fa;text-decoration:none;font-weight:600}
</style></head><body>
<div class="wrap"><div class="card"><span class="dot" aria-hidden="true"></span>
<h1>${title}</h1><p>${msg}<br/><small>Si no se cierra en 2s haz <a href="${fallbackURL}">clic aquí para continuar</a>.</small></p>
</div></div>
<script>
(function(){
  var PAYLOAD = ${payloadSafe};
  var FALLBACK = ${fallbackSafe};
  try {
    if (window.opener && window.opener !== window && typeof window.opener.postMessage === 'function') {
      try { window.opener.postMessage(PAYLOAD, '*'); } catch (_e) {}
    }
  } catch (_e) {}
  setTimeout(function(){
    try { window.close(); } catch (_e) {}
    // Fallback: si close() fue bloqueado (navegador) redirigir el popup al CRM.
    setTimeout(function(){
      try { window.location.replace(FALLBACK); } catch (_e) { window.location.href = FALLBACK; }
    }, 250);
  }, 180);
})();
</script></body></html>`

    res.status(200).header({
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate, private, max-age=0',
      'Pragma': 'no-cache',
      'Expires': '0',
    }).send(html)
  } catch (e) { next(e) }
})

// ============================================
// META MESSENGER: Admin API (requireAuth)
// ============================================
app.get('/api/meta/status', requireAuth, csGuard(CS_AGENT_ROLES), async (_req: Request, res: Response) => {
  const user = res.locals.user as DbAuthUser
  // Health-check preventivo: renovar tokens, validar, re-suscribir webhook y
  // SI EL PAGE TOKEN ES INVÁLIDO, limpiarlo para que frontend muestre desconectado honesto.
  const cfg = await ensureTenantFacebookConnection(user.tenantId)
  const safe = {
    appId: cfg.appId,
    graphVersion: cfg.graphVersion,
    pageId: cfg.pageId,
    pageName: cfg.pageName,
    pageProfilePic: cfg.pageProfilePic,
    state: cfg.state,
    testMode: cfg.testMode,
    autocuratorEnabled: cfg.autocuratorEnabled,
    webhookSubscribed: cfg.webhookSubscribed,
    linkedAt: cfg.linkedAt,
    updatedAt: cfg.updatedAt,
    linked: Boolean(cfg.pageId && cfg.pageAccessToken),
    hasPageToken: Boolean(cfg.pageAccessToken),
  }
  res.status(200).json(safe)
})

app.get('/api/meta/oauth/url', requireAuth, csGuard(CS_ADMIN_ROLES), async (_req: Request, res: Response) => {
  const user = res.locals.user as DbAuthUser
  const url = buildOAuthLoginURL(user.tenantId, '/settings?meta=1')
  res.status(200).json({ url })
})

// Reconsultar las páginas con el token de usuario que el callback OAuth ya
// guardó. Evita repetir login cuando Meta devolvió un límite transitorio (#4).
app.post('/api/meta/pages/retry', requireAuth, csGuard(CS_ADMIN_ROLES), async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const user = res.locals.user as DbAuthUser
    const cfg = await getTenantMetaConfig(user.tenantId)
    if (!cfg.userLongLivedToken) {
      res.status(409).json({ error: 'No hay una autorización de Facebook guardada. Inicia sesión con Facebook primero.' })
      return
    }
    const result = await listUserPages(cfg.userLongLivedToken)
    if (!result.success) {
      const rateLimited = /\(#4\)/.test(result.error || '')
      res.status(rateLimited ? 429 : 502).json({ error: result.error || 'No se pudieron consultar las páginas de Facebook.' })
      return
    }
    res.status(200).json({ pages: result.pages })
  } catch (error) { next(error) }
})

app.post('/api/meta/ads/sync', requireAuth, csGuard(CS_ADMIN_ROLES), async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const user = res.locals.user as DbAuthUser
    const cfg = await ensureTenantFacebookConnection(user.tenantId)
    if (!cfg.pageId || !cfg.pageAccessToken) {
      res.status(409).json({ error: 'Conecta primero la página de Facebook.' })
      return
    }
    const { ads, accountsChecked } = await fetchCurrentPageAds(cfg)
    const syncedAt = new Date().toISOString()
    const lines = [
      '# Anuncios actuales de Facebook',
      '',
      `Página: ${cfg.pageName || cfg.pageId} (ID ${cfg.pageId})`,
      `Sincronizado: ${syncedAt}`,
      'Usa esta ficha para reconocer el anuncio del que viene una conversación mediante su ID o título. Los textos del anuncio describen la creatividad; no garantizan precio, disponibilidad ni condiciones vigentes.',
      '',
    ]
    if (!ads.length) {
      lines.push('No se encontraron anuncios actuales asociados a esta página en las cuentas publicitarias autorizadas.')
    } else {
      for (const ad of ads) {
        lines.push(`## ${ad.title || ad.name || `Anuncio ${ad.id}`}`)
        lines.push(`- ID del anuncio: ${ad.id}`)
        if (ad.name) lines.push(`- Nombre interno: ${ad.name}`)
        if (ad.campaign) lines.push(`- Campaña: ${ad.campaign}`)
        lines.push(`- Estado: ${ad.status}`)
        if (ad.body) lines.push(`- Texto del anuncio: ${ad.body.slice(0, 5000)}`)
        if (ad.description) lines.push(`- Descripción: ${ad.description.slice(0, 3000)}`)
        if (ad.callToAction) lines.push(`- Llamada a la acción: ${ad.callToAction}`)
        lines.push('')
      }
    }
    await upsertDbDocument(user.tenantId, { fileName: 'anuncios.md', content: lines.join('\n') })
    const ingestion = await ingestDbTenantDocuments(user.tenantId)
    res.status(200).json({ success: true, ads: ads.length, accountsChecked, syncedAt, ingestion })
  } catch (error) {
    next(error)
  }
})

app.post('/api/meta/linkPage', requireAuth, csGuard(CS_ADMIN_ROLES), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = res.locals.user as DbAuthUser
    const pageId = String(req.body?.pageId || '')
    const pageName = String(req.body?.pageName || '')
    const pageAccessToken = String(req.body?.pageAccessToken || '')
    const pageProfilePic = String(req.body?.pageProfilePic || '')
    if (!pageId || !pageAccessToken) {
      res.status(400).json({ error: 'pageId y pageAccessToken obligatorios' })
      return
    }
    const subscribed = await subscribePageToApp(pageAccessToken)
    const pageTokenExpiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 60).toISOString()
    const cfg = await saveTenantMetaConfig(user.tenantId, {
      pageId,
      pageName,
      pageAccessToken,
      pageProfilePic,
      pageTokenExpiresAt,
      webhookSubscribed: subscribed,
      state: 'PAUSE',
      linkedAt: new Date().toISOString(),
    })
    res.status(200).json({
      success: true,
      subscribed,
      config: {
        pageId: cfg.pageId,
        pageName: cfg.pageName,
        state: cfg.state,
        testMode: cfg.testMode,
        webhookSubscribed: cfg.webhookSubscribed,
      },
    })
  } catch (e) { next(e) }
})

// Modo MANUAL rápido (para empezar HOY): pegar token y page_id directamente en Settings
app.post('/api/meta/configureManual', requireAuth, csGuard(CS_ADMIN_ROLES), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = res.locals.user as DbAuthUser
    const pageId = String(req.body?.pageId || '')
    const pageAccessToken = String(req.body?.pageAccessToken || '')
    const pageName = String(req.body?.pageName || '')
    if (!pageId || !pageAccessToken) {
      res.status(400).json({ error: 'pageId y pageAccessToken obligatorios' })
      return
    }
    const subscribed = await subscribePageToApp(pageAccessToken)
    const pageTokenExpiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 60).toISOString()
    const cfg = await saveTenantMetaConfig(user.tenantId, {
      pageId,
      pageName: pageName || pageId,
      pageAccessToken,
      pageTokenExpiresAt,
      webhookSubscribed: subscribed,
      linkedAt: new Date().toISOString(),
    })
    res.status(200).json({ success: true, subscribed, pageId: cfg.pageId, pageName: cfg.pageName })
  } catch (e) { next(e) }
})

app.post('/api/meta/setState', requireAuth, csGuard(CS_AGENT_ROLES), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = res.locals.user as DbAuthUser
    const stateRaw = String(req.body?.state || '')
    const state = stateRaw === 'START' ? 'START' : stateRaw === 'PAUSE' ? 'PAUSE' : null
    const testModeRaw = req.body?.testMode
    const autocuratorEnabledRaw = req.body?.autocuratorEnabled
    const patch: Partial<{ state: MetaBotState; testMode: boolean; autocuratorEnabled: boolean }> = {}
    if (state) patch.state = state
    if (typeof testModeRaw === 'boolean') patch.testMode = testModeRaw
    if (typeof autocuratorEnabledRaw === 'boolean') patch.autocuratorEnabled = autocuratorEnabledRaw
    const cfg = await saveTenantMetaConfig(user.tenantId, patch)
    res.status(200).json({ success: true, state: cfg.state, testMode: cfg.testMode, autocuratorEnabled: cfg.autocuratorEnabled })
  } catch (e) { next(e) }
})

// WhatsApp Web notifications: connection/config are admin-only; agents can confirm signups.
app.get('/api/whatsapp/status', requireAuth, csGuard(CS_ADMIN_ROLES), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = res.locals.user as DbAuthUser
    await startWhatsApp(user.tenantId)
    res.json(await getWhatsAppStatus(user.tenantId))
  } catch (e) { next(e) }
})

app.put('/api/whatsapp/recipient', requireAuth, csGuard(CS_ADMIN_ROLES), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = res.locals.user as DbAuthUser
    const recipient = await setWhatsAppRecipient(user.tenantId, String(req.body?.recipient || ''))
    res.json({ success: true, recipient })
  } catch (e) { next(e) }
})

app.post('/api/whatsapp/test', requireAuth, csGuard(CS_ADMIN_ROLES), async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const user = res.locals.user as DbAuthUser
    res.json(await sendWhatsAppTest(user.tenantId))
  } catch (e) { next(e) }
})

app.post('/api/meta/chats/:psid/confirm-registration', requireAuth, csGuard(CS_AGENT_ROLES), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = res.locals.user as DbAuthUser
    const psid = decodeURIComponent(String(req.params.psid || ''))
    const course = String(req.body?.course || '').trim()
    if (!psid || !course) { res.status(400).json({ error: 'psid y curso obligatorios' }); return }
    const result = await notifyRegistration(user.tenantId, {
      psid,
      customer: String(req.body?.customer || 'Cliente'),
      course,
      modality: String(req.body?.modality || ''),
      confirmedBy: user.displayName || user.email,
    })
    res.json({ success: true, ...result })
  } catch (e) { next(e) }
})

app.get('/api/meta/chats', requireAuth, csGuard(CS_AGENT_ROLES), async (req: Request, res: Response) => {
  const user = res.locals.user as DbAuthUser
  const limit = Math.max(1, Math.min(500, Number(req.query?.limit || 100)))
  const list = await listChats(user.tenantId, limit)
  res.status(200).json({ chats: list })
})

app.get('/api/meta/chats/:psid', requireAuth, csGuard(CS_AGENT_ROLES), async (req: Request, res: Response) => {
  const user = res.locals.user as DbAuthUser
  const psid = decodeURIComponent(String(req.params.psid || ''))
  const msgs = await getMessagesByPSID(user.tenantId, psid)
  res.status(200).json({ psid, messages: msgs })
})

app.post('/api/meta/chats/:psid/read', requireAuth, csGuard(CS_AGENT_ROLES), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = res.locals.user as DbAuthUser
    const psid = decodeURIComponent(String(req.params.psid || ''))
    await markChatAsRead(user.tenantId, psid)
    res.status(200).json({ success: true })
  } catch (e) { next(e) }
})

app.delete('/api/meta/chats/:psid', requireAuth, csGuard(CS_AGENT_ROLES), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = res.locals.user as DbAuthUser
    const psid = decodeURIComponent(String(req.params.psid || ''))
    await deleteChatByPSID(user.tenantId, psid)
    res.status(204).send()
  } catch (e) { next(e) }
})

app.post('/api/meta/send/:psid', requireAuth, csGuard(CS_AGENT_ROLES), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = res.locals.user as DbAuthUser
    const psid = decodeURIComponent(String(req.params.psid || ''))
    const text = String(req.body?.text || '').trim()
    if (!psid || !text) { res.status(400).json({ error: 'psid y text obligatorios' }); return }
    const resp = await adminSendMessage(user, psid, text)
    res.status(resp.success ? 200 : 502).json(resp)
  } catch (e) { next(e) }
})

// ================================================
// AUTO-EVALS · Auto-curado (panel de auditoría)
// ================================================
app.get('/api/meta/auto-evals', requireAuth, csGuard(CS_ADMIN_ROLES), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = res.locals.user as DbAuthUser
    const result = await listAutoEvals(user.tenantId, {
      category: typeof req.query.category === 'string' ? req.query.category as any : undefined,
      psid: typeof req.query.psid === 'string' ? req.query.psid : undefined,
      search: typeof req.query.search === 'string' ? req.query.search : undefined,
      limit: typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : undefined,
      offset: typeof req.query.offset === 'string' ? parseInt(req.query.offset, 10) : undefined,
    })
    res.json(result)
  } catch (e) { next(e) }
})

app.get('/api/meta/auto-evals/:id', requireAuth, csGuard(CS_ADMIN_ROLES), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = res.locals.user as DbAuthUser
    const d = await getAutoEval(user.tenantId, String(req.params.id))
    if (!d) { res.status(404).json({ error: 'no encontrado' }); return }
    res.json(d)
  } catch (e) { next(e) }
})

app.post('/api/auth/register', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const email = typeof req.body?.email === 'string' ? req.body.email : ''
    const password = typeof req.body?.password === 'string' ? req.body.password : ''
    const payload = await registerDbAccount({
      email,
      password,
    })

    res.status(201).json(payload)
  } catch (error) {
    next(error)
  }
})

app.post('/api/auth/login', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const email = typeof req.body?.email === 'string' ? req.body.email : ''
    const password = typeof req.body?.password === 'string' ? req.body.password : ''
    const payload = await loginDbAccount({
      email,
      password,
    })

    res.status(200).json(payload)
  } catch (error) {
    next(error)
  }
})

app.get('/api/auth/me', requireAuth, async (_req: Request, res: Response) => {
  res.status(200).json({
    user: res.locals.user as DbAuthUser,
  })
})

app.post('/api/auth/logout', requireAuth, async (_req: Request, res: Response) => {
  res.status(200).json({
    success: true,
  })
})

app.get('/api/workspace', requireAuth, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const user = res.locals.user as DbAuthUser
    const workspace = await loadDbWorkspace(user.tenantId)

    res.status(200).json({
      user,
      ...workspace,
    })
  } catch (error) {
    next(error)
  }
})

app.put('/api/prompt', requireAuth, csGuard(CS_ADMIN_ROLES), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt : ''
    const user = res.locals.user as DbAuthUser
    const savedPrompt = await saveDbPrompt(user.tenantId, prompt)

    res.status(200).json({
      prompt: savedPrompt,
    })
  } catch (error) {
    next(error)
  }
})

app.post('/api/documents', requireAuth, csGuard(CS_AGENT_ROLES), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const fileName = typeof req.body?.fileName === 'string' ? req.body.fileName : ''
    const content = typeof req.body?.content === 'string' ? req.body.content : ''
    const user = res.locals.user as DbAuthUser
    const document = await createDbDocument(user.tenantId, {
      fileName,
      content,
    })
    const ingestion = await ingestDbTenantDocuments(user.tenantId)

    res.status(201).json({
      document,
      ingestion,
    })
  } catch (error) {
    next(error)
  }
})

app.put('/api/documents/:fileName', requireAuth, csGuard(CS_AGENT_ROLES), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const currentFileName = typeof req.params.fileName === 'string' ? decodeURIComponent(req.params.fileName) : ''
    const fileName = typeof req.body?.fileName === 'string' ? req.body.fileName : ''
    const content = typeof req.body?.content === 'string' ? req.body.content : ''
    const user = res.locals.user as DbAuthUser
    const document = await updateDbDocument(user.tenantId, currentFileName, {
      fileName,
      content,
    })
    const ingestion = await ingestDbTenantDocuments(user.tenantId)

    await appendAudit(user.tenantId, {
      userEmail: user.email,
      userId: user.id,
      kind: 'document_edit',
      message: `Editó documento: ${(document as unknown as { title?: string }).title || document.label || document.id || fileName}`,
      details: {
        documentId: document.id,
        title: (document as unknown as { title?: string }).title || document.label || fileName,
        fileName: document.fileName,
      },
    })

    res.status(200).json({
      document,
      ingestion,
    })
  } catch (error) {
    next(error)
  }
})

// ============================================
// POS: Punto de Venta · Inventario · Sucursales · Compras · Turnos · Auditoría · Subusuarios
// ============================================

// --- BRANCHES / Sucursales (IVA por sucursal configurable aquí) ---
app.get('/api/pos/branches', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = res.locals.user as DbAuthUser
    const branches = await listBranches(user.tenantId)
    res.json({ branches })
  } catch (e) {
    next(e)
  }
})
app.post('/api/pos/branches', requireAuth, cashierGuard(POS_ADMIN_ROLES), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = res.locals.user as DbAuthUser
    const body = req.body || {}
    if (!body.name) { res.status(400).json({ error: 'Nombre de sucursal es obligatorio' }); return }
    const inp: any = {
      name: String(body.name),
      userEmail: user.email,
    }
    if (typeof body.id === 'string' && body.id) inp.id = body.id
    if (typeof body.address === 'string') inp.address = body.address
    if (typeof body.phone === 'string') inp.phone = body.phone
    if (typeof body.manager === 'string') inp.manager = body.manager
    if (typeof body.isMain === 'boolean') inp.isMain = body.isMain
    if (typeof body.active === 'boolean') inp.active = body.active
    if (typeof body.ivaEnabled === 'boolean') inp.ivaEnabled = body.ivaEnabled
    if (typeof body.ivaRate === 'number') inp.ivaRate = Math.max(0, body.ivaRate)
    if (typeof body.currency === 'string' && body.currency) inp.currency = body.currency
    const br = await upsertBranch(user.tenantId, inp)
    res.status(200).json({ branch: br })
  } catch (e) {
    next(e)
  }
})
app.delete('/api/pos/branches/:id', requireAuth, cashierGuard(POS_ADMIN_ROLES), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = res.locals.user as DbAuthUser
    const ok = await deleteBranch(user.tenantId, String(req.params.id), user.email)
    if (!ok) { res.status(400).json({ error: 'No se pudo eliminar sucursal (es la principal o no existe)' }); return }
    res.status(200).json({ ok: true })
  } catch (e) {
    next(e)
  }
})

// --- CATÁLOGO / INVENTARIO ---
app.get('/api/pos/catalog', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = res.locals.user as DbAuthUser
    const kinds: any = typeof req.query.kinds === 'string' ? req.query.kinds.split(',') : undefined
    const search = typeof req.query.search === 'string' ? req.query.search : undefined
    const activeOnly = req.query.activeOnly !== '0'
    let list = await listCatalog(user.tenantId, { kinds, activeOnly, search })

    if (list.length === 0) {
      try {
        const mdFiles = await listTenantMdFiles(user.tenantId)
        const docs = await Promise.all(
          mdFiles.map(async (file) => {
            const content = await readTenantMdFile(user.tenantId, file.fileName)
            if (!content?.content) return null
            const section = /producto|product|catalog/.test(file.fileName)
              ? 'products'
              : /curso|curso|clase|taller/.test(file.fileName)
                ? 'courses'
                : /servicio|service/.test(file.fileName)
                  ? 'services'
                  : 'docs'
            return {
              id: file.fileName,
              title: file.fileName,
              contentMarkdown: content.content,
              section,
            }
          }),
        )
        const candidates = docs.filter(Boolean)
        if (candidates.length) {
          await syncCatalogFromDocuments(user.tenantId, candidates as Array<{ id: string; title?: string; contentMarkdown?: string; section?: string }>, user.email)
          list = await listCatalog(user.tenantId, { kinds, activeOnly, search })
        }
      } catch {
        // El catálogo ocupa un fallback suave; si el documento no está listo, la ruta sigue serviendo la respuesta base.
      }
    }

    res.json({ items: list, promoGroups: await listPromoGroups(user.tenantId) })
  } catch (e) {
    next(e)
  }
})

app.get('/api/pos/catalog/export.xlsx', requireAuth, cashierGuard([...POS_ADMIN_ROLES, 'cashier']), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = res.locals.user as DbAuthUser
    const XLSX = await import('xlsx')
    const ps = await import('./lib/posStore.js')
    const kinds: any = typeof req.query.kinds === 'string' ? req.query.kinds.split(',') : undefined
    const search = typeof req.query.search === 'string' ? req.query.search : undefined
    const activeOnly = req.query.activeOnly !== '0'

    const items = await ps.listCatalog(user.tenantId, { kinds, activeOnly, search })
    const store = await ps.readPosStore(user.tenantId)
    const branches = (store as any).branches || []

    const rows: Array<Record<string, any>> = items.map((it: any) => {
      const row: Record<string, any> = {
        SKU: it.sku || '',
        Tipo: (() => {
          switch (it.kind) {
            case 'product': return 'Producto'
            case 'service': return 'Servicio'
            case 'course': return 'Curso'
            case 'menu_item': return 'Menú'
            default: return it.kind || ''
          }
        })(),
        Nombre: it.name,
        Familia: it.family || '',
        Categoría: it.category || '',
        Costo: it.costPrice === undefined || it.costPrice === null ? '' : Number(it.costPrice),
        'Precio Venta': Number(it.salePrice),
        Moneda: it.currency || '',
        Ubicación: it.location || '',
        Activo: it.active ? 'Sí' : 'No',
        'Doc fuente': it.sourceDocId || '',
        Creado: it.createdAt ? new Date(it.createdAt).toLocaleString() : '',
        Actualizado: it.updatedAt ? new Date(it.updatedAt).toLocaleString() : '',
      }
      if (branches.length > 0) {
        for (const b of branches) {
          row[`Stock ${b.name}`] = it.stocks?.[b.id] ?? 0
        }
      }
      return row
    })

    const ws = (XLSX as any).utils.json_to_sheet(rows)
    if (rows.length > 0) {
      const cols = Object.keys(rows[0]).map((h) => {
        let max = h.length
        for (const r of rows) {
          const v = r[h]
          if (v === null || v === undefined) continue
          const s = typeof v === 'number'
            ? Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 })
            : String(v)
          max = Math.max(max, s.length)
        }
        return { wch: Math.min(50, Math.max(8, max + 2)) }
      })
      ws['!cols'] = cols
    }
    const wb = (XLSX as any).utils.book_new()
    const sheetName = 'Inventario'
    ;(XLSX as any).utils.book_append_sheet(wb, ws, sheetName.slice(0, 31))
    const today = new Date()
    const dd = today.getDate().toString().padStart(2, '0')
    const mm = (today.getMonth() + 1).toString().padStart(2, '0')
    const yy = today.getFullYear().toString().slice(-2)
    const fileName = `EXISTENCIA AL DÍA ${dd}-${mm}-${yy}.xlsx`

    const xlsxBuffer = (XLSX as any).write(wb, { bookType: 'xlsx', type: 'buffer', bookSST: false })
    const buf = Buffer.isBuffer(xlsxBuffer) ? xlsxBuffer : Buffer.from(new Uint8Array(xlsxBuffer as any))
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`)
    res.setHeader('Content-Length', buf.length)
    res.end(buf)
  } catch (e) {
    next(e)
  }
})
app.post('/api/pos/catalog', requireAuth, cashierGuard(POS_ADMIN_ROLES), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = res.locals.user as DbAuthUser
    const b = req.body || {}
    if (!b.name) { res.status(400).json({ error: 'Nombre de producto/servicio es obligatorio' }); return }
    if (!isUsableCatalogDocumentName(b.name)) { res.status(400).json({ error: 'El nombre del producto no puede ser un nombre genérico como "Pieza"' }); return }
    if (typeof b.salePrice !== 'number' || !(b.salePrice >= 0)) { res.status(400).json({ error: 'Precio venta inválido' }); return }
    const syncToMdDoc = b.syncToMdDoc === null ? null : (typeof b.syncToMdDoc === 'string' ? b.syncToMdDoc : undefined)
    const volumePriceTiers = Array.isArray(b.volumePriceTiers)
      ? b.volumePriceTiers
        .map((t: any) => {
          if (!t || typeof t !== 'object') return null
          const minQtyRaw = Number(t.minQty)
          const priceRaw = Number(t.price)
          if (!Number.isFinite(minQtyRaw) || !Number.isFinite(priceRaw)) return null
          const minQty = Math.max(1, Math.floor(minQtyRaw))
          const price = Math.max(0, priceRaw)
          if (minQty < 2 || price <= 0) return null
          return { minQty, price }
        })
        .filter((t): t is { minQty: number; price: number } => Boolean(t))
      : undefined
    const bundlePriceTiers = Array.isArray(b.bundlePriceTiers)
      ? b.bundlePriceTiers
        .map((t: any) => {
          if (!t || typeof t !== 'object') return null
          const quantity = Math.floor(Number(t.quantity))
          const totalPrice = Number(t.totalPrice)
          if (!Number.isFinite(quantity) || quantity < 2 || !Number.isFinite(totalPrice) || totalPrice < 0) return null
          return { quantity, totalPrice }
        })
        .filter((t): t is { quantity: number; totalPrice: number } => Boolean(t))
        .sort((a, b) => a.quantity - b.quantity)
        .filter((t, i, all) => all.findIndex(x => x.quantity === t.quantity) === i)
      : undefined
    const it = await upsertCatalogItem(user.tenantId, {
      id: typeof b.id === 'string' ? b.id : undefined,
      kind: typeof b.kind === 'string' ? b.kind : undefined,
      sku: typeof b.sku === 'string' ? b.sku : undefined,
      name: String(b.name),
      family: typeof b.family === 'string' ? b.family : undefined,
      category: typeof b.category === 'string' ? b.category : undefined,
      description: typeof b.description === 'string' ? b.description : undefined,
      costPrice: typeof b.costPrice === 'number' ? b.costPrice : undefined,
      salePrice: b.salePrice,
      volumePriceTiers,
      bundlePriceTiers,
      currency: typeof b.currency === 'string' ? b.currency : undefined,
      stocks: b.stocks && typeof b.stocks === 'object' ? b.stocks : undefined,
      location: typeof b.location === 'string' ? b.location : undefined,
      tags: Array.isArray(b.tags) ? b.tags : undefined,
      active: typeof b.active === 'boolean' ? b.active : undefined,
      cashierPriceEditable: typeof b.cashierPriceEditable === 'boolean' ? b.cashierPriceEditable : undefined,
      attrs: b.attrs && typeof b.attrs === 'object' ? b.attrs : undefined,
      userEmail: user.email,
      syncToMdDoc,
      sourceDocId: typeof b.sourceDocId === 'string' ? b.sourceDocId : undefined,
    })
    res.status(200).json({ item: it })
  } catch (e) {
    next(e)
  }
})
app.delete('/api/pos/catalog/:id', requireAuth, cashierGuard(POS_ADMIN_ROLES), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = res.locals.user as DbAuthUser
    const ok = await deleteCatalogItem(user.tenantId, String(req.params.id), user.email)
    if (!ok) { res.status(404).json({ error: 'Item no encontrado' }); return }
    res.json({ ok: true })
  } catch (e) {
    next(e)
  }
})

// --- GRUPOS DE PROMOCIÓN (mix cantidades de productos distintos) ---
app.get('/api/pos/promo-groups', requireAuth, cashierGuard([...POS_ADMIN_ROLES, 'cashier']), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = res.locals.user as DbAuthUser
    res.json({ groups: await listPromoGroups(user.tenantId) })
  } catch (e) {
    next(e)
  }
})
app.post('/api/pos/promo-groups', requireAuth, cashierGuard(POS_ADMIN_ROLES), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = res.locals.user as DbAuthUser
    const b = req.body || {}
    if (!b.name || !String(b.name).trim()) {
      res.status(400).json({ error: 'Nombre del grupo es obligatorio' })
      return
    }
    const g = await upsertPromoGroup(user.tenantId, {
      id: typeof b.id === 'string' ? b.id : undefined,
      name: String(b.name).trim(),
      productIds: Array.isArray(b.productIds) ? b.productIds : undefined,
      volumePriceTiers: Array.isArray(b.volumePriceTiers) ? b.volumePriceTiers : undefined,
      active: typeof b.active === 'boolean' ? b.active : undefined,
      userEmail: user.email,
    })
    res.json({ group: g })
  } catch (e) {
    next(e)
  }
})
app.delete('/api/pos/promo-groups/:id', requireAuth, cashierGuard(POS_ADMIN_ROLES), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = res.locals.user as DbAuthUser
    const ok = await deletePromoGroup(user.tenantId, String(req.params.id), user.email)
    if (!ok) { res.status(404).json({ error: 'Grupo no encontrado' }); return }
    res.json({ ok: true })
  } catch (e) {
    next(e)
  }
})

app.post('/api/pos/catalog/sync-from-documents', requireAuth, cashierGuard([...POS_ADMIN_ROLES, 'cashier']), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = res.locals.user as DbAuthUser
    const fs = await import('node:fs')
    const path = await import('node:path')
    const safeTid = String(user.tenantId || '').replace(/[^A-Za-z0-9_\-]/g, '_')
    const docsDir = path.resolve(process.cwd(), 'clientsdata', safeTid)
    const onlyDoc = typeof req.query.doc === 'string' ? String(req.query.doc).trim() : ''
    let docs: Array<{ id: string; title: string; contentMarkdown: string; section?: string }> = []
    try {
      if (fs.existsSync(docsDir)) {
        let files = fs.readdirSync(docsDir).filter((f: string) => f.toLowerCase().endsWith('.md'))
        if (onlyDoc) files = files.filter(f => f === onlyDoc)
        docs = files
          .map((f: string) => {
            try {
              const full = path.join(docsDir, f)
              const content = fs.readFileSync(full, 'utf-8')
              return {
                id: f,
                title: f,
                contentMarkdown: content,
                section: f.toLowerCase().includes('producto')
                  ? 'products'
                  : f.toLowerCase().includes('curso') || f.toLowerCase().includes('clase') || f.toLowerCase().includes('taller')
                  ? 'courses'
                  : f.toLowerCase().includes('servicio')
                  ? 'services'
                  : 'docs',
              }
            } catch {
              return null
            }
          })
          .filter(Boolean) as any
      }
    } catch {}
    if (docs.length === 0 && !onlyDoc) {
      const ws = await loadDbWorkspace(user.tenantId)
      let wsDocs = (ws.documents || []).map((d: any) => ({
        id: d.id,
        title: d.title || d.fileName,
        contentMarkdown: d.contentMarkdown,
        section: d.section,
      }))
      if (onlyDoc) wsDocs = wsDocs.filter((d: any) => String(d.title || d.id || '') === onlyDoc)
      docs = wsDocs
    }
    if (onlyDoc && docs.length === 0) {
      res.status(404).json({ error: `Documento ${onlyDoc} no encontrado o vacío` })
      return
    }
    const r = await syncCatalogFromDocuments(user.tenantId, docs, user.email)
    res.status(200).json({ ...r, onlyDoc })
  } catch (e) {
    next(e)
  }
})

// ============ POS DOCS (MD FILES) TENANT ============
app.get('/api/pos/docs', requireAuth, cashierGuard([...POS_ADMIN_ROLES, 'cashier']), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = res.locals.user as DbAuthUser
    res.json({ files: await listTenantMdFiles(user.tenantId) })
  } catch (e) { next(e) }
})
app.get('/api/pos/docs/:name', requireAuth, cashierGuard([...POS_ADMIN_ROLES, 'cashier']), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = res.locals.user as DbAuthUser
    const r = await readTenantMdFile(user.tenantId, String(req.params.name || ''))
    if (!r) { res.status(404).json({ error: 'Archivo no encontrado' }); return }
    res.json(r)
  } catch (e) { next(e) }
})
app.post('/api/pos/docs', requireAuth, cashierGuard([...POS_ADMIN_ROLES, 'cashier']), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = res.locals.user as DbAuthUser
    const b = req.body || {}
    if (!b.fileName) { res.status(400).json({ error: 'fileName requerido' }); return }
    const r = await writeTenantMdFile(user.tenantId, String(b.fileName), String(b.content || ''))
    await logDocumentEdit(user.tenantId, user.email, r.fileName, r.fileName)
    res.json(r)
  } catch (e) { next(e) }
})
app.post('/api/pos/docs/:name/upsert-item-block', requireAuth, cashierGuard([...POS_ADMIN_ROLES, 'cashier']), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = res.locals.user as DbAuthUser
    const b = req.body || {}
    if (!b.item) { res.status(400).json({ error: 'item requerido' }); return }
    const ok = await upsertItemIntoMd(user.tenantId, String(req.params.name), b.item, b.branches)
    await logDocumentEdit(user.tenantId, user.email, String(req.params.name), String(req.params.name))
    res.json({ ok })
  } catch (e) { next(e) }
})
app.post('/api/pos/docs/:name/remove-item-block', requireAuth, cashierGuard([...POS_ADMIN_ROLES, 'cashier']), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = res.locals.user as DbAuthUser
    const b = req.body || {}
    if (!b.skuOrName) { res.status(400).json({ error: 'skuOrName requerido' }); return }
    const ok = await removeItemFromMd(user.tenantId, String(req.params.name), String(b.skuOrName))
    await logDocumentEdit(user.tenantId, user.email, String(req.params.name), String(req.params.name))
    res.json({ ok })
  } catch (e) { next(e) }
})
app.post('/api/pos/catalog/import', requireAuth, cashierGuard([...POS_ADMIN_ROLES, 'cashier']), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = res.locals.user as DbAuthUser
    const b = req.body || {}
    if (!b.fileName || !b.fileBase64) { res.status(400).json({ error: 'fileName y fileBase64 requeridos' }); return }
    let buffer: Buffer
    try { buffer = Buffer.from(String(b.fileBase64), 'base64') } catch { res.status(400).json({ error: 'Base64 inválido' }); return }
    const ps = await import('./lib/posStore.js')
    const parsed = (await ps.parseImportBuffer(buffer, String(b.fileName), { returnDiagnostics: true } as any)) as any
    const itemsParsedAll: any[] = parsed?.items || []
    const diagnostic: any = parsed?.diagnostic || null
    const method: string = parsed?.method || 'unknown'
    const invalidNames = itemsParsedAll
      .filter((x: any) => x?.name && !isUsableCatalogDocumentName(x.name))
      .map((x: any) => `${x.name}: nombre genérico de producto ignorado`)
    const itemsParsed = itemsParsedAll.filter(
      (x: any) => x && isUsableCatalogDocumentName(x.name) && typeof x.salePrice === 'number',
    )
    const targetDoc = typeof b.targetDoc === 'string' ? b.targetDoc : guessTargetDoc(itemsParsed[0]?.kind || 'product')
    const preStore = await ps.readPosStore(user.tenantId)
    const preIds = new Set(preStore.catalogItems.map(i => i.id))
    const created: string[] = []; const updated: string[] = []; const skipped: string[] = [...invalidNames]
    for (const p of itemsParsed) {
      try {
        const stockInp: any = {
          kind: p.kind || 'product',
          sku: p.sku,
          name: p.name,
          family: p.family,
          category: p.category,
          description: p.description,
          costPrice: p.costPrice,
          salePrice: p.salePrice,
          location: p.location,
          active: p.active,
          userEmail: user.email,
          syncToMdDoc: b.writeBack === false ? null : targetDoc,
          sourceDocId: b.writeBack === false ? undefined : targetDoc,
        }
        if (typeof p.stockGlobal === 'number') {
          const sm: any = {}
          for (const br of preStore.branches) sm[br.id] = p.stockGlobal
          stockInp.stocks = sm
        }
        const it = await ps.upsertCatalogItem(user.tenantId, stockInp)
        const label = `${it.name} (${it.sku})`
        if (preIds.has(it.id)) updated.push(label); else created.push(label)
      } catch (e: any) { skipped.push(`${p.name}: ${e?.message || 'error'}`) }
    }
    // Warning super-detallado: muestra los headers que detectó y si falta nombre/precio cuál
    let warning: string | undefined
    const countWithPrice = itemsParsed.filter((x: any) => typeof x.salePrice === 'number' && x.salePrice > 0).length
    const countMissingPrice = itemsParsed.length - countWithPrice
    if (itemsParsed.length === 0) {
      const parts: string[] = []
      if (diagnostic) {
        const cols = (name: string, idx: number, header: string[]) => {
          const h = idx >= 0 && idx < header.length ? header[idx] : null
          return idx < 0 ? '🔴 NO detectado' : `✅ Col ${idx+1}${h ? ` ("${String(h).slice(0,32)}")` : ''}`
        }
        const header = diagnostic.header || []
        parts.push(`[Diagnóstico] Archivo detectado: ${method}${diagnostic.usedGuessMode ? ' · 🤖 Modo sin encabezados activado' : ''} · Filas totales raw: ${diagnostic.rawRows} · Filas con Nombre válido: ${diagnostic.validRows}`)
        parts.push(`  Nombre = ${cols('Nombre', diagnostic.nameColIdx, header)}`)
        parts.push(`  Precio = ${cols('Precio', diagnostic.priceColIdx, header)}`)
        parts.push(`  Costo = ${cols('Costo', diagnostic.costColIdx, header)}`)
        parts.push(`  SKU = ${cols('SKU', diagnostic.skuColIdx, header)}`)
        parts.push(`  Stock = ${cols('Stock', diagnostic.stockColIdx, header)}`)
        parts.push(`  Familia = ${cols('Familia', diagnostic.familyColIdx, header)}`)
        parts.push(`  Categoría = ${cols('Categoría', diagnostic.categoryColIdx, header)}`)
        parts.push(`  Ubicación = ${cols('Ubicación', diagnostic.locationColIdx, header)}`)
        if (header.length) parts.push(`Encabezados encontrados en la fila 1: [${header.map(h => `"${String(h).slice(0,40)}"`).join(', ')}]`)
      } else {
        parts.push('[Diagnóstico] No se pudo extraer tabla del archivo')
      }
      const missing = []
      if (diagnostic?.nameColIdx < 0) missing.push('NOMBRE (columna texto con producto)')
      parts.push(`Tip: Encabezados válidos (cualquier alias en español/inglés) son: Nombre (obligatorio) + Precio (opcional, $0 por default si falta). Opcionales: SKU, Código, Costo, Compra, P.Unitario, PVP, Stock, Existencia, Cantidad, Familia, Línea, Rubro, Departamento, Categoría, Marca, Ubicación, Almacén, Descripción, Notas, Activo, Tipo.`)
      if (missing.length) parts.push(`⚠️ Falta detectar columna de: ${missing.join(' + ')}.`)
      warning = parts.join('\n')
    } else if (countMissingPrice > 0) {
      const parts: string[] = []
      const d = diagnostic
      if (d) {
        const cols = (name: string, idx: number, header: string[]) => {
          const h = idx >= 0 && idx < header.length ? header[idx] : null
          return idx < 0 ? '🔴 NO detectado' : `✅ Col ${idx+1}${h ? ` ("${String(h).slice(0,32)}")` : ''}`
        }
        const header = d.header || []
        const pct = Math.round((countMissingPrice / itemsParsed.length) * 100)
        parts.push(`💡 Se importaron ${itemsParsed.length} productos. ${countMissingPrice}/${itemsParsed.length} (${pct}%) no tenían Precio de Venta y se asignaron $0. ¡Rellénalos manualmente en Catálogo POS / Editar producto!`)
        parts.push(`[Diagnóstico] Archivo detectado: ${method}${d.usedGuessMode ? ' · 🤖 Modo sin encabezados activado' : ''} · Filas raw: ${d.rawRows} · Filas con Nombre válido: ${d.validRows}`)
        parts.push(`  Nombre = ${cols('Nombre', d.nameColIdx, header)} · Precio = ${cols('Precio', d.priceColIdx, header)} · SKU = ${cols('SKU', d.skuColIdx, header)} · Stock = ${cols('Stock', d.stockColIdx, header)}`)
        if (header.length) parts.push(`Encabezados fila 1: [${header.map(h => `"${String(h).slice(0,40)}"`).join(', ')}]`)
      } else parts.push(`💡 ${countMissingPrice} producto(s) importados sin precio ($0). Edítalos manualmente.`)
      warning = parts.join('\n')
    }
    res.json({
      count: itemsParsed.length,
      rawCount: itemsParsedAll.length,
      created,
      updated,
      skipped,
      targetDoc,
      fileName: b.fileName,
      diagnostic,
      warning,
    })
  } catch (e) { next(e) }
})
function guessTargetDoc(kind: any): string {
  return 'productos.md'
}
app.post('/api/pos/catalog/:id/stock', requireAuth, cashierGuard(POS_ADMIN_ROLES), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = res.locals.user as DbAuthUser
    const b = req.body || {}
    const delta = Number(b.delta)
    const branchId = String(b.branchId || 'branch-main')
    if (!Number.isFinite(delta)) { res.status(400).json({ error: 'delta inválido' }); return }
    const next = await (await import('./lib/posStore.js')).adjustStock(user.tenantId, String(req.params.id), branchId, delta, String(b.reason || 'Ajuste manual'), user.email)
    res.json({ stock: next })
  } catch (e) {
    next(e)
  }
})

app.get('/api/pos/inventory-losses', requireAuth, cashierGuard([...POS_ADMIN_ROLES, 'cashier']), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = res.locals.user as DbAuthUser
    res.json({ losses: await listInventoryLosses(user.tenantId) })
  } catch (e) {
    next(e)
  }
})
app.post('/api/pos/inventory-losses', requireAuth, cashierGuard(POS_ADMIN_ROLES), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = res.locals.user as DbAuthUser
    const body = req.body || {}
    const reasons: PosInventoryLossReason[] = ['expired', 'poor_condition', 'damaged', 'other']
    if (typeof body.itemId !== 'string' || !body.itemId.trim()) { res.status(400).json({ error: 'Selecciona un producto' }); return }
    if (typeof body.branchId !== 'string' || !body.branchId.trim()) { res.status(400).json({ error: 'Selecciona una sucursal' }); return }
    if (!Number.isInteger(body.qty) || body.qty < 1) { res.status(400).json({ error: 'La cantidad debe ser un entero mayor a cero' }); return }
    if (typeof body.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.date)) { res.status(400).json({ error: 'La fecha no es válida' }); return }
    const lossDate = new Date(`${body.date}T00:00:00.000Z`)
    if (!Number.isFinite(lossDate.getTime()) || lossDate.toISOString().slice(0, 10) !== body.date) { res.status(400).json({ error: 'La fecha no es válida' }); return }
    if (!reasons.includes(body.reason)) { res.status(400).json({ error: 'Selecciona un motivo válido para la merma' }); return }
    if (body.notes !== undefined && (typeof body.notes !== 'string' || body.notes.length > 500)) {
      res.status(400).json({ error: 'Las observaciones no pueden superar 500 caracteres' })
      return
    }

    try {
      const loss = await createInventoryLoss(user.tenantId, {
        itemId: body.itemId.trim(),
        branchId: body.branchId.trim(),
        date: body.date,
        qty: body.qty,
        reason: body.reason,
        notes: body.notes,
        userEmail: user.email,
        userId: user.id,
      })
      res.status(201).json({ loss })
    } catch (error) {
      if (error instanceof Error && error.message === 'INSUFFICIENT_STOCK') {
        res.status(409).json({ error: 'La cantidad supera las existencias disponibles en esa sucursal' })
        return
      }
      if (error instanceof Error && error.message === 'ITEM_NOT_FOUND') {
        res.status(404).json({ error: 'El producto no existe o no es un artículo de inventario' })
        return
      }
      if (error instanceof Error && error.message === 'BRANCH_NOT_FOUND') {
        res.status(404).json({ error: 'La sucursal no existe o está inactiva' })
        return
      }
      if (error instanceof Error && error.message === 'INVALID_INVENTORY_LOSS') {
        res.status(400).json({ error: 'Los datos de la merma no son válidos' })
        return
      }
      throw error
    }
  } catch (e) {
    next(e)
  }
})

// --- COMPRAS / PROVEEDORES ---
app.get('/api/pos/purchases', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = res.locals.user as DbAuthUser
    res.json({ purchases: await listPurchases(user.tenantId) })
  } catch (e) {
    next(e)
  }
})
app.post('/api/pos/purchases', requireAuth, cashierGuard(POS_ADMIN_ROLES), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = res.locals.user as DbAuthUser
    const b = req.body || {}
    if (typeof b.providerName !== 'string' || !b.providerName.trim()) { res.status(400).json({ error: 'Nombre proveedor obligatorio' }); return }
    if (!b.branchId) { res.status(400).json({ error: 'Sucursal es obligatoria' }); return }
    if (!Array.isArray(b.lines) || b.lines.length < 1) { res.status(400).json({ error: 'Agrega por lo menos una línea' }); return }
    const lines: PosPurchaseLine[] = []
    for (const [index, rawLine] of b.lines.entries()) {
      if (!rawLine || typeof rawLine !== 'object') {
        res.status(400).json({ error: `La línea ${index + 1} no es válida` })
        return
      }
      const qty = Number(rawLine.qty)
      const unitCost = Number(rawLine.unitCost)
      const salePrice = Number(rawLine.salePrice ?? 0)
      const shippingCost = Number(rawLine.shippingCost ?? 0)
      const isNewItem = Boolean(rawLine.isNewItem)
      const newItemName = typeof rawLine.newItemName === 'string' ? rawLine.newItemName.trim() : ''
      if (!Number.isInteger(qty) || qty < 1) { res.status(400).json({ error: `La cantidad de la línea ${index + 1} debe ser un entero mayor a cero` }); return }
      if (typeof rawLine.unitCost === 'boolean' || String(rawLine.unitCost ?? '').trim() === '') { res.status(400).json({ error: `Escribe el costo unitario de la línea ${index + 1}` }); return }
      if (!Number.isFinite(unitCost) || unitCost < 0) { res.status(400).json({ error: `El costo unitario de la línea ${index + 1} no es válido` }); return }
      if (!Number.isFinite(salePrice) || salePrice < 0) { res.status(400).json({ error: `El precio de venta de la línea ${index + 1} no es válido` }); return }
      if (rawLine.shippingCost !== undefined && rawLine.shippingCost !== null && (typeof rawLine.shippingCost === 'boolean' || String(rawLine.shippingCost).trim() === '')) { res.status(400).json({ error: `Escribe el costo de envío de la línea ${index + 1}` }); return }
      if (!Number.isFinite(shippingCost) || shippingCost < 0) { res.status(400).json({ error: `El envío de la línea ${index + 1} no es válido` }); return }
      if (isNewItem && !newItemName) { res.status(400).json({ error: `Escribe el nombre del producto nuevo en la línea ${index + 1}` }); return }
      if (!isNewItem && (typeof rawLine.itemId !== 'string' || !rawLine.itemId.trim())) { res.status(400).json({ error: `Selecciona un producto en la línea ${index + 1}` }); return }
      lines.push({
        itemId: typeof rawLine.itemId === 'string' ? rawLine.itemId : '',
        qty,
        unitCost,
        salePrice,
        shippingCost,
        isNewItem,
        newItemKind: 'product',
        newItemName: isNewItem ? newItemName : undefined,
        newItemSku: typeof rawLine.newItemSku === 'string' ? rawLine.newItemSku : undefined,
      })
    }
    const p = await createPurchase(user.tenantId, {
      branchId: String(b.branchId),
      date: b.date ? String(b.date) : undefined,
      providerName: b.providerName.trim(),
      folio: typeof b.folio === 'string' ? b.folio : undefined,
      total: Number(b.total) || 0,
      currency: typeof b.currency === 'string' ? b.currency : undefined,
      lines,
      notes: typeof b.notes === 'string' ? b.notes : undefined,
      userEmail: user.email,
      createdBy: user.id,
    })
    res.status(201).json({ purchase: p })
  } catch (e) {
    next(e)
  }
})
app.delete('/api/pos/purchases/:id', requireAuth, cashierGuard(POS_ADMIN_ROLES), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = res.locals.user as DbAuthUser
    let ok: boolean
    try {
      ok = await deletePurchase(user.tenantId, String(req.params.id), user.email)
    } catch (error: any) {
      if (error?.message === 'PURCHASE_LOT_ALREADY_USED') {
        res.status(409).json({ error: 'No se puede eliminar esta compra: una parte del lote ya se vendió o se ajustó. Registra una devolución o un ajuste para conservar el costo histórico.' })
        return
      }
      throw error
    }
    if (!ok) { res.status(404).json({ error: 'Compra no encontrada' }); return }
    res.json({ ok: true })
  } catch (e) {
    next(e)
  }
})

// --- SHIFTS / Turnos ---
app.get('/api/pos/shifts/me', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = res.locals.user as DbAuthUser
    const open = await getOpenShift(user.tenantId, user.id)
    res.json({ open })
  } catch (e) {
    next(e)
  }
})
app.post('/api/pos/shifts/open', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = res.locals.user as DbAuthUser
    const b = req.body || {}
    const branchId = String(b.branchId || ((b as any).posBranchId) || 'branch-main')
    const initialCash = Number(b.initialCash) || 0
    const sh = await openShift(user.tenantId, { userId: user.id, userEmail: user.email, branchId, initialCash })
    res.status(200).json({ shift: sh })
  } catch (e) {
    next(e)
  }
})
app.post('/api/pos/shifts/:id/withdraw', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = res.locals.user as DbAuthUser
    const b = req.body || {}
    const amount = Number(b.amount)
    if (!isFinite(amount) || amount <= 0) { res.status(400).json({ error: 'Monto inválido' }); return }
    const w = await withdrawCash(user.tenantId, String(req.params.id), {
      amount,
      reason: typeof b.reason === 'string' ? b.reason : undefined,
      businessExpense: Boolean(b.businessExpense),
      by: user.email,
      userId: user.id,
    })
    res.json({ withdrawal: w })
  } catch (e) {
    next(e)
  }
})
app.post('/api/pos/shifts/:id/close', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = res.locals.user as DbAuthUser
    const sh = await closeShift(user.tenantId, String(req.params.id), user.email)
    res.json({ shift: sh })
  } catch (e) {
    next(e)
  }
})

// --- SALES / POS ---
app.get('/api/pos/sales', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = res.locals.user as DbAuthUser
    const opts: any = {}
    if (req.query.branchId) opts.branchId = String(req.query.branchId)
    if (req.query.limit) opts.limit = Number(req.query.limit)
    if (req.query.from) opts.from = String(req.query.from)
    if (req.query.to) opts.to = String(req.query.to)
    if (typeof req.query.status === 'string') opts.statuses = String(req.query.status).split(',').filter(Boolean) as any
    res.json({ sales: await listSales(user.tenantId, opts) })
  } catch (e) {
    next(e)
  }
})
app.get('/api/pos/sales/:id', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = res.locals.user as DbAuthUser
    const sl = await getSale(user.tenantId, String(req.params.id))
    if (!sl) { res.status(404).json({ error: 'Venta no encontrada' }); return }
    res.json({ sale: sl })
  } catch (e) {
    next(e)
  }
})
app.get('/api/pos/sales/frequent/:branchId', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = res.locals.user as DbAuthUser
    const items = await getFrequentProducts(user.tenantId, String(req.params.branchId), 6)
    res.json({ items })
  } catch (e) {
    next(e)
  }
})
app.post('/api/pos/sales', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = res.locals.user as DbAuthUser
    const b = req.body || {}
    if (!Array.isArray(b.lines) || b.lines.length < 1) { res.status(400).json({ error: 'Agrega al menos un producto al carrito' }); return }
    const sale = await createSale({
      tenantId: user.tenantId,
      branchId: String(b.branchId || (b as any).posBranchId || 'branch-main'),
      shiftId: typeof b.shiftId === 'string' ? b.shiftId : undefined,
      userId: user.id,
      userEmail: user.email,
      customerName: typeof b.customerName === 'string' ? b.customerName : undefined,
      requiresFactura: b.requiresFactura === true,
      status: b.status || 'paid',
      lines: b.lines.map((l: any) => ({
        itemId: String(l.itemId),
        sku: typeof l.sku === 'string' ? l.sku : undefined,
        name: String(l.name),
        qty: Math.max(1, Number(l.qty) || 1),
        unitPrice: Number(l.unitPrice) || 0,
        importe: Number(l.importe || ((Number(l.unitPrice) || 0) * (Number(l.qty) || 1))),
      })),
      payments: Array.isArray(b.payments) ? b.payments.map((p: any) => ({
        id: p.id || ('pmt_' + Math.random().toString(36).slice(2, 10)),
        method: p.method || 'cash',
        amount: Number(p.amount) || 0,
        at: p.at || new Date().toISOString(),
        shiftId: typeof p.shiftId === 'string' ? p.shiftId : undefined,
      })) : [],
      discount: Math.max(0, Number(b.discount) || 0),
    })
    res.status(201).json({ sale })
  } catch (e) {
    next(e)
  }
})
app.post('/api/pos/sales/:id/cancel', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = res.locals.user as DbAuthUser
    const ok = await cancelSale(user.tenantId, String(req.params.id), user.email)
    if (!ok) { res.status(400).json({ error: 'No se pudo cancelar la venta' }); return }
    res.json({ ok: true })
  } catch (e) {
    next(e)
  }
})

// --- SUBUSERS / CUENTAS ---
app.get('/api/pos/subusers', requireAuth, cashierGuard(ANY_ADMIN_ROLES), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = res.locals.user as DbAuthUser
    res.json({ users: await listSubusers(user.tenantId) })
  } catch (e) {
    next(e)
  }
})
app.post('/api/pos/subusers', requireAuth, cashierGuard(ANY_ADMIN_ROLES), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = res.locals.user as DbAuthUser
    const b = req.body || {}
    if (!b.name || !b.email || !b.password || !b.branchId) {
      res.status(400).json({ error: 'Nombre, email, contraseña y sucursal son obligatorios' })
      return
    }
    const role = ASSIGNABLE_SUBUSER_ROLES.includes(b.role) ? (b.role as PosRole) : 'cashier'
    try {
      const u = await createSubuser(user.tenantId, {
        name: String(b.name),
        email: String(b.email),
        password: String(b.password),
        role,
        branchId: String(b.branchId),
        byEmail: user.email,
      })
      res.status(201).json({ user: { id: u.id, email: u.email, name: u.name, role: u.role, branchId: u.branchId, active: u.active } })
    } catch (e: any) {
      if (String(e.message).includes('EMAIL_EXISTS')) { res.status(409).json({ error: 'Ya existe una cuenta con este correo' }); return }
      throw e
    }
  } catch (e) {
    next(e)
  }
})
app.put('/api/pos/subusers/:id', requireAuth, cashierGuard(ANY_ADMIN_ROLES), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = res.locals.user as DbAuthUser
    const b = req.body || {}
    const u = await updateSubuser(user.tenantId, String(req.params.id), {
      name: typeof b.name === 'string' ? b.name : undefined,
      role: ASSIGNABLE_SUBUSER_ROLES.includes(b.role) ? (b.role as PosRole) : undefined,
      branchId: typeof b.branchId === 'string' ? b.branchId : undefined,
      active: typeof b.active === 'boolean' ? b.active : undefined,
      newPassword: typeof b.newPassword === 'string' ? b.newPassword : undefined,
      byEmail: user.email,
    })
    res.json({ user: { id: u.id, email: u.email, name: u.name, role: u.role, branchId: u.branchId, active: u.active } })
  } catch (e) {
    next(e)
  }
})
app.delete('/api/pos/subusers/:id', requireAuth, cashierGuard(ANY_ADMIN_ROLES), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = res.locals.user as DbAuthUser
    const ok = await deleteSubuser(user.tenantId, String(req.params.id), user.email)
    if (!ok) { res.status(404).json({ error: 'Usuario no encontrado' }); return }
    res.json({ ok: true })
  } catch (e) {
    next(e)
  }
})

// --- AUDIT / REGISTROS ---
app.get('/api/pos/audit', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = res.locals.user as DbAuthUser
    const opts: any = {}
    if (typeof req.query.limit === 'string') opts.limit = Math.max(1, Math.min(500, Number(req.query.limit) || 200))
    if (typeof req.query.search === 'string') opts.search = req.query.search
    if (typeof req.query.from === 'string') opts.from = req.query.from
    if (typeof req.query.to === 'string') opts.to = req.query.to
    res.json({ logs: await listAudit(user.tenantId, opts) })
  } catch (e) {
    next(e)
  }
})

app.use((error: Error, _req: Request, res: Response, next: NextFunction) => {
  void next
  const message = error.message || 'Error interno del servidor'
  const isAuthError =
    /jwt|token|sesion|session|expired|unauthorized|auth/i.test(message) &&
    !/obligatorio|registrado|existe|encontrado/i.test(message)
  const isValidationError =
    /invalido|obligatorio|incorrect|vacio|registrado|existe|encontrad[oa]|valid/i.test(message)
  const statusCode = isAuthError ? 401 : isValidationError ? 400 : 500
  res.status(statusCode).json({ error: message })
})

app.delete('/api/documents/:fileName', requireAuth, csGuard(CS_AGENT_ROLES), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const fileName = typeof req.params.fileName === 'string' ? decodeURIComponent(req.params.fileName) : ''
    const user = res.locals.user as DbAuthUser
    await deleteDbDocument(user.tenantId, fileName)
    const ingestion = await ingestDbTenantDocuments(user.tenantId)
    res.status(200).json({ ingestion })
  } catch (error) {
    next(error)
  }
})

app.post('/api/chat', requireAuth, csGuard(CS_ADMIN_ROLES), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : ''
    const message = typeof req.body?.message === 'string' ? req.body.message.trim() : ''
    const history = Array.isArray(req.body?.history) ? req.body.history : []
    const user = res.locals.user as DbAuthUser
    if (!prompt || !message) {
      res.status(400).json({ error: 'El prompt y el mensaje son obligatorios' })
      return
    }
    const answer = await generateDbAgentAnswer({
      tenantId: user.tenantId,
      prompt,
      message,
      history,
    })
    // ===== ARQUITECTURA SIMPLE: NO hay post-sanitizadores, NO hay enforcement de ground truth.
    // Únicamente prompt del tenant + contexto retrieval + historial → LLM → respuesta.
    // Los datos de cada negocio salen de su prompt y sus documentos, nunca del código.
    res.status(200).json(answer)
  } catch (error) {
    next(error)
  }
})

// ============================================
// Scheduled Job: Health Facebook preventivo para TODOS los tenants
// ============================================
// Recorre todos los config_*.json del _meta_store cada 12 horas y ejecuta
// ensureTenantFacebookConnection → renovar user LLT, refresh page token,
// re-subscribe webhook, limpiar pageId si el token fue revocado en Facebook.
;(function startMetaHealthCron() {
  import('node:fs').then((fs) => {
    return import('node:path').then((pathMod) => {
      const path = pathMod.default || pathMod
      const DATA_DIR = path.resolve(process.cwd(), 'clientsdata', '_meta_store')
      async function runAll() {
        try {
          if (!fs.existsSync(DATA_DIR)) return
          const files = fs.readdirSync(DATA_DIR).filter((f) => f.startsWith('config_') && f.endsWith('.json'))
          for (const f of files) {
            try {
              const m = /^config_(.+)\.json$/.exec(f)
              if (!m) continue
              const tenantId = m[1]
              // eslint-disable-next-line no-await-in-loop
              await ensureTenantFacebookConnection(tenantId)
            } catch (e) {
              console.warn('[meta-health] tenant loop error', f, e instanceof Error ? e.message : String(e))
            }
          }
        } catch (e) {
          console.warn('[meta-health] global cron error', e instanceof Error ? e.message : String(e))
        }
      }
      setInterval(() => { void runAll() }, 1000 * 60 * 60 * 12).unref?.()
      // Primera pasada 90s después del arranque (dar tiempo a que express esté listo)
      setTimeout(() => { void runAll() }, 90_000).unref?.()
    })
  }).catch((e) => {
    console.warn('[meta-health] init cron failed', e instanceof Error ? e.message : String(e))
  })
})()

app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: 'API no encontrada' })
})

export default app
