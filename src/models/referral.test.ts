import { describe, it, expect } from 'vitest'
import {
  buildLeaderboard, customersById, findDuplicateReferrals, matchesReferralQuery,
  referralAmountDrift, referralFormError, referralTotals, referredIsMissing,
  resolveReferralName, searchReferralCandidates,
  REFERRAL_SORTS,
  type Referral, type ReferralSort,
} from './referral'
import { emptyCustomer, type CustomerItem } from './customer'

const DAY = 86_400_000
// Pinned: reading Date.now() per call makes two "same" timestamps differ by
// a few milliseconds, which is enough to fail an equality assertion.
const NOW = Date.now()
const daysAgo = (n: number) => new Date(NOW - n * DAY)

function cust(over: Partial<CustomerItem> = {}): CustomerItem {
  return { ...emptyCustomer(), id: 'c1', first: 'Jane', lastname: 'Doe', ...over }
}

function ref(over: Partial<Referral> = {}): Referral {
  return {
    id: 'r1', companyId: 'co1',
    referrerId: 'a', referrerName: 'Ann Referrer',
    referredId: 'b', referredName: 'Bob Referred',
    referredAmount: 1000, notes: '',
    createdAt: daysAgo(1),
    ...over,
  }
}

/**
 * referrerName/referredName are snapshots taken at log time, so renaming a
 * customer left every referral showing the old name — and the leaderboard took
 * its name from whichever document it happened to iterate first.
 */
describe('resolveReferralName', () => {
  const byId = customersById([cust({ id: 'a', first: 'Anna', lastname: 'Newname' })])

  it('prefers the customer’s current name over the stored snapshot', () => {
    expect(resolveReferralName('a', 'Ann Oldname', byId)).toBe('Anna Newname')
  })

  it('falls back to the snapshot when the customer is gone', () => {
    expect(resolveReferralName('zz', 'Ann Oldname', byId)).toBe('Ann Oldname')
  })

  it('falls back when the live record has no usable name', () => {
    const blank = customersById([cust({ id: 'a', first: '  ', lastname: '' })])
    expect(resolveReferralName('a', 'Ann Oldname', blank)).toBe('Ann Oldname')
  })

  it('never renders an empty label', () => {
    expect(resolveReferralName('zz', '   ', new Map())).toBe('Unknown')
  })
})

describe('referredIsMissing', () => {
  const byId = customersById([cust({ id: 'b' })])

  it('is false while the referred customer exists', () => {
    expect(referredIsMissing(ref({ referredId: 'b' }), byId)).toBe(false)
  })

  it('is true once their record is gone', () => {
    expect(referredIsMissing(ref({ referredId: 'deleted' }), byId)).toBe(true)
  })

  it('is false for a referral with no referred id at all', () => {
    expect(referredIsMissing(ref({ referredId: '' }), byId)).toBe(false)
  })
})

/**
 * referredAmount is frozen at log time while /customers shows the live value,
 * so the two pages disagreed about the same deal with nothing saying why.
 */
describe('referralAmountDrift', () => {
  it('reports both figures when the deal has since changed', () => {
    const byId = customersById([cust({ id: 'b', amount: 15_000 })])
    expect(referralAmountDrift(ref({ referredAmount: 12_000 }), byId))
      .toEqual({ recorded: 12_000, current: 15_000 })
  })

  it('says nothing when they agree', () => {
    const byId = customersById([cust({ id: 'b', amount: 12_000 })])
    expect(referralAmountDrift(ref({ referredAmount: 12_000 }), byId)).toBeNull()
  })

  it('says nothing when there is no customer to compare against', () => {
    expect(referralAmountDrift(ref(), new Map())).toBeNull()
  })

  it('reports a deal that has since been zeroed', () => {
    const byId = customersById([cust({ id: 'b', amount: 0 })])
    expect(referralAmountDrift(ref({ referredAmount: 5000 }), byId))
      .toEqual({ recorded: 5000, current: 0 })
  })
})

/**
 * addReferral was a bare addDoc, so the same pair could be logged repeatedly —
 * each duplicate adding the full auto-filled deal value to that referrer's
 * leaderboard revenue.
 */
