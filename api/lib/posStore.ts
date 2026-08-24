import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import dotenv from 'dotenv'

dotenv.config()
dotenv.config({ path: '.env.local', override: true })

const DATA_DIR = path.resolve(process.cwd(), 'clientsdata', '_meta_store')
try {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })
} catch {}

const LOCAL_JWT_SECRET =
  process.env.SMARTBIS_JWT_SECRET?.trim() ||
  process.env.JWT_SECRET?.trim() ||
  'smartbis-local-jwt-secret-change-me-please-00000000000000000000'

function b64urlEncode(buf: Buffer | string): string {
  const s = typeof buf === 'string' ? Buffer.from(buf) : buf
  return s.toString('base64url')
}
function b64urlDecode(s: string): Buffer {
  return Buffer.from(s, 'base64url')
}
export function signLocalJwt(payload: any, opts?: { ttlSec?: number }): string {
  const ttl = opts?.ttlSec || 60 * 60 * 24 * 30 // 30 días
  const now = Math.floor(Date.now() / 1000)
  const body = { ...payload, iat: now, exp: now + ttl }
  const header = { alg: 'HS256', typ: 'JWT' }
  const signingInput = `${b64urlEncode(JSON.stringify(header))}.${b64urlEncode(JSON.stringify(body))}`
  const sig = crypto.createHmac('sha256', LOCAL_JWT_SECRET).update(signingInput).digest()
  return `${signingInput}.${b64urlEncode(sig)}`
}
export function verifyLocalJwt(token: string): any | null {
  try {
    const parts = String(token || '').trim().split('.')
    if (parts.length !== 3) return null
    const [headB64, bodyB64, sigB64] = parts
    const signingInput = `${headB64}.${bodyB64}`
    const expected = crypto.createHmac('sha256', LOCAL_JWT_SECRET).update(signingInput).digest()
    const actual = b64urlDecode(sigB64)
    if (expected.length !== actual.length) return null
    if (!crypto.timingSafeEqual(expected, actual)) return null
    const payload = JSON.parse(b64urlDecode(bodyB64).toString('utf-8'))
    if (payload.exp && Math.floor(Date.now() / 1000) > payload.exp) return null
    return payload
  } catch {
    return null
  }
}
export type SubuserLoginResult = {
  token: string
  refreshToken: string
  user: {
    id: string
    email: string
    clientId: string
    tenantId: string
    posRole: PosRole
    posBranchId: string
    subuserId: string
    displayName: string
  }
}
export async function loginSubuser(emailRaw: string, password: string): Promise<SubuserLoginResult | undefined> {
  const email = emailRaw.trim().toLowerCase()
  if (!email || !password) return undefined
  const hit = await getSubuserByEmailAllTenants(email)
  if (!hit) return undefined
  if (!verifyPassword(password, hit.user.passwordHash)) return undefined
  const tenantId = hit.tenantId
  // Marcar último login
  const s = await readPosStore(tenantId)
  const idx = s.subusers.findIndex(u => u.id === hit.user.id)
  if (idx >= 0) {
    s.subusers[idx].lastLoginAt = nowISO()
    await writePosStore(tenantId, s)
    await appendAudit(tenantId, {
      userId: hit.user.id,
      userEmail: hit.user.email,
      role: hit.user.role,
      branchId: hit.user.branchId || undefined,
      kind: 'login',
      message: `Inicio de sesión subusuario: ${hit.user.name} (${hit.user.email}) · rol ${hit.user.role}`,
      details: { role: hit.user.role, branchId: hit.user.branchId },
    })
  }
  const sub = hit.user
  const tokenPayload = {
    authKind: 'pos_subuser',
    subuserId: sub.id,
    id: sub.id,
    email: sub.email,
    tenantId,
    posRole: sub.role,
    posBranchId: sub.branchId,
    displayName: sub.name,
  }
  const token = signLocalJwt(tokenPayload, { ttlSec: 60 * 60 * 24 * 30 })
  const refreshToken = signLocalJwt({ ...tokenPayload, rt: 1 }, { ttlSec: 60 * 60 * 24 * 90 })
  return {
    token,
    refreshToken,
    user: {
      id: sub.id,
      email: sub.email,
      clientId: `tenant-${safe(tenantId)}`,
      tenantId,
      posRole: sub.role,
      posBranchId: sub.branchId,
      subuserId: sub.id,
      displayName: sub.name,
    },
  }
}

const safe = (s: string) => String(s || 'default').replace(/[^A-Za-z0-9_\-]/g, '_')
const nowISO = () => new Date().toISOString()
const uid = () => crypto.randomBytes(8).toString('hex')
function removeBOM(s: string) {
  if (!s) return ''
  return s.charCodeAt(0) === 0xFEFF ? s.slice(1) : s
}

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
    const tmp = file + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8')
    fs.renameSync(tmp, file)
  } catch (e) {
    console.error('[posStore] write fail', file, e)
  }
}

function posPath(tenantId: string) {
  return path.join(DATA_DIR, `pos_${safe(tenantId)}.json`)
}

// Tipos públicos
export type PosRole = 'owner' | 'admin' | 'cashier'
export type ItemKind = 'product' | 'service' | 'course' | 'menu_item'
export type PaymentMethod = 'cash' | 'card' | 'transfer' | 'whatsapp' | 'pending'
export type SaleStatus = 'paid' | 'pending' | 'cancelled' | 'quote'

export interface PosBranch {
  id: string
  name: string
  address?: string
  phone?: string
  manager?: string
  isMain: boolean
  active: boolean
  ivaEnabled: boolean
  ivaRate: number
  currency: string
  createdAt: string
  updatedAt: string
}

export interface PosStockMap {
  [branchId: string]: number
}

export interface VolumePriceTier {
  minQty: number
  price: number
}

export interface PosCatalogItem {
  id: string
  kind: ItemKind
  sku: string
  name: string
  family?: string
  category?: string
  description?: string
  costPrice?: number
  salePrice: number
  volumePriceTiers?: VolumePriceTier[]
  currency: string
  stocks: PosStockMap
  location?: string
  tags: string[]
  active: boolean
  attrs?: any
  sourceDocId?: string
  sourceBlockHash?: string
  lastPurchaseCost?: number
  createdAt: string
  updatedAt: string
}

export interface PosPurchaseLine {
  itemId: string
  isNewItem?: boolean
  newItemKind?: ItemKind
  newItemSku?: string
  newItemName?: string
  qty: number
  unitCost: number
}

export interface PosPurchaseOrder {
  id: string
  branchId: string
  date: string
  providerName: string
  folio?: string
  total: number
  currency: string
  lines: PosPurchaseLine[]
  notes?: string
  createdBy: string
  createdAt: string
}

export interface PosShift {
  id: string
  branchId: string
  userId: string
  userEmail: string
  openedAt: string
  closedAt?: string
  initialCash: number
  cashWithdrawals: Array<{ id: string; amount: number; reason?: string; businessExpense: boolean; at: string; by: string }>
  paymentsByMethod: Array<{ method: PaymentMethod; total: number }>
  closingCash?: number
  closingTotal?: number
  status: 'open' | 'closed'
  createdAt: string
  salesCount?: number
  salesTotal?: number
}

export interface PosSaleLine {
  itemId: string
  sku?: string
  name: string
  qty: number
  unitPrice: number
  importe: number
}

export interface PosSale {
  id: string
  tenantId: string
  branchId: string
  shiftId?: string
  userEmail: string
  userId: string
  createdAt: string
  customerName?: string
  requiresFactura: boolean
  status: SaleStatus
  subtotal: number
  ivaAmount: number
  discount: number
  total: number
  paidAmount: number
  pendingAmount: number
  lines: PosSaleLine[]
  payments: Array<{ id: string; method: PaymentMethod; amount: number; at: string }>
  currency: string
  ivaRate: number
}

export interface PosAuditLog {
  id: string
  tenantId: string
  at: string
  userId?: string
  userEmail: string
  role?: PosRole
  branchId?: string
  kind:
    | 'document_edit'
    | 'product_create'
    | 'product_edit'
    | 'product_delete'
    | 'purchase_create'
    | 'sale_create'
    | 'sale_quote'
    | 'cash_withdrawal'
    | 'shift_open'
    | 'shift_close'
    | 'branch_create'
    | 'branch_edit'
    | 'user_create'
    | 'user_edit'
    | 'user_delete'
    | 'config_edit'
    | 'inventory_sync'
    | 'login'
    | 'logout'
    | 'custom'
  message: string
  details?: any
}

export interface PosSubUser {
  id: string
  tenantId: string
  email: string
  passwordHash: string
  name: string
  role: PosRole
  branchId: string
  active: boolean
  createdAt: string
  updatedAt: string
  lastLoginAt?: string
}

export interface PosConfig {
  currencyDefault: string
  language: 'es'
  enableServiceTypes: boolean
  enableMenuTypes: boolean
  enableCourseTypes: boolean
  lowStockThreshold: number
  priceSuggestMultiplier: number
}

export type AutoEvalCategory = 'correct' | 'error' | 'noinfo' | 'judge_failed'

export interface AutoEvalMatchedBlockRef {
  hash: string
  title?: string
  section?: string
  snippet?: string
}

export interface AutoEval {
  id: string
  tenantId: string
  psid?: string
  triggerMessageId?: string
  botMessageId?: string
  triggerMessageText: string
  botAnswerText: string
  category: AutoEvalCategory
  judgeReason: string
  matchedBlocks: AutoEvalMatchedBlockRef[]
  createdAt: string
}

export interface AutoEvalStats {
  total: number
  correct: number
  error: number
  noinfo: number
  judge_failed: number
}

export interface TenantPosData {
  tenantId: string
  branches: PosBranch[]
  catalogItems: PosCatalogItem[]
  purchases: PosPurchaseOrder[]
  shifts: PosShift[]
  sales: PosSale[]
  audit: PosAuditLog[]
  subusers: PosSubUser[]
  config: PosConfig
  autoEvals: AutoEval[]
  createdAt: string
  updatedAt: string
}

function defaultPosData(tenantId: string): TenantPosData {
  const mainBranch: PosBranch = {
    id: 'branch-main',
    name: 'Sucursal Principal',
    address: '',
    phone: '',
    manager: '',
    isMain: true,
    active: true,
    ivaEnabled: true,
    ivaRate: 0.16,
    currency: 'MXN',
    createdAt: nowISO(),
    updatedAt: nowISO(),
  }
  const cfg: PosConfig = {
    currencyDefault: 'MXN',
    language: 'es',
    enableServiceTypes: true,
    enableMenuTypes: true,
    enableCourseTypes: true,
    lowStockThreshold: 3,
    priceSuggestMultiplier: 2,
  }
  return {
    tenantId,
    branches: [mainBranch],
    catalogItems: [],
    purchases: [],
    shifts: [],
    sales: [],
    audit: [],
    subusers: [],
    config: cfg,
    autoEvals: [],
    createdAt: nowISO(),
    updatedAt: nowISO(),
  }
}

