import type { CustomerItem } from './customer'
import { effectiveStatus, invoiceTotal, type Invoice } from './invoice'

/**
 * The arithmetic behind /reports.
 *
 * It lived inline in the page, where several of these figures were wrong in
 * ways a reader couldn't see: a conversion rate divided by a denominator that
 * shrinks every time someone converts, a share percentage taken over the ten
 * rows on screen rather than the data, and a revenue column that meant one
 * thing in the salesman table and another in the sources table directly below
 * it. Extracted so each one can be stated and checked.
 */

// ── Periods ───────────────────────────────────────────────────────────────────

export type Period = 'week' | 'month' | 'lastMonth' | 'quarter' | 'year' | 'last12' | 'all'

export const PERIODS: Period[] = ['week', 'month', 'lastMonth', 'quarter', 'year', 'last12', 'all']

export const PERIOD_LABELS: Record<Period, string> = {
  week: 'This Week',
  month: 'This Month',
  lastMonth: 'Last Month',
  quarter: 'This Quarter',
  year: 'This Year',
  last12: 'Last 12M',
  all: 'All Time',
}

export interface DateRange { start: Date; end: Date }

/**
 * Dates at or before epoch + 1 day are sentinel zeros, not real dates.
 *
 * Same threshold /forecast uses. It matters here because a record whose
 * creationDate never got written lands on 1970 and would otherwise be counted
 * into whichever period happens to include it.
 */
export const EPOCH_THRESHOLD = 86_400_000

export function isRealDate(d: Date | null | undefined): d is Date {
  return !!d && !Number.isNaN(d.getTime()) && d.getTime() > EPOCH_THRESHOLD
}

/**
 * The window for a period.
 *
 * 'all' used to be `start.setFullYear(2000)` on a copy of *now*, so All Time
 * began on this day-of-year in 2000 at the current clock time and silently
 * excluded anything earlier — including every sentinel-dated record, while the
 * tables below the KPI row counted those records anyway. The two halves of the
 * page therefore described different populations. All Time is now genuinely
 * unbounded at the start.
 */
export function periodRange(period: Period, now: Date = new Date()): DateRange {
  const start = new Date(now)
  const end = new Date(now)
  end.setHours(23, 59, 59, 999)

  switch (period) {
    case 'week':
      start.setDate(now.getDate() - now.getDay())
      start.setHours(0, 0, 0, 0)
      break
    case 'month':
      start.setDate(1)
      start.setHours(0, 0, 0, 0)
      break
    case 'lastMonth':
      start.setMonth(now.getMonth() - 1, 1)
      start.setHours(0, 0, 0, 0)
      end.setDate(0)
      end.setHours(23, 59, 59, 999)
      break
    case 'quarter':
      start.setMonth(Math.floor(now.getMonth() / 3) * 3, 1)
      start.setHours(0, 0, 0, 0)
      break
    case 'year':
      start.setMonth(0, 1)
      start.setHours(0, 0, 0, 0)
      break
    case 'last12':
      start.setMonth(now.getMonth() - 11, 1)
      start.setHours(0, 0, 0, 0)
      break
    case 'all':
      return { start: new Date(0), end }
  }
  return { start, end }
}

function inRange(d: Date, { start, end }: DateRange): boolean {
  const t = d.getTime()
  return t >= start.getTime() && t <= end.getTime()
}

/** Records created inside the window. 'all' keeps sentinel dates too. */
export function customersInRange(
  items: CustomerItem[], range: DateRange, period: Period,
): CustomerItem[] {
  if (period === 'all') return items
  return items.filter(c => isRealDate(c.creationDate) && inRange(c.creationDate, range))
}

const isLead     = (c: CustomerItem) => c.category.toLowerCase() === 'lead'
const isCustomer = (c: CustomerItem) => c.category.toLowerCase() === 'customer'

/** Leads and customers only — vendors and employees aren't sales records. */
export function isSalesRecord(c: CustomerItem): boolean {
  return isLead(c) || isCustomer(c)
}

// ── Money ─────────────────────────────────────────────────────────────────────

/**
 * Invoices whose issue date falls in the window.
 *
 * Keyed on issueDate because an Invoice carries no payment timestamp — there
 * is no paidAt field to key "collected this month" off. So Collected below
 * means "of the invoices issued in this window, this much has since been
 * paid", which is not the same as cash received in the window. The page says
 * so rather than implying otherwise.
 */
export function invoicesInRange(items: Invoice[], range: DateRange, period: Period): Invoice[] {
  if (period === 'all') return items
  return items.filter(i => isRealDate(i.issueDate) && inRange(i.issueDate, range))
}

