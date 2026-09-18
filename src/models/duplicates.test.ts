import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import {
  computeMergePlan, countByReason, describeRelated, filterPairs, findDuplicates,
  levenshtein, normalizeEmail, normalizeName, normalizePhone, totalRelated,
  COLLECTION_LABELS, DUPE_FILTERS, FUZZY_COMPARISON_BUDGET, REASON_BADGE, REASON_LABEL,
  type DupeReason,
} from './duplicates'
import { emptyCustomer, type CustomerItem } from './customer'

function cust(over: Partial<CustomerItem> = {}): CustomerItem {
  return { ...emptyCustomer(), id: 'c1', isActive: true, ...over }
}

const keyOf = (a: string, b: string) => [a, b].sort().join('|')

describe('normalizers', () => {
  it('reduces a phone to digits', () => {
    expect(normalizePhone('(555) 123-4567')).toBe('5551234567')
    expect(normalizePhone('+1 555.123.4567 x9')).toBe('155512345679')
  })

  it('lowercases and collapses a name', () => {
    expect(normalizeName({ first: '  John ', lastname: ' Smith  ' })).toBe('john smith')
    expect(normalizeName({ first: 'John', lastname: '' })).toBe('john')
  })

  it('lowercases and trims an email', () => {
    expect(normalizeEmail('  Jane@Example.COM ')).toBe('jane@example.com')
  })
})

describe('levenshtein', () => {
  it('is zero for identical strings', () => {
    expect(levenshtein('john smith', 'john smith')).toBe(0)
  })

  it('counts single-character edits', () => {
    expect(levenshtein('jonh', 'john')).toBe(2)   // transposition = 2 edits
    expect(levenshtein('john', 'jon')).toBe(1)
    expect(levenshtein('john', 'johns')).toBe(1)
  })

  it('falls back to length against an empty string', () => {
    expect(levenshtein('', 'abc')).toBe(3)
    expect(levenshtein('abc', '')).toBe(3)
  })
})

/**
 * Detection ran over every record the listener returned, including
 * deactivated ones — so the record a merge had just retired kept matching its
 * survivor forever, and only a local dismissal hid it.
 */
describe('findDuplicates excludes retired records', () => {
  const a = cust({ id: 'a', first: 'John', lastname: 'Smith', phone: '555-123-4567' })
  const b = cust({ id: 'b', first: 'John', lastname: 'Smith', phone: '555-123-4567' })

  it('pairs two active records sharing a phone', () => {
    const { pairs } = findDuplicates([a, b])
    expect(pairs.map(p => p.key)).toEqual([keyOf('a', 'b')])
  })

  it('drops the pair once one side is deactivated', () => {
    const { pairs } = findDuplicates([a, { ...b, isActive: false }])
    expect(pairs).toEqual([])
  })

  it('reports how many records it actually scanned', () => {
    const { scanned } = findDuplicates([a, b, cust({ id: 'z', isActive: false })])
    expect(scanned).toBe(2)
  })

  /**
   * The three-way case the old pair model got wrong: merging A into B left
   * A–C on screen offering to merge into a record that had just been retired.
   */
  it('resolves a three-way duplicate correctly after one merge', () => {
    const c = cust({ id: 'c', first: 'John', lastname: 'Smith', phone: '555-123-4567' })
    const before = findDuplicates([a, b, c]).pairs.map(p => p.key).sort()
    expect(before).toEqual([keyOf('a', 'b'), keyOf('a', 'c'), keyOf('b', 'c')].sort())

    // A merged into B, so A is retired.
    const after = findDuplicates([{ ...a, isActive: false }, b, c]).pairs.map(p => p.key)
    expect(after).toEqual([keyOf('b', 'c')])
  })
})