export async function readPosStore(tenantId: string): Promise<TenantPosData> {
  const file = posPath(tenantId)
  const data = readJSON<TenantPosData | null>(file, null)
  if (!data) {
    const nc = defaultPosData(tenantId)
    writeJSON(file, nc)
    return nc
  }
  if (!data.branches || data.branches.length === 0) {
    data.branches = [defaultPosData(tenantId).branches[0]]
  }
  const defaults = defaultPosData(tenantId)
  let dirty = false
  data.branches = data.branches.map((b, idx) => {
    const n: any = { ...b }
    if (typeof n.active !== 'boolean') { n.active = true; dirty = true }
    if (typeof n.isMain !== 'boolean') { n.isMain = idx === 0; dirty = true }
    if (typeof n.ivaEnabled !== 'boolean') { n.ivaEnabled = true; dirty = true }
    if (typeof n.ivaRate !== 'number' || isNaN(n.ivaRate) || n.ivaRate < 0) { n.ivaRate = 0.16; dirty = true }
    if (typeof n.currency !== 'string' || !n.currency) { n.currency = defaults.config.currencyDefault; dirty = true }
    if (!n.createdAt || typeof n.createdAt !== 'string') { n.createdAt = nowISO(); dirty = true }
    if (!n.updatedAt || typeof n.updatedAt !== 'string') { n.updatedAt = nowISO(); dirty = true }
    if (!n.id || typeof n.id !== 'string') { n.id = `branch_${uid()}`; dirty = true }
    if (!n.name || typeof n.name !== 'string') { n.name = `Sucursal ${idx + 1}`; dirty = true }
    return n as PosBranch
  })
  if (!data.branches.some(b => b.isMain) && data.branches.length) {
    data.branches[0].isMain = true
    dirty = true
  }
  if (dirty) {
    writeJSON(posPath(tenantId), data)
  }
  if (!data.audit) data.audit = []
  if (!data.config) data.config = defaultPosData(tenantId).config
  if (!data.catalogItems) data.catalogItems = []
  if (!data.purchases) data.purchases = []
  if (!data.shifts) data.shifts = []
  if (!data.sales) data.sales = []
  if (!data.subusers) data.subusers = []
  if (!Array.isArray(data.autoEvals)) data.autoEvals = []
  data.updatedAt = nowISO()
  writeJSON(file, data)
  return data
}

export async function writePosStore(tenantId: string, next: TenantPosData): Promise<TenantPosData> {
  next.updatedAt = nowISO()
  writeJSON(posPath(tenantId), next)
  return next
}

// ============ AUTO-EVALS (SISTEMA DE AUTO-CURADO · JUEZ LLM) ============
export async function createAutoEval(
  tenantId: string,
  input: Omit<AutoEval, 'id' | 'tenantId' | 'createdAt'> & { id?: string; createdAt?: string },
): Promise<AutoEval> {
  const s = await readPosStore(tenantId)
  const entry: AutoEval = {
    id: input.id || uid(),
    tenantId,
    psid: input.psid,
    triggerMessageId: input.triggerMessageId,
    botMessageId: input.botMessageId,
    triggerMessageText: input.triggerMessageText,
    botAnswerText: input.botAnswerText,
    category: input.category,
    judgeReason: input.judgeReason,
    matchedBlocks: input.matchedBlocks || [],
    createdAt: input.createdAt || nowISO(),
  }
  s.autoEvals.unshift(entry)
  if (s.autoEvals.length > 20_000) s.autoEvals.length = 20_000
  await writePosStore(tenantId, s)
  return entry
}

export interface ListAutoEvalsOpts {
  category?: AutoEvalCategory | 'all'
  psid?: string
  search?: string
  limit?: number
  offset?: number
}

export async function listAutoEvals(tenantId: string, opts: ListAutoEvalsOpts = {}) {
  const s = await readPosStore(tenantId)
  let items = s.autoEvals.slice()
  if (opts.category && opts.category !== 'all') {
    items = items.filter(e => e.category === opts.category)
  }
  if (opts.psid) {
    items = items.filter(e => e.psid === opts.psid)
  }
  if (opts.search && opts.search.trim()) {
    const q = opts.search.trim().toLowerCase()
    items = items.filter(e =>
      (e.triggerMessageText || '').toLowerCase().includes(q) ||
      (e.botAnswerText || '').toLowerCase().includes(q) ||
      (e.judgeReason || '').toLowerCase().includes(q),
    )
  }
  const total = items.length
  const offset = typeof opts.offset === 'number' ? Math.max(0, opts.offset) : 0
  const limit = typeof opts.limit === 'number' ? Math.max(1, Math.min(500, opts.limit)) : 100
  const paged = items.slice(offset, offset + limit)
  const stats: AutoEvalStats = s.autoEvals.reduce(
    (acc, e) => {
      acc.total += 1
      if (e.category === 'correct') acc.correct += 1
      else if (e.category === 'error') acc.error += 1
      else if (e.category === 'noinfo') acc.noinfo += 1
      else if (e.category === 'judge_failed') acc.judge_failed += 1
      return acc
    },
    { total: 0, correct: 0, error: 0, noinfo: 0, judge_failed: 0 } satisfies AutoEvalStats,
  )
  return { items: paged, total, stats }
}

export async function getAutoEval(tenantId: string, id: string): Promise<AutoEval | undefined> {
  const s = await readPosStore(tenantId)
  return s.autoEvals.find(e => e.id === id)
}

export async function appendAudit(
  tenantId: string,
  log: Omit<PosAuditLog, 'id' | 'tenantId' | 'at'> & { at?: string; id?: string },
): Promise<PosAuditLog> {
  const store = await readPosStore(tenantId)
  const entry: PosAuditLog = {
    id: log.id || uid(),
    tenantId,
    at: log.at || nowISO(),
    userId: log.userId,
    userEmail: log.userEmail,
    role: log.role,
    branchId: log.branchId,
    kind: log.kind,
    message: log.message,
    details: log.details,
  }
  store.audit.unshift(entry)
  if (store.audit.length > 10_000) store.audit.length = 10_000
  await writePosStore(tenantId, store)
  return entry
}

// ============ BRANCHES ============
export async function listBranches(tenantId: string): Promise<PosBranch[]> {
  const s = await readPosStore(tenantId)
  return s.branches.filter(b => b.active).sort((a, b) => (b.isMain ? 1 : 0) - (a.isMain ? 1 : 0))
}
export async function getBranch(tenantId: string, branchId: string): Promise<PosBranch | undefined> {
  const s = await readPosStore(tenantId)
  return s.branches.find(b => b.id === branchId)
}
export async function upsertBranch(
  tenantId: string,
  inp: Partial<PosBranch> & { name: string; userEmail: string },
): Promise<PosBranch> {
  const s = await readPosStore(tenantId)
  const exist = inp.id ? s.branches.find(b => b.id === inp.id) : undefined
  const normalizedRate =
    typeof inp.ivaRate === 'number' ? (inp.ivaRate > 1 ? inp.ivaRate / 100 : inp.ivaRate) : undefined
  const next: PosBranch = exist
    ? {
        ...exist,
        ...inp,
        ivaRate: normalizedRate !== undefined ? normalizedRate : exist.ivaRate,
        updatedAt: nowISO(),
      }
    : {
        id: inp.id || `branch_${uid()}`,
        name: inp.name,
        address: inp.address || '',
        phone: inp.phone || '',
        manager: inp.manager || '',
        isMain: inp.isMain ?? s.branches.length === 0,
        active: inp.active ?? true,
        ivaEnabled: inp.ivaEnabled ?? true,
        ivaRate: normalizedRate ?? 0.16,
        currency: inp.currency || s.config.currencyDefault,
        createdAt: nowISO(),
        updatedAt: nowISO(),
      }
  if (!exist) s.branches.push(next)
  else {
    const idx = s.branches.findIndex(b => b.id === next.id)
    s.branches[idx] = next
  }
  await writePosStore(tenantId, s)
  await appendAudit(tenantId, {
    userEmail: inp.userEmail,
    kind: exist ? 'branch_edit' : 'branch_create',
    message: exist
      ? `Editó sucursal: ${next.name} (IVA ${(next.ivaRate * 100).toFixed(0)}% · ${next.ivaEnabled ? 'Activo' : 'Inactivo'})`
      : `Creó nueva sucursal: ${next.name} (IVA ${(next.ivaRate * 100).toFixed(0)}%)`,
    branchId: next.id,
    details: next,
  })
  return next
}
export async function deleteBranch(tenantId: string, branchId: string, userEmail: string): Promise<boolean> {
  const s = await readPosStore(tenantId)
  const br = s.branches.find(b => b.id === branchId)
  if (!br) return false
  if (br.isMain) return false
  s.branches = s.branches.filter(b => b.id !== branchId)
  await writePosStore(tenantId, s)
  await appendAudit(tenantId, {
    userEmail,
    kind: 'custom',
    message: `Desactivó/Eliminó sucursal: ${br.name}`,
    branchId,
  })
  return true
}

// ============ CATALOG ITEMS ============
export async function listCatalog(
  tenantId: string,
  opts?: { kinds?: ItemKind[]; activeOnly?: boolean; branchId?: string; search?: string },
): Promise<PosCatalogItem[]> {
  const s = await readPosStore(tenantId)
  const kinds = opts?.kinds
  let list = s.catalogItems
  if (opts?.activeOnly !== false) list = list.filter(i => i.active)
  if (kinds && kinds.length > 0) list = list.filter(i => kinds.includes(i.kind))
  if (opts?.search) {
    const q = String(opts.search).toLowerCase()
    list = list.filter(
      i =>
        i.name.toLowerCase().includes(q) ||
        i.sku.toLowerCase().includes(q) ||
        (i.family || '').toLowerCase().includes(q) ||
        (i.category || '').toLowerCase().includes(q),
    )
  }
  return list.sort((a, b) => a.name.localeCompare(b.name))
}
export async function getCatalogItem(tenantId: string, id: string): Promise<PosCatalogItem | undefined> {
  const s = await readPosStore(tenantId)
  return s.catalogItems.find(i => i.id === id)
}
export async function upsertCatalogItem(
  tenantId: string,
  inp: Partial<PosCatalogItem> & { name: string; salePrice: number; userEmail: string; syncToMdDoc?: string },
): Promise<PosCatalogItem> {
  const s = await readPosStore(tenantId)
  // Lookup: prefer id, then exact SKU match (previene duplicados al re-importar mismo CSV)
  const exist: PosCatalogItem | undefined = inp.id
    ? s.catalogItems.find(i => i.id === inp.id)
    : (inp.sku && inp.sku.trim())
      ? s.catalogItems.find(i => (i.sku || '').trim() === inp.sku!.trim())
      : undefined
  const branches = s.branches.map(b => b.id)
  const defaultStocks: PosStockMap = {}
  branches.forEach(bid => (defaultStocks[bid] = 0))
  const stocks = { ...defaultStocks, ...(exist?.stocks || {}), ...(inp.stocks || {}) }
  branches.forEach(bid => {
    if (typeof stocks[bid] !== 'number' || Number.isNaN(stocks[bid])) stocks[bid] = 0
  })
  const next: PosCatalogItem = exist
    ? { ...exist, ...inp, stocks, updatedAt: nowISO() }
    : {
        id: inp.id || `cat_${uid()}`,
        kind: inp.kind || 'product',
        sku: inp.sku || uid().slice(0, 8).toUpperCase(),
        name: inp.name,
        family: inp.family || '',
        category: inp.category || '',
        description: inp.description || '',
        costPrice: inp.costPrice,
        salePrice: inp.salePrice,
        currency: inp.currency || s.config.currencyDefault,
        stocks,
        location: inp.location || '',
        tags: inp.tags || [],
        active: inp.active ?? true,
        attrs: inp.attrs || {},
        sourceDocId: inp.sourceDocId,
        sourceBlockHash: inp.sourceBlockHash,
        lastPurchaseCost: inp.lastPurchaseCost,
        createdAt: nowISO(),
        updatedAt: nowISO(),
      }
  if (!exist) s.catalogItems.push(next)
  else {
    const idx = s.catalogItems.findIndex(i => i.id === next.id)
    s.catalogItems[idx] = next
  }
  await writePosStore(tenantId, s)
  await appendAudit(tenantId, {
    userEmail: inp.userEmail,
    kind: exist ? 'product_edit' : 'product_create',
    message: exist
      ? `Editó ítem catálogo: ${next.name} (${next.sku} · ${next.kind})`
      : `Creó ítem catálogo: ${next.name} (${next.sku} · ${next.kind}) · Precio: $${next.salePrice}`,
    details: next,
  })
  if (inp.syncToMdDoc !== null) {
    const target = inp.syncToMdDoc || next.sourceDocId || docHintForKind(next.kind)
    try { await syncCatalogWriteToMd(tenantId, exist ? 'edit' : 'create', next, target, inp.userEmail) } catch {}
  }
  return next
}
function docHintForKind(k: ItemKind): string {
  if (k === 'product') return 'productos.md'
  if (k === 'course') return 'cursos.md'
  if (k === 'service') return 'servicios.md'
  if (k === 'menu_item') return 'menu.md'
  return 'productos.md'
}
export async function deleteCatalogItem(tenantId: string, id: string, userEmail: string): Promise<boolean> {
  const s = await readPosStore(tenantId)
  const it = s.catalogItems.find(i => i.id === id)
  if (!it) return false
  const target = it.sourceDocId || docHintForKind(it.kind)
  try { await syncCatalogWriteToMd(tenantId, 'delete', it, target, userEmail) } catch {}
  s.catalogItems = s.catalogItems.filter(i => i.id !== id)
  await writePosStore(tenantId, s)
  await appendAudit(tenantId, {
    userEmail,
    kind: 'product_delete',
    message: `Eliminó del catálogo: ${it.name} (${it.sku})`,
    details: { sku: it.sku, kind: it.kind },
  })
  return true
}
export async function adjustStock(
  tenantId: string,
  itemId: string,
  branchId: string,
  delta: number,
  reason: string,
  userEmail: string,
): Promise<number> {
  const s = await readPosStore(tenantId)
  const it = s.catalogItems.find(i => i.id === itemId)
  if (!it) throw new Error('ITEM_NOT_FOUND')
  const cur = it.stocks[branchId] || 0
  const next = Math.max(0, cur + delta)
  it.stocks[branchId] = next
  it.updatedAt = nowISO()
  await writePosStore(tenantId, s)
  await appendAudit(tenantId, {
    userEmail,
    kind: 'custom',
    message: `Ajuste inventario ${it.name} (${branchId}): ${cur} → ${next} · ${reason}`,
    branchId,
    details: { itemId, branchId, delta, prev: cur, next },
  })
  const target = it.sourceDocId || docHintForKind(it.kind)
  try { await syncCatalogWriteToMd(tenantId, 'stock', it, target, userEmail) } catch {}
  return next
}

