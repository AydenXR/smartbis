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
} from 'lucide-react'
import { cn, tieredUnitPrice, type TieredPriceResult } from '@/lib/utils'
import {
  type ItemKind,
  type PaymentMethod,
  type PosBranch,
  type PosCatalogItem,
  type PosSaleLine,
  type PosShift,
  posBranches,
  posCatalog,
  posCatalogSave,
  posFrequentProducts,
  posShiftMyOpen,
  posShiftOpen,
  posShiftWithdraw,
  posShiftClose,
  posSaleCreate,
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
type PromoView = 'list' | 'ticket' | 'form'

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

export default function CrmPosView() {
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
  const [itemSearch, setItemSearch] = useState('')
  const [catalog, setCatalog] = useState<PosCatalogItem[]>([])
  const [catalogLoading, setCatalogLoading] = useState(false)
  const [showSuggestions, setShowSuggestions] = useState(false)
  const searchContainerRef = useRef<HTMLDivElement>(null)

  const [cart, setCart] = useState<CartLine[]>([])

  const [discount, setDiscount] = useState<number>(0)
  const [paidAmount, setPaidAmount] = useState<number>(0)

  const [frequent, setFrequent] = useState<FrequentItem[]>([])
  const [frequentLoading, setFrequentLoading] = useState(false)

  const [checkout, setCheckout] = useState<CheckoutModalState | null>(null)
  const [payMethod, setPayMethod] = useState<PaymentMethod>('cash')
  const [paymentAmount, setPaymentAmount] = useState(0)
  const [processingPayment, setProcessingPayment] = useState(false)

  const [withdrawModal, setWithdrawModal] = useState<WithdrawModalState>(null)
  const [withdrawAmount, setWithdrawAmount] = useState<number>(0)
  const [withdrawReason, setWithdrawReason] = useState('')
  const [withdrawBusinessExpense, setWithdrawBusinessExpense] = useState(false)
  const [processingWithdraw, setProcessingWithdraw] = useState(false)

  const [promoModal, setPromoModal] = useState<PromoModalState>(null)
  const [promoView, setPromoView] = useState<PromoView>('list')
  const [promoMode, setPromoMode] = useState<PromoModalMode>('percent')
  const [promoValue, setPromoValue] = useState<string>('')
  const [promoSearch, setPromoSearch] = useState<string>('')
  const [promoFormProductId, setPromoFormProductId] = useState<string>('')
  const [promoFormProductSearch, setPromoFormProductSearch] = useState<string>('')
  const [volumeRows, setVolumeRows] = useState<PromoVolumeRow[]>([])
  const [volumeSaving, setVolumeSaving] = useState(false)
  const [volumeError, setVolumeError] = useState<string>('')

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

  async function loadCatalog() {
    setCatalogLoading(true)
    try {
      const res = await posCatalog({ activeOnly: true })
      setCatalog(res.items)
    } finally {
      setCatalogLoading(false)
    }
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

  useEffect(() => {
    void loadBranches()
    void loadShift()
    void loadCatalog()
  }, [])

  useEffect(() => {
    if (shift) {
      void loadFrequent()
    }
  }, [shift?.id])

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
    const q = itemSearch.trim().toLowerCase()
    if (!q) return []
    return catalog
      .filter(
        (i) =>
          i.name.toLowerCase().includes(q) ||
          i.sku.toLowerCase().includes(q) ||
          (i.family || '').toLowerCase().includes(q),
      )
      .slice(0, 8)
  }, [itemSearch, catalog])

  function addCatalogItemToCart(item: PosCatalogItem, qtyOverride?: number) {
    const qty = qtyOverride ?? itemQty
    if (qty <= 0) return
    const currentStock = item.stocks?.[shift?.branchId || ''] ?? 0
    const tier = tieredUnitPrice(item, qty)
    const lineId = `cart-${item.id}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    setCart((prev) => {
      const existingIdx = prev.findIndex((l) => l.itemId === item.id)
      if (existingIdx >= 0) {
        const copy = [...prev]
        const ex = copy[existingIdx]
        const newQty = ex.qty + qty
        const nextTier = tieredUnitPrice(item, newQty)
        const unit = nextTier.unitPrice > 0 ? nextTier.unitPrice : item.salePrice
        copy[existingIdx] = {
          ...ex,
          qty: newQty,
          unitPrice: unit,
          importe: Number((newQty * unit).toFixed(2)),
          appliedTierMinQty: nextTier.appliedMinQty,
          appliedTierSaving: nextTier.saving,
        }
        return copy
      }
      const unit = tier.unitPrice > 0 ? tier.unitPrice : item.salePrice
      const line: CartLine = {
        id: lineId,
        itemId: item.id,
        sku: item.sku,
        name: item.name,
        qty,
        unitPrice: unit,
        importe: Number((qty * unit).toFixed(2)),
        stockInBranch: currentStock,
        baseUnitPrice: item.salePrice,
        appliedTierMinQty: tier.appliedMinQty,
        appliedTierSaving: tier.saving,
      }
      return [...prev, line]
    })
    setItemSearch('')
    setItemQty(1)
    setShowSuggestions(false)
  }

  function addFrequentToCart(f: FrequentItem) {
    const matching = catalog.find((c) => c.id === f.itemId)
    if (matching) {
      addCatalogItemToCart(matching, 1)
      return
    }
    const lineId = `cart-${f.itemId}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    setCart((prev) => {
      const existingIdx = prev.findIndex((l) => l.itemId === f.itemId)
      if (existingIdx >= 0) {
        const copy = [...prev]
        const ex = copy[existingIdx]
        const newQty = ex.qty + 1
        copy[existingIdx] = {
          ...ex,
          qty: newQty,
          importe: Number((newQty * ex.unitPrice).toFixed(2)),
        }
        return copy
      }
      return [
        ...prev,
        {
          id: lineId,
          itemId: f.itemId,
          sku: f.sku,
          name: f.name,
          qty: 1,
          unitPrice: f.salePrice,
          importe: Number(f.salePrice.toFixed(2)),
          stockInBranch: f.stock,
          baseUnitPrice: f.salePrice,
          appliedTierMinQty: null,
          appliedTierSaving: 0,
        },
      ]
    })
    showToast(`Agregado: ${f.name}`)
  }

  function updateCartLineQty(id: string, nextQty: number) {
    if (nextQty <= 0) {
      setCart((prev) => prev.filter((l) => l.id !== id))
      return
    }
    setCart((prev) =>
      prev.map((l) => {
        if (l.id !== id) return l
        const item = catalog.find((c) => c.id === l.itemId)
        const base = l.baseUnitPrice || l.unitPrice
        let tier: TieredPriceResult = {
          unitPrice: l.unitPrice,
          appliedMinQty: l.appliedTierMinQty,
          discountPerUnit: 0,
          saving: 0,
        }
        if (item) {
          tier = tieredUnitPrice(item, nextQty)
        } else if (nextQty === 1) {
          tier = { unitPrice: base, appliedMinQty: null, discountPerUnit: 0, saving: 0 }
        }
        const unit = tier.unitPrice > 0 ? tier.unitPrice : base
        return {
          ...l,
          qty: nextQty,
          unitPrice: unit,
          importe: Number((nextQty * unit).toFixed(2)),
          appliedTierMinQty: tier.appliedMinQty,
          appliedTierSaving: tier.saving > 0 ? tier.saving : 0,
        }
      }),
    )
  }

  function removeCartLine(id: string) {
    setCart((prev) => prev.filter((l) => l.id !== id))
  }

  const cartSubtotal = useMemo(
    () => cart.reduce((s, l) => s + l.importe, 0),
    [cart],
  )

  const cartIva = useMemo(() => {
    if (!shiftBranch?.ivaEnabled) return 0
    const rate = shiftBranch.ivaRate > 1 ? shiftBranch.ivaRate / 100 : shiftBranch.ivaRate
    return Number((cartSubtotal * rate).toFixed(2))
  }, [cartSubtotal, shiftBranch])

  const cartTotal = useMemo(
    () => Number((cartSubtotal + cartIva - (discount || 0)).toFixed(2)),
    [cartSubtotal, cartIva, discount],
  )

  const ivaEnabledCalc = !!shiftBranch?.ivaEnabled

  function openCheckout() {
    if (cart.length === 0 || !shift) return
    setPaidAmount(0)
    setPaymentAmount(cartTotal)
    setPayMethod('cash')
    setCheckout({
      open: true,
      subtotal: cartSubtotal,
      iva: cartIva,
      discount: discount || 0,
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
      const methodAmount = Math.min(paymentAmount || 0, checkout.total)
      await posSaleCreate({
        branchId: shift.branchId,
        shiftId: shift.id,
        customerName: customerName.trim() || undefined,
        requiresFactura,
        status: 'paid',
        lines,
        payments:
          methodAmount > 0
            ? [
                {
                  id: `p-${Date.now()}`,
                  method: payMethod,
                  amount: methodAmount,
                  at: new Date().toISOString(),
                },
              ]
            : [],
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

  const totalWithdrawals = useMemo(() => {
    return (
      shift?.cashWithdrawals?.reduce((s, w) => s + w.amount, 0) || 0
    )
  }, [shift])

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
            onClick={() => shift && setCloseShiftModal({ open: true })}
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
                    onClick={() => setItemQty((v) => Math.max(1, v - 1))}
                    className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-300 transition hover:bg-[#1090D0]/15 hover:text-[#5bbfe5]"
                  >
                    <Minus className="h-3.5 w-3.5" />
                  </button>
                  <div className="flex w-9 items-center justify-center rounded-lg bg-black/30">
                    <span className="font-mono text-[13px] font-extrabold text-white">{itemQty}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setItemQty((v) => v + 1)}
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
                        setItemSearch(e.target.value)
                        setShowSuggestions(true)
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
                            </div>
                            <div className="text-[10px] leading-tight text-slate-500 flex items-center gap-2 flex-wrap">
                              <span>Stock {l.stockInBranch}{l.sku ? <> · {l.sku}</> : null}</span>
                              {l.appliedTierMinQty && l.baseUnitPrice > 0 && l.unitPrice < l.baseUnitPrice ? (
                                <span className="text-emerald-300 font-bold tracking-wide">
                                  Base: ${l.baseUnitPrice.toFixed(2)} · Ahorras ${(l.appliedTierSaving || 0).toFixed(2)}
                                </span>
                              ) : null}
                            </div>
                          </td>
                          <td className="px-2.5 py-1.5 text-right font-mono text-[12px] text-slate-200">
                            {l.appliedTierMinQty && l.baseUnitPrice > 0 && l.unitPrice < l.baseUnitPrice ? (
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

          <div className="rounded-2xl border border-[#1a3a5a] bg-[#0f3151] px-3 py-2" style={{ maxHeight: '80px' }}>
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
            </div>

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
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#1090D0]/15 text-[#5bbfe5] opacity-80 transition group-hover:bg-[#1090D0] group-hover:text-white">
                      <Plus className="h-3.5 w-3.5" />
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
                onClick={() => setOpenShiftModal(null)}
                className="rounded-lg border border-[#1a3a5a] bg-[#11375a] px-3.5 py-1.5 text-[11.5px] font-semibold text-slate-200 transition hover:border-[#1090D0]/40 hover:text-white"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={!branchForShift}
                onClick={() => void handleOpenShift()}
                className={cn(
                  'rounded-lg px-4 py-1.5 text-[11.5px] font-bold text-white transition',
                  !branchForShift
                    ? 'bg-[#1090D0]/40 opacity-60'
                    : 'bg-[#1090D0] hover:bg-[#0c79ae] shadow-[0_4px_14px_-4px_rgba(16,144,208,0.8)]',
                )}
              >
                <span className="inline-flex items-center gap-1">
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
              <div className="grid grid-cols-3 gap-1.5 rounded-xl border border-[#1a3a5a] bg-[#0b2641]/60 p-1.5 text-[10.5px]">
                <div className="rounded-lg px-2.5 py-1.5">
                  <div className="text-[9px] font-bold uppercase tracking-wider text-slate-400">
                    Subtotal
                  </div>
                  <div className="font-mono text-[13px] font-bold text-slate-100">
                    ${checkout.subtotal.toFixed(2)}
                  </div>
                </div>
                <div className="rounded-lg px-2.5 py-1.5">
                  <div className="text-[9px] font-bold uppercase tracking-wider text-slate-400">
                    IVA
                  </div>
                  <div className="font-mono text-[13px] font-bold text-emerald-200">
                    ${checkout.iva.toFixed(2)}
                  </div>
                </div>
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
                <div className="grid grid-cols-3 gap-1 rounded-xl border border-[#1a3a5a] bg-[#0b2641] p-1">
                  {(
                    [
                      { id: 'cash', label: 'Efectivo', icon: Banknote },
                      { id: 'card', label: 'Tarjeta', icon: CreditCard },
                      { id: 'transfer', label: 'Transfer', icon: Send },
                    ] as Array<{ id: PaymentMethod; label: string; icon: any }>
                  ).map((opt) => {
                    const Icon = opt.icon
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => setPayMethod(opt.id)}
                        className={cn(
                          'flex flex-col items-center justify-center gap-0.5 rounded-lg px-2 py-2 text-[9.5px] font-bold transition',
                          payMethod === opt.id
                            ? 'bg-[#1090D0] text-white shadow-inner'
                            : 'text-slate-300 hover:text-white',
                        )}
                      >
                        <Icon className="h-4 w-4" />
                        <span className="whitespace-nowrap">{opt.label}</span>
                      </button>
                    )
                  })}
                </div>
              </div>

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
            </div>

            <div className="flex flex-wrap items-center justify-end gap-1.5 border-t border-[#1a3a5a] px-4 py-3 flex-shrink-0">
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

      {closeShiftModal?.open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md overflow-hidden rounded-2xl border border-amber-500/30 bg-[#0f3151] shadow-2xl shadow-black/60">
            <div className="flex items-center justify-between border-b border-[#1a3a5a] bg-gradient-to-r from-amber-500/10 via-transparent to-transparent px-5 py-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px] bg-amber-500/15 text-amber-300">
                  <Clock className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-[16px] font-bold text-slate-50">Cerrar turno</h3>
                  <p className="mt-0.5 text-[11.5px] text-slate-400">
                    {shift?.openedAt ? `Abierto desde ${new Date(shift.openedAt).toLocaleString()}` : ''}
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
            <div className="space-y-4 p-5">
              <div className="rounded-[14px] border border-amber-500/20 bg-amber-500/5 px-4 py-3">
                <p className="text-[12.5px] leading-relaxed text-slate-200">
                  <span className="font-bold text-amber-300">⚠️ Aviso:</span> al cerrar el turno ya no podrás registrar ventas o retiros asociados a este corte. Se marcará como cerrado y quedará registrado en auditoría.
                </p>
                {shift ? (
                  <div className="mt-3 grid grid-cols-2 gap-2 text-[11.5px]">
                    <div className="rounded-[10px] border border-[#1a3a5a] bg-[#0b2641] px-3 py-2">
                      <div className="text-slate-400">Efectivo inicial</div>
                      <div className="font-mono text-[13px] font-bold text-slate-100">
                        ${Number(shift.initialCash || 0).toFixed(2)}
                      </div>
                    </div>
                    <div className="rounded-[10px] border border-[#1a3a5a] bg-[#0b2641] px-3 py-2">
                      <div className="text-slate-400">Retiros</div>
                      <div className="font-mono text-[13px] font-bold text-rose-200">
                        -${totalWithdrawals.toFixed(2)}
                      </div>
                    </div>
                    <div className="rounded-[10px] border border-[#1a3a5a] bg-[#0b2641] px-3 py-2">
                      <div className="text-slate-400">Ventas turno</div>
                      <div className="font-mono text-[13px] font-bold text-emerald-200">
                        #{shift.salesCount || 0}
                      </div>
                    </div>
                    <div className="rounded-[10px] border border-[#1a3a5a] bg-[#0b2641] px-3 py-2">
                      <div className="text-slate-400">Total ventas</div>
                      <div className="font-mono text-[13px] font-bold text-[#5bbfe5]">
                        ${Number(shift.salesTotal || 0).toFixed(2)}
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[#1a3a5a] px-5 py-4">
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
                    {promoView === 'list' ? 'Promociones' : promoView === 'ticket' ? 'Descuento del ticket' : promoFormProductId ? 'Editar promoción' : 'Nueva promoción'}
                  </h3>
                  <p className="mt-0.5 text-[11.5px] text-slate-400 truncate">
                    {promoView === 'list' ? 'Promociones por cantidad guardadas. Clic en una para editar o crea una nueva.'
                    : promoView === 'ticket' ? 'Aplica un % o un monto de descuento a TODO el carrito actual.'
                    : 'Elige un producto y define sus rangos de precio por cantidad.'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {promoView !== 'list' ? (
                  <button type="button" onClick={() => { setPromoView('list'); setVolumeError('') }}
                    className="rounded-xl border border-[#1a3a5a] bg-[#11375a] px-3 py-2 text-[11px] font-semibold text-slate-200 transition hover:border-[#1090D0]/40 hover:text-white flex items-center gap-1">
                    ← Todas las promociones
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

            {/* ===== LISTA / GRID 3 cols ===== */}
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
                  <button type="button" onClick={() => setPromoView('ticket')}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-[14px] border px-4 py-2.5 text-[11.5px] font-bold uppercase tracking-wider transition flex-shrink-0',
                      discount > 0
                        ? 'border-amber-400/60 bg-amber-400/15 text-amber-200'
                        : 'border-[#1a3a5a] bg-[#0b2641] text-slate-300 hover:border-amber-400/50 hover:text-amber-200'
                    )}>
                    <Percent className="h-4 w-4" />
                    {discount > 0 ? `Ticket -$${discount.toFixed(2)}` : 'Descuento ticket'}
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
                        .filter((c) => c.active && (c.volumePriceTiers || []).length > 0)
                        .filter((c) => !q ? true : [c.name, c.sku, c.family, c.category, (c.tags || []).join(' ')].join(' ').toLowerCase().includes(q))
                        .sort((a, b) => (b.updatedAt || b.createdAt).localeCompare(a.updatedAt || a.createdAt))
                      const cards: JSX.Element[] = []
                      for (const p of promos) {
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
                                    🎁 {(p.volumePriceTiers || []).length} rangos
                                  </span>
                                </div>
                              </div>
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
                                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#1a3a5a] bg-[#0f3151] text-slate-300 transition group-hover:border-[#1090D0]/40 group-hover:bg-[#1090D0]/10 group-hover:text-[#7fd2ff] shadow">
                                <RefreshCw className="h-3.5 w-3.5 -scale-x-100" />
                              </button>
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
                              return { ...l, baseUnitPrice: salePrice, unitPrice: unit, importe: Number((l.qty * unit).toFixed(2)), appliedTierMinQty: nxt.appliedMinQty, appliedTierSaving: nxt.saving }
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
    </section>
  )
}
