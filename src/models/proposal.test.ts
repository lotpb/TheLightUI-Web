import { describe, it, expect } from 'vitest'
import {
  lineItemTotal, proposalSubtotal, proposalTaxAmount, proposalTotal,
  effectiveStatus, generateProposalNumber,
  type Proposal, type ProposalLineItem,
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
