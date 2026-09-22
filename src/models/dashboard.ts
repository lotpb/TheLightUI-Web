import { categoryMatches, type CustomerItem } from './customer'
import {
  currentPeriodRange, goalActuals, emptyGoalValues,
  type GoalDoc, type GoalPeriod, type GoalValues, type PeriodRange,
} from './goal'
import { buildLeaderboard, type RepStats } from './leaderboard'

/**
 * Presentation logic for /dashboard.
 *
 * The page carried three unlabelled definitions of "revenue", a period control
 * that only rescoped four of its fourteen blocks, and its own copies of day
 * arithmetic, money formatting and rep ranking that the shared models already
 * owned. Everything here exists so those questions have one answer that a test
 * can hold still.
 */

// ── Periods ───────────────────────────────────────────────────────────────────

export type SnapshotPeriod = 'today' | 'month' | 'year'

export const SNAPSHOT_PERIODS: SnapshotPeriod[] = ['today', 'month', 'year']

/** The tab label. */
export const PERIOD_TABS: Record<SnapshotPeriod, string> = {
  today: 'Today', month: 'Month', year: 'Year',
}

/** A title suffix: "Leads This Month". */
export const PERIOD_SUFFIX: Record<SnapshotPeriod, string> = {
  today: 'Today', month: 'This Month', year: 'This Year',
}

/** An empty-state phrase: "no leads this month". */
export const PERIOD_PHRASE: Record<SnapshotPeriod, string> = {
  today: 'today', month: 'this month', year: 'this year',
}

/** The printed report's name: "Monthly Snapshot". */
export const PERIOD_TITLE: Record<SnapshotPeriod, string> = {
  today: 'Daily', month: 'Monthly', year: 'Yearly',
}

export interface DashboardRange {
  key: string
  label: string
  short: string
  start: Date
  end: Date
}

/**
 * The selected period as a concrete range.
 *
 * 'today' is a local calendar day; 'month' and 'year' delegate to
 * models/goal's period maths so the dashboard, /goals and /reports can't
 * disagree about when a month starts.
 */
