import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Plus, ReceiptText, Save, Search, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  posBranches,
  posCatalog,
  posPurchaseCreate,
  posPurchaseDelete,
  posPurchases,
  type PosBranch,
  type PosCatalogItem,
  type PosPurchaseLine,
  type PosPurchaseOrder,
} from '@/lib/api'

type PurchaseLineDraft = {
  id: number
  itemId: string
  newItemName: string
  quantity: string
  unitCost: string
  salePrice: string
  shippingCost: string
}

const NEW_PRODUCT = '__new_product__'

function createLineDraft(id: number): PurchaseLineDraft {
  return {
    id,
    itemId: '',
    newItemName: '',
    quantity: '1',
    unitCost: '',
    salePrice: '',
    shippingCost: '0',
  }
}

function currencyLabel(value: number, currency: string) {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: currency || 'MXN',
    maximumFractionDigits: 2,
  }).format(value)
}

function safeAmount(value: string) {
  const amount = Number(value)
  return Number.isFinite(amount) ? Math.max(0, amount) : 0
}

function purchaseLineTotal(line: PurchaseLineDraft) {
  return Math.round((safeAmount(line.quantity) * safeAmount(line.unitCost) + safeAmount(line.shippingCost)) * 100) / 100
}

type ProductSearchProps = {
  products: PosCatalogItem[]
  selectedId: string
  newItemName: string
  onSelect: (productId: string) => void
  onCreate: (productName: string) => void
}

