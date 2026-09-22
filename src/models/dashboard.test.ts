import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import {
  ACTIVITY_TINT, MONEY_BASIS, MONEY_LABELS, PERIOD_PHRASE, PERIOD_SUFFIX, PERIOD_TABS,
  PERIOD_TITLE, SCOPE_NOTE, SCOPE_SUFFIX, SNAPSHOT_PERIODS, UPCOMING_WINDOW_DAYS,
  appointmentsOnDay, dashboardRange, goalPeriodFor, goalsForPeriod, stageCountsOf,
  topPerformerIn, upcomingAppointments,
} from './dashboard'
import { emptyCustomer, type CustomerItem } from './customer'
import { ACTIVITY_TYPES } from './activity'
import { currentPeriodRange, type GoalDoc } from './goal'
import { UNASSIGNED } from './leaderboard'

const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h)

function cust(over: Partial<CustomerItem> = {}): CustomerItem {
  return { ...emptyCustomer(), id: 'c1', category: 'Customer', isActive: true, ...over }
}

function goalDoc(over: Partial<GoalDoc> = {}): GoalDoc {
  return {
    companyId: 'co1',
    month:   { revenue: 0, leads: 0, customers: 0 },
    quarter: { revenue: 0, leads: 0, customers: 0 },
    year:    { revenue: 0, leads: 0, customers: 0 },
    periods: {},
    ...over,
  } as GoalDoc
}

// ── Period labels ─────────────────────────────────────────────────────────────

describe('period label maps', () => {
  it('covers every period in all four phrasings', () => {
    for (const p of SNAPSHOT_PERIODS) {
      for (const map of [PERIOD_TABS, PERIOD_SUFFIX, PERIOD_PHRASE, PERIOD_TITLE]) {
        expect(map[p], `${p} missing a label`).toBeTruthy()
      }
    }
  })

  it('has exactly the three periods the snapshot service supports', () => {
    expect(SNAPSHOT_PERIODS).toEqual(['today', 'month', 'year'])
  })
})

// ── dashboardRange ────────────────────────────────────────────────────────────

describe('dashboardRange', () => {
  const now = at(2026, 9, 21, 15)

  it('bounds today to the local calendar day', () => {
    const r = dashboardRange('today', now)
    expect(r.start).toEqual(new Date(2026, 8, 21, 0, 0, 0, 0))
    expect(r.end).toEqual(new Date(2026, 8, 21, 23, 59, 59, 999))
    expect(r.short).toBe('Today')
    expect(r.label).toMatch(/September 21/)
  })

  it('includes an activity logged a minute before midnight', () => {
    const r = dashboardRange('today', now)
    const late = new Date(2026, 8, 21, 23, 59)
    expect(late >= r.start && late <= r.end).toBe(true)
  })

  it('delegates month and year to the shared period maths', () => {
    for (const p of ['month', 'year'] as const) {
      const mine = dashboardRange(p, now)
      const theirs = currentPeriodRange(p, now)
      expect(mine.start).toEqual(theirs.start)
      expect(mine.end).toEqual(theirs.end)
      expect(mine.key).toBe(theirs.key)
    }
  })

  it('produces a distinct key per period', () => {
    const keys = SNAPSHOT_PERIODS.map(p => dashboardRange(p, now).key)
    expect(new Set(keys).size).toBe(3)
  })
})

// ── Goals follow the tabs ─────────────────────────────────────────────────────

/**
 * The card read `goals.month` on every tab, so selecting Year left the target
 * and the actuals on the month — even though resolveGoalTargets had already
 * resolved a year target from the same document.
 */
