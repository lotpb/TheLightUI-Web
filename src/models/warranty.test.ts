import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import {
  daysUntilExpiration, EXPIRY_WINDOW_DAYS, filterWarranties, fmtWarrantyDate,
  isExpired, isExpiringSoon, matchesWarrantyFilter, warrantyCounts,
  warrantyDateToInput, warrantyFormError, warrantyStatusOf, warrantyTermWarning,
  WARRANTY_FILTERS, WARRANTY_STATUS_COLORS, WARRANTY_STATUS_LABELS,
  type Warranty, type WarrantyFilter,
} from './warranty'

/** A date input's value becomes UTC midnight, which is what gets stored. */
const utc = (s: string) => new Date(`${s}T00:00:00Z`)

/** Today, as the page's own write path would store it. */
function todayUTC(offsetDays = 0): Date {
  const now = new Date()
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate() + offsetDays))
}

function warranty(over: Partial<Warranty> = {}): Warranty {
  return {
    id: 'w1', companyId: 'co1', customerId: 'c1', customerName: 'Jane Doe',
    title: '30yr Shingle', provider: 'GAF',
    startDate: utc('2020-01-01'), expirationDate: todayUTC(365),
    notes: '', isActive: true, lastReminderSentAt: null, createdAt: utc('2020-01-01'),
    ...over,
  }
}

/**
 * The defect this module exists for. Dates arrive as UTC midnight from a date
 * input; the page compared them against Date.now() and rendered them with a
 * bare toLocaleDateString(), so a warranty expiring 2026-09-17 displayed as
 * Sep 16 — and the edit form read it back with local getters, walking the
 * date one more day earlier on every save.
 */
describe('day-granular dates survive a round trip', () => {
  it('renders the day that was typed', () => {
    expect(fmtWarrantyDate(utc('2026-09-17'))).toBe('Sep 17, 2026')
    expect(fmtWarrantyDate(utc('2026-01-01'))).toBe('Jan 1, 2026')
    expect(fmtWarrantyDate(utc('2026-12-31'))).toBe('Dec 31, 2026')
  })

  it('puts the same day back into the date input', () => {
    expect(warrantyDateToInput(utc('2026-09-17'))).toBe('2026-09-17')
    expect(warrantyDateToInput(utc('2026-01-05'))).toBe('2026-01-05')
  })

  it('does not drift across repeated edit-and-save cycles', () => {
    let d = utc('2026-09-17')
    for (let i = 0; i < 5; i++) {
      const inForm = warrantyDateToInput(d)   // what the edit form shows
      d = new Date(`${inForm}T00:00:00Z`)      // what submitting it stores
    }
    expect(warrantyDateToInput(d)).toBe('2026-09-17')
    expect(fmtWarrantyDate(d)).toBe('Sep 17, 2026')
  })
})

describe('daysUntilExpiration', () => {
  it('is 0 on the expiration day itself, whatever the local clock reads', () => {
    expect(daysUntilExpiration({ expirationDate: todayUTC(0) })).toBe(0)
  })

  it('counts whole calendar days either side', () => {
    expect(daysUntilExpiration({ expirationDate: todayUTC(1) })).toBe(1)
    expect(daysUntilExpiration({ expirationDate: todayUTC(30) })).toBe(30)
    expect(daysUntilExpiration({ expirationDate: todayUTC(-1) })).toBe(-1)
  })
})

describe('isExpired / isExpiringSoon', () => {
  it('does not call a warranty expired on its expiration day', () => {
    expect(isExpired({ expirationDate: todayUTC(0) })).toBe(false)
    expect(isExpiringSoon({ expirationDate: todayUTC(0) })).toBe(true)
  })

  it('expires the day after', () => {
    expect(isExpired({ expirationDate: todayUTC(-1) })).toBe(true)
    expect(isExpiringSoon({ expirationDate: todayUTC(-1) })).toBe(false)
  })

  it('treats the window boundary inclusively', () => {
    expect(isExpiringSoon({ expirationDate: todayUTC(EXPIRY_WINDOW_DAYS) })).toBe(true)
    expect(isExpiringSoon({ expirationDate: todayUTC(EXPIRY_WINDOW_DAYS + 1) })).toBe(false)
  })
})