export interface ReportKpis {
  newLeads: number
  newCustomers: number
  /**
   * Deal value on customer records created in the window.
   *
   * This is `customer.amount`, the same field /dashboard, /chart, /forecast
   * and /commission treat as a deal's value — commission is paid on it. It was
   * labelled bare "Revenue", which made it read as money taken. It is booked
   * value on new records, and /forecast dates the same money by
   * completionDate ?? startDate rather than by creation, so the two pages will
   * not agree on which month a deal belongs to.
   */
  booked: number
  avgBooked: number
  /** Invoiced: every non-draft invoice issued in the window. */
  invoiced: number
  invoicedCount: number
  /** Of those, the amount since marked paid. */
  collected: number
}

export function reportKpis(
  customers: CustomerItem[], invoices: Invoice[], now: Date = new Date(),
): ReportKpis {
  const newLeads     = customers.filter(isLead).length
  const customerRecs = customers.filter(isCustomer)
  const booked       = customerRecs.reduce((s, c) => s + c.amount, 0)

  let invoiced = 0, invoicedCount = 0, collected = 0
  for (const inv of invoices) {
    const status = effectiveStatus(inv, now)
    if (status === 'draft') continue
    const total = invoiceTotal(inv)
    invoiced += total
    invoicedCount++
    if (status === 'paid') collected += total
  }

  return {
    newLeads,
    newCustomers: customerRecs.length,
    booked,
    avgBooked: customerRecs.length > 0 ? booked / customerRecs.length : 0,
    invoiced,
    invoicedCount,
    collected,
  }
}

// ── Conversion ────────────────────────────────────────────────────────────────

/**
 * Share of this rep's sales records that became customers.
 *
 * The page computed `customers / leads`, but a record is categorised either
 * 'lead' or 'customer' and converting moves it — so `leads` counts only the
 * records that have *not* converted. A rep who closed all ten of their leads
 * scored `10 / 0` and rendered as "—"; a rep with one close and ninety-nine
 * open leads scored 1%; and the ratio had no upper bound, so the "≥ 50% is
 * green" threshold was measuring something unbounded. The denominator is the
 * whole cohort.
 */
export function conversionRate(leads: number, customers: number): number | null {
  const total = leads + customers
  if (total === 0) return null
  return (customers / total) * 100
}

export type SalesmanSort = 'booked' | 'invoiced' | 'leads' | 'customers' | 'conversion'

export const SALESMAN_SORTS: { key: SalesmanSort; label: string }[] = [
  { key: 'booked',     label: 'Booked' },
  { key: 'invoiced',   label: 'Invoiced' },
  { key: 'leads',      label: 'Leads' },
  { key: 'customers',  label: 'Customers' },
  { key: 'conversion', label: 'Conv' },
]

export interface SalesmanRow {
  name: string
  leads: number
  customers: number
  booked: number
  invoiced: number
  avgBooked: number
  /** Null when this rep has no sales records at all in the window. */
  conversion: number | null
}

/**
 * Per-rep performance over a set of records.
 *
 * Invoiced money is attributed through the invoice's customerId to that
 * customer's assigned rep, so a rep's invoiced total and the company's agree.
 * An invoice whose customer isn't in the visible set is left out rather than
 * dumped on "Unassigned".
 */
export function salesmanRows(
  customers: CustomerItem[],
  invoices: Invoice[],
  sort: SalesmanSort,
  now: Date = new Date(),
): SalesmanRow[] {
  const repOf = new Map<string, string>()
  const map = new Map<string, SalesmanRow>()

  const blank = (name: string): SalesmanRow => ({
    name, leads: 0, customers: 0, booked: 0, invoiced: 0, avgBooked: 0, conversion: null,
  })

  for (const c of customers) {
    if (!isSalesRecord(c)) continue
    const name = c.salesman.trim() || 'Unassigned'
    repOf.set(c.id, name)
    const row = map.get(name) ?? blank(name)
    if (isLead(c)) row.leads++
    else { row.customers++; row.booked += c.amount }
    map.set(name, row)
  }

  for (const inv of invoices) {
    if (effectiveStatus(inv, now) === 'draft') continue
    const name = repOf.get(inv.customerId)
    if (!name) continue
    const row = map.get(name)
    if (row) row.invoiced += invoiceTotal(inv)
  }

  const rows = [...map.values()]
  for (const r of rows) {
    r.avgBooked = r.customers > 0 ? r.booked / r.customers : 0
    r.conversion = conversionRate(r.leads, r.customers)
  }

  return rows.sort((a, b) => {
    switch (sort) {
      case 'booked':     return b.booked - a.booked
      case 'invoiced':   return b.invoiced - a.invoiced
      case 'leads':      return b.leads - a.leads
      case 'customers':  return b.customers - a.customers
      // Reps with no records sort last rather than tying at zero.
      case 'conversion': return (b.conversion ?? -1) - (a.conversion ?? -1)
    }
  })
}

