import { categoryMatches, type CustomerItem } from './customer'

export interface GoalValues {
  revenue: number
  leads: number
  customers: number
}

export interface GoalDoc {
  companyId: string
  /** The *current* month/quarter/year targets, resolved from `periods`. */
  month: GoalValues
  quarter: GoalValues
  year: GoalValues
  /**
   * Targets keyed by period instance — '2026-09', '2026-Q3', '2026'.
   *
   * Targets used to be stored as three flat fields, so when the month rolled
   * over the actuals reset to zero and September's target silently became
   * October's, with no record that September had ever had one. Keying by
   * instance means a past period keeps its target, and because actuals are
   * always recomputed from the customer records (which are kept), any past
   * period can be reported without a snapshot job.
   */
  periods: Record<string, GoalValues>
  updatedAt: Date
}

export const emptyGoalValues = (): GoalValues => ({ revenue: 0, leads: 0, customers: 0 })

export const emptyGoalDoc = (): Omit<GoalDoc, 'companyId' | 'updatedAt'> => ({
  month:   emptyGoalValues(),
  quarter: emptyGoalValues(),
  year:    emptyGoalValues(),
  periods: {},
})

export type GoalPeriod = 'month' | 'quarter' | 'year'

export const GOAL_PERIODS: { key: GoalPeriod; label: string }[] = [
  { key: 'month',   label: 'Month' },
  { key: 'quarter', label: 'Quarter' },
  { key: 'year',    label: 'Year' },
]

// ── Reading a stored document ─────────────────────────────────────────────────

/** Coerces one stored target triple, tolerating anything Firestore hands back. */
export function coerceGoalValues(v: unknown): GoalValues {
  if (typeof v !== 'object' || v === null) return emptyGoalValues()
  const obj = v as Record<string, unknown>
  return {
    revenue:   typeof obj['revenue']   === 'number' ? obj['revenue']   : 0,
    leads:     typeof obj['leads']     === 'number' ? obj['leads']     : 0,
    customers: typeof obj['customers'] === 'number' ? obj['customers'] : 0,
  }
}

/**
 * Resolves the current month/quarter/year targets from a stored document.
 *
 * Lives here rather than in the service because it's the migration-sensitive
 * part and the service can't be imported under the node test environment —
 * its import chain reaches authStore, which registers a `document` listener at
 * module load.
 *
 * Targets are keyed by period instance now, but documents written before that
 * carry flat `month`/`quarter`/`year` fields. Those are read as the *current*
 * instance's targets, which is exactly how they were being used, so nothing
 * needs migrating and /dashboard — which reads only `doc.month` — is
 * unaffected. A legacy field is never used for a past instance: treating last
 * month's target as this month's is the bug being fixed.
 */
export function resolveGoalTargets(
  raw: Record<string, unknown>,
  now = new Date(),
): { periods: Record<string, GoalValues>; month: GoalValues; quarter: GoalValues; year: GoalValues } {
  const rawPeriods = (typeof raw['periods'] === 'object' && raw['periods'] !== null)
    ? raw['periods'] as Record<string, unknown>
    : {}

  const periods: Record<string, GoalValues> = {}
  for (const [key, value] of Object.entries(rawPeriods)) periods[key] = coerceGoalValues(value)

  const resolve = (period: GoalPeriod): GoalValues =>
    periods[currentPeriodRange(period, now).key] ?? coerceGoalValues(raw[period])

  return {
    periods,
    month:   resolve('month'),
    quarter: resolve('quarter'),
    year:    resolve('year'),
  }
}

// ── Which fields a goal has ───────────────────────────────────────────────────

/**
 * One description of the three tracked figures.
 *
 * The page repeated three near-identical GoalCard calls, each carrying its own
 * emoji and its own inline formatter — so Revenue was a 💰 and a currency
 * closure in one place and a bare number in the summary table beneath.
 */
export interface GoalFieldDef {
  key: keyof GoalValues
  label: string
  /** Key into ICONS. Was an emoji, which paints its own bitmap and so can
   *  never take the colour of the text beside it. */
  icon: 'currencyDollar' | 'user' | 'checkCircle'
  money: boolean
  /** Sensible nudge for the number input. */
  step: number
}

export const GOAL_FIELDS: GoalFieldDef[] = [
  { key: 'revenue',   label: 'Revenue',       icon: 'currencyDollar', money: true,  step: 1000 },
  { key: 'leads',     label: 'New Leads',     icon: 'user',           money: false, step: 1 },
  { key: 'customers', label: 'New Customers', icon: 'checkCircle',    money: false, step: 1 },
]

// ── Period ranges ─────────────────────────────────────────────────────────────