describe('findDuplicates reasons', () => {
  it('matches on a shared phone, ignoring formatting', () => {
    const { pairs } = findDuplicates([
      cust({ id: 'a', phone: '(555) 123-4567' }),
      cust({ id: 'b', phone: '555.123.4567' }),
    ])
    expect(pairs[0].reason).toBe<DupeReason>('phone')
    expect(pairs[0].matchValue).toBe('5551234567')
  })

  it('ignores a phone too short to be trustworthy', () => {
    expect(findDuplicates([
      cust({ id: 'a', phone: '12345' }),
      cust({ id: 'b', phone: '12345' }),
    ]).pairs).toEqual([])
  })

  it('matches on a shared email, case-insensitively', () => {
    const { pairs } = findDuplicates([
      cust({ id: 'a', email: 'Jane@Example.com' }),
      cust({ id: 'b', email: 'jane@example.com' }),
    ])
    expect(pairs[0].reason).toBe('email')
  })

  it('ignores a value that is not an email', () => {
    expect(findDuplicates([
      cust({ id: 'a', email: 'n/a' }),
      cust({ id: 'b', email: 'n/a' }),
    ]).pairs).toEqual([])
  })

  it('requires both name parts for an exact name match', () => {
    // Otherwise every record holding only a surname matches every other.
    expect(findDuplicates([
      cust({ id: 'a', first: '', lastname: 'Smith' }),
      cust({ id: 'b', first: '', lastname: 'Smith' }),
    ]).pairs).toEqual([])
  })

  it('catches a typo as a fuzzy name match', () => {
    const { pairs } = findDuplicates([
      cust({ id: 'a', first: 'Jonathan', lastname: 'Smith' }),
      cust({ id: 'b', first: 'Jonathon', lastname: 'Smith' }),
    ])
    expect(pairs[0].reason).toBe('fuzzy-name')
    expect(pairs[0].similarity).toBeGreaterThan(0.75)
  })

  it('does not fuzzy-match two genuinely different people', () => {
    expect(findDuplicates([
      cust({ id: 'a', first: 'Alice', lastname: 'Smith' }),
      cust({ id: 'b', first: 'Robert', lastname: 'Smithers' }),
    ]).pairs).toEqual([])
  })

  it('prefers an exact reason over a fuzzy one for the same pair', () => {
    const { pairs } = findDuplicates([
      cust({ id: 'a', first: 'Jonathan', lastname: 'Smith', phone: '555-123-4567' }),
      cust({ id: 'b', first: 'Jonathon', lastname: 'Smith', phone: '555-123-4567' }),
    ])
    expect(pairs).toHaveLength(1)
    expect(pairs[0].reason).toBe('phone')
  })

  it('reports one pair per couple, however many reasons apply', () => {
    const { pairs } = findDuplicates([
      cust({ id: 'a', first: 'John', lastname: 'Smith', phone: '555-123-4567', email: 'j@x.com' }),
      cust({ id: 'b', first: 'John', lastname: 'Smith', phone: '555-123-4567', email: 'j@x.com' }),
    ])
    expect(pairs).toHaveLength(1)
  })

  it('orders phone, then email, then name, then fuzzy', () => {
    const { pairs } = findDuplicates([
      cust({ id: 'p1', phone: '555-000-1111' }), cust({ id: 'p2', phone: '555-000-1111' }),
      cust({ id: 'e1', email: 'a@x.com' }),      cust({ id: 'e2', email: 'a@x.com' }),
      cust({ id: 'n1', first: 'Ann', lastname: 'Brown' }), cust({ id: 'n2', first: 'Ann', lastname: 'Brown' }),
    ])
    expect(pairs.map(p => p.reason)).toEqual(['phone', 'email', 'name'])
  })

  it('is stable regardless of input order', () => {
    const a = cust({ id: 'a', phone: '555-123-4567' })
    const b = cust({ id: 'b', phone: '555-123-4567' })
    expect(findDuplicates([a, b]).pairs[0].key).toBe(findDuplicates([b, a]).pairs[0].key)
  })

  it('is empty and safe for no records', () => {
    expect(findDuplicates([])).toEqual({ pairs: [], scanned: 0, fuzzyTruncated: false })
  })
})

