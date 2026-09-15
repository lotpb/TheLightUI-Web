import { describe, it, expect } from 'vitest'
import type { Expense } from './expense'
import {
  expenseTotals, groupByCategory, groupTrailing7Days, groupMonthDays,
  chartSummary, availableMonths, sortExpenses, filterExpenses, describeFilters,
  EXPENSE_SORTS, DEFAULT_EXPENSE_SORT,
  type ExpenseFilters, type ExpenseSortKey,
} from './expenseAnalytics'

/**
 * Local midnight. `new Date('2026-06-15')` parses as UTC, so in a negative
 * offset it lands on the 14th and every day count comes out one short — a
 * Firestore Timestamp becomes a local instant, so fixtures must be local.
 */
const day = (y: number, m: number, d: number) => new Date(y, m - 1, d)

const NOW = new Date(2026, 5, 15, 12, 0, 0) // 15 June 2026, local noon

function exp(over: Partial<Expense> = {}): Expense {
  return {
    id: 'e1',
    title: 'Fuel',
    amount: 100,
    category: 'Travel',
    date: day(2026, 6, 15),
    notes: '',
    isReimbursable: false,
    lastUpdate: day(2026, 6, 15),
    ...over,
  }
}

describe('expenseTotals', () => {
  it('sums amounts and counts rows', () => {
    const t = expenseTotals([exp({ amount: 100 }), exp({ id: 'e2', amount: 250.5 })])
    expect(t.total).toBeCloseTo(350.5, 6)
    expect(t.count).toBe(2)
  })

  it('subtotals only the reimbursable rows, and counts them', () => {
    // The green strip was a total with no count behind it.
    const t = expenseTotals([
      exp({ id: 'a', amount: 100, isReimbursable: true }),
      exp({ id: 'b', amount: 40 }),
      exp({ id: 'c', amount: 60, isReimbursable: true }),
    ])
    expect(t.total).toBe(200)
    expect(t.reimbursable).toBe(160)
    expect(t.reimbursableCount).toBe(2)
  })

  it('is all zeroes for an empty list', () => {
    expect(expenseTotals([])).toEqual({ total: 0, count: 0, reimbursable: 0, reimbursableCount: 0 })
  })
})

describe('groupByCategory', () => {
  it('totals per category, largest first', () => {
    const rows = groupByCategory([
      exp({ id: 'a', category: 'Food', amount: 30 }),
      exp({ id: 'b', category: 'Travel', amount: 500 }),
      exp({ id: 'c', category: 'Food', amount: 20 }),
    ])
    expect(rows).toEqual([['Travel', 500], ['Food', 50]])
  })

  it('keeps a category not in the enum rather than dropping it', () => {
    // Legacy and imported rows carry arbitrary strings.
    expect(groupByCategory([exp({ category: 'Fuel Surcharge' })])).toEqual([['Fuel Surcharge', 100]])
  })
})

describe('groupTrailing7Days', () => {
  it('ends on today and covers seven days of real history', () => {
    const buckets = groupTrailing7Days([], NOW)
    expect(buckets).toHaveLength(7)
    expect(buckets[6].isToday).toBe(true)
    expect(buckets[6].date.getDate()).toBe(15)
    expect(buckets[0].date.getDate()).toBe(9)
  })

  it('never includes a future day', () => {
    // It used to walk forward from Sunday, so on a Monday six of the seven
    // bars were days that hadn't happened.
    for (const b of groupTrailing7Days([], NOW)) {
      expect(b.date.getTime()).toBeLessThanOrEqual(NOW.getTime())
    }
  })

  it('puts each amount on its own day', () => {
    const buckets = groupTrailing7Days([
      exp({ id: 'a', amount: 10, date: day(2026, 6, 15) }),
      exp({ id: 'b', amount: 25, date: day(2026, 6, 13) }),
      exp({ id: 'c', amount: 5,  date: day(2026, 6, 13) }),
    ], NOW)
    expect(buckets[6].total).toBe(10)
    expect(buckets[4].total).toBe(30)
    expect(buckets[0].total).toBe(0)
  })

  it('ignores anything outside the window', () => {
    const buckets = groupTrailing7Days([exp({ amount: 999, date: day(2026, 5, 1) })], NOW)
    expect(buckets.reduce((s, b) => s + b.total, 0)).toBe(0)
  })
})

