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

export const STOCK_LEVEL_COLORS: Record<StockLevel, string> = {
  none: '',
  out:  'bg-red-500/20 text-red-300',
  low:  'bg-yellow-500/20 text-yellow-300',
  ok:   'bg-green-500/20 text-green-300',
}
