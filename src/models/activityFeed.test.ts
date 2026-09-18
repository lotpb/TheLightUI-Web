import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import {
  buildFeedRows, filterFeed, fmtTimeOfDay, groupFeedByDay, matchesActivityQuery,
  searchedRows, timeAgo, typeCounts,
} from './activityFeed'
import { ACTIVITY_TYPES, type Activity, type ActivityType } from './activity'
import { emptyCustomer, type CustomerItem } from './customer'
import { dayHeading, groupByDay, localDayKey } from '../utils/dayGroups'

const at = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m - 1, d, h, min)

function act(over: Partial<Activity> = {}): Activity {
  return {
    id: 'a1', customerId: 'c1', companyId: 'co1',
    type: 'call', note: 'Left a voicemail', userId: 'u1', userName: 'Ann Admin',
    createdAt: at(2026, 9, 18, 10),
    ...over,
  }
}

function custMap(...cs: Partial<CustomerItem>[]): Map<string, CustomerItem> {
  const m = new Map<string, CustomerItem>()
  for (const c of cs) {
    const full = { ...emptyCustomer(), id: 'c1', first: 'Jane', lastname: 'Doe', ...c }
    m.set(full.id, full)
  }
  return m
}

/**
 * The page rendered the literal string 'Unknown' for a customer it couldn't
 * find — indistinguishable from a customer actually called Unknown, and still
 * wrapped in a link to a record that may not exist.
 */
describe('buildFeedRows', () => {
  it('resolves the customer name', () => {
    const [row] = buildFeedRows([act()], custMap({ id: 'c1', first: 'Jane', lastname: 'Doe' }))
    expect(row.customerName).toBe('Jane Doe')
    expect(row.customerMissing).toBe(false)
  })

  it('marks a customer it cannot find, rather than naming them Unknown', () => {
    const [row] = buildFeedRows([act({ customerId: 'gone' })], custMap())
    expect(row.customerMissing).toBe(true)
    expect(row.customerName).toBeNull()
  })

  it('handles a customer record with no name', () => {
    const [row] = buildFeedRows([act()], custMap({ id: 'c1', first: '  ', lastname: '' }))
    expect(row.customerMissing).toBe(false)
    expect(row.customerName).toBe('Unnamed record')
  })

  it('labels every known activity type', () => {
    for (const t of ACTIVITY_TYPES) {
      const [row] = buildFeedRows([act({ type: t.value })], custMap({ id: 'c1' }))
      expect(row.typeLabel).toBe(t.label)
    }
  })

  /** Was `?? ACTIVITY_TYPES[4]` — a magic index that displayed "Note". */
  it('reports an unrecognised type as unknown instead of guessing "Note"', () => {
    const [row] = buildFeedRows(
      [act({ type: 'carrierPigeon' as unknown as ActivityType })],
      custMap({ id: 'c1' }),
    )
    expect(row.typeLabel).toBeNull()
  })

  it('does not reorder or drop activities', () => {
    const rows = buildFeedRows([act({ id: '1' }), act({ id: '2' })], custMap({ id: 'c1' }))
    expect(rows.map(r => r.id)).toEqual(['1', '2'])
  })
})

