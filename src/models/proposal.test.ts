import { describe, it, expect } from 'vitest'
import {
  lineItemTotal, proposalSubtotal, proposalTaxAmount, proposalTotal,
  effectiveStatus, generateProposalNumber,
  proposalKpis, daysUntilExpiry, expiryState, expiryLabel, sortProposals,
  EXPIRING_SOON_DAYS, DEFAULT_PROPOSAL_SORT, PROPOSAL_SORTS,
  type Proposal, type ProposalLineItem, type ProposalSortKey,
} from './proposal'

function makeProposal(overrides: Partial<Proposal> = {}): Proposal {
  return {
    id: 'prop1',
    companyId: 'co1',
    customerId: 'cust1',
    customerName: 'Jane Doe',
    customerPhone: '',
    customerEmail: '',
    customerAddress: '',
    proposalNumber: 'PROP-202601-0001',
    issueDate: new Date('2026-01-01'),
    expiresDate: new Date('2026-01-31'),
    status: 'sent',
    lineItems: [{ description: 'Widget', qty: 2, rate: 50 }],
    notes: '',
    taxRate: 0,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  }
}

describe('lineItemTotal', () => {
  it('multiplies qty by rate', () => {
    expect(lineItemTotal({ description: 'x', qty: 3, rate: 25 })).toBe(75)
  })
})

describe('proposalSubtotal / proposalTaxAmount / proposalTotal', () => {
  const lineItems: ProposalLineItem[] = [
    { description: 'Design', qty: 1, rate: 500 },
    { description: 'Build',  qty: 10, rate: 45 }, // 450
  ]

  it('sums all line items for the subtotal', () => {
    expect(proposalSubtotal({ lineItems })).toBe(950)
  })

  it('computes tax as a percentage of the subtotal', () => {
    expect(proposalTaxAmount({ lineItems, taxRate: 8 })).toBeCloseTo(76, 5)
  })

  it('adds subtotal and tax for the total', () => {
    expect(proposalTotal({ lineItems, taxRate: 8 })).toBeCloseTo(1026, 5)
  })

  it('returns zero for a proposal with no line items', () => {
    expect(proposalSubtotal({ lineItems: [] })).toBe(0)
    expect(proposalTotal({ lineItems: [], taxRate: 15 })).toBe(0)
  })
})

describe('effectiveStatus', () => {
  it('passes through accepted unchanged, regardless of expiry', () => {
    const p = makeProposal({ status: 'accepted', expiresDate: new Date('2020-01-01') })
    expect(effectiveStatus(p)).toBe('accepted')
  })

  it('passes through declined unchanged, regardless of expiry', () => {
    const p = makeProposal({ status: 'declined', expiresDate: new Date('2020-01-01') })
    expect(effectiveStatus(p)).toBe('declined')
  })

  it('passes through draft unchanged, regardless of expiry', () => {
    const p = makeProposal({ status: 'draft', expiresDate: new Date('2020-01-01') })
    expect(effectiveStatus(p)).toBe('draft')
  })

  it('reports sent as expired once the expiry date has passed', () => {
    const p = makeProposal({ status: 'sent', expiresDate: new Date('2020-01-01') })
    expect(effectiveStatus(p)).toBe('expired')
  })

  it('keeps sent as sent while the expiry date is still in the future', () => {
    const farFuture = new Date()
    farFuture.setFullYear(farFuture.getFullYear() + 5)
    const p = makeProposal({ status: 'sent', expiresDate: farFuture })
    expect(effectiveStatus(p)).toBe('sent')
  })
})

describe('generateProposalNumber', () => {
  it('matches the PROP-YYYYMM-#### format', () => {
    expect(generateProposalNumber()).toMatch(/^PROP-\d{6}-\d{4}$/)
  })
})

const NOW = new Date('2026-06-15T12:00:00')

/**
 * Local midnight.
 *
 * `new Date('2026-06-15')` is parsed as UTC, so in any negative-offset zone it
 * lands on the 14th — which made every day count in these tests off by one.
 * A Firestore Timestamp becomes a local instant, so the fixtures have to be
 * local too.
 */
const day = (y: number, m: number, d: number) => new Date(y, m - 1, d)

/** A proposal worth exactly `amount`, with no tax to round. */
const at = (amount: number, over: Partial<Proposal> = {}): Proposal =>
  makeProposal({ lineItems: [{ description: 'Work', qty: 1, rate: amount }], taxRate: 0, ...over })