describe('groupMonthDays', () => {
  it('produces one bucket per day of that month', () => {
    expect(groupMonthDays([], 2026, 5, NOW)).toHaveLength(30)  // June
    expect(groupMonthDays([], 2026, 1, NOW)).toHaveLength(28)  // Feb 2026
    expect(groupMonthDays([], 2024, 1, NOW)).toHaveLength(29)  // Feb 2024, a leap year
  })

  it('marks today only when today is in that month', () => {
    expect(groupMonthDays([], 2026, 5, NOW).filter(b => b.isToday)).toHaveLength(1)
    expect(groupMonthDays([], 2026, 4, NOW).filter(b => b.isToday)).toHaveLength(0)
  })

  it('buckets by day of month', () => {
    const buckets = groupMonthDays([
      exp({ id: 'a', amount: 40, date: day(2026, 6, 1) }),
      exp({ id: 'b', amount: 60, date: day(2026, 6, 30) }),
    ], 2026, 5, NOW)
    expect(buckets[0].total).toBe(40)
    expect(buckets[29].total).toBe(60)
  })
})

describe('chartSummary', () => {
  it('averages across every bucket, including the empty ones', () => {
    const data = groupTrailing7Days([exp({ amount: 700, date: day(2026, 6, 15) })], NOW)
    expect(chartSummary(data).perDay).toBeCloseTo(100, 6)
  })

  it('names the biggest day', () => {
    const data = groupTrailing7Days([
      exp({ id: 'a', amount: 10, date: day(2026, 6, 14) }),
      exp({ id: 'b', amount: 90, date: day(2026, 6, 12) }),
    ], NOW)
    expect(chartSummary(data).peak?.total).toBe(90)
    expect(chartSummary(data).peak?.date.getDate()).toBe(12)
  })

  it('has no peak when nothing was spent', () => {
    // Otherwise the header would announce a $0.00 "biggest day".
    expect(chartSummary(groupTrailing7Days([], NOW)).peak).toBeNull()
  })

  it('handles an empty bucket list', () => {
    expect(chartSummary([])).toEqual({ perDay: 0, peak: null })
  })
})

describe('availableMonths', () => {
  it('offers only the current month when there is no data', () => {
    expect(availableMonths([], NOW)).toEqual([{ year: 2026, month: 5, count: 0, total: 0 }])
  })

  it('runs from the oldest record to today, newest first', () => {
    const months = availableMonths([exp({ date: day(2026, 3, 9) })], NOW)
    expect(months).toHaveLength(4) // Mar, Apr, May, Jun
    expect(months[0]).toMatchObject({ year: 2026, month: 5 })
    expect(months[3]).toMatchObject({ year: 2026, month: 2 })
  })

  it('carries the count and total per month, so gaps can be marked', () => {
    const months = availableMonths([
      exp({ id: 'a', amount: 100, date: day(2026, 4, 2) }),
      exp({ id: 'b', amount: 50,  date: day(2026, 4, 20) }),
      exp({ id: 'c', amount: 25,  date: day(2026, 6, 1) }),
    ], NOW)
    const april = months.find(m => m.month === 3)!
    const may   = months.find(m => m.month === 4)!
    expect(april).toMatchObject({ count: 2, total: 150 })
    expect(may).toMatchObject({ count: 0, total: 0 })  // the gap
  })

  it('crosses a year boundary without gaps', () => {
    const months = availableMonths([exp({ date: day(2025, 11, 20) })], NOW)
    expect(months).toHaveLength(8) // Nov 2025 → Jun 2026
    expect(months[7]).toMatchObject({ year: 2025, month: 10 })
    expect(months[0]).toMatchObject({ year: 2026, month: 5 })
  })

  it('keeps a future-dated record reachable', () => {
    const months = availableMonths([exp({ date: day(2026, 9, 1) })], NOW)
    expect(months[0]).toMatchObject({ year: 2026, month: 8 })
  })

  it('always includes the current month even with older data only', () => {
    const months = availableMonths([exp({ date: day(2025, 1, 5) })], NOW)
    expect(months[0]).toMatchObject({ year: 2026, month: 5, count: 0 })
  })
})

