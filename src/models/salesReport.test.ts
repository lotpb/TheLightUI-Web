import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import {
  conversionRate, customersInRange, fmtMoneyCompact, fmtMoneyExact, hasTrendData,
  invoicesInRange, isRealDate, isSalesRecord, periodRange, reportKpis,
  salesmanRows, sourceBreakdown, trendSeries,
  PERIODS, PERIOD_LABELS, SALESMAN_SORTS, SOURCE_FIELDS,
  type SalesmanSort,
} from './salesReport'
import { emptyCustomer, type CustomerItem } from './customer'
import type { Invoice, InvoiceStatus } from './invoice'

/** Local calendar day, which is what the period ranges are built from. */
const day = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h)

function cust(over: Partial<CustomerItem> = {}): CustomerItem {
  return {
    ...emptyCustomer(),
    id: 'c1', category: 'Customer', amount: 1000,
    creationDate: day(2026, 9, 10), salesman: 'Ann',
    ...over,
  }
}

function inv(over: Partial<Invoice> = {}): Invoice {
  return {
    id: 'i1', companyId: 'co1', customerId: 'c1', customerName: 'Jane',
    customerPhone: '', customerEmail: '', customerAddress: '',
    invoiceNumber: 'INV-1',
    issueDate: day(2026, 9, 10), dueDate: day(2026, 12, 1),
    status: 'sent' as InvoiceStatus,
    lineItems: [{ description: 'Roof', qty: 1, rate: 5000 }],
    notes: '', taxRate: 0, currency: 'USD',
    createdAt: day(2026, 9, 10), updatedAt: day(2026, 9, 10),
    ...over,
  }
}

describe('isRealDate', () => {
  it('rejects the sentinel zero dates the CRM writes for missing values', () => {
    expect(isRealDate(new Date(0))).toBe(false)
    expect(isRealDate(new Date(86_400_000))).toBe(false)
    expect(isRealDate(new Date(86_400_001))).toBe(true)
  })

  it('rejects null and invalid dates', () => {
    expect(isRealDate(null)).toBe(false)
    expect(isRealDate(new Date('nonsense'))).toBe(false)
  })
})

describe('periodRange', () => {
  const now = day(2026, 9, 17, 14)

  it('covers every period the UI offers', () => {
    for (const p of PERIODS) {
      const r = periodRange(p, now)
      expect(r.start.getTime()).toBeLessThanOrEqual(r.end.getTime())
      expect(PERIOD_LABELS[p]).toBeTruthy()
    }
  })

  it('starts this month on the 1st at midnight', () => {
    const { start } = periodRange('month', now)
    expect([start.getMonth(), start.getDate(), start.getHours()]).toEqual([8, 1, 0])
  })

  it('bounds last month to its own first and last day', () => {
    const { start, end } = periodRange('lastMonth', now)
    expect([start.getMonth(), start.getDate()]).toEqual([7, 1])   // Aug 1
    expect([end.getMonth(), end.getDate()]).toEqual([7, 31])      // Aug 31
  })

  it('starts the quarter on the first month of the quarter', () => {
    expect(periodRange('quarter', now).start.getMonth()).toBe(6)  // Jul
    expect(periodRange('quarter', day(2026, 2, 5)).start.getMonth()).toBe(0)
  })

  it('spans twelve months for last12, inclusive of this one', () => {
    const { start } = periodRange('last12', now)
    expect([start.getFullYear(), start.getMonth(), start.getDate()]).toEqual([2025, 9, 1])
  })

  it('makes All Time genuinely unbounded', () => {
    // Was start.setFullYear(2000) on a copy of *now*, so All Time began on
    // this day-of-year in 2000 and dropped everything before it.
    expect(periodRange('all', now).start.getTime()).toBe(0)
  })
})

describe('customersInRange', () => {
  const now = day(2026, 9, 17)
  const thisMonth = cust({ id: 'now',   creationDate: day(2026, 9, 2) })
  const lastMonth = cust({ id: 'prev',  creationDate: day(2026, 8, 2) })
  const sentinel  = cust({ id: 'zero',  creationDate: new Date(0) })

  it('keeps only records created inside the window', () => {
    const r = periodRange('month', now)
    expect(customersInRange([thisMonth, lastMonth], r, 'month').map(c => c.id)).toEqual(['now'])
  })

  it('excludes sentinel-dated records from a dated period', () => {
    const r = periodRange('month', now)
    expect(customersInRange([sentinel], r, 'month')).toHaveLength(0)
  })

  it('includes sentinel-dated records under All Time', () => {
    // The KPI row dropped these while the tables below counted them, so the
    // two halves of the page described different populations.
    const r = periodRange('all', now)
    expect(customersInRange([thisMonth, sentinel], r, 'all').map(c => c.id))
      .toEqual(['now', 'zero'])
  })
})

