/**
 * The maths behind /forecast, pulled out of the page so it can be tested.
 *
 * It was inline, and four separate defects were invisible there. Each is
 * reproduced as a test in forecast.test.ts:
 *
 *   1. Math.max(0, …) on every projected point, so a declining business could
 *      only ever forecast a flat $0 — the chart, the table and the KPI all
 *      showed zeros with nothing to say why.
 *   2. The regression's last point was the month you're standing in, always
 *      partial. On a business flat at $50k/month, opening the page on the 3rd
 *      produced a 6-month total of $41,428 instead of $300,000 — a 86% swing
 *      from the calendar alone.
 *   3. Months with no revenue were dropped rather than counted as zero, so
 *      `slice(-6)` took the last six months *that had revenue* — which for a
 *      seasonal book is a fit that ends three months in the past, under a
 *      footnote reading "recent months".
 *   4. Growth compared `slice(0, floor(n/2))` with `slice(floor(n/2))`, giving
 *      the second half the extra month. A business with identical revenue
 *      every month reported +50% growth on five active months, +33% on seven,
 *      +25% on nine.
 */

export interface MonthPoint {
  /** "2026-09" */
  key: string
  revenue: number
  deals: number
  /** The month in progress. Shown, but never fitted. */
  partial: boolean
}

export interface ForecastPoint {
  key: string
  projected: number
  low: number
  high: number
}

export type Trend = 'rising' | 'flat' | 'declining'

export interface ForecastResult {
  points: ForecastPoint[]
  /** Dollars per month. Negative means declining, and is not hidden. */
  slope: number
  trend: Trend
  /** How many complete months the fit actually used. */
  basisMonths: number
  /**
   * Months until the trend line reaches zero, when it is falling and the
   * clamp would otherwise turn a decline into an unexplained flat $0.
   */
  monthsToZero: number | null
  /** Residual standard error of the fit, in dollars. Drives the band. */
  stdError: number
}

export function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1)
}

/** N month keys ending at the month containing `now`. */
export function lastNMonths(n: number, now: Date = new Date()): string[] {
  const out: string[] = []
  for (let i = n - 1; i >= 0; i--) out.push(monthKey(addMonths(now, -i)))
  return out
}

/** N month keys starting the month after `now`. */
export function nextNMonths(n: number, now: Date = new Date()): string[] {
  const out: string[] = []
  for (let i = 1; i <= n; i++) out.push(monthKey(addMonths(now, i)))
  return out
}

export function formatMonth(key: string): string {
  const [y, m] = key.split('-')
  return new Date(Number(y), Number(m) - 1, 1)
    .toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
}

/**
 * A dense month-by-month series — every month in the window, including the
 * ones with no revenue.
 *
 * Leading empty months are trimmed, because a company whose first sale was six
 * months ago shouldn't have eighteen months of pre-history zeros dragging its
 * trend down. Empty months *after* trading starts are real zeros and stay.
 */
export function buildSeries(
  records: { date: Date; amount: number }[],
  windowKeys: string[],
  now: Date = new Date(),
): MonthPoint[] {
  const revenue = new Map<string, number>()
  const deals   = new Map<string, number>()
  for (const r of records) {
    const k = monthKey(r.date)
    revenue.set(k, (revenue.get(k) ?? 0) + r.amount)
    deals.set(k, (deals.get(k) ?? 0) + 1)
  }
  const current = monthKey(now)
  const series = windowKeys.map(key => ({
    key,
    revenue: revenue.get(key) ?? 0,
    deals: deals.get(key) ?? 0,
    partial: key === current,
  }))
  const firstReal = series.findIndex(p => p.revenue > 0 || p.deals > 0)
  return firstReal <= 0 ? series : series.slice(firstReal)
}

/** [slope, intercept, residual standard error]. */
export function linReg(points: [number, number][]): [number, number, number] {
  const n = points.length
  if (n < 2) return [0, points[0]?.[1] ?? 0, 0]
  const sx  = points.reduce((s, [x]) => s + x, 0)
  const sy  = points.reduce((s, [, y]) => s + y, 0)
  const sxy = points.reduce((s, [x, y]) => s + x * y, 0)
  const sxx = points.reduce((s, [x]) => s + x * x, 0)
  const denom = n * sxx - sx * sx
  if (denom === 0) return [0, sy / n, 0]
  const slope = (n * sxy - sx * sy) / denom
  const intercept = (sy - slope * sx) / n
  // Residual standard error. n - 2 degrees of freedom; with exactly two points
  // the line is exact and there is nothing left to estimate spread from.
  const ss = points.reduce((s, [x, y]) => {
    const e = y - (slope * x + intercept)
    return s + e * e
  }, 0)
  const stdError = n > 2 ? Math.sqrt(ss / (n - 2)) : 0
  return [slope, intercept, stdError]
}