export interface PeriodRange {
  /** Stable identifier for this instance: '2026-09', '2026-Q3', '2026'. */
  key: string
  period: GoalPeriod
  label: string       // "September 2026"
  short: string       // "Sep"
  start: Date
  end: Date
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

export function periodKey(period: GoalPeriod, date: Date): string {
  const y = date.getFullYear()
  if (period === 'month')   return `${y}-${pad2(date.getMonth() + 1)}`
  if (period === 'quarter') return `${y}-Q${Math.floor(date.getMonth() / 3) + 1}`
  return String(y)
}

/**
 * A period instance, `offset` whole periods from the one containing `now`.
 *
 * offset 0 is the current period, -1 the previous one. The page could only
 * ever show the current month/quarter/year, so there was no way to see
 * whether last month's goal had been hit.
 */
export function periodRange(period: GoalPeriod, offset = 0, now = new Date()): PeriodRange {
  const y = now.getFullYear()
  const m = now.getMonth()

  if (period === 'month') {
    const start = new Date(y, m + offset, 1)
    const end   = new Date(y, m + offset + 1, 0, 23, 59, 59, 999)
    return {
      key: periodKey('month', start),
      period,
      label: start.toLocaleString('en-US', { month: 'long', year: 'numeric' }),
      short: start.toLocaleString('en-US', { month: 'short' }),
      start, end,
    }
  }

  if (period === 'quarter') {
    const q     = Math.floor(m / 3) + offset
    const start = new Date(y, q * 3, 1)
    const end   = new Date(y, q * 3 + 3, 0, 23, 59, 59, 999)
    const qNum  = Math.floor(start.getMonth() / 3) + 1
    return {
      key: periodKey('quarter', start),
      period,
      label: `Q${qNum} ${start.getFullYear()}`,
      short: `Q${qNum} ${start.getFullYear()}`,
      start, end,
    }
  }

  const start = new Date(y + offset, 0, 1)
  const end   = new Date(y + offset, 11, 31, 23, 59, 59, 999)
  return {
    key: periodKey('year', start),
    period,
    label: String(start.getFullYear()),
    short: String(start.getFullYear()),
    start, end,
  }
}

/** The current instance. Kept for /dashboard, which reads only this. */
export function currentPeriodRange(period: GoalPeriod, now = new Date()): PeriodRange {
  return periodRange(period, 0, now)
}

// ── Actuals ───────────────────────────────────────────────────────────────────

/**
 * What the company actually did in a period.
 *
 * Revenue used to be `inPeriod.reduce((s, c) => s + (c.amount ?? 0), 0)` with
 * no category filter, so unconverted leads' quote amounts — plus vendors and
 * employees — all counted toward the revenue goal. /dashboard computes the
 * identical shape over the identical range and filters to Customer, so the
 * two pages disagreed about the same month, in the flattering direction.
 */
export function goalActuals(customers: CustomerItem[], range: PeriodRange): GoalValues {
  let revenue = 0, leads = 0, custs = 0
  const from = range.start.getTime()
  const to   = range.end.getTime()

  for (const c of customers) {
    const t = c.creationDate?.getTime() ?? 0
    if (t < from || t > to) continue
    if (categoryMatches(c.category, 'Customer')) { custs++; revenue += c.amount ?? 0 }
    else if (categoryMatches(c.category, 'Lead')) leads++
  }
  return { revenue, leads, customers: custs }
}

// ── Pace ──────────────────────────────────────────────────────────────────────

/**
 * Which calendar day a local date falls on, as a whole-day index.
 *
 * Counting days by dividing milliseconds is wrong across a DST boundary: a
 * March period spans 31 calendar days but only 30 days and 23 hours of
 * elapsed time, so `(end - start) / 86400000` rounds to the wrong day count
 * twice a year. Comparing calendar dates avoids the question — the same
 * reasoning as dayIndexUTC in utils/dueDate.ts.
 */
function localDayIndex(d: Date): number {
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000)
}

/** Total calendar days in the period. */
export function daysInPeriod(range: PeriodRange): number {
  return localDayIndex(range.end) - localDayIndex(range.start) + 1
}

/**
 * Days left including today, so the last day of a period reads "1 day
 * remaining" rather than "0" — and so `daysLeft > 0` still means the period
 * is live. 0 only once it has ended.
 */
export function daysLeftIn(range: PeriodRange, now = new Date()): number {
  if (now.getTime() > range.end.getTime()) return 0
  return Math.max(0, localDayIndex(range.end) - localDayIndex(now) + 1)
}

/** Days the period has been running, at least 1 so rates stay divisible. */
export function daysElapsedIn(range: PeriodRange, now = new Date()): number {
  const elapsed = localDayIndex(now) - localDayIndex(range.start) + 1
  return Math.min(daysInPeriod(range), Math.max(1, elapsed))
}