describe('isSalesRecord', () => {
  it('counts leads and customers, whatever the casing', () => {
    expect(isSalesRecord(cust({ category: 'lead' }))).toBe(true)
    expect(isSalesRecord(cust({ category: 'Customer' }))).toBe(true)
  })

  it('excludes vendors and employees', () => {
    expect(isSalesRecord(cust({ category: 'Vendor' }))).toBe(false)
    expect(isSalesRecord(cust({ category: 'Employee' }))).toBe(false)
  })
})

/**
 * The bug this file exists for. leads and customers are disjoint categories:
 * converting a lead moves it out of the leads count, so customers/leads had a
 * denominator that shrinks with every success.
 */
describe('conversionRate', () => {
  it('divides by the whole cohort, not the unconverted remainder', () => {
    expect(conversionRate(5, 5)).toBe(50)
    expect(conversionRate(9, 1)).toBe(10)
  })

  it('scores a perfect record as 100%, not as a dash', () => {
    // customers/leads gave 10/0 here, which the page rendered as "—" — the
    // best performer showed no number at all.
    expect(conversionRate(0, 10)).toBe(100)
  })

  it('scores no conversions as 0%', () => {
    expect(conversionRate(10, 0)).toBe(0)
  })

  it('never exceeds 100%', () => {
    for (const [l, c] of [[0, 1], [1, 99], [50, 50], [0, 1000]]) {
      expect(conversionRate(l, c)!).toBeLessThanOrEqual(100)
    }
  })

  it('is null only when there are no records at all', () => {
    expect(conversionRate(0, 0)).toBeNull()
  })
})

describe('reportKpis', () => {
  const customers = [
    cust({ id: 'l1', category: 'Lead', amount: 500 }),
    cust({ id: 'l2', category: 'Lead', amount: 700 }),
    cust({ id: 'c1', category: 'Customer', amount: 2000 }),
    cust({ id: 'c2', category: 'Customer', amount: 4000 }),
    cust({ id: 'v1', category: 'Vendor', amount: 9999 }),
  ]

  it('counts new leads and customers, ignoring other categories', () => {
    const k = reportKpis(customers, [])
    expect(k.newLeads).toBe(2)
    expect(k.newCustomers).toBe(2)
  })

  it('books value from customer records only', () => {
    // Leads carry an amount too; it is a quote, not a booking.
    const k = reportKpis(customers, [])
    expect(k.booked).toBe(6000)
    expect(k.avgBooked).toBe(3000)
  })

  it('avoids dividing by zero with no customers', () => {
    expect(reportKpis([cust({ category: 'Lead' })], []).avgBooked).toBe(0)
  })

  it('invoices exclude drafts and collected counts only paid', () => {
    const invoices = [
      inv({ id: 'a', status: 'draft', lineItems: [{ description: 'x', qty: 1, rate: 1000 }] }),
      inv({ id: 'b', status: 'sent',  lineItems: [{ description: 'x', qty: 1, rate: 2000 }] }),
      inv({ id: 'c', status: 'paid',  lineItems: [{ description: 'x', qty: 1, rate: 3000 }] }),
    ]
    const k = reportKpis([], invoices, day(2026, 9, 17))
    expect(k.invoiced).toBe(5000)
    expect(k.invoicedCount).toBe(2)
    expect(k.collected).toBe(3000)
  })

  it('applies tax to invoiced money the way the invoice page does', () => {
    const k = reportKpis([], [inv({ status: 'paid', taxRate: 10 })], day(2026, 9, 17))
    expect(k.invoiced).toBe(5500)
    expect(k.collected).toBe(5500)
  })

  it('treats a past-due sent invoice as invoiced but not collected', () => {
    const overdue = inv({ status: 'sent', dueDate: day(2026, 1, 1) })
    const k = reportKpis([], [overdue], day(2026, 9, 17))
    expect(k.invoiced).toBe(5000)
    expect(k.collected).toBe(0)
  })
})

describe('invoicesInRange', () => {
  const now = day(2026, 9, 17)

  it('keys on issue date', () => {
    const items = [inv({ id: 'in', issueDate: day(2026, 9, 3) }), inv({ id: 'out', issueDate: day(2026, 7, 3) })]
    expect(invoicesInRange(items, periodRange('month', now), 'month').map(i => i.id)).toEqual(['in'])
  })

  it('keeps everything under All Time', () => {
    const items = [inv({ id: 'old', issueDate: day(2001, 1, 1) })]
    expect(invoicesInRange(items, periodRange('all', now), 'all')).toHaveLength(1)
  })
})

