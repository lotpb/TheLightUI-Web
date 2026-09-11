import type { CustomerItem } from '../models/customer'

/**
 * The funnel maths, pulled out of /funnel so it can be tested.
 *
 * The page compared `category === 'Lead'` against `category === 'Customer'`,
 * which are disjoint sets: a lead that converts *leaves* the first bucket and
 * appears in the third. So the stages weren't nested subsets and every ratio
 * between them was a ratio of two unrelated populations. With 20 open leads
 * and 50 deals won it rendered "↓ 417% proceed", "250% of leads" and a
 * Conv. Rate of 250%; convert every lead in a period and `pct(n, 0)` returned
 * 0, so a perfect month reported 0% conversion in red.
 *
 * A funnel needs one cohort walking through stages. The cohort here is every
 * lead-or-customer record created in the window, and each stage is defined so
 * that it is a subset of the one before it — see `buildFunnel`.
 */

const EPOCH_THRESHOLD = 86_400_000   // dates at/before epoch+1day are sentinel zeros

function validDate(d: Date | null): d is Date {
  return !!d && d.getTime() > EPOCH_THRESHOLD
}

export function isLead(c: CustomerItem)     { return c.category.toLowerCase() === 'lead' }
export function isCustomer(c: CustomerItem) { return c.category.toLowerCase() === 'customer' }

/** The "Called" field in the record form. Vendors keep it elsewhere, but the
 *  cohort is leads and customers only, so `callback` is always the right one. */
function wasContacted(c: CustomerItem) { return c.callback.trim().toLowerCase() === 'yes' }

function jobStarted(c: CustomerItem)   { return validDate(c.startDate) }
function jobCompleted(c: CustomerItem) {
  return validDate(c.completionDate) && validDate(c.startDate) && c.completionDate > c.startDate
}

export interface FunnelCounts {
  /** Leads + customers created in the window. Every other count is a subset. */
  cohort: number
  contacted: number
  won: number
  started: number
  completed: number
  /** Total amount on the won records. */
  revenue: number
}

export const EMPTY_COUNTS: FunnelCounts = {
  cohort: 0, contacted: 0, won: 0, started: 0, completed: 0, revenue: 0,
}

/**
 * One pass, five nested counts.
 *
 * `contacted` counts a won deal as contacted even when the Called flag was
 * never set — you cannot win a deal you never spoke to, and without that the
 * stage isn't a superset of the one below it and the funnel can widen again.
 * Everything downstream is guarded on the stage above, so the sequence is
 * monotonic by construction and no drop-through can exceed 100%.
 */
export function funnelCounts(records: CustomerItem[]): FunnelCounts {
  const out = { ...EMPTY_COUNTS }
  for (const c of records) {
    const lead = isLead(c), customer = isCustomer(c)
    if (!lead && !customer) continue
    out.cohort++
    if (wasContacted(c) || customer) out.contacted++
    if (!customer) continue
    out.won++
    out.revenue += Number.isFinite(c.amount) ? c.amount : 0
    if (!jobStarted(c)) continue
    out.started++
    if (jobCompleted(c)) out.completed++
  }
  return out
}

export interface FunnelStage {
  key: keyof Omit<FunnelCounts, 'revenue'>
  label: string
  hint: string
  count: number
  /** Share of the cohort. Never above 100. */
  ofCohort: number
  /** Share of the stage above. Never above 100. `null` on the first stage. */
  fromPrevious: number | null
}

const STAGE_META: { key: FunnelStage['key']; label: string; hint: string }[] = [
  { key: 'cohort',    label: 'Created',       hint: 'Leads and customers created in this period' },
  { key: 'contacted', label: 'Contacted',     hint: 'Marked Called — deals that were won count as contacted' },
  { key: 'won',       label: 'Won',           hint: 'Now categorised as a customer' },
  { key: 'started',   label: 'Job started',   hint: 'Has a start date' },
  { key: 'completed', label: 'Job completed', hint: 'Completed after it started' },
]

export function buildFunnel(counts: FunnelCounts): FunnelStage[] {
  return STAGE_META.map((m, i) => {
    const count = counts[m.key]
    const prev  = i === 0 ? null : counts[STAGE_META[i - 1].key]
    return {
      ...m,
      count,
      ofCohort: share(count, counts.cohort),
      fromPrevious: prev === null ? null : share(count, prev),
    }
  })
}

/**
 * A percentage that can't lie.
 *
 * An empty denominator is "no answer", not zero — a period with nothing in it
 * used to report 0% conversion, indistinguishable from a period where nobody
 * converted. Callers render null as an em dash.
 */
export function rate(n: number, total: number): number | null {
  return total === 0 ? null : Math.round((n / total) * 100)
}

function share(n: number, total: number): number {
  return total === 0 ? 0 : Math.round((n / total) * 100)
}

export interface MonthBucket {
  key: string
  month: string
  leads: number
  customers: number
}

/**
 * Leads and customers created per month, in a single pass.
 *
 * This was twelve nested `Array.prototype.filter` calls over the full record
 * set — the rep filter alone re-ran inside the loop — so a 5,000-record
 * company spent about 180,000 predicate calls producing twelve points, on
 * every change to the rep filter.
 */
export function monthlyCounts(
  records: CustomerItem[],
  months: number,
  now: Date = new Date(),
): MonthBucket[] {
  const buckets = new Map<string, MonthBucket>()
  const order: MonthBucket[] = []
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const b: MonthBucket = {
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      month: d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
      leads: 0,
      customers: 0,
    }
    buckets.set(b.key, b)
    order.push(b)
  }
  for (const c of records) {
    const d = c.creationDate
    if (!d) continue
    const b = buckets.get(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
    if (!b) continue
    if (isLead(c)) b.leads++
    else if (isCustomer(c)) b.customers++
  }
  return order
}

export interface GroupRow extends FunnelCounts {
  name: string
  /** Won as a share of the cohort. null when the group has no cohort. */
  winRate: number | null
  contactRate: number | null
}

/**
 * Group by a key, then run the same cohort maths on each group.
 *
 * Per-rep and per-source conversion had the disjoint-set bug independently of
 * the main funnel, each with its own inline arithmetic. One definition now.
 */
export function groupFunnel(
  records: CustomerItem[],
  keyOf: (c: CustomerItem) => string,
): GroupRow[] {
  const groups = new Map<string, CustomerItem[]>()
  for (const c of records) {
    if (!isLead(c) && !isCustomer(c)) continue
    const k = keyOf(c)
    const list = groups.get(k)
    if (list) list.push(c)
    else groups.set(k, [c])
  }
  return Array.from(groups.entries()).map(([name, list]) => {
    const counts = funnelCounts(list)
    return {
      name,
      ...counts,
      winRate: rate(counts.won, counts.cohort),
      contactRate: rate(counts.contacted, counts.cohort),
    }
  })
}
