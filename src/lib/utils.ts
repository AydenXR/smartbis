import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import type { PosCatalogItem } from "@/lib/api"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export interface TieredPriceResult {
  unitPrice: number
  appliedMinQty: number | null
  discountPerUnit: number
  saving: number
}

export function tieredUnitPrice(item: PosCatalogItem, qty: number): TieredPriceResult {
  const base = item.salePrice || 0
  const q = Math.max(1, Math.floor(qty || 0))
  if (!item.volumePriceTiers?.length) {
    return { unitPrice: base, appliedMinQty: null, discountPerUnit: 0, saving: 0 }
  }
  const sorted = [...item.volumePriceTiers]
    .filter(t => typeof t?.minQty === 'number' && typeof t?.price === 'number' && t.minQty >= 1 && t.price >= 0)
    .sort((a, b) => b.minQty - a.minQty)
  const match = sorted.find(t => q >= t.minQty)
  if (!match) {
    return { unitPrice: base, appliedMinQty: null, discountPerUnit: 0, saving: 0 }
  }
  const unit = Math.min(match.price, base)
  const discountPerUnit = base - unit
  return {
    unitPrice: unit,
    appliedMinQty: match.minQty,
    discountPerUnit,
    saving: discountPerUnit * q,
  }
}
