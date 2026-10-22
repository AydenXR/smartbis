import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import type { PosCatalogItem, PromoGroup } from "@/lib/api"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export interface TieredPriceResult {
  unitPrice: number
  lineTotal: number
  appliedMinQty: number | null
  discountPerUnit: number
  saving: number
}

export function tieredUnitPrice(item: PosCatalogItem, qty: number): TieredPriceResult {
  const base = item.salePrice || 0
  const q = Math.max(1, Math.floor(qty || 0))
  const sorted = [...(item.volumePriceTiers || [])]
    .filter(t => typeof t?.minQty === 'number' && typeof t?.price === 'number' && t.minQty >= 1 && t.price >= 0)
    .sort((a, b) => b.minQty - a.minQty)
  const match = sorted.find(t => q >= t.minQty)
  const regularUnit = match ? Math.min(match.price, base) : base
  let bestTotal = regularUnit * q
  let appliedMinQty = match?.minQty ?? null

  const bundles = (item.bundlePriceTiers || [])
    .filter(t => Number.isInteger(t?.quantity) && t.quantity >= 2 && Number.isFinite(t?.totalPrice) && t.totalPrice >= 0)
    .sort((a, b) => a.quantity - b.quantity)
  if (bundles.length) {
    const totals = Array(q + 1).fill(Number.POSITIVE_INFINITY) as number[]
    const maxBundleUsed = Array(q + 1).fill(0) as number[]
    totals[0] = 0
    for (let count = 1; count <= q; count++) {
      totals[count] = totals[count - 1] + base
      maxBundleUsed[count] = maxBundleUsed[count - 1]
      for (const bundle of bundles) {
        if (bundle.quantity > count) continue
        const candidate = totals[count - bundle.quantity] + bundle.totalPrice
        if (candidate < totals[count]) {
          totals[count] = candidate
          maxBundleUsed[count] = Math.max(bundle.quantity, maxBundleUsed[count - bundle.quantity])
        }
      }
    }
    if (totals[q] < bestTotal) {
      bestTotal = totals[q]
      appliedMinQty = maxBundleUsed[q] || null
    }
  }

  const unit = q > 0 ? bestTotal / q : base
  const discountPerUnit = base - unit
  return {
    unitPrice: unit,
    lineTotal: Number(bestTotal.toFixed(2)),
    appliedMinQty,
    discountPerUnit,
    saving: Number((base * q - bestTotal).toFixed(2)),
  }
}

export interface GroupTierMatch {
  groupId: string
  groupName: string
  appliedMinQty: number
  unitPrice: number
  totalQty: number
}

export interface GroupLineResult {
  appliedGroupId: string | null
  appliedGroupName?: string
  appliedGroupMinQty: number | null
  appliedGroupUnitPrice: number | null
  groupSaving: number
  lineUnitPrice: number
  lineImporte: number
}

export interface GroupPromotionsCartResult<L extends { id: string; itemId: string; qty: number; unitPrice: number; importe: number; baseUnitPrice: number; appliedTierSaving?: number; appliedTierMinQty?: number | null }> {
  lines: Array<L & GroupLineResult>
  totalGroupSaving: number
  matchedGroups: GroupTierMatch[]
}

export function applyGroupPromotionsToCart<
  L extends {
    id: string
    itemId: string
    qty: number
    unitPrice: number
    importe: number
    baseUnitPrice: number
    appliedTierSaving?: number
    appliedTierMinQty?: number | null
  },
>(
  linesIn: L[],
  catalog: PosCatalogItem[],
  promoGroups: PromoGroup[],
): GroupPromotionsCartResult<L> {
  if (!linesIn?.length || !promoGroups?.length) {
    return {
      lines: linesIn.map(l => ({
        ...l,
        appliedGroupId: null,
        appliedGroupMinQty: null,
        appliedGroupUnitPrice: null,
        groupSaving: 0,
        lineUnitPrice: l.unitPrice,
        lineImporte: l.importe,
      })),
      totalGroupSaving: 0,
      matchedGroups: [],
    }
  }
  const activeGroups = promoGroups.filter(g => g && g.active && Array.isArray(g.volumePriceTiers) && g.volumePriceTiers.length > 0 && Array.isArray(g.productIds) && g.productIds.length > 0)

  const itemByGroupId: Record<string, PromoGroup> = {}
  const groupsByItemId: Record<string, PromoGroup[]> = {}
  for (const g of activeGroups) {
    itemByGroupId[g.id] = g
    for (const pid of g.productIds) {
      if (!pid) continue
      const arr = groupsByItemId[pid] ||= []
      arr.push(g)
    }
  }

  const qtyByGroupId: Record<string, number> = {}
  for (const l of linesIn) {
    const gs = groupsByItemId[l.itemId] || []
    for (const g of gs) {
      qtyByGroupId[g.id] = (qtyByGroupId[g.id] || 0) + Math.max(0, l.qty || 0)
    }
  }

  const matchedGroups: GroupTierMatch[] = []
  const groupUnitPrices: Record<string, { groupName: string; unitPrice: number; appliedMinQty: number } | undefined> = {}
  for (const g of activeGroups) {
    const totalQty = qtyByGroupId[g.id] || 0
    if (totalQty < 2) continue
    const tiers = [...g.volumePriceTiers]
      .filter(t => typeof t?.minQty === 'number' && typeof t?.price === 'number' && t.minQty >= 2 && t.price >= 0)
      .sort((a, b) => b.minQty - a.minQty)
    const match = tiers.find(t => totalQty >= t.minQty)
    if (!match) continue
    matchedGroups.push({
      groupId: g.id,
      groupName: g.name,
      appliedMinQty: match.minQty,
      unitPrice: match.price,
      totalQty,
    })
    groupUnitPrices[g.id] = { groupName: g.name, unitPrice: match.price, appliedMinQty: match.minQty }
  }

  let totalGroupSaving = 0
  const lines = linesIn.map(line => {
    const groups = groupsByItemId[line.itemId] || []
    let bestGroup: PromoGroup | null = null
    let bestUnitPrice = Number.POSITIVE_INFINITY
    let bestAppliedMinQty: number | null = null
    let bestGroupName: string | undefined
    for (const g of groups) {
      const info = groupUnitPrices[g.id]
      if (!info) continue
      if (info.unitPrice < bestUnitPrice) {
        bestUnitPrice = info.unitPrice
        bestGroup = g
        bestAppliedMinQty = info.appliedMinQty
        bestGroupName = info.groupName
      }
    }
    const baseUnit = Number(line.baseUnitPrice) || Number(line.unitPrice) || 0
    const currentUnit = Number(line.unitPrice) || 0
    if (bestGroup && Number.isFinite(bestUnitPrice) && bestUnitPrice <= currentUnit) {
      const unit = bestUnitPrice
      const qty = Math.max(0, line.qty || 0)
      const groupSaving = Math.max(0, (baseUnit - unit) * qty)
      totalGroupSaving += groupSaving
      return {
        ...line,
        appliedGroupId: bestGroup.id,
        appliedGroupName: bestGroupName,
        appliedGroupMinQty: bestAppliedMinQty,
        appliedGroupUnitPrice: unit,
        groupSaving,
        lineUnitPrice: unit,
        lineImporte: Number((qty * unit).toFixed(2)),
      }
    }
    return {
      ...line,
      appliedGroupId: null,
      appliedGroupName: undefined,
      appliedGroupMinQty: null,
      appliedGroupUnitPrice: null,
      groupSaving: 0,
      lineUnitPrice: currentUnit,
      lineImporte: line.importe,
    }
  })

  return { lines, totalGroupSaving, matchedGroups }
}
