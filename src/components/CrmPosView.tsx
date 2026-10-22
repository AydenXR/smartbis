import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ShoppingCart,
  UserPlus,
  Search,
  Plus,
  Minus,
  Trash2,
  X,
  Wallet,
  CreditCard,
  Banknote,
  Send,
  Percent,
  Tag as TagIcon,
  Tag,
  Package,
  TrendingUp,
  AlertCircle,
  Check,
  LogOut,
  Building2,
  Clock,
  FileText,
  Receipt,
  Sparkles,
  DollarSign,
  RefreshCw,
  Printer,
  ReceiptText,
  Database,
  Pencil,
  PackageCheck,
} from 'lucide-react'
import { cn, tieredUnitPrice, type TieredPriceResult, applyGroupPromotionsToCart } from '@/lib/utils'
import {
  type ItemKind,
  type PaymentMethod,
  type PosBranch,
  type PosCatalogItem,
  type PosSaleLine,
  type PosShift,
  type PosSale,
  type PromoGroup,
  posBranches,
  posCatalog,
  posCatalogSave,
  posCatalogDelete,
  posCatalogSyncFromDocs,
  posFrequentProducts,
  posShiftMyOpen,
  posShiftOpen,
  posShiftWithdraw,
  posShiftPay,
  posShiftClose,
  posSaleCreate,
  posSales,
  posPromoGroupSave,
  posPromoGroupDelete,
} from '@/lib/api'

type CartLine = {
  id: string
  itemId: string
  sku?: string
  name: string
  qty: number
  unitPrice: number
  importe: number
  stockInBranch: number
  baseUnitPrice: number
  appliedTierMinQty: number | null
  appliedTierSaving: number
  appliedGroupId: string | null
  appliedGroupName?: string
  appliedGroupMinQty: number | null
  appliedGroupUnitPrice: number | null
  groupSaving: number
  cashierPriceEditable?: boolean
  priceManuallyEdited?: boolean
}

type FrequentItem = {
  itemId: string
  name: string
  sku: string
  qty: number
  salePrice: number
  stock: number
}

type CheckoutModalState = {
  open: boolean
  subtotal: number
  iva: number
  discount: number
  total: number
}

type WithdrawModalState = { open: boolean } | null

type PromoModalMode = 'percent' | 'amount'
type PromoVolumeRow = { id: string; qty: string; price: string }
type PromoView = 'list' | 'ticket' | 'form' | 'groups' | 'group_form'

type GroupFormState = {
  id?: string
  name: string
  productIds: string[]
  volumePriceTiers: Array<{ minQty: string; price: string }>
  active: boolean
  productSearch: string
}

type PromoModalState = { open: boolean } | null

type OpenShiftModalState = { open: boolean } | null

type CloseShiftModalState = { open: boolean } | null

function parseVolumeExpr(expr: string): { minQty: number; price: number } | null {
  if (!expr) return null
  const s = expr
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\$/g, '')
    .replace(/\s*(?:x|X|×|por|\*)\s*/, ' | ')
  if (!s.includes(' | ')) return null
  const [left, right] = s.split(' | ', 2)
  const qty = Number(left.replace(/,/g, '').trim())
  const price = Number(right.replace(/,/g, '').trim())
  if (!isFinite(qty) || !isFinite(price)) return null
  return { minQty: qty, price }
}
function normalizeVolumeExpr(expr: string): string {
  const p = parseVolumeExpr(expr)
  if (!p) return expr
  const qty = Math.max(1, Math.round(p.minQty))
  const price = Number(p.price.toFixed(2))
  if (Math.abs(price - Math.round(price)) < 0.005) return `${qty} x ${Math.round(price)}`
  return `${qty} x ${price}`
}