// ============ PURCHASES ============
export async function listPurchases(tenantId: string): Promise<PosPurchaseOrder[]> {
  const s = await readPosStore(tenantId)
  return [...s.purchases].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
}
export async function createPurchase(
  tenantId: string,
  inp: {
    branchId: string
    date?: string
    providerName: string
    folio?: string
    total: number
    currency?: string
    lines: PosPurchaseLine[]
    notes?: string
    userEmail: string
    createdBy?: string
  },
): Promise<PosPurchaseOrder> {
  const s = await readPosStore(tenantId)
  const branch = s.branches.find(b => b.id === inp.branchId)
  if (!branch) throw new Error('BRANCH_NOT_FOUND')
  const created: PosPurchaseOrder = {
    id: `pur_${uid()}`,
    branchId: inp.branchId,
    date: inp.date || nowISO(),
    providerName: inp.providerName,
    folio: inp.folio,
    total: inp.total,
    currency: inp.currency || s.config.currencyDefault,
    lines: inp.lines || [],
    notes: inp.notes,
    createdBy: inp.createdBy || inp.userEmail,
    createdAt: nowISO(),
  }
  for (const l of created.lines) {
    if (l.isNewItem && l.newItemName) {
      const newItem: PosCatalogItem = {
        id: `cat_${uid()}`,
        kind: l.newItemKind || 'product',
        sku: l.newItemSku || uid().slice(0, 8).toUpperCase(),
        name: l.newItemName,
        family: '',
        category: '',
        description: '',
        costPrice: l.unitCost,
        salePrice: l.unitCost * (s.config.priceSuggestMultiplier || 2),
        currency: s.config.currencyDefault,
        stocks: Object.fromEntries(s.branches.map(b => [b.id, 0])),
        tags: [],
        active: true,
        attrs: {},
        lastPurchaseCost: l.unitCost,
        createdAt: nowISO(),
        updatedAt: nowISO(),
      }
      newItem.stocks[branch.id] = l.qty
      s.catalogItems.push(newItem)
      l.itemId = newItem.id
    } else {
      const it = s.catalogItems.find(i => i.id === l.itemId)
      if (!it) continue
      it.stocks[branch.id] = (it.stocks[branch.id] || 0) + l.qty
      it.lastPurchaseCost = l.unitCost
      if (!it.costPrice) it.costPrice = l.unitCost
      it.updatedAt = nowISO()
    }
  }
  s.purchases.unshift(created)
  await writePosStore(tenantId, s)
  await appendAudit(tenantId, {
    userEmail: inp.userEmail,
    kind: 'purchase_create',
    message: `Compra a proveedor: ${created.providerName} · $${created.total} (${branch.name}). ${created.lines.length} líneas.`,
    branchId: branch.id,
    details: created,
  })
  return created
}

// ============ SHIFTS ============
function enrichShiftTotals(sh: PosShift, sales: PosSale[]): PosShift {
  const shiftSales = sales.filter(
    sl => sl.shiftId === sh.id && sl.status !== 'cancelled' && sl.status !== 'quote',
  )
  const salesCount = shiftSales.length
  const salesTotal = shiftSales.reduce((a, s) => a + (s.total || 0), 0)
  return { ...sh, salesCount, salesTotal }
}
export async function getOpenShift(tenantId: string, userId: string): Promise<PosShift | undefined> {
  const s = await readPosStore(tenantId)
  const open = s.shifts.find(sh => sh.status === 'open' && sh.userId === userId)
  if (!open) return undefined
  return enrichShiftTotals(open, s.sales)
}
export async function openShift(
  tenantId: string,
  inp: { userId: string; userEmail: string; branchId: string; initialCash: number },
): Promise<PosShift> {
  const s = await readPosStore(tenantId)
  const openExist = s.shifts.find(sh => sh.status === 'open' && sh.userId === inp.userId)
  if (openExist) return openExist
  const sh: PosShift = {
    id: `sh_${uid()}`,
    branchId: inp.branchId,
    userId: inp.userId,
    userEmail: inp.userEmail,
    openedAt: nowISO(),
    initialCash: inp.initialCash || 0,
    cashWithdrawals: [],
    paymentsByMethod: [],
    status: 'open',
    createdAt: nowISO(),
  }
  s.shifts.unshift(sh)
  await writePosStore(tenantId, s)
  await appendAudit(tenantId, {
    userEmail: inp.userEmail,
    userId: inp.userId,
    kind: 'shift_open',
    message: `Aperturó turno en ${s.branches.find(b => b.id === inp.branchId)?.name || inp.branchId} · Efectivo inicial $${inp.initialCash}`,
    branchId: inp.branchId,
  })
  return sh
}
export async function withdrawCash(
  tenantId: string,
  shiftId: string,
  inp: { amount: number; reason?: string; businessExpense: boolean; by: string; userId: string },
): Promise<PosShift['cashWithdrawals'][number]> {
  const s = await readPosStore(tenantId)
  const sh = s.shifts.find(x => x.id === shiftId)
  if (!sh || sh.status !== 'open') throw new Error('SHIFT_NOT_OPEN')
  const w = {
    id: `w_${uid()}`,
    amount: inp.amount,
    reason: inp.reason || '',
    businessExpense: Boolean(inp.businessExpense),
    at: nowISO(),
    by: inp.by,
  }
  sh.cashWithdrawals.push(w)
  await writePosStore(tenantId, s)
  await appendAudit(tenantId, {
    userEmail: inp.by,
    userId: inp.userId,
    kind: 'cash_withdrawal',
    message: `Retiro de efectivo $${w.amount}${inp.businessExpense ? ' (gasto empresa)' : ''}${w.reason ? ' · ' + w.reason : ''}`,
    branchId: sh.branchId,
    details: w,
  })
  return w
}
export async function closeShift(
  tenantId: string,
  shiftId: string,
  userEmail: string,
): Promise<PosShift> {
  const s = await readPosStore(tenantId)
  const sh = s.shifts.find(x => x.id === shiftId)
  if (!sh || sh.status !== 'open') throw new Error('SHIFT_NOT_OPEN')
  const shiftSales = s.sales.filter(
    sl => sl.shiftId === shiftId && sl.status !== 'cancelled' && sl.status !== 'quote',
  )
  const byMethod: Record<string, number> = {}
  let paid = 0
  for (const sl of shiftSales) {
    paid += sl.paidAmount || 0
    for (const p of sl.payments) byMethod[p.method] = (byMethod[p.method] || 0) + p.amount
  }
  const cashIn = sh.initialCash + (byMethod['cash'] || 0)
  const withdraws = sh.cashWithdrawals.reduce((a, b) => a + b.amount, 0)
  sh.paymentsByMethod = Object.entries(byMethod).map(([method, total]) => ({ method: method as PaymentMethod, total }))
  sh.closingCash = Math.max(0, cashIn - withdraws)
  sh.closingTotal = paid
  sh.closedAt = nowISO()
  sh.status = 'closed'
  sh.salesCount = shiftSales.length
  sh.salesTotal = shiftSales.reduce((a, sl) => a + (sl.total || 0), 0)
  await writePosStore(tenantId, s)
  await appendAudit(tenantId, {
    userEmail,
    userId: sh.userId,
    kind: 'shift_close',
    message: `Cerró turno. Pagos totales $${paid} · Efectivo teórico $${sh.closingCash} · Retiros $${withdraws} · Ventas ${sh.salesCount}`,
    branchId: sh.branchId,
    details: { paid, withdraws, closingCash: sh.closingCash, salesCount: sh.salesCount, salesTotal: sh.salesTotal },
  })
  return sh
}