/** How far through the period we are, 0–1. */
export function paceFraction(range: PeriodRange, now = new Date()): number {
  const total = range.end.getTime() - range.start.getTime()
  if (total <= 0) return 1
  return Math.min(1, Math.max(0, (now.getTime() - range.start.getTime()) / total))
}

export function periodHasEnded(range: PeriodRange, now = new Date()): boolean {
  return now.getTime() > range.end.getTime()
}

// ── Progress ──────────────────────────────────────────────────────────────────

/**
 * 'behind' and 'at-risk' are separate because they call for different actions.
 * Everything under pace used to be a single yellow "Behind", so 2% of target
 * with the period 95% gone looked exactly like 88%.
 */
export type GoalState = 'no-target' | 'met' | 'on-track' | 'behind' | 'at-risk' | 'missed'

export interface GoalProgress {
  state: GoalState
  /** Not clamped: beating a target by 150% should be visible. */
  pct: number
  /** Clamped to 100 — only for a bar's width. */
  barPct: number
  met: boolean
  remaining: number
  daysLeft: number
  /** What's still needed per remaining day, or null once the period is over. */
  neededPerDay: number | null
  /** The rate achieved so far. */
  achievedPerDay: number
  pace: number
}

/**
 * Where a figure stands against its target.
 *
 * On-track is judged on rates rather than a fixed percentage-point grace:
 * what is still needed per remaining day, against the rate already being
 * achieved. That gives the page a number it can state, and it degrades
 * sensibly at the end of a period where comparing percentages doesn't.
 */
export function goalProgress(
  actual: number, target: number, range: PeriodRange, now = new Date(),
): GoalProgress {
  const pace     = paceFraction(range, now)
  const daysLeft = daysLeftIn(range, now)
  const elapsed  = daysElapsedIn(range, now)
  const achieved = actual / elapsed
  const ended    = periodHasEnded(range, now)

  if (target <= 0) {
    return {
      state: 'no-target', pct: 0, barPct: 0, met: false, remaining: 0,
      daysLeft, neededPerDay: null, achievedPerDay: achieved, pace,
    }
  }

  const pct       = (actual / target) * 100
  const met       = actual >= target
  const remaining = Math.max(0, target - actual)
  const neededPerDay = daysLeft > 0 ? remaining / daysLeft : null

  let state: GoalState
  if (met) state = 'met'
  else if (ended || daysLeft === 0) state = 'missed'
  else if (neededPerDay !== null && achieved > 0 && neededPerDay <= achieved) state = 'on-track'
  else if (neededPerDay !== null && achieved > 0 && neededPerDay <= achieved * 2) state = 'behind'
  else state = 'at-risk'

  return {
    state, pct, barPct: Math.min(100, pct), met, remaining,
    daysLeft, neededPerDay, achievedPerDay: achieved, pace,
  }
}

export interface GoalStateStyle {
  label: string
  textClass: string
  barClass: string
}

export const GOAL_STATE_STYLES: Record<GoalState, GoalStateStyle> = {
  'no-target': { label: 'No target set', textClass: 'text-gray-300',    barClass: 'bg-gray-600' },
  met:         { label: 'Goal met',      textClass: 'text-emerald-400', barClass: 'bg-emerald-500' },
  'on-track':  { label: 'On track',      textClass: 'text-green-400',   barClass: 'bg-green-500' },
  behind:      { label: 'Behind',        textClass: 'text-amber-400',   barClass: 'bg-amber-500' },
  'at-risk':   { label: 'At risk',       textClass: 'text-red-400',     barClass: 'bg-red-500' },
  missed:      { label: 'Missed',        textClass: 'text-red-400',     barClass: 'bg-red-500' },
}

// ── Editing ───────────────────────────────────────────────────────────────────

/**
 * Parses a target out of an input.
 *
 * The old parser was `parseFloat(raw.replace(/[^0-9.]/g, '')) || 0`, which
 * turned "1.5.5" into 1.5 and "-500" into 500 without comment, and could not
 * tell a cleared field from a target of zero.
 */
export function parseTarget(raw: string): number | null {
  // Checked before stripping: the old regex removed the '-' first, so the
  // n < 0 guard never saw it and -500 was stored as 500.
  if (raw.includes('-')) return null
  const cleaned = raw.replace(/[^0-9.]/g, '')
  if (!cleaned) return null
  const n = Number(cleaned)
  if (!Number.isFinite(n) || n < 0) return null
  return n
}

/** Whether a draft differs from what's stored, so Save can mean something. */
export function goalsDirty(draft: GoalValues, saved: GoalValues): boolean {
  return draft.revenue !== saved.revenue
    || draft.leads !== saved.leads
    || draft.customers !== saved.customers
}
