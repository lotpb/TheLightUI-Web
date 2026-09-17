import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import {
    calculateHealthScore, healthBandFor, healthBandRange, healthBreakdown,
    healthShortfalls, healthSummary, searchScored, sortScored,
    HEALTH_BANDS, HEALTH_MAX, HEALTH_SORTS,
    type HealthSort, type ScoredCustomer,
} from './customerHealth'
import { emptyCustomer, type CustomerItem } from '../models/customer'
import type { Invoice } from '../models/invoice'
import type { ServicePlan } from '../models/servicePlan'

const DAY = 24 * 60 * 60 * 1000

function customer(over: Partial<CustomerItem> = {}): CustomerItem {
    return { ...emptyCustomer(), id: 'c1', category: 'Customer', ...over }
}

function daysAgo(n: number): Date {
    return new Date(Date.now() - n * DAY)
}

/** lastContactDate is a `yyyy-mm-dd` string from a date input. */
function isoDaysAgo(n: number): string {
    const d = daysAgo(n)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function invoice(over: Partial<Invoice> = {}): Invoice {
    return {
        customerId: 'c1',
        status: 'paid',
        dueDate: daysAgo(-30),
        ...over,
    } as Invoice
}

function plan(over: Partial<ServicePlan> = {}): ServicePlan {
    return { customerId: 'c1', isActive: true, ...over } as ServicePlan
}

describe('calculateHealthScore', () => {
    it('awards the full 35 recency points inside a week', () => {
        const h = calculateHealthScore(customer({ lastUpdateDate: daysAgo(3) }), [], [])
        // Looked up by key, not by label: the label now says which of the two
        // dates it was able to measure.
        const recency = h.factors.find(f => f.key === 'recency')!
        expect(recency.earned).toBe(35)
        expect(recency.max).toBe(35)
    })

    it('steps recency down as the record goes stale', () => {
        const earned = [3, 20, 45, 80, 200].map(d =>
            calculateHealthScore(customer({ lastUpdateDate: daysAgo(d) }), [], [])
                .factors.find(f => f.key === 'recency')!.earned,
        )
        expect(earned).toEqual([35, 25, 15, 5, 0])
        // Monotonically non-increasing: staler can never score higher.
        expect([...earned].sort((a, b) => b - a)).toEqual(earned)
    })

    it('zeroes invoice health when any invoice is overdue', () => {
        const overdue = invoice({ status: 'sent', dueDate: daysAgo(10) })
        const h = calculateHealthScore(customer({ lastUpdateDate: daysAgo(1) }), [overdue], [])
        expect(h.factors.find(f => f.label === 'Invoice health')!.earned).toBe(0)
    })

    it('ignores invoices belonging to other customers', () => {
        const other = invoice({ customerId: 'someone-else', status: 'sent', dueDate: daysAgo(10) })
        const h = calculateHealthScore(customer({ lastUpdateDate: daysAgo(1) }), [other], [])
        // No invoices of its own -> the "no invoices on file" allowance, not 0.
        expect(h.factors.find(f => f.label === 'Invoice health')!.earned).toBe(15)
    })

    it('caps at 100 when every factor is maxed', () => {
        const h = calculateHealthScore(
            customer({
                lastUpdateDate: daysAgo(1),
                comments: 'spoke to them',
                followUpDate: daysAgo(-7),
                amount: 5000,
            }),
            [invoice()],
            [plan()],
        )
        expect(h.score).toBe(100)
        expect(h.label).toBe('Excellent')
    })

    it('sums factor maxima to exactly 100', () => {
        const h = calculateHealthScore(customer(), [], [])
        expect(h.factors.reduce((s, f) => s + f.max, 0)).toBe(100)
    })

    it('never reports a score above its factor total', () => {
        const h = calculateHealthScore(customer({ lastUpdateDate: daysAgo(1) }), [invoice()], [plan()])
        expect(h.score).toBe(h.factors.reduce((s, f) => s + f.earned, 0))
    })

    // Real constructions that land exactly on each label boundary, rather
    // than asserting against a copy of the threshold logic. These cutoffs are
    // why the removed light score disagreed with this one: it pushed a
    // rescaled 0-50 subtotal through the same numbers.
    it.each([
        // recency + engagement + invoice + plan = score
        ['Excellent at the 80 boundary', 1, true, 'paid', false, 80, 'Excellent'],
        ['Good at the 60 boundary', 20, true, 'open', false, 60, 'Good'],
        ['Fair at the 40 boundary', 1, 'amountOnly', 'overdue', false, 40, 'Fair'],
        ['At Risk below 40', 20, 'amountOnly', 'overdue', false, 30, 'At Risk'],
        ['Excellent when everything is maxed', 1, true, 'paid', true, 100, 'Excellent'],
    ])('%s', (_name, staleDays, engagement, invoiceState, hasPlan, score, label) => {
        const engaged = engagement === true
        const c = customer({
            lastUpdateDate: daysAgo(staleDays as number),
            comments: engaged ? 'spoke to them' : '',
            followUpDate: engaged ? daysAgo(-7) : null,
            amount: engaged || engagement === 'amountOnly' ? 5000 : 0,
        })
        const invoices =
            invoiceState === 'paid' ? [invoice()]
            : invoiceState === 'overdue' ? [invoice({ status: 'sent', dueDate: daysAgo(10) })]
            : invoiceState === 'open' ? [invoice({ status: 'sent', dueDate: daysAgo(-30) })]
            : []
        const h = calculateHealthScore(c, invoices, hasPlan ? [plan()] : [])
        expect(h.score).toBe(score)
        expect(h.label).toBe(label)
    })

    it('marks an overdue customer At Risk even when recently touched', () => {
        // This is the case the removed light score got wrong: recency alone
        // scored it "Good" while the full score sees the overdue invoice.
        const h = calculateHealthScore(
            customer({ lastUpdateDate: daysAgo(1) }),
            [invoice({ status: 'sent', dueDate: daysAgo(10) })],
            [],
        )
        expect(h.score).toBe(35)
        expect(h.label).toBe('At Risk')
    })
})

describe('healthBreakdown', () => {
    it('lists every factor with its earned and max points', () => {
        const h = calculateHealthScore(customer({ lastUpdateDate: daysAgo(1) }), [], [])
        const text = healthBreakdown(h)
        expect(text).toContain(`Health ${h.score}/100 · ${h.label}`)
        for (const f of h.factors) {
            expect(text).toContain(`${f.label} — ${f.earned}/${f.max}`)
        }
    })

    it('marks full factors with a tick and empty ones with a dot', () => {
        const h = calculateHealthScore(
            customer({ lastContactDate: isoDaysAgo(1) }), [], [],
        )
        expect(healthBreakdown(h)).toContain('✓ Recent contact')
        expect(healthBreakdown(h)).toContain('· Service plan')
    })
})

/**
 * The 35-point factor — the largest — measured lastUpdateDate, which
 * customerToFirestore stamps on every save, and called itself "Recent
 * contact". Fixing a typo in a zip code scored a full 35 and reported
 * "Updated this week", while the record carries a lastContactDate the form
 * lets you set and the detail page shows as "Last Contact".
 */
describe('recency basis', () => {
    const recency = (c: CustomerItem) =>
        calculateHealthScore(c, [], []).factors.find(f => f.key === 'recency')!

    it('prefers a recorded contact date over the record timestamp', () => {
        const f = recency(customer({ lastContactDate: isoDaysAgo(3), lastUpdateDate: daysAgo(200) }))
        expect(f.label).toBe('Recent contact')
        expect(f.earned).toBe(35)
        expect(f.detail).toMatch(/Contacted/)
    })

    it('scores a stale contact date low even when the record was just edited', () => {
        // The case the old factor got backwards: edited yesterday, not
        // contacted in half a year, scored a full 35 for "Recent contact".
        const f = recency(customer({ lastContactDate: isoDaysAgo(200), lastUpdateDate: daysAgo(1) }))
        expect(f.earned).toBe(0)
        expect(f.detail).toMatch(/No contact in 200d/)
    })

    it('falls back to record activity and says so when no contact date is set', () => {
        const f = recency(customer({ lastUpdateDate: daysAgo(3) }))
        expect(f.label).toBe('Record activity')
        expect(f.earned).toBe(35)
        expect(f.detail).toMatch(/No contact date on file/)
    })

    it('never claims contact it cannot evidence', () => {
        for (const iso of ['', '   ', 'not-a-date']) {
            const f = recency(customer({ lastContactDate: iso, lastUpdateDate: daysAgo(3) }))
            expect(f.label).toBe('Record activity')
            expect(f.detail).not.toMatch(/Contacted/)
        }
    })

    it('scores both bases on the same ladder, so the total stays out of 100', () => {
        for (const c of [
            customer({ lastContactDate: isoDaysAgo(3) }),
            customer({ lastUpdateDate: daysAgo(3) }),
        ]) {
            const h = calculateHealthScore(c, [], [])
            expect(h.factors.reduce((s, f) => s + f.max, 0)).toBe(HEALTH_MAX)
        }
    })

    it('gives every factor a distinct stable key', () => {
        const keys = calculateHealthScore(customer(), [], []).factors.map(f => f.key)
        expect(keys).toEqual(['recency', 'invoices', 'plan', 'engagement'])
    })
})

describe('HEALTH_BANDS', () => {
    it('covers the whole 0-100 range with no gap', () => {
        for (let score = 0; score <= HEALTH_MAX; score++) {
            expect(healthBandFor(score)).toBeDefined()
        }
        expect(HEALTH_BANDS[HEALTH_BANDS.length - 1].min).toBe(0)
    })

    it('is ordered highest first, which resolveLabel relies on', () => {
        const mins = HEALTH_BANDS.map(b => b.min)
        expect([...mins].sort((a, b) => b - a)).toEqual(mins)
    })

    it('carries every class the UI needs, including the tile number colour', () => {
        for (const b of HEALTH_BANDS) {
            expect(b.badgeClass).toBeTruthy()
            expect(b.dotClass).toBeTruthy()
            expect(b.barClass).toBeTruthy()
            expect(b.numberClass).toBeTruthy()
        }
    })

    /**
     * The page had its own colorMap using text-cyan-400 for Good — the colour
     * the comment on this array says the scale deliberately moved away from,
     * and the only one of the four with no light-mode override in index.css
     * (1.81:1 on a white card).
     */
    it('uses no cyan, and every tile colour has a light-mode rule', () => {
        const css = readFileSync('src/index.css', 'utf8')
        for (const b of HEALTH_BANDS) {
            expect(b.numberClass).not.toContain('cyan')
            expect(css, `${b.label} tile (${b.numberClass})`)
                .toContain(`html.light-mode .${b.numberClass}`)
        }
    })

    it('names a range for every band', () => {
        expect(HEALTH_BANDS.map((_, i) => healthBandRange(i)))
            .toEqual(['80+', '60–79', '40–59', '0–39'])
    })
})

describe('healthBandFor', () => {
    it.each([
        [100, 'Excellent'], [80, 'Excellent'], [79, 'Good'], [60, 'Good'],
        [59, 'Fair'], [40, 'Fair'], [39, 'At Risk'], [0, 'At Risk'],
    ])('scores %i as %s', (score, label) => {
        expect(healthBandFor(score).label).toBe(label)
    })
})

describe('healthSummary', () => {
    const scored = (...scores: number[]): ScoredCustomer[] =>
        scores.map((s, i) => ({
            customer: customer({ id: `c${i}` }),
            health: { ...calculateHealthScore(customer(), [], []), score: s, ...bandOf(s) },
        }))

    function bandOf(score: number) {
        const b = healthBandFor(score)
        return { label: b.label, badgeClass: b.badgeClass, dotClass: b.dotClass, barClass: b.barClass, numberClass: b.numberClass }
    }

    it('counts each band and averages the scores given to it', () => {
        const s = healthSummary(scored(90, 70, 50, 10))
        expect(s.counts).toEqual({ Excellent: 1, Good: 1, Fair: 1, 'At Risk': 1 })
        expect(s.avg).toBe(55)
        expect(s.total).toBe(4)
    })

    it('keeps the band counts adding up to the total', () => {
        const s = healthSummary(scored(90, 85, 70, 30, 10))
        const sum = s.counts.Excellent + s.counts.Good + s.counts.Fair + s.counts['At Risk']
        expect(sum).toBe(s.total)
    })

    it('reports no average for an empty list rather than a misleading zero', () => {
        // A zero average reads as "every account is At Risk".
        expect(healthSummary([])).toEqual({
            counts: { Excellent: 0, Good: 0, Fair: 0, 'At Risk': 0 }, avg: null, total: 0,
        })
    })

    it('describes exactly the list it was handed', () => {
        // The tiles summed every active customer while the list below applied
        // a rep filter too, so "At Risk 12" could sit above three rows.
        const all = scored(90, 10, 10)
        expect(healthSummary(all).total).toBe(3)
        expect(healthSummary(all.slice(0, 1)).total).toBe(1)
        expect(healthSummary(all.slice(0, 1)).counts['At Risk']).toBe(0)
    })
})

describe('sortScored', () => {
    function s(id: string, score: number, first: string, updatedDaysAgo: number): ScoredCustomer {
        const b = healthBandFor(score)
        return {
            customer: customer({ id, first, lastname: 'X', lastUpdateDate: daysAgo(updatedDaysAgo) }),
            health: {
                ...calculateHealthScore(customer(), [], []), score,
                label: b.label, badgeClass: b.badgeClass, dotClass: b.dotClass,
                barClass: b.barClass, numberClass: b.numberClass,
            },
        }
    }
    const items = [s('a', 90, 'Zoe', 1), s('b', 30, 'Ann', 90), s('c', 60, 'Mia', 30)]
    const ids = (k: HealthSort) => sortScored(items, k).map(x => x.customer.id)

    it('sorts worst and best first', () => {
        expect(ids('worst')).toEqual(['b', 'c', 'a'])
        expect(ids('best')).toEqual(['a', 'c', 'b'])
    })

    it('sorts by name and by least recent activity', () => {
        expect(ids('name')).toEqual(['b', 'c', 'a'])
        expect(ids('recent')).toEqual(['b', 'c', 'a'])
    })

    it('breaks ties on score, then name', () => {
        const tied = [s('x', 50, 'Bob', 5), s('y', 50, 'Amy', 5)]
        expect(sortScored(tied, 'name').map(t => t.customer.id)).toEqual(['y', 'x'])
    })

    it('does not reorder the array it was given', () => {
        const input = [...items]
        sortScored(input, 'best')
        expect(input.map(i => i.customer.id)).toEqual(['a', 'b', 'c'])
    })

    it('offers a label for every sort it supports', () => {
        expect(HEALTH_SORTS.map(x => x.key).sort()).toEqual(['best', 'name', 'recent', 'worst'])
        for (const x of HEALTH_SORTS) expect(x.label).toBeTruthy()
    })
})

describe('searchScored', () => {
    const mk = (over: Partial<CustomerItem>): ScoredCustomer => ({
        customer: customer(over),
        health: calculateHealthScore(customer(), [], []),
    })
    const items = [
        mk({ id: 'a', first: 'Ann', lastname: 'Brown', email: 'ann@acme.com', city: 'Delray', phone: '(555) 999-8888' }),
        mk({ id: 'b', first: 'Bob', lastname: 'Smith', email: 'bob@x.com', city: 'Boca', phone: '(555) 123-4567' }),
    ]

  it('matches name, email and city', () => {
        expect(searchScored(items, 'brown').map(s => s.customer.id)).toEqual(['a'])
        expect(searchScored(items, 'acme').map(s => s.customer.id)).toEqual(['a'])
        expect(searchScored(items, 'boca').map(s => s.customer.id)).toEqual(['b'])
    })

    it('matches a phone however it is punctuated', () => {
        for (const q of ['5551234567', '555 123', '(555) 123-4567']) {
            expect(searchScored(items, q).map(s => s.customer.id)).toEqual(['b'])
        }
    })

    it('ignores a one- or two-digit query rather than matching everything', () => {
        expect(searchScored(items, '5')).toHaveLength(0)
    })

    it('returns everything for a blank query', () => {
        expect(searchScored(items, '   ')).toHaveLength(2)
    })
})

/** factors was computed for every row and never rendered. */
describe('healthShortfalls', () => {
    it('lists what is dragging the score down, biggest gap first', () => {
        const h = calculateHealthScore(customer({ lastUpdateDate: daysAgo(1) }), [], [])
        // No plan is a 20-point hole; no invoices on file still earns the
        // 15-of-30 allowance, so it's a smaller gap than the missing plan.
        const gaps = healthShortfalls(h)
        expect(gaps.map(f => f.key)).toEqual(['plan', 'invoices', 'engagement'])
        for (let i = 1; i < gaps.length; i++) {
            const prev = gaps[i - 1].max - gaps[i - 1].earned
            expect(gaps[i].max - gaps[i].earned).toBeLessThanOrEqual(prev)
        }
    })

    it('is empty for a perfect score', () => {
        const h = calculateHealthScore(
            customer({ lastContactDate: isoDaysAgo(1), comments: 'spoke', followUpDate: daysAgo(-7), amount: 5000 }),
            [invoice()], [plan()],
        )
        expect(h.score).toBe(HEALTH_MAX)
        expect(healthShortfalls(h)).toEqual([])
    })
})