describe('filtering and search', () => {
  const rows = buildFeedRows([
    act({ id: '1', type: 'call',  note: 'Left a voicemail', userName: 'Ann' }),
    act({ id: '2', type: 'email', note: 'Sent the quote',   userName: 'Bob', customerId: 'c2' }),
    act({ id: '3', type: 'call',  note: 'Spoke to spouse',  userName: 'Ann', customerId: 'c2' }),
  ], custMap({ id: 'c1', first: 'Jane', lastname: 'Doe' }, { id: 'c2', first: 'Acme', lastname: 'Roofing' }))

  const ids = (f: Parameters<typeof filterFeed>[1], q = '') => filterFeed(rows, f, q).map(r => r.id)

  it('filters by type', () => {
    expect(ids('call')).toEqual(['1', '3'])
    expect(ids('email')).toEqual(['2'])
    expect(ids('all')).toEqual(['1', '2', '3'])
  })

  it('searches customer, note, rep and type label', () => {
    expect(ids('all', 'acme')).toEqual(['2', '3'])
    expect(ids('all', 'voicemail')).toEqual(['1'])
    expect(ids('all', 'bob')).toEqual(['2'])
    // Not 'email' as the probe: "Left a voicemail" contains that substring,
    // so the search is right and the obvious assertion is the wrong one.
    expect(ids('all', 'quote')).toEqual(['2'])
    expect(ids('all', 'Sent')).toEqual(['2'])
  })

  it('combines a type filter with a search', () => {
    expect(ids('call', 'acme')).toEqual(['3'])
  })

  it('is case-insensitive and ignores surrounding space', () => {
    expect(matchesActivityQuery(rows[0], '  VOICEMAIL ')).toBe(true)
  })

  it('returns everything for a blank query', () => {
    expect(ids('all', '   ')).toEqual(['1', '2', '3'])
  })

  it('searches a row whose customer is missing without crashing', () => {
    const orphan = buildFeedRows([act({ id: 'x', customerId: 'gone', note: 'orphan note' })], custMap())
    expect(matchesActivityQuery(orphan[0], 'orphan')).toBe(true)
    expect(matchesActivityQuery(orphan[0], 'jane')).toBe(false)
  })
})

/**
 * typeCounts read from the unfiltered list, so typing a search narrowed the
 * rows while every chip kept showing its original count.
 */
describe('typeCounts follow the search', () => {
  const rows = buildFeedRows([
    act({ id: '1', type: 'call',  note: 'about the roof' }),
    act({ id: '2', type: 'call',  note: 'about the gutter' }),
    act({ id: '3', type: 'email', note: 'about the roof' }),
  ], custMap({ id: 'c1' }))

  it('counts every type with no search', () => {
    expect(typeCounts(searchedRows(rows, ''))).toEqual({ call: 2, email: 1 })
  })

  it('recounts once a search narrows the feed', () => {
    expect(typeCounts(searchedRows(rows, 'roof'))).toEqual({ call: 1, email: 1 })
  })

  it('drops a type entirely when nothing matches', () => {
    expect(typeCounts(searchedRows(rows, 'gutter'))).toEqual({ call: 1 })
  })

  it('is empty for no rows', () => {
    expect(typeCounts([])).toEqual({})
  })

  it('agrees with what the list will render', () => {
    const counts = typeCounts(searchedRows(rows, 'roof'))
    for (const type of Object.keys(counts) as ActivityType[]) {
      expect(filterFeed(rows, type, 'roof')).toHaveLength(counts[type])
    }
  })
})

/**
 * dayLabel collapsed everything older than a week into month buckets
 * ("September 2026"), so a quarter of history became three useful headings
 * followed by groups holding thousands of rows.
 */
describe('day grouping', () => {
  const now = at(2026, 9, 18, 15)

  it('names today and yesterday', () => {
    expect(dayHeading(at(2026, 9, 18, 9), now)).toBe('Today')
    expect(dayHeading(at(2026, 9, 17, 9), now)).toBe('Yesterday')
  })

  it('gives every older day its own heading, not a month bucket', () => {
    const a = dayHeading(at(2026, 9, 3), now)
    const b = dayHeading(at(2026, 9, 12), now)
    expect(a).not.toBe(b)
    expect(a).toMatch(/Sep 3/)
    expect(b).toMatch(/Sep 12/)
    expect(a).not.toMatch(/September 2026/)
  })

  it('adds the year only when it differs', () => {
    expect(dayHeading(at(2026, 2, 3), now)).not.toMatch(/2026/)
    expect(dayHeading(at(2025, 2, 3), now)).toMatch(/2025/)
  })

  it('buckets a newest-first feed contiguously', () => {
    const rows = buildFeedRows([
      act({ id: 'a', createdAt: at(2026, 9, 18, 14) }),
      act({ id: 'b', createdAt: at(2026, 9, 18, 9) }),
      act({ id: 'c', createdAt: at(2026, 9, 12, 16) }),
    ], custMap({ id: 'c1' }))
    const groups = groupFeedByDay(rows, now)
    expect(groups.map(g => g.label)).toEqual(['Today', 'Sep 12'].map((_, i) => groups[i].label))
    expect(groups).toHaveLength(2)
    expect(groups[0].items.map(r => r.id)).toEqual(['a', 'b'])
    expect(groups[1].items.map(r => r.id)).toEqual(['c'])
  })

  it('keeps every item', () => {
    const rows = buildFeedRows(
      Array.from({ length: 9 }, (_, i) => act({ id: `e${i}`, createdAt: at(2026, 9, 18 - i, 10) })),
      custMap({ id: 'c1' }),
    )
    expect(groupFeedByDay(rows, now).reduce((n, g) => n + g.items.length, 0)).toBe(9)
  })

  it('separates two different days that would render the same label', () => {
    // Keyed on the calendar date, not the rendered string — a Map keyed on the
    // label would merge Sep 3 2025 and Sep 3 2026 if both formatted alike.
    const groups = groupByDay(
      [{ d: at(2026, 9, 3) }, { d: at(2025, 9, 3) }],
      x => x.d, now,
    )
    expect(groups).toHaveLength(2)
    expect(groups[0].key).not.toBe(groups[1].key)
  })

  it('produces a stable local day key', () => {
    expect(localDayKey(at(2026, 1, 5))).toBe('2026-01-05')
  })

  it('is empty for an empty feed', () => {
    expect(groupFeedByDay([], now)).toEqual([])
  })
})