describe('goalsForPeriod', () => {
  const now = at(2026, 9, 21)

  it('maps the Year tab onto the year target', () => {
    expect(goalPeriodFor('year')).toBe('year')
  })

  it('maps Today onto the month, since there are no daily targets', () => {
    expect(goalPeriodFor('today')).toBe('month')
    expect(goalPeriodFor('month')).toBe('month')
  })

  it('reads the year target on the Year tab, not the month target', () => {
    const goals = goalDoc({
      month: { revenue: 10_000, leads: 5, customers: 2 },
      year:  { revenue: 120_000, leads: 60, customers: 24 },
    })
    expect(goalsForPeriod(goals, [], 'year', now).target.revenue).toBe(120_000)
    expect(goalsForPeriod(goals, [], 'month', now).target.revenue).toBe(10_000)
  })

  it('counts actuals over the matching range', () => {
    const customers = [
      cust({ id: 'a', amount: 1_000, creationDate: at(2026, 9, 3) }),  // this month & year
      cust({ id: 'b', amount: 2_000, creationDate: at(2026, 3, 3) }),  // this year only
      cust({ id: 'c', amount: 4_000, creationDate: at(2025, 3, 3) }),  // neither
    ]
    expect(goalsForPeriod(null, customers, 'month', now).actual.revenue).toBe(1_000)
    expect(goalsForPeriod(null, customers, 'year',  now).actual.revenue).toBe(3_000)
  })

  it('reports no targets when the document is missing', () => {
    expect(goalsForPeriod(null, [], 'month', now).hasTargets).toBe(false)
  })

  it('reports no targets when every target is zero', () => {
    expect(goalsForPeriod(goalDoc(), [], 'month', now).hasTargets).toBe(false)
  })

  it('counts a single non-zero target as having targets', () => {
    const goals = goalDoc({ month: { revenue: 0, leads: 3, customers: 0 } })
    expect(goalsForPeriod(goals, [], 'month', now).hasTargets).toBe(true)
  })

  it('names the period it is reporting on', () => {
    expect(goalsForPeriod(null, [], 'year', now).range.label).toBe('2026')
    expect(goalsForPeriod(null, [], 'today', now).range.label).toMatch(/September 2026/)
  })
})

// ── Top performer ─────────────────────────────────────────────────────────────

/**
 * The inline version grouped by `c.salesman.trim() || 'Unassigned'` and took
 * the highest revenue, so a company that doesn't fill in the salesman field
 * saw "Unassigned" holding the trophy.
 */
describe('topPerformerIn', () => {
  const range = { start: at(2026, 9, 1), end: at(2026, 9, 30, 23) }

  it('ranks the highest earner in the range', () => {
    const top = topPerformerIn([
      cust({ id: 'a', salesman: 'Ann', amount: 5_000, creationDate: at(2026, 9, 4) }),
      cust({ id: 'b', salesman: 'Bob', amount: 9_000, creationDate: at(2026, 9, 5) }),
    ], range)
    expect(top?.name).toBe('Bob')
    expect(top?.revenue).toBe(9_000)
  })

  it('never awards the trophy to unassigned records', () => {
    const top = topPerformerIn([
      cust({ id: 'a', salesman: '',    amount: 50_000, creationDate: at(2026, 9, 4) }),
      cust({ id: 'b', salesman: 'Bob', amount: 1_000,  creationDate: at(2026, 9, 5) }),
    ], range)
    expect(top?.name).toBe('Bob')
    expect(top?.name).not.toBe(UNASSIGNED)
  })

  it('excludes records outside the range', () => {
    const top = topPerformerIn([
      cust({ id: 'a', salesman: 'Ann', amount: 5_000, creationDate: at(2026, 9, 4) }),
      cust({ id: 'b', salesman: 'Bob', amount: 9_000, creationDate: at(2026, 8, 30) }),
    ], range)
    expect(top?.name).toBe('Ann')
  })

  it('counts sales as well as revenue', () => {
    const top = topPerformerIn([
      cust({ id: 'a', salesman: 'Ann', amount: 1_000, creationDate: at(2026, 9, 4) }),
      cust({ id: 'b', salesman: 'Ann', amount: 2_000, creationDate: at(2026, 9, 5) }),
    ], range)
    expect(top?.customers).toBe(2)
    expect(top?.revenue).toBe(3_000)
  })

  it('does not credit leads as revenue', () => {
    const top = topPerformerIn([
      cust({ id: 'a', salesman: 'Ann', amount: 9_000, category: 'Lead', creationDate: at(2026, 9, 4) }),
    ], range)
    expect(top?.revenue).toBe(0)
    expect(top?.leads).toBe(1)
  })

  it('is null with nothing in range', () => {
    expect(topPerformerIn([], range)).toBeNull()
  })

  it('survives a record with no creation date', () => {
    expect(() => topPerformerIn(
      [cust({ creationDate: undefined as unknown as Date })], range,
    )).not.toThrow()
  })
})

// ── Appointments ──────────────────────────────────────────────────────────────

describe('appointmentsOnDay', () => {
  const now = at(2026, 9, 21, 15)

  it('takes appointments inside today only', () => {
    const items = appointmentsOnDay([
      cust({ id: 'a', startDate: at(2026, 9, 21, 9) }),
      cust({ id: 'b', startDate: at(2026, 9, 22, 9) }),
      cust({ id: 'c', startDate: at(2026, 9, 20, 9) }),
    ], now)
    expect(items.map(c => c.id)).toEqual(['a'])
  })

  it('includes an appointment at midnight and excludes the next midnight', () => {
    const items = appointmentsOnDay([
      cust({ id: 'start', startDate: new Date(2026, 8, 21, 0, 0, 0, 0) }),
      cust({ id: 'next',  startDate: new Date(2026, 8, 22, 0, 0, 0, 0) }),
    ], now)
    expect(items.map(c => c.id)).toEqual(['start'])
  })

  it('skips inactive records and records with no date', () => {
    const items = appointmentsOnDay([
      cust({ id: 'off', isActive: false, startDate: at(2026, 9, 21, 9) }),
      cust({ id: 'none', startDate: undefined }),
    ], now)
    expect(items).toEqual([])
  })
})

