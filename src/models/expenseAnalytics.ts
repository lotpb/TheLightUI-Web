import type { Expense } from './expense'

/**
 * Everything /expenses derives from a set of expenses.
 *
 * All of it lived inline in the page as useMemos, which meant the month
 * bucketing, the trailing-window arithmetic and the reimbursable subtotal
 * couldn't be tested — and the page's numbers are the reason anyone opens it.
 */

export const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate()
}

function sumOn(expenses: Expense[], day: Date): number {
  return expenses.reduce((s, e) => (sameDay(e.date, day) ? s + e.amount : s), 0)
}

export interface DayBucket {
  label: string
  total: number
  isToday: boolean
  /** For the chart's accessible table and its tooltip. */
  date: Date
}

/**
 * The seven days ending today.
 *
 * This used to start from the most recent Sunday and walk *forward* seven days
 * — the current calendar week, not the last seven days, despite the name. On a
 * Monday that rendered one populated bar and six empty future ones.
 */
export function groupTrailing7Days(expenses: Expense[], now: Date = new Date()): DayBucket[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(now)
    d.setDate(now.getDate() - (6 - i))
    return { label: DAY_LABELS[d.getDay()], total: sumOn(expenses, d), isToday: i === 6, date: d }
  })
}

/** Every day of the given month, so the chart matches the month being viewed. */
export function groupMonthDays(
  expenses: Expense[],
  year: number,
  month: number,
  now: Date = new Date(),
): DayBucket[] {
  const dayCount = new Date(year, month + 1, 0).getDate()
  return Array.from({ length: dayCount }, (_, i) => {
    const d = new Date(year, month, i + 1)
    return { label: String(i + 1), total: sumOn(expenses, d), isToday: sameDay(d, now), date: d }
  })
}

export interface ExpenseTotals {
  total: number
  count: number
  reimbursable: number
  reimbursableCount: number
}

export function expenseTotals(expenses: Expense[]): ExpenseTotals {
  let total = 0, reimbursable = 0, reimbursableCount = 0
  for (const e of expenses) {
    total += e.amount
    if (e.isReimbursable) { reimbursable += e.amount; reimbursableCount++ }
  }
  return { total, count: expenses.length, reimbursable, reimbursableCount }
}

/** Category totals, largest first. */
export function groupByCategory(expenses: Expense[]): [string, number][] {
  const map: Record<string, number> = {}
  for (const e of expenses) map[e.category] = (map[e.category] ?? 0) + e.amount
  return Object.entries(map).sort((a, b) => b[1] - a[1])
}

/**
 * What the chart header says instead of repeating the total.
 *
 * With the Breakdown open, the same figure appeared three times inside ~400px:
 * the Total card, the donut's centre hole and this header. The average and the
 * peak day are the two things the bars show that no other element does.
 */
export interface ChartSummary {
  /** Mean across every bucket, including the empty ones. */
  perDay: number
  peak: DayBucket | null
}

export function chartSummary(data: DayBucket[]): ChartSummary {
  if (data.length === 0) return { perDay: 0, peak: null }
  let sum = 0
  let peak = data[0]
  for (const d of data) {
    sum += d.total
    if (d.total > peak.total) peak = d
  }
  return { perDay: sum / data.length, peak: peak.total > 0 ? peak : null }
}

// ── Month navigation ──────────────────────────────────────────────────────────

export interface MonthOption {
  year: number
  month: number
  /** Expenses recorded in that month — 0 for a month with a gap in it. */
  count: number
  total: number
}

/**
 * Every month between the oldest record and today, newest first.
 *
 * The navigator moved one month per click with no picker, so reaching a record
 * four years back took up to 48 clicks — and nothing distinguished an empty
 * month from the end of the data until the arrow greyed out. Returning the
 * count per month lets the picker say which months have anything in them.
 *
 * The current month is always included so a fresh account isn't locked out of
 * the view it opens on.
 */
