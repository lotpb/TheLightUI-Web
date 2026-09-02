export type InvoiceStatus   = 'draft' | 'sent' | 'paid' | 'overdue'
export type RecurringInterval = 'monthly' | 'quarterly' | 'yearly'

export interface InvoiceLineItem {
  description: string
  qty: number
  rate: number
  /** Set when this line item was added from the catalog — used to deduct stock on invoice creation. */
  catalogItemId?: string
}

export interface Invoice {
  id: string
  companyId: string
  shareToken?: string
  customerId: string
  customerName: string
  customerPhone: string
  customerEmail: string
  customerAddress: string
  invoiceNumber: string
  issueDate: Date
  dueDate: Date
  status: InvoiceStatus
  lineItems: InvoiceLineItem[]
  notes: string
  taxRate: number
  createdAt: Date
  updatedAt: Date
  recurring?: RecurringInterval | null
  nextRecurDate?: Date | null
  lastGeneratedAt?: Date | null
  generatedFrom?: string | null
  paymentLink?: string | null
  lastReminderSentAt?: Date | null
  currency: string
  quickbooksInvoiceId?: string | null
  financingApplicationId?: string | null
}

// Common ISO 4217 codes for the invoice currency picker. Aggregate totals
// elsewhere (Dashboard, Forecast, Commission) still sum raw amounts assuming
// a single company currency — mixing currencies across invoices in those
// rollups isn't converted, only each invoice's own display respects this field.
export const CURRENCY_CODES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'MXN'] as const

export function lineItemTotal(item: InvoiceLineItem): number {
  return item.qty * item.rate
}

export function invoiceSubtotal(inv: Pick<Invoice, 'lineItems'>): number {
  return inv.lineItems.reduce((sum, l) => sum + lineItemTotal(l), 0)
}

export function invoiceTaxAmount(inv: Pick<Invoice, 'lineItems' | 'taxRate'>): number {
  return invoiceSubtotal(inv) * (inv.taxRate / 100)
}

export function invoiceTotal(inv: Pick<Invoice, 'lineItems' | 'taxRate'>): number {
  return invoiceSubtotal(inv) + invoiceTaxAmount(inv)
}

export function effectiveStatus(inv: Invoice): InvoiceStatus {
  if (inv.status === 'paid' || inv.status === 'draft') return inv.status
  const now = new Date(); now.setHours(0, 0, 0, 0)
  if (inv.dueDate < now) return 'overdue'
  return inv.status
}

export function statusLabel(s: InvoiceStatus): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export function statusClasses(s: InvoiceStatus): string {
  switch (s) {
    case 'paid':    return 'text-green-400 bg-green-500/10 border-green-700/30'
    case 'sent':    return 'text-blue-400 bg-blue-500/10 border-blue-700/30'
    case 'overdue': return 'text-red-400 bg-red-500/10 border-red-700/30'
    default:        return 'text-gray-400 bg-gray-700/40 border-gray-600/30'
  }
}

export function fmtCurrency(n: number, currency: string = 'USD'): string {
  return n.toLocaleString('en-US', { style: 'currency', currency, minimumFractionDigits: 2 })
}

export function generateInvoiceNumber(): string {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const r = Math.floor(Math.random() * 9000 + 1000)
  return `INV-${y}${m}-${r}`
}
