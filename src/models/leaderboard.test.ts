import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import {
  barPercent, buildLeaderboard, describeBasis, formatMetricValue, metricValue,
  AVG_DEAL_MIN_SALES, METRIC_BAR, METRIC_LABELS, METRIC_TEXT, UNASSIGNED,
  periodRange, customersInRange,
  type Metric,
} from './leaderboard'
import { emptyCustomer, formatCurrency, type CustomerItem } from './customer'

const at = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12)

function cust(over: Partial<CustomerItem> = {}): CustomerItem {
  return {
    ...emptyCustomer(),
    id: 'c1', category: 'Customer', amount: 1000,
    salesman: 'Ann', creationDate: at(2026, 9, 10),
    ...over,
  }
}

const names = (rows: { name: string }[]) => rows.map(r => r.name)

describe('buildLeaderboard aggregation', () => {
  const items = [
    cust({ id: '1', salesman: 'Ann', category: 'Customer', amount: 3000 }),
    cust({ id: '2', salesman: 'Ann', category: 'Customer', amount: 1000 }),
    cust({ id: '3', salesman: 'Ann', category: 'Lead' }),
    cust({ id: '4', salesman: 'Bob', category: 'Customer', amount: 5000 }),
    cust({ id: '5', salesman: 'Bob', category: 'Vendor', amount: 9999 }),
  ]

  it('sums revenue and counts from customer records only', () => {
    const ann = buildLeaderboard(items, 'revenue').ranked.find(r => r.name === 'Ann')!
    expect(ann.revenue).toBe(4000)
    expect(ann.customers).toBe(2)
    expect(ann.leads).toBe(1)
  })

  it('ignores categories that are not sales records', () => {
    const bob = buildLeaderboard(items, 'revenue').ranked.find(r => r.name === 'Bob')!
    expect(bob.revenue).toBe(5000)   // not 14999
    expect(bob.customers).toBe(1)
  })

  it('computes average deal, avoiding division by zero', () => {
    const ann = buildLeaderboard(items, 'revenue').ranked.find(r => r.name === 'Ann')!
    expect(ann.avgDeal).toBe(2000)
    const leadsOnly = buildLeaderboard([cust({ salesman: 'Zed', category: 'Lead' })], 'revenue')
    expect(leadsOnly.ranked[0].avgDeal).toBe(0)
  })

  it('drops reps with nothing at all', () => {
    const empty = buildLeaderboard([cust({ salesman: 'Ghost', category: 'Vendor', amount: 0 })], 'revenue')
    expect(empty.ranked).toEqual([])
  })

  it('totals across everyone, ranked or not', () => {
    const withUnassigned = [...items, cust({ id: '6', salesman: '  ', category: 'Customer', amount: 2000 })]
    const lb = buildLeaderboard(withUnassigned, 'revenue')
    expect(lb.totals.revenue).toBe(11_000)
    expect(lb.totals.customers).toBe(4)
    expect(lb.totals.leads).toBe(1)
  })

  it('is empty and safe with no records', () => {
    const lb = buildLeaderboard([], 'revenue')
    expect(lb).toEqual({ ranked: [], excluded: [], totals: { revenue: 0, customers: 0, leads: 0 }, topValue: 0 })
  })
})

/**
 * `c.salesman.trim() || 'Unassigned'` meant unassigned records aggregated into
 * a pseudo-rep that entered the ranking, took a podium slot and got a medal —
 * so on a book with real unassigned data the top performer was a data-quality
 * gap.
 */
describe('Unassigned does not compete', () => {
  const items = [
    cust({ id: '1', salesman: '', category: 'Customer', amount: 99_000 }),
    cust({ id: '2', salesman: 'Ann', category: 'Customer', amount: 1000 }),
  ]

  it('keeps unassigned records out of the ranking even when they would win', () => {
    const lb = buildLeaderboard(items, 'revenue')
    expect(names(lb.ranked)).toEqual(['Ann'])
    expect(names(lb.excluded)).toEqual([UNASSIGNED])
  })

  it('says why it is excluded', () => {
    const lb = buildLeaderboard(items, 'revenue')
    expect(lb.excluded[0].excludedReason).toMatch(/not assigned/i)
    expect(lb.excluded[0].ranked).toBe(false)
  })

  it('treats a whitespace-only salesman as unassigned', () => {
    const lb = buildLeaderboard([cust({ salesman: '   ' })], 'revenue')
    expect(names(lb.excluded)).toEqual([UNASSIGNED])
  })

  it('does not let it set the bar scale', () => {
    // topValue drove every bar's width, so an unassigned leader squashed
    // everyone else's bar to a sliver.
    expect(buildLeaderboard(items, 'revenue').topValue).toBe(1000)
  })

  it('still counts toward the company totals', () => {
    expect(buildLeaderboard(items, 'revenue').totals.revenue).toBe(100_000)
  })
})