function ProductSearch({ products, selectedId, newItemName, onSelect, onCreate }: ProductSearchProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const listId = useId()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [menuPosition, setMenuPosition] = useState<{ left: number; top: number; width: number; maxHeight: number } | null>(null)
  const selectedProduct = products.find((product) => product.id === selectedId)
  const matchingProducts = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase()
    return products
      .filter((product) => product.active)
      .filter((product) =>
        !normalizedQuery ||
        `${product.name} ${product.sku} ${product.category || ''} ${product.family || ''}`
          .toLocaleLowerCase()
          .includes(normalizedQuery),
      )
      .slice(0, 30)
  }, [products, query])

  function updateMenuPosition() {
    const bounds = inputRef.current?.getBoundingClientRect()
    if (!bounds) return
    const roomBelow = window.innerHeight - bounds.bottom - 8
    const roomAbove = bounds.top - 8
    const showAbove = roomBelow < 180 && roomAbove > roomBelow
    const maxHeight = Math.max(80, Math.min(240, showAbove ? roomAbove : roomBelow))
    const width = Math.min(Math.max(bounds.width, 360), window.innerWidth - 16)
    setMenuPosition({
      left: Math.min(Math.max(bounds.left, 8), window.innerWidth - width - 8),
      top: showAbove ? Math.max(8, bounds.top - maxHeight - 4) : bounds.bottom + 4,
      width,
      maxHeight,
    })
  }

  useEffect(() => {
    if (!open) return
    updateMenuPosition()
    window.addEventListener('resize', updateMenuPosition)
    window.addEventListener('scroll', updateMenuPosition, true)
    return () => {
      window.removeEventListener('resize', updateMenuPosition)
      window.removeEventListener('scroll', updateMenuPosition, true)
    }
  }, [open])

  function openSearch() {
    setQuery('')
    setOpen(true)
    requestAnimationFrame(updateMenuPosition)
  }

  function selectProduct(productId: string) {
    onSelect(productId)
    setQuery('')
    setOpen(false)
  }

  const displayValue = open
    ? query
    : selectedId === NEW_PRODUCT
      ? `Producto nuevo: ${newItemName}`
      : selectedProduct?.name || ''

  return (
    <div className="relative min-w-[220px]">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          ref={inputRef}
          type="text"
          value={displayValue}
          onFocus={openSearch}
          onChange={(event) => {
            setQuery(event.target.value)
            setOpen(true)
            requestAnimationFrame(updateMenuPosition)
          }}
          onBlur={() => {
            setOpen(false)
            setQuery('')
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              setOpen(false)
              setQuery('')
            } else if (event.key === 'Enter' && open) {
              event.preventDefault()
              if (matchingProducts[0]) selectProduct(matchingProducts[0].id)
              else if (query.trim()) {
                onCreate(query.trim())
                setQuery('')
                setOpen(false)
              }
            }
          }}
          role="combobox"
          aria-label="Buscar producto o agregar producto nuevo"
          aria-autocomplete="list"
          aria-controls={listId}
          aria-expanded={open}
          placeholder="Buscar producto..."
          title={displayValue}
          className="w-full rounded-lg border border-[#255074] bg-[#0b2641] py-2 pl-9 pr-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-[#1090D0]"
        />
      </div>
      {!open && selectedProduct ? (
        <p className="mt-1 whitespace-normal break-words text-xs leading-snug text-slate-300">{selectedProduct.name}</p>
      ) : null}
      {open && menuPosition
        ? createPortal(
            <div
              className="overflow-y-auto rounded-lg border border-[#255074] bg-[#0b2641] p-1 shadow-xl shadow-black/40"
              id={listId}
              role="listbox"
              style={{
                position: 'fixed',
                zIndex: 1000,
                left: menuPosition.left,
                top: menuPosition.top,
                width: menuPosition.width,
                maxHeight: menuPosition.maxHeight,
              }}
            >
              {matchingProducts.map((product) => (
                <button
                  key={product.id}
                  type="button"
                  role="option"
                  aria-selected={selectedId === product.id}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => selectProduct(product.id)}
                  className="flex w-full items-start justify-between gap-3 rounded-md px-3 py-2 text-left text-sm text-slate-100 transition hover:bg-[#1090D0]/20"
                >
                  <span className="min-w-0 flex-1 whitespace-normal break-words">{product.name}</span>
                  <span className="shrink-0 pt-0.5 text-[11px] text-slate-400">{product.sku}</span>
                </button>
              ))}
              {query.trim() ? (
                <>
                  {matchingProducts.length === 0 ? (
                    <p className="px-3 py-2 text-sm text-slate-400">No se encontraron productos coincidentes.</p>
                  ) : null}
                  <button
                    type="button"
                    role="option"
                    aria-selected={selectedId === NEW_PRODUCT}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      onCreate(query.trim())
                      setQuery('')
                      setOpen(false)
                    }}
                    className="flex w-full items-start gap-2 rounded-md border-t border-[#1a3a5a] px-3 py-2.5 text-left text-sm font-semibold text-[#8fd2ec] transition hover:bg-[#1090D0]/20"
                  >
                    <Plus className="mt-0.5 h-4 w-4 shrink-0" />
                    <span className="whitespace-normal break-words">Agregar “{query.trim()}” como producto nuevo</span>
                  </button>
                </>
              ) : null}
              {matchingProducts.length === 0 && !query.trim() ? (
                <p className="px-3 py-2 text-sm text-slate-400">No hay productos activos en el catálogo.</p>
              ) : null}
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}

