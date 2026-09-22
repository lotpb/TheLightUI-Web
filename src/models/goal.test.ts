import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import {
  currentPeriodRange, daysElapsedIn, daysInPeriod, daysLeftIn, emptyGoalValues, goalActuals,
  goalProgress, goalsDirty, paceFraction, parseTarget, periodHasEnded,
  periodKey, periodRange,
  resolveGoalTargets,
  GOAL_FIELDS, GOAL_PERIODS, GOAL_STATE_STYLES,
  type GoalDoc, type GoalPeriod, type GoalState,
} from './goal'
import { goalsForPeriod } from './dashboard'
import { emptyCustomer, type CustomerItem } from './customer'

const at = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m - 1, d, h, min)

function cust(over: Partial<CustomerItem> = {}): CustomerItem {
  return { ...emptyCustomer(), id: 'c1', category: 'Customer', amount: 1000, creationDate: at(2026, 9, 10), ...over }
}

describe('periodKey', () => {
  it('identifies a month, quarter and year instance', () => {
    expect(periodKey('month',   at(2026, 9, 17))).toBe('2026-09')
    expect(periodKey('month',   at(2026, 1, 3))).toBe('2026-01')
    expect(periodKey('quarter', at(2026, 9, 17))).toBe('2026-Q3')
    expect(periodKey('quarter', at(2026, 1, 3))).toBe('2026-Q1')
    expect(periodKey('year',    at(2026, 9, 17))).toBe('2026')
  })

  it('gives the four quarters distinct keys', () => {
    const keys = [1, 4, 7, 10].map(m => periodKey('quarter', at(2026, m, 1)))
    expect(keys).toEqual(['2026-Q1', '2026-Q2', '2026-Q3', '2026-Q4'])
  })
})

describe('periodRange', () => {
  const now = at(2026, 9, 17)

  it('bounds the current month', () => {
    const r = periodRange('month', 0, now)
    expect(r.key).toBe('2026-09')
    expect(r.label).toBe('September 2026')
    expect([r.start.getMonth(), r.start.getDate()]).toEqual([8, 1])
    expect([r.end.getMonth(), r.end.getDate()]).toEqual([8, 30])
  })

  it('steps back a month, across a year boundary', () => {
    expect(periodRange('month', -1, now).key).toBe('2026-08')
    expect(periodRange('month', -9, now).key).toBe('2025-12')
    expect(periodRange('month', -9, now).label).toBe('December 2025')
  })

  it('bounds and steps quarters', () => {
    expect(periodRange('quarter', 0, now).key).toBe('2026-Q3')
    expect(periodRange('quarter', 0, now).label).toBe('Q3 2026')
    expect(periodRange('quarter', -1, now).key).toBe('2026-Q2')
    expect(periodRange('quarter', -3, now).key).toBe('2025-Q4')
    const q = periodRange('quarter', 0, now)
    expect([q.start.getMonth(), q.end.getMonth()]).toEqual([6, 8])   // Jul–Sep
  })

  it('bounds and steps years', () => {
    const y = periodRange('year', 0, now)
    expect([y.key, y.label]).toEqual(['2026', '2026'])
    expect([y.start.getMonth(), y.start.getDate()]).toEqual([0, 1])
    expect([y.end.getMonth(), y.end.getDate()]).toEqual([11, 31])
    expect(periodRange('year', -1, now).key).toBe('2025')
  })

  it('always labels the instance it actually covers, not the one containing now', () => {
    // A stale label here is how you end up reading August's numbers under a
    // September heading.
    for (const p of ['month', 'quarter', 'year'] as GoalPeriod[]) {
      for (const off of [0, -1, -2, -5]) {
        const r = periodRange(p, off, now)
        expect(periodKey(p, r.start)).toBe(r.key)
      }
    }
  })

  it('currentPeriodRange is offset zero', () => {
    for (const { key } of GOAL_PERIODS) {
      expect(currentPeriodRange(key, now).key).toBe(periodRange(key, 0, now).key)
    }
  })
})

