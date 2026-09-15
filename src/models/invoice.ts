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

export function effectiveStatus(inv: Invoice, now: Date = new Date()): InvoiceStatus {
  if (inv.status === 'paid' || inv.status === 'draft') return inv.status
  // Copied, not mutated — a caller passing its own clock (the KPI roll-up, the
  // tests) must not have its Date silently reset to midnight.
  const today = new Date(now); today.setHours(0, 0, 0, 0)
  if (inv.dueDate < today) return 'overdue'
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

// ── List roll-up ──────────────────────────────────────────────────────────────

export interface InvoiceKpis {
  /** Money actually asked for: everything except drafts. */
  billed: number
  paid: number
  /** What customers owe — billed less paid. */
  outstanding: number
  overdue: number
  /** Drafts, held apart from every figure above. */
  draft: number
  draftCount: number
  /** How many invoices each figure is made of. */
  billedCount: number
  paidCount: number
  outstandingCount: number
  overdueCount: number
  /**
   * Days past due for the worst one, or 0 when nothing is overdue.
   *
   * The strip gave four totals and no age, so "$1,500 overdue" read the same
   * whether that was a week late or a year — which is the difference between
   * a reminder and a write-off.
   */
  oldestOverdueDays: number
}

/**
 * The four figures at the top of /invoices, with drafts excluded.
 *
 * The page summed *every* invoice into "Total Billed" and then derived
 * `outstanding = total - paid`, so an unsent draft counted as money billed and
 * as money a customer owed. On a realistic mix — two drafts worth $6,500, three
 * sent, one paid $6,000 — Outstanding read $13,000 against a real $6,500: a
 * receivables number overstated by 100%, in the flattering direction.
 *
 * A draft is a document nobody has been asked to pay. It is reported on its
 * own rather than dropped, so the money doesn't just vanish from the page.
 */
export function invoiceKpis(invoices: Invoice[], now: Date = new Date()): InvoiceKpis {
  let billed = 0, paid = 0, overdue = 0, draft = 0
  let draftCount = 0, billedCount = 0, paidCount = 0, overdueCount = 0
  let oldestOverdueDays = 0

  const today = new Date(now); today.setHours(0, 0, 0, 0)

  for (const inv of invoices) {
    const total = invoiceTotal(inv)
    switch (effectiveStatus(inv, now)) {
      case 'draft':
        draft += total
        draftCount++
        break
      case 'paid':
        billed += total
        billedCount++
        paid += total
        paidCount++
        break
      case 'overdue': {
        billed += total
        billedCount++
        overdue += total
        overdueCount++
        const days = Math.floor((today.getTime() - inv.dueDate.getTime()) / 86_400_000)
        if (days > oldestOverdueDays) oldestOverdueDays = days
        break
      }
      default:
        billed += total
        billedCount++
    }
  }

  return {
    billed, paid, outstanding: billed - paid, overdue, draft, draftCount,
    billedCount, paidCount, outstandingCount: billedCount - paidCount,
    overdueCount, oldestOverdueDays,
  }
}

export type InvoiceSortKey =
  | 'dueAsc' | 'dueDesc' | 'amountDesc' | 'amountAsc'
  | 'issuedDesc' | 'issuedAsc' | 'customer'

/**
 * Sort options for the list.
 *
 * The page had none: invoiceService sorts newest-created-first and that was
 * the only order available, which answers "what did I just make" and not the
 * question a receivables list exists for — what is most overdue. Due date
 * ascending is the default for that reason: the longest-unpaid invoice lands
 * at the top and upcoming ones fall below it.
 */
export const INVOICE_SORTS: { key: InvoiceSortKey; label: string }[] = [
  { key: 'dueAsc',     label: 'Due date — oldest first' },
  { key: 'dueDesc',    label: 'Due date — latest first' },
  { key: 'amountDesc', label: 'Amount — high to low' },
  { key: 'amountAsc',  label: 'Amount — low to high' },
  { key: 'issuedDesc', label: 'Issued — newest first' },
  { key: 'issuedAsc',  label: 'Issued — oldest first' },
  { key: 'customer',   label: 'Customer A–Z' },
]

export const DEFAULT_INVOICE_SORT: InvoiceSortKey = 'dueAsc'

/**
 * Returns a new array; the caller's input is never reordered in place.
 *
 * Every comparison falls through to the invoice number, so two invoices due
 * the same day hold a stable position instead of swapping on re-render.
 */
export function sortInvoices<T extends Invoice>(items: T[], key: InvoiceSortKey): T[] {
  const byNumber = (a: T, b: T) => a.invoiceNumber.localeCompare(b.invoiceNumber)
  const cmp: Record<InvoiceSortKey, (a: T, b: T) => number> = {
    dueAsc:     (a, b) => a.dueDate.getTime()   - b.dueDate.getTime(),
    dueDesc:    (a, b) => b.dueDate.getTime()   - a.dueDate.getTime(),
    amountDesc: (a, b) => invoiceTotal(b)       - invoiceTotal(a),
    amountAsc:  (a, b) => invoiceTotal(a)       - invoiceTotal(b),
    issuedDesc: (a, b) => b.issueDate.getTime() - a.issueDate.getTime(),
    issuedAsc:  (a, b) => a.issueDate.getTime() - b.issueDate.getTime(),
    customer:   (a, b) => a.customerName.localeCompare(b.customerName),
  }
  const primary = cmp[key]
  return [...items].sort((a, b) => primary(a, b) || byNumber(a, b))
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