describe('daysUntilExpiry', () => {
  it('is zero on the expiry date itself', () => {
    expect(daysUntilExpiry(at(1, { expiresDate: day(2026, 6, 15) }), NOW)).toBe(0)
  })

  it('counts whole days ahead regardless of the time of day', () => {
    const p = at(1, { expiresDate: day(2026, 6, 18) })
    expect(daysUntilExpiry(p, new Date('2026-06-15T00:05:00'))).toBe(3)
    expect(daysUntilExpiry(p, new Date('2026-06-15T23:55:00'))).toBe(3)
  })

  it('goes negative once the date has passed', () => {
    expect(daysUntilExpiry(at(1, { expiresDate: day(2026, 6, 5) }), NOW)).toBe(-10)
  })

  it('does not mutate the clock or the proposal', () => {
    const now = new Date('2026-06-15T14:30:00')
    const p = at(1, { expiresDate: new Date('2026-06-20T09:15:00') })
    daysUntilExpiry(p, now)
    expect(now.getHours()).toBe(14)
    expect(p.expiresDate.getHours()).toBe(9)
  })
})

describe('expiryState', () => {
  it('flags a live proposal inside the window as expiring', () => {
    expect(expiryState(at(1, { status: 'sent', expiresDate: day(2026, 6, 20) }), NOW)).toBe('expiring')
  })

  it('leaves one outside the window live', () => {
    expect(expiryState(at(1, { status: 'sent', expiresDate: day(2026, 8, 1) }), NOW)).toBe('live')
  })

  it('treats the boundary day itself as expiring', () => {
    const edge = new Date(NOW); edge.setDate(edge.getDate() + EXPIRING_SOON_DAYS)
    expect(expiryState(at(1, { status: 'sent', expiresDate: edge }), NOW)).toBe('expiring')
  })

  it('reports a lapsed proposal as expired', () => {
    expect(expiryState(at(1, { status: 'sent', expiresDate: day(2026, 1, 1) }), NOW)).toBe('expired')
  })

  it('reports an answered proposal as closed, whatever its expiry date', () => {
    // The row showed "Expires Mar 3" on accepted proposals — a date that
    // stopped meaning anything when the customer answered.
    for (const status of ['accepted', 'declined'] as const) {
      expect(expiryState(at(1, { status, expiresDate: day(2026, 6, 16) }), NOW)).toBe('closed')
      expect(expiryState(at(1, { status, expiresDate: day(2020, 1, 1) }), NOW)).toBe('closed')
    }
  })

  it('reports a draft as a draft, not as expiring', () => {
    expect(expiryState(at(1, { status: 'draft', expiresDate: day(2026, 6, 16) }), NOW)).toBe('draft')
  })
})

describe('expiryLabel', () => {
  it('names today and tomorrow rather than counting them', () => {
    expect(expiryLabel(at(1, { expiresDate: day(2026, 6, 15) }), NOW)).toBe('Expires today')
    expect(expiryLabel(at(1, { expiresDate: day(2026, 6, 16) }), NOW)).toBe('Expires tomorrow')
  })

  it('counts days ahead and days past', () => {
    expect(expiryLabel(at(1, { expiresDate: day(2026, 6, 18) }), NOW)).toBe('Expires in 3 days')
    expect(expiryLabel(at(1, { expiresDate: day(2026, 6, 14) }), NOW)).toBe('Expired yesterday')
    expect(expiryLabel(at(1, { expiresDate: day(2026, 6, 5) }), NOW)).toBe('Expired 10 days ago')
  })
})

/**
 * The win rate divided by answered proposals only, so a quote that lapsed
 * unanswered counted in neither half.
 */
