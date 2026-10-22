import type {
  AuthPayload,
  AuthUser,
  ChatMessage,
  ChatResponse,
  DocumentIngestionStatus,
  DocumentMutationPayload,
  WorkspacePayload,
} from '@/types/app'

const TOKEN_KEY = 'smartbis.auth.token'

export function getApiBaseUrl() {
  if (typeof window === 'undefined') {
    return ''
  }

  const value = (window as Window & { __API_BASE__?: string }).__API_BASE__
  if (value) {
    return value.replace(/\/$/, '')
  }

  const isDesktopBuild =
    (window as Window & { smartbisDesktop?: unknown }).smartbisDesktop !== undefined ||
    /Smartbis POS/i.test(window.navigator.userAgent || '') ||
    (window.location && /^(file|chrome-extension|app):/.test(window.location.protocol))

  if (isDesktopBuild) {
    return 'https://api.smartbis.ai'
  }

  return ''
}

export function resolveApiUrl(path: string) {
  const base = getApiBaseUrl()
  if (!base) {
    return path
  }

  return `${base}${path}`
}

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  body?: unknown
  skipAuth?: boolean
}

function logClient(message: string) {
  if (typeof window === 'undefined') {
    return
  }

  const anyWindow = window as Window & {
    smartbisDesktop?: {
      log?: (message: string) => void
    }
  }

  try {
    anyWindow.smartbisDesktop?.log?.(`[client-session] ${message}`)
  } catch {
    console.warn('[client-session] log channel unavailable', message)
  }
}

function getStoredToken() {
  return window.localStorage.getItem(TOKEN_KEY) || ''
}

export function saveStoredToken(token: string) {
  window.localStorage.setItem(TOKEN_KEY, token)
}

export function clearStoredToken() {
  window.localStorage.removeItem(TOKEN_KEY)
}

async function requestJson<T>(path: string, options: RequestOptions = {}) {
  const headers: Record<string, string> = {}

  if (!options.skipAuth) {
    const token = getStoredToken()

    if (token) {
      headers.Authorization = `Bearer ${token}`
    }
  }

  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json'
  }

  const targetUrl = resolveApiUrl(path)
  logClient(`request start ${options.method || 'GET'} ${targetUrl}`)

  try {
    const response = await fetch(targetUrl, {
      method: options.method || 'GET',
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    })

    const text = await response.text()
    const payload = text ? (JSON.parse(text) as T & { error?: string }) : null
    const errorMessage = payload?.error || 'No se pudo completar la solicitud'

    if (!response.ok) {
      logClient(`request non-ok ${response.status} ${path} body=${text}`)

      if (
        response.status === 401 ||
        /jwt|token|sesion|session|expired|unauthorized|auth/i.test(errorMessage)
      ) {
        clearStoredToken()
        throw new Error('Tu sesion vencio. Inicia sesion nuevamente.')
      }

      if (response.status === 404 && path === '/api/chat') {
        throw new Error('El endpoint /api/chat no esta disponible en este momento.')
      }

      throw new Error(errorMessage)
    }

    logClient(`request ok ${options.method || 'GET'} ${path}`)
    return payload as T
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logClient(`request failed ${options.method || 'GET'} ${path} error=${message}`)
    throw error
  }
}

export async function registerAccount(input: { email: string; password: string }) {
  const payload = await requestJson<AuthPayload>('/api/auth/register', {
    method: 'POST',
    body: input,
    skipAuth: true,
  })

  saveStoredToken(payload.token)
  return payload
}

export async function loginAccount(input: { email: string; password: string }) {
  const payload = await requestJson<AuthPayload>('/api/auth/login', {
    method: 'POST',
    body: input,
    skipAuth: true,
  })

  saveStoredToken(payload.token)
  return payload
}

export async function getCurrentUser() {
  return requestJson<{ user: AuthUser }>('/api/auth/me')
}

export async function logoutAccount() {
  try {
    await requestJson<{ success: boolean }>('/api/auth/logout', {
      method: 'POST',
    })
  } finally {
    clearStoredToken()
  }
}

export async function getWorkspace() {
  return requestJson<WorkspacePayload>('/api/workspace')
}