/**
 * Revenue was `reduce((s, c) => s + (c.amount ?? 0), 0)` with no category
 * filter, so leads' quote amounts, vendors and employees all counted toward
 * the revenue goal — while /dashboard computed the same shape over the same
 * range filtered to Customer.
 */
describe('goalActuals', () => {
  const range = periodRange('month', 0, at(2026, 9, 17))
  const items = [
    cust({ id: 'c1', category: 'Customer', amount: 2000 }),
    cust({ id: 'c2', category: 'Customer', amount: 3000 }),
    cust({ id: 'l1', category: 'Lead',     amount: 9000 }),
    cust({ id: 'v1', category: 'Vendor',   amount: 7000 }),
    cust({ id: 'e1', category: 'Employee', amount: 5000 }),
  ]

  it('counts revenue from customer records only', () => {
    expect(goalActuals(items, range).revenue).toBe(5000)
  })

  it('counts leads and customers separately, ignoring other categories', () => {
    const a = goalActuals(items, range)
    expect(a.leads).toBe(1)
    expect(a.customers).toBe(2)
  })

  it('matches the category case-insensitively', () => {
    const a = goalActuals([cust({ category: 'customer', amount: 100 })], range)
    expect(a.revenue).toBe(100)
    expect(a.customers).toBe(1)
  })

  it('excludes records outside the window', () => {
    const outside = [
      cust({ id: 'before', creationDate: at(2026, 8, 31, 23) }),
      cust({ id: 'after',  creationDate: at(2026, 10, 1, 1) }),
    ]
    expect(goalActuals(outside, range)).toEqual({ revenue: 0, leads: 0, customers: 0 })
  })

  it('includes the first and last instant of the window', () => {
    const edges = [
      cust({ id: 'first', creationDate: at(2026, 9, 1, 0) }),
      cust({ id: 'last',  creationDate: at(2026, 9, 30, 23) }),
    ]
    expect(goalActuals(edges, range).customers).toBe(2)
  })

  it('is all zeroes for an empty book', () => {
    expect(goalActuals([], range)).toEqual({ revenue: 0, leads: 0, customers: 0 })
  })

  /**
   * The two pages are meant to agree: same range helper, same three fields,
   * same creationDate keying. Only revenue differed.
   *
   * This used to assert that DashboardPage contained the inline expression
   * `categoryMatches(c.category, 'Customer') ? c.amount : 0` — i.e. it pinned
   * a *copy* of this function and would have gone green forever if the two
   * copies drifted in the same direction. The dashboard now calls goalActuals
   * through models/dashboard's goalsForPeriod, so agreement is structural and
   * the check is that the duplicate is gone.
   */
  it('is the only implementation — /dashboard calls it rather than copying it', () => {
    const page = readFileSync('src/pages/DashboardPage.tsx', 'utf8')
    expect(page).not.toContain("categoryMatches(c.category, 'Customer') ? c.amount : 0")
    expect(page).toContain('goalsForPeriod')

    const model = readFileSync('src/models/dashboard.ts', 'utf8')
    expect(model).toContain('goalActuals')
  })

  it('agrees with what /dashboard renders for the same month', () => {
    const viaDashboard = goalsForPeriod(
      { companyId: 'co1', month: { revenue: 1, leads: 1, customers: 1 },
        quarter: emptyGoalValues(), year: emptyGoalValues(), periods: {} } as GoalDoc,
      items, 'month', at(2026, 9, 17),
    )
    expect(viaDashboard.actual).toEqual(goalActuals(items, range))
    expect(viaDashboard.actual.revenue).toBe(5000)
  })
})

