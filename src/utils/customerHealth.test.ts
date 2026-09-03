import { describe, it, expect } from 'vitest'
import { calculateHealthScore, healthBreakdown } from './customerHealth'
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
        const recency = h.factors.find(f => f.label === 'Recent contact')!
        expect(recency.earned).toBe(35)
        expect(recency.max).toBe(35)
    })

    it('steps recency down as the record goes stale', () => {
        const earned = [3, 20, 45, 80, 200].map(d =>
            calculateHealthScore(customer({ lastUpdateDate: daysAgo(d) }), [], [])
                .factors.find(f => f.label === 'Recent contact')!.earned,
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
        const h = calculateHealthScore(customer({ lastUpdateDate: daysAgo(1) }), [], [])
        expect(healthBreakdown(h)).toContain('✓ Recent contact')
        expect(healthBreakdown(h)).toContain('· Service plan')
    })
})