describe('warrantyStatusOf', () => {
  it('puts inactive ahead of every date question', () => {
    // An inactive warranty is inactive whether or not it has also expired.
    expect(warrantyStatusOf({ isActive: false, expirationDate: todayUTC(-500) })).toBe('inactive')
    expect(warrantyStatusOf({ isActive: false, expirationDate: todayUTC(500) })).toBe('inactive')
  })

  it('classifies the three active cases', () => {
    expect(warrantyStatusOf({ isActive: true, expirationDate: todayUTC(-1) })).toBe('expired')
    expect(warrantyStatusOf({ isActive: true, expirationDate: todayUTC(10) })).toBe('expiringSoon')
    expect(warrantyStatusOf({ isActive: true, expirationDate: todayUTC(400) })).toBe('active')
  })

  it('has a label and a colour for every status it can return', () => {
    for (const key of ['active', 'expiringSoon', 'expired', 'inactive'] as const) {
      expect(WARRANTY_STATUS_LABELS[key]).toBeTruthy()
      expect(WARRANTY_STATUS_COLORS[key]).toBeTruthy()
    }
  })
})

/**
 * The page defaulted to 'active', which excludes expiring-soon — so an
 * expiration tracker opened on the one view without the warranties that
 * needed action.
 */
describe('matchesWarrantyFilter', () => {
  const soon    = warranty({ id: 'soon',    expirationDate: todayUTC(10) })
  const later   = warranty({ id: 'later',   expirationDate: todayUTC(400) })
  const gone    = warranty({ id: 'gone',    expirationDate: todayUTC(-5) })
  const dormant = warranty({ id: 'dormant', isActive: false })
  const all = [soon, later, gone, dormant]
  const ids = (f: WarrantyFilter) => filterWarranties(all, f).map(w => w.id)

  it('open includes everything still in force, expiring ones included', () => {
    expect(ids('open')).toEqual(['soon', 'later'])
  })

  it('the status filters are exact', () => {
    expect(ids('active')).toEqual(['later'])
    expect(ids('expiringSoon')).toEqual(['soon'])
    expect(ids('expired')).toEqual(['gone'])
    expect(ids('inactive')).toEqual(['dormant'])
  })

  it('all means all', () => {
    expect(ids('all')).toHaveLength(4)
  })

  it('offers a filter for every status, plus open and all', () => {
    expect(WARRANTY_FILTERS.map(f => f.key)).toEqual(
      ['open', 'active', 'expiringSoon', 'expired', 'inactive', 'all'],
    )
    for (const f of WARRANTY_FILTERS) expect(f.label).toBeTruthy()
  })

  it('every filter key is one matchesWarrantyFilter understands', () => {
    for (const f of WARRANTY_FILTERS) {
      expect(() => matchesWarrantyFilter(soon, f.key)).not.toThrow()
    }
  })
})

describe('warrantyCounts', () => {
  const items = [
    warranty({ expirationDate: todayUTC(400) }),
    warranty({ expirationDate: todayUTC(10) }),
    warranty({ expirationDate: todayUTC(-5) }),
    warranty({ isActive: false }),
  ]

  it('counts each status and the open superset', () => {
    expect(warrantyCounts(items)).toEqual({
      open: 2, active: 1, expiringSoon: 1, expired: 1, inactive: 1, all: 4,
    })
  })

  it('keeps the four statuses adding up to the total', () => {
    const c = warrantyCounts(items)
    expect(c.active + c.expiringSoon + c.expired + c.inactive).toBe(c.all)
  })

  it('makes open the sum of active and expiring soon', () => {
    const c = warrantyCounts(items)
    expect(c.open).toBe(c.active + c.expiringSoon)
  })

  it('is all zeroes for an empty list', () => {
    expect(warrantyCounts([])).toEqual({ open: 0, active: 0, expiringSoon: 0, expired: 0, inactive: 0, all: 0 })
  })
})