export async function savePrompt(prompt: string) {
  return requestJson<{ prompt: string }>('/api/prompt', {
    method: 'PUT',
    body: {
      prompt,
    },
  })
}

export async function createDocument(input: { fileName: string; content: string }) {
  return requestJson<DocumentMutationPayload>('/api/documents', {
    method: 'POST',
    body: input,
  })
}

export async function updateDocument(
  currentFileName: string,
  input: { fileName: string; content: string },
) {
  return requestJson<DocumentMutationPayload>(
    `/api/documents/${encodeURIComponent(currentFileName)}`,
    {
      method: 'PUT',
      body: input,
    },
  )
}

export async function deleteDocument(currentFileName: string) {
  return requestJson<{ ingestion?: DocumentIngestionStatus }>(
    `/api/documents/${encodeURIComponent(currentFileName)}`,
    {
      method: 'DELETE',
    },
  )
}

export async function sendChatMessage(input: {
  prompt: string
  message: string
  history: Array<Pick<ChatMessage, 'role' | 'content'>>
}) {
  return requestJson<ChatResponse>('/api/chat', {
    method: 'POST',
    body: input,
  })
}

// ============================================
// Meta Messenger (CRM Chats, Bot Estado, Envios Manuales, Login OAuth, Configuración)
// ============================================
export type MetaBotState = 'START' | 'PAUSE'

export interface MetaStatusResponse {
  appId?: string
  graphVersion?: string
  pageId?: string
  pageName?: string
  pageProfilePic?: string
  state: MetaBotState
  testMode: boolean
  autocuratorEnabled: boolean
  webhookSubscribed: boolean
  linkedAt?: string
  updatedAt?: string
  linked: boolean
  hasPageToken: boolean
}

export interface MetaChatItem {
  psid: string
  firstName?: string
  lastName?: string
  profilePic?: string
  lastMessage?: string
  lastActivityAt?: string
  unreadCount: number
  direction?: string
}