/**
 * The fuzzy pass was blocked only by the first letter of the surname, so a
 * large block meant six figures of Levenshtein calls synchronously in render.
 */
describe('fuzzy pass stays bounded', () => {
  it('does not truncate on a realistic book', () => {
    const items = Array.from({ length: 400 }, (_, i) =>
      cust({ id: `c${i}`, first: `Person${i}`, lastname: 'Smith' }))
    const res = findDuplicates(items)
    expect(res.fuzzyTruncated).toBe(false)
  })

  it('reports truncation rather than freezing on a pathological block', () => {
    // 1,200 same-surname, same-length names: the length prefilter can't help,
    // so this is the worst case the budget exists for.
    const items = Array.from({ length: 1200 }, (_, i) =>
      cust({ id: `c${i}`, first: `Nm${String(i).padStart(5, '0')}`, lastname: 'Smithson' }))
    const res = findDuplicates(items)
    expect(res.fuzzyTruncated).toBe(true)
    expect(FUZZY_COMPARISON_BUDGET).toBeGreaterThan(0)
  })

  it('still finds exact matches when the fuzzy pass is truncated', () => {
    const items = [
      ...Array.from({ length: 1200 }, (_, i) =>
        cust({ id: `c${i}`, first: `Nm${String(i).padStart(5, '0')}`, lastname: 'Smithson' })),
      cust({ id: 'x1', phone: '555-777-8888' }),
      cust({ id: 'x2', phone: '555-777-8888' }),
    ]
    const res = findDuplicates(items)
    expect(res.pairs.some(p => p.key === keyOf('x1', 'x2'))).toBe(true)
  })

  it('completes a pathological block in reasonable time', () => {
    const items = Array.from({ length: 1200 }, (_, i) =>
      cust({ id: `c${i}`, first: `Nm${String(i).padStart(5, '0')}`, lastname: 'Smithson' }))
    const started = Date.now()
    findDuplicates(items)
    expect(Date.now() - started).toBeLessThan(5000)
  })
})