describe('pace helpers', () => {
  const sep = periodRange('month', 0, at(2026, 9, 17))

  it('counts days left, and none once the period is over', () => {
    expect(daysLeftIn(sep, at(2026, 9, 30, 12))).toBe(1)
    expect(daysLeftIn(sep, at(2026, 10, 5))).toBe(0)
    expect(daysLeftIn(sep, at(2026, 9, 1, 0))).toBe(30)
  })

  it('counts elapsed days from 1 on the first day', () => {
    expect(daysElapsedIn(sep, at(2026, 9, 1, 6))).toBe(1)
    expect(daysElapsedIn(sep, at(2026, 9, 17, 12))).toBe(17)
  })

  it('never returns a zero elapsed count, so rates stay divisible', () => {
    expect(daysElapsedIn(sep, at(2026, 9, 1, 0))).toBeGreaterThanOrEqual(1)
    expect(daysElapsedIn(sep, at(2026, 8, 20))).toBeGreaterThanOrEqual(1)
  })

  it('caps elapsed days at the length of the period', () => {
    expect(daysElapsedIn(sep, at(2026, 12, 1))).toBe(30)
  })

  /**
   * Counting days by dividing milliseconds is wrong twice a year: March spans
   * 31 calendar days but only 30 days 23 hours of elapsed time in a
   * DST-observing zone, and November the reverse.
   */
  it('counts calendar days across a DST boundary', () => {
    for (const [month, days] of [[3, 31], [11, 30], [2, 28], [6, 30]] as const) {
      const r = periodRange('month', 0, at(2026, month, 15))
      expect(daysInPeriod(r), `month ${month}`).toBe(days)
      expect(daysElapsedIn(r, r.end), `month ${month} elapsed`).toBe(days)
      expect(daysLeftIn(r, r.start), `month ${month} left`).toBe(days)
    }
  })

  it('leaves one day remaining on the final day, and none after', () => {
    // daysLeft > 0 is what tells goalProgress the period is still live.
    expect(daysLeftIn(sep, at(2026, 9, 30, 23))).toBe(1)
    expect(daysLeftIn(sep, at(2026, 10, 1, 0, 1))).toBe(0)
  })

  it('reports the fraction elapsed, clamped to 0-1', () => {
    expect(paceFraction(sep, at(2026, 9, 1, 0))).toBeCloseTo(0, 2)
    expect(paceFraction(sep, at(2026, 10, 5))).toBe(1)
    expect(paceFraction(sep, at(2026, 8, 1))).toBe(0)
    expect(paceFraction(sep, at(2026, 9, 16, 0))).toBeCloseTo(0.5, 1)
  })

  it('knows when a period has ended', () => {
    expect(periodHasEnded(sep, at(2026, 9, 30, 23))).toBe(false)
    expect(periodHasEnded(sep, at(2026, 10, 1, 0, 1))).toBe(true)
  })
})