export function availableMonths(expenses: Expense[], now: Date = new Date()): MonthOption[] {
  const idx = (y: number, m: number) => y * 12 + m
  const nowIdx = idx(now.getFullYear(), now.getMonth())

  const buckets = new Map<number, { count: number; total: number }>()
  let min = nowIdx
  for (const e of expenses) {
    const i = idx(e.date.getFullYear(), e.date.getMonth())
    const b = buckets.get(i) ?? { count: 0, total: 0 }
    b.count++
    b.total += e.amount
    buckets.set(i, b)
    if (i < min) min = i
  }
  // A record dated in the future shouldn't be unreachable either.
  const max = Math.max(nowIdx, ...[...buckets.keys()], nowIdx)

  const out: MonthOption[] = []
  for (let i = max; i >= min; i--) {
    const b = buckets.get(i)
    out.push({
      year: Math.floor(i / 12),
      month: i % 12,
      count: b?.count ?? 0,
      total: b?.total ?? 0,
    })
  }
  return out
}

// ── Sorting ───────────────────────────────────────────────────────────────────

export type ExpenseSortKey =
  | 'dateDesc' | 'dateAsc' | 'amountDesc' | 'amountAsc' | 'title' | 'category'

/**
 * expenseService sorts by date descending and that was the only order
 * available, so "what were my biggest expenses" — the second question anyone
 * asks of a spend list — couldn't be answered per expense.
 */
export const EXPENSE_SORTS: { key: ExpenseSortKey; label: string }[] = [
  { key: 'dateDesc',   label: 'Newest first' },
  { key: 'dateAsc',    label: 'Oldest first' },
  { key: 'amountDesc', label: 'Largest first' },
  { key: 'amountAsc',  label: 'Smallest first' },
  { key: 'title',      label: 'Title A–Z' },
  { key: 'category',   label: 'Category A–Z' },
]

export const DEFAULT_EXPENSE_SORT: ExpenseSortKey = 'dateDesc'

/** Returns a new array; ties break on date so equal rows hold their place. */
export function sortExpenses(expenses: Expense[], key: ExpenseSortKey): Expense[] {
  const byDate = (a: Expense, b: Expense) => b.date.getTime() - a.date.getTime()
  const cmp: Record<ExpenseSortKey, (a: Expense, b: Expense) => number> = {
    dateDesc:   byDate,
    dateAsc:    (a, b) => a.date.getTime() - b.date.getTime(),
    amountDesc: (a, b) => b.amount - a.amount,
    amountAsc:  (a, b) => a.amount - b.amount,
    title:      (a, b) => (a.title || '—').localeCompare(b.title || '—'),
    category:   (a, b) => a.category.localeCompare(b.category),
  }
  const primary = cmp[key]
  return [...expenses].sort((a, b) => primary(a, b) || byDate(a, b))
}

// ── Filtering ─────────────────────────────────────────────────────────────────

export interface ExpenseFilters {
  period: 'all' | 'month'
  year: number
  month: number
  search: string
  /** Set by clicking a donut slice or a legend row. */
  category: string | null
  reimbursableOnly: boolean
}

/**
 * The donut, its legend and the row pills were all decoration: you could see
 * that Travel was $4,200 and had no way to list the Travel expenses. The
 * Reimbursable strip was likewise a total with nothing behind it.
 */
export function filterExpenses(expenses: Expense[], f: ExpenseFilters): Expense[] {
  const q = f.search.trim().toLowerCase()
  return expenses.filter(e => {
    if (f.period === 'month') {
      if (e.date.getFullYear() !== f.year || e.date.getMonth() !== f.month) return false
    }
    if (f.category !== null && e.category !== f.category) return false
    if (f.reimbursableOnly && !e.isReimbursable) return false
    if (q) {
      return e.title.toLowerCase().includes(q)
        || e.category.toLowerCase().includes(q)
        || (e.notes ?? '').toLowerCase().includes(q)
    }
    return true
  })
}

/** Names the active filters, for the print header and the empty state. */
export function describeFilters(f: ExpenseFilters): string {
  const parts: string[] = [
    f.period === 'all' ? 'All time' : `${MONTHS[f.month]} ${f.year}`,
  ]
  if (f.category !== null) parts.push(f.category)
  if (f.reimbursableOnly) parts.push('reimbursable only')
  if (f.search.trim()) parts.push(`matching “${f.search.trim()}”`)
  return parts.join(' · ')
}