describe('sortExpenses', () => {
  const a = exp({ id: 'a', title: 'Zinc',  amount: 50,  category: 'Supplies', date: day(2026, 6, 3) })
  const b = exp({ id: 'b', title: 'Apple', amount: 900, category: 'Food',     date: day(2026, 6, 1) })
  const c = exp({ id: 'c', title: 'Mango', amount: 120, category: 'Travel',   date: day(2026, 6, 10) })
  const items = [a, b, c]
  const ids = (k: ExpenseSortKey) => sortExpenses(items, k).map(e => e.id)

  it('defaults to newest first, the order the service already used', () => {
    expect(DEFAULT_EXPENSE_SORT).toBe('dateDesc')
    expect(ids('dateDesc')).toEqual(['c', 'a', 'b'])
  })

  it('sorts by date both ways', () => {
    expect(ids('dateAsc')).toEqual(['b', 'a', 'c'])
  })

  it('answers "what were my biggest expenses"', () => {
    expect(ids('amountDesc')).toEqual(['b', 'c', 'a'])
    expect(ids('amountAsc')).toEqual(['a', 'c', 'b'])
  })

  it('sorts by title and category', () => {
    expect(ids('title')).toEqual(['b', 'c', 'a'])
    expect(ids('category')).toEqual(['b', 'a', 'c'])
  })

  it('sorts an untitled row under its em dash rather than crashing', () => {
    const blank = exp({ id: 'blank', title: '' })
    expect(sortExpenses([blank, b], 'title').map(e => e.id)).toEqual(['blank', 'b'])
  })

  it('breaks ties on date, newest first', () => {
    const x = exp({ id: 'x', amount: 100, date: day(2026, 6, 1) })
    const y = exp({ id: 'y', amount: 100, date: day(2026, 6, 9) })
    expect(sortExpenses([x, y], 'amountDesc').map(e => e.id)).toEqual(['y', 'x'])
    expect(sortExpenses([y, x], 'amountDesc').map(e => e.id)).toEqual(['y', 'x'])
  })

  it('does not reorder the array it was given', () => {
    const input = [a, b, c]
    sortExpenses(input, 'amountDesc')
    expect(input.map(e => e.id)).toEqual(['a', 'b', 'c'])
  })

  it('offers every key it can sort by, and no key it cannot', () => {
    const offered = EXPENSE_SORTS.map(s => s.key).sort()
    expect(offered).toEqual(['amountAsc', 'amountDesc', 'category', 'dateAsc', 'dateDesc', 'title'])
    expect(offered).toContain(DEFAULT_EXPENSE_SORT)
  })
})

describe('filterExpenses', () => {
  const F = (over: Partial<ExpenseFilters> = {}): ExpenseFilters => ({
    period: 'all', year: 2026, month: 5, search: '',
    category: null, reimbursableOnly: false, ...over,
  })

  const items = [
    exp({ id: 'a', title: 'Hotel',  category: 'Travel', amount: 400, date: day(2026, 6, 2), isReimbursable: true }),
    exp({ id: 'b', title: 'Coffee', category: 'Food',   amount: 6,   date: day(2026, 6, 3), notes: 'client meeting' }),
    exp({ id: 'c', title: 'Flight', category: 'Travel', amount: 900, date: day(2026, 4, 9), isReimbursable: true }),
  ]
  const ids = (f: ExpenseFilters) => filterExpenses(items, f).map(e => e.id)

  it('passes everything through in all-time with no filters', () => {
    expect(ids(F())).toEqual(['a', 'b', 'c'])
  })

  it('narrows to a month', () => {
    expect(ids(F({ period: 'month' }))).toEqual(['a', 'b'])
  })

  it('narrows to a category — what the donut could never do', () => {
    expect(ids(F({ category: 'Travel' }))).toEqual(['a', 'c'])
  })

  it('narrows to reimbursable — what the green strip could never do', () => {
    expect(ids(F({ reimbursableOnly: true }))).toEqual(['a', 'c'])
  })

  it('searches title, category and notes', () => {
    expect(ids(F({ search: 'hotel' }))).toEqual(['a'])
    expect(ids(F({ search: 'travel' }))).toEqual(['a', 'c'])
    expect(ids(F({ search: 'client' }))).toEqual(['b'])
  })

  it('is case- and whitespace-insensitive', () => {
    expect(ids(F({ search: '  HOTEL ' }))).toEqual(['a'])
  })

  it('applies every filter together, not the last one set', () => {
    expect(ids(F({ period: 'month', category: 'Travel', reimbursableOnly: true }))).toEqual(['a'])
    expect(ids(F({ period: 'month', category: 'Food', reimbursableOnly: true }))).toEqual([])
  })

  it('treats a category filter as exact, not a substring', () => {
    // Otherwise clicking "Food" would also pull in "Food Delivery".
    const withNear = [...items, exp({ id: 'd', category: 'Food Delivery' })]
    expect(filterExpenses(withNear, F({ category: 'Food' })).map(e => e.id)).toEqual(['b'])
  })
})

describe('describeFilters', () => {
  const F = (over: Partial<ExpenseFilters> = {}): ExpenseFilters => ({
    period: 'all', year: 2026, month: 5, search: '',
    category: null, reimbursableOnly: false, ...over,
  })

  it('names the period', () => {
    expect(describeFilters(F())).toBe('All time')
    expect(describeFilters(F({ period: 'month' }))).toBe('June 2026')
  })

  it('names every active filter, so a printed sheet says what it excludes', () => {
    // The print header said only "All Time", so six of two hundred rows
    // looked like the whole set.
    const s = describeFilters(F({ period: 'month', category: 'Travel', reimbursableOnly: true, search: 'hotel' }))
    expect(s).toBe('June 2026 · Travel · reimbursable only · matching “hotel”')
  })

  it('ignores a blank search', () => {
    expect(describeFilters(F({ search: '   ' }))).toBe('All time')
  })
})