describe('salesmanRows', () => {
  const customers = [
    cust({ id: 'a1', salesman: 'Ann', category: 'Lead' }),
    cust({ id: 'a2', salesman: 'Ann', category: 'Customer', amount: 3000 }),
    cust({ id: 'b1', salesman: 'Bob', category: 'Customer', amount: 1000 }),
    cust({ id: 'u1', salesman: '   ', category: 'Lead' }),
    cust({ id: 'x1', salesman: 'Ann', category: 'Vendor', amount: 500 }),
  ]

  it('groups by rep and buckets blank names as Unassigned', () => {
    const rows = salesmanRows(customers, [], 'booked')
    expect(rows.map(r => r.name).sort()).toEqual(['Ann', 'Bob', 'Unassigned'])
  })

  it('books value from customers only and ignores non-sales records', () => {
    const ann = salesmanRows(customers, [], 'booked').find(r => r.name === 'Ann')!
    expect(ann.leads).toBe(1)
    expect(ann.customers).toBe(1)
    expect(ann.booked).toBe(3000)   // not 3500 — the Vendor record is excluded
    expect(ann.avgBooked).toBe(3000)
    expect(ann.conversion).toBe(50)
  })

  it('attributes invoiced money through the invoice customer to their rep', () => {
    const invoices = [inv({ customerId: 'a2', status: 'paid' }), inv({ customerId: 'b1', status: 'sent' })]
    const rows = salesmanRows(customers, invoices, 'invoiced')
    expect(rows.find(r => r.name === 'Ann')!.invoiced).toBe(5000)
    expect(rows.find(r => r.name === 'Bob')!.invoiced).toBe(5000)
  })

  it('drops invoiced money for a customer outside the window rather than misfiling it', () => {
    const rows = salesmanRows(customers, [inv({ customerId: 'ghost' })], 'invoiced')
    expect(rows.reduce((s, r) => s + r.invoiced, 0)).toBe(0)
    expect(rows.find(r => r.name === 'Unassigned')!.invoiced).toBe(0)
  })

  it('never counts a draft invoice as invoiced', () => {
    const rows = salesmanRows(customers, [inv({ customerId: 'a2', status: 'draft' })], 'invoiced')
    expect(rows.find(r => r.name === 'Ann')!.invoiced).toBe(0)
  })

  it('sorts by each offered key', () => {
    const order = (k: SalesmanSort) => salesmanRows(customers, [], k).map(r => r.name)
    expect(order('booked')[0]).toBe('Ann')
    expect(order('customers')[0]).toBe('Ann')
    expect(order('conversion')[0]).toBe('Bob')   // Bob is 100%, Ann 50%
  })

  it('sorts reps with no conversion figure last', () => {
    const none = [cust({ id: 'z', salesman: 'Zed', category: 'Vendor' })]
    const rows = salesmanRows([...customers, ...none], [], 'conversion')
    expect(rows.map(r => r.name)).not.toContain('Zed')  // no sales records at all
  })

  it('offers a label for every sort key', () => {
    for (const s of SALESMAN_SORTS) expect(s.label).toBeTruthy()
    expect(SALESMAN_SORTS.map(s => s.key)).toContain('conversion')
  })
})

describe('sourceBreakdown', () => {
  const customers = [
    cust({ id: '1', leadSource: 'Google', adNo: '100', category: 'Customer', amount: 1000 }),
    cust({ id: '2', leadSource: 'Google', adNo: '200', category: 'Lead',     amount: 9000 }),
    cust({ id: '3', leadSource: 'Referral', adNo: '100', category: 'Customer', amount: 500 }),
    cust({ id: '4', leadSource: '',       adNo: '',    category: 'Lead' }),
    cust({ id: '5', leadSource: 'Google', adNo: '100', category: 'Vendor',   amount: 7777 }),
  ]

  it('groups by lead source by default, matching /chart and /funnel', () => {
    const b = sourceBreakdown(customers, 'leadSource')
    expect(b.rows.map(r => r.source)).toEqual(['Google', 'No source recorded', 'Referral'])
  })

  it('can group by ad number instead', () => {
    const b = sourceBreakdown(customers, 'adNo')
    expect(b.rows.find(r => r.source === '100')!.count).toBe(2)
  })

  it('counts booked value from customers only', () => {
    // The page added `amount` for leads too, while the salesman table counted
    // customers only — one column heading, two meanings, one screen.
    const g = sourceBreakdown(customers, 'leadSource').rows.find(r => r.source === 'Google')!
    expect(g.count).toBe(2)       // the Vendor record is not a sales record
    expect(g.customers).toBe(1)
    expect(g.booked).toBe(1000)   // not 10000
  })

  it('shares out of every in-scope record, not just the rows shown', () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      cust({ id: `s${i}`, leadSource: `Source ${i}`, category: 'Lead' }))
    const b = sourceBreakdown(many, 'leadSource', 10)
    expect(b.rows).toHaveLength(10)
    expect(b.total).toBe(30)
    expect(b.distinct).toBe(30)
    // Each of 30 equal sources is 1/30, so ten rows sum to a third — not 100%.
    const shown = b.rows.reduce((s, r) => s + r.share, 0)
    expect(shown).toBeCloseTo(100 / 3, 5)
  })

  it('has shares totalling 100 across all distinct sources', () => {
    const b = sourceBreakdown(customers, 'leadSource', 99)
    expect(b.rows.reduce((s, r) => s + r.share, 0)).toBeCloseTo(100, 5)
  })

  it('is empty and safe with no records', () => {
    expect(sourceBreakdown([], 'leadSource')).toEqual({ rows: [], total: 0, distinct: 0 })
  })

  it('offers a label for both fields', () => {
    expect(SOURCE_FIELDS.map(f => f.key)).toEqual(['leadSource', 'adNo'])
    for (const f of SOURCE_FIELDS) expect(f.label).toBeTruthy()
  })
})

