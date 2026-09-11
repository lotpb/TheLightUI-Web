import { describe, it, expect } from 'vitest'
import {
    funnelCounts, buildFunnel, rate, groupFunnel, monthlyCounts,
} from './funnel'
import { emptyCustomer, type CustomerItem } from '../models/customer'

const DAY = 24 * 60 * 60 * 1000

function rec(over: Partial<CustomerItem> = {}): CustomerItem {
    return { ...emptyCustomer(), id: Math.random().toString(36), ...over }
}

function lead(over: Partial<CustomerItem> = {}) {
    return rec({ category: 'Lead', ...over })
}

/** A won deal, optionally started and completed. */
function won(over: Partial<CustomerItem> = {}) {
    return rec({ category: 'Customer', amount: 1_000, ...over })
}

const START = new Date(Date.now() - 30 * DAY)
const END   = new Date(Date.now() - 5 * DAY)

describe('funnelCounts — the stages are one cohort, not two populations', () => {
    // The page compared Lead-category records against Customer-category
    // records. They are disjoint, so 20 open leads and 50 won deals produced
    // "↓ 417% proceed" and a Conv. Rate of 250%.
    it('counts leads and customers as one cohort', () => {
        const c = funnelCounts([lead(), lead(), won(), won(), won()])
        expect(c.cohort).toBe(5)
        expect(c.won).toBe(3)
    })

    it('never lets a stage exceed the one above it', () => {
        const records = [
            ...Array.from({ length: 20 }, () => lead()),
            ...Array.from({ length: 50 }, () => won({ startDate: START, completionDate: END })),
        ]
        const stages = buildFunnel(funnelCounts(records))
        for (let i = 1; i < stages.length; i++) {
            expect(stages[i].count).toBeLessThanOrEqual(stages[i - 1].count)
            expect(stages[i].fromPrevious!).toBeLessThanOrEqual(100)
            expect(stages[i].ofCohort).toBeLessThanOrEqual(100)
        }
    })

    it('reports 100% when every record converted, not 0%', () => {
        // pct(customers, leads) with no leads left divided by zero and the old
        // helper returned 0 — a perfect period scored 0% in red.
        const c = funnelCounts(Array.from({ length: 30 }, () => won()))
        expect(rate(c.won, c.cohort)).toBe(100)
    })

    it('reports no rate at all for an empty period', () => {
        const c = funnelCounts([])
        expect(rate(c.won, c.cohort)).toBeNull()
    })

    it('ignores vendors and employees entirely', () => {
        const c = funnelCounts([lead(), rec({ category: 'Vendor' }), rec({ category: 'Employee' })])
        expect(c.cohort).toBe(1)
    })
})

describe('funnelCounts — stage definitions', () => {
    it('treats a won deal as contacted even with no Called flag', () => {
        const c = funnelCounts([won({ callback: '' })])
        expect(c.contacted).toBe(1)
        expect(c.won).toBe(1)
    })

    it('counts an uncontacted open lead in the cohort but not in contacted', () => {
        const c = funnelCounts([lead({ callback: '' })])
        expect(c).toMatchObject({ cohort: 1, contacted: 0, won: 0 })
    })

    it('counts a contacted open lead', () => {
        expect(funnelCounts([lead({ callback: 'Yes' })]).contacted).toBe(1)
    })

    it('requires a real start date, not the epoch sentinel', () => {
        const sentinel = new Date(0)
        expect(funnelCounts([won({ startDate: sentinel })]).started).toBe(0)
        expect(funnelCounts([won({ startDate: START })]).started).toBe(1)
    })

    it('requires completion to be after start', () => {
        expect(funnelCounts([won({ startDate: END, completionDate: START })]).completed).toBe(0)
        expect(funnelCounts([won({ startDate: START, completionDate: END })]).completed).toBe(1)
    })

    it('does not count a completed job that never started', () => {
        expect(funnelCounts([won({ completionDate: END })]).started).toBe(0)
        expect(funnelCounts([won({ completionDate: END })]).completed).toBe(0)
    })

    it('sums revenue from won records only', () => {
        const c = funnelCounts([lead({ amount: 9_999 }), won({ amount: 500 }), won({ amount: 250 })])
        expect(c.revenue).toBe(750)
    })

    it('survives a non-finite amount', () => {
        expect(funnelCounts([won({ amount: NaN })]).revenue).toBe(0)
    })
})

