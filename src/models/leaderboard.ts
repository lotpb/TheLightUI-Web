import { categoryMatches, type CustomerItem } from './customer'

/**
 * Ranking for /leaderboard.
 *
 * The period maths, the All Time bound and the epoch-sentinel guard all come
 * from models/salesReport.ts rather than being re-derived here — /reports had
 * the same `start.setFullYear(2000)` bug, and two pages computing "this
 * quarter" two ways is how they end up disagreeing.
 */
export type { Period, DateRange } from './salesReport'
export { PERIOD_LABELS, periodRange, customersInRange, isRealDate } from './salesReport'

export type Metric = 'revenue' | 'customers' | 'leads' | 'avgDeal'

export const METRIC_LABELS: Record<Metric, string> = {
  revenue:   'Revenue',
  customers: 'Sales',
  leads:     'Leads',
  avgDeal:   'Avg deal',
}

/**
 * Minimum sales before a rep is ranked on average deal size.
 *
 * `avgDeal = revenue / customers` with no floor put one $50,000 sale above
 * twenty sales worth $800,000 — first place, gold medal, top of the podium. On
 * a page whose whole purpose is comparing people, that metric rewarded selling
 * less. Reps under the threshold are still listed, held out of the ranking and
 * labelled, rather than silently dropped.
 */
export const AVG_DEAL_MIN_SALES = 3

/** The pseudo-name unassigned records used to compete under. */
export const UNASSIGNED = 'Unassigned'

export interface RepStats {
  name: string
  revenue: number
  customers: number
  leads: number
  avgDeal: number
  /** False when this row is held out of the ranking (see `excludedReason`). */
  ranked: boolean
  excludedReason?: string
}

export function metricValue(s: RepStats, metric: Metric): number {
  return s[metric]
}

export function formatMetricValue(
  value: number, metric: Metric, money: (n: number) => string,
): string {
  return metric === 'revenue' || metric === 'avgDeal' ? money(value) : value.toLocaleString()
}

/**
 * Tailwind classes per metric.
 *
 * Every background here is in index.css's `text-white`-on-solid-colour
 * override list, and every text colour has a global light-mode rule — which is
 * what stops the selected pill going dark-navy-on-saturated in light mode.
 * leaderboard.test.ts checks both, since adding a fifth metric with an
 * uncovered hue would break silently.
 */
export const METRIC_BAR: Record<Metric, string> = {
  revenue:   'bg-green-500',
  customers: 'bg-indigo-500',
  leads:     'bg-violet-500',
  avgDeal:   'bg-teal-500',
}

export const METRIC_TEXT: Record<Metric, string> = {
  revenue:   'text-green-400',
  customers: 'text-indigo-400',
  leads:     'text-violet-400',
  avgDeal:   'text-teal-400',
}

export interface Leaderboard {
  /** Competing rows, best first. */
  ranked: RepStats[]
  /**
   * Rows deliberately outside the competition: unassigned records, and reps
   * below the average-deal threshold when that metric is selected.
   */
  excluded: RepStats[]
  totals: { revenue: number; customers: number; leads: number }
  /** The largest ranked value, for bar scaling. */
  topValue: number
}

/**
 * Ranks reps over an already-date-filtered set of records.
 *
 * Credit follows `c.salesman`, the record's *current* assignee, while the
 * period comes from `c.creationDate`. That's the same basis /dashboard,
 * /goals and /reports use, so the figures reconcile — but it means
 * reassigning a customer moves their revenue between reps on every past
 * period too. The page says so rather than implying the ranking is a
 * historical record; fixing it properly needs credit recorded at close time,
 * which the customer document doesn't carry.
 */
export function buildLeaderboard(items: CustomerItem[], metric: Metric): Leaderboard {
  const map = new Map<string, { revenue: number; customers: number; leads: number }>()

  for (const c of items) {
    const name = c.salesman.trim() || UNASSIGNED
    const row = map.get(name) ?? { revenue: 0, customers: 0, leads: 0 }
    if (categoryMatches(c.category, 'Customer')) {
      row.customers++
      row.revenue += c.amount ?? 0
    } else if (categoryMatches(c.category, 'Lead')) {
      row.leads++
    }
    map.set(name, row)
  }

  const all: RepStats[] = [...map.entries()]
    .map(([name, r]) => ({
      name,
      revenue: r.revenue,
      customers: r.customers,
      leads: r.leads,
      avgDeal: r.customers > 0 ? r.revenue / r.customers : 0,
      ranked: true,
    }))
    .filter(s => s.revenue > 0 || s.customers > 0 || s.leads > 0)

  const totals = {
    revenue:   all.reduce((s, r) => s + r.revenue, 0),
    customers: all.reduce((s, r) => s + r.customers, 0),
    leads:     all.reduce((s, r) => s + r.leads, 0),
  }

  const ranked: RepStats[] = []
  const excluded: RepStats[] = []

  for (const row of all) {
    // Unassigned records aggregated into a pseudo-rep that could take a podium
    // slot and a medal — so the top performer could be a data-quality gap.
    if (row.name === UNASSIGNED) {
      excluded.push({ ...row, ranked: false, excludedReason: 'Not assigned to anyone' })
      continue
    }
    if (metric === 'avgDeal' && row.customers < AVG_DEAL_MIN_SALES) {
      excluded.push({
        ...row, ranked: false,
        excludedReason: `Needs ${AVG_DEAL_MIN_SALES} sales to rank on average deal`,
      })
      continue
    }
    ranked.push(row)
  }

  // Name breaks ties. Without it two reps on equal revenue kept whatever order
  // the Map happened to build — which follows first appearance in the customer
  // list, so a reload after any new record could swap silver and bronze.
  const byMetric = (a: RepStats, b: RepStats) =>
    metricValue(b, metric) - metricValue(a, metric) || a.name.localeCompare(b.name)

  ranked.sort(byMetric)
  excluded.sort(byMetric)

  return { ranked, excluded, totals, topValue: ranked[0] ? metricValue(ranked[0], metric) : 0 }
}

/** Bar width as a percentage of the leader, clamped and safe at zero. */
export function barPercent(value: number, topValue: number): number {
  if (topValue <= 0) return 0
  return Math.max(0, Math.min(100, (value / topValue) * 100))
}

/** Explains what the ranking is actually measuring, for the page to state. */
export function describeBasis(metric: Metric): string {
  const base = 'Credited to each record’s current assignee and counted by when the record was created,'
    + ' so reassigning a customer moves their figures between reps.'
  if (metric === 'avgDeal') {
    return `${base} Reps with fewer than ${AVG_DEAL_MIN_SALES} sales are listed but not ranked.`
  }
  return base
}