describe('upcomingAppointments', () => {
  const now = at(2026, 9, 21, 15)

  it('starts after today and runs a week', () => {
    const items = upcomingAppointments([
      cust({ id: 'today',  startDate: at(2026, 9, 21, 18) }),
      cust({ id: 'soon',   startDate: at(2026, 9, 23, 9) }),
      cust({ id: 'edge',   startDate: at(2026, 9, 28, 9) }),
      cust({ id: 'beyond', startDate: at(2026, 10, 5, 9) }),
    ], now)
    expect(items.map(c => c.id)).toEqual(['soon', 'edge'])
  })

  it('sorts soonest first', () => {
    const items = upcomingAppointments([
      cust({ id: 'later',   startDate: at(2026, 9, 25, 9) }),
      cust({ id: 'sooner',  startDate: at(2026, 9, 22, 9) }),
    ], now)
    expect(items.map(c => c.id)).toEqual(['sooner', 'later'])
  })

  it('does not double-count what appointmentsOnDay already showed', () => {
    const todays = cust({ id: 'today', startDate: at(2026, 9, 21, 18) })
    expect(appointmentsOnDay([todays], now).map(c => c.id)).toEqual(['today'])
    expect(upcomingAppointments([todays], now)).toEqual([])
  })

  it('states its window in a constant the heading can render', () => {
    expect(UPCOMING_WINDOW_DAYS).toBe(7)
  })
})

// ── Stage counts ──────────────────────────────────────────────────────────────

describe('stageCountsOf', () => {
  const ids = ['new', 'won']
  const stageOf = (c: CustomerItem) => (c.category === 'Customer' ? 'won' : 'new')

  it('zero-fills every stage so the legend has a number', () => {
    expect(stageCountsOf([], stageOf, ids)).toEqual({ new: 0, won: 0 })
  })

  it('counts leads and customers only', () => {
    const counts = stageCountsOf([
      cust({ id: 'a', category: 'Customer' }),
      cust({ id: 'b', category: 'Lead' }),
      cust({ id: 'c', category: 'Vendor' }),
      cust({ id: 'd', category: 'Employee' }),
    ], stageOf, ids)
    expect(counts).toEqual({ new: 1, won: 1 })
  })

  it('is case-insensitive about the category, like the rest of the app', () => {
    const counts = stageCountsOf([cust({ category: 'customer' })], stageOf, ids)
    expect(counts.won + counts.new).toBe(1)
  })

  it('tolerates a stage id outside the configured list', () => {
    const counts = stageCountsOf([cust({ category: 'Lead' })], () => 'ghost', ids)
    expect(counts.ghost).toBe(1)
    expect(counts.new).toBe(0)
  })

  it('totals to the number of sales records', () => {
    const items = [cust({ id: 'a' }), cust({ id: 'b', category: 'Lead' }), cust({ id: 'c', category: 'Vendor' })]
    const counts = stageCountsOf(items, stageOf, ids)
    expect(Object.values(counts).reduce((s, n) => s + n, 0)).toBe(2)
  })
})

// ── Scope declarations ────────────────────────────────────────────────────────

describe('block scope', () => {
  it('explains every scope', () => {
    for (const k of ['period', 'now', 'allTime'] as const) {
      expect(SCOPE_NOTE[k]).toBeTruthy()
      expect(SCOPE_SUFFIX[k]).toBeDefined()
    }
  })

  it('adds no suffix for period-scoped cards, since the tab already says it', () => {
    expect(SCOPE_SUFFIX.period).toBe('')
    expect(SCOPE_SUFFIX.now).toBeTruthy()
    expect(SCOPE_SUFFIX.allTime).toBeTruthy()
  })
})

// ── Money bases ───────────────────────────────────────────────────────────────

describe('money labels name the measurement', () => {
  it('describes each basis distinctly', () => {
    const notes = Object.values(MONEY_BASIS)
    expect(new Set(notes).size).toBe(notes.length)
    for (const n of notes) expect(n.length).toBeGreaterThan(20)
  })

  it('does not label two different measurements "Sales"', () => {
    const labels = Object.values(MONEY_LABELS)
    expect(new Set(labels).size).toBe(labels.length)
    expect(labels).not.toContain('Sales')
    expect(labels).not.toContain('Total Sales')
  })
})

