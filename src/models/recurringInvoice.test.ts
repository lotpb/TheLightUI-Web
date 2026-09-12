import { describe, it, expect } from 'vitest'
import {
    recurringState, recurringSummary, INTERVAL_MONTHS,
    type Invoice, type RecurringInterval,
} from './invoice'

const NOW = new Date('2026-09-11T12:00:00')

type Sched = Pick<Invoice, 'recurring' | 'recurringPaused' | 'nextRecurDate' | 'lineItems' | 'taxRate'>

function sched(over: Partial<Sched> = {}): Sched {
    return {
        recurring: 'monthly',
        recurringPaused: false,
        nextRecurDate: new Date('2026-10-01'),
        lineItems: [{ description: 'Service', qty: 1, rate: 100 }],
        taxRate: 0,
        ...over,
    }
}

describe('recurringState', () => {
    it('is scheduled while the next date is in the future', () => {
        expect(recurringState(sched({ nextRecurDate: new Date('2026-10-01') }), NOW)).toBe('scheduled')
    })

    it('is due once the next date has passed', () => {
        expect(recurringState(sched({ nextRecurDate: new Date('2026-09-01') }), NOW)).toBe('due')
    })

    it('counts today as due, to the end of the day', () => {
        // A date earlier today still reads as due, not scheduled.
        expect(recurringState(sched({ nextRecurDate: new Date('2026-09-11T09:00:00') }), NOW)).toBe('due')
        expect(recurringState(sched({ nextRecurDate: new Date('2026-09-11T23:00:00') }), NOW)).toBe('due')
    })

    it('separates a missing date from being due', () => {
        // isDue returned true for this, so the row claimed "Due Now" with a
        // next date of "—".
        expect(recurringState(sched({ nextRecurDate: null }), NOW)).toBe('undated')
    })

    it('reports paused ahead of anything else', () => {
        expect(recurringState(sched({ recurringPaused: true, nextRecurDate: new Date('2020-01-01') }), NOW)).toBe('paused')
        expect(recurringState(sched({ recurringPaused: true, nextRecurDate: null }), NOW)).toBe('paused')
    })
})

describe('recurringSummary — the committed value', () => {
    it('normalises every interval to a monthly figure', () => {
        const s = recurringSummary([
            sched({ recurring: 'monthly',   lineItems: [{ description: '', qty: 1, rate: 100 }] }),
            sched({ recurring: 'quarterly', lineItems: [{ description: '', qty: 1, rate: 300 }] }),
            sched({ recurring: 'yearly',    lineItems: [{ description: '', qty: 1, rate: 1200 }] }),
        ], NOW)
        // 100 + 300/3 + 1200/12 = 300
        expect(s.monthly).toBe(300)
        expect(s.annual).toBe(3600)
    })

    it('includes tax in the committed value', () => {
        const s = recurringSummary([sched({ taxRate: 10 })], NOW)
        expect(s.monthly).toBeCloseTo(110, 6)
    })

    it('multiplies quantity by rate', () => {
        const s = recurringSummary([sched({ lineItems: [{ description: '', qty: 3, rate: 50 }] })], NOW)
        expect(s.monthly).toBe(150)
    })

    it('leaves paused schedules out of the money', () => {
        const s = recurringSummary([
            sched(),
            sched({ recurringPaused: true, lineItems: [{ description: '', qty: 1, rate: 9999 }] }),
        ], NOW)
        expect(s.monthly).toBe(100)
        expect(s).toMatchObject({ active: 1, paused: 1 })
    })

    it('ignores invoices with no schedule at all', () => {
        const s = recurringSummary([sched({ recurring: null }), sched()], NOW)
        expect(s).toMatchObject({ active: 1, paused: 0 })
        expect(s.monthly).toBe(100)
    })

    it('counts due and undated separately', () => {
        const s = recurringSummary([
            sched({ nextRecurDate: new Date('2026-09-01') }),
            sched({ nextRecurDate: null }),
            sched({ nextRecurDate: new Date('2026-12-01') }),
        ], NOW)
        expect(s).toMatchObject({ active: 3, due: 1, undated: 1 })
    })

    it('breaks the active count down by interval', () => {
        const s = recurringSummary([
            sched({ recurring: 'monthly' }),
            sched({ recurring: 'monthly' }),
            sched({ recurring: 'yearly' }),
            sched({ recurring: 'quarterly', recurringPaused: true }),
        ], NOW)
        expect(s.byInterval).toEqual({ monthly: 2, quarterly: 0, yearly: 1 })
    })

    it('is all zeros for nothing', () => {
        expect(recurringSummary([], NOW)).toEqual({
            active: 0, paused: 0, due: 0, undated: 0, monthly: 0, annual: 0,
            byInterval: { monthly: 0, quarterly: 0, yearly: 0 },
        })
    })

    it('survives a schedule with no line items', () => {
        const s = recurringSummary([sched({ lineItems: [] })], NOW)
        expect(s.monthly).toBe(0)
        expect(s.active).toBe(1)
    })
})

describe('INTERVAL_MONTHS', () => {
    it('covers every interval, so the normalisation can never divide by undefined', () => {
        const intervals: RecurringInterval[] = ['monthly', 'quarterly', 'yearly']
        for (const i of intervals) expect(INTERVAL_MONTHS[i]).toBeGreaterThan(0)
    })
})
