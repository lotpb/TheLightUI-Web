import { describe, it, expect } from 'vitest'
import {
  financingStatusMeta, financingSummary, sortFinancingApplications, financingSourceLink,
  type FinancingApplication,
} from './financingApplication'

function app(over: Partial<FinancingApplication> = {}): FinancingApplication {
  return {
    id: 'a1',
    sourceType: 'proposal',
    sourceId: 'p1',
    customerName: 'Jane Doe',
    amount: 1000,
    status: 'created',
    applyUrl: 'https://provider.example/apply/abc',
    createdAt: new Date(2026, 5, 15),
    updatedAt: new Date(2026, 5, 15),
    ...over,
  }
}

describe('financingStatusMeta', () => {
  it('maps the statuses the provider is expected to send', () => {
    expect(financingStatusMeta('approved').group).toBe('won')
    expect(financingStatusMeta('funded').group).toBe('won')
    expect(financingStatusMeta('declined').group).toBe('lost')
    expect(financingStatusMeta('expired').group).toBe('lost')
    expect(financingStatusMeta('created').group).toBe('open')
    expect(financingStatusMeta('pending').group).toBe('open')
  })

  it('is case- and whitespace-insensitive', () => {
    expect(financingStatusMeta('  APPROVED ').label).toBe('Approved')
    expect(financingStatusMeta('Funded').group).toBe('won')
  })

  it('keeps an unmapped status visible instead of blanking the cell', () => {
    // The webhook passes body.status straight through, so this is not a
    // closed set — a provider adding a state must not render as empty.
    const m = financingStatusMeta('under_review')
    expect(m.label).toBe('Under Review')
    expect(m.classes).not.toBe('')
  })

  it('counts an unknown status as open, never as won or lost', () => {
    // Guessing either way would put provider money into a total on the
    // strength of a string nobody has seen.
    expect(financingStatusMeta('something-new').group).toBe('open')
  })

  it('handles an empty status', () => {
    expect(financingStatusMeta('').label).toBe('Unknown')
    expect(financingStatusMeta('   ').label).toBe('Unknown')
  })
})

describe('financingSummary', () => {
  const apps = [
    app({ id: 'o1', status: 'created',  amount: 5000 }),
    app({ id: 'o2', status: 'pending',  amount: 3000 }),
    app({ id: 'w1', status: 'approved', amount: 8000 }),
    app({ id: 'w2', status: 'funded',   amount: 12000 }),
    app({ id: 'l1', status: 'declined', amount: 4000 }),
  ]

  it('splits applications into open, won and lost', () => {
    const s = financingSummary(apps)
    expect(s.total).toBe(5)
    expect(s.open).toBe(2)
    expect(s.won).toBe(2)
    expect(s.lost).toBe(1)
  })

  it('totals the money still in play and the money committed', () => {
    const s = financingSummary(apps)
    expect(s.openValue).toBe(8000)
    expect(s.wonValue).toBe(20000)
  })

  it('reports funded money separately from approved', () => {
    // Approved is a commitment; funded is cash that landed. A page that
    // conflates them overstates what has actually been paid out.
    expect(financingSummary(apps).fundedValue).toBe(12000)
  })

  it('leaves a declined application out of every money total', () => {
    const s = financingSummary([app({ status: 'declined', amount: 9999 })])
    expect(s.openValue).toBe(0)
    expect(s.wonValue).toBe(0)
    expect(s.fundedValue).toBe(0)
    expect(s.lost).toBe(1)
  })

  it('puts an unmapped status in the open column', () => {
    const s = financingSummary([app({ status: 'renegotiating', amount: 700 })])
    expect(s.open).toBe(1)
    expect(s.openValue).toBe(700)
    expect(s.won).toBe(0)
    expect(s.lost).toBe(0)
  })

  it('is all zeroes for an empty list', () => {
    expect(financingSummary([])).toEqual({
      total: 0, open: 0, won: 0, lost: 0, openValue: 0, wonValue: 0, fundedValue: 0,
    })
  })

  it('keeps the three groups adding up to the total', () => {
    const s = financingSummary(apps)
    expect(s.open + s.won + s.lost).toBe(s.total)
  })
})

describe('sortFinancingApplications', () => {
  it('puts the newest application first', () => {
    const out = sortFinancingApplications([
      app({ id: 'old', createdAt: new Date(2026, 0, 1) }),
      app({ id: 'new', createdAt: new Date(2026, 5, 1) }),
    ])
    expect(out.map(a => a.id)).toEqual(['new', 'old'])
  })

  it('sinks an application with no createdAt rather than dropping it', () => {
    // The listener has no orderBy, deliberately — an orderBy would exclude
    // documents missing the field entirely.
    const out = sortFinancingApplications([
      app({ id: 'undated', createdAt: null }),
      app({ id: 'dated', createdAt: new Date(2026, 0, 1) }),
    ])
    expect(out.map(a => a.id)).toEqual(['dated', 'undated'])
    expect(out).toHaveLength(2)
  })

  it('breaks ties on id, so equal rows hold their place', () => {
    const d = new Date(2026, 5, 1)
    const x = app({ id: 'x', createdAt: d })
    const y = app({ id: 'y', createdAt: d })
    expect(sortFinancingApplications([y, x]).map(a => a.id)).toEqual(['x', 'y'])
    expect(sortFinancingApplications([x, y]).map(a => a.id)).toEqual(['x', 'y'])
  })

  it('does not reorder the array it was given', () => {
    const input = [app({ id: 'a', createdAt: new Date(2026, 0, 1) }), app({ id: 'b', createdAt: new Date(2026, 5, 1) })]
    sortFinancingApplications(input)
    expect(input.map(a => a.id)).toEqual(['a', 'b'])
  })
})

describe('financingSourceLink', () => {
  it('points at the record the application came from', () => {
    expect(financingSourceLink(app({ sourceType: 'proposal', sourceId: 'p9' }))).toBe('/proposals/p9')
    expect(financingSourceLink(app({ sourceType: 'invoice', sourceId: 'i9' }))).toBe('/invoices/i9')
  })
})
