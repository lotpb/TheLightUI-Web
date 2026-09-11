import { describe, it, expect } from 'vitest'
import {
    buildSeries, buildChartRows, forecastRevenue, growthRate, linReg,
    lastNMonths, nextNMonths, monthKey, type MonthPoint,
} from './forecast'

/** A dense series ending at the current month, which is marked partial. */
function series(revenues: number[], now = new Date()): MonthPoint[] {
    const keys = lastNMonths(revenues.length, now)
    const current = monthKey(now)
    return keys.map((key, i) => ({
        key,
        revenue: revenues[i],
        deals: revenues[i] > 0 ? 1 : 0,
        partial: key === current,
    }))
}

const NOW = new Date(2026, 8, 10)   // 10 Sep 2026

describe('linReg', () => {
    it('fits an exact line', () => {
        const [slope, intercept] = linReg([[0, 10], [1, 20], [2, 30]])
        expect(slope).toBe(10)
        expect(intercept).toBe(10)
    })

    it('reports zero spread for a perfect fit and non-zero for a scattered one', () => {
        expect(linReg([[0, 10], [1, 20], [2, 30]])[2]).toBe(0)
        expect(linReg([[0, 10], [1, 25], [2, 30]])[2]).toBeGreaterThan(0)
    })

    it('needs no more than one point to not explode', () => {
        expect(linReg([])).toEqual([0, 0, 0])
        expect(linReg([[0, 7]])).toEqual([0, 7, 0])
    })
})

describe('forecastRevenue — the month in progress is excluded', () => {
    // The old code fitted the current month as if it were complete. On a
    // business flat at $50k it turned a $300,000 six-month projection into
    // $41,428 depending only on what day you opened the page.
    it('gives the same answer on the 3rd as on the 30th', () => {
        const settled = [50_000, 50_000, 50_000, 50_000, 50_000, 50_000, 50_000]
        const early = forecastRevenue(series([...settled, 5_000], NOW), 6, NOW)!
        const late  = forecastRevenue(series([...settled, 48_000], NOW), 6, NOW)!
        expect(early.points).toEqual(late.points)
    })

    it('projects a flat business flat', () => {
        const f = forecastRevenue(series([50_000, 50_000, 50_000, 50_000, 50_000, 50_000, 1_000], NOW), 6, NOW)!
        expect(f.points.map(p => p.projected)).toEqual(Array(6).fill(50_000))
        expect(f.trend).toBe('flat')
    })

    it('excludes only the current month from the basis', () => {
        const f = forecastRevenue(series([10, 20, 30, 40, 50, 60, 999], NOW), 3, NOW)!
        expect(f.basisMonths).toBe(6)
    })
})

describe('forecastRevenue — empty months are real zeros', () => {
    // They used to be filtered out, so the fit skipped over them and the
    // "recent months" it claimed to use could end a quarter in the past.
    it('lets a dead quarter pull the trend down', () => {
        const f = forecastRevenue(series([80_000, 80_000, 80_000, 0, 0, 0, 1], NOW), 3, NOW)!
        expect(f.slope).toBeLessThan(0)
        expect(f.trend).toBe('declining')
    })

    it('does not let pre-history zeros drag down a young company', () => {
        const records = [
            { date: new Date(2026, 6, 15), amount: 10_000 },
            { date: new Date(2026, 7, 15), amount: 20_000 },
        ]
        const s = buildSeries(records, lastNMonths(12, NOW), NOW)
        expect(s[0].key).toBe('2026-07')          // leading empty months trimmed
        expect(s.map(p => p.revenue)).toEqual([10_000, 20_000, 0])
    })

    it('keeps empty months that fall between trading months', () => {
        const records = [
            { date: new Date(2026, 4, 15), amount: 10_000 },
            { date: new Date(2026, 7, 15), amount: 20_000 },
        ]
        const s = buildSeries(records, lastNMonths(12, NOW), NOW)
        expect(s.map(p => p.revenue)).toEqual([10_000, 0, 0, 20_000, 0])
    })
})

describe('forecastRevenue — a decline is reported, not flattened to $0', () => {
    // Math.max(0, …) on every point turned any steep decline into a flat zero
    // line with no explanation anywhere on the page.
    it('names the trend and when it reaches zero', () => {
        const f = forecastRevenue(series([60_000, 50_000, 40_000, 30_000, 20_000, 10_000, 1], NOW), 6, NOW)!
        expect(f.trend).toBe('declining')
        expect(f.slope).toBeLessThan(0)
        expect(f.monthsToZero).not.toBeNull()
        expect(f.monthsToZero).toBeLessThanOrEqual(6)
    })

    it('still never projects negative revenue', () => {
        const f = forecastRevenue(series([60_000, 50_000, 40_000, 30_000, 20_000, 10_000, 1], NOW), 12, NOW)!
        expect(f.points.every(p => p.projected >= 0 && p.low >= 0)).toBe(true)
    })

    it('calls a rise a rise', () => {
        const f = forecastRevenue(series([10_000, 20_000, 30_000, 40_000, 50_000, 60_000, 1], NOW), 3, NOW)!
        expect(f.trend).toBe('rising')
        expect(f.monthsToZero).toBeNull()
    })

    it('treats a small wobble as flat rather than a direction', () => {
        const f = forecastRevenue(series([50_000, 50_100, 50_050, 50_200, 50_100, 50_150, 1], NOW), 3, NOW)!
        expect(f.trend).toBe('flat')
    })
})