// ── Sources ───────────────────────────────────────────────────────────────────

/**
 * Which field a source breakdown groups by.
 *
 * The table was headed "Lead Sources" and grouped on `adNo` — the field
 * /customers renders as "ID {adNo}" and pickerStore pairs with *advertiser* —
 * while `leadSource` is what /chart's "By Lead Source" and /funnel's cohorts
 * use. Two pages answered the same question from different columns. Default to
 * leadSource to match them, and keep adNo reachable and correctly named for
 * companies that record their advertising there.
 */
export type SourceField = 'leadSource' | 'adNo'

export const SOURCE_FIELDS: { key: SourceField; label: string }[] = [
  { key: 'leadSource', label: 'Lead Source' },
  { key: 'adNo',       label: 'Ad No' },
]

export interface SourceRow {
  source: string
  /** Sales records attributed to this source. */
  count: number
  customers: number
  /** Booked value from the *customers* only. */
  booked: number
  /** Percentage of every in-scope sales record, not of the rows displayed. */
  share: number
}

export interface SourceBreakdown {
  rows: SourceRow[]
  /** Every in-scope sales record, which is what `share` is a share of. */
  total: number
  /** Distinct sources found, so the page can say what the top N leaves out. */
  distinct: number
}

/**
 * Top sources by record count.
 *
 * Two fixes beyond the field choice. `share` divided by the sum of the ten
 * rows that survived `.slice(0, 10)`, so the displayed shares always totalled
 * 100% and every one was inflated whenever more than ten sources existed. And
 * the revenue column added `amount` for leads as well as customers, while the
 * salesman table's revenue counted customers only — the same column heading
 * meaning two different things on one screen.
 */
export function sourceBreakdown(
  customers: CustomerItem[], field: SourceField, topN = 10,
): SourceBreakdown {
  const map = new Map<string, SourceRow>()
  let total = 0

  for (const c of customers) {
    if (!isSalesRecord(c)) continue
    total++
    const raw = (field === 'leadSource' ? c.leadSource : c.adNo).trim()
    const source = raw || 'No source recorded'
    const row = map.get(source) ?? { source, count: 0, customers: 0, booked: 0, share: 0 }
    row.count++
    if (isCustomer(c)) { row.customers++; row.booked += c.amount }
    map.set(source, row)
  }

  const all = [...map.values()].sort((a, b) => b.count - a.count || a.source.localeCompare(b.source))
  for (const r of all) r.share = total > 0 ? (r.count / total) * 100 : 0

  return { rows: all.slice(0, topN), total, distinct: all.length }
}

// ── Trend ─────────────────────────────────────────────────────────────────────

export interface TrendPoint {
  month: string
  booked: number
  invoiced: number
  leads: number
  customers: number
}

/** The trailing 12 calendar months, oldest first. */
export function trendSeries(
  customers: CustomerItem[], invoices: Invoice[], now: Date = new Date(),
): TrendPoint[] {
  const keyOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`

  const months: { key: string; label: string }[] = []
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    months.push({
      key: keyOf(d),
      label: d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
    })
  }

  const blank = () => ({ booked: 0, invoiced: 0, leads: 0, customers: 0 })
  const buckets = new Map(months.map(m => [m.key, blank()]))

  for (const c of customers) {
    if (!isRealDate(c.creationDate)) continue
    const b = buckets.get(keyOf(c.creationDate))
    if (!b) continue
    if (isCustomer(c)) { b.booked += c.amount; b.customers++ }
    else if (isLead(c)) b.leads++
  }

  for (const inv of invoices) {
    if (!isRealDate(inv.issueDate)) continue
    if (inv.status === 'draft') continue
    const b = buckets.get(keyOf(inv.issueDate))
    if (b) b.invoiced += invoiceTotal(inv)
  }

  return months.map(m => ({ month: m.label, ...buckets.get(m.key)! }))
}

export function hasTrendData(points: TrendPoint[]): boolean {
  return points.some(p => p.booked > 0 || p.invoiced > 0 || p.leads > 0)
}

// ── Formatting ────────────────────────────────────────────────────────────────

/**
 * One money format for the whole page.
 *
 * There were four: `$1.2K` on the KPI cards, `$1,234` in the tables, `$1k`
 * (lowercase, a different rounding) on the Y axis, and a fourth inline
 * variant. Compact is for axis ticks and narrow cells; exact is for anything
 * someone might read as a figure.
 */
export function fmtMoneyExact(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

export function fmtMoneyCompact(n: number): string {
  const abs = Math.abs(n)
  const sign = n < 0 ? '-' : ''
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`
  if (abs >= 10_000)    return `${sign}$${Math.round(abs / 1_000)}K`
  if (abs >= 1_000)     return `${sign}$${(abs / 1_000).toFixed(1)}K`
  return fmtMoneyExact(n)
}