// ── Activity tints ────────────────────────────────────────────────────────────

describe('ACTIVITY_TINT', () => {
  const css = readFileSync('src/index.css', 'utf8')

  it('tints every activity type', () => {
    for (const t of ACTIVITY_TYPES) {
      expect(ACTIVITY_TINT[t.value], `${t.value} has no tint`).toBeTruthy()
    }
  })

  it('only uses hues with a light-mode rule', () => {
    // Bare 400-level accents resolve to a pale value on a white card unless
    // index.css overrides them; text-gray-400 is var-backed and needs none.
    for (const cls of new Set(Object.values(ACTIVITY_TINT))) {
      if (cls === 'text-gray-400') continue
      expect(css, `${cls} has no light-mode rule`).toContain(`html.light-mode .${cls}`)
    }
  })
})

// ── The page uses these, and stops reaching for what they replaced ────────────

describe('DashboardPage wiring', () => {
  // Comments quote the classes and expressions being removed, so the source
  // has to be stripped of them before asserting — the same trap that made
  // four of these assertions pass on their own explanatory comment.
  const raw = readFileSync('src/pages/DashboardPage.tsx', 'utf8')
  const page = raw
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .split('\n').filter(l => !l.trim().startsWith('//')).join('\n')

  it('has no bg-gray-800 left to sit invisibly on a bg-gray-800 card', () => {
    expect(page).not.toContain('bg-gray-800')
  })

  it('uses the measured track class for every proportion bar', () => {
    expect(page.match(/meter-track/g)?.length).toBeGreaterThanOrEqual(4)
  })

  it('no longer prints timestamps at text-gray-700', () => {
    expect(page).not.toContain('text-gray-700')
  })

  it('drops the ACTIVITY_TYPES[4] magic-index label fallback', () => {
    expect(page).not.toContain('ACTIVITY_TYPES[4]')
    expect(page).not.toContain('ACTIVITY_TYPES.find')
  })

  it('sends overdue follow-ups to the page built for them', () => {
    expect(page).toContain("to: '/followups'")
    expect(page).not.toContain("label: 'overdue follow-up', to: '/customers'")
  })

  it('keeps one money formatter, so a total reads the same in both places', () => {
    expect(page).not.toContain('function fmtCompact')
    expect(page.match(/fmtMoneyCompact/g)?.length).toBeGreaterThanOrEqual(4)
  })

  it('has no second timeAgo or followUpLabel implementation', () => {
    expect(page).not.toContain('function timeAgo')
    expect(page).not.toContain('function followUpLabel')
  })

  it('escapes the one user-controlled value in the print HTML', () => {
    expect(page).toContain('esc(salesmanLabel)')
  })

  it('renders the tab panel the tabs claim to control', () => {
    expect(page).toContain('aria-controls="period-panel"')
    expect(page).toContain('role="tabpanel"')
  })

  it('writes the stat strip once rather than per breakpoint', () => {
    expect(page).not.toContain('hidden sm:grid')
    expect(page.match(/title="Leads"/g) ?? []).toHaveLength(0)
  })
})

describe('the follow-up window reaches past yesterday', () => {
  const service = readFileSync('src/services/customerService.ts', 'utf8')

  it('no longer bounds the query at yesterday midnight', () => {
    expect(service).toContain('FOLLOWUP_PAST_DAYS')
    expect(service).not.toContain('yesterday.setDate(yesterday.getDate() - 1)')
  })

  it('reaches back far enough to surface a real backlog', () => {
    const m = service.match(/FOLLOWUP_PAST_DAYS = (\d+)/)
    expect(Number(m?.[1])).toBeGreaterThanOrEqual(180)
  })
})

describe('the /10 tint step has a light-mode rule', () => {
  const css = readFileSync('src/index.css', 'utf8')

  it('covers the Needs Attention card', () => {
    expect(css).toContain('html.light-mode .bg-red-500\\/10.text-red-300')
    expect(css).toContain('html.light-mode .bg-red-500\\/10.text-red-200')
  })

  it('completes the family so the next /10 tint cannot fall through', () => {
    for (const hue of ['indigo', 'violet', 'blue', 'teal', 'green', 'amber', 'orange', 'rose']) {
      expect(css, `${hue}/10 is uncovered`).toContain(`html.light-mode .bg-${hue}-500\\/10.text-${hue}-300`)
    }
  })

  it('defines .meter-track in both themes', () => {
    expect(css).toContain('.meter-track')
    expect(css).toContain('html.light-mode .meter-track')
  })
})