describe('goalProgress', () => {
  const sep = periodRange('month', 0, at(2026, 9, 17))
  const midSep = at(2026, 9, 15, 12)   // ~half way

  it('reports no-target when nothing is set', () => {
    const p = goalProgress(5000, 0, sep, midSep)
    expect(p.state).toBe('no-target')
    expect(p.pct).toBe(0)
    expect(p.neededPerDay).toBeNull()
  })

  /** pct was Math.min(100, …) so 100% and 250% rendered identically. */
  it('reports overachievement rather than clamping it', () => {
    const p = goalProgress(25_000, 10_000, sep, midSep)
    expect(p.pct).toBe(250)
    expect(p.barPct).toBe(100)
    expect(p.state).toBe('met')
    expect(p.met).toBe(true)
  })

  it('counts exactly hitting the target as met', () => {
    expect(goalProgress(100, 100, sep, midSep).state).toBe('met')
  })

  it('separates behind from at risk', () => {
    // Half way through a 30-day month: 15 days elapsed, 15 left.
    // On track: achieved rate already covers what remains.
    expect(goalProgress(6000, 10_000, sep, midSep).state).toBe('on-track')
    // Behind but recoverable: needs no more than double the current rate.
    expect(goalProgress(4000, 10_000, sep, midSep).state).toBe('behind')
    // At risk: would need more than double.
    expect(goalProgress(1000, 10_000, sep, midSep).state).toBe('at-risk')
  })

  it('treats no progress at all as at risk, not behind', () => {
    expect(goalProgress(0, 10_000, sep, midSep).state).toBe('at-risk')
  })

  it('reports a missed target once the period has ended', () => {
    const p = goalProgress(4000, 10_000, sep, at(2026, 10, 3))
    expect(p.state).toBe('missed')
    expect(p.neededPerDay).toBeNull()
  })

  it('still reports met for a period that ended on target', () => {
    expect(goalProgress(10_000, 10_000, sep, at(2026, 10, 3)).state).toBe('met')
  })

  it('states the rate still needed and the rate achieved', () => {
    const p = goalProgress(4000, 10_000, sep, midSep)
    expect(p.remaining).toBe(6000)
    expect(p.daysLeft).toBe(16)
    expect(p.neededPerDay).toBeCloseTo(6000 / 16, 5)
    expect(p.achievedPerDay).toBeCloseTo(4000 / 15, 5)
  })

  it('never reports a negative remainder', () => {
    expect(goalProgress(20_000, 10_000, sep, midSep).remaining).toBe(0)
  })

  it('has a label and classes for every state it can return', () => {
    const states: GoalState[] = ['no-target', 'met', 'on-track', 'behind', 'at-risk', 'missed']
    for (const s of states) {
      expect(GOAL_STATE_STYLES[s].label).toBeTruthy()
      expect(GOAL_STATE_STYLES[s].textClass).toBeTruthy()
      expect(GOAL_STATE_STYLES[s].barClass).toBeTruthy()
    }
  })

  it('uses no colour without a light-mode rule for the state text', () => {
    const css = readFileSync('src/index.css', 'utf8')
    for (const style of Object.values(GOAL_STATE_STYLES)) {
      if (style.textClass.startsWith('text-gray-')) continue   // greys are var-backed
      expect(css, style.textClass).toContain(`html.light-mode .${style.textClass}`)
    }
  })
})

/** parseFloat(raw.replace(/[^0-9.]/g,'')) || 0 accepted a lot it shouldn't. */
describe('parseTarget', () => {
  it('reads a plain number', () => {
    expect(parseTarget('50000')).toBe(50_000)
    expect(parseTarget('1500.5')).toBe(1500.5)
  })

  it('strips currency punctuation', () => {
    expect(parseTarget('$50,000')).toBe(50_000)
  })

  it('returns null for a cleared field rather than zero', () => {
    // Zero is a real target; "" is the absence of one, and the old parser
    // collapsed both to 0.
    expect(parseTarget('')).toBeNull()
    expect(parseTarget('   ')).toBeNull()
    expect(parseTarget('abc')).toBeNull()
  })

  it('rejects a malformed number instead of silently truncating it', () => {
    // parseFloat('1.5.5') was 1.5.
    expect(parseTarget('1.5.5')).toBeNull()
  })

  it('rejects a negative rather than dropping the sign', () => {
    // The old regex stripped '-', turning -500 into 500.
    expect(parseTarget('-500')).toBeNull()
  })

  it('accepts zero as a deliberate target', () => {
    expect(parseTarget('0')).toBe(0)
  })
})

describe('goalsDirty', () => {
  const saved = { revenue: 1000, leads: 10, customers: 5 }

  it('is false when nothing changed', () => {
    expect(goalsDirty({ ...saved }, saved)).toBe(false)
  })

  it('notices a change to any field', () => {
    expect(goalsDirty({ ...saved, revenue: 1001 }, saved)).toBe(true)
    expect(goalsDirty({ ...saved, leads: 0 }, saved)).toBe(true)
    expect(goalsDirty({ ...saved, customers: 6 }, saved)).toBe(true)
  })
})