// ============ SALES / POS ============
export async function listSales(
  tenantId: string,
  opts?: { branchId?: string; from?: string; to?: string; statuses?: SaleStatus[]; limit?: number },
): Promise<PosSale[]> {
  const s = await readPosStore(tenantId)
  let list = s.sales.slice()
  if (opts?.branchId) list = list.filter(sl => sl.branchId === opts!.branchId)
  if (opts?.statuses && opts.statuses.length > 0) list = list.filter(sl => opts!.statuses!.includes(sl.status))
  if (opts?.from) list = list.filter(sl => sl.createdAt >= opts!.from!)
  if (opts?.to) list = list.filter(sl => sl.createdAt <= opts!.to!)
  list.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  return opts?.limit ? list.slice(0, opts.limit) : list
}
export async function getSale(tenantId: string, saleId: string): Promise<PosSale | undefined> {
  const s = await readPosStore(tenantId)
  return s.sales.find(sl => sl.id === saleId)
}
export interface PosCreateSaleInput {
  tenantId: string
  branchId: string
  shiftId?: string
  userId: string
  userEmail: string
  customerName?: string
  requiresFactura: boolean
  status: SaleStatus
  lines: PosSaleLine[]
  payments: PosSale['payments']
  discount: number
}
export async function createSale(inp: PosCreateSaleInput): Promise<PosSale> {
  const s = await readPosStore(inp.tenantId)
  const branch = s.branches.find(b => b.id === inp.branchId)
  if (!branch) throw new Error('BRANCH_NOT_FOUND')
  if (inp.status === 'paid') {
    for (const l of inp.lines) {
      const it = s.catalogItems.find(i => i.id === l.itemId)
      if (!it) continue
      it.stocks[branch.id] = Math.max(0, (it.stocks[branch.id] || 0) - l.qty)
      it.updatedAt = nowISO()
    }
  }
  const subtotal = inp.lines.reduce((a, l) => a + l.importe, 0)
  const discount = Math.max(0, inp.discount || 0)
  const withDiscount = Math.max(0, subtotal - discount)
  const ivaEnabled = branch.ivaEnabled
  const ivaRate = branch.ivaRate || 0
  const ivaAmount = ivaEnabled ? +(withDiscount * ivaRate).toFixed(2) : 0
  const total = +(withDiscount + ivaAmount).toFixed(2)
  const paidAmount = (inp.payments || []).reduce((a, b) => a + b.amount, 0)
  const pendingAmount = +Math.max(0, total - paidAmount).toFixed(2)
  const finalStatus: SaleStatus =
    inp.status === 'quote'
      ? 'quote'
      : pendingAmount <= 0.001
        ? 'paid'
        : paidAmount > 0
          ? 'pending'
          : 'pending'
  const sale: PosSale = {
    id: `sl_${uid()}`,
    tenantId: inp.tenantId,
    branchId: inp.branchId,
    shiftId: inp.shiftId,
    userId: inp.userId,
    userEmail: inp.userEmail,
    createdAt: nowISO(),
    customerName: inp.customerName,
    requiresFactura: inp.requiresFactura,
    status: finalStatus,
    subtotal: +subtotal.toFixed(2),
    ivaAmount,
    discount: +discount.toFixed(2),
    total,
    paidAmount: +paidAmount.toFixed(2),
    pendingAmount,
    lines: inp.lines,
    payments: inp.payments || [],
    currency: s.config.currencyDefault,
    ivaRate,
  }
  s.sales.unshift(sale)
  if (inp.shiftId) {
    const sh = s.shifts.find(x => x.id === inp.shiftId)
    if (sh && sh.status === 'open') {
      for (const p of sale.payments) {
        const m = sh.paymentsByMethod.find(x => x.method === p.method)
        if (m) m.total = +(m.total + p.amount).toFixed(2)
        else sh.paymentsByMethod.push({ method: p.method, total: p.amount })
      }
    }
  }
  await writePosStore(inp.tenantId, s)
  await appendAudit(inp.tenantId, {
    userEmail: inp.userEmail,
    userId: inp.userId,
    branchId: branch.id,
    kind: sale.status === 'quote' ? 'sale_quote' : 'sale_create',
    message:
      sale.status === 'quote'
        ? `Cotización: $${total} · ${sale.lines.length} líneas · Cliente: ${sale.customerName || '(sin nombre)'}`
        : `Venta ${sale.status}: $${total} (Pagado $${paidAmount} · Pend $${pendingAmount}) · ${sale.lines.length} líneas · ${sale.customerName || '(sin nombre)'}`,
    details: sale,
  })
  return sale
}
export async function cancelSale(tenantId: string, saleId: string, userEmail: string): Promise<boolean> {
  const s = await readPosStore(tenantId)
  const sl = s.sales.find(sl => sl.id === saleId)
  if (!sl) return false
  if (sl.status === 'cancelled' || sl.status === 'quote') return false
  // revertir stock
  if (sl.status === 'paid') {
    for (const l of sl.lines) {
      const it = s.catalogItems.find(i => i.id === l.itemId)
      if (!it) continue
      it.stocks[sl.branchId] = (it.stocks[sl.branchId] || 0) + l.qty
      it.updatedAt = nowISO()
    }
  }
  sl.status = 'cancelled'
  await writePosStore(tenantId, s)
  await appendAudit(tenantId, {
    userEmail,
    userId: sl.userId,
    branchId: sl.branchId,
    kind: 'custom',
    message: `Canceló venta ${saleId} · $${sl.total}`,
    details: { saleId, total: sl.total },
  })
  return true
}

// ============ FREQUENT PRODUCTS ============
export async function getFrequentProducts(
  tenantId: string,
  branchId: string,
  limit = 6,
): Promise<Array<{ itemId: string; name: string; sku: string; qty: number; salePrice: number; stock: number }>> {
  const s = await readPosStore(tenantId)
  const qtyByItem: Record<string, number> = {}
  for (const sl of s.sales) {
    if (sl.branchId !== branchId) continue
    if (sl.status === 'cancelled' || sl.status === 'quote') continue
    for (const l of sl.lines) qtyByItem[l.itemId] = (qtyByItem[l.itemId] || 0) + l.qty
  }
  const top = Object.entries(qtyByItem)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
  const out = top
    .map(([id, qty]) => {
      const it = s.catalogItems.find(i => i.id === id)
      if (!it) return null
      return {
        itemId: it.id,
        name: it.name,
        sku: it.sku,
        qty,
        salePrice: it.salePrice,
        stock: it.stocks[branchId] || 0,
      }
    })
    .filter(Boolean) as any
  return out
}

// ============ SUBUSERS ============
export async function listSubusers(tenantId: string): Promise<PosSubUser[]> {
  const s = await readPosStore(tenantId)
  return s.subusers.slice().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
}
export async function getSubuser(tenantId: string, idOrEmail: string): Promise<PosSubUser | undefined> {
  const s = await readPosStore(tenantId)
  return s.subusers.find(u => u.id === idOrEmail || u.email.toLowerCase() === idOrEmail.toLowerCase())
}
export async function getSubuserByEmailAllTenants(email: string): Promise<{ tenantId: string; user: PosSubUser } | undefined> {
  const files = fs.readdirSync(DATA_DIR).filter(f => f.startsWith('pos_') && f.endsWith('.json'))
  for (const f of files) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), 'utf-8')) as TenantPosData
      const u = data.subusers.find(x => x.email.toLowerCase() === email.toLowerCase() && x.active)
      if (u) return { tenantId: data.tenantId, user: u }
    } catch {}
  }
  return undefined
}

export function hashPassword(pw: string): string {
  const salt = crypto.randomBytes(8).toString('hex')
  const h = crypto.pbkdf2Sync(pw, salt, 120_000, 32, 'sha256').toString('hex')
  return salt + '$' + h
}
export function verifyPassword(pw: string, hashed: string): boolean {
  try {
    const [salt, h] = hashed.split('$')
    const expected = crypto.pbkdf2Sync(pw, salt, 120_000, 32, 'sha256').toString('hex')
    return crypto.timingSafeEqual(Buffer.from(h), Buffer.from(expected))
  } catch {
    return false
  }
}
export async function createSubuser(
  tenantId: string,
  inp: { name: string; email: string; password: string; role: PosRole; branchId: string; byEmail: string },
): Promise<PosSubUser> {
  const s = await readPosStore(tenantId)
  if (s.subusers.some(u => u.email.toLowerCase() === inp.email.toLowerCase())) {
    throw new Error('EMAIL_EXISTS')
  }
  const normalizedRole = inp.role === 'owner' ? 'admin' : inp.role
  const branchRequiredForRole = normalizedRole === 'cashier'
  const branch = inp.branchId ? s.branches.find(b => b.id === inp.branchId) : undefined
  if (branchRequiredForRole && !branch) throw new Error('BRANCH_NOT_FOUND')
  const effectiveBranchId = branch ? branch.id : s.branches[0]?.id || ''
  const u: PosSubUser = {
    id: `usr_${uid()}`,
    tenantId,
    email: inp.email.trim().toLowerCase(),
    passwordHash: hashPassword(inp.password),
    name: inp.name.trim(),
    role: normalizedRole,
    branchId: effectiveBranchId,
    active: true,
    createdAt: nowISO(),
    updatedAt: nowISO(),
  }
  s.subusers.push(u)
  await writePosStore(tenantId, s)
  await appendAudit(tenantId, {
    userEmail: inp.byEmail,
    kind: 'user_create',
    message: `Creó cuenta sub-usuario: ${u.name} (${u.email}) · Rol ${u.role}${branch ? ` · Sucursal ${branch.name}` : u.role === 'admin' ? ' (sin sucursal, control total)' : ''}`,
    branchId: u.branchId || undefined,
    details: { role: u.role, branchId: u.branchId, email: u.email },
  })
  return u
}
export async function updateSubuser(
  tenantId: string,
  id: string,
  inp: { name?: string; role?: PosRole; branchId?: string; active?: boolean; newPassword?: string; byEmail: string },
): Promise<PosSubUser> {
  const s = await readPosStore(tenantId)
  const u = s.subusers.find(x => x.id === id)
  if (!u) throw new Error('USER_NOT_FOUND')
  if (inp.name) u.name = inp.name
  if (inp.role) u.role = inp.role === 'owner' ? 'admin' : inp.role
  if (typeof inp.branchId === 'string') {
    const normalizedRole = u.role
    const branchRequiredForRole = normalizedRole === 'cashier'
    const branch = inp.branchId ? s.branches.find(b => b.id === inp.branchId) : undefined
    if (branchRequiredForRole && !branch) throw new Error('BRANCH_NOT_FOUND')
    u.branchId = branch ? branch.id : s.branches[0]?.id || ''
  }
  if (typeof inp.active === 'boolean') u.active = inp.active
  if (inp.newPassword) u.passwordHash = hashPassword(inp.newPassword)
  u.updatedAt = nowISO()
  await writePosStore(tenantId, s)
  await appendAudit(tenantId, {
    userEmail: inp.byEmail,
    kind: 'user_edit',
    message: `Editó cuenta ${u.name} (${u.email}) · rol=${u.role} activo=${u.active}`,
    branchId: u.branchId || undefined,
  })
  return u
}
export async function deleteSubuser(tenantId: string, id: string, byEmail: string): Promise<boolean> {
  const s = await readPosStore(tenantId)
  const u = s.subusers.find(x => x.id === id)
  if (!u) return false
  s.subusers = s.subusers.filter(x => x.id !== id)
  await writePosStore(tenantId, s)
  await appendAudit(tenantId, {
    userEmail: byEmail,
    kind: 'user_delete',
    message: `Eliminó cuenta sub-usuario: ${u.name} (${u.email})`,
  })
  return true
}

// ============ AUDIT ============
export async function listAudit(
  tenantId: string,
  opts?: {
    kinds?: PosAuditLog['kind'][]
    userEmails?: string[]
    from?: string
    to?: string
    search?: string
    limit?: number
  },
): Promise<PosAuditLog[]> {
  const s = await readPosStore(tenantId)
  let list = s.audit.slice()
  if (opts?.kinds && opts.kinds.length > 0) list = list.filter(l => opts!.kinds!.includes(l.kind))
  if (opts?.userEmails && opts.userEmails.length > 0) {
    const set = new Set(opts.userEmails.map(e => e.toLowerCase()))
    list = list.filter(l => set.has(l.userEmail.toLowerCase()))
  }
  if (opts?.from) list = list.filter(l => l.at >= opts!.from!)
  if (opts?.to) list = list.filter(l => l.at <= opts!.to!)
  if (opts?.search) {
    const q = String(opts.search).toLowerCase()
    list = list.filter(l => l.message.toLowerCase().includes(q) || (l.userEmail || '').toLowerCase().includes(q))
  }
  return opts?.limit ? list.slice(0, opts.limit) : list
}

