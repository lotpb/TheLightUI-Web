export type PurchaseOrderStatus = 'draft' | 'sent' | 'received' | 'cancelled'

export interface PurchaseOrderLineItem {
  description: string
  qty: number
  unitCost: number
}

export interface PurchaseOrder {
  id: string
  companyId: string
  poNumber: string
  vendorId: string
  vendorName: string
  jobId: string
  jobName: string
  status: PurchaseOrderStatus
  lineItems: PurchaseOrderLineItem[]
  notes: string
  orderDate: Date
  expectedDate: Date | null
  receivedDate: Date | null
  createdAt: Date
  updatedAt: Date
  createdByName: string
  lastEditedByName: string
}

export const STATUS_LABELS: Record<PurchaseOrderStatus, string> = {
  draft:     'Draft',
  sent:      'Sent',
  received:  'Received',
  cancelled: 'Cancelled',
}

export const STATUS_COLORS: Record<PurchaseOrderStatus, string> = {
  draft:     'bg-gray-700 text-gray-300',
  sent:      'bg-blue-500/20 text-blue-300',
  received:  'bg-green-500/20 text-green-300',
  cancelled: 'bg-red-500/20 text-red-300',
}

export function lineItemTotal(item: PurchaseOrderLineItem): number {
  return item.qty * item.unitCost
}

export function poTotal(po: Pick<PurchaseOrder, 'lineItems'>): number {
  return po.lineItems.reduce((sum, i) => sum + lineItemTotal(i), 0)
}

export function generatePONumber(): string {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const r = Math.floor(Math.random() * 9000 + 1000)
  return `PO-${y}${m}-${r}`
}

export function fmtCurrency(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}