describe('filters and counts', () => {
  const pairs = findDuplicates([
    cust({ id: 'p1', phone: '555-000-1111' }), cust({ id: 'p2', phone: '555-000-1111' }),
    cust({ id: 'e1', email: 'a@x.com' }),      cust({ id: 'e2', email: 'a@x.com' }),
  ]).pairs

  it('counts each reason plus the total', () => {
    const c = countByReason(pairs)
    expect(c.all).toBe(2)
    expect(c.phone).toBe(1)
    expect(c.email).toBe(1)
    expect(c.name).toBe(0)
  })

  it('keeps the reason counts adding up to the total', () => {
    const c = countByReason(pairs)
    expect(c.phone + c.email + c.name + c['fuzzy-name']).toBe(c.all)
  })

  it('hides dismissed pairs and narrows by reason', () => {
    expect(filterPairs(pairs, new Set(), 'all')).toHaveLength(2)
    expect(filterPairs(pairs, new Set(), 'phone')).toHaveLength(1)
    expect(filterPairs(pairs, new Set([pairs[0].key]), 'all')).toHaveLength(1)
  })

  it('offers a filter for every reason', () => {
    expect(DUPE_FILTERS.map(f => f.id)).toEqual(['all', 'phone', 'email', 'name', 'fuzzy-name'])
    for (const f of DUPE_FILTERS) expect(f.label).toBeTruthy()
  })

  it('has a label and a badge for every reason', () => {
    for (const r of ['phone', 'email', 'name', 'fuzzy-name'] as DupeReason[]) {
      expect(REASON_LABEL[r]).toBeTruthy()
      expect(REASON_BADGE[r]).toBeTruthy()
    }
  })

  it('uses only badge combinations index.css covers in light mode', () => {
    const css = readFileSync('src/index.css', 'utf8')
    for (const cls of Object.values(REASON_BADGE)) {
      const sel = cls.split(' ').map(c => c.replace(/\//g, '\\/')).join('.')
      expect(css, cls).toContain(`.${sel}`)
    }
  })
})

describe('computeMergePlan', () => {
  const primary = cust({
    id: 'p', first: 'John', lastname: 'Smith',
    phone: '555-111-2222', email: '', city: 'Boca', amount: 0, comments: 'primary note',
    tags: ['vip'],
  })
  const secondary = cust({
    id: 's', first: 'John', lastname: 'Smith',
    phone: '555-999-0000', email: 'john@x.com', city: 'Delray', amount: 5000,
    comments: 'secondary note', tags: ['vip', 'referral'],
  })

  it('fills only the fields the primary is missing', () => {
    const { updates } = computeMergePlan(primary, secondary)
    expect(updates['email']).toBe('john@x.com')
    expect(updates['phone']).toBeUndefined()   // primary already has one
  })

  it('writes street to `street`, not the legacy `address` alias', () => {
    const { updates } = computeMergePlan(
      cust({ street: '' }), cust({ street: '1 Main St' }),
    )
    expect(updates['street']).toBe('1 Main St')
    expect(updates['address']).toBeUndefined()
  })

  it('reports what will be discarded, not just what flows in', () => {
    // The dialog only ever listed incoming values, so nothing said what the
    // secondary held that was about to be lost.
    const { discarded, updates } = computeMergePlan(primary, secondary)
    const phone = discarded.find(d => d.label === 'Phone')!
    expect(phone).toEqual({ label: 'Phone', keeping: '555-111-2222', losing: '555-999-0000' })
    expect(discarded.some(d => d.label === 'City')).toBe(true)
    // This primary has no amount, so 5000 flows in rather than being lost.
    expect(discarded.some(d => d.label === 'Amount')).toBe(false)
    expect(updates['amount']).toBe(5000)
  })

  it('discards a differing amount when the primary already has one', () => {
    const { discarded } = computeMergePlan(
      cust({ amount: 1000 }), cust({ amount: 5000 }),
    )
    expect(discarded).toContainEqual({ label: 'Amount', keeping: '$1,000', losing: '$5,000' })
  })

  it('does not report an identical value as discarded', () => {
    const { discarded } = computeMergePlan(cust({ city: 'Boca' }), cust({ city: 'boca' }))
    expect(discarded).toEqual([])
  })

  it('takes the amount only when the primary has none', () => {
    expect(computeMergePlan(cust({ amount: 0 }), cust({ amount: 500 })).updates['amount']).toBe(500)
    expect(computeMergePlan(cust({ amount: 100 }), cust({ amount: 500 })).updates['amount']).toBeUndefined()
  })

  it('combines comments when both have them', () => {
    const { updates, changes } = computeMergePlan(primary, secondary)
    expect(String(updates['comments'])).toContain('primary note')
    expect(String(updates['comments'])).toContain('secondary note')
    expect(changes.find(c => c.label === 'Comments')!.action).toBe('combine')
  })

  it('unions tags without duplicating', () => {
    expect(computeMergePlan(primary, secondary).updates['tags']).toEqual(['vip', 'referral'])
  })

  it('leaves tags alone when the secondary adds nothing', () => {
    expect(computeMergePlan(cust({ tags: ['a'] }), cust({ tags: ['a'] })).updates['tags']).toBeUndefined()
  })

  it('produces nothing for two identical records', () => {
    const same = cust({ id: 'x', phone: '555-111-2222' })
    const plan = computeMergePlan(same, { ...same, id: 'y' })
    expect(plan.changes).toEqual([])
    expect(plan.discarded).toEqual([])
    expect(plan.updates).toEqual({})
  })

  it('never writes a field the server will refuse', () => {
    const src = readFileSync('functions/src/customers.ts', 'utf8')
    const allowed = src.slice(src.indexOf('const MERGEABLE_FIELDS'))
    const { updates } = computeMergePlan(
      cust({ phone: '', email: '', street: '', city: '', amount: 0, comments: '', tags: [] }),
      cust({
        phone: '1', email: 'a@b.c', street: 's', city: 'c', state: 'st', zip: 'z',
        salesman: 'sm', adNo: 'ad', leadSource: 'ls', product: 'pr', contractor: 'co',
        job: 'jb', spouse: 'sp', birthDate: 'bd', driverLicense: 'dl',
        amount: 5, photo: 'ph', comments: 'cm', tags: ['t'],
      }),
    )
    for (const key of Object.keys(updates)) {
      expect(allowed, `server MERGEABLE_FIELDS is missing '${key}'`).toContain(`'${key}'`)
    }
  })
})

/**
 * The merge moves documents across sixteen collection/field pairs. A
 * collection missing from the server's list is silently left behind, so this
 * checks the list against the services that actually query by customer.
 */
describe('CUSTOMER_LINKED covers every customer-keyed collection', () => {
  const server = readFileSync('functions/src/customers.ts', 'utf8')
  const linked = server.slice(
    server.indexOf('CUSTOMER_LINKED'),
    server.indexOf('const BATCH_SIZE'),
  )

  const SERVICES_WITH_CUSTOMER_QUERIES = [
    ['invoiceService.ts', 'Invoices'],
    ['proposalService.ts', 'Proposals'],
    ['warrantyService.ts', 'Warranties'],
    ['servicePlanService.ts', 'ServicePlans'],
    ['serviceRequestService.ts', 'serviceRequests'],
    ['todoService.ts', 'ToDoItems'],
    ['documentService.ts', 'Documents'],
    ['dispatchService.ts', 'dispatchAssignments'],
    ['timeTrackingService.ts', 'timeEntries'],
    ['emailMessageService.ts', 'emailMessages'],
    ['smsMessageService.ts', 'smsMessages'],
    ['signingRequestService.ts', 'signingRequests'],
    ['sequenceService.ts', 'sequenceEnrollments'],
    ['campaignService.ts', 'campaignRecipients'],
    ['activityService.ts', 'Activities'],
  ] as const

  it.each(SERVICES_WITH_CUSTOMER_QUERIES)(
    '%s queries by customer, so %s must be repointed',
    (service, collection) => {
      const src = readFileSync(`src/services/${service}`, 'utf8')
      expect(src, `${service} no longer queries by customerId`).toContain("where('customerId'")
      expect(linked, `${collection} missing from CUSTOMER_LINKED`).toContain(`'${collection}'`)
    },
  )

  it('covers both sides of a referral', () => {
    const src = readFileSync('src/services/referralService.ts', 'utf8')
    expect(src).toContain("where('referrerId'")
    expect(src).toContain("where('referredId'")
    expect(linked).toContain("'referrerId'")
    expect(linked).toContain("'referredId'")
  })

  it('has a human label for every collection it moves', () => {
    for (const [, collection] of SERVICES_WITH_CUSTOMER_QUERIES) {
      expect(COLLECTION_LABELS[collection], collection).toBeTruthy()
    }
    expect(COLLECTION_LABELS['referrals']).toBeTruthy()
  })
})

describe('related-record counts', () => {
  it('totals across collections', () => {
    expect(totalRelated({ Invoices: 3, ToDoItems: 2 })).toBe(5)
    expect(totalRelated(undefined)).toBe(0)
    expect(totalRelated({})).toBe(0)
  })

  it('describes them biggest first, with human labels', () => {
    expect(describeRelated({ ToDoItems: 2, Invoices: 7, Activities: 0 })).toEqual([
      { label: 'Invoices', count: 7 },
      { label: 'Tasks', count: 2 },
    ])
  })

  it('is empty when nothing is attached', () => {
    expect(describeRelated({})).toEqual([])
    expect(describeRelated(undefined)).toEqual([])
  })
})