describe('warrantyFormError', () => {
  const ok = { customerId: 'c1', title: '30yr Shingle', startDate: '2026-01-01', expirationDate: '2056-01-01' }

  it('passes a complete form', () => {
    expect(warrantyFormError(ok)).toBeNull()
  })

  it('names each missing piece', () => {
    expect(warrantyFormError({ ...ok, customerId: '' })).toMatch(/customer/i)
    expect(warrantyFormError({ ...ok, title: '   ' })).toMatch(/title/i)
    expect(warrantyFormError({ ...ok, startDate: '' })).toMatch(/start/i)
    expect(warrantyFormError({ ...ok, expirationDate: '' })).toMatch(/expiration/i)
  })

  it('rejects coverage that ends before it starts', () => {
    // Saved happily before, then rendered as Expired with a future start date.
    expect(warrantyFormError({ ...ok, startDate: '2026-06-01', expirationDate: '2026-01-01' }))
      .toMatch(/end before it starts/i)
  })

  it('rejects a zero-length term', () => {
    expect(warrantyFormError({ ...ok, startDate: '2026-06-01', expirationDate: '2026-06-01' }))
      .toMatch(/same day/i)
  })

  it('compares the dates as days, not as local instants', () => {
    // One day apart is valid however the viewer's clock is offset.
    expect(warrantyFormError({ ...ok, startDate: '2026-06-01', expirationDate: '2026-06-02' })).toBeNull()
  })
})

describe('warrantyTermWarning', () => {
  it('is silent on an ordinary term', () => {
    expect(warrantyTermWarning({ startDate: '2026-01-01', expirationDate: '2056-01-01' })).toBeNull()
  })

  it('flags a mistyped century', () => {
    expect(warrantyTermWarning({ startDate: '2026-01-01', expirationDate: '2126-01-01' })).toMatch(/year term/)
  })

  it('flags a suspiciously short term', () => {
    expect(warrantyTermWarning({ startDate: '2026-01-01', expirationDate: '2026-01-03' })).toMatch(/under a week/)
  })

  it('stays quiet where warrantyFormError already objects', () => {
    expect(warrantyTermWarning({ startDate: '2026-06-01', expirationDate: '2026-01-01' })).toBeNull()
    expect(warrantyTermWarning({ startDate: '', expirationDate: '2026-01-01' })).toBeNull()
  })
})

/**
 * "Expiring Soon" on the page is a promise about when the customer gets an
 * email. If the page's window and the scheduled function's window drift
 * apart, the page labels a warranty as expiring soon that nothing mails, or
 * mails one it hasn't flagged.
 */
describe('reminder window parity with the scheduled function', () => {
  const src = readFileSync('functions/src/alerts.ts', 'utf8')

  it('uses the same number of days as warrantyExpirationReminders', () => {
    const m = src.match(/const in30Days = Timestamp\.fromMillis\(now\.toMillis\(\) \+ (\d+) \* 24 \* 60 \* 60 \* 1000\)/)
    expect(m).not.toBeNull()
    expect(Number(m![1])).toBe(EXPIRY_WINDOW_DAYS)
  })

  it('formats the expiry date in the email in UTC, so it matches the page', () => {
    // Without an explicit timeZone the function renders in its runtime zone
    // and the page in the viewer's, so the two can disagree by a day about
    // the same warranty — in a message the customer reads.
    const emailDate = src.slice(src.indexOf('const expDate'), src.indexOf('const subject'))
    expect(emailDate).toContain("timeZone: 'UTC'")
  })
})

/**
 * WARRANTY_STATUS_COLORS carries the exact class triples index.css keys its
 * light-mode overrides on. The green one was missing, leaving Active at
 * 4.22:1 on the white card while Expired and Expiring Soon sat at 21:1.
 */
describe('light-mode coverage for every status badge', () => {
  const css = readFileSync('src/index.css', 'utf8')

  function escapeForCss(cls: string): string {
    return cls.split(' ').map(c => c.replace(/\//g, '\\/')).join('.')
  }

  it('has a light-mode rule for all four badges', () => {
    for (const [status, cls] of Object.entries(WARRANTY_STATUS_COLORS)) {
      if (status === 'inactive') continue // greys are remapped by the theme vars
      expect(css, `${status} badge (${cls})`).toContain(`.${escapeForCss(cls)}`)
    }
  })
})
