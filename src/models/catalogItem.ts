export interface CatalogItem {
  id: string
  companyId: string
  name: string
  description: string
  price: number
  unit: string      // e.g. 'each', 'hr', 'sqft', 'ft', 'day'
  category: string  // optional grouping label
  createdAt: Date
  trackInventory: boolean
  stockQty: number
  lowStockThreshold: number
}

export const UNIT_OPTIONS = ['each', 'hr', 'sqft', 'ft', 'lb', 'day', 'job', 'mo'] as const

export type StockLevel = 'none' | 'out' | 'low' | 'ok'

export function stockLevel(item: CatalogItem): StockLevel {
  if (!item.trackInventory) return 'none'
  if (item.stockQty <= 0) return 'out'
  if (item.stockQty <= item.lowStockThreshold) return 'low'
  return 'ok'
}

export const STOCK_LEVEL_LABELS: Record<StockLevel, string> = {
  none: '',
  out:  'Out of Stock',
  low:  'Low Stock',
  ok:   'In Stock',
}

/**
 * The 900/40 + 400 pairs, not 500/20 + 300.
 *
 * The old pairs had no light-mode rules anywhere, so in light mode the entire
 * stock status system was invisible: "Low Stock" measured 1.16:1, "In Stock"
 * 1.18:1, "Out of Stock" 1.46:1. All three of these combinations are already
 * themed in index.css — background composited to a pale tint, text to a 900
 * shade — so switching to them fixes light mode without adding any CSS, and
 * makes the pills match the status pills used elsewhere in the app.
 */
export const STOCK_LEVEL_COLORS: Record<StockLevel, string> = {
  none: '',
  out:  'bg-red-900/40 text-red-400',
  low:  'bg-yellow-900/40 text-yellow-400',
  ok:   'bg-green-900/40 text-green-400',
}