describe('findDuplicateReferrals', () => {
  const existing = [
    ref({ id: 'old', referrerId: 'a', referredId: 'b', createdAt: daysAgo(10) }),
    ref({ id: 'new', referrerId: 'a', referredId: 'b', createdAt: daysAgo(2) }),
    ref({ id: 'other', referrerId: 'a', referredId: 'c' }),
  ]

  it('finds every referral for the same pair, most recent first', () => {
    expect(findDuplicateReferrals(existing, 'a', 'b').map(r => r.id)).toEqual(['new', 'old'])
  })

  it('is empty for a pair never logged', () => {
    expect(findDuplicateReferrals(existing, 'a', 'zz')).toEqual([])
  })

  it('does not treat the reverse direction as a duplicate', () => {
    // Bob referring Ann is a different event from Ann referring Bob.
    expect(findDuplicateReferrals(existing, 'b', 'a')).toEqual([])
  })

  it('is empty when either side is unset', () => {
    expect(findDuplicateReferrals(existing, '', 'b')).toEqual([])
    expect(findDuplicateReferrals(existing, 'a', '')).toEqual([])
  })
})

describe('referralFormError', () => {
  it('passes a complete pair', () => {
    expect(referralFormError('a', 'b', '')).toBeNull()
    expect(referralFormError('a', 'b', '1500')).toBeNull()
  })

  it('names each missing side', () => {
    expect(referralFormError('', 'b', '')).toMatch(/sent the referral/i)
    expect(referralFormError('a', '', '')).toMatch(/they referred/i)
  })

  it('rejects a self-referral', () => {
    expect(referralFormError('a', 'a', '')).toMatch(/refer themselves/i)
  })

  it('rejects a malformed amount', () => {
    expect(referralFormError('a', 'b', 'lots')).toMatch(/valid number/i)
    expect(referralFormError('a', 'b', '-500')).toMatch(/valid number/i)
  })

  it('accepts a blank amount, since a referral need not carry one', () => {
    expect(referralFormError('a', 'b', '   ')).toBeNull()
  })
})

describe('buildLeaderboard', () => {
  const byId = customersById([
    cust({ id: 'a', first: 'Ann', lastname: 'A' }),
    cust({ id: 'b', first: 'Bob', lastname: 'B' }),
  ])
  const referrals = [
    ref({ id: '1', referrerId: 'a', referredAmount: 1000, createdAt: daysAgo(5) }),
    ref({ id: '2', referrerId: 'a', referredAmount: 3000, createdAt: daysAgo(1) }),
    ref({ id: '3', referrerId: 'b', referredAmount: 5000, createdAt: daysAgo(9) }),
  ]

  it('aggregates count and revenue per referrer', () => {
    const rows = buildLeaderboard(referrals, 'count', byId)
    const ann = rows.find(r => r.id === 'a')!
    expect(ann.count).toBe(2)
    expect(ann.revenue).toBe(4000)
    expect(ann.entries.map(e => e.id)).toEqual(['2', '1'])   // newest first
  })

  it('uses the current name, not the one stored on the first document', () => {
    const rows = buildLeaderboard(
      [ref({ referrerId: 'a', referrerName: 'Ann Oldname' })],
      'count',
      byId,
    )
    expect(rows[0].name).toBe('Ann A')
  })

  it('tracks the most recent referral per referrer', () => {
    const ann = buildLeaderboard(referrals, 'count', byId).find(r => r.id === 'a')!
    expect(ann.lastAt.getTime()).toBe(daysAgo(1).getTime())
  })

  it('sorts by revenue, count and recency', () => {
    const ids = (s: ReferralSort) => buildLeaderboard(referrals, s, byId).map(r => r.id)
    expect(ids('revenue')).toEqual(['b', 'a'])   // 5000 vs 4000
    expect(ids('count')).toEqual(['a', 'b'])     // 2 vs 1
    expect(ids('recent')).toEqual(['a', 'b'])    // 1d vs 9d
  })

  it('breaks ties deterministically by name', () => {
    const tied = [
      ref({ id: 'x', referrerId: 'b', referredAmount: 100, createdAt: daysAgo(3) }),
      ref({ id: 'y', referrerId: 'a', referredAmount: 100, createdAt: daysAgo(3) }),
    ]
    expect(buildLeaderboard(tied, 'revenue', byId).map(r => r.id)).toEqual(['a', 'b'])
  })

  it('is empty for no referrals', () => {
    expect(buildLeaderboard([], 'revenue', byId)).toEqual([])
  })

  it('works with no customer list, falling back to stored names', () => {
    const rows = buildLeaderboard([ref({ referrerName: 'Snapshot Name' })], 'revenue')
    expect(rows[0].name).toBe('Snapshot Name')
  })

  it('offers a label for every sort it supports', () => {
    expect(REFERRAL_SORTS.map(s => s.key)).toEqual(['revenue', 'count', 'recent'])
    for (const s of REFERRAL_SORTS) expect(s.label).toBeTruthy()
  })
})