export interface MetaMessageRow {
  id: string
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
  autoEvalCategory?: AutoEvalCategory
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

export interface MetaChatDetailResponse {
  psid: string
  messages: MetaMessageRow[]
}

export interface MetaPageOption {
  id: string
  name: string
  access_token?: string
  category?: string
  picture?: { data?: { url?: string } }
}

export async function getMetaStatus() {
  return requestJson<MetaStatusResponse>('/api/meta/status')
}

export async function setMetaState(next: { state?: MetaBotState; testMode?: boolean; autocuratorEnabled?: boolean }) {
  return requestJson<{ success: boolean; state: MetaBotState; testMode: boolean; autocuratorEnabled: boolean }>('/api/meta/setState', {
    method: 'POST',
    body: next,
  })
}

export async function getMetaOAuthLoginUrl() {
  return requestJson<{ url: string }>('/api/meta/oauth/url')
}

export async function retryMetaPageList() {
  return requestJson<{ pages: MetaPageOption[] }>('/api/meta/pages/retry', {
    method: 'POST',
    body: {},
  })
}

export async function syncMetaAds() {
  return requestJson<{ success: boolean; ads: number; accountsChecked: number; syncedAt: string; error?: string }>(
    '/api/meta/ads/sync',
    { method: 'POST', body: {} },
  )
}

export async function linkMetaPage(page: MetaPageOption) {
  return requestJson<{ success: boolean; subscribed: boolean; config: any }>('/api/meta/linkPage', {
    method: 'POST',
    body: {
      pageId: page.id,
      pageName: page.name,
      pageAccessToken: page.access_token,
      pageProfilePic: page.picture?.data?.url || '',
    },
  })
}

export async function configureMetaManual(input: { pageId: string; pageName?: string; pageAccessToken: string }) {
  return requestJson<{ success: boolean; subscribed: boolean; pageId: string; pageName: string }>(
    '/api/meta/configureManual',
    { method: 'POST', body: input },
  )
}

export async function listMetaChats(limit = 100) {
  return requestJson<{ chats: MetaChatItem[] }>(`/api/meta/chats?limit=${limit}`)
}

export async function getMetaChatDetail(psid: string) {
  return requestJson<MetaChatDetailResponse>(`/api/meta/chats/${encodeURIComponent(psid)}`)
}

export async function sendMetaManual(psid: string, text: string) {
  return requestJson<{ success: boolean; mid?: string; error?: string }>(
    `/api/meta/send/${encodeURIComponent(psid)}`,
    { method: 'POST', body: { text } },
  )
}

export async function markMetaChatAsRead(psid: string) {
  return requestJson<{ success: boolean }>(
    `/api/meta/chats/${encodeURIComponent(psid)}/read`,
    { method: 'POST' },
  )
}

export async function deleteMetaChat(psid: string) {
  return requestJson<null>(
    `/api/meta/chats/${encodeURIComponent(psid)}`,
    { method: 'DELETE' },
  )
}

export interface WhatsAppNotificationStatus {
  state: 'DISCONNECTED' | 'QR' | 'AUTHENTICATED' | 'CONNECTED' | 'AUTH_FAILURE' | 'ERROR' | string
  qr: string
  linkedNumber: string
  recipient: string
}

export async function getWhatsAppNotificationStatus() {
  return requestJson<WhatsAppNotificationStatus>('/api/whatsapp/status')
}

export async function setWhatsAppNotificationRecipient(recipient: string) {
  return requestJson<{ success: boolean; recipient: string }>('/api/whatsapp/recipient', {
    method: 'PUT', body: { recipient },
  })
}

export async function sendWhatsAppNotificationTest() {
  return requestJson<{ sent: boolean; recipient: string }>('/api/whatsapp/test', {
    method: 'POST', body: {},
  })
}

export async function confirmChatRegistration(psid: string, input: { customer: string; course: string; modality?: string }) {
  return requestJson<{ success: boolean; sent: boolean; duplicate: boolean }>(
    `/api/meta/chats/${encodeURIComponent(psid)}/confirm-registration`,
    { method: 'POST', body: input },
  )
}

// ============================================
// AUTO-EVALS · Auto-curado (auditoría Juez LLM)
// ============================================

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

export interface AutoEvalListResponse {
  items: AutoEval[]
  total: number
  stats: AutoEvalStats
}

export async function metaAutoEvalList(params?: {
  category?: AutoEvalCategory | 'all'
  psid?: string
  search?: string
  limit?: number
  offset?: number
}): Promise<AutoEvalListResponse> {
  const qs = new URLSearchParams()
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== '') qs.set(k, String(v))
    }
  }
  const q = qs.toString()
  return requestJson<AutoEvalListResponse>(`/api/meta/auto-evals${q ? `?${q}` : ''}`)
}

export async function metaAutoEvalGet(id: string): Promise<AutoEval> {
  return requestJson<AutoEval>(`/api/meta/auto-evals/${encodeURIComponent(id)}`)
}

// ============================================
// POS / Operaciones (Punto de Venta · Inventario · Sucursales · Compras · Turnos · Cuentas · Registros)
// ============================================

// 'admin' se conserva por compatibilidad con cuentas creadas antes de separar los roles.
export type PosRole = 'admin' | 'admin_pv' | 'admin_cs' | 'cashier' | 'cs_agent'
export type ItemKind = 'product' | 'service' | 'course' | 'menu_item'
export type PaymentMethod = 'cash' | 'card' | 'transfer' | 'whatsapp' | 'pending'
export type SaleStatus = 'paid' | 'pending' | 'cancelled' | 'quote'
export interface PosAdministrationConfig { workingDaysByMonth: Record<string, number[]>; expenses: Array<{ id: string; name: string; amount: number }> }

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
  stocks: Record<string, number>
  location?: string
  tags: string[]
  active: boolean
  attrs?: any
  sourceDocId?: string
  sourceBlockHash?: string
  lastPurchaseCost?: number
  inventoryLots?: PosInventoryLot[]
  createdAt: string
  updatedAt: string
}

export interface PosInventoryLot {
  id: string
  branchId: string
  purchaseId?: string
  purchaseDate: string
  qtyReceived: number
  qtyRemaining: number
  unitCost: number
  source: 'purchase' | 'opening' | 'adjustment'
}

export interface PosSaleCostAllocation {
  lotId?: string
  qty: number
  unitCost: number
}