export function dashboardRange(period: SnapshotPeriod, now = new Date()): DashboardRange {
  if (period === 'today') {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const end   = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999)
    return {
      key: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`,
      label: start.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }),
      short: 'Today',
      start,
      end,
    }
  }
  const r = currentPeriodRange(period, now)
  return { key: r.key, label: r.label, short: r.short, start: r.start, end: r.end }
}

/**
 * Which goal period a snapshot tab maps onto.
 *
 * There are no daily targets, so the Today tab shows the month it sits in —
 * the card says which period it's reporting, rather than the page implying a
 * daily goal exists. The Year tab now actually moves the Goals card, which was
 * previously pinned to `goals.month` even though `resolveGoalTargets` had
 * already resolved the year target from the same document.
 */
export function goalPeriodFor(period: SnapshotPeriod): GoalPeriod {
  return period === 'year' ? 'year' : 'month'
}

/** The goal targets and actuals for the selected tab. */
export function goalsForPeriod(
  goals: GoalDoc | null,
  customers: CustomerItem[],
  period: SnapshotPeriod,
  now = new Date(),
): { range: PeriodRange; target: GoalValues; actual: GoalValues; hasTargets: boolean } {
  const goalPeriod = goalPeriodFor(period)
  const range  = currentPeriodRange(goalPeriod, now)
  const target = goals?.[goalPeriod] ?? emptyGoalValues()
  return {
    range,
    target,
    actual: goalActuals(customers, range),
    hasTargets: target.revenue > 0 || target.leads > 0 || target.customers > 0,
  }
}

// ── What each block is measuring ──────────────────────────────────────────────

/**
 * How far a block's figures reach.
 *
 * The period tabs read as a global control but only four of fourteen blocks
 * respond to them, so picking "Year" left ten blocks identical — which reads
 * as stale data rather than as intent. Every block now declares its scope and
 * the page groups them accordingly, so an unchanged figure is explained.
 */
export type BlockScope = 'period' | 'now' | 'allTime'

export const SCOPE_NOTE: Record<BlockScope, string> = {
  period:  'follows the selected period',
  now:     'current state, not affected by the period',
  allTime: 'all time, not affected by the period',
}

/** The short suffix beside a card's heading. */
export const SCOPE_SUFFIX: Record<BlockScope, string> = {
  period:  '',
  now:     'current',
  allTime: 'all time',
}

// ── Money bases ───────────────────────────────────────────────────────────────

/**
 * The three distinct things this page calls money, kept apart on purpose.
 *
 * With Month selected the page showed paid-invoice totals, deal value on
 * records created this month, and an all-time server aggregate — three
 * measurements under labels that all read as "money earned", with nothing
 * saying they were computed differently. The labels now name the measurement
 * and each carries its basis as a tooltip.
 */
export const MONEY_BASIS = {
  /** Sum of invoiceTotal over invoices with status 'paid' issued in the period. */
  invoiced: 'Paid invoices issued in this period',
  /** Sum of customer.amount over Customer records created in the period. */
  dealValue: 'Deal value on customer records created in this period',
  /** Server-side sum('amount') over every Customer record, ignoring the period. */
  lifetime: 'Lifetime deal value across all customer records',
  /** Sum of expense.amount over expenses dated in the period. */
  expenses: 'Expenses dated in this period',
} as const

export const MONEY_LABELS = {
  invoiced:  'Invoiced',
  dealValue: 'Deal Value',
  lifetime:  'Lifetime Value',
} as const

// ── Top performer ─────────────────────────────────────────────────────────────

/**
 * The leading rep in a range, using /leaderboard's ranking.
 *
 * The page ranked reps inline with `c.salesman.trim() || 'Unassigned'`, which
 * made unassigned records compete as a person — so "Top Salesman" could be
 * "Unassigned", i.e. a data-quality gap wearing a trophy. buildLeaderboard
 * already holds that pseudo-rep out of the ranking and breaks ties by name, so
 * the dashboard and /leaderboard now agree on who is winning.
 */
export function topPerformerIn(
  customers: CustomerItem[], range: { start: Date; end: Date },
): RepStats | null {
  const from = range.start.getTime()
  const to   = range.end.getTime()
  const inRange = customers.filter(c => {
    const t = c.creationDate?.getTime() ?? 0
    return t >= from && t <= to
  })
  return buildLeaderboard(inRange, 'revenue').ranked[0] ?? null
}

// ── Counts ────────────────────────────────────────────────────────────────────

/** Appointments whose start date falls inside the given local day. */
export function appointmentsOnDay(customers: CustomerItem[], now = new Date()): CustomerItem[] {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const end   = new Date(start.getTime() + 86_400_000)
  return customers.filter(c => c.isActive && c.startDate && c.startDate >= start && c.startDate < end)
}

export const UPCOMING_WINDOW_DAYS = 7

/**
 * Active appointments after today, soonest first.
 *
 * Bounded so "upcoming" means a week rather than everything on file — the
 * window is in the heading so the number is falsifiable.
 */
export function upcomingAppointments(
  customers: CustomerItem[], now = new Date(), days = UPCOMING_WINDOW_DAYS,
): CustomerItem[] {
  const startBound = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999)
  const endBound   = new Date(startBound.getTime() + days * 86_400_000)
  return customers
    .filter(c => c.isActive && c.startDate && c.startDate > startBound && c.startDate <= endBound)
    .sort((a, b) => a.startDate!.getTime() - b.startDate!.getTime())
}

/** Open leads and customers grouped by pipeline stage. */
export function stageCountsOf(
  customers: CustomerItem[],
  stageIdOf: (c: CustomerItem) => string,
  stageIds: string[],
): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const id of stageIds) counts[id] = 0
  for (const c of customers) {
    if (!(categoryMatches(c.category, 'Lead') || categoryMatches(c.category, 'Customer'))) continue
    const id = stageIdOf(c)
    counts[id] = (counts[id] ?? 0) + 1
  }
  return counts
}

// ── Activity glyph tints ──────────────────────────────────────────────────────

/**
 * Re-exported from models/activity, which owns it now that /records/:id tints
 * the same glyphs.
 *
 * The timeline special-cased calls with a hand-inlined phone SVG so it could
 * be tinted green, while every other type rendered an untinted ACTIVITY_ICONS
 * glyph — but ACTIVITY_ICONS.call is already that same phone path, so the copy
 * existed only to carry a class.
 */
export { ACTIVITY_TINT } from './activity'