describe('referralTotals', () => {
  const referrals = [
    ref({ id: '1', referrerId: 'a', referredAmount: 1000 }),
    ref({ id: '2', referrerId: 'a', referredAmount: 0 }),
    ref({ id: '3', referrerId: 'b', referredAmount: 5000 }),
  ]

  it('counts referrals, distinct referrers and revenue', () => {
    expect(referralTotals(referrals)).toEqual({
      referrals: 3, referrers: 2, revenue: 6000, withoutAmount: 1,
    })
  })

  it('reports how many carry no amount, so the revenue figure can be honest', () => {
    expect(referralTotals([ref({ referredAmount: 0 })]).withoutAmount).toBe(1)
  })

  it('is all zeroes for an empty list', () => {
    expect(referralTotals([])).toEqual({ referrals: 0, referrers: 0, revenue: 0, withoutAmount: 0 })
  })

  it('agrees with the leaderboard on referrer count and revenue', () => {
    const t = referralTotals(referrals)
    const rows = buildLeaderboard(referrals, 'revenue')
    expect(rows).toHaveLength(t.referrers)
    expect(rows.reduce((s, r) => s + r.revenue, 0)).toBe(t.revenue)
  })
})

/** The picker searched fullName only, so two same-named people were identical. */
describe('matchesReferralQuery', () => {
  const c = cust({ first: 'Ann', lastname: 'Brown', email: 'ann@acme.com', city: 'Delray', phone: '(555) 123-4567' })

  it('matches name, email and city', () => {
    for (const q of ['ann', 'brown', 'acme', 'delray']) {
      expect(matchesReferralQuery(c, q)).toBe(true)
    }
  })

  it('matches a phone however it is punctuated', () => {
    for (const q of ['5551234567', '555 123', '(555) 123-4567']) {
      expect(matchesReferralQuery(c, q)).toBe(true)
    }
  })

  it('ignores a one- or two-digit query rather than matching on it', () => {
    expect(matchesReferralQuery(cust({ phone: '555-0000' }), '5')).toBe(false)
  })

  it('matches everything for a blank query', () => {
    expect(matchesReferralQuery(c, '   ')).toBe(true)
  })

  it('does not match an unrelated query', () => {
    expect(matchesReferralQuery(c, 'zzz')).toBe(false)
  })
})

describe('searchReferralCandidates', () => {
  const customers = Array.from({ length: 25 }, (_, i) =>
    cust({ id: `c${i}`, first: 'Person', lastname: String(i) }))

  it('caps the list but reports the true total', () => {
    // The dropdown sliced to 10 and said nothing about the rest.
    const { matches, total } = searchReferralCandidates(customers, '', undefined, 10)
    expect(matches).toHaveLength(10)
    expect(total).toBe(25)
  })

  it('excludes the customer already chosen on the other side', () => {
    const { matches, total } = searchReferralCandidates(customers, '', 'c0', 10)
    expect(matches.some(c => c.id === 'c0')).toBe(false)
    expect(total).toBe(24)
  })

  it('narrows on the query', () => {
    const { total } = searchReferralCandidates(customers, 'Person 7', undefined, 10)
    expect(total).toBe(1)
  })

  it('is empty and safe with no candidates', () => {
    expect(searchReferralCandidates([], 'anything', undefined, 10))
      .toEqual({ matches: [], total: 0 })
  })
})