/**
 * avgDeal = revenue/customers with no volume floor ranked one $50,000 sale
 * above twenty sales worth $800,000.
 */
describe('average deal needs volume to rank', () => {
  const oneBigSale  = cust({ id: 'b', salesman: 'Lucky', category: 'Customer', amount: 50_000 })
  const manySales = Array.from({ length: 20 }, (_, i) =>
    cust({ id: `w${i}`, salesman: 'Worker', category: 'Customer', amount: 40_000 }))

  it('excludes the single big sale from the average-deal ranking', () => {
    const lb = buildLeaderboard([oneBigSale, ...manySales], 'avgDeal')
    expect(names(lb.ranked)).toEqual(['Worker'])
    expect(names(lb.excluded)).toEqual(['Lucky'])
  })

  it('says what the threshold is', () => {
    const lb = buildLeaderboard([oneBigSale, ...manySales], 'avgDeal')
    expect(lb.excluded[0].excludedReason).toContain(String(AVG_DEAL_MIN_SALES))
  })

  it('applies the threshold only to average deal', () => {
    for (const m of ['revenue', 'customers', 'leads'] as Metric[]) {
      const lb = buildLeaderboard([oneBigSale, ...manySales], m)
      expect(names(lb.ranked), m).toContain('Lucky')
    }
  })

  it('ranks a rep who meets the threshold exactly', () => {
    const three = Array.from({ length: AVG_DEAL_MIN_SALES }, (_, i) =>
      cust({ id: `t${i}`, salesman: 'Three', category: 'Customer', amount: 10_000 }))
    const lb = buildLeaderboard(three, 'avgDeal')
    expect(names(lb.ranked)).toEqual(['Three'])
  })

  it('still lists an excluded rep rather than hiding them', () => {
    const lb = buildLeaderboard([oneBigSale, ...manySales], 'avgDeal')
    expect(lb.excluded[0].avgDeal).toBe(50_000)
  })
})

describe('sorting', () => {
  const items = [
    cust({ id: '1', salesman: 'Ann', category: 'Customer', amount: 1000 }),
    cust({ id: '2', salesman: 'Bob', category: 'Customer', amount: 5000 }),
    cust({ id: '3', salesman: 'Cal', category: 'Lead' }),
    cust({ id: '4', salesman: 'Cal', category: 'Lead' }),
  ]

  it('ranks by the selected metric', () => {
    expect(names(buildLeaderboard(items, 'revenue').ranked)).toEqual(['Bob', 'Ann', 'Cal'])
    expect(names(buildLeaderboard(items, 'leads').ranked)[0]).toBe('Cal')
  })

  /** Ties kept Map insertion order, so a reload could swap silver and bronze. */
  it('breaks ties by name, deterministically', () => {
    const tied = [
      cust({ id: 'z', salesman: 'Zoe', category: 'Customer', amount: 1000 }),
      cust({ id: 'a', salesman: 'Amy', category: 'Customer', amount: 1000 }),
    ]
    expect(names(buildLeaderboard(tied, 'revenue').ranked)).toEqual(['Amy', 'Zoe'])
    // And the reverse input order gives the same answer.
    expect(names(buildLeaderboard([...tied].reverse(), 'revenue').ranked)).toEqual(['Amy', 'Zoe'])
  })

  it('reports the leader as topValue', () => {
    expect(buildLeaderboard(items, 'revenue').topValue).toBe(5000)
  })
})

describe('barPercent', () => {
  it('scales against the leader', () => {
    expect(barPercent(50, 100)).toBe(50)
    expect(barPercent(100, 100)).toBe(100)
  })

  it('is zero rather than NaN when there is no leader', () => {
    // topValue is 0 whenever the selected metric is 0 for everyone.
    expect(barPercent(0, 0)).toBe(0)
    expect(barPercent(5, 0)).toBe(0)
  })

  it('never exceeds 100 or goes negative', () => {
    expect(barPercent(200, 100)).toBe(100)
    expect(barPercent(-5, 100)).toBe(0)
  })
})