describe('proposalKpis', () => {
  const pipeline = (acc: number, dec: number, exp: number): Proposal[] => [
    ...Array.from({ length: acc }, (_, i) => at(1000, { id: `a${i}`, status: 'accepted', proposalNumber: `A${i}` })),
    ...Array.from({ length: dec }, (_, i) => at(1000, { id: `d${i}`, status: 'declined', proposalNumber: `D${i}` })),
    ...Array.from({ length: exp }, (_, i) => at(1000, {
      id: `e${i}`, status: 'sent', expiresDate: day(2026, 1, 1), proposalNumber: `E${i}`,
    })),
  ]

  it('counts a silent expiry as a loss', () => {
    // The headline case: 2 accepted, 1 declined, 97 lapsed.
    expect(proposalKpis(pipeline(2, 1, 97), NOW).winRate).toBe(2)
  })

  it('no longer reports 100% for one win among two dozen lapses', () => {
    expect(proposalKpis(pipeline(1, 0, 24), NOW).winRate).toBe(4)
  })

  it('distinguishes two pipelines the old formula scored identically', () => {
    // Both were 67% because expiries were excluded from the denominator.
    expect(proposalKpis(pipeline(2, 1, 97), NOW).winRate).toBe(2)
    expect(proposalKpis(pipeline(18, 9, 13), NOW).winRate).toBe(45)
  })

  it('is null, not zero, when nothing has been decided', () => {
    // 0% read as "we lose everything"; these are drafts and open quotes.
    const open = [
      at(500, { status: 'draft' }),
      at(500, { status: 'sent', expiresDate: day(2026, 9, 1), proposalNumber: 'B' }),
    ]
    expect(proposalKpis(open, NOW).winRate).toBeNull()
    expect(proposalKpis([], NOW).winRate).toBeNull()
  })

  it('is zero when everything decided was lost', () => {
    expect(proposalKpis(pipeline(0, 0, 40), NOW).winRate).toBe(0)
    expect(proposalKpis(pipeline(0, 5, 0), NOW).winRate).toBe(0)
  })

  it('is 100 only when nothing was lost', () => {
    expect(proposalKpis(pipeline(6, 0, 0), NOW).winRate).toBe(100)
  })

  it('counts drafts and open quotes out of the decided total', () => {
    const mix = [
      ...pipeline(1, 1, 1),
      at(900, { id: 'dr', status: 'draft', proposalNumber: 'Z1' }),
      at(900, { id: 'op', status: 'sent', expiresDate: day(2026, 9, 1), proposalNumber: 'Z2' }),
    ]
    const k = proposalKpis(mix, NOW)
    expect(k.decidedCount).toBe(3)
    expect(k.draftCount).toBe(1)
    expect(k.pendingCount).toBe(1)
  })

  it('separates the live pipeline from the lapsed one', () => {
    const items = [
      at(2000, { id: 'p1', status: 'sent', expiresDate: day(2026, 9, 1), proposalNumber: 'P1' }),
      at(1500, { id: 'p2', status: 'sent', expiresDate: day(2026, 6, 18), proposalNumber: 'P2' }),
      at(800,  { id: 'x1', status: 'sent', expiresDate: day(2026, 5, 1), proposalNumber: 'X1' }),
    ]
    const k = proposalKpis(items, NOW)
    expect(k.pendingValue).toBe(3500)   // the two still live
    expect(k.pendingCount).toBe(2)
    expect(k.expiredValue).toBe(800)    // the lapsed one is not "pending"
    expect(k.expiredCount).toBe(1)
  })

  it('reports what is about to lapse as a subset of what is pending', () => {
    const items = [
      at(2000, { id: 'p1', status: 'sent', expiresDate: day(2026, 9, 1), proposalNumber: 'P1' }),
      at(1500, { id: 'p2', status: 'sent', expiresDate: day(2026, 6, 18), proposalNumber: 'P2' }),
      at(600,  { id: 'p3', status: 'sent', expiresDate: day(2026, 6, 15), proposalNumber: 'P3' }),
    ]
    const k = proposalKpis(items, NOW)
    expect(k.expiringCount).toBe(2)
    expect(k.expiringValue).toBe(2100)
    expect(k.expiringValue).toBeLessThanOrEqual(k.pendingValue)
  })

  it('does not count a draft as about to lapse', () => {
    const k = proposalKpis([at(700, { status: 'draft', expiresDate: day(2026, 6, 16) })], NOW)
    expect(k.expiringCount).toBe(0)
    expect(k.pendingCount).toBe(0)
    expect(k.draftCount).toBe(1)
  })

  it('includes tax in the money figures', () => {
    const taxed = [makeProposal({
      status: 'accepted', taxRate: 10, lineItems: [{ description: 'x', qty: 1, rate: 100 }],
    })]
    expect(proposalKpis(taxed, NOW).acceptedValue).toBeCloseTo(110, 6)
  })

  it('is all zeroes and no rate for an empty list', () => {
    expect(proposalKpis([], NOW)).toEqual({
      pendingValue: 0, pendingCount: 0, expiringValue: 0, expiringCount: 0,
      acceptedValue: 0, acceptedCount: 0, declinedCount: 0,
      expiredCount: 0, expiredValue: 0, decidedCount: 0, winRate: null, draftCount: 0,
    })
  })
})