describe('trendSeries', () => {
  const now = day(2026, 9, 17)

  it('returns twelve months, oldest first, ending on this one', () => {
    const t = trendSeries([], [], now)
    expect(t).toHaveLength(12)
    expect(t[0].month).toBe('Oct 25')
    expect(t[11].month).toBe('Sep 26')
  })

  it('buckets records and invoices into their own month', () => {
    const t = trendSeries(
      [cust({ category: 'Customer', amount: 2000, creationDate: day(2026, 8, 5) })],
      [inv({ status: 'sent', issueDate: day(2026, 9, 5) })],
      now,
    )
    const aug = t.find(p => p.month === 'Aug 26')!
    const sep = t.find(p => p.month === 'Sep 26')!
    expect(aug.booked).toBe(2000)
    expect(aug.customers).toBe(1)
    expect(sep.invoiced).toBe(5000)
  })

  it('ignores anything outside the window and any sentinel date', () => {
    const t = trendSeries(
      [cust({ creationDate: day(2020, 1, 1) }), cust({ creationDate: new Date(0) })],
      [],
      now,
    )
    expect(t.every(p => p.booked === 0 && p.customers === 0)).toBe(true)
  })

  it('leaves drafts out of the invoiced series', () => {
    const t = trendSeries([], [inv({ status: 'draft', issueDate: day(2026, 9, 5) })], now)
    expect(t.find(p => p.month === 'Sep 26')!.invoiced).toBe(0)
  })

  it('reports whether there is anything worth charting', () => {
    expect(hasTrendData(trendSeries([], [], now))).toBe(false)
    expect(hasTrendData(trendSeries([cust({ category: 'Lead', creationDate: day(2026, 9, 1) })], [], now))).toBe(true)
  })
})

/** There were four money formats on one page, including $1.2K beside $1k. */
describe('money formatting', () => {
  it('is exact below a thousand', () => {
    expect(fmtMoneyCompact(0)).toBe('$0')
    expect(fmtMoneyCompact(999)).toBe('$999')
    expect(fmtMoneyExact(1234)).toBe('$1,234')
  })

  it('uses one thousands suffix, with a decimal only where it adds precision', () => {
    expect(fmtMoneyCompact(1_500)).toBe('$1.5K')
    expect(fmtMoneyCompact(12_400)).toBe('$12K')
    expect(fmtMoneyCompact(1_250_000)).toBe('$1.3M')
  })

  it('keeps the sign on negatives rather than falling through to a different format', () => {
    expect(fmtMoneyCompact(-2_500)).toBe('-$2.5K')
    expect(fmtMoneyCompact(-1_500_000)).toBe('-$1.5M')
  })
})

/**
 * The chart hardcoded its own hexes. useChartTheme exists precisely for this
 * and its own doc comment measures the grid colour this page used at "1.42:1,
 * which is no gridline at all".
 */
describe('the chart uses the shared theme', () => {
  const raw = readFileSync('src/pages/reports/ReportsPage.tsx', 'utf8')
  // Comments stripped first: the page documents the hex it used to hardcode,
  // and an assertion over raw file text flags that explanation as the defect
  // it describes.
  const src = raw
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')

  it('imports useChartTheme', () => {
    expect(src).toMatch(/useChartTheme/)
  })

  it('has no hardcoded hex colours left', () => {
    const hexes = src.match(/#[0-9a-fA-F]{6}\b/g) ?? []
    expect(hexes).toEqual([])
  })
})