describe('formatting and metadata', () => {
  it('formats money metrics as currency and counts as numbers', () => {
    expect(formatMetricValue(1234, 'revenue', formatCurrency)).toBe('$1,234')
    expect(formatMetricValue(1234, 'avgDeal', formatCurrency)).toBe('$1,234')
    expect(formatMetricValue(1234, 'customers', formatCurrency)).toBe('1,234')
    expect(formatMetricValue(1234, 'leads', formatCurrency)).toBe('1,234')
  })

  it('reads each metric off the row', () => {
    const row = buildLeaderboard([cust({ amount: 4000 })], 'revenue').ranked[0]
    expect(metricValue(row, 'revenue')).toBe(4000)
    expect(metricValue(row, 'customers')).toBe(1)
    expect(metricValue(row, 'avgDeal')).toBe(4000)
  })

  it('has a label, a bar colour and a text colour for every metric', () => {
    for (const m of ['revenue', 'customers', 'leads', 'avgDeal'] as Metric[]) {
      expect(METRIC_LABELS[m]).toBeTruthy()
      expect(METRIC_BAR[m]).toBeTruthy()
      expect(METRIC_TEXT[m]).toBeTruthy()
    }
  })

  /**
   * A selected pill is `${METRIC_BAR[m]} text-white`, and text-white resolves
   * to --color-white, which is dark navy in light mode. index.css keeps a list
   * of solid backgrounds that force true white; a metric colour outside it
   * goes dark-on-saturated.
   */
  it('uses only backgrounds index.css forces true white on', () => {
    const css = readFileSync('src/index.css', 'utf8')
    const whiteList = css.slice(
      css.indexOf('/* text-white maps to --color-white'),
      css.indexOf('color: #fff', css.indexOf('/* text-white maps to --color-white')),
    )
    for (const cls of Object.values(METRIC_BAR)) {
      expect(whiteList, `${cls} is not in the text-white override list`).toContain(`.${cls}`)
    }
  })

  it('uses only text colours with a global light-mode rule', () => {
    const css = readFileSync('src/index.css', 'utf8')
    for (const cls of Object.values(METRIC_TEXT)) {
      expect(css, cls).toMatch(new RegExp(`html\\.light-mode \\.${cls}\\s*\\{`))
    }
  })

  it('states the attribution basis, and the threshold where it applies', () => {
    expect(describeBasis('revenue')).toMatch(/current assignee/i)
    expect(describeBasis('revenue')).not.toContain(String(AVG_DEAL_MIN_SALES))
    expect(describeBasis('avgDeal')).toContain(String(AVG_DEAL_MIN_SALES))
  })
})

/**
 * The page had its own getPeriodRange with `start.setFullYear(2000)` applied to
 * a copy of *now* — the same bug /reports had, where All Time began on this
 * day-of-year in 2000. These are re-exported from salesReport so there is one
 * implementation.
 */
describe('period handling is shared, not re-derived', () => {
  const now = at(2026, 9, 17)

  it('makes All Time genuinely unbounded', () => {
    expect(periodRange('all', now).start.getTime()).toBe(0)
  })

  it('excludes epoch-sentinel dates from a dated period', () => {
    const sentinel = cust({ id: 'zero', creationDate: new Date(0) })
    const real     = cust({ id: 'now', creationDate: at(2026, 9, 2) })
    const r = periodRange('month', now)
    expect(customersInRange([sentinel, real], r, 'month').map(c => c.id)).toEqual(['now'])
  })

  it('includes sentinel-dated records under All Time', () => {
    const sentinel = cust({ id: 'zero', creationDate: new Date(0) })
    const r = periodRange('all', now)
    expect(customersInRange([sentinel], r, 'all')).toHaveLength(1)
  })

  it('does not define its own period range', () => {
    const src = readFileSync('src/pages/leaderboard/LeaderboardPage.tsx', 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
    expect(src).not.toContain('setFullYear(2000)')
    expect(src).not.toMatch(/function getPeriodRange/)
  })
})