export default function CrmPurchasesView() {
  const [branches, setBranches] = useState<PosBranch[]>([])
  const [products, setProducts] = useState<PosCatalogItem[]>([])
  const [purchases, setPurchases] = useState<PosPurchaseOrder[]>([])
  const [branchId, setBranchId] = useState('')
  const [providerName, setProviderName] = useState('')
  const [folio, setFolio] = useState('')
  const [purchaseDate, setPurchaseDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<PurchaseLineDraft[]>([createLineDraft(1)])
  const [nextLineId, setNextLineId] = useState(2)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deletingPurchaseId, setDeletingPurchaseId] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const activeBranch = branches.find((branch) => branch.id === branchId)
  const currency = activeBranch?.currency || 'MXN'
  const purchaseTotal = useMemo(
    () => Math.round(lines.reduce((total, line) => total + purchaseLineTotal(line), 0) * 100) / 100,
    [lines],
  )

  async function loadData() {
    setLoading(true)
    setError('')
    try {
      const [branchResult, catalogResult, purchaseResult] = await Promise.all([
        posBranches(),
        posCatalog({ kinds: ['product'], activeOnly: false }),
        posPurchases(),
      ])
      const activeBranches = branchResult.branches.filter((branch) => branch.active)
      setBranches(activeBranches)
      setProducts(catalogResult.items)
      setPurchases(purchaseResult.purchases)
      setBranchId((current) =>
        activeBranches.some((branch) => branch.id === current)
          ? current
          : activeBranches.find((branch) => branch.isMain)?.id || activeBranches[0]?.id || '',
      )
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'No se pudieron cargar las compras.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadData()
  }, [])

  function updateLine(id: number, update: Partial<PurchaseLineDraft>) {
    setLines((current) => current.map((line) => (line.id === id ? { ...line, ...update } : line)))
  }

  function addLine() {
    setLines((current) => [...current, createLineDraft(nextLineId)])
    setNextLineId((current) => current + 1)
  }

  function removeLine(id: number) {
    setLines((current) => current.filter((line) => line.id !== id))
  }

  async function handleSavePurchase() {
    setError('')
    setSuccess('')

    if (!branchId) {
      setError('Selecciona la sucursal que recibirá los productos.')
      return
    }
    if (!providerName.trim()) {
      setError('Escribe el nombre del proveedor.')
      return
    }
    if (lines.length === 0) {
      setError('Agrega al menos un producto a la compra.')
      return
    }

    const purchaseLines: PosPurchaseLine[] = []
    for (const [index, line] of lines.entries()) {
      const quantity = Number(line.quantity)
      const unitCost = Number(line.unitCost)
      const salePrice = line.salePrice.trim() ? Number(line.salePrice) : 0
      const shippingCost = Number(line.shippingCost)
      const isNewItem = line.itemId === NEW_PRODUCT
      const selectedProduct = products.find((product) => product.id === line.itemId)

      if (!isNewItem && !selectedProduct) {
        setError(`Selecciona un producto para la línea ${index + 1}.`)
        return
      }
      if (isNewItem && !line.newItemName.trim()) {
        setError(`Escribe el nombre del producto nuevo en la línea ${index + 1}.`)
        return
      }
      if (!Number.isInteger(quantity) || quantity < 1) {
        setError(`La cantidad de la línea ${index + 1} debe ser un entero mayor a cero.`)
        return
      }
      if (!line.unitCost.trim()) {
        setError(`Escribe el costo unitario de la línea ${index + 1}.`)
        return
      }
      if (!Number.isFinite(unitCost) || unitCost < 0) {
        setError(`El costo unitario de la línea ${index + 1} no es válido.`)
        return
      }
      if (!Number.isFinite(salePrice) || salePrice < 0) {
        setError(`El precio de venta de la línea ${index + 1} no es válido.`)
        return
      }
      if (!line.shippingCost.trim()) {
        setError(`Escribe el costo de envío de la línea ${index + 1}; usa 0 si no aplica.`)
        return
      }
      if (!Number.isFinite(shippingCost) || shippingCost < 0) {
        setError(`El envío de la línea ${index + 1} no es válido.`)
        return
      }

      purchaseLines.push({
        itemId: selectedProduct?.id || '',
        qty: quantity,
        unitCost,
        salePrice,
        shippingCost,
        totalCost: quantity * unitCost + shippingCost,
        isNewItem,
        newItemName: isNewItem ? line.newItemName.trim() : undefined,
        newItemKind: 'product',
      })
    }

    setSaving(true)
    try {
      await posPurchaseCreate({
        branchId,
        date: new Date(`${purchaseDate}T12:00:00`).toISOString(),
        providerName: providerName.trim(),
        folio: folio.trim() || undefined,
        total: purchaseTotal,
        currency,
        lines: purchaseLines,
        notes: notes.trim() || undefined,
      })
      setProviderName('')
      setFolio('')
      setNotes('')
      setLines([createLineDraft(nextLineId)])
      setNextLineId((current) => current + 1)
      await loadData()
      setSuccess('Compra registrada y existencias actualizadas.')
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'No se pudo registrar la compra.')
    } finally {
      setSaving(false)
    }
  }

  async function handleDeletePurchase(purchase: PosPurchaseOrder) {
    const detail = `${purchase.providerName}${purchase.folio ? ` (folio ${purchase.folio})` : ''}`
    if (!window.confirm(`¿Eliminar la compra de ${detail}? Esta acción también descontará del inventario las cantidades recibidas en esa compra.`)) return
    setError('')
    setSuccess('')
    setDeletingPurchaseId(purchase.id)
    try {
      await posPurchaseDelete(purchase.id)
      setPurchases((current) => current.filter((item) => item.id !== purchase.id))
      setSuccess('Compra eliminada y existencias ajustadas.')
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'No se pudo eliminar la compra.')
    } finally {
      setDeletingPurchaseId('')
    }
  }

  const branchNames = useMemo(
    () => new Map(branches.map((branch) => [branch.id, branch.name])),
    [branches],
  )

  return (
    <section className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-4 xl:p-6">
      <header className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-[#1a3a5a] bg-[#0f3151] p-5">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.25em] text-[#5bbfe5]">Punto de Venta · #3</p>
          <h1 className="mt-1 text-2xl font-extrabold text-white">Compras</h1>
          <p className="mt-1 text-sm text-slate-300">Registra las compras a proveedores y actualiza el inventario al recibir los productos.</p>
        </div>
        <div className="flex items-center gap-3 rounded-xl border border-[#1a3a5a] bg-[#0b2641]/70 px-4 py-3">
          <ReceiptText className="h-5 w-5 text-[#5bbfe5]" />
          <div>
            <p className="text-[11px] uppercase tracking-wider text-slate-400">Compras registradas</p>
            <p className="text-lg font-bold text-white">{purchases.length}</p>
          </div>
        </div>
      </header>

      {error ? (
        <div role="alert" className="rounded-xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">{error}</div>
      ) : null}
      {success ? (
        <div role="status" className="rounded-xl border border-emerald-400/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">{success}</div>
      ) : null}

      <div className="rounded-2xl border border-[#1a3a5a] bg-[#0f3151] p-5">
        <h2 className="text-lg font-bold text-white">Registrar compra</h2>
        <p className="mt-1 text-xs text-slate-400">Cada compra recibida aumenta el inventario y crea un lote con su costo y fecha. El Punto de Venta consume primero el lote más antiguo (FIFO).</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <label className="space-y-1.5 text-xs font-semibold text-slate-300">
            Sucursal de recepción
            <select value={branchId} onChange={(event) => setBranchId(event.target.value)} className="w-full rounded-xl border border-[#255074] bg-[#0b2641] px-3 py-2.5 text-sm text-white outline-none focus:border-[#1090D0]" disabled={loading || branches.length === 0}>
              {branches.length === 0 ? <option value="">Sin sucursales activas</option> : null}
              {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
            </select>
          </label>
          <label className="space-y-1.5 text-xs font-semibold text-slate-300">
            Proveedor
            <input value={providerName} onChange={(event) => setProviderName(event.target.value)} placeholder="Nombre del proveedor" className="w-full rounded-xl border border-[#255074] bg-[#0b2641] px-3 py-2.5 text-sm text-white outline-none placeholder:text-slate-500 focus:border-[#1090D0]" />
          </label>
          <label className="space-y-1.5 text-xs font-semibold text-slate-300">
            Fecha
            <input type="date" value={purchaseDate} onChange={(event) => setPurchaseDate(event.target.value)} className="w-full rounded-xl border border-[#255074] bg-[#0b2641] px-3 py-2.5 text-sm text-white outline-none focus:border-[#1090D0]" />
          </label>
          <label className="space-y-1.5 text-xs font-semibold text-slate-300">
            Folio (opcional)
            <input value={folio} onChange={(event) => setFolio(event.target.value)} placeholder="Factura o ticket" className="w-full rounded-xl border border-[#255074] bg-[#0b2641] px-3 py-2.5 text-sm text-white outline-none placeholder:text-slate-500 focus:border-[#1090D0]" />
          </label>
        </div>

        <div className="mt-5 overflow-x-auto rounded-xl border border-[#1a3a5a]">
          <table className="w-full min-w-[920px] text-left text-sm">
            <thead className="bg-[#0b2641] text-[11px] uppercase tracking-wider text-slate-400">
              <tr>
                <th className="px-3 py-3">Nombre del producto</th>
                <th className="px-3 py-3">Cantidad</th>
                <th className="px-3 py-3">Costo unitario</th>
                <th className="px-3 py-3">Precio de venta</th>
                <th className="px-3 py-3">Envío</th>
                <th className="px-3 py-3">Costo total</th>
                <th className="w-12 px-3 py-3"><span className="sr-only">Acciones</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1a3a5a]">
              {lines.map((line) => (
                <tr key={line.id}>
                  <td className="px-3 py-2.5">
                    <ProductSearch
                      products={products}
                      selectedId={line.itemId}
                      newItemName={line.newItemName}
                      onSelect={(itemId) => updateLine(line.id, { itemId, newItemName: '' })}
                      onCreate={(newItemName) => updateLine(line.id, { itemId: NEW_PRODUCT, newItemName })}
                    />
                    {line.itemId === NEW_PRODUCT ? (
                      <input value={line.newItemName} onChange={(event) => updateLine(line.id, { newItemName: event.target.value })} placeholder="Nombre del producto nuevo" className="mt-2 w-full min-w-[220px] rounded-lg border border-[#255074] bg-[#0b2641] px-3 py-2 text-sm text-white outline-none placeholder:text-slate-500 focus:border-[#1090D0]" />
                    ) : null}
                  </td>
                  <td className="px-3 py-2.5"><input type="number" min="1" step="1" value={line.quantity} onChange={(event) => updateLine(line.id, { quantity: event.target.value })} className="w-24 rounded-lg border border-[#255074] bg-[#0b2641] px-3 py-2 text-sm text-white outline-none focus:border-[#1090D0]" aria-label="Cantidad" /></td>
                  <td className="px-3 py-2.5"><input type="number" min="0" step="0.01" value={line.unitCost} onChange={(event) => updateLine(line.id, { unitCost: event.target.value })} className="w-32 rounded-lg border border-[#255074] bg-[#0b2641] px-3 py-2 text-sm text-white outline-none focus:border-[#1090D0]" aria-label="Costo unitario" /></td>
                  <td className="px-3 py-2.5"><input type="number" min="0" step="0.01" value={line.salePrice} onChange={(event) => updateLine(line.id, { salePrice: event.target.value })} className="w-32 rounded-lg border border-[#255074] bg-[#0b2641] px-3 py-2 text-sm text-white outline-none focus:border-[#1090D0]" aria-label="Precio de venta" placeholder="0" /></td>
                  <td className="px-3 py-2.5"><input type="number" min="0" step="0.01" value={line.shippingCost} onChange={(event) => updateLine(line.id, { shippingCost: event.target.value })} className="w-32 rounded-lg border border-[#255074] bg-[#0b2641] px-3 py-2 text-sm text-white outline-none focus:border-[#1090D0]" aria-label="Envío" /></td>
                  <td className="whitespace-nowrap px-3 py-2.5 font-bold text-white">{currencyLabel(purchaseLineTotal(line), currency)}</td>
                  <td className="px-3 py-2.5">
                    <button type="button" onClick={() => removeLine(line.id)} disabled={lines.length === 1} aria-label="Eliminar producto" className="rounded-lg p-2 text-slate-400 transition hover:bg-rose-500/10 hover:text-rose-300 disabled:opacity-30"><Trash2 className="h-4 w-4" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <button type="button" onClick={addLine} className="inline-flex items-center gap-2 rounded-xl border border-[#255074] px-3 py-2 text-sm font-semibold text-slate-200 transition hover:border-[#1090D0]/60 hover:text-white"><Plus className="h-4 w-4" />Agregar producto</button>
          <p className="text-right text-sm text-slate-300">Total de compra <span className="ml-2 text-xl font-extrabold text-white">{currencyLabel(purchaseTotal, currency)}</span></p>
        </div>

        <label className="mt-4 block space-y-1.5 text-xs font-semibold text-slate-300">
          Notas (opcional)
          <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={2} placeholder="Observaciones de la compra" className="w-full resize-y rounded-xl border border-[#255074] bg-[#0b2641] px-3 py-2.5 text-sm text-white outline-none placeholder:text-slate-500 focus:border-[#1090D0]" />
        </label>
        <div className="mt-4 flex justify-end">
          <button type="button" onClick={() => void handleSavePurchase()} disabled={saving || loading || branches.length === 0} className={cn('inline-flex items-center gap-2 rounded-xl bg-[#1090D0] px-5 py-2.5 text-sm font-bold text-white shadow transition hover:bg-[#0c79ae] disabled:cursor-not-allowed disabled:opacity-50')}>
            <Save className="h-4 w-4" />{saving ? 'Guardando compra...' : 'Registrar compra'}
          </button>
        </div>
      </div>

      <div className="rounded-2xl border border-[#1a3a5a] bg-[#0f3151] p-5">
        <h2 className="text-lg font-bold text-white">Historial de compras</h2>
        {loading ? (
          <p className="py-8 text-center text-sm text-slate-400">Cargando compras...</p>
        ) : purchases.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-400">Todavía no hay compras registradas.</p>
        ) : (
          <div className="mt-4 overflow-x-auto rounded-xl border border-[#1a3a5a]">
            <table className="w-full min-w-[980px] text-left text-sm">
              <thead className="bg-[#0b2641] text-[11px] uppercase tracking-wider text-slate-400">
                <tr>
                  <th className="px-3 py-3">Fecha / proveedor</th>
                  <th className="px-3 py-3">Nombre del producto</th>
                  <th className="px-3 py-3">Cantidad</th>
                  <th className="px-3 py-3">Costo unitario</th>
                  <th className="px-3 py-3">Envío</th>
                  <th className="px-3 py-3">Costo total</th>
                  <th className="px-3 py-3">Sucursal</th>
                  <th className="px-3 py-3"><span className="sr-only">Acciones</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1a3a5a]">
                {purchases.flatMap((purchase) => purchase.lines.map((line, index) => {
                  const lineShipping = line.shippingCost ?? 0
                  const lineTotal = line.totalCost ?? (line.qty * line.unitCost + lineShipping)
                  return (
                    <tr key={`${purchase.id}-${line.itemId}-${index}`} className="text-slate-200">
                      <td className="whitespace-nowrap px-3 py-3">
                        <p>{new Date(purchase.date).toLocaleDateString('es-MX')}</p>
                        <p className="text-xs text-slate-400">{purchase.providerName}{purchase.folio ? ` · ${purchase.folio}` : ''}</p>
                      </td>
                      <td className="px-3 py-3 font-semibold text-white">{line.newItemName || products.find((product) => product.id === line.itemId)?.name || line.itemId}</td>
                      <td className="px-3 py-3">{line.qty}</td>
                      <td className="whitespace-nowrap px-3 py-3">{currencyLabel(line.unitCost, purchase.currency)}</td>
                      <td className="whitespace-nowrap px-3 py-3">{currencyLabel(lineShipping, purchase.currency)}</td>
                      <td className="whitespace-nowrap px-3 py-3 font-bold text-white">{currencyLabel(lineTotal, purchase.currency)}</td>
                      <td className="px-3 py-3">{branchNames.get(purchase.branchId) || 'Sucursal eliminada'}</td>
                      <td className="px-3 py-3">
                        <button type="button" onClick={() => void handleDeletePurchase(purchase)} disabled={Boolean(deletingPurchaseId)} aria-label={`Eliminar compra completa de ${purchase.providerName}`} title="Eliminar compra completa" className="rounded-lg p-2 text-slate-400 transition hover:bg-rose-500/10 hover:text-rose-300 disabled:cursor-not-allowed disabled:opacity-40">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  )
                }))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  )
}
