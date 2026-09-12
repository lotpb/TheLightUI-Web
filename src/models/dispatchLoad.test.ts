import { describe, it, expect } from 'vitest'
import { dayLoad, weekDayLoads, countsTowardCap, CELL_VISIBLE_LIMIT } from './dispatchLoad'
import { getWeekStart, type DispatchAssignment, type DispatchStatus } from './dispatchAssignment'

const WEEK_START = getWeekStart(new Date('2026-09-14T12:00:00'))   // a Monday

type A = Pick<DispatchAssignment, 'status' | 'startAt'>

function visit(dayOffset: number, status: DispatchStatus = 'scheduled'): A {
    const d = new Date(WEEK_START)
    d.setDate(d.getDate() + dayOffset)
    d.setHours(9, 0, 0, 0)
    return { status, startAt: d }
}

describe('countsTowardCap', () => {
    // The server does `if (d['status'] === 'cancelled') continue` — everything
    // else counts, including done.
    it('excludes only cancelled', () => {
        expect(countsTowardCap({ status: 'cancelled' })).toBe(false)
        for (const s of ['scheduled', 'in_progress', 'done'] as DispatchStatus[]) {
            expect(countsTowardCap({ status: s })).toBe(true)
        }
    })
})

describe('dayLoad', () => {
    it('is open with no cap, however many visits', () => {
        expect(dayLoad(99, 0)).toEqual({ count: 99, cap: 0, state: 'open' })
    })

    it('treats a negative cap as no cap, like Number(...) || 0 does', () => {
        expect(dayLoad(5, -3).state).toBe('open')
        expect(dayLoad(5, -3).cap).toBe(0)
    })

    it('is full at the cap, not one past it', () => {
        // The server's rule is `count >= maxPerDay`, so the portal closes on
        // the day the cap is reached.
        expect(dayLoad(5, 6).state).toBe('open')
        expect(dayLoad(6, 6).state).toBe('full')
    })

    it('separates over-cap from full, because only one is a mistake', () => {
        expect(dayLoad(7, 6).state).toBe('over')
        expect(dayLoad(7, 6)).toMatchObject({ count: 7, cap: 6 })
    })

    it('is open at zero visits under a cap', () => {
        expect(dayLoad(0, 6).state).toBe('open')
    })

    it('is full at a cap of one with one visit', () => {
        expect(dayLoad(1, 1).state).toBe('full')
    })
})

describe('weekDayLoads', () => {
    it('returns one entry per day, in week order', () => {
        const loads = weekDayLoads([], WEEK_START, 0)
        expect(loads).toHaveLength(7)
        expect(loads.every(l => l.count === 0 && l.state === 'open')).toBe(true)
    })

    it('counts every tech together, as the portal does', () => {
        // The cap is company-wide, not per tech — two techs on Tuesday is two.
        const loads = weekDayLoads([visit(1), visit(1), visit(1)], WEEK_START, 0)
        expect(loads[1].count).toBe(3)
    })

    it('buckets by day of the week', () => {
        const loads = weekDayLoads([visit(0), visit(2), visit(2), visit(6)], WEEK_START, 0)
        expect(loads.map(l => l.count)).toEqual([1, 0, 2, 0, 0, 0, 1])
    })

    it('leaves cancelled visits out of the count', () => {
        const loads = weekDayLoads([visit(3), visit(3, 'cancelled'), visit(3, 'done')], WEEK_START, 0)
        expect(loads[3].count).toBe(2)
    })

    it('ignores visits outside the visible week', () => {
        const loads = weekDayLoads([visit(-1), visit(7), visit(0)], WEEK_START, 0)
        expect(loads.map(l => l.count)).toEqual([1, 0, 0, 0, 0, 0, 0])
    })

    it('applies the cap to each day independently', () => {
        const loads = weekDayLoads(
            [visit(0), visit(0), visit(1), visit(1), visit(1)],
            WEEK_START, 2,
        )
        expect(loads[0].state).toBe('full')   // 2 of 2
        expect(loads[1].state).toBe('over')   // 3 of 2
        expect(loads[2].state).toBe('open')   // 0 of 2
    })

    it('counts a visit late in the day on that day, not the next', () => {
        const late = visit(4)
        late.startAt.setHours(23, 30, 0, 0)
        expect(weekDayLoads([late], WEEK_START, 0)[4].count).toBe(1)
    })
})

describe('CELL_VISIBLE_LIMIT', () => {
    it('is a small positive number, so a busy cell collapses', () => {
        // A cell had no ceiling: nine visits grew one tech's row to ~400px
        // while the rows around it stayed at 64px.
        expect(CELL_VISIBLE_LIMIT).toBeGreaterThan(0)
        expect(CELL_VISIBLE_LIMIT).toBeLessThan(10)
    })
})