export default function CrmPosView({ userRole }: { userRole?: string }) {
  const [branches, setBranches] = useState<PosBranch[]>([])
  const [shift, setShift] = useState<PosShift | undefined>(undefined)
  const [branchForShift, setBranchForShift] = useState<string>('')
  const [initialCash, setInitialCash] = useState<number>(2500)
  const [loadingShift, setLoadingShift] = useState(true)
  const [openShiftModal, setOpenShiftModal] = useState<OpenShiftModalState>({ open: false })
  const [closeShiftModal, setCloseShiftModal] = useState<CloseShiftModalState>(null)
  const [processingCloseShift, setProcessingCloseShift] = useState(false)
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')

  const [customerName, setCustomerName] = useState('')
  const [requiresFactura, setRequiresFactura] = useState(false)

  const [itemQty, setItemQty] = useState(1)
  const [itemQtyRaw, setItemQtyRaw] = useState<string>('')
  const [itemSearch, setItemSearch] = useState('')
  const [catalog, setCatalog] = useState<PosCatalogItem[]>([])
  const [promoGroups, setPromoGroups] = useState<PromoGroup[]>([])
  const [catalogLoading, setCatalogLoading] = useState(false)
  const [showSuggestions, setShowSuggestions] = useState(false)
  const searchContainerRef = useRef<HTMLDivElement>(null)

  const [cart, setCart] = useState<CartLine[]>([])
  const [priceEditDrafts, setPriceEditDrafts] = useState<Record<string, string>>({})

  const [discount, setDiscount] = useState<number>(0)
  const [paidAmount, setPaidAmount] = useState<number>(0)

  const [frequent, setFrequent] = useState<FrequentItem[]>([])
  const [frequentLoading, setFrequentLoading] = useState(false)

  const [checkout, setCheckout] = useState<CheckoutModalState | null>(null)
  const [payMethod, setPayMethod] = useState<PaymentMethod>('cash')
  const [paymentAmount, setPaymentAmount] = useState(0)
  const [mixedMode, setMixedMode] = useState(false)
  const [mixAmounts, setMixAmounts] = useState<{ cash: string; card: string; transfer: string }>({ cash: '', card: '', transfer: '' })
  const [processingPayment, setProcessingPayment] = useState(false)

  const [withdrawModal, setWithdrawModal] = useState<WithdrawModalState>(null)
  const [withdrawAmount, setWithdrawAmount] = useState<number>(0)
  const [withdrawReason, setWithdrawReason] = useState('')
  const [withdrawBusinessExpense, setWithdrawBusinessExpense] = useState(false)
  const [processingWithdraw, setProcessingWithdraw] = useState(false)

  type PayModalState = { open: boolean } | null
  const [payModal, setPayModal] = useState<PayModalState>(null)
  const [payModalAmount, setPayModalAmount] = useState<number>(0)
  const [payModalCategory, setPayModalCategory] = useState<string>('servicios')
  const [payModalReason, setPayModalReason] = useState('')
  const [processingPayModal, setProcessingPayModal] = useState(false)

  const [closeShiftSales, setCloseShiftSales] = useState<PosSale[]>([])
  const [loadingCloseShiftSummary, setLoadingCloseShiftSummary] = useState(false)

  const [promoModal, setPromoModal] = useState<PromoModalState>(null)
  const [promoView, setPromoView] = useState<PromoView>('list')
  const [promoMode, setPromoMode] = useState<PromoModalMode>('percent')
  const [promoValue, setPromoValue] = useState<string>('')
  const [promoSearch, setPromoSearch] = useState<string>('')
  const [promoFormProductId, setPromoFormProductId] = useState<string>('')
  const [promoFormProductSearch, setPromoFormProductSearch] = useState<string>('')
  const [volumeRows, setVolumeRows] = useState<PromoVolumeRow[]>([])
  const [volumeSaving, setVolumeSaving] = useState(false)
  const [syncFromDocsLoading, setSyncFromDocsLoading] = useState(false)
  const [volumeError, setVolumeError] = useState<string>('')
  const [confirmDeletePromo, setConfirmDeletePromo] = useState<PosCatalogItem | null>(null)

  // Estados para gestión de GRUPOS de promoción dentro del modal Promociones
  const [groupForm, setGroupForm] = useState<GroupFormState>({
    name: '',
    productIds: [],
    volumePriceTiers: [],
    active: true,
    productSearch: '',
  })
  const [savingGroup, setSavingGroup] = useState(false)
  const [confirmDeleteGroup, setConfirmDeleteGroup] = useState<PromoGroup | null>(null)
  const [groupSearch, setGroupSearch] = useState('')

  const shiftBranch = useMemo(
    () => (shift ? branches.find((b) => b.id === shift.branchId) : undefined),
    [shift, branches],
  )

  function showToast(msg: string) {
    setToast(msg)
    window.setTimeout(() => setToast(''), 3500)
  }

  async function loadBranches() {
    try {
      const res = await posBranches()
      setBranches(res.branches)
      if (res.branches.length && !branchForShift) {
        const main = res.branches.find((b) => b.isMain) || res.branches[0]
        setBranchForShift(main.id)
      }
    } catch {}
  }

  async function loadShift() {
    setLoadingShift(true)
    try {
      const res = await posShiftMyOpen()
      setShift(res.open)
      if (!res.open) {
        setOpenShiftModal({ open: true })
      } else {
        setOpenShiftModal(null)
      }
    } catch (e: any) {
      setError(e?.message || 'Error al cargar turno')
    } finally {
      setLoadingShift(false)
    }
  }

  async function loadCatalog(search = '', silent = false) {
    if (!silent) setCatalogLoading(true)
    try {
      const res = await posCatalog({
        activeOnly: true,
        search: search.trim() || undefined,
      })
      setCatalog(res.items)
      if (res.promoGroups) setPromoGroups(res.promoGroups)
      repriceCartForCatalog(res.items, res.promoGroups || promoGroups)
    } catch (e: any) {
      setCatalog([])
      setPromoGroups([])
      if (!silent) setError(e?.message || 'No se pudo cargar el catálogo')
    } finally {
      if (!silent) setCatalogLoading(false)
    }
  }

  function withGroupPromotions(
    prevLines: CartLine[],
    sourceCatalog: PosCatalogItem[] = catalog,
    sourcePromoGroups: PromoGroup[] = promoGroups,
  ): CartLine[] {
    try {
      const regularLines = prevLines.filter(line => !line.priceManuallyEdited)
      const { lines } = applyGroupPromotionsToCart(regularLines, sourceCatalog, sourcePromoGroups)
      const promotedById = new Map(lines.map(line => [line.id, line]))
      return prevLines.map((source) => {
        const l = source.priceManuallyEdited ? {
          ...source,
          appliedGroupId: null,
          appliedGroupName: undefined,
          appliedGroupMinQty: null,
          appliedGroupUnitPrice: null,
          groupSaving: 0,
        } : promotedById.get(source.id) || source
        return ({
        id: l.id,
        itemId: l.itemId,
        sku: l.sku,
        name: l.name,
        qty: l.qty,
        unitPrice: Number((l as any).lineUnitPrice ?? l.unitPrice),
        importe: Number((l as any).lineImporte ?? l.importe),
        stockInBranch: l.stockInBranch,
        baseUnitPrice: l.baseUnitPrice,
        appliedTierMinQty: l.appliedTierMinQty ?? null,
        appliedTierSaving: l.appliedTierSaving ?? 0,
        appliedGroupId: l.appliedGroupId ?? null,
        appliedGroupName: l.appliedGroupName,
        appliedGroupMinQty: l.appliedGroupMinQty ?? null,
        appliedGroupUnitPrice: l.appliedGroupUnitPrice ?? null,
        groupSaving: l.groupSaving ?? 0,
        cashierPriceEditable: l.cashierPriceEditable,
        priceManuallyEdited: l.priceManuallyEdited,
      })})
    } catch (e) {
      return prevLines
    }
  }

  function repriceCartForCatalog(items: PosCatalogItem[], groups: PromoGroup[]) {
    setCart((prev) => {
      const repriced = prev.map((line) => {
        const item = items.find((candidate) => candidate.id === line.itemId)
        if (!item) return line
        if (line.priceManuallyEdited) return line
        const tier = tieredUnitPrice(item, line.qty)
        return {
          ...line,
          baseUnitPrice: item.salePrice,
          unitPrice: tier.unitPrice,
          importe: tier.lineTotal,
          appliedTierMinQty: tier.appliedMinQty,
          appliedTierSaving: tier.saving,
        }
      })
      return withGroupPromotions(repriced, items, groups)
    })
  }

  async function loadFrequent() {
    if (!shift) return
    setFrequentLoading(true)
    try {
      const res = await posFrequentProducts(shift.branchId)
      setFrequent(res.items as unknown as FrequentItem[])
    } catch {
    } finally {
      setFrequentLoading(false)
    }
  }

  // ======= FUNCIONES GRUPOS DE PROMOCIÓN (dentro del modal Promociones POS) =======
  function openCreateGroup() {
    setGroupForm({
      name: '',
      productIds: [],
      volumePriceTiers: [],
      active: true,
      productSearch: '',
    })
    setPromoView('group_form')
  }
  function openEditGroup(g: PromoGroup) {
    setGroupForm({
      id: g.id,
      name: g.name,
      productIds: [...(g.productIds || [])],
      volumePriceTiers: (g.volumePriceTiers || []).map(t => ({ minQty: String(t.minQty), price: String(t.price) })),
      active: g.active,
      productSearch: '',
    })
    setPromoView('group_form')
  }
  function closeGroupForm() {
    setGroupForm({
      name: '',
      productIds: [],
      volumePriceTiers: [],
      active: true,
      productSearch: '',
    })
    setPromoView('groups')
  }
  async function handleSaveGroup() {
    if (!groupForm.name.trim()) { setError('Dale un nombre al grupo'); return }
    if (!groupForm.productIds.length) { setError('Agrega al menos 1 producto al grupo'); return }
    const hasTiers = groupForm.volumePriceTiers.some(t => Number(t.minQty) >= 2 && Number(t.price) > 0)
    if (!hasTiers) { setError('Crea al menos 1 nivel de promoción (p. ej. 3 pzs × $240 c/u)'); return }
    setSavingGroup(true)
    setError('')
    try {
      const volumePriceTiers = groupForm.volumePriceTiers
        .map(t => ({ minQty: Math.max(2, Math.floor(Number(t.minQty) || 0)), price: Number(t.price) || 0 }))
        .filter(t => t.minQty >= 2 && t.price > 0)
        .sort((a, b) => a.minQty - b.minQty)
        .filter((t, i, arr) => arr.findIndex(x => x.minQty === t.minQty) === i)
      const productIds = Array.from(new Set(groupForm.productIds.filter(Boolean)))
      await posPromoGroupSave({ id: groupForm.id, name: groupForm.name.trim(), productIds, volumePriceTiers, active: groupForm.active })
      closeGroupForm()
      showToast(groupForm.id ? 'Grupo actualizado' : 'Grupo creado')
      await loadCatalog('', true)
      setCart(prev => withGroupPromotions(prev))
    } catch (e: any) {
      setError(e?.message || 'No se pudo guardar el grupo')
    } finally {
      setSavingGroup(false)
    }
  }
  async function handleDeleteGroup() {
    if (!confirmDeleteGroup) return
    try {
      await posPromoGroupDelete(confirmDeleteGroup.id)
      setConfirmDeleteGroup(null)
      showToast('Grupo eliminado')
      await loadCatalog('', true)
      setCart(prev => withGroupPromotions(prev))
    } catch (e: any) {
      setError(e?.message || 'No se pudo eliminar el grupo')
    }
  }
  async function handleDeletePromo() {
    if (!confirmDeletePromo) return
    try {
      const res = await posCatalogSave({
        id: confirmDeletePromo.id,
        name: confirmDeletePromo.name,
        salePrice: Number(confirmDeletePromo.salePrice),
        volumePriceTiers: [],
        bundlePriceTiers: [],
        syncToMdDoc: null,
      })
      setConfirmDeletePromo(null)
      showToast(`Promoción eliminada para ${confirmDeletePromo.name}`)
      const fresh = await posCatalog()
      setCatalog(fresh.items)
      setCart(prev => prev.map((l) => {
        if (l.itemId !== confirmDeletePromo.id) return l
        const updated = res.item || { ...confirmDeletePromo, volumePriceTiers: [], bundlePriceTiers: [] }
        const nxt = tieredUnitPrice(updated, l.qty)
        const unit = nxt.unitPrice > 0 ? nxt.unitPrice : Number(confirmDeletePromo.salePrice)
        return {
          ...l,
          baseUnitPrice: Number(confirmDeletePromo.salePrice),
          unitPrice: unit,
          importe: nxt.lineTotal,
          appliedTierMinQty: nxt.appliedMinQty,
          appliedTierSaving: nxt.saving,
        }
      }))
      void loadFrequent()
    } catch (e: any) {
      setError(e?.message || 'No se pudo eliminar la promoción')
    }
  }

  useEffect(() => {
    void loadBranches()
    void loadShift()
    void loadCatalog()
    const pollMs = 60_000
    const iv = setInterval(() => {
      void loadCatalog('', true)
    }, pollMs)
    return () => clearInterval(iv)
  }, [])

  useEffect(() => {
    if (shift) {
      void loadFrequent()
    }
  }, [shift?.id])

  useEffect(() => {
    if (promoModal?.open) {
      void loadCatalog('', true)
    }
  }, [promoModal?.open])

  useEffect(() => {
    function onClickDoc(e: MouseEvent) {
      if (!searchContainerRef.current) return
      if (!searchContainerRef.current.contains(e.target as Node)) {
        setShowSuggestions(false)
      }
    }
    document.addEventListener('mousedown', onClickDoc)
    return () => document.removeEventListener('mousedown', onClickDoc)
  }, [])

  async function handleOpenShift() {
    if (!branchForShift) return
    try {
      const r = await posShiftOpen({ branchId: branchForShift, initialCash: Number(initialCash) || 0 })
      setShift(r.shift)
      setOpenShiftModal(null)
      showToast('Turno abierto correctamente')
    } catch (e: any) {
      setError(e?.message || 'No se pudo abrir el turno')
    }
  }

  const suggestions = useMemo(() => {
    const q = String(itemSearch || '').trim().toLowerCase()
    if (!q) return []
    return catalog
      .filter((i) => {
        if (!i || typeof i !== 'object') return false
        if (!i.active || typeof i.active !== 'boolean') return false
        if (typeof i.name !== 'string' || !i.name.trim()) return false
        if (typeof i.sku !== 'string' || !i.sku.trim()) return false
        if (!Number.isFinite(i.salePrice) || i.salePrice <= 0) return false
        const name = i.name.trim().toLowerCase()
        const sku = i.sku.trim().toLowerCase()
        const family = String(i.family || '').trim().toLowerCase()
        const category = String(i.category || '').trim().toLowerCase()
        const description = String(i.description || '').trim().toLowerCase()
        const tags = (Array.isArray(i.tags) ? i.tags : []).join(' ').toLowerCase()
        return name.includes(q) || sku.includes(q) || family.includes(q) || category.includes(q) || description.includes(q) || tags.includes(q)
      })
      .slice(0, 8)
  }, [itemSearch, catalog])

  function addCatalogItemToCart(item: PosCatalogItem, qtyOverride?: number) {
    if (!shift) {
      setError('Abre un turno de caja antes de agregar productos')
      setOpenShiftModal({ open: true })
      return
    }
    if (!item?.active || !item?.sku || !item?.name) {
      setError('El producto no está disponible para vender')
      return
    }
    const qty = qtyOverride ?? itemQty
    if (qty <= 0) return
    const currentStock = item.stocks?.[shift?.branchId || ''] ?? 0
    const tier = tieredUnitPrice(item, qty)
    const lineId = `cart-${item.id}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    setCart((prev) => {
      const existingIdx = prev.findIndex((l) => l.itemId === item.id)
      let next: CartLine[]
      if (existingIdx >= 0) {
        const copy = [...prev]
        const ex = copy[existingIdx]
        const newQty = ex.qty + qty
        if (ex.priceManuallyEdited) {
          copy[existingIdx] = { ...ex, qty: newQty, importe: Number((newQty * ex.unitPrice).toFixed(2)) }
          next = copy
          return withGroupPromotions(next)
        }
        const nextTier = tieredUnitPrice(item, newQty)
        const unit = nextTier.unitPrice > 0 ? nextTier.unitPrice : item.salePrice
        copy[existingIdx] = {
          ...ex,
          qty: newQty,
          unitPrice: unit,
          importe: nextTier.lineTotal,
          appliedTierMinQty: nextTier.appliedMinQty,
          appliedTierSaving: nextTier.saving,
        }
        next = copy
      } else {
        const unit = tier.unitPrice > 0 ? tier.unitPrice : item.salePrice
        const line: CartLine = {
          id: lineId,
          itemId: item.id,
          sku: item.sku,
          name: item.name,
          qty,
          unitPrice: unit,
          importe: tier.lineTotal,
          stockInBranch: currentStock,
          baseUnitPrice: item.salePrice,
          appliedTierMinQty: tier.appliedMinQty,
          appliedTierSaving: tier.saving,
          appliedGroupId: null,
          appliedGroupName: undefined,
          appliedGroupMinQty: null,
          appliedGroupUnitPrice: null,
          groupSaving: 0,
          cashierPriceEditable: Boolean(item.cashierPriceEditable),
        }
        next = [...prev, line]
      }
      return withGroupPromotions(next)
    })
    setItemSearch('')
    setItemQty(1)
    setItemQtyRaw('')
    setShowSuggestions(false)
  }

  function addFrequentToCart(f: FrequentItem, qtyOverride?: number) {
    const qty = qtyOverride ?? Math.max(1, Number(itemQty) || 1)
    const matching = catalog.find((c) => c.id === f.itemId)
    if (matching) {
      addCatalogItemToCart(matching, qty)
      return
    }
    const lineId = `cart-${f.itemId}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    setCart((prev) => {
      const existingIdx = prev.findIndex((l) => l.itemId === f.itemId)
      let next: CartLine[]
      if (existingIdx >= 0) {
        const copy = [...prev]
        const ex = copy[existingIdx]
        const newQty = ex.qty + qty
        copy[existingIdx] = {
          ...ex,
          qty: newQty,
          importe: Number((newQty * ex.unitPrice).toFixed(2)),
        }
        next = copy
      } else {
        next = [
          ...prev,
          {
            id: lineId,
            itemId: f.itemId,
            sku: f.sku,
            name: f.name,
            qty,
            unitPrice: f.salePrice,
            importe: Number((qty * f.salePrice).toFixed(2)),
            stockInBranch: f.stock,
            baseUnitPrice: f.salePrice,
            appliedTierMinQty: null,
            appliedTierSaving: 0,
            appliedGroupId: null,
            appliedGroupName: undefined,
            appliedGroupMinQty: null,
            appliedGroupUnitPrice: null,
            groupSaving: 0,
          },
        ]
      }
      return withGroupPromotions(next)
    })
    showToast(`Agregado: ${f.name} × ${qty}`)
    setItemQty(1)
    setItemQtyRaw('')
  }

  function updateCartLineQty(id: string, nextQty: number) {
    if (nextQty <= 0) {
      setCart((prev) => withGroupPromotions(prev.filter((l) => l.id !== id)))
      return
    }
    setCart((prev) =>
      withGroupPromotions(
        prev.map((l) => {
          if (l.id !== id) return l
          const item = catalog.find((c) => c.id === l.itemId)
          const base = l.baseUnitPrice || l.unitPrice
          if (l.priceManuallyEdited) {
            return { ...l, qty: nextQty, importe: Number((nextQty * l.unitPrice).toFixed(2)) }
          }
          let tier: TieredPriceResult = {
            unitPrice: l.unitPrice,
            lineTotal: Number((l.qty * l.unitPrice).toFixed(2)),
            appliedMinQty: l.appliedTierMinQty,
            discountPerUnit: 0,
            saving: 0,
          }
          if (item) {
            tier = tieredUnitPrice(item, nextQty)
          } else if (nextQty === 1) {
            tier = { unitPrice: base, lineTotal: base, appliedMinQty: null, discountPerUnit: 0, saving: 0 }
          }
          const unit = tier.unitPrice > 0 ? tier.unitPrice : base
          return {
            ...l,
            qty: nextQty,
            unitPrice: unit,
            importe: tier.lineTotal,
            appliedTierMinQty: tier.appliedMinQty,
            appliedTierSaving: tier.saving > 0 ? tier.saving : 0,
          }
        }),
      ),
    )
  }

  function updateCartLineUnitPrice(id: string, value: string) {
    const unitPrice = Number(value)
    if (!Number.isFinite(unitPrice) || unitPrice < 0) return
    const roundedPrice = Math.round(unitPrice * 100) / 100
    setCart(prev => withGroupPromotions(prev.map(line => line.id !== id ? line : {
      ...line,
      unitPrice: roundedPrice,
      importe: Number((line.qty * roundedPrice).toFixed(2)),
      baseUnitPrice: roundedPrice,
      appliedTierMinQty: null,
      appliedTierSaving: 0,
      appliedGroupId: null,
      appliedGroupName: undefined,
      appliedGroupMinQty: null,
      appliedGroupUnitPrice: null,
      groupSaving: 0,
      priceManuallyEdited: true,
    })))
  }

  function removeCartLine(id: string) {
    setCart((prev) => withGroupPromotions(prev.filter((l) => l.id !== id)))
  }

  const cartSubtotal = useMemo(
    () => cart.reduce((s, l) => s + l.importe, 0),
    [cart],
  )

  const cartGroupSavingTotal = useMemo(
    () => cart.reduce((s, l) => s + Number(l.groupSaving || 0), 0),
    [cart],
  )

  const cartIndividualTierSavingTotal = useMemo(
    () => cart.reduce((s, l) => s + Number(l.appliedTierSaving || 0), 0),
    [cart],
  )

  const cartMatchedGroupsSummary = useMemo(() => {
    if (!promoGroups.length || !cart.length) return []
    const qtyByGroup = new Map<string, number>()
    const byItemId = new Map<string, PromoGroup[]>()
    for (const g of promoGroups) {
      if (!g.active || !Array.isArray(g.productIds) || !g.productIds.length) continue
      for (const pid of g.productIds) {
        const arr = byItemId.get(pid) || []
        arr.push(g)
        byItemId.set(pid, arr)
      }
    }
    for (const l of cart) {
      const gs = byItemId.get(l.itemId) || []
      for (const g of gs) {
        qtyByGroup.set(g.id, (qtyByGroup.get(g.id) || 0) + l.qty)
      }
    }
    const out: Array<{ id: string; name: string; totalQty: number; matchedTier?: { minQty: number; price: number } }> = []
    for (const g of promoGroups) {
      if (!g.active) continue
      const qty = qtyByGroup.get(g.id) || 0
      if (qty < 2) continue
      const tiers = [...(g.volumePriceTiers || [])]
        .filter(t => typeof t?.minQty === 'number' && typeof t?.price === 'number' && t.minQty >= 2 && t.price >= 0)
        .sort((a, b) => b.minQty - a.minQty)
      const match = tiers.find(t => qty >= t.minQty)
      out.push({ id: g.id, name: g.name, totalQty: qty, matchedTier: match ? { minQty: match.minQty, price: match.price } : undefined })
    }
    return out
  }, [cart, promoGroups])

  const cartDiscount = useMemo(
    () => Math.min(cartSubtotal, Math.max(0, discount || 0)),
    [cartSubtotal, discount],
  )

  const cartIva = useMemo(() => {
    if (!requiresFactura) return 0
    if (!shiftBranch?.ivaEnabled) return 0
    const rate = shiftBranch.ivaRate > 1 ? shiftBranch.ivaRate / 100 : shiftBranch.ivaRate
    return Number((Math.max(0, cartSubtotal - cartDiscount) * rate).toFixed(2))
  }, [cartSubtotal, cartDiscount, shiftBranch, requiresFactura])

  const cartTotal = useMemo(
    () => Number((cartSubtotal - cartDiscount + cartIva).toFixed(2)),
    [cartSubtotal, cartDiscount, cartIva],
  )

  const mixCash = Number(mixAmounts.cash) || 0
  const mixCard = Number(mixAmounts.card) || 0
  const mixTransfer = Number(mixAmounts.transfer) || 0
  const mixPaid = Number((mixCash + mixCard + mixTransfer).toFixed(2))
  const mixRemaining = checkout ? Number((checkout.total - mixPaid).toFixed(2)) : 0
  const mixNonCashOver = checkout ? mixCard + mixTransfer > checkout.total + 0.001 : false

  const ivaEnabledCalc = !!shiftBranch?.ivaEnabled && requiresFactura

  function openCheckout() {
    if (cart.length === 0 || !shift) return
    setPaidAmount(0)
    setPaymentAmount(cartTotal)
    setMixedMode(false)
    setMixAmounts({ cash: '', card: '', transfer: '' })
    setPayMethod('cash')
    setCheckout({
      open: true,
      subtotal: cartSubtotal,
      iva: cartIva,
      discount: cartDiscount,
      total: cartTotal,
    })
  }

  async function confirmPayment() {
    if (!checkout || !shift || processingPayment) return
    setProcessingPayment(true)
    setError('')
    try {
      const lines: PosSaleLine[] = cart.map((l) => ({
        itemId: l.itemId,
        sku: l.sku,
        name: l.name,
        qty: l.qty,
        unitPrice: l.unitPrice,
        importe: l.importe,
      }))
      const nowIso = new Date().toISOString()
      let paymentsToSend: Array<{ id: string; method: PaymentMethod; amount: number; at: string }> = []
      if (mixedMode) {
        if (mixPaid <= 0) throw new Error('Captura al menos un monto en efectivo, tarjeta o transferencia')
        if (mixNonCashOver) throw new Error('Tarjeta y transferencia superan el total a cobrar')
        const cashApplied = Math.max(0, Math.min(mixCash, Number((checkout.total - mixCard - mixTransfer).toFixed(2))))
        paymentsToSend = ([
          { method: 'cash', amount: cashApplied },
          { method: 'card', amount: mixCard },
          { method: 'transfer', amount: mixTransfer },
        ] as Array<{ method: PaymentMethod; amount: number }>)
          .filter((x) => x.amount > 0)
          .map((x, i) => ({ id: `p-${Date.now()}-${i}`, method: x.method, amount: Number(x.amount.toFixed(2)), at: nowIso }))
      } else {
        const methodAmount = Math.min(paymentAmount || 0, checkout.total)
        if (methodAmount > 0) paymentsToSend = [{ id: `p-${Date.now()}`, method: payMethod, amount: methodAmount, at: nowIso }]
      }
      await posSaleCreate({
        branchId: shift.branchId,
        shiftId: shift.id,
        customerName: customerName.trim() || undefined,
        requiresFactura,
        status: 'paid',
        lines,
        payments: paymentsToSend,
        discount: checkout.discount,
      })
      setCheckout(null)
      setCart([])
      setCustomerName('')
      setRequiresFactura(false)
      setDiscount(0)
      setPaidAmount(0)
      showToast('Venta registrada correctamente')
      void loadShift()
      void loadFrequent()
    } catch (e: any) {
      setError(e?.message || 'No se pudo registrar la venta')
    } finally {
      setProcessingPayment(false)
    }
  }

  async function createOwnUse() {
    if (cart.length === 0 || !shift || processingPayment) return
    const units = cart.reduce((a, l) => a + l.qty, 0)
    if (!window.confirm(`Uso propio: se descontarán ${units} pieza(s) del stock sin generar cobro. ¿Continuar?`)) return
    setProcessingPayment(true)
    setError('')
    try {
      await posSaleCreate({
        branchId: shift.branchId,
        shiftId: shift.id,
        customerName: customerName.trim() || 'USO PROPIO',
        requiresFactura: false,
        status: 'own_use',
        lines: cart.map((l) => ({
          itemId: l.itemId,
          sku: l.sku,
          name: l.name,
          qty: l.qty,
          unitPrice: l.unitPrice,
          importe: l.importe,
        })),
        payments: [],
        discount: 0,
      })
      setCheckout(null)
      setCart([])
      setCustomerName('')
      setRequiresFactura(false)
      setDiscount(0)
      setPaidAmount(0)
      showToast('Uso propio registrado: stock descontado')
      void loadCatalog('', true)
    } catch (e: any) {
      setError(e?.message || 'No se pudo registrar el uso propio')
    } finally {
      setProcessingPayment(false)
    }
  }

  async function createQuote() {
    if (cart.length === 0 || !shift) return
    setError('')
    try {
      const lines: PosSaleLine[] = cart.map((l) => ({
        itemId: l.itemId,
        sku: l.sku,
        name: l.name,
        qty: l.qty,
        unitPrice: l.unitPrice,
        importe: l.importe,
      }))
      await posSaleCreate({
        branchId: shift.branchId,
        shiftId: shift.id,
        customerName: customerName.trim() || undefined,
        requiresFactura,
        status: 'quote',
        lines,
        payments: [],
        discount: discount || 0,
      })
      setCart([])
      setCustomerName('')
      setRequiresFactura(false)
      setDiscount(0)
      showToast('Cotización creada (no descuenta stock)')
    } catch (e: any) {
      setError(e?.message || 'No se pudo crear la cotización')
    }
  }

  async function confirmWithdraw() {
    if (!shift || !withdrawAmount || processingWithdraw) return
    setProcessingWithdraw(true)
    setError('')
    try {
      await posShiftWithdraw(shift.id, {
        amount: Number(withdrawAmount),
        reason: withdrawReason.trim() || undefined,
        businessExpense: withdrawBusinessExpense,
      })
      setWithdrawModal(null)
      setWithdrawAmount(0)
      setWithdrawReason('')
      setWithdrawBusinessExpense(false)
      showToast('Retiro registrado correctamente')
      void loadShift()
    } catch (e: any) {
      setError(e?.message || 'No se pudo registrar el retiro')
    } finally {
      setProcessingWithdraw(false)
    }
  }

  async function confirmPay() {
    if (!shift || !payModalAmount || processingPayModal) return
    setProcessingPayModal(true)
    setError('')
    try {
      await posShiftPay(shift.id, {
        amount: Number(payModalAmount),
        category: payModalCategory,
        reason: payModalReason.trim() || undefined,
      })
      setPayModal(null)
      setPayModalAmount(0)
      setPayModalCategory('servicios')
      setPayModalReason('')
      showToast('Pago registrado correctamente')
      void loadShift()
    } catch (e: any) {
      setError(e?.message || 'No se pudo registrar el pago')
    } finally {
      setProcessingPayModal(false)
    }
  }

  const totalWithdrawals = useMemo(() => {
    return (
      shift?.cashWithdrawals
        ?.filter((w) => w.kind !== 'payment')
        .reduce((s, w) => s + w.amount, 0) || 0
    )
  }, [shift])

  const totalPayments = useMemo(() => {
    return (
      shift?.cashWithdrawals
        ?.filter((w) => w.kind === 'payment' || (w.businessExpense && !w.kind))
        .reduce((s, w) => s + w.amount, 0) || 0
    )
  }, [shift])

  const paymentsByMethodMap = useMemo(() => {
    const m: Record<string, number> = { cash: 0, card: 0, transfer: 0 }
    for (const p of shift?.paymentsByMethod || []) {
      m[p.method] = Number(p.total || 0)
    }
    return m
  }, [shift])

  async function loadCloseShiftSummary() {
    if (!shift) return
    setLoadingCloseShiftSummary(true)
    setCloseShiftSales([])
    try {
      const res = await posSales({
        branchId: shift.branchId,
        status: 'paid',
        limit: 500,
      })
      const shiftSales = res.sales.filter((s) => s.shiftId === shift.id)
      setCloseShiftSales(shiftSales)
    } catch (e: any) {
      setError(e?.message || '')
    } finally {
      setLoadingCloseShiftSummary(false)
    }
  }

  const aggregatedProducts = useMemo(() => {
    type Agg = { itemId: string; sku?: string; name: string; qty: number; total: number; unitPrice: number }
    const map = new Map<string, Agg>()
    const feedLine = (l: { itemId?: string; sku?: string; name: string; qty?: number | string; importe?: number | string; unitPrice?: number | string; total?: number | string }) => {
      const key = l.itemId || String(l.name || 'product-' + Math.random().toString(36).slice(2, 7))
      const qty = Number(l.qty || 0)
      const amount = Number(l.importe ?? l.total ?? 0)
      const unit = Number(l.unitPrice || 0)
      if (!key || !qty) return
      const cur = map.get(key)
      if (cur) {  
        cur.qty += qty
        cur.total += amount
        if (!cur.unitPrice && unit) cur.unitPrice = unit
      } else {
        map.set(key, {
          itemId: key,
          sku: l.sku,
          name: l.name || 'Producto',
          qty,
          total: amount,
          unitPrice: unit || (qty > 0 ? amount / qty : 0),
        })
      }
    }
    if (Array.isArray((shift as any)?.salesLines) && (shift as any).salesLines.length > 0) {
      for (const l of (shift as any).salesLines) feedLine(l)
    }
    if (map.size === 0) {
      for (const s of closeShiftSales) {
        for (const l of s.lines || []) feedLine(l as any)
      }
    }
    return Array.from(map.values()).sort((a, b) => b.total - a.total)
  }, [closeShiftSales, shift])

  function printShiftReport() {
    if (!shift) return
    const linesHtml = aggregatedProducts.length
      ? aggregatedProducts.map((p) => `
        <tr>
          <td style="border-bottom:1px solid #ddd;padding:6px 4px;">${p.qty}</td>
          <td style="border-bottom:1px solid #ddd;padding:6px 4px;">${p.name}${p.sku ? ` <small style="color:#888;">(${p.sku})</small>` : ''}</td>
          <td style="border-bottom:1px solid #ddd;padding:6px 4px;text-align:right;">$${(p.unitPrice || 0).toFixed(2)}</td>
          <td style="border-bottom:1px solid #ddd;padding:6px 4px;text-align:right;"><b>$${p.total.toFixed(2)}</b></td>
        </tr>
      `).join('')
      : `<tr><td colspan="4" style="padding:20px;text-align:center;color:#888;">Sin productos vendidos en este turno</td></tr>`

    const movements = shift.cashWithdrawals || []
    const withdrawalsList = movements.filter((w) => w.kind !== 'payment')
    const paymentsList = movements.filter((w) => w.kind === 'payment' || (w.businessExpense && !w.kind))

    const movementsHtml = `
      <h3 style="margin-top:24px;margin-bottom:8px;color:#0c2a47;">Movimientos de Caja</h3>
      <h4 style="margin:14px 0 6px;color:#b91c1c;">Retiros (${withdrawalsList.length})</h4>
      ${withdrawalsList.length ? `<table style="width:100%;border-collapse:collapse;font-size:12px;">
        <thead><tr style="background:#f3f4f6;">
          <th style="padding:6px 4px;text-align:left;">Fecha</th>
          <th style="padding:6px 4px;text-align:left;">Motivo</th>
          <th style="padding:6px 4px;text-align:right;">Monto</th>
        </tr></thead>
        <tbody>${withdrawalsList.map((w) => `<tr>
          <td style="border-bottom:1px solid #ddd;padding:5px 4px;">${new Date(w.at).toLocaleString()}</td>
          <td style="border-bottom:1px solid #ddd;padding:5px 4px;">${w.reason || (w.businessExpense ? 'Gasto empresa' : 'Retiro')}</td>
          <td style="border-bottom:1px solid #ddd;padding:5px 4px;text-align:right;">-$${w.amount.toFixed(2)}</td>
        </tr>`).join('')}
        </tbody></table>` : '<p style="color:#888;font-size:12px;">Sin retiros</p>'}
      <h4 style="margin:14px 0 6px;color:#1d4ed8;">Pagos / Gastos (${paymentsList.length})</h4>
      ${paymentsList.length ? `<table style="width:100%;border-collapse:collapse;font-size:12px;">
        <thead><tr style="background:#f3f4f6;">
          <th style="padding:6px 4px;text-align:left;">Fecha</th>
          <th style="padding:6px 4px;text-align:left;">Categoría / Motivo</th>
          <th style="padding:6px 4px;text-align:right;">Monto</th>
        </tr></thead>
        <tbody>${paymentsList.map((w) => `<tr>
          <td style="border-bottom:1px solid #ddd;padding:5px 4px;">${new Date(w.at).toLocaleString()}</td>
          <td style="border-bottom:1px solid #ddd;padding:5px 4px;">${w.category ? `${w.category} · ` : ''}${w.reason || 'Pago'}</td>
          <td style="border-bottom:1px solid #ddd;padding:5px 4px;text-align:right;">-$${w.amount.toFixed(2)}</td>
        </tr>`).join('')}
        </tbody></table>` : '<p style="color:#888;font-size:12px;">Sin pagos</p>'}
    `

    const html = `<!DOCTYPE html><html><head><title>Reporte de Turno ${shift.id.slice(-8)}</title>
      <meta charset="utf-8"/>
      <style>
        @page { size: auto; margin: 0mm; }
        @media print {
          html, body { margin: 0; padding: 0; }
          body { background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact; }
          .no-print { display:none !important; }
        }
        body{font-family:Arial,Helvetica,sans-serif;padding:18mm 14mm;color:#111;box-sizing:border-box;}
        h1{color:#0c2a47;margin:0 0 4px 0;font-size:24px;}
        h2{color:#1090D0;margin:0 0 18px 0;font-size:14px;font-weight:600;}
        h3{color:#0c2a47;margin:24px 0 10px 0;font-size:18px;font-weight:700;}
        h4{margin:16px 0 6px 0;font-size:15px;font-weight:700;}
        .grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:4px 0 0 0;}
        .card{border:1px solid #e5e7eb;border-radius:10px;padding:14px 16px;background:#f9fafb;break-inside:avoid;}
        .card .label{font-size:11px;text-transform:uppercase;letter-spacing:0.7px;color:#6b7280;font-weight:700;margin-bottom:6px;}
        .card .value{font-size:22px;font-weight:800;color:#0c2a47;font-variant-numeric:tabular-nums;}
        .card .value small{font-size:12px;font-weight:600;color:#374151;margin-left:4px;}
        .value.green{color:#059669;}
        .value.red{color:#dc2626;}
        .value.blue{color:#2563eb;}
        table{width:100%;border-collapse:collapse;font-size:13px;margin-top:6px;break-inside:auto;}
        th{background:#0c2a47;color:#fff;padding:10px 8px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:0.7px;border:none;}
        th.text-right{text-align:right;}
        td{padding:8px;border-bottom:1px solid #e5e7eb;vertical-align:top;}
        td small{color:#6b7280;font-size:10.5px;display:block;margin-top:2px;}
        .total-row{background:#0c2a47 !important;color:#fff;font-weight:800;}
        .total-row td{border-bottom:none;}
        .empty-state{padding:24px;text-align:center;color:#6b7280;background:#f9fafb;border:1px dashed #d1d5db;border-radius:10px;}
        .footer-note{margin-top:34px;padding-top:14px;border-top:2px dashed #9ca3af;font-size:11px;color:#6b7280;text-align:center;}
      </style></head><body>
      <h1>Smartbis POS · Reporte de Cierre de Turno</h1>
      <h2>Turno #${shift.id.slice(-8)} · ${shiftBranch?.name || ''} · Cajero: ${shift.userEmail} · ${new Date(shift.openedAt).toLocaleString()} — ${shift.closedAt ? new Date(shift.closedAt).toLocaleString() : new Date().toLocaleString()}</h2>
      <div class="grid">
        <div class="card"><div class="label">Efectivo Inicial</div><div class="value">$${Number(shift.initialCash || 0).toFixed(2)}</div></div>
        <div class="card"><div class="label">Total Ventas</div><div class="value green">$${Number(shift.salesTotal || 0).toFixed(2)} <small>#${shift.salesCount || 0}</small></div></div>
        <div class="card"><div class="label">Retiros</div><div class="value red">-$${totalWithdrawals.toFixed(2)}</div></div>
        <div class="card"><div class="label">Pagos / Gastos</div><div class="value blue">-$${totalPayments.toFixed(2)}</div></div>
        <div class="card"><div class="label">Venta Efectivo</div><div class="value">$${(paymentsByMethodMap.cash || 0).toFixed(2)}</div></div>
        <div class="card"><div class="label">Venta Tarjeta</div><div class="value">$${(paymentsByMethodMap.card || 0).toFixed(2)}</div></div>
        <div class="card"><div class="label">Venta Transferencia</div><div class="value">$${(paymentsByMethodMap.transfer || 0).toFixed(2)}</div></div>
        <div class="card"><div class="label">Efectivo Estimado en Caja</div><div class="value green">$${(Number(shift.initialCash || 0) + (paymentsByMethodMap.cash || 0) - totalWithdrawals - totalPayments).toFixed(2)}</div></div>
      </div>
      <h3>Productos Vendidos (${aggregatedProducts.reduce((s, p) => s + p.qty, 0)} piezas)</h3>
      ${aggregatedProducts.length === 0 ? `<div class="empty-state">Sin productos vendidos en este turno</div>` : `
      <table>
        <thead><tr>
          <th style="width:80px;">Cant</th>
          <th>Producto</th>
          <th class="text-right" style="width:120px;">P. Unit</th>
          <th class="text-right" style="width:140px;">Importe</th>
        </tr></thead>
        <tbody>
          ${linesHtml}
          <tr class="total-row">
            <td style="padding:10px 8px;">${aggregatedProducts.reduce((s, p) => s + p.qty, 0)}</td>
            <td style="padding:10px 8px;"><b>TOTAL PRODUCTOS</b></td>
            <td style="padding:10px 8px;text-align:right;">—</td>
            <td style="padding:10px 8px;text-align:right;">$${aggregatedProducts.reduce((s, p) => s + p.total, 0).toFixed(2)}</td>
          </tr>
        </tbody>
      </table>`}
      ${movementsHtml}
      <div class="footer-note">
        Smartbis POS · Reporte generado ${new Date().toLocaleString()}
      </div>
    </body></html>`

    const w = window.open('', '_blank', 'width=900,height=800')
    if (w) {
      w.document.write(html)
      w.document.close()
      w.focus()
      setTimeout(() => { try { w.print() } catch (_) {} }, 350)
    }
  }

  async function confirmCloseShift() {
    if (!shift || processingCloseShift) return
    setProcessingCloseShift(true)
    setError('')
    try {
      await posShiftClose(shift.id)
      setShift(undefined)
      setCloseShiftModal(null)
      setCart([])
      setCustomerName('')
      setRequiresFactura(false)
      setDiscount(0)
      showToast('Turno cerrado correctamente')
      // Si no hay turno abierto, forzar mostrar modal para abrir uno nuevo
      setTimeout(() => setOpenShiftModal({ open: true }), 600)
    } catch (e: any) {
      setError(e?.message || 'No se pudo cerrar el turno')
    } finally {
      setProcessingCloseShift(false)
    }
  }

  function kindEmoji(k?: ItemKind) {
    switch (k) {
      case 'product':
        return '💊'
      case 'service':
        return '🔧'
      case 'course':
        return '🎓'
      case 'menu_item':
        return '🍕'
      default:
        return '📦'
    }
  }

  return (
    <section className="flex h-screen min-h-0 w-full flex-col overflow-hidden bg-[#0c2a47] text-white">
      <header className="z-20 border-b border-[#1a3a5a] bg-[#0f3151] px-3 py-2" style={{ height: '56px' }}>
        <div className="flex h-full items-center gap-1.5">
          <button
            type="button"
            onClick={() => {
              if (!shift) return
              setCloseShiftModal({ open: true })
              void loadCloseShiftSummary()
            }}
            disabled={!shift}
            className="flex h-[30px] cursor-pointer items-center gap-1.5 rounded-xl border border-emerald-500/40 bg-emerald-500/15 px-2.5 py-1 transition hover:border-emerald-400 hover:bg-emerald-500/25 disabled:cursor-not-allowed disabled:opacity-50"
            title="Clic para cerrar el turno actual"
          >
            <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400 shadow-[0_0_0_3px_rgba(52,211,153,0.2)]" />
            <span className="text-[11px] font-bold text-emerald-200">Turno abierto</span>
          </button>

          <div className="flex items-center gap-1.5 rounded-xl border border-[#1a3a5a] bg-[#0b2641]/80 px-2.5 py-1" style={{ height: '30px' }}>
            <UserPlus className="h-3.5 w-3.5 text-slate-400" />
            <span className="font-mono text-[11px] font-bold text-slate-100">—</span>
          </div>

          <div className="flex items-center gap-1.5 rounded-xl border border-[#1090D0]/40 bg-[#1090D0]/10 px-2.5 py-1" style={{ height: '30px' }}>
            <Wallet className="h-3.5 w-3.5 text-[#5bbfe5]" />
            <span className="font-mono text-[11px] font-bold text-slate-50">
              ${Number(shift?.initialCash ?? 0).toFixed(2)}
            </span>
          </div>

          <div className="flex items-center gap-1.5 rounded-xl border border-rose-500/30 bg-rose-500/10 px-2.5 py-1" style={{ height: '30px' }}>
            <LogOut className="h-3.5 w-3.5 text-rose-300" />
            <span className="font-mono text-[11px] font-bold text-rose-100">
              ${totalWithdrawals.toFixed(2)}
            </span>
          </div>

          {totalPayments > 0 ? (
            <div className="flex items-center gap-1.5 rounded-xl border border-blue-500/30 bg-blue-500/10 px-2.5 py-1" style={{ height: '30px' }}>
              <ReceiptText className="h-3.5 w-3.5 text-blue-300" />
              <span className="font-mono text-[11px] font-bold text-blue-100">
                ${totalPayments.toFixed(2)}
              </span>
            </div>
          ) : null}

          {shiftBranch ? (
            <div className="flex items-center gap-1.5 rounded-xl border border-[#1a3a5a] bg-[#0b2641]/80 px-2.5 py-1" style={{ height: '30px' }}>
              <Building2 className="h-3.5 w-3.5 text-[#5bbfe5]" />
              <span className="text-[11px] font-semibold text-slate-100">{shiftBranch.name}</span>
              {shiftBranch.ivaEnabled ? (
                <span className="rounded-full border border-emerald-400/30 bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-bold text-emerald-200">
                  IVA {shiftBranch.ivaRate > 1 ? Number(shiftBranch.ivaRate).toFixed(0) : Math.round(shiftBranch.ivaRate * 100)}%
                </span>
              ) : null}
            </div>
          ) : null}

          <div className="ml-auto flex items-center gap-1.5">
            <div className="flex items-center gap-1.5 rounded-xl bg-[#1090D0]/90 px-2.5 py-1 shadow-[0_4px_14px_-6px_rgba(16,144,208,0.8)]" style={{ height: '30px' }}>
              <ShoppingCart className="h-3.5 w-3.5 text-white" />
              <span className="rounded-full bg-white/20 px-1.5 py-0.5 text-[9px] font-bold">
                {cart.length}
              </span>
              <span className="text-[11px] font-bold tracking-wide text-white">{shiftBranch?.name ?? 'Sucursal Principal'}</span>
            </div>
          </div>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 overflow-hidden lg:grid-cols-[1fr_260px]">
        <div className="flex min-h-0 w-full flex-col gap-2 overflow-hidden px-3 py-3">
          <div ref={searchContainerRef} className="rounded-2xl border border-[#1a3a5a] bg-[#0f3151] p-2">
            <div className="grid grid-cols-2 gap-2">
              <div className="flex items-center gap-2" style={{ height: '40px' }}>
                <div className="flex flex-1 items-center gap-2 rounded-xl border border-[#1a3a5a] bg-[#0b2641] px-3 py-2 focus-within:border-[#1090D0]/50 focus-within:bg-[#0c2c4c]" style={{ height: '40px' }}>
                  <UserPlus className="h-4 w-4 text-slate-400" />
                  <input
                    type="text"
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    placeholder="Nombre del cliente"
                    className="flex-1 bg-transparent text-[13px] text-slate-100 placeholder:text-slate-500 focus:outline-none"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => {
                    if (customerName.trim()) {
                      showToast(`Cliente guardado: ${customerName.trim()}`)
                    }
                  }}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#1090D0]/20 text-[#5bbfe5] transition hover:bg-[#1090D0]/35 hover:text-white shadow-[0_0_0_1px_rgba(16,144,208,0.3)]"
                  title="Guardar cliente"
                >
                  <Plus className="h-4 w-4" />
                </button>
                <label className="flex cursor-pointer items-center gap-1.5 rounded-xl border border-[#1a3a5a] bg-[#0b2641] px-3 py-2 transition hover:border-[#1090D0]/40" style={{ height: '40px' }}>
                  <input
                    type="checkbox"
                    checked={requiresFactura}
                    onChange={(e) => setRequiresFactura(e.target.checked)}
                    className="h-3.5 w-3.5 rounded-full accent-[#1090D0]"
                  />
                  <span className="whitespace-nowrap text-[11px] font-semibold text-slate-300">Factura</span>
                </label>
              </div>

              <div className="flex items-center gap-2" style={{ height: '40px' }}>
                <div className="flex items-center rounded-xl border border-[#1a3a5a] bg-[#0b2641] p-0.5" style={{ height: '40px' }}>
                  <button
                    type="button"
                    onClick={() => {
                      const next = Math.max(1, Math.min(99999, Number(itemQty || 1) - 1))
                      setItemQty(next)
                      setItemQtyRaw(String(next))
                    }}
                    className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-300 transition hover:bg-[#1090D0]/15 hover:text-[#5bbfe5]"
                  >
                    <Minus className="h-3.5 w-3.5" />
                  </button>
                  <div className="flex h-7 w-14 items-center justify-center rounded-lg bg-black/30 px-1">
                    <input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      value={itemQtyRaw !== '' ? String(itemQtyRaw) : ''}
                      onChange={(e) => {
                        const raw = e.target.value.replace(/[^0-9]/g, '')
                        setItemQtyRaw(raw)
                        if (raw === '') return
                        const n = Number(raw)
                        if (!isFinite(n)) return
                        const clamped = Math.max(1, Math.min(99999, Math.floor(n)))
                        setItemQty(clamped)
                      }}
                      onFocus={(e) => {
                        e.target.select()
                      }}
                      onBlur={() => {
                        if (itemQtyRaw === '') {
                          setItemQty(1)
                          setItemQtyRaw('')
                          return
                        }
                        const n = Number(itemQtyRaw)
                        if (!isFinite(n)) { setItemQty(1); setItemQtyRaw(''); return }
                        const clamped = Math.max(1, Math.min(99999, Math.floor(n)))
                        setItemQty(clamped)
                        setItemQtyRaw(String(clamped))
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'ArrowUp') {
                          e.preventDefault()
                          const next = Math.max(1, Math.min(99999, Number(itemQty || 1) + 1))
                          setItemQty(next)
                          setItemQtyRaw(String(next))
                        } else if (e.key === 'ArrowDown') {
                          e.preventDefault()
                          const next = Math.max(1, Math.min(99999, Number(itemQty || 1) - 1))
                          setItemQty(next)
                          setItemQtyRaw(String(next))
                        } else if (e.key === 'Enter') {
                          e.preventDefault()
                          const first = suggestions[0]
                          if (first) {
                            addCatalogItemToCart(first)
                          }
                        } else if (e.key === 'Escape') {
                          ;(e.target as HTMLInputElement).blur()
                        }
                      }}
                      className="h-full w-full bg-transparent text-center font-mono text-[13px] font-extrabold text-white outline-none placeholder:text-slate-500 caret-[#5bbfe5] selection:bg-[#1090D0]/40"
                      placeholder="1"
                      aria-label="Cantidad"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const next = Math.max(1, Math.min(99999, Number(itemQty || 1) + 1))
                      setItemQty(next)
                      setItemQtyRaw(String(next))
                    }}
                    className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-300 transition hover:bg-[#1090D0]/15 hover:text-[#5bbfe5]"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                </div>

                <div className="relative flex-1">
                  <div className="flex items-center gap-2 rounded-xl border border-[#1a3a5a] bg-[#0b2641] px-3 py-2 focus-within:border-[#1090D0]/50 focus-within:bg-[#0c2c4c]" style={{ height: '40px' }}>
                    <Search className="h-4 w-4 text-slate-400" />
                    <input
                      type="text"
                      value={itemSearch}
                      onChange={(e) => {
                        const next = e.target.value
                        setItemSearch(next)
                        setShowSuggestions(true)
                        void loadCatalog(next)
                      }}
                      onFocus={() => setShowSuggestions(true)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && suggestions[0]) {
                          addCatalogItemToCart(suggestions[0])
                        }
                      }}
                      placeholder="Buscar (SKU, nombre, familia)..."
                      className="flex-1 bg-transparent text-[13px] text-slate-100 placeholder:text-slate-500 focus:outline-none"
                    />
                    {catalogLoading ? (
                      <span className="rounded-full border border-[#1090D0]/40 bg-[#1090D0]/10 px-2 py-0.5 text-[9px] font-bold text-[#5bbfe5]">
                        ...
                      </span>
                    ) : null}
                  </div>

                  {showSuggestions && suggestions.length > 0 ? (
                    <div className="absolute left-0 right-0 top-full z-40 mt-1.5 overflow-hidden rounded-xl border border-[#1a3a5a] bg-[#0f3151] shadow-2xl shadow-black/40">
                      <ul className="max-h-[280px] overflow-y-auto tech-scrollbar">
                        {suggestions.map((s) => (
                          <li key={s.id}>
                            <button
                              type="button"
                              onClick={() => addCatalogItemToCart(s)}
                              className="flex w-full items-center gap-3 px-3 py-2 text-left transition hover:bg-[#1090D0]/10"
                            >
                              <span className="text-[16px]">{kindEmoji(s.kind)}</span>
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-[12px] font-semibold text-slate-100">
                                  {s.name}
                                </p>
                                <p className="truncate text-[10px] text-slate-400">
                                  {s.sku || '—'} · {s.family || 'Sin familia'} · Stock{' '}
                                  {s.stocks?.[shift?.branchId || ''] ?? 0}
                                </p>
                              </div>
                              <div className="text-right">
                                <div className="font-mono text-[13px] font-bold text-[#5bbfe5]">
                                  ${s.salePrice.toFixed(2)}
                                </div>
                                <div className="text-[9px] text-slate-500">× {itemQty}</div>
                              </div>
                              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#1090D0]/80 text-white">
                                <Plus className="h-3.5 w-3.5" />
                              </div>
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>

                <button
                  type="button"
                  onClick={() => {
                    if (suggestions[0]) addCatalogItemToCart(suggestions[0])
                  }}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#1090D0] text-white shadow-[0_4px_14px_-4px_rgba(16,144,208,0.7)] transition hover:bg-[#0c79ae]"
                >
                  <Plus className="h-4.5 w-4.5" />
                </button>
              </div>
            </div>
          </div>

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-[#1a3a5a] bg-[#0f3151]">
            <div className="flex h-9 items-center justify-between border-b border-[#1a3a5a] bg-[#0b2641]/70 px-3">
              <div className="flex items-center gap-1.5">
                <ShoppingCart className="h-3.5 w-3.5 text-[#5bbfe5]" />
                <span className="text-[10.5px] font-bold text-slate-300">
                  {cart.reduce((s, l) => s + l.qty, 0)} art
                </span>
              </div>
              {cart.length > 0 ? (
                <button
                  type="button"
                  onClick={() => setCart([])}
                  className="flex items-center gap-1 rounded-lg border border-rose-500/20 bg-rose-500/10 px-2 py-0.5 text-[10px] font-semibold text-rose-200 transition hover:bg-rose-500/20"
                >
                  <Trash2 className="h-3 w-3" />
                  Limpiar
                </button>
              ) : null}
            </div>

            {cart.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 px-5 py-6 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-dashed border-[#2a5589] bg-white/[0.02] text-slate-500">
                  <ShoppingCart className="h-6 w-6" />
                </div>
                <h3 className="text-[12px] font-bold uppercase tracking-wider text-slate-300">
                  Agrega productos para iniciar una venta
                </h3>
                <p className="max-w-md text-[10.5px] leading-relaxed text-slate-400">
                  Usa el buscador superior para encontrar productos por nombre o SKU, o da clic en
                  los productos frecuentes del panel derecho.
                </p>
              </div>
            ) : (
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                <div className="min-h-0 flex-1 overflow-y-auto tech-scrollbar">
                  <table className="w-full text-left text-[12px]">
                    <thead className="sticky top-0 z-10 border-b border-[#1a3a5a] bg-[#0b2641]/95 text-[9.5px] font-bold uppercase tracking-wider text-slate-400 backdrop-blur" style={{ height: '32px' }}>
                      <tr>
                        <th className="px-2.5 py-1 w-[90px]">Cant</th>
                        <th className="px-2.5 py-1">Producto</th>
                        <th className="px-2.5 py-1 text-right w-[100px]">P. Unit</th>
                        <th className="px-2.5 py-1 text-right w-[100px]">Importe</th>
                        <th className="px-2 py-1 text-right w-8"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {cart.map((l) => (
                        <tr
                          key={l.id}
                          className="border-b border-[#1a3a5a]/40 last:border-0 hover:bg-[#11375a]/50"
                          style={{ height: '36px' }}
                        >
                          <td className="px-2.5 py-1.5">
                            <div className="inline-flex items-center gap-0.5">
                              <button
                                type="button"
                                onClick={() => updateCartLineQty(l.id, l.qty - 1)}
                                className="flex h-6 w-6 items-center justify-center rounded-md border border-[#1a3a5a] bg-[#0b2641] text-slate-300 transition hover:bg-[#1090D0]/15 hover:text-[#5bbfe5]"
                              >
                                <Minus className="h-3 w-3" />
                              </button>
                              <div className="flex w-7 items-center justify-center">
                                <span className="font-mono text-[12px] font-bold text-white">{l.qty}</span>
                              </div>
                              <button
                                type="button"
                                onClick={() => updateCartLineQty(l.id, l.qty + 1)}
                                className="flex h-6 w-6 items-center justify-center rounded-md border border-[#1a3a5a] bg-[#0b2641] text-slate-300 transition hover:bg-[#1090D0]/15 hover:text-[#5bbfe5]"
                              >
                                <Plus className="h-3 w-3" />
                              </button>
                            </div>
                          </td>
                          <td className="px-2.5 py-1.5">
                            <div className="text-[12px] font-semibold leading-tight text-slate-100 flex items-center gap-1.5 flex-wrap">
                              {l.name}
                              {l.appliedTierMinQty ? (
                                <span className="inline-flex items-center gap-0.5 rounded-full border border-amber-400/30 bg-amber-400/10 px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-wider text-amber-200">
                                  🎁 {l.appliedTierMinQty}+ pzs
                                </span>
                              ) : null}
                              {l.appliedGroupId ? (
                                <span className="inline-flex items-center gap-0.5 rounded-full border border-cyan-400/30 bg-cyan-400/10 px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-wider text-cyan-200" title={`${l.appliedGroupName || 'Grupo'} · ${l.appliedGroupMinQty}+ unids. por $${l.appliedGroupUnitPrice?.toFixed(2)} c/u`}>
                                  🏷️ {l.appliedGroupName || 'Grupo'} {l.appliedGroupMinQty}+
                                </span>
                              ) : null}
                            </div>
                            <div className="text-[10px] leading-tight text-slate-500 flex items-center gap-2 flex-wrap">
                              <span>Stock {l.stockInBranch}{l.sku ? <> · {l.sku}</> : null}</span>
                              {l.appliedTierMinQty && l.baseUnitPrice > 0 && l.unitPrice < l.baseUnitPrice && !l.appliedGroupId ? (
                                <span className="text-emerald-300 font-bold tracking-wide">
                                  Base: ${l.baseUnitPrice.toFixed(2)} · Ahorras ${(l.appliedTierSaving || 0).toFixed(2)}
                                </span>
                              ) : null}
                              {l.appliedGroupId && l.groupSaving > 0 ? (
                                <span className="text-cyan-200 font-bold tracking-wide">
                                  Base: ${l.baseUnitPrice.toFixed(2)} · Grupo ${l.appliedGroupUnitPrice?.toFixed(2)} c/u · Ahorras ${l.groupSaving.toFixed(2)}
                                </span>
                              ) : null}
                            </div>
                          </td>
                          <td className="px-2.5 py-1.5 text-right font-mono text-[12px] text-slate-200">
                            {l.cashierPriceEditable ? (
                              <label className="inline-flex items-center gap-1" title="Precio editable para caja">
                                <span className="text-slate-400">$</span>
                                <input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  value={priceEditDrafts[l.id] ?? String(l.unitPrice)}
                                  onFocus={() => setPriceEditDrafts(prev => ({ ...prev, [l.id]: String(l.unitPrice) }))}
                                  onChange={event => setPriceEditDrafts(prev => ({ ...prev, [l.id]: event.target.value }))}
                                  onBlur={() => {
                                    updateCartLineUnitPrice(l.id, priceEditDrafts[l.id] ?? String(l.unitPrice))
                                    setPriceEditDrafts(prev => { const next = { ...prev }; delete next[l.id]; return next })
                                  }}
                                  aria-label={`Precio de ${l.name}`}
                                  className="w-24 rounded-md border border-amber-400/40 bg-[#091f35] px-2 py-1 text-right font-mono text-[12px] font-bold text-amber-100 outline-none focus:border-amber-300"
                                />
                              </label>
                            ) : l.appliedGroupId && l.groupSaving > 0 ? (
                              <div className="flex flex-col items-end leading-tight">
                                <span className="line-through text-slate-500 text-[10px] font-semibold">${l.baseUnitPrice.toFixed(2)}</span>
                                <span className="text-cyan-200 font-bold">${l.unitPrice.toFixed(2)}</span>
                              </div>
                            ) : l.appliedTierMinQty && l.baseUnitPrice > 0 && l.unitPrice < l.baseUnitPrice ? (
                              <div className="flex flex-col items-end leading-tight">
                                <span className="line-through text-slate-500 text-[10px] font-semibold">${l.baseUnitPrice.toFixed(2)}</span>
                                <span className="text-emerald-200 font-bold">${l.unitPrice.toFixed(2)}</span>
                              </div>
                            ) : (
                              <span>${l.unitPrice.toFixed(2)}</span>
                            )}
                          </td>
                          <td className="px-2.5 py-1.5 text-right">
                            <span className="font-mono text-[12px] font-bold text-slate-50">
                              ${l.importe.toFixed(2)}
                            </span>
                          </td>
                          <td className="px-2 py-1.5 text-right">
                            <button
                              type="button"
                              onClick={() => removeCartLine(l.id)}
                              className="flex h-6 w-6 items-center justify-center rounded-md text-slate-400 transition hover:bg-rose-500/15 hover:text-rose-300"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-[#1a3a5a] bg-[#0f3151] px-3 py-2" style={{ maxHeight: '120px' }}>
            {(cartGroupSavingTotal > 0 || cartIndividualTierSavingTotal > 0) ? (
              <div className="flex items-center gap-3 pb-1.5 mb-1 border-b border-[#1a3a5a]/60 text-[11px]">
                <Tag className="h-3 w-3 text-cyan-300" />
                <span className="text-slate-300 font-bold whitespace-nowrap">Ahorro total promociones</span>
                <span className="font-mono font-extrabold text-emerald-300">
                  -${(cartGroupSavingTotal + cartIndividualTierSavingTotal).toFixed(2)}
                </span>
                {cartGroupSavingTotal > 0 ? (
                  <span className="text-cyan-200 font-bold">
                    por grupos <span className="font-mono">-${cartGroupSavingTotal.toFixed(2)}</span>
                  </span>
                ) : null}
                {cartIndividualTierSavingTotal > 0 ? (
                  <span className="text-amber-200 font-bold">
                    por cantidad <span className="font-mono">-${cartIndividualTierSavingTotal.toFixed(2)}</span>
                  </span>
                ) : null}
              </div>
            ) : null}
            {cartMatchedGroupsSummary.some(g => !g.matchedTier) ? (
              <div className="mb-1 pb-1 border-b border-[#1a3a5a]/60">
                {cartMatchedGroupsSummary.filter(g => !g.matchedTier).map((g) => {
                  const nextTier = [...(promoGroups.find(pg => pg.id === g.id)?.volumePriceTiers || [])]
                    .filter(t => typeof t?.minQty === 'number' && typeof t?.price === 'number' && t.minQty >= 2 && t.price >= 0)
                    .sort((a, b) => a.minQty - b.minQty)
                    .find(t => t.minQty > g.totalQty)
                  const faltan = nextTier ? nextTier.minQty - g.totalQty : 0
                  return (
                    <div key={g.id} className="flex items-center gap-2 text-[10.5px]">
                      <AlertCircle className="h-3 w-3 text-amber-300 shrink-0" />
                      <span className="text-slate-200 font-semibold whitespace-nowrap">{g.name}</span>
                      {nextTier ? (
                        <span className="text-amber-200 font-bold">
                          Llevas {g.totalQty} de {nextTier.minQty} · te faltan {faltan} para activar <span className="font-mono">${nextTier.price.toFixed(2)} c/u</span>
                        </span>
                      ) : (
                        <span className="text-slate-400">· {g.totalQty} unidades en el grupo</span>
                      )}
                    </div>
                  )
                })}
              </div>
            ) : null}
            <div className="flex items-end gap-2">
              {ivaEnabledCalc ? (
                <div className="flex-1 flex flex-col items-center justify-center rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-2 py-1.5">
                  <div className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-emerald-200">
                    <Percent className="h-2.5 w-2.5" />
                    IVA
                  </div>
                  <div className="font-mono text-[14px] font-bold text-emerald-100">
                    ${cartIva.toFixed(2)}
                  </div>
                </div>
              ) : null}

              <div className="flex-1 flex flex-col items-center justify-center rounded-xl border border-[#1a3a5a] bg-[#0b2641]/60 px-2 py-1.5">
                <div className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-slate-400">
                  <FileText className="h-2.5 w-2.5" />
                  Subtotal
                </div>
                <div className="font-mono text-[14px] font-bold text-slate-100">
                  ${cartSubtotal.toFixed(2)}
                </div>
              </div>

              <div className="flex-1 flex flex-col items-center justify-center rounded-xl border border-[#1a3a5a] bg-[#0b2641]/60 px-2 py-1.5">
                <label className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-slate-400">
                  <TagIcon className="h-2.5 w-2.5" />
                  Descto
                </label>
                <div className="flex w-full items-center gap-0.5 rounded-lg border border-[#1a3a5a] bg-black/25 px-1.5 focus-within:border-[#1090D0]/50" style={{ height: '28px' }}>
                  <span className="text-[10px] text-slate-400">$</span>
                  <input
                    type="number"
                    step="0.01"
                    min={0}
                    value={discount || ''}
                    onChange={(e) => setDiscount(Number(e.target.value) || 0)}
                    className="w-full bg-transparent font-mono text-[12px] font-bold text-rose-200 focus:outline-none"
                  />
                </div>
              </div>

              <div className="flex-1 flex flex-col items-center justify-center rounded-xl border border-[#1090D0]/60 bg-[#1090D0]/18 px-2 py-1.5 shadow-[inset_0_0_0_1px_rgba(16,144,208,0.25)]">
                <div className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-[#8fd2ec]">
                  <Receipt className="h-2.5 w-2.5" />
                  Total
                </div>
                <div className="font-mono text-[17px] font-extrabold text-[#1090D0] drop-shadow-[0_0_6px_rgba(16,144,208,0.35)]">
                  ${cartTotal.toFixed(2)}
                </div>
              </div>

              <div className="flex-1 flex flex-col items-center justify-center rounded-xl border border-[#1a3a5a] bg-[#0b2641]/60 px-2 py-1.5">
                <label className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-slate-400">
                  <CreditCard className="h-2.5 w-2.5" />
                  Pagos
                </label>
                <div className="flex w-full items-center gap-0.5 rounded-lg border border-[#1a3a5a] bg-black/25 px-1.5 focus-within:border-[#1090D0]/50" style={{ height: '28px' }}>
                  <span className="text-[10px] text-slate-400">$</span>
                  <input
                    type="number"
                    step="0.01"
                    min={0}
                    value={paidAmount || ''}
                    onChange={(e) => setPaidAmount(Number(e.target.value) || 0)}
                    className="w-full bg-transparent font-mono text-[12px] font-bold text-emerald-200 focus:outline-none"
                  />
                </div>
              </div>

              <div className="flex-1 flex flex-col items-center justify-center rounded-xl border border-amber-500/30 bg-amber-500/10 px-2 py-1.5">
                <div className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-amber-200">
                  <TrendingUp className="h-2.5 w-2.5" />
                  Pendiente
                </div>
                <div
                  className={cn(
                    'font-mono text-[14px] font-bold',
                    cartTotal - paidAmount <= 0
                      ? 'text-emerald-300'
                      : 'text-amber-100',
                  )}
                >
                  ${Math.max(0, cartTotal - paidAmount).toFixed(2)}
                </div>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between gap-2 pb-2">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => void createQuote()}
                disabled={cart.length === 0 || !shift}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-xl border px-3.5 text-[11.5px] font-bold uppercase tracking-wider transition',
                  cart.length === 0 || !shift
                    ? 'cursor-not-allowed border-slate-700 bg-[#0b2641]/50 text-slate-500 opacity-60'
                    : 'border-violet-500/40 bg-violet-500/10 text-violet-200 hover:bg-violet-500/20 hover:text-violet-100',
                )}
                style={{ height: '40px' }}
              >
                <FileText className="h-4 w-4" />
                Cotización
              </button>

              <button
                type="button"
                onClick={() => void createOwnUse()}
                disabled={cart.length === 0 || !shift || processingPayment}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-xl border px-3.5 text-[11.5px] font-bold uppercase tracking-wider transition',
                  cart.length === 0 || !shift || processingPayment
                    ? 'cursor-not-allowed border-slate-700 bg-[#0b2641]/50 text-slate-500 opacity-60'
                    : 'border-teal-500/40 bg-teal-500/10 text-teal-200 hover:bg-teal-500/20 hover:text-teal-100',
                )}
                style={{ height: '40px' }}
                title="Descuenta los productos del stock para uso interno, sin cobro"
              >
                <PackageCheck className="h-4 w-4" />
                Uso propio
              </button>

              <button
                type="button"
                onClick={() => {
                  const current = discount || 0
                  const subtotal = cartSubtotal
                  if (current > 0 && subtotal > 0) {
                    const pct = Math.round((current / subtotal) * 10000) / 100
                    if (Math.abs(pct - Math.round(pct)) < 0.05 && pct > 0 && pct < 100) {
                      setPromoMode('percent')
                      setPromoValue(String(pct))
                    } else {
                      setPromoMode('amount')
                      setPromoValue(String(current))
                    }
                  } else {
                    setPromoMode('percent')
                    setPromoValue('')
                  }
                  setPromoFormProductId('')
                  setPromoFormProductSearch('')
                  setPromoSearch('')
                  setVolumeRows([])
                  setVolumeError('')
                  setPromoView('list')
                  setPromoModal({ open: true })
                }}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-xl border px-3.5 text-[11.5px] font-bold uppercase tracking-wider transition',
                  discount > 0
                    ? 'border-amber-400/50 bg-amber-400/15 text-amber-200 hover:bg-amber-400/25'
                    : 'border-[#1a3a5a] bg-[#0b2641] text-slate-300 hover:border-amber-400/40 hover:text-amber-200'
                )}
                style={{ height: '40px' }}
              >
                <Sparkles className="h-4 w-4" />
                Promociones
                {discount > 0 ? (
                  <span className="rounded-full bg-amber-400/20 px-1.5 py-0.5 text-[9.5px] font-extrabold">
                    -${discount.toFixed(2)}
                  </span>
                ) : null}
              </button>

              <button
                type="button"
                title="Recargar catálogo y promociones"
                onClick={() => {
                  void (async () => {
                    await loadCatalog('')
                    try { void loadFrequent() } catch {}
                    showToast('Catálogo actualizado')
                  })()
                }}
                disabled={catalogLoading}
                className={cn(
                  'inline-flex items-center justify-center rounded-xl border border-[#1a3a5a] bg-[#0b2641] text-slate-300 transition disabled:opacity-60 disabled:cursor-not-allowed hover:border-[#1090D0]/40 hover:text-[#5bbfe5] hover:bg-[#1090D0]/10'
                )}
                style={{ height: '40px', width: '40px' }}
              >
                <RefreshCw className={cn('h-4 w-4', catalogLoading && 'animate-spin text-[#1090D0]')} />
              </button>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => {
                  setPayModalAmount(0)
                  setPayModalCategory('servicios')
                  setPayModalReason('')
                  setPayModal({ open: true })
                }}
                disabled={!shift}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-xl border px-3.5 text-[11.5px] font-bold uppercase tracking-wider transition',
                  !shift
                    ? 'cursor-not-allowed border-slate-700 bg-[#0b2641]/50 text-slate-500 opacity-60'
                    : 'border-sky-500/40 bg-sky-500/10 text-sky-200 hover:bg-sky-500/20 hover:text-sky-100',
                )}
                style={{ height: '40px' }}
              >
                <ReceiptText className="h-4 w-4" />
                Pagos
              </button>

              <button
                type="button"
                onClick={() => {
                  setWithdrawAmount(0)
                  setWithdrawReason('')
                  setWithdrawBusinessExpense(false)
                  setWithdrawModal({ open: true })
                }}
                disabled={!shift}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-xl border px-3.5 text-[11.5px] font-bold uppercase tracking-wider transition',
                  !shift
                    ? 'cursor-not-allowed border-slate-700 bg-[#0b2641]/50 text-slate-500 opacity-60'
                    : 'border-rose-500/40 bg-rose-500/10 text-rose-200 hover:bg-rose-500/20 hover:text-rose-100',
                )}
                style={{ height: '40px' }}
              >
                <LogOut className="h-4 w-4" />
                Retiro
              </button>

              <button
                type="button"
                onClick={openCheckout}
                disabled={cart.length === 0 || !shift}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-xl px-4 text-[11.5px] font-bold uppercase tracking-wider text-white shadow-[0_6px_20px_-8px_rgba(16,144,208,0.9)] transition',
                  cart.length === 0 || !shift
                    ? 'cursor-not-allowed bg-[#1090D0]/40 opacity-60'
                    : 'bg-gradient-to-br from-[#1090D0] to-[#0c79ae] hover:from-[#0ec0f0] hover:to-[#1090D0] active:scale-[0.98]',
                )}
                style={{ height: '40px' }}
              >
                <CreditCard className="h-4 w-4" />
                Cobrar
              </button>
            </div>
          </div>
        </div>

        <aside className="hidden min-h-0 w-full shrink-0 flex-col overflow-hidden border-l border-[#1a3a5a] bg-[#0e2d4c] lg:flex">
          <div className="flex h-9 items-center justify-between border-b border-[#1a3a5a] px-2.5">
            <div className="flex items-center gap-1.5">
              <TrendingUp className="h-3.5 w-3.5 text-[#5bbfe5]" />
              <span className="text-[10.5px] font-bold uppercase tracking-wider text-slate-200">
                Frecuentes
              </span>
            </div>
            <button
              type="button"
              onClick={() => void loadFrequent()}
              disabled={frequentLoading}
              className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 transition hover:bg-[#0b2641] hover:text-[#5bbfe5]"
            >
              <svg
                className={cn('h-3 w-3', frequentLoading && 'animate-spin text-[#1090D0]')}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
                <path d="M21 3v5h-5" />
                <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
                <path d="M8 16H3v5" />
              </svg>
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-2 space-y-1.5 tech-scrollbar">
            {frequentLoading && frequent.length === 0 ? (
              <div className="py-8 text-center text-[10.5px] text-slate-400">
                Cargando frecuentes...
              </div>
            ) : frequent.length === 0 ? (
              <div className="rounded-xl border border-dashed border-[#2a5589] bg-white/[0.02] px-3 py-6 text-center">
                <div className="mx-auto mb-2 flex h-9 w-9 items-center justify-center rounded-lg bg-[#0b2641] text-slate-500">
                  <Package className="h-4.5 w-4.5" />
                </div>
                <p className="text-[10.5px] font-semibold text-slate-300">
                  Sin productos frecuentes
                </p>
                <p className="mt-1 text-[9.5px] leading-relaxed text-slate-500">
                  Realiza ventas para ver tus artículos más vendidos.
                </p>
              </div>
            ) : (
              frequent.map((f) => (
                <button
                  key={f.itemId}
                  type="button"
                  onClick={() => addFrequentToCart(f)}
                  className="group relative flex w-full flex-col gap-1 rounded-xl border border-[#1a3a5a] bg-[#0f3151] p-2 text-left transition hover:border-[#1090D0]/40 hover:bg-[#11385a]"
                  style={{ minHeight: '72px' }}
                >
                  <div className="flex items-start justify-between gap-1.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[11.5px] font-semibold text-slate-100 group-hover:text-white">
                        {f.name}
                      </p>
                      <p className="truncate text-[9.5px] text-slate-400">
                        {f.sku} · Stock {f.stock}
                      </p>
                    </div>
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#1090D0]/15 text-[#5bbfe5] opacity-80 transition group-hover:bg-[#1090D0] group-hover:text-white relative">
                      <Plus className="h-3.5 w-3.5" />
                      {itemQty > 1 ? (
                        <span className="pointer-events-none absolute -top-2 -right-2 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full border border-[#1a3a5a] bg-[#0b2641] px-1 text-[9px] font-extrabold text-[#5bbfe5] shadow-[0_2px_8px_rgba(0,0,0,0.35)]">
                          ×{itemQty}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-1.5">
                    <span className="inline-flex items-center gap-0.5 rounded-full border border-violet-500/30 bg-violet-500/10 px-1.5 py-0.5 text-[9px] font-bold text-violet-200">
                      <TrendingUp className="h-2 w-2" />
                      {f.qty}
                    </span>
                    <span className="font-mono text-[12px] font-extrabold text-[#5bbfe5]">
                      ${f.salePrice.toFixed(2)}
                    </span>
                  </div>
                </button>
              ))
            )}
          </div>
        </aside>
      </div>

      {toast ? (
        <div className="pointer-events-none fixed bottom-5 left-1/2 z-[120] -translate-x-1/2 rounded-xl border border-emerald-400/30 bg-emerald-500/95 px-3.5 py-2 text-[11.5px] font-bold text-white shadow-xl shadow-black/40">
          <span className="inline-flex items-center gap-1.5">
            <Check className="h-3.5 w-3.5" />
            {toast}
          </span>
        </div>
      ) : null}

      {error ? (
        <div className="fixed right-4 top-4 z-[120] flex items-start gap-2 rounded-xl border border-rose-500/40 bg-rose-500/95 px-3.5 py-2.5 text-[11.5px] font-semibold text-white shadow-xl shadow-black/40">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <div className="flex-1">{error}</div>
          <button
            type="button"
            onClick={() => setError('')}
            className="shrink-0 rounded-md p-0.5 hover:bg-white/15"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : null}

      {loadingShift ? null : openShiftModal?.open && !shift ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md overflow-hidden rounded-xl border border-[#1a3a5a] bg-[#0f3151] shadow-2xl shadow-black/60" style={{ maxHeight: '72%' }}>
            <div className="border-b border-[#1a3a5a] bg-gradient-to-r from-[#1090D0]/15 via-transparent to-transparent px-4 py-3.5">
              <div className="flex items-center gap-2.5">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#1090D0]/20 text-[#5bbfe5]">
                  <Clock className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-[15px] font-extrabold text-slate-50">Abrir turno</h3>
                  <p className="text-[11px] text-slate-400">
                    No hay un turno abierto. Inicia uno para poder vender.
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-3 p-4 overflow-y-auto">
              <div>
                <label className="mb-1 block text-[10.5px] font-extrabold uppercase tracking-wider text-slate-400">
                  Sucursal
                </label>
                <div className="flex items-center gap-2 rounded-lg border border-[#1a3a5a] bg-[#0b2641] px-3 py-2 focus-within:border-[#1090D0]/50">
                  <Building2 className="h-3.5 w-3.5 text-slate-400" />
                  <select
                    value={branchForShift}
                    onChange={(e) => setBranchForShift(e.target.value)}
                    className="flex-1 bg-transparent text-[12.5px] text-slate-100 focus:outline-none"
                  >
                    <option value="" className="bg-[#0f3151]">
                      Seleccionar...
                    </option>
                    {branches.map((b) => (
                      <option key={b.id} value={b.id} className="bg-[#0f3151]">
                        {b.name}
                        {b.isMain ? ' (Principal)' : ''}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="mb-1 block text-[10.5px] font-extrabold uppercase tracking-wider text-slate-400">
                  Efectivo inicial
                </label>
                <div className="flex items-center gap-2 rounded-lg border border-[#1a3a5a] bg-[#0b2641] px-3 py-2 focus-within:border-[#1090D0]/50">
                  <Wallet className="h-3.5 w-3.5 text-[#5bbfe5]" />
                  <span className="font-mono text-[13px] font-bold text-slate-300">$</span>
                  <input
                    type="number"
                    step="0.01"
                    min={0}
                    value={initialCash}
                    onChange={(e) => setInitialCash(Number(e.target.value) || 0)}
                    className="flex-1 bg-transparent font-mono text-[14px] font-bold text-slate-100 focus:outline-none"
                  />
                  <span className="rounded-md border border-[#1a3a5a] px-1.5 py-0.5 font-mono text-[10px] text-slate-400">
                    MXN
                  </span>
                </div>
                <div className="mt-1.5 grid grid-cols-4 gap-1">
                  {[500, 1000, 2500, 5000].map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setInitialCash(n)}
                      className="rounded-lg border border-[#1a3a5a] bg-[#0b2641]/60 px-2 py-1.5 font-mono text-[10.5px] font-semibold text-slate-300 transition hover:border-[#1090D0]/40 hover:text-[#5bbfe5]"
                    >
                      ${n}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-1.5 border-t border-[#1a3a5a] px-4 py-3">
              <button
                type="button"
                disabled={!branchForShift}
                onClick={() => void handleOpenShift()}
                className={cn(
                  'rounded-lg px-4 py-1.5 text-[11.5px] font-bold text-white transition w-full sm:w-auto',
                  !branchForShift
                    ? 'bg-[#1090D0]/40 opacity-60'
                    : 'bg-[#1090D0] hover:bg-[#0c79ae] shadow-[0_4px_14px_-4px_rgba(16,144,208,0.8)]',
                )}
              >
                <span className="inline-flex items-center justify-center gap-1">
                  <Check className="h-3.5 w-3.5" />
                  Abrir turno
                </span>
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {checkout ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg overflow-hidden rounded-xl border border-[#1a3a5a] bg-[#0f3151] shadow-2xl shadow-black/60 flex flex-col" style={{ maxHeight: '90vh' }}>
            <div className="flex items-center justify-between border-b border-[#1a3a5a] px-4 py-3 flex-shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#1090D0]/15 text-[#5bbfe5]">
                  <CreditCard className="h-4.5 w-4.5" />
                </div>
                <div>
                  <h3 className="text-[14px] font-extrabold text-slate-50">Cobrar venta</h3>
                  <p className="text-[10.5px] text-slate-400">
                    {customerName || 'Cliente mostrador'} · {cart.length} artículo
                    {cart.length === 1 ? '' : 's'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setCheckout(null)}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition hover:bg-[#0b2641] hover:text-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-3 p-4 overflow-y-auto min-h-0 flex-1">
              <div className={cn(
                'grid gap-1.5 rounded-xl border border-[#1a3a5a] bg-[#0b2641]/60 p-1.5 text-[10.5px]',
                ivaEnabledCalc ? 'grid-cols-3' : 'grid-cols-2',
              )}>
                <div className="rounded-lg px-2.5 py-1.5">
                  <div className="text-[9px] font-bold uppercase tracking-wider text-slate-400">
                    Subtotal
                  </div>
                  <div className="font-mono text-[13px] font-bold text-slate-100">
                    ${checkout.subtotal.toFixed(2)}
                  </div>
                </div>
                {ivaEnabledCalc ? (
                  <div className="rounded-lg px-2.5 py-1.5">
                    <div className="text-[9px] font-bold uppercase tracking-wider text-slate-400">
                      IVA
                    </div>
                    <div className="font-mono text-[13px] font-bold text-emerald-200">
                      ${checkout.iva.toFixed(2)}
                    </div>
                  </div>
                ) : null}
                <div className="rounded-lg px-2.5 py-1.5">
                  <div className="text-[9px] font-bold uppercase tracking-wider text-slate-400">
                    Descuento
                  </div>
                  <div className="font-mono text-[13px] font-bold text-rose-200">
                    -${checkout.discount.toFixed(2)}
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between rounded-xl border border-[#1090D0]/60 bg-[#1090D0]/15 px-3.5 py-2.5">
                <span className="text-[11px] font-extrabold uppercase tracking-wider text-[#8fd2ec]">
                  Total a cobrar
                </span>
                <span className="font-mono text-[22px] font-extrabold text-white drop-shadow-[0_0_6px_rgba(16,144,208,0.5)]">
                  ${checkout.total.toFixed(2)}
                </span>
              </div>

              <div>
                <label className="mb-1.5 block text-[10.5px] font-extrabold uppercase tracking-wider text-slate-400">
                  Método de pago
                </label>
                <div className="grid grid-cols-4 gap-1 rounded-xl border border-[#1a3a5a] bg-[#0b2641] p-1">
                  {(
                    [
                      { id: 'cash', label: 'Efectivo', icon: Banknote },
                      { id: 'card', label: 'Tarjeta', icon: CreditCard },
                      { id: 'transfer', label: 'Transfer', icon: Send },
                      { id: 'mixed', label: 'Mixto', icon: Wallet },
                    ] as Array<{ id: PaymentMethod | 'mixed'; label: string; icon: any }>
                  ).map((opt) => {
                    const Icon = opt.icon
                    const active = opt.id === 'mixed' ? mixedMode : !mixedMode && payMethod === opt.id
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => {
                          if (opt.id === 'mixed') {
                            setMixedMode(true)
                          } else {
                            setMixedMode(false)
                            setPayMethod(opt.id)
                          }
                        }}
                        className={cn(
                          'flex flex-col items-center justify-center gap-0.5 rounded-lg px-2 py-2 text-[9.5px] font-bold transition',
                          active ? 'bg-[#1090D0] text-white shadow-inner' : 'text-slate-300 hover:text-white',
                        )}
                      >
                        <Icon className="h-4 w-4" />
                        <span className="whitespace-nowrap">{opt.label}</span>
                      </button>
                    )
                  })}
                </div>
              </div>

              {mixedMode ? (
                <div className="space-y-2 rounded-xl border border-[#1a3a5a] bg-[#0b2641]/60 p-3">
                  {(
                    [
                      { key: 'cash', label: 'Efectivo', icon: Banknote },
                      { key: 'card', label: 'Tarjeta', icon: CreditCard },
                      { key: 'transfer', label: 'Transferencia', icon: Send },
                    ] as Array<{ key: 'cash' | 'card' | 'transfer'; label: string; icon: any }>
                  ).map((f) => {
                    const Icon = f.icon
                    return (
                      <div key={f.key} className="flex items-center gap-2">
                        <span className="flex w-28 items-center gap-1.5 text-[11px] font-bold text-slate-300">
                          <Icon className="h-3.5 w-3.5 text-[#5bbfe5]" />
                          {f.label}
                        </span>
                        <div className="flex flex-1 items-center gap-1.5 rounded-lg border border-[#1a3a5a] bg-[#0b2641] px-2.5 py-1.5 focus-within:border-[#1090D0]/50">
                          <span className="font-mono text-[12px] font-bold text-slate-400">$</span>
                          <input
                            type="number"
                            step="0.01"
                            min={0}
                            placeholder="0.00"
                            value={mixAmounts[f.key]}
                            onChange={(e) => setMixAmounts((prev) => ({ ...prev, [f.key]: e.target.value }))}
                            aria-label={`Monto en ${f.label}`}
                            className="w-full bg-transparent font-mono text-[14px] font-bold text-slate-100 placeholder:text-slate-600 focus:outline-none"
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            const others = mixPaid - (Number(mixAmounts[f.key]) || 0)
                            const fill = Math.max(0, Number((checkout.total - others).toFixed(2)))
                            setMixAmounts((prev) => ({ ...prev, [f.key]: fill > 0 ? String(fill) : '' }))
                          }}
                          className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[9px] font-bold text-emerald-200 hover:bg-emerald-500/20"
                          title="Poner aquí lo que falta"
                        >
                          Resto
                        </button>
                      </div>
                    )
                  })}
                  <div className="flex items-center justify-between rounded-lg border border-[#1a3a5a] bg-[#0f3151] px-3 py-2 text-[11px]">
                    <span className="font-bold uppercase tracking-wider text-slate-400">
                      {mixRemaining < 0 ? 'Cambio' : 'Restante por cobrar'}
                    </span>
                    <span
                      className={cn(
                        'font-mono text-[16px] font-extrabold',
                        mixRemaining < 0 ? 'text-emerald-300' : mixRemaining === 0 ? 'text-emerald-300' : 'text-amber-200',
                      )}
                    >
                      ${Math.abs(mixRemaining).toFixed(2)}
                    </span>
                  </div>
                  {mixNonCashOver ? (
                    <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-2.5 py-1.5 text-[11px] text-rose-200">
                      Tarjeta y transferencia no pueden superar el total a cobrar.
                    </div>
                  ) : mixRemaining < 0 && mixCash <= 0 ? (
                    <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-2.5 py-1.5 text-[11px] text-rose-200">
                      Solo el efectivo puede generar cambio.
                    </div>
                  ) : mixRemaining > 0 && mixPaid > 0 ? (
                    <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-200">
                      Pago parcial: la venta quedará con saldo pendiente.
                    </div>
                  ) : null}
                </div>
              ) : null}

              {!mixedMode ? (
              <div>
                <label className="mb-1 block text-[10.5px] font-extrabold uppercase tracking-wider text-slate-400">
                  Paga con:
                </label>
                <div className="flex items-center gap-2 rounded-lg border border-[#1a3a5a] bg-[#0b2641] px-3 py-2 focus-within:border-[#1090D0]/50">
                  <Wallet className="h-3.5 w-3.5 text-[#5bbfe5]" />
                  <span className="font-mono text-[13px] font-bold text-slate-300">$</span>
                  <input
                    type="number"
                    step="0.01"
                    min={0}
                    value={paymentAmount}
                    onChange={(e) => setPaymentAmount(Number(e.target.value) || 0)}
                    className="flex-1 bg-transparent font-mono text-[15px] font-bold text-slate-100 focus:outline-none"
                  />
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  <button
                    type="button"
                    onClick={() => setPaymentAmount(checkout.total)}
                    className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[9.5px] font-bold text-emerald-200 transition hover:bg-emerald-500/20"
                  >
                    Pago exacto
                  </button>
                  {payMethod === 'cash'
                    ? [20, 50, 100, 200, 500, 1000].map((bill) => (
                        <button
                          key={bill}
                          type="button"
                          onClick={() => setPaymentAmount(bill)}
                          className="rounded-lg border border-[#1a3a5a] bg-[#0b2641] px-2 py-1 font-mono text-[9.5px] font-bold text-slate-300 transition hover:border-[#1090D0]/40 hover:text-[#5bbfe5]"
                        >
                          ${bill}
                        </button>
                      ))
                    : null}
                </div>
                {paymentAmount > checkout.total ? (
                  <div className="mt-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1.5 text-[11px] text-emerald-200">
                    Cambio:{' '}
                    <span className="font-mono font-bold">
                      ${(paymentAmount - checkout.total).toFixed(2)}
                    </span>
                  </div>
                ) : paymentAmount < checkout.total && paymentAmount > 0 ? (
                  <div className="mt-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-200">
                    Pago parcial. Pendiente:{' '}
                    <span className="font-mono font-bold">
                      ${(checkout.total - paymentAmount).toFixed(2)}
                    </span>
                  </div>
                ) : null}
              </div>
              ) : null}
            </div>

            <div className="flex flex-wrap items-center justify-end gap-1.5 border-t border-[#1a3a5a] px-4 py-3 flex-shrink-0">
              <button
                type="button"
                disabled={processingPayment}
                onClick={() => void createOwnUse()}
                className="mr-auto inline-flex items-center gap-1 rounded-lg border border-teal-500/40 bg-teal-500/10 px-3 py-1.5 text-[11.5px] font-bold text-teal-200 transition hover:bg-teal-500/20 disabled:opacity-50"
                title="Descuenta del stock para uso interno, sin cobro"
              >
                <PackageCheck className="h-3.5 w-3.5" />
                Uso propio
              </button>
              <button
                type="button"
                onClick={() => setCheckout(null)}
                className="rounded-lg border border-[#1a3a5a] bg-[#11375a] px-3.5 py-1.5 text-[11.5px] font-semibold text-slate-200 transition hover:border-[#1090D0]/40 hover:text-white"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={processingPayment}
                onClick={() => void confirmPayment()}
                className={cn(
                  'rounded-lg px-4 py-1.5 text-[11.5px] font-bold text-white transition',
                  processingPayment
                    ? 'bg-[#1090D0]/50 opacity-60'
                    : 'bg-[#1090D0] hover:bg-[#0c79ae] shadow-[0_4px_14px_-4px_rgba(16,144,208,0.8)]',
                )}
              >
                <span className="inline-flex items-center gap-1">
                  {processingPayment ? (
                    <>
                      <svg
                        className="h-3.5 w-3.5 animate-spin"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                      >
                        <path d="M21 12a9 9 0 1 1-6.219-8.56" strokeLinecap="round" />
                      </svg>
                      Procesando...
                    </>
                  ) : (
                    <>
                      <Check className="h-3.5 w-3.5" />
                      Confirmar pago
                    </>
                  )}
                </span>
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {withdrawModal?.open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md overflow-hidden rounded-xl border border-rose-500/30 bg-[#0f3151] shadow-2xl shadow-black/60" style={{ maxHeight: '72%' }}>
            <div className="border-b border-[#1a3a5a] bg-gradient-to-r from-rose-500/10 via-transparent to-transparent px-4 py-3.5">
              <div className="flex items-center gap-2.5">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-rose-500/15 text-rose-300">
                  <LogOut className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-[14px] font-extrabold text-slate-50">Retiro de efectivo</h3>
                  <p className="text-[10.5px] text-slate-400">
                    Turno {shift?.id?.slice(-8) || ''} · Cajero {shift?.userEmail || ''}
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-3 p-4 overflow-y-auto">
              <label className="flex items-start gap-2.5 rounded-xl border border-[#1a3a5a] bg-[#0b2641] px-3.5 py-2.5 transition hover:border-emerald-500/30">
                <input
                  type="checkbox"
                  checked={withdrawBusinessExpense}
                  onChange={(e) => setWithdrawBusinessExpense(e.target.checked)}
                  className="mt-0.5 h-3.5 w-3.5 accent-emerald-500"
                />
                <div>
                  <div className="text-[11px] font-extrabold uppercase tracking-wider text-slate-200">
                    Gasto de empresa
                  </div>
                  <div className="text-[10px] text-slate-400">
                    Insumos, sueldos, pago proveedores, etc.
                  </div>
                </div>
              </label>

              <div>
                <label className="mb-1 block text-[10.5px] font-extrabold uppercase tracking-wider text-slate-400">
                  Monto a retirar
                </label>
                <div className="flex items-center gap-2 rounded-lg border border-[#1a3a5a] bg-[#0b2641] px-3 py-2 focus-within:border-rose-500/40">
                  <Wallet className="h-3.5 w-3.5 text-rose-300" />
                  <span className="font-mono text-[13px] font-bold text-slate-300">$</span>
                  <input
                    type="number"
                    step="0.01"
                    min={0}
                    value={withdrawAmount || ''}
                    onChange={(e) => setWithdrawAmount(Number(e.target.value) || 0)}
                    placeholder="0.00"
                    className="flex-1 bg-transparent font-mono text-[15px] font-bold text-slate-100 placeholder:text-slate-500 focus:outline-none"
                  />
                  <span className="rounded-md border border-[#1a3a5a] px-1.5 py-0.5 font-mono text-[10px] text-slate-400">
                    MXN
                  </span>
                </div>
                <div className="mt-1.5 grid grid-cols-4 gap-1">
                  {[100, 500, 1000, 2500].map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setWithdrawAmount(n)}
                      className="rounded-lg border border-[#1a3a5a] bg-[#0b2641]/60 px-2 py-1.5 font-mono text-[10.5px] font-semibold text-slate-300 transition hover:border-rose-500/30 hover:text-rose-200"
                    >
                      ${n}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="mb-1 block text-[10.5px] font-extrabold uppercase tracking-wider text-slate-400">
                  Motivo
                </label>
                <div className="rounded-lg border border-[#1a3a5a] bg-[#0b2641] px-3 py-2 focus-within:border-rose-500/40">
                  <input
                    type="text"
                    value={withdrawReason}
                    onChange={(e) => setWithdrawReason(e.target.value)}
                    placeholder="Ej. Pago proveedor, sueldo, gasolina..."
                    className="w-full bg-transparent text-[12.5px] text-slate-100 placeholder:text-slate-500 focus:outline-none"
                  />
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-1.5 border-t border-[#1a3a5a] px-4 py-3">
              <button
                type="button"
                onClick={() => setWithdrawModal(null)}
                className="rounded-lg border border-[#1a3a5a] bg-[#11375a] px-3.5 py-1.5 text-[11.5px] font-semibold text-slate-200 transition hover:border-[#1090D0]/40 hover:text-white"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={!withdrawAmount || processingWithdraw}
                onClick={() => void confirmWithdraw()}
                className={cn(
                  'rounded-lg px-4 py-1.5 text-[11.5px] font-bold text-white transition',
                  !withdrawAmount || processingWithdraw
                    ? 'bg-rose-500/40 opacity-60'
                    : 'bg-rose-500 hover:bg-rose-600 shadow-[0_4px_14px_-4px_rgba(244,63,94,0.8)]',
                )}
              >
                <span className="inline-flex items-center gap-1">
                  {processingWithdraw ? (
                    <>
                      <svg
                        className="h-3.5 w-3.5 animate-spin"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                      >
                        <path d="M21 12a9 9 0 1 1-6.219-8.56" strokeLinecap="round" />
                      </svg>
                      Procesando...
                    </>
                  ) : (
                    <>
                      <Check className="h-3.5 w-3.5" />
                      Guardar retiro
                    </>
                  )}
                </span>
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {payModal?.open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md overflow-hidden rounded-xl border border-sky-500/30 bg-[#0f3151] shadow-2xl shadow-black/60" style={{ maxHeight: '72%' }}>
            <div className="border-b border-[#1a3a5a] bg-gradient-to-r from-sky-500/10 via-transparent to-transparent px-4 py-3.5">
              <div className="flex items-center gap-2.5">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-500/15 text-sky-300">
                  <ReceiptText className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-[14px] font-extrabold text-slate-50">Registrar Pago / Gasto</h3>
                  <p className="text-[10.5px] text-slate-400">
                    Turno {shift?.id?.slice(-8) || ''} · Cajero {shift?.userEmail || ''}
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-3 p-4 overflow-y-auto">
              <div>
                <label className="mb-1 block text-[10.5px] font-extrabold uppercase tracking-wider text-slate-400">
                  Categoría
                </label>
                <div className="grid grid-cols-3 gap-1">
                  {([
                    { id: 'servicios', label: 'Servicios' },
                    { id: 'luz', label: 'Luz' },
                    { id: 'agua', label: 'Agua' },
                    { id: 'internet', label: 'Internet' },
                    { id: 'comida', label: 'Comida' },
                    { id: 'proveedor', label: 'Proveedor' },
                    { id: 'sueldo', label: 'Sueldo' },
                    { id: 'gasolina', label: 'Gasolina' },
                    { id: 'otro', label: 'Otro' },
                  ] as Array<{ id: string; label: string }>).map((cat) => (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => setPayModalCategory(cat.id)}
                      className={cn(
                        'rounded-lg border px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider transition',
                        payModalCategory === cat.id
                          ? 'border-sky-500/50 bg-sky-500/15 text-sky-200 shadow-inner'
                          : 'border-[#1a3a5a] bg-[#0b2641]/60 text-slate-400 hover:text-sky-200 hover:border-sky-500/30',
                      )}
                    >
                      {cat.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="mb-1 block text-[10.5px] font-extrabold uppercase tracking-wider text-slate-400">
                  Monto del pago
                </label>
                <div className="flex items-center gap-2 rounded-lg border border-[#1a3a5a] bg-[#0b2641] px-3 py-2 focus-within:border-sky-500/40">
                  <Wallet className="h-3.5 w-3.5 text-sky-300" />
                  <span className="font-mono text-[13px] font-bold text-slate-300">$</span>
                  <input
                    type="number"
                    step="0.01"
                    min={0}
                    value={payModalAmount || ''}
                    onChange={(e) => setPayModalAmount(Number(e.target.value) || 0)}
                    placeholder="0.00"
                    className="flex-1 bg-transparent font-mono text-[15px] font-bold text-slate-100 placeholder:text-slate-500 focus:outline-none"
                  />
                  <span className="rounded-md border border-[#1a3a5a] px-1.5 py-0.5 font-mono text-[10px] text-slate-400">
                    MXN
                  </span>
                </div>
                <div className="mt-1.5 grid grid-cols-4 gap-1">
                  {[100, 200, 500, 1000].map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setPayModalAmount(n)}
                      className="rounded-lg border border-[#1a3a5a] bg-[#0b2641]/60 px-2 py-1.5 font-mono text-[10.5px] font-semibold text-slate-300 transition hover:border-sky-500/30 hover:text-sky-200"
                    >
                      ${n}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="mb-1 block text-[10.5px] font-extrabold uppercase tracking-wider text-slate-400">
                  Notas / Detalle
                </label>
                <div className="rounded-lg border border-[#1a3a5a] bg-[#0b2641] px-3 py-2 focus-within:border-sky-500/40">
                  <input
                    type="text"
                    value={payModalReason}
                    onChange={(e) => setPayModalReason(e.target.value)}
                    placeholder="Ej. Recibo CFE, comida 3 personas..."
                    className="w-full bg-transparent text-[12.5px] text-slate-100 placeholder:text-slate-500 focus:outline-none"
                  />
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-1.5 border-t border-[#1a3a5a] px-4 py-3">
              <button
                type="button"
                onClick={() => setPayModal(null)}
                className="rounded-lg border border-[#1a3a5a] bg-[#11375a] px-3.5 py-1.5 text-[11.5px] font-semibold text-slate-200 transition hover:border-[#1090D0]/40 hover:text-white"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={!payModalAmount || processingPayModal}
                onClick={() => void confirmPay()}
                className={cn(
                  'rounded-lg px-4 py-1.5 text-[11.5px] font-bold text-white transition',
                  !payModalAmount || processingPayModal
                    ? 'bg-sky-500/40 opacity-60'
                    : 'bg-sky-500 hover:bg-sky-600 shadow-[0_4px_14px_-4px_rgba(14,165,233,0.8)]',
                )}
              >
                <span className="inline-flex items-center gap-1">
                  {processingPayModal ? (
                    <>
                      <svg
                        className="h-3.5 w-3.5 animate-spin"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                      >
                        <path d="M21 12a9 9 0 1 1-6.219-8.56" strokeLinecap="round" />
                      </svg>
                      Procesando...
                    </>
                  ) : (
                    <>
                      <Check className="h-3.5 w-3.5" />
                      Registrar pago
                    </>
                  )}
                </span>
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {closeShiftModal?.open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-3xl max-h-[92vh] overflow-hidden rounded-2xl border border-amber-500/30 bg-[#0f3151] shadow-2xl shadow-black/60 flex flex-col">
            <div className="flex items-center justify-between border-b border-[#1a3a5a] bg-gradient-to-r from-amber-500/10 via-transparent to-transparent px-5 py-4 flex-shrink-0">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px] bg-amber-500/15 text-amber-300">
                  <Clock className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-[16px] font-bold text-slate-50">Cerrar turno · Resumen</h3>
                  <p className="mt-0.5 text-[11.5px] text-slate-400">
                    {shift?.openedAt ? `Abierto desde ${new Date(shift.openedAt).toLocaleString()} · Cajero: ${shift.userEmail || ''}` : ''}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setCloseShiftModal(null)}
                className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-400 transition hover:bg-[#0b2641] hover:text-slate-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-4 p-5 overflow-y-auto tech-scrollbar flex-1 min-h-0">
              <div className="rounded-[14px] border border-amber-500/20 bg-amber-500/5 px-4 py-3">
                <p className="text-[12.5px] leading-relaxed text-slate-200">
                  <span className="font-bold text-amber-300">⚠️ Aviso:</span> revisa los totales, genera el reporte PDF (Imprimir) y luego cierra el turno. Una vez cerrado ya no se podrán registrar ventas ni movimientos.
                </p>
              </div>

              {shift ? (
                <div className="grid grid-cols-2 gap-2 text-[11.5px] md:grid-cols-4">
                  <div className="rounded-[12px] border border-[#1a3a5a] bg-[#0b2641] px-3 py-2.5">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Efectivo inicial</div>
                    <div className="mt-0.5 font-mono text-[14px] font-bold text-slate-100">
                      ${Number(shift.initialCash || 0).toFixed(2)}
                    </div>
                  </div>
                  <div className="rounded-[12px] border border-[#1a3a5a] bg-[#0b2641] px-3 py-2.5">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Total Ventas</div>
                    <div className="mt-0.5 font-mono text-[14px] font-bold text-emerald-300">
                      ${Number(shift.salesTotal || 0).toFixed(2)}
                      <span className="ml-1 text-[10px] font-semibold text-slate-400">#{shift.salesCount || 0}</span>
                    </div>
                  </div>
                  <div className="rounded-[12px] border border-[#1a3a5a] bg-[#0b2641] px-3 py-2.5">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Retiros</div>
                    <div className="mt-0.5 font-mono text-[14px] font-bold text-rose-300">
                      -${totalWithdrawals.toFixed(2)}
                    </div>
                  </div>
                  <div className="rounded-[12px] border border-[#1a3a5a] bg-[#0b2641] px-3 py-2.5">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Pagos / Gastos</div>
                    <div className="mt-0.5 font-mono text-[14px] font-bold text-sky-300">
                      -${totalPayments.toFixed(2)}
                    </div>
                  </div>
                  <div className="rounded-[12px] border border-[#1a3a5a] bg-[#0b2641] px-3 py-2.5">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-400/80">Venta Efectivo</div>
                    <div className="mt-0.5 font-mono text-[14px] font-bold text-emerald-200">
                      ${(paymentsByMethodMap.cash || 0).toFixed(2)}
                    </div>
                  </div>
                  <div className="rounded-[12px] border border-[#1a3a5a] bg-[#0b2641] px-3 py-2.5">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-indigo-400/80">Venta Tarjeta</div>
                    <div className="mt-0.5 font-mono text-[14px] font-bold text-indigo-200">
                      ${(paymentsByMethodMap.card || 0).toFixed(2)}
                    </div>
                  </div>
                  <div className="rounded-[12px] border border-[#1a3a5a] bg-[#0b2641] px-3 py-2.5">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-cyan-400/80">Venta Transferencia</div>
                    <div className="mt-0.5 font-mono text-[14px] font-bold text-cyan-200">
                      ${(paymentsByMethodMap.transfer || 0).toFixed(2)}
                    </div>
                  </div>
                  <div className="rounded-[12px] border border-emerald-500/30 bg-emerald-500/10 px-3 py-2.5">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-400">Efectivo Est. Caja</div>
                    <div className="mt-0.5 font-mono text-[14px] font-bold text-emerald-100">
                      ${(Number(shift.initialCash || 0) + (paymentsByMethodMap.cash || 0) - totalWithdrawals - totalPayments).toFixed(2)}
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#1a3a5a] px-5 py-4 flex-shrink-0">
              <button
                type="button"
                onClick={() => printShiftReport()}
                disabled={!shift}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-[14px] px-4 py-2 text-[12px] font-bold text-white transition',
                  !shift ? 'opacity-50 cursor-not-allowed' : '',
                  'bg-[#1090D0] hover:bg-[#0f7fba] shadow-[0_4px_14px_-4px_rgba(16,144,208,0.7)]',
                )}
              >
                <Printer className="h-4 w-4" />
                Imprimir / Descargar PDF
              </button>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setCloseShiftModal(null)}
                  className="rounded-[14px] border border-[#1a3a5a] bg-[#11375a] px-4 py-2 text-[12.5px] font-semibold text-slate-200 transition hover:border-[#1090D0]/40 hover:text-white"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={!shift || processingCloseShift}
                  onClick={() => void confirmCloseShift()}
                  className={cn(
                    'rounded-[14px] px-5 py-2 text-[12.5px] font-bold text-white transition',
                    !shift || processingCloseShift
                      ? 'bg-amber-500/40 opacity-60'
                      : 'bg-amber-500 hover:bg-amber-600 shadow-[0_4px_14px_-4px_rgba(245,158,11,0.7)]',
                  )}
                >
                  <span className="inline-flex items-center gap-2">
                    {processingCloseShift ? (
                      <>
                        <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <path d="M21 12a9 9 0 1 1-6.219-8.56" strokeLinecap="round" />
                        </svg>
                        Cerrando...
                      </>
                    ) : (
                      <>
                        <Check className="h-4 w-4" />
                        Sí, cerrar turno
                      </>
                    )}
                  </span>
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
      {promoModal?.open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-5xl max-h-[92vh] overflow-hidden rounded-2xl border border-[#1a3a5a] bg-[#0f3151] shadow-2xl shadow-black/60 flex flex-col">
            <div className="flex items-center justify-between border-b border-[#1a3a5a] bg-gradient-to-r from-amber-500/12 via-transparent to-transparent px-5 py-4 flex-shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px] bg-amber-500/15 text-amber-300 border border-amber-400/30">
                  <Sparkles className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-[16px] font-bold text-slate-50">
                    {promoView === 'list' ? 'Promociones'
                      : promoView === 'ticket' ? 'Descuento del ticket'
                        : promoView === 'groups' ? 'Grupos de productos'
                          : promoView === 'group_form' ? (groupForm.id ? 'Editar grupo promoción' : 'Nuevo grupo de promoción')
                            : promoFormProductId ? 'Editar promoción' : 'Nueva promoción'}
                  </h3>
                  <p className="mt-0.5 text-[11.5px] text-slate-400 truncate">
                    {promoView === 'list' ? 'Promociones por cantidad guardadas (1 producto). Clic en una para editar o crea una nueva.'
                      : promoView === 'ticket' ? 'Aplica un % o un monto de descuento a TODO el carrito actual.'
                        : promoView === 'groups' ? 'Agrupa varios productos y aplica promociones por volumen (ej: 3 viales Stayve por $240 c/u).'
                          : promoView === 'group_form' ? 'Elige productos y define rangos de precio para TODO el grupo.'
                            : 'Elige un producto y define sus rangos de precio por cantidad.'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {(promoView === 'form' || promoView === 'group_form') ? (
                  <button type="button" onClick={() => {
                    if (promoView === 'form') setPromoView('list')
                    else closeGroupForm()
                    setVolumeError('')
                  }}
                    className="rounded-xl border border-[#1a3a5a] bg-[#11375a] px-3 py-2 text-[11px] font-semibold text-slate-200 transition hover:border-[#1090D0]/40 hover:text-white flex items-center gap-1">
                    ← {promoView === 'form' ? 'Todas promociones individuales' : 'Volver a grupos'}
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => setPromoModal(null)}
                  className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-400 transition hover:bg-[#0b2641] hover:text-slate-100"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            {/* ===== TABS: Individuales / Ticket / Grupos ===== */}
            {(promoView === 'list' || promoView === 'ticket' || promoView === 'groups') ? (
              <div className="flex flex-wrap items-center gap-2 border-b border-[#1a3a5a] px-5 py-2.5 flex-shrink-0 bg-[#0b2641]/40">
                <button type="button" onClick={() => setPromoView('list')}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-[12px] px-3.5 py-2 text-[11.5px] font-bold uppercase tracking-wider transition',
                    promoView === 'list'
                      ? 'bg-[#1090D0]/20 text-[#7fd2ff] shadow-[inset_0_0_0_1px_rgba(16,144,208,0.35)]'
                      : 'text-slate-400 hover:bg-white/[0.03] hover:text-slate-200',
                  )}>
                  <Sparkles className="h-3.5 w-3.5" />
                  1 producto
                </button>
                <button type="button" onClick={() => setPromoView('ticket')}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-[12px] px-3.5 py-2 text-[11.5px] font-bold uppercase tracking-wider transition',
                    promoView === 'ticket'
                      ? 'bg-amber-500/20 text-amber-200 shadow-[inset_0_0_0_1px_rgba(245,158,11,0.35)]'
                      : (discount > 0 ? 'text-amber-200' : 'text-slate-400 hover:bg-white/[0.03] hover:text-slate-200')
                  )}>
                  <Percent className="h-3.5 w-3.5" />
                  Ticket
                  {discount > 0 ? (<span className="ml-1 rounded-full bg-amber-400/30 px-1.5 py-0.5 text-[9.5px] font-extrabold text-amber-100">-${discount.toFixed(2)}</span>) : null}
                </button>
                <button type="button" onClick={() => setPromoView('groups')}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-[12px] px-3.5 py-2 text-[11.5px] font-bold uppercase tracking-wider transition',
                    promoView === 'groups'
                      ? 'bg-cyan-500/20 text-cyan-200 shadow-[inset_0_0_0_1px_rgba(34,211,238,0.35)]'
                      : (promoGroups.some(g => g.active) ? 'text-cyan-200' : 'text-slate-400 hover:bg-white/[0.03] hover:text-slate-200')
                  )}>
                  <Tag className="h-3.5 w-3.5" />
                  Grupos productos
                  {promoGroups.filter(g => g.active).length > 0 ? (
                    <span className="ml-1 rounded-full bg-cyan-400/30 px-1.5 py-0.5 text-[9.5px] font-extrabold text-cyan-100">{promoGroups.filter(g => g.active).length}</span>
                  ) : null}
                </button>
              </div>
            ) : null}

            {/* ===== LISTA / GRID 3 cols: INDIVIDUALES ===== */}
            {promoView === 'list' ? (
              <>
                <div className="flex flex-wrap items-stretch gap-2 border-b border-[#1a3a5a] px-5 py-3 flex-shrink-0">
                  <div className="flex-1 min-w-[220px] flex items-center gap-2 rounded-[14px] border border-[#1a3a5a] bg-[#0b2641] px-3 py-2.5 focus-within:border-[#1090D0]/50">
                    <Search className="h-4 w-4 text-slate-400 shrink-0" />
                    <input type="text" value={promoSearch}
                      onChange={(e) => setPromoSearch(e.target.value)}
                      placeholder="Buscar promoción por producto, SKU o familia…"
                      className="flex-1 bg-transparent text-[12.5px] text-white placeholder:text-slate-500 focus:outline-none min-w-0" />
                  </div>
                  <button type="button"
                    disabled={syncFromDocsLoading}
                    onClick={() => {
                      void (async () => {
                        setSyncFromDocsLoading(true)
                        try {
                          const r = await posCatalogSyncFromDocs()
                          try {
                            const fresh = await posCatalog()
                            setCatalog(fresh.items)
                            if (fresh.promoGroups) setPromoGroups(fresh.promoGroups)
                            repriceCartForCatalog(fresh.items, fresh.promoGroups || promoGroups)
                          } catch {}
                          try { void loadFrequent() } catch {}
                          showToast(r.report || 'Sincronización completada')
                        } catch (e: any) {
                          setError(e?.message || 'No se pudo sincronizar desde documentos')
                        } finally {
                          setSyncFromDocsLoading(false)
                        }
                      })()
                    }}
                    className="inline-flex items-center gap-1.5 rounded-[14px] border border-emerald-500/40 bg-emerald-500/10 px-4 py-2.5 text-[11.5px] font-bold uppercase tracking-wider text-emerald-200 transition disabled:opacity-60 disabled:cursor-not-allowed hover:bg-emerald-500/20 hover:text-emerald-100 flex-shrink-0">
                    {syncFromDocsLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Database className="h-4 w-4" />}
                    {syncFromDocsLoading ? 'Sincronizando…' : 'Sync documentos'}
                  </button>
                  <button type="button" onClick={() => {
                    setPromoFormProductId('')
                    setPromoFormProductSearch('')
                    setVolumeRows([{ id: `r-${Date.now()}-1`, qty: '1', price: '' }])
                    setVolumeError('')
                    setPromoView('form')
                  }}
                    className="inline-flex items-center gap-1.5 rounded-[14px] bg-[#1090D0] hover:bg-[#0f7fba] shadow-[0_4px_14px_-4px_rgba(16,144,208,0.75)] px-4 py-2.5 text-[11.5px] font-bold uppercase tracking-wider text-white transition flex-shrink-0">
                    <Plus className="h-4 w-4" /> Nueva promoción
                  </button>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 tech-scrollbar">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {(() => {
                      const q = promoSearch.trim().toLowerCase()
                      const promos = catalog
                        .filter((c) => c.active && ((c.volumePriceTiers || []).length > 0 || (c.bundlePriceTiers || []).length > 0))
                        .filter((c) => !q ? true : [c.name, c.sku, c.family, c.category, (c.tags || []).join(' ')].join(' ').toLowerCase().includes(q))
                        .sort((a, b) => (b.updatedAt || b.createdAt).localeCompare(a.updatedAt || a.createdAt))
                      const cards: JSX.Element[] = []
                      for (const p of promos) {
                        const bundleTiers = p.bundlePriceTiers || []
                        const tiers = [
                          { minQty: 1, price: p.salePrice },
                          ...(p.volumePriceTiers || []).sort((a, b) => a.minQty - b.minQty),
                        ]
                        cards.push(
                          <div key={p.id} className="group relative overflow-hidden rounded-[18px] border border-[#1a3a5a] bg-[#0b2641] p-3.5 transition hover:-translate-y-0.5 hover:border-[#1090D0]/40 hover:shadow-[0_10px_30px_-12px_rgba(16,144,208,0.45)]">
                            <div className="mb-2.5 flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <p className="truncate text-[13px] font-bold leading-tight text-white">{p.name}</p>
                                <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                                  {p.sku ? <span className="font-mono text-[9.5px] text-slate-500 rounded-md border border-[#1a3a5a] bg-white/[0.02] px-1.5 py-0.5">{p.sku}</span> : null}
                                  <span className="inline-flex items-center gap-0.5 rounded-full border border-amber-400/30 bg-amber-400/10 px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-wider text-amber-200">
                                    🎁 {(p.volumePriceTiers || []).length + bundleTiers.length} rangos
                                  </span>
                                </div>
                              </div>
                              <div className="flex items-center gap-1.5 shrink-0">
                                <button type="button" title="Editar promoción"
                                  onClick={() => {
                                    setPromoFormProductId(p.id)
                                    setPromoFormProductSearch('')
                                    setVolumeError('')
                                    setVolumeRows(tiers.map((t, i) => ({
                                      id: `r-${p.id}-${t.minQty}-${i}`,
                                      qty: String(t.minQty),
                                      price: String(t.price),
                                    })))
                                    setPromoView('form')
                                  }}
                                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#1a3a5a] bg-[#0f3151] text-slate-300 transition hover:border-[#1090D0]/40 hover:bg-[#1090D0]/10 hover:text-[#7fd2ff] shadow">
                                  <RefreshCw className="h-3.5 w-3.5 -scale-x-100" />
                                </button>
                                <button type="button" title="Eliminar promoción (solo niveles)"
                                  onClick={() => setConfirmDeletePromo(p)}
                                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#1a3a5a] bg-[#0f3151] text-slate-400 transition hover:border-rose-500/40 hover:bg-rose-500/10 hover:text-rose-300 shadow">
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            </div>
                            <div className="space-y-1">
                              {tiers.map((t, i) => {
                                const pct = i > 0 && tiers[0].price > 0
                                  ? Math.max(0, Math.round((1 - t.price / tiers[0].price) * 100))
                                  : 0
                                const isBase = i === 0
                                return (
                                  <div key={`${p.id}-${t.minQty}-${i}`} className={cn(
                                    'flex items-center justify-between rounded-xl border px-2.5 py-1.5',
                                    isBase ? 'border-[#1a3a5a] bg-white/[0.02]' : 'border-emerald-500/20 bg-emerald-500/5'
                                  )}>
                                    <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-200">
                                      <Package className="h-3.5 w-3.5 text-slate-400" />
                                      {t.minQty === 1 ? '1 pieza' : `${t.minQty}+ pzs`}
                                    </span>
                                    <div className="flex items-center gap-1.5">
                                      <span className="font-mono text-[12px] font-bold text-slate-100">${t.price.toFixed(2)}</span>
                                      {pct > 0 ? (
                                        <span className="inline-flex items-center rounded-full border border-emerald-400/30 bg-emerald-400/10 px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-wider text-emerald-200 whitespace-nowrap">
                                          -{pct}%
                                        </span>
                                      ) : null}
                                    </div>
                                  </div>
                                )
                              })}
                              {bundleTiers.map((t) => (
                                <div key={`${p.id}-bundle-${t.quantity}`} className="flex items-center justify-between rounded-xl border border-cyan-400/20 bg-cyan-400/5 px-2.5 py-1.5">
                                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-200">
                                    <Package className="h-3.5 w-3.5 text-cyan-300" />
                                    Paquete de {t.quantity} piezas
                                  </span>
                                  <span className="font-mono text-[12px] font-bold text-cyan-100">${t.totalPrice.toFixed(2)} total</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )
                      }
                      cards.push(
                        <button key="new-promo-card" type="button" onClick={() => {
                          setPromoFormProductId('')
                          setPromoFormProductSearch('')
                          setVolumeRows([{ id: `r-${Date.now()}-1`, qty: '1', price: '' }])
                          setVolumeError('')
                          setPromoView('form')
                        }}
                          className="min-h-[220px] rounded-[18px] border-2 border-dashed border-[#2a5589] bg-white/[0.015] px-4 py-5 text-center transition hover:border-[#1090D0]/60 hover:bg-[#1090D0]/5 hover:shadow-[0_10px_30px_-12px_rgba(16,144,208,0.4)]">
                          <div className="mx-auto mb-2.5 flex h-11 w-11 items-center justify-center rounded-2xl border border-[#1090D0]/30 bg-[#1090D0]/10 text-[#7fd2ff]">
                            <Plus className="h-5 w-5" />
                          </div>
                          <p className="text-[13px] font-extrabold text-white">Nueva promoción</p>
                          <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
                            Elige un producto y configura sus rangos de precio por cantidad (1 pz, 3 pzs, 5 pzs…).
                          </p>
                        </button>
                      )
                      if (promos.length === 0 && !q) {
                        return (
                          <>
                            <div className="col-span-full rounded-2xl border border-dashed border-[#25507c] bg-white/[0.02] px-4 py-10 text-center">
                              <Sparkles className="mx-auto mb-2 h-10 w-10 text-slate-500 opacity-70" />
                              <p className="text-[13px] font-bold text-slate-200 mb-1">Aún no tienes promociones por cantidad.</p>
                              <p className="text-[11.5px] leading-relaxed text-slate-400 max-w-xl mx-auto">
                                Las promociones por cantidad se guardan por producto (ej: Nabota 100U a 3+ = $1350 c/u, 5+ = $1200 c/u)
                                y se aplican automáticamente en el carrito del POS.
                              </p>
                            </div>
                            <button key="new-promo-card-2" type="button" onClick={() => {
                              setPromoFormProductId('')
                              setPromoFormProductSearch('')
                              setVolumeRows([{ id: `r-${Date.now()}-1`, qty: '1', price: '' }])
                              setVolumeError('')
                              setPromoView('form')
                            }}
                              className="col-span-1 sm:col-span-2 xl:col-span-3 min-h-[170px] rounded-[18px] border-2 border-dashed border-[#2a5589] bg-white/[0.015] px-4 py-5 text-center transition hover:border-[#1090D0]/60 hover:bg-[#1090D0]/5">
                              <div className="mx-auto mb-2.5 flex h-11 w-11 items-center justify-center rounded-2xl border border-[#1090D0]/30 bg-[#1090D0]/10 text-[#7fd2ff]">
                                <Plus className="h-5 w-5" />
                              </div>
                              <p className="text-[13px] font-extrabold text-white">Crear mi primera promoción</p>
                              <p className="mt-1 text-[11px] leading-relaxed text-slate-400 max-w-md mx-auto">
                                Sigue la plantilla: 1 × 1490 · 3 × 1350 · 5 × 1200 · 10 × 1050.
                              </p>
                            </button>
                          </>
                        )
                      }
                      if (promos.length === 0 && q) {
                        return (
                          <div className="col-span-full rounded-2xl border border-dashed border-[#25507c] bg-white/[0.02] px-4 py-10 text-center">
                            <Search className="mx-auto mb-2 h-9 w-9 text-slate-500 opacity-70" />
                            <p className="text-[12px] font-semibold text-slate-200">Sin promociones para "{promoSearch}".</p>
                            <p className="text-[11px] text-slate-400 mt-0.5">Prueba con el nombre del producto o usa "Nueva promoción".</p>
                          </div>
                        )
                      }
                      return cards
                    })()}
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#1a3a5a] px-5 py-3.5 flex-shrink-0">
                  <span className="text-[11px] font-semibold text-slate-400">
                    💡 Las promociones se aplican <span className="text-slate-200">automáticamente</span> en el POS cuando la cantidad del artículo alcanza un nivel (gana el nivel más alto posible).
                  </span>
                  <button type="button" onClick={() => setPromoModal(null)}
                    className="rounded-[14px] border border-[#1a3a5a] bg-[#11375a] px-4 py-2 text-[12.5px] font-semibold text-slate-200 transition hover:border-[#1090D0]/40 hover:text-white">
                    Cerrar
                  </button>
                </div>
              </>
            ) : null}

            {/* ===== VISTA DE GRUPOS ===== */}
            {promoView === 'groups' ? (
              <>
                <div className="flex flex-wrap items-stretch gap-2 border-b border-[#1a3a5a] px-5 py-3 flex-shrink-0">
                  <div className="flex-1 min-w-[220px] flex items-center gap-2 rounded-[14px] border border-[#1a3a5a] bg-[#0b2641] px-3 py-2.5 focus-within:border-cyan-400/50">
                    <Search className="h-4 w-4 text-slate-400 shrink-0" />
                    <input type="text" value={groupSearch}
                      onChange={(e) => setGroupSearch(e.target.value)}
                      placeholder="Buscar grupo por nombre, o producto/SKU incluido…"
                      className="flex-1 bg-transparent text-[12.5px] text-white placeholder:text-slate-500 focus:outline-none min-w-0" />
                  </div>
                  <button type="button" onClick={openCreateGroup}
                    className="inline-flex items-center gap-1.5 rounded-[14px] bg-cyan-500 hover:bg-cyan-600 shadow-[0_4px_14px_-4px_rgba(34,211,238,0.65)] px-4 py-2.5 text-[11.5px] font-bold uppercase tracking-wider text-white transition flex-shrink-0">
                    <Plus className="h-4 w-4" /> Nuevo grupo
                  </button>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 tech-scrollbar">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {(() => {
                      const q = groupSearch.trim().toLowerCase()
                      let groups = promoGroups
                      if (q) {
                        groups = groups.filter(g =>
                        g.name.toLowerCase().includes(q)
                        || g.productIds.some((pid) => {
                          const it = catalog.find(i => i.id === pid)
                          return it && (it.name.toLowerCase().includes(q) || it.sku.toLowerCase().includes(q))
                        })
                      )
                      }
                      groups = [...groups].sort((a, b) => (b.active ? 1 : 0) - (a.active ? 1 : 0) || a.name.localeCompare(b.name))
                      const cards: JSX.Element[] = []
                      for (const g of groups) {
                        const linked = g.productIds.map(pid => catalog.find(i => i.id === pid)).filter(Boolean) as PosCatalogItem[]
                        cards.push(
                          <div key={g.id} className={cn(
                            "group relative overflow-hidden rounded-[18px] border bg-[#0b2641] p-3.5 transition hover:-translate-y-0.5 hover:shadow-[0_10px_30px_-12px_rgba(34,211,238,0.45)",
                            g.active ? 'border-[#1a3a5a] hover:border-cyan-400/40' : 'border-slate-700/40 opacity-70'
                          )}>
                            <div className="mb-2.5 flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <div className="flex items-center gap-1.5">
                                  <Tag className={cn('h-4 w-4 shrink-0', g.active ? 'text-cyan-300' : 'text-slate-500')} />
                                  <p className="truncate text-[13px] font-bold leading-tight text-white">{g.name}</p>
                                </div>
                                <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                                  <span className={cn(
                                    'inline-flex items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-wider',
                                    g.active
                                      ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200'
                                      : 'border-slate-500/40 bg-slate-500/10 text-slate-300'
                                  )}>
                                    {g.active ? 'ACTIVO' : 'INACTIVO'}
                                  </span>
                                  <span className="inline-flex items-center gap-0.5 rounded-full border border-cyan-400/30 bg-cyan-400/10 px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-wider text-cyan-200">
                                    📦 {linked.length} prods.
                                  </span>
                                  { (g.volumePriceTiers || []).length ? (
                                    <span className="inline-flex items-center gap-0.5 rounded-full border border-amber-400/30 bg-amber-400/10 px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-wider text-amber-200">
                                      🎁 {(g.volumePriceTiers || []).length} rangos
                                    </span>
                                  ) : null}
                                </div>
                              </div>
                              <button type="button" title="Editar grupo"
                                onClick={() => openEditGroup(g)}
                                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#1a3a5a] bg-[#0f3151] text-slate-300 transition group-hover:border-cyan-400/40 group-hover:bg-cyan-500/10 group-hover:text-cyan-300 shadow">
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                            </div>
                            {/* Chips de productos */}
                            <div className="mb-2.5 flex flex-wrap gap-1">
                              {linked.length === 0 ? (
                                <span className="text-[10.5px] italic text-slate-500">(sin productos asociados)</span>
                              ) : linked.slice(0, 4).map(it => (
                                <span key={it.id} className="inline-flex items-center gap-1 rounded-full border border-[#1a3a5a] bg-white/[0.02] px-2 py-0.5 text-[10px] font-bold text-slate-200 max-w-full overflow-hidden">
                                  {it.sku ? <span className="font-mono text-slate-400">{it.sku}</span> : null}
                                  <span className="truncate">{it.name.length > 28 ? `${it.name.slice(0, 28)}…` : it.name}</span>
                                </span>
                              ))}
                              {linked.length > 4 ? (
                                <span className="text-[10.5px] font-bold text-cyan-200 self-center px-1">+{linked.length - 4} más</span>
                              ) : null}
                            </div>
                            {/* Tiers */}
                            <div className="space-y-1">
                              {(g.volumePriceTiers || []).sort((a, b) => a.minQty - b.minQty).map((t, i) => {
                                const linkedPrices = linked.map(it => it.salePrice)
                                const avgPrice = linkedPrices.length ? linkedPrices.reduce((a, b) => a + b, 0) / linkedPrices.length : 0
                                const pct = avgPrice > 0 ? Math.max(0, Math.round((1 - t.price / avgPrice) * 100)) : 0
                                return (
                                  <div key={`${g.id}-t-${i}`} className={cn(
                                    'flex items-center justify-between rounded-xl border px-2.5 py-1.5',
                                    'border-emerald-500/20 bg-emerald-500/5'
                                  )}>
                                    <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-200">
                                      <Package className="h-3.5 w-3.5 text-cyan-400/70" />
                                      {t.minQty}+ pzs (suma grupo)
                                    </span>
                                    <div className="flex items-center gap-1.5">
                                      <span className="font-mono text-[12px] font-bold text-cyan-100">${t.price.toFixed(2)}</span>
                                      {pct > 0 ? (
                                        <span className="inline-flex items-center rounded-full border border-emerald-400/30 bg-emerald-400/10 px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-wider text-emerald-200 whitespace-nowrap">
                                          -{pct}% avg
                                        </span>
                                      ) : null}
                                    </div>
                                  </div>
                                )
                              })}
                              {(g.volumePriceTiers || []).length ? null : (
                                <div className="rounded-xl border border-dashed border-rose-400/20 bg-rose-500/5 px-2.5 py-1.5 text-[11px] font-semibold text-rose-300">
                                  ⚠️ Grupo sin niveles de promoción — no tendrá efecto en el POS
                                </div>
                              )}
                            </div>
                            <div className="mt-2.5 pt-2 border-t border-[#1a3a5a] flex justify-end">
                              <button type="button" onClick={() => setConfirmDeleteGroup(g)}
                                className="inline-flex items-center gap-1 rounded-[10px] border border-rose-500/30 bg-rose-500/10 px-2.5 py-1 text-[10.5px] font-bold text-rose-200 hover:bg-rose-500/20 transition flex-shrink-0">
                                <Trash2 className="h-3.5 w-3.5" />
                                Eliminar
                              </button>
                            </div>
                          </div>
                        )
                      }
                      cards.push(
                        <button key="new-group-card" type="button" onClick={openCreateGroup}
                          className="min-h-[220px] rounded-[18px] border-2 border-dashed border-[#2a5589] bg-white/[0.015] px-4 py-5 text-center transition hover:border-cyan-500/60 hover:bg-cyan-500/5 hover:shadow-[0_10px_30px_-12px_rgba(34,211,238,0.4)]">
                          <div className="mx-auto mb-2.5 flex h-11 w-11 items-center justify-center rounded-2xl border border-cyan-500/30 bg-cyan-500/10 text-cyan-300">
                            <Plus className="h-5 w-5" />
                          </div>
                          <p className="text-[13px] font-extrabold text-white">Nuevo grupo</p>
                          <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
                            Agrupa productos diferentes (ej. 3 viales Stayve distintos) para que sumen cantidades juntas en la misma promoción.
                          </p>
                        </button>
                      )
                      if (groups.length === 0 && !q) {
                        return (
                          <>
                            <div className="col-span-full rounded-2xl border border-dashed border-[#25507c] bg-white/[0.02] px-4 py-10 text-center">
                              <Tag className="mx-auto mb-2 h-10 w-10 text-cyan-400/70" />
                              <p className="text-[13px] font-bold text-slate-200 mb-1">Aún no tienes grupos de productos.</p>
                              <p className="text-[11.5px] leading-relaxed text-slate-400 max-w-xl mx-auto">
                                Usa grupos cuando la promo cruza SKUs diferentes. <span className="text-slate-200 font-semibold">Ej:</span> 3 Stayve (Gold+Aqua+Citron) × $240 c/u (3 x 240).
                              </p>
                            </div>
                            <button key="new-group-card-2" type="button" onClick={openCreateGroup}
                              className="col-span-1 sm:col-span-2 xl:col-span-3 min-h-[170px] rounded-[18px] border-2 border-dashed border-[#2a5589] bg-white/[0.015] px-4 py-5 text-center transition hover:border-cyan-500/60 hover:bg-cyan-500/5">
                              <div className="mx-auto mb-2.5 flex h-11 w-11 items-center justify-center rounded-2xl border border-cyan-500/30 bg-cyan-500/10 text-cyan-300">
                                <Plus className="h-5 w-5" />
                              </div>
                              <p className="text-[13px] font-extrabold text-white">Crear mi primer grupo</p>
                              <p className="mt-1 text-[11px] leading-relaxed text-slate-400 max-w-md mx-auto">
                                Elige los productos y los rangos. Ej: grupo "Pack 3 Stayve" — 3+ pzs × $240 c/u
                              </p>
                            </button>
                          </>
                        )
                      }
                      if (groups.length === 0 && q) {
                        return (
                          <div className="col-span-full rounded-2xl border border-dashed border-[#25507c] bg-white/[0.02] px-4 py-10 text-center">
                            <Search className="mx-auto mb-2 h-9 w-9 text-slate-500 opacity-70" />
                            <p className="text-[12px] font-semibold text-slate-200">Sin grupos para "{groupSearch}".</p>
                            <p className="text-[11px] text-slate-400 mt-0.5">Prueba con el nombre del grupo o crea uno nuevo.</p>
                          </div>
                        )
                      }
                      return cards
                    })()}
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#1a3a5a] px-5 py-3.5 flex-shrink-0">
                  <span className="text-[11px] font-semibold text-slate-400">
                    💡 Las promos <span className="text-slate-200">por GRUPO</span> suman cantidades ENTRE productos y se aplican automáticamente en el POS (siempre que mejore al precio individual).
                  </span>
                  <button type="button" onClick={() => setPromoModal(null)}
                    className="rounded-[14px] border border-[#1a3a5a] bg-[#11375a] px-4 py-2 text-[12.5px] font-semibold text-slate-200 transition hover:border-[#1090D0]/40 hover:text-white">
                    Cerrar
                  </button>
                </div>
              </>
            ) : null}

            {/* ===== VISTA: CREAR / EDITAR UN GRUPO ===== */}
            {promoView === 'group_form' ? (
              <>
                <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 space-y-4 tech-scrollbar">
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                    <div className="sm:col-span-2">
                      <label className="mb-1.5 block text-[11.5px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                        Nombre grupo *
                      </label>
                      <div className="flex items-center gap-2 rounded-[14px] border border-[#1a3a5a] bg-[#0b2641] px-3 py-2.5 focus-within:border-cyan-400/50">
                        <Tag className="h-4 w-4 text-slate-400" />
                        <input type="text" autoFocus
                          value={groupForm.name}
                          onChange={(e) => setGroupForm({ ...groupForm, name: e.target.value })}
                          placeholder="Ej: Pack 3 Viales Stayve"
                          className="flex-1 bg-transparent text-[13.5px] text-slate-100 placeholder:text-slate-500 focus:outline-none" />
                      </div>
                    </div>
                    <div className="sm:col-span-1">
                      <label className="mb-1.5 block text-[11.5px] font-semibold uppercase tracking-[0.18em] text-slate-400">Estado</label>
                      <label className="flex items-center justify-between rounded-[14px] border border-[#1a3a5a] bg-[#0b2641] px-3 py-2.5">
                        <span className="text-[11.5px] font-bold text-slate-300 uppercase tracking-wider">Activo</span>
                        <button type="button" onClick={() => setGroupForm({ ...groupForm, active: !groupForm.active })}
                          className={cn(
                            'relative inline-flex h-6 w-11 items-center rounded-full transition',
                            groupForm.active ? 'bg-cyan-500' : 'bg-slate-600/60'
                          )}>
                          <span className={cn(
                            'inline-block h-5 w-5 transform rounded-full bg-white shadow-md transition',
                            groupForm.active ? 'translate-x-5' : 'translate-x-0.5'
                          )} />
                        </button>
                      </label>
                    </div>
                  </div>

                  <div>
                    <div className="mb-1.5 flex items-center justify-between flex-wrap gap-2">
                      <label className="flex items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                        <Package className="h-3.5 w-3.5 text-cyan-300" />
                        Productos incluidos ({groupForm.productIds.length})
                      </label>
                      <span className="text-[10.5px] text-slate-500">
                        Se suman cantidades de CUALQUIERA de estos productos para alcanzar los niveles de promoción.
                      </span>
                    </div>

                    <div className="rounded-[14px] border border-[#1a3a5a] bg-[#0b2641] p-3">
                      {groupForm.productIds.length > 0 ? (
                        <div className="flex flex-wrap gap-1.5 pb-2 mb-2 border-b border-[#1a3a5a]">
                          {groupForm.productIds.map(pid => catalog.find(i => i.id === pid)).filter(Boolean).map((it) => (
                            <span key={it!.id} className="inline-flex items-center gap-1.5 rounded-full border border-cyan-400/30 bg-cyan-400/10 px-2.5 py-1 text-[10.5px] font-bold text-cyan-100">
                              {it!.sku ? <span className="font-mono text-cyan-300 mr-0.5">{it!.sku}</span> : null}
                              {it!.name.length > 36 ? `${it!.name.slice(0, 36)}…` : it!.name}
                              <button type="button"
                                onClick={() => setGroupForm({ ...groupForm, productIds: groupForm.productIds.filter(p => p !== it!.id) })}
                                className="ml-0.5 rounded-full text-cyan-200/80 hover:text-white hover:bg-cyan-500/20 h-4 w-4 flex items-center justify-center">
                                <X className="h-2.5 w-2.5" />
                              </button>
                            </span>
                          ))}
                          {groupForm.productIds.some(pid => !catalog.find(i => i.id === pid)) ? (
                            <span className="text-[10.5px] text-rose-300 italic font-bold">
                              {(groupForm.productIds.filter(pid => !catalog.find(i => i.id === pid))).length} producto(s) ya no existen — guardar limpia
                            </span>
                          ) : null}
                        </div>
                      ) : null}

                      <div className="mb-2 flex items-center gap-2 rounded-[12px] border border-[#1a3a5a] bg-[#0f3151] px-3 py-2 focus-within:border-cyan-400/50">
                        <Search className="h-3.5 w-3.5 text-slate-400" />
                        <input type="text" value={groupForm.productSearch}
                          onChange={(e) => setGroupForm({ ...groupForm, productSearch: e.target.value })}
                          placeholder="Buscar productos para agregar (nombre, SKU, familia)..."
                          className="flex-1 bg-transparent text-[12.5px] text-slate-100 placeholder:text-slate-500 focus:outline-none" />
                      </div>

                      <div className="max-h-[240px] overflow-y-auto rounded-[12px] border border-[#1a3a5a] bg-white/[0.015] p-2 space-y-1">
                        {(() => {
                          const q = groupForm.productSearch.trim().toLowerCase()
                          let list = catalog.filter(i => i.active && i.kind === 'product')
                          if (q) list = list.filter(i => [i.name, i.sku, i.family, i.category, (i.tags || []).join(' ')].join(' ').toLowerCase().includes(q))
                          if (list.length === 0) {
                            return (
                              <div className="py-8 text-center text-[11.5px] text-slate-500">
                                {q ? 'Sin resultados. Escribe otra búsqueda.' : 'Aún no hay productos activos tipo "Producto" en el catálogo.'}
                              </div>
                            )
                          }
                          return list.slice(0, 300).map((it) => {
                            const checked = groupForm.productIds.includes(it.id)
                            return (
                              <label key={it.id} className={cn(
                                'cursor-pointer flex items-center gap-2.5 rounded-[10px] px-2.5 py-1.5 transition',
                                checked ? 'bg-cyan-500/10 border border-cyan-400/30' : 'hover:bg-[#0b2641] border border-transparent'
                              )}>
                                <span className={cn(
                                  'h-4 w-4 shrink-0 rounded-[5px] border flex items-center justify-center transition',
                                  checked ? 'bg-cyan-400 border-cyan-400 text-[#07203a]' : 'border-[#1a3a5a] bg-[#0f3151]'
                                )}>
                                  {checked ? <Check className="h-3 w-3" /> : null}
                                </span>
                                <span className="font-mono text-[10.5px] text-slate-400 w-16 shrink-0 truncate">{it.sku || '—'}</span>
                                <span className="flex-1 text-[12px] font-semibold text-slate-100 truncate">{it.name}</span>
                                <span className="font-mono text-[11.5px] font-bold text-[#5bbfe5] shrink-0">${Number(it.salePrice).toFixed(2)}</span>
                                <input type="checkbox" className="hidden" checked={checked}
                                  onChange={(e) => {
                                    if (e.target.checked) {
                                      setGroupForm({
                                        ...groupForm,
                                        productIds: Array.from(new Set([...groupForm.productIds, it.id]))
                                      })
                                    } else {
                                      setGroupForm({
                                        ...groupForm,
                                        productIds: groupForm.productIds.filter((p) => p !== it.id)
                                      })
                                    }
                                  }}
                                />
                              </label>
                            )
                          })
                        })()}
                      </div>
                    </div>
                  </div>

                  <div>
                    <div className="mb-1.5 flex items-center justify-between flex-wrap gap-2">
                      <label className="flex items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                        <Sparkles className="h-3.5 w-3.5 text-amber-300" />
                        Niveles promoción (alcanzar cantidad TOTAL en el grupo = precio promocional c/u)
                      </label>
                      <button type="button"
                        onClick={() => {
                          const avgPrice = groupForm.productIds.length ? groupForm.productIds.reduce((acc, pid) => acc + Number(catalog.find(i => i.id === pid)?.salePrice || 0), 0) / groupForm.productIds.length : 0
                          setGroupForm({
                            ...groupForm,
                            volumePriceTiers: [...groupForm.volumePriceTiers, { minQty: '3', price: (avgPrice ? Number((avgPrice * 0.9).toFixed(2)) : 0).toString() }]
                          })
                        }}
                        className="inline-flex items-center gap-1 rounded-full border border-cyan-500/40 bg-cyan-500/10 px-2.5 py-1 text-[10.5px] font-bold uppercase tracking-wider text-cyan-200 hover:bg-cyan-500/20">
                        <Plus className="h-3 w-3" /> Agregar nivel
                      </button>
                    </div>
                    <div className="rounded-[14px] border border-[#1a3a5a] bg-[#0b2641] p-3">
                      <div className="grid grid-cols-[auto_1fr_1fr_auto] gap-2 items-center text-[10.5px] font-extrabold uppercase tracking-widest text-slate-400 px-2 pb-2 border-b border-[#1a3a5a]">
                        <span className="w-6 text-center">#</span>
                        <span>Total pzs grupo</span>
                        <span>Precio c/u</span>
                        <span className="w-9"></span>
                      </div>
                      {groupForm.volumePriceTiers.length === 0 ? (
                        <div className="px-2 py-6 text-center rounded-xl border border-dashed border-[#25507c] bg-white/[0.02] my-2">
                          <p className="text-[11.5px] text-slate-400 leading-relaxed">
                            Agrega niveles de promoción.<br />
                            <span className="text-slate-300 font-semibold">Ej:</span> 3+ pzs (suma de todos los productos del grupo) = $240 c/u · 6+ pzs = $220 c/u.
                          </p>
                        </div>
                      ) : (
                        <div className="space-y-1.5 pt-2">
                          {[...groupForm.volumePriceTiers].map((t, i) => ({ t, i })).sort((a, b) => (Number(a.t.minQty) || 0) - (Number(b.t.minQty) || 0)).map(({ t, i: origIdx }, displayIdx) => {
                            const avgPrice = groupForm.productIds.length ? groupForm.productIds.reduce((acc, pid) => acc + Number(catalog.find(i => i.id === pid)?.salePrice || 0), 0) / groupForm.productIds.length : 0
                            const qty = Math.max(2, Math.floor(Number(t.minQty) || 0))
                            const pu = Number(t.price) || 0
                            const pct = avgPrice > 0 ? Math.max(0, Math.round((1 - pu / avgPrice) * 100)) : 0
                            return (
                              <div key={origIdx} className="grid grid-cols-[auto_1fr_1fr_auto] gap-2 items-center">
                                <span className="w-6 text-center text-[12px] font-mono font-bold text-slate-500">{displayIdx + 1}</span>
                                <div className="flex items-center gap-2 rounded-[12px] border border-[#1a3a5a] bg-[#0f3151] px-2.5 py-2 focus-within:border-cyan-400/50">
                                  <Package className="h-3.5 w-3.5 text-slate-400" />
                                  <input type="number" min={2} step={1}
                                    value={t.minQty}
                                    onChange={(e) => {
                                      const next = [...groupForm.volumePriceTiers]
                                      next[origIdx] = { ...next[origIdx], minQty: e.target.value }
                                      setGroupForm({ ...groupForm, volumePriceTiers: next })
                                    }}
                                    placeholder="3"
                                    className="flex-1 bg-transparent font-mono text-[12.5px] text-slate-100 focus:outline-none w-20" />
                                  <span className="text-[10.5px] text-slate-500 font-bold">pzs+</span>
                                </div>
                                <div className="flex items-center gap-2 rounded-[12px] border border-[#1a3a5a] bg-[#0f3151] px-2.5 py-2 focus-within:border-cyan-400/50">
                                  <DollarSign className={cn('h-3.5 w-3.5', pct > 0 ? 'text-emerald-300' : 'text-slate-400')} />
                                  <input type="number" min={0} step="0.01"
                                    value={t.price}
                                    onChange={(e) => {
                                      const next = [...groupForm.volumePriceTiers]
                                      next[origIdx] = { ...next[origIdx], price: e.target.value }
                                      setGroupForm({ ...groupForm, volumePriceTiers: next })
                                    }}
                                    placeholder="0.00"
                                    className="flex-1 bg-transparent font-mono text-[12.5px] font-semibold text-slate-100 focus:outline-none"
                                  />
                                  {pct > 0 && qty >= 2 ? (
                                    <span className="inline-flex items-center rounded-full border border-emerald-400/30 bg-emerald-400/10 px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wider text-emerald-200 whitespace-nowrap">-{pct}% vs avg</span>
                                  ) : null}
                                </div>
                                <button type="button"
                                  onClick={() => {
                                    const next = groupForm.volumePriceTiers.filter((_, idx) => idx !== origIdx)
                                    setGroupForm({ ...groupForm, volumePriceTiers: next })
                                  }}
                                  className="flex h-9 w-9 items-center justify-center rounded-[12px] border border-rose-500/20 bg-rose-500/5 text-rose-300 hover:bg-rose-500/15" title="Borrar nivel">
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            )
                          })}
                        </div>
                      )}
                      <p className="mt-3 rounded-xl border border-[#1a3a5a] bg-white/[0.02] px-3 py-2 text-[10.5px] leading-relaxed text-slate-400">
                        📌 En el <span className="font-bold text-[#7fd2ff]">Punto de Venta</span> se suman TODAS las cantidades de los productos del grupo.
                        Se aplica el nivel con la cantidad más alta que alcance esa suma (solo si baja el precio, jamás lo sube).
                      </p>
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[#1a3a5a] px-5 py-4">
                  <button type="button" onClick={closeGroupForm}
                    className="rounded-[14px] border border-[#1a3a5a] bg-[#11375a] px-4 py-2 text-[12.5px] font-semibold text-slate-200 transition hover:border-[#1090D0]/40 hover:text-white">
                    Cancelar
                  </button>
                  <button type="button" onClick={() => void handleSaveGroup()} disabled={savingGroup}
                    className={cn(
                      'flex items-center gap-1.5 rounded-[14px] px-5 py-2 text-[12.5px] font-bold text-white transition',
                      savingGroup ? 'bg-slate-500/60 cursor-wait' : 'bg-cyan-500 hover:bg-cyan-600 shadow-[0_4px_14px_-4px_rgba(34,211,238,0.7)]'
                    )}>
                    {savingGroup ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                    {savingGroup ? 'Guardando...' : groupForm.id ? 'Guardar cambios' : 'Crear grupo'}
                  </button>
                </div>
              </>
            ) : null}

            {/* ===== TICKET DESCUENTO ===== */}
            {promoView === 'ticket' ? (
              <>
                <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 space-y-4 tech-scrollbar">
                  <div className="grid grid-cols-2 gap-2">
                    <button type="button" onClick={() => setPromoMode('percent')}
                      className={cn(
                        'rounded-[14px] border px-4 py-3 text-left transition',
                        promoMode === 'percent'
                          ? 'border-[#1090D0]/60 bg-[#1090D0]/15 shadow-[inset_0_0_0_1px_rgba(16,144,208,0.25)]'
                          : 'border-[#1a3a5a] bg-[#0b2641]/70 hover:border-[#2a5589]'
                      )}>
                      <div className="flex items-center gap-2">
                        <Percent className={cn('h-4 w-4', promoMode === 'percent' ? 'text-[#7fd2ff]' : 'text-slate-400')} />
                        <span className={cn('text-[12px] font-extrabold uppercase tracking-widest', promoMode === 'percent' ? 'text-[#7fd2ff]' : 'text-slate-300')}>Porcentaje</span>
                      </div>
                      <p className={cn('mt-1.5 font-mono text-[13px] font-bold', promoMode === 'percent' ? 'text-white' : 'text-slate-400')}>% descuento</p>
                    </button>
                    <button type="button" onClick={() => setPromoMode('amount')}
                      className={cn(
                        'rounded-[14px] border px-4 py-3 text-left transition',
                        promoMode === 'amount'
                          ? 'border-[#1090D0]/60 bg-[#1090D0]/15 shadow-[inset_0_0_0_1px_rgba(16,144,208,0.25)]'
                          : 'border-[#1a3a5a] bg-[#0b2641]/70 hover:border-[#2a5589]'
                      )}>
                      <div className="flex items-center gap-2">
                        <DollarSign className={cn('h-4 w-4', promoMode === 'amount' ? 'text-[#7fd2ff]' : 'text-slate-400')} />
                        <span className={cn('text-[12px] font-extrabold uppercase tracking-widest', promoMode === 'amount' ? 'text-[#7fd2ff]' : 'text-slate-300')}>Monto</span>
                      </div>
                      <p className={cn('mt-1.5 font-mono text-[13px] font-bold', promoMode === 'amount' ? 'text-white' : 'text-slate-400')}>$ fijo</p>
                    </button>
                  </div>

                  <div>
                    <label className="mb-1.5 block text-[11.5px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                      {promoMode === 'percent' ? 'Porcentaje a descontar' : 'Monto a descontar'}
                    </label>
                    <div className="flex items-center gap-2 rounded-[14px] border border-[#1a3a5a] bg-[#0b2641] px-3 py-3 focus-within:border-[#1090D0]/50">
                      {promoMode === 'percent' ? <Percent className="h-4 w-4 text-[#5bbfe5]" /> : <DollarSign className="h-4 w-4 text-[#5bbfe5]" />}
                      <input autoFocus type="number"
                        step={promoMode === 'percent' ? 1 : 0.01} min={0}
                        max={promoMode === 'percent' ? 100 : undefined}
                        value={promoValue}
                        onChange={(e) => setPromoValue(e.target.value)}
                        placeholder={promoMode === 'percent' ? 'Ej. 10 = 10%' : 'Ej. 100 = $100'}
                        className="flex-1 bg-transparent font-mono text-[17px] font-extrabold text-white placeholder:text-slate-500 focus:outline-none" />
                      {promoMode === 'percent' ? <span className="text-slate-400 font-bold">%</span> : null}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {(promoMode === 'percent' ? [5, 10, 15, 20, 30, 50] : [20, 50, 100, 200, 500, 1000]).map((v) => (
                        <button key={`${promoMode}-${v}`} type="button" onClick={() => setPromoValue(String(v))}
                          className={cn(
                            'rounded-lg border px-2.5 py-1 text-[11px] font-bold transition',
                            promoValue === String(v) ? 'border-amber-400/50 bg-amber-400/15 text-amber-200' : 'border-[#1a3a5a] bg-[#0b2641] text-slate-300 hover:border-[#2a5589] hover:text-white'
                          )}>
                          {promoMode === 'percent' ? `${v}%` : `$${v}`}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-[14px] border border-[#1a3a5a] bg-white/[0.025] px-4 py-3 space-y-1.5">
                    <div className="flex items-center justify-between text-[11.5px]">
                      <span className="text-slate-400">Subtotal</span>
                      <span className="font-mono font-bold text-slate-100">${cartSubtotal.toFixed(2)}</span>
                    </div>
                    <div className="flex items-center justify-between text-[11.5px]">
                      <span className="text-slate-400">Descuento aplicado</span>
                      <span className="font-mono font-bold text-rose-300">
                        -${(() => {
                          const raw = Number(promoValue) || 0
                          if (promoMode === 'percent') return Number((cartSubtotal * Math.min(100, Math.max(0, raw)) / 100).toFixed(2))
                          return Number(Math.min(cartSubtotal, Math.max(0, raw)).toFixed(2))
                        })().toFixed(2)}
                      </span>
                    </div>
                    {ivaEnabledCalc ? (
                      <div className="flex items-center justify-between text-[11.5px]">
                        <span className="text-slate-400">IVA</span>
                        <span className="font-mono font-bold text-emerald-200">
                          +${Number((Math.max(0, cartSubtotal - (() => {
                            const raw = Number(promoValue) || 0
                            if (promoMode === 'percent') return Number((cartSubtotal * Math.min(100, Math.max(0, raw)) / 100).toFixed(2))
                            return Number(Math.min(cartSubtotal, Math.max(0, raw)).toFixed(2))
                          })()) * (shiftBranch?.ivaRate || 0)).toFixed(2))}
                        </span>
                      </div>
                    ) : null}
                    <div className="flex items-center justify-between border-t border-[#1a3a5a] pt-1.5">
                      <span className="text-[11.5px] font-extrabold uppercase tracking-[0.18em] text-[#8fd2ec]">Nuevo Total</span>
                      <span className="font-mono text-[18px] font-extrabold text-white">
                        ${(() => {
                          const raw = Number(promoValue) || 0
                          const desc = promoMode === 'percent'
                            ? Number((cartSubtotal * Math.min(100, Math.max(0, raw)) / 100).toFixed(2))
                            : Number(Math.min(cartSubtotal, Math.max(0, raw)).toFixed(2))
                          const sub = Math.max(0, cartSubtotal - desc)
                          const iva = ivaEnabledCalc ? Number((sub * (shiftBranch?.ivaRate || 0)).toFixed(2)) : 0
                          return Number((sub + iva).toFixed(2))
                        })().toFixed(2)}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#1a3a5a] px-5 py-4 flex-shrink-0">
                  <button type="button" onClick={() => { setDiscount(0); setPromoValue(''); showToast('Descuento eliminado') }}
                    className="rounded-[14px] border border-rose-500/30 bg-rose-500/10 px-4 py-2 text-[12px] font-bold uppercase tracking-wider text-rose-200 transition hover:bg-rose-500/20 inline-flex items-center gap-1.5">
                    <Trash2 className="h-3.5 w-3.5" /> Limpiar descuento
                  </button>
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => setPromoView('list')}
                      className="rounded-[14px] border border-[#1a3a5a] bg-[#11375a] px-4 py-2 text-[12.5px] font-semibold text-slate-200 transition hover:border-[#1090D0]/40 hover:text-white">
                      ← Promociones
                    </button>
                    <button type="button"
                      onClick={() => {
                        const raw = Number(promoValue) || 0
                        let desc = 0
                        if (promoMode === 'percent') desc = Number((cartSubtotal * Math.min(100, Math.max(0, raw)) / 100).toFixed(2))
                        else desc = Number(Math.min(cartSubtotal, Math.max(0, raw)).toFixed(2))
                        setDiscount(desc)
                        setPromoView('list')
                        if (desc > 0) showToast(`Descuento aplicado: -$${desc.toFixed(2)}`)
                        else showToast('Descuento en $0')
                      }}
                      className={cn(
                        'rounded-[14px] px-5 py-2 text-[12.5px] font-bold text-white transition',
                        cart.length === 0 ? 'bg-amber-500/40 opacity-60' : 'bg-amber-500 hover:bg-amber-600 shadow-[0_4px_14px_-4px_rgba(245,158,11,0.7)]'
                      )}>
                      Aplicar al ticket
                    </button>
                  </div>
                </div>
              </>
            ) : null}

            {/* ===== FORM NUEVA / EDITAR PROMOCIÓN (Cantidad × Costo) ===== */}
            {promoView === 'form' ? (
              <>
                <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 space-y-4 tech-scrollbar">
                  <div>
                    <label className="mb-1.5 flex items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                      <Search className="h-3.5 w-3.5" /> Buscador de producto
                    </label>
                    <div className="relative">
                      <input type="text"
                        value={promoFormProductId
                          ? (catalog.find((c) => c.id === promoFormProductId)?.name || promoFormProductSearch)
                          : promoFormProductSearch}
                        onChange={(e) => {
                          if (promoFormProductId) {
                            setPromoFormProductId('')
                            setVolumeRows([{ id: `r-${Date.now()}-1`, qty: '1', price: '' }])
                          }
                          setPromoFormProductSearch(e.target.value)
                        }}
                        placeholder="Busca por nombre, SKU… (ej. Nabota 100U, Exosomas, PDRN Kiara)"
                        className="w-full rounded-[14px] border border-[#1a3a5a] bg-[#0b2641] px-3 py-3 text-[12.5px] text-white placeholder:text-slate-500 focus:border-[#1090D0]/50 focus:outline-none" />
                    </div>
                    {!promoFormProductId ? (
                      <div className="mt-2 grid grid-cols-1 gap-1.5 max-h-56 overflow-y-auto tech-scrollbar pr-1">
                        {(() => {
                          const q = promoFormProductSearch.trim().toLowerCase()
                          const items = catalog
                            .filter((c) => c.active)
                            .filter((c) => !q ? true : [c.name, c.sku, c.family, c.category, (c.tags || []).join(' ')].join(' ').toLowerCase().includes(q))
                            .slice(0, 30)
                          if (items.length === 0) {
                            return (
                              <div className="rounded-xl border border-dashed border-[#25507c] bg-white/[0.02] px-4 py-5 text-center text-[11px] text-slate-400">
                                Sin productos para la búsqueda. Teclea parte del nombre.
                              </div>
                            )
                          }
                          return items.map((it) => {
                            const has = (it.volumePriceTiers || []).length > 0
                            return (
                              <button key={it.id} type="button"
                                onClick={() => {
                                  setPromoFormProductId(it.id)
                                  setVolumeError('')
                                  const base = [{ id: `r1-${Date.now()}`, qty: '1', price: String(it.salePrice) }]
                                  const extra = (it.volumePriceTiers || [])
                                    .sort((a, b) => a.minQty - b.minQty)
                                    .filter((t) => t.minQty >= 2)
                                    .map((t, i) => ({ id: `rn-${t.minQty}-${i}-${Date.now()}`, qty: String(t.minQty), price: String(t.price) }))
                                  setVolumeRows([...base, ...extra])
                                }}
                                className="flex items-center justify-between gap-2 rounded-xl border border-transparent hover:border-[#1a3a5a] hover:bg-[#0b2641]/80 px-3 py-2 text-left transition">
                                <div className="min-w-0">
                                  <p className="truncate text-[12px] font-semibold text-slate-100">{it.name}</p>
                                  <div className="mt-0.5 flex flex-wrap items-center gap-2">
                                    {it.sku ? <span className="text-[10px] font-mono text-slate-500 rounded-md border border-[#1a3a5a] bg-white/[0.02] px-1.5 py-0.5">{it.sku}</span> : null}
                                    <span className="font-mono text-[11px] font-bold text-emerald-200">${it.salePrice.toFixed(2)}</span>
                                    {has ? (
                                      <span className="inline-flex items-center gap-0.5 rounded-full border border-amber-400/30 bg-amber-400/10 px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-wider text-amber-200">
                                        🎁 {(it.volumePriceTiers || []).length} niveles
                                      </span>
                                    ) : null}
                                  </div>
                                </div>
                                <Plus className="h-4 w-4 text-slate-500 shrink-0" />
                              </button>
                            )
                          })
                        })()}
                      </div>
                    ) : null}
                  </div>

                  <div>
                    <div className="mb-2 flex items-end justify-between gap-2">
                      <div className="grid grid-cols-2 gap-2 flex-1 max-w-xl">
                        <span className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-[0.18em] text-slate-400 pl-1">
                          <Package className="h-3.5 w-3.5" /> Cantidad
                        </span>
                        <span className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-[0.18em] text-slate-400 pl-1">
                          <DollarSign className="h-3.5 w-3.5" /> Costo
                        </span>
                      </div>
                      <button type="button"
                        disabled={!promoFormProductId}
                        onClick={() => setVolumeRows((r) => [...r, { id: `r-add-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, qty: String((r[r.length - 1]?.qty ? Number(r[r.length - 1].qty || 0) + 1 : 3)), price: '' }])}
                        className={cn(
                          'inline-flex items-center gap-1 rounded-[14px] border px-3 py-2 text-[10.5px] font-bold uppercase tracking-wider transition whitespace-nowrap',
                          !promoFormProductId
                            ? 'opacity-50 cursor-not-allowed border-[#1a3a5a] bg-[#0b2641] text-slate-400'
                            : 'border-[#1090D0]/40 bg-[#1090D0]/10 text-[#7fd2ff] hover:bg-[#1090D0]/20'
                        )}>
                        <Plus className="h-3.5 w-3.5" /> nuevo input
                      </button>
                    </div>

                    <div className="rounded-[18px] border border-[#1a3a5a] bg-[#0b2641] p-3 space-y-2">
                      {!promoFormProductId ? (
                        <div className="rounded-xl border border-dashed border-[#25507c] bg-white/[0.02] px-4 py-9 text-center">
                          <Package className="mx-auto mb-2 h-9 w-9 text-slate-500 opacity-70" />
                          <p className="text-[12px] font-bold text-slate-200 mb-1">Primero elige un producto de arriba.</p>
                          <p className="text-[11px] leading-relaxed text-slate-400 max-w-md mx-auto">
                            Ejemplo Nabota 100U: 1 × 1490 · 3 × 1350 · 5 × 1200 · 10 × 1050.
                            Siéntete libre de escribir solo números, el formato es libre.
                          </p>
                        </div>
                      ) : (
                        volumeRows.map((row, i) => {
                          const q = Number(row.qty || 0)
                          const p = Number(row.price || 0)
                          const baseRow = volumeRows[0]
                          const basePrice = Number(baseRow?.price || catalog.find((c) => c.id === promoFormProductId)?.salePrice || 0)
                          const pct = basePrice > 0 && p > 0 && i > 0
                            ? Math.max(0, Math.round((1 - p / basePrice) * 100))
                            : 0
                          const validQty = isFinite(q) && q >= 1
                          const validPrice = isFinite(p) && p >= 0
                          return (
                            <div key={row.id} className="grid grid-cols-[auto_1fr_auto_1fr_auto] items-center gap-2">
                              <span className="w-7 text-center font-mono font-bold text-[11px] text-slate-500">#{i + 1}</span>
                              <div className={cn(
                                'flex items-center gap-2 rounded-[14px] border px-2.5 py-2 focus-within:border-[#1090D0]/50',
                                !validQty ? 'border-rose-500/30 bg-rose-500/5' : 'border-[#1a3a5a] bg-[#0f3151]'
                              )}>
                                <Package className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                                <input type="number" min={1} step={1}
                                  value={row.qty}
                                  onChange={(e) => {
                                    const n = [...volumeRows]; n[i] = { ...n[i], qty: e.target.value }; setVolumeRows(n)
                                  }}
                                  placeholder="3"
                                  className="w-full bg-transparent font-mono text-[14px] font-bold text-slate-100 focus:outline-none min-w-0" />
                              </div>
                              <span className="font-mono text-[16px] font-extrabold text-slate-400 px-1">×</span>
                              <div className={cn(
                                'flex items-center gap-2 rounded-[14px] border px-2.5 py-2 focus-within:border-[#1090D0]/50',
                                !validPrice ? 'border-rose-500/30 bg-rose-500/5' : 'border-[#1a3a5a] bg-[#0f3151]'
                              )}>
                                <DollarSign className="h-3.5 w-3.5 text-emerald-300 shrink-0" />
                                <input type="number" min={0} step="0.01"
                                  value={row.price}
                                  onChange={(e) => {
                                    const n = [...volumeRows]; n[i] = { ...n[i], price: e.target.value }; setVolumeRows(n)
                                  }}
                                  placeholder="830"
                                  className="w-full bg-transparent font-mono text-[14px] font-bold text-slate-100 focus:outline-none min-w-0" />
                                {pct > 0 ? (
                                  <span className="inline-flex items-center rounded-full border border-emerald-400/30 bg-emerald-400/10 px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-wider text-emerald-200 whitespace-nowrap shrink-0">
                                    -{pct}%
                                  </span>
                                ) : null}
                              </div>
                              <button type="button"
                                onClick={() => setVolumeRows((r) => r.filter((_, idx) => idx !== i))}
                                disabled={volumeRows.length <= 1}
                                className={cn(
                                  'flex h-9 w-9 items-center justify-center rounded-[12px] border transition',
                                  volumeRows.length <= 1
                                    ? 'opacity-40 cursor-not-allowed border-[#1a3a5a] bg-[#0f3151] text-slate-500'
                                    : 'border-rose-500/25 bg-rose-500/5 text-rose-300 hover:bg-rose-500/15'
                                )}>
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          )
                        })
                      )}
                      {promoFormProductId ? (
                        <p className="mt-2 rounded-xl border border-[#1a3a5a] bg-white/[0.02] px-3 py-2 text-[10.5px] leading-relaxed text-slate-400">
                          💡 El renglón <span className="font-bold text-slate-200">#1 1 × costo</span> es el precio a 1 pieza.
                          Los demás rangos se aplican automáticamente en el POS cuando la cantidad alcance el mínimo (nivel más alto gana).
                        </p>
                      ) : null}
                    </div>

                    {volumeError ? (
                      <div className="mt-2 flex items-start gap-2 rounded-xl border border-rose-400/20 bg-rose-400/10 px-3 py-2 text-[11.5px] text-rose-200">
                        <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        <div className="flex-1">{volumeError}</div>
                        <button type="button" onClick={() => setVolumeError('')} className="rounded-md p-1 hover:bg-white/10">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#1a3a5a] px-5 py-4 flex-shrink-0">
                  <button type="button"
                    disabled={!promoFormProductId || volumeRows.length === 0}
                    onClick={() => {
                      const item = catalog.find((c) => c.id === promoFormProductId)
                      if (!item) return
                      setPromoFormProductId('')
                      setPromoFormProductSearch('')
                      setVolumeRows([{ id: `r-${Date.now()}-1`, qty: '1', price: '' }])
                      setVolumeError('')
                      showToast(`Niveles limpiados para ${item.name}`)
                    }}
                    className={cn(
                      'rounded-[14px] border px-4 py-2 text-[12px] font-bold uppercase tracking-wider transition inline-flex items-center gap-1.5',
                      !promoFormProductId ? 'opacity-40 cursor-not-allowed' : '',
                      'border-rose-500/30 bg-rose-500/10 text-rose-200 hover:bg-rose-500/20'
                    )}>
                    <Trash2 className="h-3.5 w-3.5" /> Limpiar niveles
                  </button>
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => setPromoView('list')}
                      className="rounded-[14px] border border-[#1a3a5a] bg-[#11375a] px-4 py-2 text-[12.5px] font-semibold text-slate-200 transition hover:border-[#1090D0]/40 hover:text-white">
                      ← Promociones
                    </button>
                    <button type="button"
                      disabled={!promoFormProductId || volumeRows.length === 0 || volumeSaving}
                      onClick={() => {
                        void (async () => {
                          setVolumeError('')
                          const item = catalog.find((c) => c.id === promoFormProductId)
                          if (!item) { setVolumeError('Selecciona un producto primero'); return }
                          const parsedList = volumeRows
                            .map((r) => {
                              const q = Number(r.qty); const p = Number(r.price)
                              if (!isFinite(q) || !isFinite(p)) return null
                              return { minQty: Math.max(1, Math.floor(q || 0)), price: Number((p || 0).toFixed(2)) }
                            })
                            .filter((x): x is { minQty: number; price: number } => !!x)
                          if (parsedList.length < 1) { setVolumeError('Agrega al menos el nivel 1 × precio'); return }
                          if (parsedList.some((t) => !(t.minQty >= 1) || !(t.price >= 0))) {
                            setVolumeError('Revisa los niveles: cantidad ≥ 1 y costo ≥ 0')
                            return
                          }
                          const tiers = parsedList
                            .filter((t) => t.minQty >= 2)
                            .sort((a, b) => a.minQty - b.minQty)
                            .filter((t, i, arr) => arr.findIndex((x) => x.minQty === t.minQty) === i)
                          const baseRow = parsedList.find((t) => t.minQty === 1) || parsedList[0]
                          const salePrice = Number((baseRow?.price || item.salePrice).toFixed(2))
                          setVolumeSaving(true)
                          try {
                            const res = await posCatalogSave({
                              id: item.id,
                              name: item.name,
                              salePrice,
                              volumePriceTiers: tiers,
                              syncToMdDoc: null,
                            })
                            showToast(`Promoción guardada para ${item.name}`)
                            const nextRows: PromoVolumeRow[] = [
                              { id: `r-base-${Date.now()}`, qty: '1', price: String(salePrice) },
                              ...tiers.map((t, i) => ({ id: `r-${t.minQty}-${i}`, qty: String(t.minQty), price: String(t.price) })),
                            ]
                            setVolumeRows(nextRows)
                            const fresh = await posCatalog(); setCatalog(fresh.items)
                            setCart((prev) => prev.map((l) => {
                              if (l.itemId !== item.id) return l
                              const updated = res.item || { ...item, salePrice, volumePriceTiers: tiers }
                              const nxt = tieredUnitPrice(updated, l.qty)
                              const unit = nxt.unitPrice > 0 ? nxt.unitPrice : salePrice
                              return { ...l, baseUnitPrice: salePrice, unitPrice: unit, importe: nxt.lineTotal, appliedTierMinQty: nxt.appliedMinQty, appliedTierSaving: nxt.saving }
                            }))
                            setPromoView('list')
                          } catch (e: any) {
                            setVolumeError(e?.message || 'No se pudo guardar. Revisa conexión.')
                          } finally {
                            setVolumeSaving(false)
                          }
                        })()
                      }}
                      className={cn(
                        'rounded-[14px] px-5 py-2 text-[12.5px] font-bold text-white transition inline-flex items-center gap-1.5',
                        (!promoFormProductId || volumeRows.length === 0 || volumeSaving) ? 'bg-[#1090D0]/50 opacity-70' : 'bg-[#1090D0] hover:bg-[#0f7fba] shadow-[0_4px_14px_-4px_rgba(16,144,208,0.8)]'
                      )}>
                      {volumeSaving ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                      Guardar
                    </button>
                  </div>
                </div>
              </>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* ===== CONFIRMAR BORRAR GRUPO PROMOCIÓN ===== */}
      {confirmDeleteGroup ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md overflow-hidden rounded-[20px] border border-[#1a3a5a] bg-[#0f3151] shadow-2xl shadow-black/60">
            <div className="p-5">
              <div className="flex items-start gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] bg-rose-500/15 text-rose-300">
                  <Trash2 className="h-6 w-6" />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="text-[15.5px] font-bold text-slate-50">Eliminar grupo</h3>
                  <p className="mt-1.5 text-[12.5px] leading-relaxed text-slate-300">
                    Se eliminará permanentemente el grupo{' '}
                    <span className="font-semibold text-white">{confirmDeleteGroup.name}</span>.
                    Las promociones individuales de cada producto no se tocan.
                  </p>
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[#1a3a5a] px-5 py-4">
              <button type="button" onClick={() => setConfirmDeleteGroup(null)}
                className="rounded-[14px] border border-[#1a3a5a] bg-[#11375a] px-4 py-2 text-[12.5px] font-semibold text-slate-200 transition hover:border-[#1090D0]/40 hover:text-white">
                Cancelar
              </button>
              <button type="button" onClick={() => void handleDeleteGroup()}
                className="rounded-[14px] border border-rose-500/30 bg-rose-500 px-4 py-2 text-[12.5px] font-bold text-white transition hover:bg-rose-600 inline-flex items-center gap-1.5">
                <Trash2 className="h-4 w-4" />
                Eliminar grupo
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* ===== CONFIRMAR BORRAR PROMOCIÓN INDIVIDUAL (1 PRODUCTO) ===== */}
      {confirmDeletePromo ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md overflow-hidden rounded-[20px] border border-[#1a3a5a] bg-[#0f3151] shadow-2xl shadow-black/60">
            <div className="p-5">
              <div className="flex items-start gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] bg-rose-500/15 text-rose-300">
                  <Trash2 className="h-6 w-6" />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="text-[15.5px] font-bold text-slate-50">Quitar promoción del producto</h3>
                  <p className="mt-1.5 text-[12.5px] leading-relaxed text-slate-300">
                    Se eliminarán TODOS los niveles de promoción por cantidad del producto{' '}
                    <span className="font-semibold text-white">{confirmDeletePromo.name}</span>{' '}
                    y volverá a su precio base{' '}
                    <span className="font-mono font-semibold text-[#5bbfe5]">
                      ${Number(confirmDeletePromo.salePrice || 0).toFixed(2)}
                    </span>
                    . El producto NO se elimina del catálogo.
                  </p>
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[#1a3a5a] px-5 py-4">
              <button type="button" onClick={() => setConfirmDeletePromo(null)}
                className="rounded-[14px] border border-[#1a3a5a] bg-[#11375a] px-4 py-2 text-[12.5px] font-semibold text-slate-200 transition hover:border-[#1090D0]/40 hover:text-white">
                Cancelar
              </button>
              <button type="button" onClick={() => void handleDeletePromo()}
                className="rounded-[14px] border border-rose-500/30 bg-rose-500 px-4 py-2 text-[12.5px] font-bold text-white transition hover:bg-rose-600 inline-flex items-center gap-1.5">
                <Trash2 className="h-4 w-4" />
                Quitar promoción
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  )
}