/** Months used for the fit. Enough to see a trend, few enough to be recent. */
export const BASIS_MONTHS = 6
/** Fewer than this and a straight line through the points means nothing. */
export const MIN_BASIS = 3

export function forecastRevenue(
  series: MonthPoint[],
  horizon: number,
  now: Date = new Date(),
): ForecastResult | null {
  // The month in progress is excluded: it is always a fraction of itself, and
  // as the most recent point it dominated the fit.
  const complete = series.filter(p => !p.partial)
  if (complete.length < MIN_BASIS) return null

  const basis = complete.slice(-BASIS_MONTHS)
  const points = basis.map((p, i) => [i, p.revenue] as [number, number])
  const [slope, intercept, stdError] = linReg(points)

  const n = points.length
  const meanX = points.reduce((s, [x]) => s + x, 0) / n
  const sxx   = points.reduce((s, [x]) => s + (x - meanX) ** 2, 0)

  const keys = nextNMonths(horizon, now)
  const out: ForecastPoint[] = keys.map((key, i) => {
    const x   = n + i                       // continue past the end of the fit
    const raw = slope * x + intercept
    // A prediction interval, so the band widens with distance instead of
    // sitting at a flat ±20% that had no relationship to the data at all.
    const margin = stdError > 0 && sxx > 0
      ? 1.96 * stdError * Math.sqrt(1 + 1 / n + (x - meanX) ** 2 / sxx)
      : 0
    return {
      key,
      projected: Math.max(0, Math.round(raw)),
      low:  Math.max(0, Math.round(raw - margin)),
      high: Math.max(0, Math.round(raw + margin)),
    }
  })

  // Revenue can't go negative, so the projection is still floored at zero —
  // but a business whose trend runs into the floor now gets told so, instead
  // of reading a flat $0 line with no explanation.
  let monthsToZero: number | null = null
  if (slope < 0) {
    const atEnd = slope * (n - 1) + intercept
    const m = Math.ceil(atEnd / -slope)
    if (m >= 0 && m <= horizon) monthsToZero = m
  }

  // A slope worth calling a direction: more than 2% of the basis average a
  // month. Below that it's noise, and an arrow either way would be a lie.
  const avg = basis.reduce((s, p) => s + p.revenue, 0) / n
  const threshold = Math.max(1, avg * 0.02)
  const trend: Trend = slope > threshold ? 'rising' : slope < -threshold ? 'declining' : 'flat'

  return { points: out, slope, trend, basisMonths: n, monthsToZero, stdError }
}

export interface ChartRow {
  month: string
  key: string
  /** Complete months only. */
  actual: number | null
  /** The month in progress, plus the point before it so the segment joins. */
  partial: number | null
  /** Anchored at the last complete month so the dashed line has a start. */
  projected: number | null
  low: number | null
  /** high − low, stacked on `low` to draw the band without a cut-out. */
  band: number | null
}

/**
 * History and projection in one row set.
 *
 * `actual` stops at the last complete month and `partial` carries the month in
 * progress separately: plotting a third of a month as a finished one made the
 * line appear to fall off a cliff at the right edge every month and recover
 * over the following four weeks.
 */
export function buildChartRows(
  series: MonthPoint[],
  forecastPoints: ForecastPoint[],
): ChartRow[] {
  const complete = series.filter(p => !p.partial)
  const lastCompleteKey = complete.length > 0 ? complete[complete.length - 1].key : undefined
  const hist: ChartRow[] = series.map((p, i) => ({
    month: formatMonth(p.key),
    key: p.key,
    actual: p.partial ? null : p.revenue,
    partial: p.partial || series[i + 1]?.partial ? p.revenue : null,
    projected: p.key === lastCompleteKey ? p.revenue : null,
    low: null,
    band: null,
  }))
  const fwd: ChartRow[] = forecastPoints.map(f => ({
    month: formatMonth(f.key),
    key: f.key,
    actual: null,
    partial: null,
    projected: f.projected,
    low: f.low,
    band: Math.max(0, f.high - f.low),
  }))
  return [...hist, ...fwd]
}

/**
 * Period-over-period growth across equal halves.
 *
 * Uses the dense series, so a month with no revenue counts against you, and
 * drops the middle month when the count is odd rather than handing it to the
 * second half.
 */
export function growthRate(series: MonthPoint[]): number | null {
  const complete = series.filter(p => !p.partial)
  if (complete.length < 4) return null
  const half = Math.floor(complete.length / 2)
  const first  = complete.slice(0, half)
  const second = complete.slice(complete.length - half)   // equal length, always
  const a = first.reduce((s, p) => s + p.revenue, 0)
  const b = second.reduce((s, p) => s + p.revenue, 0)
  if (a === 0) return null
  return ((b - a) / a) * 100
}