describe('sortProposals', () => {
  const live1 = at(500,  { id: 'live1', status: 'sent', expiresDate: day(2026, 6, 18), issueDate: day(2026, 6, 1), customerName: 'Zoe Adams',  proposalNumber: 'P-003' })
  const live2 = at(9000, { id: 'live2', status: 'sent', expiresDate: day(2026, 8, 1), issueDate: day(2026, 5, 1), customerName: 'Alan Brown', proposalNumber: 'P-001' })
  const gone  = at(1200, { id: 'gone',  status: 'sent', expiresDate: day(2024, 1, 1), issueDate: day(2023, 12, 1), customerName: 'Mia Carter', proposalNumber: 'P-002' })
  const won   = at(3000, { id: 'won',   status: 'accepted', expiresDate: day(2026, 6, 16), issueDate: day(2026, 4, 1), customerName: 'Ben Diaz', proposalNumber: 'P-004' })
  const items = [live1, live2, gone, won]

  const ids = (key: ProposalSortKey) => sortProposals(items, key, NOW).map(p => p.id)

  it('defaults to urgency', () => {
    expect(DEFAULT_PROPOSAL_SORT).toBe('urgency')
  })

  it('puts live proposals first, soonest to lapse at the top', () => {
    expect(ids('urgency').slice(0, 2)).toEqual(['live1', 'live2'])
  })

  it('does not let a two-year-old expiry outrank the one lapsing this week', () => {
    // The trap a plain ascending date sort falls into.
    const order = ids('urgency')
    expect(order.indexOf('live1')).toBeLessThan(order.indexOf('gone'))
  })

  it('sinks settled proposals below every live one, most recent first', () => {
    expect(ids('urgency').slice(2)).toEqual(['won', 'gone'])
  })

  it('sorts by expiry date descending as a plain date sort', () => {
    expect(ids('expiryDesc')).toEqual(['live2', 'live1', 'won', 'gone'])
  })

  it('sorts by amount both ways', () => {
    expect(ids('amountDesc')).toEqual(['live2', 'won', 'gone', 'live1'])
    expect(ids('amountAsc')).toEqual(['live1', 'gone', 'won', 'live2'])
  })

  it('sorts by issue date both ways', () => {
    expect(ids('issuedDesc')).toEqual(['live1', 'live2', 'won', 'gone'])
    expect(ids('issuedAsc')).toEqual(['gone', 'won', 'live2', 'live1'])
  })

  it('sorts by customer name', () => {
    expect(ids('customer')).toEqual(['live2', 'won', 'gone', 'live1'])
  })

  it('offers every key it can sort by, and no key it cannot', () => {
    const offered = PROPOSAL_SORTS.map(s => s.key).sort()
    expect(offered).toEqual([
      'amountAsc', 'amountDesc', 'customer', 'expiryDesc', 'issuedAsc', 'issuedDesc', 'urgency',
    ])
    expect(offered).toContain(DEFAULT_PROPOSAL_SORT)
    for (const s of PROPOSAL_SORTS) expect(s.label.trim()).not.toBe('')
  })

  it('breaks ties on the proposal number, so equal rows hold their place', () => {
    const x = at(100, { id: 'x', status: 'sent', expiresDate: day(2026, 6, 20), proposalNumber: 'P-200' })
    const y = at(100, { id: 'y', status: 'sent', expiresDate: day(2026, 6, 20), proposalNumber: 'P-100' })
    expect(sortProposals([x, y], 'urgency', NOW).map(p => p.id)).toEqual(['y', 'x'])
    expect(sortProposals([y, x], 'urgency', NOW).map(p => p.id)).toEqual(['y', 'x'])
  })

  it('does not reorder the array it was given', () => {
    const input = [live1, live2, gone, won]
    sortProposals(input, 'amountDesc', NOW)
    expect(input.map(p => p.id)).toEqual(['live1', 'live2', 'gone', 'won'])
  })

  it('keeps the fields the list page attaches to each row', () => {
    const enriched = items.map(p => ({ ...p, _status: effectiveStatus(p, NOW) }))
    const out = sortProposals(enriched, 'urgency', NOW)
    expect(out[0]._status).toBe('sent')
    expect(out).toHaveLength(4)
  })

  it('handles an empty list and a single row', () => {
    expect(sortProposals([], 'urgency', NOW)).toEqual([])
    expect(sortProposals([live1], 'customer', NOW).map(p => p.id)).toEqual(['live1'])
  })
})