describe('buildFunnel', () => {
    const stages = buildFunnel(funnelCounts([
        lead({ callback: '' }),
        lead({ callback: 'yes' }),
        won({ callback: 'yes' }),
        won({ callback: 'yes', startDate: START }),
        won({ callback: 'yes', startDate: START, completionDate: END }),
    ]))

    it('is monotonic', () => {
        expect(stages.map(s => s.count)).toEqual([5, 4, 3, 2, 1])
    })

    it('reports share of cohort and share of the previous stage', () => {
        expect(stages.map(s => s.ofCohort)).toEqual([100, 80, 60, 40, 20])
        expect(stages.map(s => s.fromPrevious)).toEqual([null, 80, 75, 67, 50])
    })

    it('gives zero shares rather than NaN on an empty cohort', () => {
        const empty = buildFunnel(funnelCounts([]))
        expect(empty.every(s => s.ofCohort === 0)).toBe(true)
        expect(empty.map(s => s.count)).toEqual([0, 0, 0, 0, 0])
    })
})

describe('groupFunnel', () => {
    const records = [
        lead({ salesman: 'Ann' }),
        won({ salesman: 'Ann', amount: 100 }),
        lead({ salesman: 'Bob' }),
        lead({ salesman: 'Bob' }),
    ]

    it('runs the same cohort maths per group', () => {
        const rows = groupFunnel(records, c => c.salesman)
        const ann = rows.find(r => r.name === 'Ann')!
        const bob = rows.find(r => r.name === 'Bob')!
        expect(ann).toMatchObject({ cohort: 2, won: 1, winRate: 50, revenue: 100 })
        expect(bob).toMatchObject({ cohort: 2, won: 0, winRate: 0 })
    })

    it('keeps a win rate bounded even when a group is all customers', () => {
        const rows = groupFunnel([won({ salesman: 'Cy' }), won({ salesman: 'Cy' })], c => c.salesman)
        expect(rows[0].winRate).toBe(100)
    })

    it('excludes vendors and employees from every group', () => {
        const rows = groupFunnel([rec({ category: 'Vendor', salesman: 'Ann' })], c => c.salesman)
        expect(rows).toEqual([])
    })
})

describe('monthlyCounts', () => {
    const NOW = new Date(2026, 8, 15)   // 15 Sep 2026

    it('returns one bucket per month, oldest first, ending this month', () => {
        const b = monthlyCounts([], 3, NOW)
        expect(b.map(x => x.key)).toEqual(['2026-07', '2026-08', '2026-09'])
    })

    it('buckets by creation month', () => {
        const b = monthlyCounts([
            lead({ creationDate: new Date(2026, 7, 3) }),
            lead({ creationDate: new Date(2026, 7, 20) }),
            won({ creationDate: new Date(2026, 8, 1) }),
        ], 3, NOW)
        expect(b.map(x => [x.leads, x.customers])).toEqual([[0, 0], [2, 0], [0, 1]])
    })

    it('drops records outside the window rather than misfiling them', () => {
        const b = monthlyCounts([lead({ creationDate: new Date(2020, 0, 1) })], 3, NOW)
        expect(b.every(x => x.leads === 0)).toBe(true)
    })

    it('ignores vendors and employees', () => {
        const b = monthlyCounts([rec({ category: 'Vendor', creationDate: new Date(2026, 8, 1) })], 3, NOW)
        expect(b[2]).toMatchObject({ leads: 0, customers: 0 })
    })
})

describe('rate', () => {
    it('rounds', () => {
        expect(rate(1, 3)).toBe(33)
        expect(rate(2, 3)).toBe(67)
    })

    it('is null, not zero, when there is nothing to divide by', () => {
        expect(rate(0, 0)).toBeNull()
        expect(rate(5, 0)).toBeNull()
    })
})
