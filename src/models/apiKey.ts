export type ApiScope = 'customers.read' | 'invoices.read'

export const API_SCOPES: ApiScope[] = ['customers.read', 'invoices.read']

export const API_SCOPE_LABELS: Record<ApiScope, string> = {
  'customers.read': 'Read Customers',
  'invoices.read':  'Read Invoices',
}

export interface ApiKey {
  id: string
  companyId: string
  name: string
  keyPrefix: string // first chars of the raw key, shown for identification only
  keyHash: string
  scopes: ApiScope[]
  enabled: boolean
  createdAt: Date
  lastUsedAt: Date | null
  createdByName: string
}