// ============ INVENTORY SYNC FROM DOCS (parser markdow -> catalog_items) ============
export interface SyncResult {
  created: string[]
  updated: string[]
  skipped: string[]
  report: string
}
export async function syncCatalogFromDocuments(
  tenantId: string,
  documents: Array<{ id: string; title?: string; contentMarkdown?: string; section?: string }>,
  userEmail: string,
): Promise<SyncResult> {
  const store = await readPosStore(tenantId)
  const created: string[] = []
  const updated: string[] = []
  const skipped: string[] = []
  function hashBlock(text: string) {
    return crypto.createHash('sha256').update(text).digest('hex').slice(0, 12)
  }
  const detectKind = (title: string, section: string | undefined, block: string): ItemKind => {
    const tl = `${title} ${section || ''} ${block}`.toLowerCase()
    if (tl.includes('curso') || tl.includes('clase') || tl.includes('taller') || tl.includes('diplomado')) return 'course'
    if (tl.includes('servicio') || tl.includes('mano de obra') || tl.includes('cita')) return 'service'
    if (tl.includes('menu') || tl.includes('pizz') || tl.includes('bebida') || tl.includes('comida') || tl.includes('platillo'))
      return 'menu_item'
    return 'product'
  }
  const blocksSplit = (md: string) => {
    if (!md) return []
    return md
      .split(/\n\s*\n/)
      .map(b => b.trim())
      .filter(b => b.length > 40 || /(?:nombre|precio|producto|curso|servicio|código|sku|descripción)/i.test(b))
  }
  for (const doc of documents) {
    const blocks = blocksSplit(doc.contentMarkdown || '')
    for (const blk of blocks) {
      try {
        const lines = blk.split('\n').map(l => l.trim()).filter(Boolean)
        const blockHead = lines.slice(0, 6).join('\n')
        if (!/(?:datos del (?:producto|servicio|curso))|(?:precio:)|(?:\$\s?\d)/i.test(blockHead)) {
          skipped.push(`Bloque sin datos en ${doc.title || doc.id}: ${lines[0]?.slice(0, 50)}`)
          continue
        }
        const kind = detectKind(doc.title || '', doc.section, blk)
        const get = (regexes: RegExp[]): string | undefined => {
          for (const r of regexes) {
            const m = blk.match(r)
            if (m && m[1]) return m[1].trim()
          }
          return undefined
        }
        const name = get([
          /1\)\s*nombre\s*[:：]\s*([^\n]+)/i,
          /nombre\s*[:：]\s*([^\n]+)/i,
          /producto[:：]\s*\d+\)\s*([^\n]+)/i,
          /curso[:：]\s*([^\n·|]+)/i,
          /servicio[:：]\s*([^\n·|]+)/i,
        ])
        if (!name) {
          skipped.push(`No pude extraer nombre de bloque ${doc.title}`)
          continue
        }
        const sku =
          get([/2\)\s*código\s*[:：]\s*([^\n]+)/i, /sku\s*[:：]\s*([^\n]+)/i, /código\s*[:：]\s*([^\n]+)/i]) ||
          name.replace(/[^A-Z0-9]/gi, '').slice(0, 10).toUpperCase()
        const family = get([/3\)\s*familia\s*[:：]\s*([^\n]+)/i, /familia\s*[:：]\s*([^\n]+)/i])
        const category = get([/4\)\s*categoría\s*[:：]\s*([^\n]+)/i, /categoría\s*[:：]\s*([^\n]+)/i])
        const priceRaw = get([/5\)\s*precio\s*[:：]\s*\$?\s*([0-9][0-9.,]*)/i, /precio\s*[:：]\s*\$?\s*([0-9][0-9.,]*)/i])
        const salePrice = priceRaw ? parseFloat(priceRaw.replace(/,/g, '')) : NaN
        if (!isFinite(salePrice) || salePrice <= 0) {
          skipped.push(`Precio inválido para ${name}`)
          continue
        }
        const bh = hashBlock(blk)
        const exist = store.catalogItems.find(
          i =>
            i.sourceBlockHash === bh ||
            (i.sku.toLowerCase() === sku.toLowerCase() && i.name.toLowerCase() === name.toLowerCase()),
        )
        const base: Partial<PosCatalogItem> & { name: string; salePrice: number; userEmail: string } = {
          kind,
          sku,
          name,
          family: family || '',
          category: category || '',
          description: blk.slice(0, 1000),
          salePrice,
          currency: store.config.currencyDefault,
          sourceDocId: doc.id,
          sourceBlockHash: bh,
          userEmail,
        }
        if (exist) {
          if (exist.sourceBlockHash !== bh) {
            Object.assign(exist, {
              kind: base.kind,
              name: base.name,
              family: base.family,
              category: base.category,
              description: base.description,
              salePrice: base.salePrice,
              currency: base.currency,
              sourceDocId: base.sourceDocId,
              sourceBlockHash: base.sourceBlockHash,
              updatedAt: nowISO(),
            })
            updated.push(`${exist.name} (${exist.sku})`)
          } else {
            skipped.push(`Sin cambios · ${name}`)
          }
        } else {
          const brIds = store.branches.map(b => b.id)
          const initStocks: PosStockMap = Object.fromEntries(brIds.map(bid => [bid, 0]))
          store.catalogItems.push({
            id: `cat_${uid()}`,
            kind: base.kind!,
            sku: base.sku!,
            name: base.name,
            family: base.family || '',
            category: base.category || '',
            description: base.description || '',
            costPrice: undefined,
            salePrice: base.salePrice,
            currency: base.currency!,
            stocks: initStocks,
            tags: [],
            active: true,
            attrs: {},
            sourceDocId: base.sourceDocId,
            sourceBlockHash: base.sourceBlockHash,
            createdAt: nowISO(),
            updatedAt: nowISO(),
          })
          created.push(`${base.name} (${base.sku} · TIPO ${base.kind})`)
        }
      } catch (e: any) {
        skipped.push(`Error parseando bloque en ${doc.title || doc.id}: ${e?.message || e}`)
      }
    }
  }
  store.updatedAt = nowISO()
  await writePosStore(tenantId, store)
  const report = `Sincronización completada: ${created.length} nuevos · ${updated.length} actualizados · ${skipped.length} sin cambios/omitidos.`
  await appendAudit(tenantId, {
    userEmail,
    kind: 'inventory_sync',
    message: report,
    details: { created: created.length, updated: updated.length, skippedCount: skipped.length, docIds: documents.map(d => d.id) },
  })
  return { created, updated, skipped, report }
}

// helper para que dbWorkspace dispare documento editado -> audit
export async function logDocumentEdit(tenantId: string, userEmail: string, documentId: string, title: string, extras?: any) {
  return appendAudit(tenantId, {
    userEmail,
    kind: 'document_edit',
    message: `Editó documento: ${title || documentId}`,
    details: { documentId, title, ...(extras || {}) },
  })
}

