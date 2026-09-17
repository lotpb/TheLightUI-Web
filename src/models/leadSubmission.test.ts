import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import type { LeadSubmission } from './leadForm'
import { STATUS_COLORS, STATUS_LABELS } from './leadForm'
import {
  describeSubmissionFilter, filterSubmissions, findExistingMatch, isSubmissionFilter,
  matchesSubmissionFilter, searchSubmissions, settingsDirty, sortSubmissions,
  submissionCounts, SUBMISSION_FILTERS, SUBMISSION_SORTS,
  type FormSettingsDraft, type SubmissionSort,
} from './leadSubmission'

const NOW = new Date(2026, 8, 16, 12, 0, 0)
const minsAgo = (n: number) => new Date(NOW.getTime() - n * 60_000)

function sub(over: Partial<LeadSubmission> = {}): LeadSubmission {
  return {
    id: 's1',
    companyId: 'co1',
    first: 'Jane',
    lastname: 'Doe',
    phone: '(555) 123-4567',
    email: 'jane@example.com',
    street: '1 Main St',
    city: 'Boca Raton',
    state: 'FL',
    zip: '33431',
    message: 'Need a roof quote',
    submittedAt: minsAgo(5),
    status: 'new',
    ...over,
  }
}

/**
 * 'spam' is written by the onLeadSubmission trigger. If the client model
 * doesn't carry it, a flagged submission renders with an undefined label and
 * no pill colour.
 */
describe('spam status parity with the trigger', () => {
  const src = readFileSync('functions/src/alerts.ts', 'utf8')

  it('the trigger writes a status the client model knows', () => {
    const m = src.match(/snap\.ref\.update\(\{ status: '(\w+)' \}\)/)
    expect(m).not.toBeNull()
    expect(Object.keys(STATUS_LABELS)).toContain(m![1])
  })

  it('every status has a label and a colour', () => {
    for (const key of Object.keys(STATUS_LABELS)) {
      expect(STATUS_LABELS[key as keyof typeof STATUS_LABELS]).toBeTruthy()
      expect(STATUS_COLORS[key as keyof typeof STATUS_COLORS]).toBeTruthy()
    }
  })

  it('offers a filter for every status', () => {
    const filters = SUBMISSION_FILTERS.map(f => f.key)
    for (const key of Object.keys(STATUS_LABELS)) expect(filters).toContain(key)
  })
})

describe('matchesSubmissionFilter', () => {
  it('passes everything for all', () => {
    expect(matchesSubmissionFilter(sub({ status: 'spam' }), 'all')).toBe(true)
  })

  it('narrows to one status', () => {
    expect(matchesSubmissionFilter(sub({ status: 'new' }), 'new')).toBe(true)
    expect(matchesSubmissionFilter(sub({ status: 'new' }), 'converted')).toBe(false)
    expect(matchesSubmissionFilter(sub({ status: 'spam' }), 'spam')).toBe(true)
  })
})

describe('searchSubmissions', () => {
  const items = [
    sub({ id: 'a', first: 'Ann', lastname: 'Brown', email: 'ann@acme.com', message: 'gutters please', city: 'Delray', phone: '(555) 999-8888' }),
    sub({ id: 'b', first: 'Bob', lastname: 'Smith', email: 'bob@x.com',   message: 'roof leak',      city: 'Boca',   phone: '(555) 123-4567' }),
  ]

  it('matches name, email, message and city', () => {
    expect(searchSubmissions(items, 'brown').map(s => s.id)).toEqual(['a'])
    expect(searchSubmissions(items, 'acme').map(s => s.id)).toEqual(['a'])
    expect(searchSubmissions(items, 'leak').map(s => s.id)).toEqual(['b'])
    expect(searchSubmissions(items, 'boca').map(s => s.id)).toEqual(['b'])
  })

  it('matches a phone however the searcher punctuates it', () => {
    for (const q of ['5551234567', '555 123', '(555) 123-4567', '123-4567']) {
      expect(searchSubmissions(items, q).map(s => s.id)).toEqual(['b'])
    }
  })

  it('ignores a one- or two-digit query rather than matching everything', () => {
    expect(searchSubmissions(items, '5')).toHaveLength(0)
  })

  it('returns everything for a blank query', () => {
    expect(searchSubmissions(items, '  ')).toHaveLength(2)
  })
})

describe('sortSubmissions', () => {
  const a = sub({ id: 'a', first: 'Zoe', submittedAt: minsAgo(60) })
  const b = sub({ id: 'b', first: 'Ann', submittedAt: minsAgo(5) })
  const c = sub({ id: 'c', first: 'Mia', submittedAt: minsAgo(30) })
  const items = [a, b, c]
  const ids = (k: SubmissionSort) => sortSubmissions(items, k).map(s => s.id)

  it('sorts newest and oldest', () => {
    expect(ids('newest')).toEqual(['b', 'c', 'a'])
    expect(ids('oldest')).toEqual(['a', 'c', 'b'])
  })

  it('sorts by name', () => {
    expect(ids('name')).toEqual(['b', 'c', 'a'])
  })

  it('breaks ties on newest', () => {
    const x = sub({ id: 'x', first: 'Same', submittedAt: minsAgo(9) })
    const y = sub({ id: 'y', first: 'Same', submittedAt: minsAgo(1) })
    expect(sortSubmissions([x, y], 'name').map(s => s.id)).toEqual(['y', 'x'])
  })

  it('does not reorder the array it was given', () => {
    const input = [a, b, c]
    sortSubmissions(input, 'name')
    expect(input.map(s => s.id)).toEqual(['a', 'b', 'c'])
  })

  it('offers every key it can sort by', () => {
    expect(SUBMISSION_SORTS.map(s => s.key).sort()).toEqual(['name', 'newest', 'oldest'])
  })
})