describe('timeAgo', () => {
  const now = at(2026, 9, 18, 12)

  it('steps through the units', () => {
    expect(timeAgo(new Date(now.getTime() - 20_000), now)).toBe('Just now')
    expect(timeAgo(at(2026, 9, 18, 11, 59), now)).toBe('1m ago')
    expect(timeAgo(new Date(now.getTime() - 5 * 60_000), now)).toBe('5m ago')
    expect(timeAgo(new Date(now.getTime() - 3 * 3_600_000), now)).toBe('3h ago')
    expect(timeAgo(new Date(now.getTime() - 3 * 86_400_000), now)).toBe('3d ago')
  })

  it('falls back to a date beyond a week', () => {
    expect(timeAgo(at(2026, 8, 1), now)).toMatch(/Aug 1, 2026/)
  })

  it('never reports a negative age from clock skew', () => {
    // serverTimestamp can land marginally ahead of the client clock.
    expect(timeAgo(new Date(now.getTime() + 30_000), now)).toBe('Just now')
  })

  it('shows time of day without the date, since the day is in the heading', () => {
    expect(fmtTimeOfDay(at(2026, 9, 18, 14, 5))).toMatch(/2:05/)
    expect(fmtTimeOfDay(at(2026, 9, 18, 14, 5))).not.toMatch(/Sep/)
  })
})

/**
 * limit(5000) with no orderBy returns an arbitrary 5,000 documents in
 * document-ID order, which the page then sorted client-side — so the feed read
 * as "most recent" while being a random slice.
 */
describe('the feed query is ordered and paged', () => {
  const service = readFileSync('src/services/activityService.ts', 'utf8')

  it('orders by createdAt in the query, not after the fact', () => {
    // The orderBy lives in the feedQuery helper both the live listener and the
    // pager share, so scoping the assertion to the subscribe function misses it.
    expect(service).toContain("orderBy('createdAt', 'desc')")
    expect(service).toContain('function feedQuery')
    // And the page no longer needs to sort what the query already ordered.
    const page = readFileSync('src/pages/activity/ActivityFeedPage.tsx', 'utf8')
    expect(page).not.toContain('.sort((a, b) => b.createdAt')
  })

  it('pages rather than capping at a fixed ceiling', () => {
    expect(service).toContain('startAfter')
    expect(service).toContain('loadOlderActivities')
  })

  it('has the composite index the ordered query needs', () => {
    const indexes = JSON.parse(readFileSync('firestore.indexes.json', 'utf8'))
    const match = indexes.indexes.find((i: { collectionGroup: string; fields: { fieldPath: string }[] }) =>
      i.collectionGroup === 'Activities' &&
      i.fields.map(f => f.fieldPath).join(',') === 'companyId,createdAt')
    expect(match, 'Activities (companyId, createdAt) index is missing').toBeTruthy()
  })
})