export interface PosPurchaseLine {
  itemId: string
  isNewItem?: boolean
  newItemKind?: ItemKind
  newItemSku?: string
  newItemName?: string
  productName?: string
  qty: number
  unitCost: number
  salePrice?: number
  shippingCost?: number
  totalCost?: number
  inventoryLotId?: string
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

export interface PromoGroup {
  id: string
  name: string
  productIds: string[]
  volumePriceTiers: VolumePriceTier[]
  active: boolean
  createdAt: string
  updatedAt: string
}

export interface PosSubuser {
  id: string
  email: string
  name: string
  role: PosRole
  branchId: string
  active: boolean
  createdAt: string
  updatedAt: string
}

export type ShiftCashMovementKind = 'withdrawal' | 'payment'

export interface PosShift {
  id: string
  branchId: string
  userId: string
  userEmail: string
  openedAt: string
  closedAt?: string
  initialCash: number
  cashWithdrawals: Array<{ id: string; amount: number; reason?: string; businessExpense: boolean; at: string; by: string; kind?: ShiftCashMovementKind; category?: string }>
  paymentsByMethod: Array<{ method: PaymentMethod; total: number }>
  closingCash?: number
  closingTotal?: number
  status: 'open' | 'closed'
  salesCount?: number
  salesTotal?: number
  salesLines?: Array<{ itemId: string; sku?: string; name: string; qty: number; unitPrice: number; importe: number }>
}

export interface PosSaleLine {
  itemId: string
  sku?: string
  name: string
  qty: number
  unitPrice: number
  importe: number
  unitCost?: number
  costTotal?: number
  costAllocations?: PosSaleCostAllocation[]
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
  at: string
  userId?: string
  userEmail: string
  role?: PosRole
  branchId?: string
  kind: string
  message: string
  details?: any
}

export async function posBranches() {
  return requestJson<{ branches: PosBranch[] }>('/api/pos/branches')
}

export async function posBranchSave(input: Partial<PosBranch> & { name: string }) {
  return requestJson<{ branch: PosBranch }>('/api/pos/branches', {
    method: 'POST',
    body: input,
  })
}

export async function posBranchDelete(id: string) {
  return requestJson<{ ok: boolean }>(`/api/pos/branches/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export interface PosCatalogOpts {
  kinds?: ItemKind[]
  search?: string
  activeOnly?: boolean
}

export async function posCatalog(opts: PosCatalogOpts = {}) {
  const qs = new URLSearchParams()
  if (opts.kinds?.length) qs.set('kinds', opts.kinds.join(','))
  if (opts.search) qs.set('search', opts.search)
  if (opts.activeOnly === false) qs.set('activeOnly', '0')
  return requestJson<{ items: PosCatalogItem[]; promoGroups: PromoGroup[] }>(`/api/pos/catalog?${qs.toString()}`)
}

export async function posCatalogSave(input: Partial<PosCatalogItem> & {
  name: string
  salePrice: number
  syncToMdDoc?: string | null
  sourceDocId?: string
}) {
  return requestJson<{ item: PosCatalogItem }>('/api/pos/catalog', {
    method: 'POST',
    body: input,
  })
}

export async function posCatalogDelete(id: string) {
  return requestJson<{ ok: boolean }>(`/api/pos/catalog/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export async function posPromoGroups() {
  return requestJson<{ groups: PromoGroup[] }>('/api/pos/promo-groups')
}
export async function posPromoGroupSave(input: Partial<PromoGroup> & { name: string }) {
  return requestJson<{ group: PromoGroup }>('/api/pos/promo-groups', {
    method: 'POST',
    body: input,
  })
}
export async function posPromoGroupDelete(id: string) {
  return requestJson<{ ok: boolean }>(`/api/pos/promo-groups/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export async function posCatalogAdjustStock(id: string, branchId: string, delta: number, reason?: string) {
  return requestJson<{ stock: number }>(`/api/pos/catalog/${encodeURIComponent(id)}/stock`, {
    method: 'POST',
    body: { branchId, delta, reason },
  })
}

export async function posCatalogSyncFromDocs(onlyDoc?: string) {
  const qs = onlyDoc ? `?doc=${encodeURIComponent(onlyDoc)}` : ''
  return requestJson<{ created: string[]; updated: string[]; skipped: string[]; report: string; onlyDoc?: string }>(
    '/api/pos/catalog/sync-from-documents' + qs,
    { method: 'POST' },
  )
}

export interface PosMdFileInfo {
  fileName: string
  sizeBytes: number
  updatedAt: string
  wordCount: number
}
export async function posDocsList() {
  return requestJson<{ files: PosMdFileInfo[] }>('/api/pos/docs')
}
export async function posDocsRead(fileName: string) {
  return requestJson<{ fileName: string; content: string; updatedAt: string } | null>(
    `/api/pos/docs/${encodeURIComponent(fileName)}`,
  )
}
export async function posDocsWrite(fileName: string, content: string) {
  return requestJson<{ fileName: string; ok: boolean }>('/api/pos/docs', {
    method: 'POST',
    body: { fileName, content },
  })
}
export async function posCatalogImport(params: {
  fileName: string
  fileBase64: string
  targetDoc: string
  writeBack?: boolean
}) {
  return requestJson<{
    count: number
    rawCount?: number
    created: string[]
    updated: string[]
    skipped: string[]
    targetDoc: string
    warning?: string
    fileName?: string
  }>('/api/pos/catalog/import', {
    method: 'POST',
    body: params,
  })
}

export async function posPurchases() {
  return requestJson<{ purchases: PosPurchaseOrder[] }>('/api/pos/purchases')
}

export async function posAdministrationConfig() {
  return requestJson<{ config: PosAdministrationConfig | null }>('/api/pos/administration/config')
}

export async function posAdministrationConfigSave(config: PosAdministrationConfig) {
  return requestJson<{ config: PosAdministrationConfig }>('/api/pos/administration/config', { method: 'PUT', body: config })
}

export async function posPurchaseCreate(input: {
  branchId: string
  date?: string
  providerName: string
  folio?: string
  total: number
  currency?: string
  lines: PosPurchaseLine[]
  notes?: string
}) {
  return requestJson<{ purchase: PosPurchaseOrder }>('/api/pos/purchases', {
    method: 'POST',
    body: input,
  })
}

export async function posPurchaseDelete(id: string) {
  return requestJson<{ ok: true }>(`/api/pos/purchases/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
}

export async function posShiftMyOpen() {
  return requestJson<{ open: PosShift | undefined }>('/api/pos/shifts/me')
}

export async function posShiftOpen(input: { branchId: string; initialCash: number }) {
  return requestJson<{ shift: PosShift }>('/api/pos/shifts/open', {
    method: 'POST',
    body: input,
  })
}

export async function posShiftWithdraw(shiftId: string, input: { amount: number; reason?: string; businessExpense: boolean }) {
  return requestJson<{ withdrawal: any }>(`/api/pos/shifts/${encodeURIComponent(shiftId)}/withdraw`, {
    method: 'POST',
    body: input,
  })
}

export async function posShiftPay(shiftId: string, input: { amount: number; reason?: string; category?: string }) {
  return requestJson<{ payment: any }>(`/api/pos/shifts/${encodeURIComponent(shiftId)}/withdraw`, {
    method: 'POST',
    body: {
      amount: input.amount,
      reason: input.reason,
      businessExpense: true,
      kind: 'payment',
      category: input.category,
    },
  })
}

export async function posShiftSummary(shiftId: string) {
  return requestJson<{ shift: PosShift; sales: PosSale[] }>(`/api/pos/shifts/${encodeURIComponent(shiftId)}/summary`)
}

export async function posShiftClose(shiftId: string) {
  return requestJson<{ shift: PosShift }>(`/api/pos/shifts/${encodeURIComponent(shiftId)}/close`, {
    method: 'POST',
  })
}

export interface SystemStatusCheck {
  ok: boolean
  warn?: boolean
  label: string
  status?: string
  detail?: string
  latencyMs?: number
  raw?: any
}
export interface SystemStatusOverview {
  ok: boolean
  generatedAt: string
  summary: { total: number; ok: number; warn: number; error: number }
  checks: SystemStatusCheck[]
}
export interface SystemDashboardTone {
  tone?: 'ok' | 'warn' | 'error' | 'info'
}
export interface SystemStatusDashboard {
  generatedAt: string
  stats: {
    meta: {
      pageName: string | null
      pageId: string | null
      linked: boolean
      state: string
      testMode: boolean
      botState: boolean
    }
    messages: {
      total: number
      today: number
      receivedTotal: number
      sentTotal: number
      todayReceived: number
      todaySent: number
      blockedByAutocurador: number
    }
    chats: { total: number; unread: number; active24h: number }
    pos: {
      branches: number
      openShiftId: string | null
      openShiftSalesCount: number
      openShiftSalesTotal: number
      salesTotal: number
      salesToday: number
      salesMonth: number
      salesCount: number
      salesCountToday: number
      salesCountMonth: number
      shiftsWithSales: number
    }
    workspace: {
      promptChars: number
      documentsCount: number
      hasPrompt: boolean
    }
    audit: {
      last2000: number
      logins24h: number
      salesCreated: number
      shiftsOpened: number
      shiftsClosed: number
      withdrawals: number
    }
    autocurador: {
      total: number
      correct: number
      error: number
      noinfo: number
      judgeFailed: number
      ratioCorrect: number
    }
  }
  quick: Array<{ key: string; label: string; value: number; prefix?: string; tone?: 'ok' | 'warn' | 'error' | 'info' }>
}
export async function systemStatusOverview() {
  return requestJson<SystemStatusOverview>('/api/status/overview')
}
export async function systemStatusDashboard() {
  return requestJson<SystemStatusDashboard>('/api/status/dashboard')
}

export async function posSales(opts?: { branchId?: string; limit?: number; from?: string; to?: string; status?: string }) {
  const qs = new URLSearchParams()
  if (opts?.branchId) qs.set('branchId', opts.branchId)
  if (opts?.limit) qs.set('limit', String(opts.limit))
  if (opts?.from) qs.set('from', opts.from)
  if (opts?.to) qs.set('to', opts.to)
  if (opts?.status) qs.set('status', opts.status)
  const q = qs.toString()
  return requestJson<{ sales: PosSale[] }>(`/api/pos/sales${q ? `?${q}` : ''}`)
}

export async function posSaleGet(id: string) {
  return requestJson<{ sale: PosSale }>(`/api/pos/sales/${encodeURIComponent(id)}`)
}

export async function posFrequentProducts(branchId: string) {
  return requestJson<{ items: Array<{ itemId: string; name: string; sku: string; qty: number; salePrice: number; stock: number }> }>(
    `/api/pos/sales/frequent/${encodeURIComponent(branchId)}`,
  )
}

export async function posSaleCreate(input: {
  branchId: string
  shiftId?: string
  customerName?: string
  requiresFactura: boolean
  status?: SaleStatus
  lines: PosSaleLine[]
  payments: PosSale['payments']
  discount: number
}) {
  return requestJson<{ sale: PosSale }>('/api/pos/sales', {
    method: 'POST',
    body: input,
  })
}

export async function posSaleCancel(id: string) {
  return requestJson<{ ok: boolean }>(`/api/pos/sales/${encodeURIComponent(id)}/cancel`, {
    method: 'POST',
  })
}

export async function posSubusers() {
  return requestJson<{ users: PosSubuser[] }>('/api/pos/subusers')
}

export async function posSubuserCreate(input: {
  name: string
  email: string
  password: string
  role: PosRole
  branchId: string
}) {
  return requestJson<{ user: PosSubuser }>('/api/pos/subusers', {
    method: 'POST',
    body: input,
  })
}

export async function posSubuserUpdate(
  id: string,
  input: {
    name?: string
    role?: PosRole
    branchId?: string
    active?: boolean
    newPassword?: string
  },
) {
  return requestJson<{ user: PosSubuser }>(`/api/pos/subusers/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: input,
  })
}

export async function posSubuserDelete(id: string) {
  return requestJson<{ ok: boolean }>(`/api/pos/subusers/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export interface PosAuditOpts {
  limit?: number
  search?: string
  from?: string
  to?: string
}

export async function posAudit(opts: PosAuditOpts = {}) {
  const qs = new URLSearchParams()
  if (opts.limit) qs.set('limit', String(opts.limit))
  if (opts.search) qs.set('search', opts.search)
  if (opts.from) qs.set('from', opts.from)
  if (opts.to) qs.set('to', opts.to)
  return requestJson<{ logs: PosAuditLog[] }>(`/api/pos/audit?${qs.toString()}`)
}
