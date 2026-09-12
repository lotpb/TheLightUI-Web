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
  /**
   * Paused without losing the schedule.
   *
   * /invoices/recurring had a "Pause" button that nulled `recurring` and
   * `nextRecurDate` — destroying the interval and the next date, dropping the
   * row out of the list, and leaving no way to resume. There was no paused
   * state to set, so this is it. `recurring` stays, which is what lets the
   * row still be listed and resumed.
   *
   * The daily generateRecurringInvoices cron queries on `recurring`, so it
   * has to skip these explicitly or a "paused" schedule would keep billing.
   */
  recurringPaused?: boolean
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

// ── Recurring schedules ───────────────────────────────────────────────────────

/** Months between issues, for normalising intervals to a common basis. */
export const INTERVAL_MONTHS: Record<RecurringInterval, number> = {
  monthly: 1,
  quarterly: 3,
  yearly: 12,
}

export interface RecurringSummary {
  /** Active (non-paused) schedules. */
  active: number
  paused: number
  /** Active schedules whose next date has passed, or that have no date. */
  due: number
  /** Active schedules with no next date set — a gap, not a due date. */
  undated: number
  /** Committed value per month, intervals normalised. */
  monthly: number
  /** The same commitment over a year. */
  annual: number
  /** Active count per interval, for the breakdown. */
  byInterval: Record<RecurringInterval, number>
}

export type RecurringState = 'due' | 'undated' | 'scheduled' | 'paused'

/**
 * What state a schedule is in.
 *
 * "No next date" used to return true from isDue, so a schedule missing its
 * date rendered the orange border, a "Due Now" pill and an orange date that
 * read "—" — claiming to be due and admitting it didn't know when. It's a
 * different problem with a different fix (edit the schedule, don't generate),
 * so it gets its own state.
 */
export function recurringState(
  inv: Pick<Invoice, 'recurring' | 'recurringPaused' | 'nextRecurDate'>,
  now: Date = new Date(),
): RecurringState {
  if (inv.recurringPaused) return 'paused'
  if (!inv.nextRecurDate) return 'undated'
  const endOfToday = new Date(now)
  endOfToday.setHours(23, 59, 59, 999)
  return inv.nextRecurDate <= endOfToday ? 'due' : 'scheduled'
}

/**
 * The number this page exists for, which it never showed.
 *
 * A page listing recurring invoices reported only a count of what was ready
 * to generate — no committed monthly value, no annualised figure — while
 * every row carried an amount and an interval. Paused schedules are excluded
 * from the money: they aren't committed revenue while they're off.
 */
export function recurringSummary(
  invoices: Pick<Invoice, 'recurring' | 'recurringPaused' | 'nextRecurDate' | 'lineItems' | 'taxRate'>[],
  now: Date = new Date(),
): RecurringSummary {
  const out: RecurringSummary = {
    active: 0, paused: 0, due: 0, undated: 0, monthly: 0, annual: 0,
    byInterval: { monthly: 0, quarterly: 0, yearly: 0 },
  }
  for (const inv of invoices) {
    if (!inv.recurring) continue
    const state = recurringState(inv, now)
    if (state === 'paused') { out.paused++; continue }
    out.active++
    out.byInterval[inv.recurring]++
    if (state === 'due') out.due++
    if (state === 'undated') out.undated++
    out.monthly += invoiceTotal(inv) / INTERVAL_MONTHS[inv.recurring]
  }
  out.annual = out.monthly * 12
  return out
}