// ============ TENANT MD DOCUMENTS (raw file management) ============
export interface MdFileInfo {
  fileName: string
  sizeBytes: number
  updatedAt: string
  wordCount: number
}
export function tenantDocsDir(tenantId: string) {
  return path.resolve(DATA_DIR, '..', safe(tenantId))
}
function ensureDir(p: string) {
  try { if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }) } catch {}
}
export async function listTenantMdFiles(tenantId: string): Promise<MdFileInfo[]> {
  const dir = tenantDocsDir(tenantId)
  ensureDir(dir)
  const all = fs.readdirSync(dir).filter(f => f.toLowerCase().endsWith('.md'))
  return all
    .map(f => {
      try {
        const st = fs.statSync(path.join(dir, f))
        const content = fs.readFileSync(path.join(dir, f), 'utf-8')
        return {
          fileName: f,
          sizeBytes: st.size,
          updatedAt: st.mtime.toISOString(),
          wordCount: content.split(/\s+/).filter(Boolean).length,
        }
      } catch { return null }
    })
    .filter(Boolean)
    .sort((a: any, b: any) => b.updatedAt.localeCompare(a.updatedAt)) as MdFileInfo[]
}
export async function readTenantMdFile(tenantId: string, fileName: string): Promise<{ fileName: string; content: string; updatedAt: string } | null> {
  const safeFn = String(fileName).replace(/[/\\]/g, '_').replace(/^\.+/, '')
  if (!safeFn.toLowerCase().endsWith('.md')) return null
  const p = path.join(tenantDocsDir(tenantId), safeFn)
  try {
    if (!fs.existsSync(p)) return null
    const st = fs.statSync(p)
    return { fileName: safeFn, content: fs.readFileSync(p, 'utf-8'), updatedAt: st.mtime.toISOString() }
  } catch { return null }
}
export async function writeTenantMdFile(tenantId: string, fileName: string, content: string): Promise<{ fileName: string; ok: boolean }> {
  let safeFn = String(fileName).replace(/[/\\]/g, '_').replace(/^\.+/, '')
  if (!safeFn.toLowerCase().endsWith('.md')) safeFn = safeFn + '.md'
  const dir = tenantDocsDir(tenantId)
  ensureDir(dir)
  fs.writeFileSync(path.join(dir, safeFn), content, 'utf-8')
  return { fileName: safeFn, ok: true }
}
export function renderCatalogItemBlock(it: PosCatalogItem, branches?: PosBranch[]): string {
  const stocks = branches && branches.length
    ? branches.map(b => `- Stock ${b.name}: ${it.stocks?.[b.id] ?? 0}`).join('\n')
    : Object.entries(it.stocks || {}).map(([bid, q]) => `- Stock ${bid}: ${q}`).join('\n') || '- Stock: 0'
  const lines: string[] = []
  lines.push(`## ${it.name}`)
  lines.push(`- SKU: ${it.sku}`)
  lines.push(`- Tipo: ${it.kind}`)
  lines.push(`- Nombre: ${it.name}`)
  lines.push(`- Familia: ${it.family || ''}`)
  lines.push(`- Categoría: ${it.category || ''}`)
  lines.push(`- Precio costo: ${it.costPrice ?? ''}`)
  lines.push(`- Precio venta: ${it.salePrice}`)
  lines.push(`- Moneda: ${it.currency || 'MXN'}`)
  lines.push(stocks)
  if (it.location) lines.push(`- Ubicación: ${it.location}`)
  if (it.description) lines.push(`- Descripción: ${String(it.description).replace(/\s+/g, ' ').slice(0, 500)}`)
  lines.push(`- Activo: ${it.active ? 'Sí' : 'No'}`)
  lines.push('')
  return lines.join('\n')
}
// split markdown into blocks by ## headings, skipping non-item headings
export function splitMdBlocks(md: string): Array<{ key: string; title: string; block: string }> {
  const blocks: Array<{ key: string; title: string; block: string }> = []
  const parts = md.split(/(?=^##\s)/m)
  for (const raw of parts) {
    const block = raw.trim()
    if (!block) continue
    const title = (block.match(/^##\s+(.+)$/m)?.[1] || '').trim()
    if (!title) continue
    const skuMatch = block.match(/^-\s*SKU:\s*(.+)$/m)
    const key = skuMatch?.[1]?.trim() || title
    blocks.push({ key, title, block })
  }
  return blocks
}
export async function upsertItemIntoMd(tenantId: string, fileName: string, item: PosCatalogItem, branches?: PosBranch[]): Promise<boolean> {
  let safeFn = String(fileName).replace(/[/\\]/g, '_').replace(/^\.+/, '')
  if (!safeFn.toLowerCase().endsWith('.md')) safeFn = safeFn + '.md'
  const dir = tenantDocsDir(tenantId)
  ensureDir(dir)
  const p = path.join(dir, safeFn)
  let md = fs.existsSync(p) ? fs.readFileSync(p, 'utf-8') : `# ${safeFn.replace(/\.md$/i, '')}\n\n`
  const rendered = renderCatalogItemBlock(item, branches)
  const key = item.sku || item.name
  const blocks = splitMdBlocks(md)
  const idx = blocks.findIndex(b => b.key === key)
  if (idx >= 0) {
    // replace block in-place
    const whole = splitPreservingHeadings(md)
    whole.blocks[idx] = rendered
    md = whole.preamble + '\n\n' + whole.blocks.filter(Boolean).join('\n\n') + '\n'
  } else {
    md = md.trimEnd() + '\n\n' + rendered + '\n'
  }
  fs.writeFileSync(p, md, 'utf-8')
  return true
}
function splitPreservingHeadings(md: string): { preamble: string; blocks: string[] } {
  const lines = md.split('\n')
  const headingIndexes: number[] = []
  lines.forEach((l, i) => { if (/^##\s/.test(l)) headingIndexes.push(i) })
  if (headingIndexes.length === 0) return { preamble: md, blocks: [] }
  const preamble = lines.slice(0, headingIndexes[0]).join('\n').trim()
  const blocks: string[] = []
  for (let i = 0; i < headingIndexes.length; i++) {
    const from = headingIndexes[i]
    const to = i + 1 < headingIndexes.length ? headingIndexes[i + 1] : lines.length
    blocks.push(lines.slice(from, to).join('\n').trim())
  }
  return { preamble, blocks }
}
export async function removeItemFromMd(tenantId: string, fileName: string, itemOrSku: string | PosCatalogItem): Promise<boolean> {
  let safeFn = String(fileName).replace(/[/\\]/g, '_').replace(/^\.+/, '')
  if (!safeFn.toLowerCase().endsWith('.md')) safeFn = safeFn + '.md'
  const p = path.join(tenantDocsDir(tenantId), safeFn)
  if (!fs.existsSync(p)) return false
  const key = typeof itemOrSku === 'string' ? itemOrSku : (itemOrSku.sku || itemOrSku.name)
  let md = fs.readFileSync(p, 'utf-8')
  const blocks = splitMdBlocks(md)
  const idx = blocks.findIndex(b => b.key === key)
  if (idx < 0) return false
  const whole = splitPreservingHeadings(md)
  whole.blocks.splice(idx, 1)
  const next = whole.preamble + (whole.blocks.length ? '\n\n' + whole.blocks.join('\n\n') + '\n' : '\n')
  fs.writeFileSync(p, next, 'utf-8')
  return true
}

// ============ IMPORT PARSE (CSV / JSON / XLSX-lite TSV) ============
export interface ParsedImportItem {
  kind?: ItemKind
  sku?: string
  name: string
  family?: string
  category?: string
  costPrice?: number
  salePrice?: number
  location?: string
  description?: string
  active?: boolean
  stockByBranch?: PosStockMap
  stockGlobal?: number
}
export type ParsedImportResult = {
  items: ParsedImportItem[];
  rows: string[][];
  diagnostic: ParsedRowsDiagnostic;
  ext: string;
  method: 'excel' | 'csv' | 'json' | 'pdf-parsed' | 'pdf-free';
}
export async function parseImportBuffer(buffer: Buffer, originalName: string): Promise<ParsedImportItem[]>
export async function parseImportBuffer(buffer: Buffer, originalName: string, opts: { returnDiagnostics: true }): Promise<ParsedImportResult>
export async function parseImportBuffer(buffer: Buffer, originalName: string, opts?: any): Promise<ParsedImportItem[] | ParsedImportResult> {
  const ext = (originalName.split('.').pop() || '').toLowerCase()
  const returnExtra = !!opts?.returnDiagnostics
  const emptyDiag = (): ParsedRowsDiagnostic => ({ header:[], nameColIdx:-1, priceColIdx:-1, costColIdx:-1, skuColIdx:-1, stockColIdx:-1, kindColIdx:-1, familyColIdx:-1, categoryColIdx:-1, locationColIdx:-1, descriptionColIdx:-1, activeColIdx:-1, usedGuessMode:false, sampleRow0:[], validRows:0, rawRows:0, dataStartsAtRow: 0 })
  const wrap = (items: ParsedImportItem[], method: ParsedImportResult['method'], rows: string[][] = [], diagnostic: ParsedRowsDiagnostic = emptyDiag()): any => {
    if (returnExtra) return { items, rows, diagnostic, ext, method }
    return items
  }
  // PDF: extrae texto simple a partir de bloques BT ... ET, concatenando strings entre paréntesis
  if (ext === 'pdf') {
    const text = extractTextFromPdfBuffer(buffer)
    const rowsRaw = splitToRows(text, 'csv')
    const rows = trimLeadingGarbageRows(rowsRaw)
    // fallthrough si hay rows con header; si no, parseamos líneas sueltas del texto como si fuera TSV
    if (rows.length > 1 && rows[0].some(c => /nombre|name|sku|precio|price|costo|stock/i.test(c))) {
      return wrap(parseRowsToItems(rows), 'pdf-parsed', rows, diagnoseRows(rows))
    }
    // intentar parsear líneas del PDF como items 1-per-line con regex
    return wrap(parseFreeTextAsItems(text), 'pdf-free', rows, diagnoseRows(rows))
  }
  // ============ EXCEL .xlsx / .xls / .ods (sheetjs) ===============
  const isZipLike = buffer.length >= 2 && buffer[0] === 0x50 && buffer[1] === 0x4b
  if (isZipLike || ext === 'xlsx' || ext === 'xlsm' || ext === 'xls' || ext === 'ods') {
    try {
      let XLSX: any = null
      try {
        // @ts-ignore
        XLSX = require('xlsx')
      } catch { /* ignore */ }
      if (!XLSX) {
        try {
          const mod = await import('xlsx')
          XLSX = (mod as any).default || mod
        } catch { /* ignore */ }
      }
      if (XLSX) {
        const wb = XLSX.read(buffer, { type: 'buffer' })
        if (wb && wb.SheetNames && wb.SheetNames.length) {
          const sheetName = wb.SheetNames[0]
          const ws = wb.Sheets[sheetName]
          const rowsFlat = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '', blankrows: false }) as any[][]
          const rowsRaw = (Array.isArray(rowsFlat) ? rowsFlat : []).map(row => row.map(cell => String(cell ?? '')))
          const rows = trimLeadingGarbageRows(rowsRaw)
          if (rows.length > 0) {
            return wrap(parseRowsToItems(rows), 'excel', rows, diagnoseRows(rows))
          }
        }
      }
    } catch (e: any) {
      // fallthrough a csv manual si falla
    }
  }
  const text = buffer.toString('utf-8')
  if (ext === 'json') {
    try {
      const data = JSON.parse(text)
      const list = Array.isArray(data) ? data : Array.isArray((data as any).items) ? (data as any).items : []
      return wrap(list.map(normalizeImportRow), 'json')
    } catch { return wrap([], 'json') }
  }
  // CSV / TSV / xlsx-as-tsv / txt
  const rowsRaw = splitToRows(text, ext)
  const rows = trimLeadingGarbageRows(rowsRaw)
  return wrap(parseRowsToItems(rows), 'csv', rows, diagnoseRows(rows))
}
export type ParsedRowsDiagnostic = {
  header: string[];
  nameColIdx: number;
  priceColIdx: number;
  costColIdx: number;
  skuColIdx: number;
  stockColIdx: number;
  kindColIdx: number;
  familyColIdx: number;
  categoryColIdx: number;
  locationColIdx: number;
  descriptionColIdx: number;
  activeColIdx: number;
  usedGuessMode: boolean;
  sampleRow0: string[];
  validRows: number;
  rawRows: number;
  dataStartsAtRow: number;
}
export function diagnoseRows(rows: string[][]): ParsedRowsDiagnostic {
  if (!rows || rows.length === 0) {
    return { header:[], nameColIdx:-1, priceColIdx:-1, costColIdx:-1, skuColIdx:-1, stockColIdx:-1, kindColIdx:-1, familyColIdx:-1, categoryColIdx:-1, locationColIdx:-1, descriptionColIdx:-1, activeColIdx:-1, usedGuessMode:false, sampleRow0:[], validRows:0, rawRows: rows?.length || 0, dataStartsAtRow: 0 }
  }
  const header0 = rows[0].map((c: string) => removeBOM(c).toLowerCase().trim())
  const colOf = (names: string[]) => header0.findIndex(h => names.some(n => h.includes(n)))
  let iName = colOf(['nombre', 'name', 'producto', 'product', 'título', 'titulo', 'articulo', 'artículo', 'item', 'concepto', 'denominación', 'denominacion', 'descripcion corta', 'descripción corta', 'descripcion producto', 'descripción producto', 'descripcion corta producto', 'nombre del producto', 'nombre producto', 'nom. producto', 'product name'])
  let iSku = colOf(['sku', 'código', 'codigo', 'code', 'clave', 'cod.', 'código de barras', 'codigo de barras', 'barcode', 'barras', 'referencia', 'ref.', 'ref', 'número parte', 'numero parte', 'part no', 'part number'])
  let iKind = colOf(['tipo', 'kind', 'category-type', 'tipo producto', 'clase', 'tipo de producto', 'clasif.', 'clasificacion', 'clasificación', 'type'])
  let iFamily = colOf(['familia', 'family', 'línea', 'linea', 'linea producto', 'rubro', 'departamento', 'depto.', 'grupo', 'sector'])
  let iCategory = colOf(['categoría', 'categoria', 'category', 'subfamilia', 'sub-familia', 'subcategoría', 'subcategoria', 'marca', 'brand', 'línea producto'])
  let iCost = colOf(['costo', 'cost', 'precio costo', 'cost price', 'precio de costo', 'precio compra', 'precio de compra', 'costo unitario', 'costo u.', 'coste', 'cu'])
  let iPrice = colOf(['precio', 'price', 'venta', 'precio venta', 'sale price', 'precio de venta', 'pvp', 'p.u.', 'pu', 'precio unitario', 'precio público', 'precio lista', 'importe', 'valor venta', 'valor', 'total unitario', 'subtotal unitario', 'precio sugerido', 'precio final'])
  let iLoc = colOf(['ubicación', 'ubicacion', 'location', 'lugar', 'almacén', 'almacen', 'almacenaje', 'pasillo', 'estante', 'rack', 'posición', 'posicion', 'sucursal', 'bodega', 'area', 'área'])
  let iDesc = colOf(['descripción', 'descripcion', 'description', 'detalle', 'notes', 'notas', 'observaciones', 'comentarios', 'detalle producto', 'características', 'caracteristicas', 'especificaciones', 'descripción larga', 'descripcion larga'])
  let iActive = colOf(['activo', 'active', 'status', 'estado', 'habilitado', 'vigente', 'alta', 'habilitado?', 'activo?', 'es activo', 'publicado', 'publicado?'])
  let iStock = colOf(['stock', 'existencia', 'existencias', 'cantidad', 'quantity', 'qty', 'inventario', 'existencia actual', 'stock actual', 'unidades', 'piezas', 'pz.', 'pza', 'saldo', 'disponible', 'cantidad disponible', 'existencia disponible'])
  let usedGuessMode = false
  const numericCol = (row: string[], minVal = 0) => {
    let bestIdx = -1; let bestVal = -Infinity
    for (let j = 0; j < row.length; j++) {
      const n = parseFloat(String(row[j] || '').replace(/[^0-9.,\-]/g, '').replace(/,/g, ''))
      if (isFinite(n) && n >= minVal && n > bestVal) { bestVal = n; bestIdx = j }
    }
    return bestIdx
  }
  const longestTextCol = (row: string[]) => {
    let best = -1; let bestLen = 0
    for (let j = 0; j < row.length; j++) {
      const c = String(row[j] || '').trim()
      if (!c) continue
      const looksLikeNumber = /^[0-9.,$%\s-]+$/.test(c)
      if (looksLikeNumber) continue
      if (c.length > bestLen) { bestLen = c.length; best = j }
    }
    return best
  }
  const rowLooksLikeData = (r: string[]) => {
    if (!r || !r.length) return false
    const longestTextIdx = longestTextCol(r)
    const priceIdx = numericCol(r, 1)
    return longestTextIdx >= 0 && priceIdx >= 0 && longestTextIdx !== priceIdx
  }
  const header0IsHeaderData = rowLooksLikeData(rows[0])
  const guessRows = (header0IsHeaderData ? rows.slice(0, 5) : rows.slice(1, 6)).filter(r => r && r.some(x => String(x || '').trim() !== ''))
  if ((iName < 0 || iPrice < 0) && guessRows.length > 0) {
    usedGuessMode = true
    const vote = (fn: (r: string[]) => number) => {
      const counts: Record<number, number> = {}
      for (const r of guessRows) { const idx = fn(r); if (idx >= 0) counts[idx] = (counts[idx] || 0) + 1 }
      const entries = Object.entries(counts).sort((a,b) => b[1]-a[1])
      return entries.length ? parseInt(entries[0][0],10) : -1
    }
    const used = new Set<number>()
    if (iSku >= 0) used.add(iSku)
    if (iName >= 0) used.add(iName)
    if (iPrice >= 0) used.add(iPrice)
    if (iCost >= 0) used.add(iCost)
    if (iStock >= 0) used.add(iStock)
    if (iKind >= 0) used.add(iKind)
    if (iFamily >= 0) used.add(iFamily)
    if (iCategory >= 0) used.add(iCategory)
    if (iLoc >= 0) used.add(iLoc)
    if (iDesc >= 0) used.add(iDesc)
    if (iActive >= 0) used.add(iActive)
    if (iName < 0) {
      iName = vote(longestTextCol)
      // Post-check: si la col nombre elegida es un SKU pattern (alfanum corto), swap por segunda longest
      if (iName >= 0) {
        const samples = guessRows.map(r => String(r[iName]||'').trim()).filter(Boolean)
        const mostlyShortAlphaNum = samples.filter(s => /^[A-Za-z0-9\-_.\/# ]{3,25}$/.test(s)).length > Math.max(1, Math.floor(samples.length*0.6))
        if (mostlyShortAlphaNum) {
          const vote2 = (fn: (r: string[]) => number) => {
            const counts: Record<number, number> = {}
            for (const r of guessRows) { const idx = fn(r); if (idx >= 0 && idx !== iName) counts[idx] = (counts[idx] || 0) + 1 }
            const entries = Object.entries(counts).sort((a,b) => b[1]-a[1])
            return entries.length ? parseInt(entries[0][0],10) : -1
          }
          const iName2 = vote2(longestTextCol)
          if (iName2 >= 0) { // El anterior era el SKU
            if (iSku < 0) iSku = iName
            iName = iName2
          }
        }
      }
      if (iName>=0) used.add(iName)
    }
    if (iPrice < 0) { iPrice = numericColVote(guessRows, 'max', used); if (iPrice>=0) used.add(iPrice) }
    // Stock: entero pequeño no usado (lo resolvemos antes de costo para excluirlo de costo)
    if (iStock < 0) {
      iStock = numericColVote(guessRows, 'intSmallWhole', used)
      if (iStock>=0) used.add(iStock)
    }
    // Costo: SEGUNDO número más grande (menor que 95% precio, no stock)
    if (iCost < 0) {
      const counts: Record<number, number> = {}
      for (const r of guessRows) {
        let bestJ = -1; let bestN = -Infinity
        for (let j = 0; j < r.length; j++) {
          if (used.has(j)) continue
          const n = parseFloat(String(r[j] || '').replace(/[^0-9.,\-]/g, '').replace(/,/g, ''))
          if (!isFinite(n) || n <= 0) continue
          const priceN = pickNum(r, iPrice)
          if (isFinite(priceN!) && n >= priceN! * 0.95) continue
          if (n > bestN) { bestN = n; bestJ = j }
        }
        if (bestJ>=0) counts[bestJ] = (counts[bestJ]||0)+1
      }
      const entries = Object.entries(counts).sort((a,b)=>b[1]-a[1])
      if (entries.length) { iCost = parseInt(entries[0][0],10); used.add(iCost) }
    }
    // SKU: columna alfanum corta no usada
    if (iSku < 0) {
      const counts: Record<number, number> = {}
      for (const r of guessRows) {
        for (let j = 0; j < r.length; j++) {
          if (used.has(j)) continue
          const c = String(r[j] || '').trim()
          if (!c) continue
          if (c.length > 3 && c.length < 28 && /^[A-Za-z0-9\-_.\/# ]*$/.test(c)) { counts[j] = (counts[j]||0)+1 }
        }
      }
      const best = Object.entries(counts).sort((a,b) => b[1]-a[1])
      if (best.length) { iSku = parseInt(best[0][0],10); used.add(iSku) }
    }
    // Tipo / Familia / Categoría / Ubicación / Descripción: ordenadas por longitud media
    if (iKind<0 || iFamily<0 || iCategory<0 || iLoc<0 || iDesc<0) {
      const colAvgLen: Record<number,number> = {}
      const colCount: Record<number,number> = {}
      for (const r of guessRows) for (let j=0; j<r.length; j++) {
        if (used.has(j)) continue
        const c = String(r[j]||'').trim()
        if (!c) continue
        if (/^[0-9.,$%\s-]+$/.test(c)) continue
        colAvgLen[j] = (colAvgLen[j]||0) + c.length
        colCount[j] = (colCount[j]||0) + 1
      }
      const orderedCols = Object.entries(colAvgLen).map(([j,sum])=>({j:parseInt(j,10),avg:sum/(colCount[parseInt(j,10)]||1)})).sort((a,b)=>a.avg-b.avg)
      const rem = orderedCols.slice()
      const pickNext = () => {
        const t = rem.shift(); if (!t) return -1; used.add(t.j); return t.j
      }
      if (iKind<0 && rem.length) iKind = pickNext()
      if (iFamily<0 && rem.length) iFamily = pickNext()
      if (iCategory<0 && rem.length) iCategory = pickNext()
      if (iLoc<0 && rem.length) iLoc = rem.pop()?.j ?? -1
      if (iDesc<0 && rem.length) iDesc = rem.pop()?.j ?? -1
    }
  }
  // valid rows count
  let validRows = 0
  const dataStartsAtRow = usedGuessMode && header0IsHeaderData ? 0 : 1
  for (let r = dataStartsAtRow; r < rows.length; r++) {
    const row = rows[r]
    if (!row || !row.length) continue
    const name = pickStr(row, iName)
    // El NOMBRE es el único campo obligatorio. Precio/faltante se completa manualmente después.
    if (name && String(name).trim().length >= 2) validRows++
  }
  return {
    header: rows[0] || [],
    nameColIdx: iName, priceColIdx: iPrice, costColIdx: iCost, skuColIdx: iSku, stockColIdx: iStock,
    kindColIdx: iKind, familyColIdx: iFamily, categoryColIdx: iCategory,
    locationColIdx: iLoc, descriptionColIdx: iDesc, activeColIdx: iActive,
    usedGuessMode, sampleRow0: rows[dataStartsAtRow] || [], validRows, rawRows: rows.length, dataStartsAtRow,
  }
}
function numericColCount(row: string[]) {
  let count = 0
  for (let j = 0; j < row.length; j++) {
    const n = parseFloat(String(row[j] || '').replace(/[^0-9.,\-]/g, '').replace(/,/g, ''))
    if (isFinite(n) && n >= 0) count++
  }
  return count
}
function numericColVote(rows: string[][], mode: 'max'|'minCostExcludingStock'|'intSmallWhole', excludeCols: Set<number> = new Set()): number {
  const counts: Record<number, number> = {}
  for (const r of rows) {
    if (mode === 'max') {
      let bestIdx = -1; let best = -Infinity
      for (let j = 0; j < r.length; j++) {
        if (excludeCols.has(j)) continue
        const n = parseFloat(String(r[j] || '').replace(/[^0-9.,\-]/g, '').replace(/,/g, ''))
        if (isFinite(n) && n > best) { best = n; bestIdx = j }
      }
      if (bestIdx >= 0) counts[bestIdx] = (counts[bestIdx]||0)+1
    } else if (mode === 'minCostExcludingStock') {
      let bestIdx = -1; let best = Infinity
      for (let j = 0; j < r.length; j++) {
        if (excludeCols.has(j)) continue
        const n = parseFloat(String(r[j] || '').replace(/[^0-9.,\-]/g, '').replace(/,/g, ''))
        if (!isFinite(n) || n <= 0) continue
        // Exclude whole integers small (< 10,000 and .00) as stock
        if (Number.isInteger(n) && n < 10000) continue
        if (n < best) { best = n; bestIdx = j }
      }
      if (bestIdx >= 0) counts[bestIdx] = (counts[bestIdx]||0)+1
    } else if (mode === 'intSmallWhole') {
      let bestIdx = -1; let bestCount = 0
      const local: Record<number, number> = {}
      for (let j = 0; j < r.length; j++) {
        if (excludeCols.has(j)) continue
        const raw = String(r[j] || '').trim()
        if (!raw) continue
        // Must be 90% digits (no long text)
        const digits = (raw.match(/[0-9]/g) || []).length
        if (digits < raw.length * 0.7) continue
        const n = parseFloat(raw.replace(/[^0-9.,\-]/g, '').replace(/,/g, ''))
        if (!isFinite(n) || n < 0) continue
        if (Number.isInteger(n) && n < 1000000) { local[j] = (local[j]||0)+1 }
      }
      for (const [k,v] of Object.entries(local)) if (v > bestCount) { bestCount = v; bestIdx = parseInt(k,10) }
      if (bestIdx >= 0) counts[bestIdx] = (counts[bestIdx]||0)+1
    }
  }
  const e = Object.entries(counts).sort((a,b) => b[1]-a[1])
  return e.length ? parseInt(e[0][0],10) : -1
}
export function parseRowsToItems(rows: string[][]): ParsedImportItem[] {
  if (!rows || rows.length === 0) return []
  const d = diagnoseRows(rows)
  const startR = d.dataStartsAtRow
  const out: ParsedImportItem[] = []
  for (let r = startR; r < rows.length; r++) {
    const row = rows[r]
    if (!row || !row.length) continue
    const name = pickStr(row, d.nameColIdx)
    if (!name || String(name).trim().length < 2) continue
    const price = pickNum(row, d.priceColIdx)
    const finalPrice = isFinite(price!) ? price : 0
    // Si el costo no existe, undefined; si el stock no existe, undefined; lo demas igual
    const maybeFamily = pickStr(row, d.familyColIdx)
    const maybeCategory = pickStr(row, d.categoryColIdx)
    const maybeKindHint = pickStr(row, d.kindColIdx) || maybeCategory || maybeFamily
    out.push({
      kind: guessKindFromString(maybeKindHint || name),
      sku: pickStr(row, d.skuColIdx) || undefined,
      name: String(name).trim(),
      family: maybeFamily || undefined,
      category: maybeCategory || undefined,
      costPrice: pickNum(row, d.costColIdx),
      salePrice: finalPrice,
      location: pickStr(row, d.locationColIdx) || undefined,
      description: pickStr(row, d.descriptionColIdx) || undefined,
      active: pickBool(row, d.activeColIdx),
      stockGlobal: pickNum(row, d.stockColIdx),
    })
  }
  return out
}
function parseFreeTextAsItems(text: string): ParsedImportItem[] {
  const lines = text.replace(/\r/g, '\n').split('\n').map(l => l.trim()).filter(Boolean)
  const out: ParsedImportItem[] = []
  for (const line of lines) {
    // capturar patrones estilo "SKU-123 Ibuprofeno 400mg $25.00 $45.00 42"
    const m = line.match(/^([A-Za-z0-9\-]{3,})?\s*([^\$\d].*?)\s*\$?\s*([0-9]+(?:[.,][0-9]+)?)\s*\$?\s*([0-9]+(?:[.,][0-9]+)?)\s*([0-9]+)?\s*$/)
    if (m) {
      const [, sku, name, cost, price, stock] = m
      const clean = (s: string) => (s || '').replace(/,/g, '')
      const p = parseFloat(clean(price))
      if (name && name.trim() && isFinite(p)) {
        out.push({
          kind: 'product',
          sku: sku || undefined,
          name: name.trim(),
          costPrice: cost ? parseFloat(clean(cost)) : undefined,
          salePrice: p,
          stockGlobal: stock ? parseInt(stock, 10) : undefined,
          active: true,
        })
      }
    }
  }
  return out
}
function extractTextFromPdfBuffer(buf: Buffer): string {
  // Estrategia ligera sin dependencias:
  // 1. Descomprime streams FlateDecode si aparece (no implementado).
  // 2. Busca bloques "BT ... ET" y captura todo texto dentro de paréntesis.
  // 3. Concatena con saltos de línea para simular filas.
  const raw = buf.toString('binary')
  const blocks: string[] = []
  const btRe = /BT\b([\s\S]*?)ET/g
  let match: any
  while ((match = btRe.exec(raw)) !== null) {
    const body = match[1] || ''
    // capturar strings en paréntesis: (texto)
    const strRe = /\(((?:\\.|[^\\)])*)\)/g
    let sm: any
    let line = ''
    while ((sm = strRe.exec(body)) !== null) {
      const t = String(sm[1] || '')
        .replace(/\\\(/g, '(').replace(/\\\)/g, ')')
        .replace(/\\n/g, '\n').replace(/\\r/g, '').replace(/\\t/g, '\t')
      line += (line && /\s$/.test(line) ? '' : ' ') + t
    }
    if (line.trim()) blocks.push(line.trim())
  }
  if (blocks.length === 0) {
    // Fallback: extraer cualquier cadena ASCII imprimible agrupada
    const fb = raw.match(/[\x20-\x7E\u00C0-\u00FF]{4,}/g) || []
    return fb.join('\n')
  }
  return blocks.join('\n')
}
function guessKindFromString(s: string): ItemKind | undefined {
  const t = s.toLowerCase()
  if (!t) return undefined
  if (t.includes('servic')) return 'service'
  if (t.includes('curso') || t.includes('clase') || t.includes('taller') || t.includes('diplomado')) return 'course'
  if (t.includes('menu') || t.includes('pizz') || t.includes('comida') || t.includes('platillo') || t.includes('bebida')) return 'menu_item'
  return 'product'
}
function splitToRows(text: string, ext: string): string[][] {
  const norm = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim()
  const delim = (ext === 'csv' || norm.indexOf(';') < 0) ? ',' : ';'
  const tsv = norm.indexOf('\t') > -1
  const lines = norm.split('\n').filter(l => l.trim().length > 0)
  return lines.map(line => {
    if (tsv) return line.split('\t')
    return parseCsvLine(line, delim)
  })
}
function rowHasContent(r: string[]): boolean { return r && r.some(x => String(x || '').trim().length > 0) }
const HEADER_HINTS = ['nombre', 'name', 'producto', 'product', 'título', 'titulo', 'articulo', 'artículo', 'item', 'concepto', 'denominación', 'denominacion', 'descripcion corta', 'descripción corta', 'descripcion producto', 'descripción producto', 'descripcion corta producto', 'nombre del producto', 'nombre producto', 'nom. producto', 'product name', 'sku', 'código', 'codigo', 'code', 'clave', 'cod.', 'código de barras', 'codigo de barras', 'barcode', 'barras', 'referencia', 'ref.', 'ref', 'número parte', 'numero parte', 'part no', 'part number', 'tipo', 'kind', 'tipo producto', 'clase', 'clasif.', 'clasificacion', 'clasificación', 'type', 'familia', 'family', 'línea', 'linea', 'linea producto', 'rubro', 'departamento', 'depto.', 'grupo', 'sector', 'categoría', 'categoria', 'category', 'subfamilia', 'sub-familia', 'subcategoría', 'subcategoria', 'marca', 'brand', 'costo', 'cost', 'precio costo', 'cost price', 'precio de costo', 'precio compra', 'precio de compra', 'costo unitario', 'costo u.', 'coste', 'cu', 'precio', 'price', 'venta', 'precio venta', 'sale price', 'precio de venta', 'pvp', 'p.u.', 'pu', 'precio unitario', 'precio público', 'precio lista', 'importe', 'valor venta', 'valor', 'total unitario', 'subtotal unitario', 'precio sugerido', 'precio final', 'ubicación', 'ubicacion', 'location', 'lugar', 'almacén', 'almacen', 'almacenaje', 'pasillo', 'estante', 'rack', 'posición', 'posicion', 'sucursal', 'bodega', 'area', 'área', 'descripción', 'descripcion', 'description', 'detalle', 'notes', 'notas', 'observaciones', 'comentarios', 'detalle producto', 'características', 'caracteristicas', 'especificaciones', 'descripción larga', 'descripcion larga', 'activo', 'active', 'status', 'estado', 'habilitado', 'vigente', 'alta', 'publicado', 'stock', 'existencia', 'existencias', 'cantidad', 'quantity', 'qty', 'inventario', 'existencia actual', 'stock actual', 'unidades', 'piezas', 'pz.', 'pza', 'saldo', 'disponible', 'cantidad disponible', 'existencia disponible', 'unidad']
export function guessHeaderRowIndex(rows: string[][], maxScan = 30): number {
  let bestIdx = 0; let bestScore = -1
  const limit = Math.min(maxScan, rows.length)
  for (let i = 0; i < limit; i++) {
    const r = rows[i]
    if (!rowHasContent(r)) continue
    const joined = r.map(x => String(x || '').toLowerCase().trim()).filter(Boolean).join(' | ')
    let score = 0
    for (const h of HEADER_HINTS) if (joined.includes(' | ' + h + ' | ') || joined.startsWith(h + ' | ') || joined.endsWith(' | ' + h) || r.some(c => String(c || '').toLowerCase().trim() === h)) score += 2
    if (r.some(c => /^\s*(existencia|stock|precio|costo|sku|código|codigo|producto|nombre|categoria|categoría)\s*$/i.test(String(c || '')))) score += 3
    if (score > bestScore) { bestScore = score; bestIdx = i }
  }
  // Fallback: si nadie obtuvo score>2, buscamos la 1ra fila donde, en las siguientes 4 filas, hay al menos una fila de datos (numérica + texto largo).
  if (bestScore <= 1) {
    for (let i = 0; i < limit - 1; i++) {
      if (!rowHasContent(rows[i])) continue
      const nextFew = rows.slice(i + 1, i + 5)
      const dataRows = nextFew.filter(r => {
        if (!rowHasContent(r)) return false
        let hasNum = false, hasText = false
        for (const c of r) {
          const s = String(c || '').trim()
          if (!s) continue
          if (/^[A-Za-zÑñÁáÉéÍíÓóÚúÜü]/.test(s) && s.length > 3) hasText = true
          const n = parseFloat(s.replace(/[^0-9.,\-]/g, '').replace(/,/g, ''))
          if (isFinite(n) && n > 0) hasNum = true
        }
        return hasText
      })
      if (dataRows.length >= 1) return i
    }
  }
  return bestIdx
}
export function trimLeadingGarbageRows(rows: string[][]): string[][] {
  const headerIdx = guessHeaderRowIndex(rows)
  return rows.slice(headerIdx)
}
function parseCsvLine(line: string, delim: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQ = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (inQ) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++ } else { inQ = false }
      } else { cur += c }
    } else {
      if (c === delim) { out.push(cur); cur = '' }
      else if (c === '"') inQ = true
      else cur += c
    }
  }
  out.push(cur)
  return out
}
function pickStr(row: string[], idx: number): string {
  if (idx < 0 || idx >= row.length) return ''
  return String(row[idx] || '').trim()
}
function pickNum(row: string[], idx: number): number | undefined {
  if (idx < 0 || idx >= row.length) return undefined
  const raw = String(row[idx] || '').replace(/[^0-9.,\-]/g, '')
  if (!raw) return undefined
  const n = parseFloat(raw.replace(/,/g, ''))
  return isFinite(n) ? n : undefined
}
function pickBool(row: string[], idx: number): boolean {
  if (idx < 0 || idx >= row.length) return true
  const v = String(row[idx] || '').toLowerCase().trim()
  if (!v) return true
  if (['0', 'no', 'false', 'inactivo', 'inactive', 'desactivado'].includes(v)) return false
  return true
}
function normalizeImportRow(r: any): ParsedImportItem {
  const kindRaw = r.kind || r.type || ''
  const kind: ItemKind = kindRaw === 'service' || kindRaw === 'course' || kindRaw === 'menu_item' || kindRaw === 'product' ? kindRaw : guessKindFromString(String(kindRaw || '')) || 'product'
  const name = String(r.name || r.nombre || r.producto || '').trim()
  if (!name) return { name: '', salePrice: 0 } as any
  const salePrice = Number(r.salePrice ?? r.precio ?? r.price ?? r.precioVenta ?? 0)
  return {
    kind,
    sku: r.sku || r.codigo || r.codigo || undefined,
    name,
    family: r.family || r.familia || undefined,
    category: r.category || r.categoria || r.categoría || undefined,
    costPrice: r.costPrice != null ? Number(r.costPrice) : (r.costo != null ? Number(r.costo) : undefined),
    salePrice,
    location: r.location || r.ubicacion || undefined,
    description: r.description || r.descripcion || undefined,
    active: typeof r.active === 'boolean' ? r.active : true,
    stockGlobal: r.stock != null ? Number(r.stock) : r.existencia != null ? Number(r.existencia) : undefined,
  }
}

// ============ BIDIRECTIONAL CATALOG <-> MD SYNC ============
export async function syncCatalogWriteToMd(
  tenantId: string,
  op: 'create' | 'edit' | 'delete' | 'stock',
  item: PosCatalogItem,
  targetDoc?: string,
  _userEmail?: string,
): Promise<{ wrote: boolean; doc?: string }> {
  const store = await readPosStore(tenantId)
  const candidates = targetDoc
    ? [targetDoc]
    : item.sourceDocId
    ? [item.sourceDocId]
    : ['productos.md']
  for (const fn of candidates) {
    try {
      if (op === 'delete') {
        await removeItemFromMd(tenantId, fn, item)
        return { wrote: true, doc: fn }
      }
      await upsertItemIntoMd(tenantId, fn, item, store.branches)
      return { wrote: true, doc: fn }
    } catch (e) {
      // try next candidate
    }
  }
  return { wrote: false }
}
