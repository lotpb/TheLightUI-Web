import { describe, it, expect } from 'vitest'
import { scoreLead, scoreBreakdown } from './leadScore'
import { emptyCustomer, type CustomerItem } from '../models/customer'

const DAY = 24 * 60 * 60 * 1000

function lead(over: Partial<CustomerItem> = {}): CustomerItem {
    return { ...emptyCustomer(), id: 'l1', category: 'Lead', ...over }
}

const FULLY_QUALIFIED: Partial<CustomerItem> = {
    phone: '555-0100',
    email: 'a@b.com',
    street: '1 Main St',
    callback: 'yes',
    followUpDate: new Date(Date.now() + 7 * DAY),
    startDate: new Date(Date.now() + 3 * DAY),
    job: 'Rewire',
    salesman: 'Mike D',
    leadSource: 'Referral',
    amount: 1200,
}

describe('scoreLead', () => {
    it('sums factor maxima to exactly 100', () => {
        expect(scoreLead(lead()).factors.reduce((s, f) => s + f.max, 0)).toBe(100)
    })

    it('scores an empty lead at zero and labels it Cold', () => {
        const s = scoreLead(lead())
        expect(s.score).toBe(0)
        expect(s.label).toBe('Cold')
    })

    it('scores a fully qualified lead at 100 and labels it Hot', () => {
        const s = scoreLead(lead(FULLY_QUALIFIED))
        expect(s.score).toBe(100)
        expect(s.label).toBe('Hot')
    })

    it('reports a score equal to the sum of earned factors', () => {
        const s = scoreLead(lead({ phone: '555', email: 'a@b.com' }))
        expect(s.score).toBe(s.factors.reduce((a, f) => a + f.earned, 0))
    })

    it('awards nothing for an appointment already in the past', () => {
        const s = scoreLead(lead({ startDate: new Date(Date.now() - DAY) }))
        expect(s.factors.find(f => f.label === 'Appointment in future')!.earned).toBe(0)
    })

    it('treats callback values other than "yes" as not called', () => {
        for (const callback of ['no', '', 'maybe']) {
            const s = scoreLead(lead({ callback }))
            expect(s.factors.find(f => f.label === 'Has been called')!.earned).toBe(0)
        }
        expect(
            scoreLead(lead({ callback: 'YES' })).factors.find(f => f.label === 'Has been called')!.earned,
        ).toBe(15)
    })

    it('ignores whitespace-only contact details', () => {
        const s = scoreLead(lead({ phone: '   ', email: '\t' }))
        expect(s.score).toBe(0)
    })

    // The label bands are 20+ points wide, which is why the row shows the
    // number as well as the word.
    it.each([
        // Hot/Warm/Cool each have a band below them to fall into. Cold is the
        // bottom, so it has no lower neighbour to differ from.
        [70, 'Hot', 'Warm'],
        [45, 'Warm', 'Cool'],
        [20, 'Cool', 'Cold'],
    ])('treats %i as the floor of %s, dropping to %s below it', (floor, label, below) => {
        const labelFor = (n: number) =>
            n >= 70 ? 'Hot' : n >= 45 ? 'Warm' : n >= 20 ? 'Cool' : 'Cold'
        expect(labelFor(floor)).toBe(label)
        expect(labelFor(floor - 1)).toBe(below)
    })

    it('labels everything below 20 as Cold', () => {
        const labelFor = (n: number) =>
            n >= 70 ? 'Hot' : n >= 45 ? 'Warm' : n >= 20 ? 'Cool' : 'Cold'
        for (const n of [19, 10, 0]) expect(labelFor(n)).toBe('Cold')
    })
})

describe('scoreBreakdown', () => {
    it('leads with the score out of 100 and the label', () => {
        const s = scoreLead(lead(FULLY_QUALIFIED))
        expect(scoreBreakdown(s).split('\n')[0]).toBe('Lead score 100/100 · Hot')
    })

    it('includes a line per factor', () => {
        const s = scoreLead(lead())
        const text = scoreBreakdown(s)
        for (const f of s.factors) {
            expect(text).toContain(`${f.label} — ${f.earned}/${f.max}`)
        }
    })

    it('distinguishes earned from unearned factors', () => {
        const s = scoreLead(lead({ phone: '555-0100' }))
        expect(scoreBreakdown(s)).toContain('✓ Has phone number')
        expect(scoreBreakdown(s)).toContain('· Has email address')
    })
})