describe('GOAL_FIELDS', () => {
  it('describes all three tracked figures once', () => {
    expect(GOAL_FIELDS.map(f => f.key)).toEqual(['revenue', 'leads', 'customers'])
  })

  it('marks exactly the money one as money', () => {
    expect(GOAL_FIELDS.filter(f => f.money).map(f => f.key)).toEqual(['revenue'])
  })

  it('names an icon that exists, rather than an emoji', () => {
    const icons = readFileSync('src/components/Icon.tsx', 'utf8')
    for (const f of GOAL_FIELDS) {
      expect(f.icon).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u)
      expect(icons).toContain(`  ${f.icon}:`)
    }
  })
})

/**
 * Targets moved from three flat fields to a map keyed by period instance.
 * Documents written before that change still carry the flat shape, and
 * /dashboard reads only `doc.month` — so resolving the current instance with
 * a fallback to the legacy field is what makes the change non-breaking.
 */
describe('resolveGoalTargets', () => {
  const NOW = at(2026, 9, 17)
  const MONTH_KEY = periodKey('month', NOW)     // '2026-09'
  const QTR_KEY   = periodKey('quarter', NOW)   // '2026-Q3'
  const YEAR_KEY  = periodKey('year', NOW)      // '2026'
  const vals = (revenue: number, leads = 0, customers = 0) => ({ revenue, leads, customers })

  it('reads the current instance out of periods', () => {
    const r = resolveGoalTargets({
      periods: { [MONTH_KEY]: vals(50_000, 30, 10), [QTR_KEY]: vals(150_000), [YEAR_KEY]: vals(600_000) },
    }, NOW)
    expect(r.month).toEqual(vals(50_000, 30, 10))
    expect(r.quarter.revenue).toBe(150_000)
    expect(r.year.revenue).toBe(600_000)
  })

  it('falls back to a legacy flat field when the instance has no entry', () => {
    const r = resolveGoalTargets({
      month: vals(40_000, 20, 8), quarter: vals(120_000), year: vals(500_000),
    }, NOW)
    expect(r.month).toEqual(vals(40_000, 20, 8))
    expect(r.quarter.revenue).toBe(120_000)
    expect(r.year.revenue).toBe(500_000)
  })

  it('prefers the instance entry over the legacy field', () => {
    const r = resolveGoalTargets({ month: vals(40_000), periods: { [MONTH_KEY]: vals(99_000) } }, NOW)
    expect(r.month.revenue).toBe(99_000)
  })

  it('keeps a past instance readable, which is the point of the change', () => {
    const r = resolveGoalTargets({ periods: { '2026-08': vals(31_000), [MONTH_KEY]: vals(50_000) } }, NOW)
    expect(r.periods['2026-08']).toEqual(vals(31_000))
    expect(r.month.revenue).toBe(50_000)
  })

  it('never reads a legacy field as some other period instance', () => {
    // Treating last month's target as this month's is the bug being fixed.
    const r = resolveGoalTargets({ month: vals(40_000) }, NOW)
    expect(r.periods['2026-08']).toBeUndefined()
  })

  it('returns zeroes for an empty document', () => {
    const r = resolveGoalTargets({}, NOW)
    expect(r.month).toEqual(vals(0))
    expect(r.periods).toEqual({})
  })

  it('survives malformed values rather than throwing', () => {
    const r = resolveGoalTargets({
      month: 'nonsense',
      periods: { [MONTH_KEY]: { revenue: 'lots', leads: null, customers: 3 }, bad: 7 },
    }, NOW)
    expect(r.month).toEqual(vals(0, 0, 3))
    expect(r.periods['bad']).toEqual(vals(0))
  })

  it('resolves against the clock it is given, not the wall clock', () => {
    const r = resolveGoalTargets(
      { periods: { '2025-01': vals(11_000), [MONTH_KEY]: vals(50_000) } },
      at(2025, 1, 15),
    )
    expect(r.month.revenue).toBe(11_000)
  })
})