describe('filterSubmissions', () => {
  it('applies filter, search and sort together', () => {
    const items = [
      sub({ id: 'a', status: 'new', first: 'Ann', message: 'roof', submittedAt: minsAgo(60) }),
      sub({ id: 'b', status: 'new', first: 'Bob', message: 'roof', submittedAt: minsAgo(5) }),
      sub({ id: 'c', status: 'spam', first: 'Cal', message: 'roof' }),
    ]
    expect(filterSubmissions(items, 'new', 'roof', 'newest').map(s => s.id)).toEqual(['b', 'a'])
    expect(filterSubmissions(items, 'spam', 'roof', 'newest').map(s => s.id)).toEqual(['c'])
  })
})

describe('submissionCounts', () => {
  const items = [
    sub({ id: 'a', status: 'new' }),
    sub({ id: 'b', status: 'new' }),
    sub({ id: 'c', status: 'contacted' }),
    sub({ id: 'd', status: 'converted' }),
    sub({ id: 'e', status: 'spam' }),
  ]

  it('counts every tab', () => {
    expect(submissionCounts(items)).toEqual({ all: 5, new: 2, contacted: 1, converted: 1, spam: 1 })
  })

  it('keeps the statuses adding up to the total', () => {
    const c = submissionCounts(items)
    expect(c.new + c.contacted + c.converted + c.spam).toBe(c.all)
  })

  it('is all zeroes for an empty list', () => {
    expect(submissionCounts([])).toEqual({ all: 0, new: 0, contacted: 0, converted: 0, spam: 0 })
  })

  it('ignores a status the model does not know rather than crashing', () => {
    const odd = [{ ...sub(), status: 'archived' as LeadSubmission['status'] }]
    expect(submissionCounts(odd)).toEqual({ all: 1, new: 0, contacted: 0, converted: 0, spam: 0 })
  })
})

/**
 * handleConvert called createCustomer unconditionally, so the same person
 * submitting twice produced two leads — in an app with a /duplicates page.
 */
describe('findExistingMatch', () => {
  const customers = [
    { id: 'c1', email: 'jane@example.com', phone: '555-123-4567' },
    { id: 'c2', email: 'bob@x.com',        phone: '(555) 999-0000' },
  ]

  it('matches on email, case- and space-insensitively', () => {
    expect(findExistingMatch({ email: ' JANE@example.com ', phone: '' }, customers)?.id).toBe('c1')
  })

  it('matches on the last ten digits of the phone when the email differs', () => {
    expect(findExistingMatch({ email: 'new@address.com', phone: '+1 (555) 999-0000' }, customers)?.id).toBe('c2')
  })

  it('prefers the email match over the phone match', () => {
    const both = [
      { id: 'byPhone', email: 'other@x.com', phone: '555-123-4567' },
      { id: 'byEmail', email: 'jane@example.com', phone: '555-000-0000' },
    ]
    expect(findExistingMatch({ email: 'jane@example.com', phone: '555-123-4567' }, both)?.id).toBe('byEmail')
  })

  it('is null for a genuinely new person', () => {
    expect(findExistingMatch({ email: 'nobody@x.com', phone: '555-000-1111' }, customers)).toBeNull()
  })

  it('does not match on a blank email or a short phone', () => {
    const withBlanks = [{ id: 'blank', email: '', phone: '' }]
    expect(findExistingMatch({ email: '', phone: '' }, withBlanks)).toBeNull()
    expect(findExistingMatch({ email: '', phone: '123' }, withBlanks)).toBeNull()
  })
})

describe('settingsDirty', () => {
  const base: FormSettingsDraft = {
    businessName: 'Acme', title: 'Contact Us', subtitle: 'Sub', thankYouMessage: 'Thanks',
    showPhone: true, showAddress: false, showMessage: true, enabled: true,
  }

  it('is false when nothing has changed', () => {
    expect(settingsDirty(base, { ...base })).toBe(false)
  })

  it('notices a text edit and a toggle', () => {
    expect(settingsDirty({ ...base, title: 'Get a Quote' }, base)).toBe(true)
    expect(settingsDirty({ ...base, enabled: false }, base)).toBe(true)
    expect(settingsDirty({ ...base, showAddress: true }, base)).toBe(true)
  })

  it('is false before the saved settings have loaded', () => {
    // Otherwise the page would claim unsaved changes on first paint.
    expect(settingsDirty(base, null)).toBe(false)
  })
})

describe('isSubmissionFilter and describeSubmissionFilter', () => {
  it('rejects a hand-edited URL value', () => {
    for (const f of SUBMISSION_FILTERS) expect(isSubmissionFilter(f.key)).toBe(true)
    expect(isSubmissionFilter('archived')).toBe(false)
    expect(isSubmissionFilter(null)).toBe(false)
  })

  it('names the filter and the search', () => {
    expect(describeSubmissionFilter('spam', '')).toBe('Flagged')
    expect(describeSubmissionFilter('new', 'roof')).toBe('New · matching “roof”')
  })
})