describe('forecastRevenue — the band comes from the data', () => {
    // It was projected × 0.8 and × 1.2: the same ±20% whether the points were
    // tight or scattered, and constant across the whole horizon.
    it('is a point with no width when the history is a perfect line', () => {
        const f = forecastRevenue(series([10_000, 20_000, 30_000, 40_000, 50_000, 60_000, 1], NOW), 3, NOW)!
        expect(f.stdError).toBe(0)
        expect(f.points.every(p => p.low === p.projected && p.high === p.projected)).toBe(true)
    })

    it('widens with scatter', () => {
        const tight  = forecastRevenue(series([50_000, 51_000, 50_000, 51_000, 50_000, 51_000, 1], NOW), 3, NOW)!
        const noisy  = forecastRevenue(series([10_000, 90_000, 20_000, 80_000, 30_000, 70_000, 1], NOW), 3, NOW)!
        expect(noisy.stdError).toBeGreaterThan(tight.stdError)
    })

    it('widens with distance into the future', () => {
        const f = forecastRevenue(series([10_000, 90_000, 20_000, 80_000, 30_000, 70_000, 1], NOW), 6, NOW)!
        const width = f.points.map(p => p.high - p.low)
        for (let i = 1; i < width.length; i++) expect(width[i]).toBeGreaterThanOrEqual(width[i - 1])
    })
})

describe('forecastRevenue — not enough history', () => {
    it('returns null rather than a line through two points', () => {
        expect(forecastRevenue(series([50_000, 1], NOW), 6, NOW)).toBeNull()
        expect(forecastRevenue([], 6, NOW)).toBeNull()
    })

    it('works from three complete months', () => {
        expect(forecastRevenue(series([10_000, 20_000, 30_000, 1], NOW), 3, NOW)).not.toBeNull()
    })
})

describe('growthRate', () => {
    // The halves were slice(0, floor(n/2)) and slice(floor(n/2)), so an odd
    // count handed the extra month to the second half: a business with
    // identical revenue every month reported +50% on five months.
    it('reports zero growth for a flat business at any month count', () => {
        for (const n of [4, 5, 6, 7, 9, 11]) {
            const s = series([...Array(n).fill(50_000), 1], NOW)
            expect(growthRate(s)).toBe(0)
        }
    })

    it('reports real growth', () => {
        expect(growthRate(series([10_000, 10_000, 20_000, 20_000, 1], NOW))).toBe(100)
    })

    it('reports a real decline', () => {
        expect(growthRate(series([20_000, 20_000, 10_000, 10_000, 1], NOW))).toBe(-50)
    })

    it('ignores the month in progress', () => {
        const withStub = growthRate(series([10_000, 10_000, 20_000, 20_000, 1], NOW))
        const without  = growthRate(series([10_000, 10_000, 20_000, 20_000, 0], NOW))
        expect(withStub).toBe(without)
    })

    it('needs four complete months', () => {
        expect(growthRate(series([10_000, 20_000, 30_000, 1], NOW))).toBeNull()
    })
})

describe('buildChartRows', () => {
    const s = series([10_000, 20_000, 30_000, 4_000], NOW)   // last is the month in progress
    const f = forecastRevenue(s, 2, NOW)!
    const rows = buildChartRows(s, f.points)

    it('keeps the month in progress out of the actual line', () => {
        expect(rows.map(r => r.actual)).toEqual([10_000, 20_000, 30_000, null, null, null])
    })

    it('joins the partial segment to the last complete point', () => {
        // The month before it repeats its value so the dashed stub connects.
        expect(rows.map(r => r.partial)).toEqual([null, null, 30_000, 4_000, null, null])
    })

    it('anchors the projection at the last complete month', () => {
        expect(rows[2].projected).toBe(30_000)
        expect(rows[3].projected).toBeNull()
        expect(rows[4].projected).toBe(f.points[0].projected)
    })

    it('carries the band as a height stacked on low, never a cut-out', () => {
        for (const r of rows.slice(3)) {
            if (r.low === null) continue
            expect(r.band).toBeGreaterThanOrEqual(0)
        }
        expect(rows.slice(0, 4).every(r => r.low === null && r.band === null)).toBe(true)
    })

    it('survives a history with no complete months', () => {
        const only = series([5_000], NOW)
        expect(() => buildChartRows(only, [])).not.toThrow()
        expect(buildChartRows(only, [])[0].projected).toBeNull()
    })
})

describe('month keys', () => {
    it('ends the history at the current month and starts the forecast after it', () => {
        expect(lastNMonths(3, NOW)).toEqual(['2026-07', '2026-08', '2026-09'])
        expect(nextNMonths(3, NOW)).toEqual(['2026-10', '2026-11', '2026-12'])
    })

    it('crosses a year boundary', () => {
        expect(nextNMonths(4, new Date(2026, 10, 5))).toEqual(['2026-12', '2027-01', '2027-02', '2027-03'])
    })
})
