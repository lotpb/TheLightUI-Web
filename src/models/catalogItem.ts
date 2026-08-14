export interface CatalogItem {
  id: string
  companyId: string
  name: string
  description: string
  price: number
  unit: string      // e.g. 'each', 'hr', 'sqft', 'ft', 'day'
  category: string  // optional grouping label
  createdAt: Date
}

export const UNIT_OPTIONS = ['each', 'hr', 'sqft', 'ft', 'lb', 'day', 'job', 'mo'] as const
