import { describe, it, expect } from 'vitest'
import {
    getWeekStart, getWeekDays, dayIndexInWeek, clipSpanToWeek, computeJobSpan,
} from './dispatchAssignment'

function d(y: number, m: number, day: number, h = 0): Date {
    return new Date(y, m - 1, day, h)
}

describe('getWeekStart', () => {
    it('returns the same date when given a Sunday', () => {
        const sunday = d(2026, 3, 1) // a Sunday
        expect(getWeekStart(sunday).getDate()).toBe(1)
    })

    it('rolls back to Sunday for a mid-week date', () => {
        const wednesday = d(2026, 3, 4)
        const start = getWeekStart(wednesday)
        expect(start.getDay()).toBe(0)
        expect(start.getDate()).toBe(1)
    })

    it('crosses a month boundary correctly', () => {
        // 2026-03-01 is a Sunday, so 2026-02-28 (Sat) belongs to the prior week
        const lastDayOfFeb = d(2026, 2, 28)
        const start = getWeekStart(lastDayOfFeb)
        expect(start.getMonth()).toBe(1) // February
        expect(start.getDate()).toBe(22)
    })

    it('normalizes to local midnight regardless of input time', () => {
        const start = getWeekStart(d(2026, 3, 4, 17))
        expect(start.getHours()).toBe(0)
        expect(start.getMinutes()).toBe(0)
    })
})

describe('getWeekDays', () => {
    it('returns 7 consecutive days starting from weekStart', () => {
        const days = getWeekDays(d(2026, 3, 1))
        expect(days).toHaveLength(7)
        expect(days.map(x => x.getDate())).toEqual([1, 2, 3, 4, 5, 6, 7])
    })

    it('produces exactly 7 distinct calendar days across a DST spring-forward boundary', () => {
        // US DST begins 2026-03-08 (2nd Sunday of March) — the week of 2026-03-08
        // has a 23-hour Sunday. Local-time date arithmetic must still land on
        // 7 clean, distinct calendar days with no skip or repeat.
        const days = getWeekDays(d(2026, 3, 8))
        expect(days).toHaveLength(7)
        const dates = days.map(x => x.getDate())
        expect(new Set(dates).size).toBe(7)
        expect(dates).toEqual([8, 9, 10, 11, 12, 13, 14])
    })

    it('produces exactly 7 distinct calendar days across a DST fall-back boundary', () => {
        // US DST ends 2026-11-01 (1st Sunday of November) — a 25-hour Sunday.
        const days = getWeekDays(d(2026, 11, 1))
        expect(days).toHaveLength(7)
        const dates = days.map(x => x.getDate())
        expect(new Set(dates).size).toBe(7)
        expect(dates).toEqual([1, 2, 3, 4, 5, 6, 7])
    })
})

describe('dayIndexInWeek', () => {
    const weekStart = d(2026, 3, 1) // Sunday

    it('maps the week-start day to index 0', () => {
        expect(dayIndexInWeek(d(2026, 3, 1), weekStart)).toBe(0)
    })

    it('maps the last day of the week to index 6', () => {
        expect(dayIndexInWeek(d(2026, 3, 7), weekStart)).toBe(6)
    })

    it('returns -1 for a date before the week', () => {
        expect(dayIndexInWeek(d(2026, 2, 28), weekStart)).toBe(-1)
    })

    it('returns -1 for a date after the week', () => {
        expect(dayIndexInWeek(d(2026, 3, 8), weekStart)).toBe(-1)
    })

    it('ignores time-of-day when bucketing', () => {
        expect(dayIndexInWeek(d(2026, 3, 3, 23), weekStart)).toBe(2)
    })
})

describe('clipSpanToWeek', () => {
    const weekStart = d(2026, 3, 1) // Sun 3/1 .. Sat 3/7

    it('leaves a span fully inside the week untouched', () => {
        const result = clipSpanToWeek(d(2026, 3, 2), d(2026, 3, 4), weekStart)
        expect(result?.start).toEqual(d(2026, 3, 2))
        expect(result?.end).toEqual(d(2026, 3, 4))
    })

    it('clips a span that starts before the week', () => {
        const result = clipSpanToWeek(d(2026, 2, 25), d(2026, 3, 3), weekStart)
        expect(result?.start).toEqual(d(2026, 3, 1))
        expect(result?.end).toEqual(d(2026, 3, 3))
    })

    it('clips a span that ends after the week', () => {
        const result = clipSpanToWeek(d(2026, 3, 5), d(2026, 3, 12), weekStart)
        expect(result?.start).toEqual(d(2026, 3, 5))
        expect(result?.end).toEqual(d(2026, 3, 8)) // clipped to window end
    })

    it('clips a span that spans the entire week and beyond', () => {
        const result = clipSpanToWeek(d(2026, 2, 20), d(2026, 3, 20), weekStart)
        expect(result?.start).toEqual(d(2026, 3, 1))
        expect(result?.end).toEqual(d(2026, 3, 8))
    })

    it('returns null for a span entirely before the week', () => {
        expect(clipSpanToWeek(d(2026, 2, 10), d(2026, 2, 20), weekStart)).toBeNull()
    })

    it('returns null for a span entirely after the week', () => {
        expect(clipSpanToWeek(d(2026, 3, 15), d(2026, 3, 20), weekStart)).toBeNull()
    })

    it('keeps a single-instant (same start/end) span at the week edge', () => {
        const result = clipSpanToWeek(d(2026, 3, 1), d(2026, 3, 1), weekStart)
        expect(result).not.toBeNull()
    })
})

describe('computeJobSpan', () => {
    it('returns the min start and max end across multiple assignments', () => {
        const span = computeJobSpan([
            { startAt: d(2026, 3, 3), endAt: d(2026, 3, 4) },
            { startAt: d(2026, 3, 1), endAt: d(2026, 3, 2) },
            { startAt: d(2026, 3, 5), endAt: d(2026, 3, 9) },
        ])
        expect(span.start).toEqual(d(2026, 3, 1))
        expect(span.end).toEqual(d(2026, 3, 9))
    })

    it('handles a single assignment', () => {
        const span = computeJobSpan([{ startAt: d(2026, 3, 1), endAt: d(2026, 3, 2) }])
        expect(span.start).toEqual(d(2026, 3, 1))
        expect(span.end).toEqual(d(2026, 3, 2))
    })

    it('returns null start/end for an empty list — the last-assignment-deleted case', () => {
        const span = computeJobSpan([])
        expect(span.start).toBeNull()
        expect(span.end).toBeNull()
    })
})
