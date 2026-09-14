import { describe, it, expect } from 'vitest'
import {
  lineItemTotal, invoiceSubtotal, invoiceTaxAmount, invoiceTotal,
  effectiveStatus, generateInvoiceNumber, invoiceKpis, sortInvoices,
  DEFAULT_INVOICE_SORT, INVOICE_SORTS,
  type Invoice, type InvoiceLineItem, type InvoiceSortKey,
} from './invoice'

function makeInvoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: 'inv1',
    companyId: 'co1',
    customerId: 'cust1',
    customerName: 'Jane Doe',
    customerPhone: '',
    customerEmail: '',
    customerAddress: '',
    invoiceNumber: 'INV-202601-0001',
    issueDate: new Date('2026-01-01'),
    dueDate: new Date('2026-01-31'),
    status: 'sent',
    lineItems: [{ description: 'Widget', qty: 2, rate: 50 }],
    notes: '',
    taxRate: 0,
    currency: 'USD',
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  }
}

describe('lineItemTotal', () => {
  it('multiplies qty by rate', () => {
    expect(lineItemTotal({ description: 'x', qty: 3, rate: 25 })).toBe(75)
  })

  it('is zero when qty is zero', () => {
    expect(lineItemTotal({ description: 'x', qty: 0, rate: 100 })).toBe(0)
  })
})

describe('invoiceSubtotal / invoiceTaxAmount / invoiceTotal', () => {
  const lineItems: InvoiceLineItem[] = [
    { description: 'Labor', qty: 4, rate: 25 },   // 100
    { description: 'Parts', qty: 1, rate: 49.99 }, // 49.99
  ]

  it('sums all line items for the subtotal', () => {
    expect(invoiceSubtotal({ lineItems })).toBeCloseTo(149.99, 2)
  })

  it('computes tax as a percentage of the subtotal', () => {
    expect(invoiceTaxAmount({ lineItems, taxRate: 10 })).toBeCloseTo(14.999, 3)
  })

  it('is zero tax when taxRate is zero', () => {
    expect(invoiceTaxAmount({ lineItems, taxRate: 0 })).toBe(0)
  })

  it('adds subtotal and tax for the total', () => {
    expect(invoiceTotal({ lineItems, taxRate: 10 })).toBeCloseTo(164.989, 3)
  })

  it('returns zero for an invoice with no line items', () => {
    expect(invoiceSubtotal({ lineItems: [] })).toBe(0)
    expect(invoiceTotal({ lineItems: [], taxRate: 20 })).toBe(0)
  })
})

describe('effectiveStatus', () => {
  it('passes through paid unchanged, regardless of due date', () => {
    const inv = makeInvoice({ status: 'paid', dueDate: new Date('2020-01-01') })
    expect(effectiveStatus(inv)).toBe('paid')
  })

  it('passes through draft unchanged, regardless of due date', () => {
    const inv = makeInvoice({ status: 'draft', dueDate: new Date('2020-01-01') })
    expect(effectiveStatus(inv)).toBe('draft')
  })

  it('reports sent as overdue once the due date has passed', () => {
    const inv = makeInvoice({ status: 'sent', dueDate: new Date('2020-01-01') })
    expect(effectiveStatus(inv)).toBe('overdue')
  })

  it('keeps sent as sent while the due date is still in the future', () => {
    const farFuture = new Date()
    farFuture.setFullYear(farFuture.getFullYear() + 5)
    const inv = makeInvoice({ status: 'sent', dueDate: farFuture })
    expect(effectiveStatus(inv)).toBe('sent')
  })

  it('is not overdue on the due date itself (same-day grace)', () => {
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const inv = makeInvoice({ status: 'sent', dueDate: today })
    expect(effectiveStatus(inv)).toBe('sent')
  })

  it('judges against a supplied clock', () => {
    const inv = makeInvoice({ status: 'sent', dueDate: new Date('2026-06-15') })
    expect(effectiveStatus(inv, new Date('2026-06-01T09:00:00'))).toBe('sent')
    expect(effectiveStatus(inv, new Date('2026-07-01T09:00:00'))).toBe('overdue')
  })

  it('does not mutate the clock it was given', () => {
    // It normalises to midnight internally; doing that in place would reset
    // the caller's Date and skew every later invoice in a roll-up.
    const now = new Date('2026-06-01T14:30:00')
    effectiveStatus(makeInvoice(), now)
    expect(now.getHours()).toBe(14)
    expect(now.getMinutes()).toBe(30)
  })
})

/**
 * /invoices summed every invoice into "Total Billed" and derived
 * Outstanding as total − paid, so an unsent draft counted both as money
 * billed and as money a customer owed.
 */
describe('invoiceKpis', () => {
  const NOW = new Date('2026-06-15T12:00:00')

  /** An invoice worth exactly `amount`, with no tax to round. */
  const at = (amount: number, over: Partial<Invoice> = {}): Invoice =>
    makeInvoice({ lineItems: [{ description: 'Work', qty: 1, rate: amount }], taxRate: 0, ...over })

  // Two unsent drafts, three issued (one of them past due), one paid.
  const MIX: Invoice[] = [
    at(4000, { id: 'd1', status: 'draft',                              invoiceNumber: 'INV-1' }),
    at(2500, { id: 'd2', status: 'draft',                              invoiceNumber: 'INV-2' }),
    at(3000, { id: 's1', status: 'sent',  dueDate: new Date('2026-07-01'), invoiceNumber: 'INV-3' }),
    at(2000, { id: 's2', status: 'sent',  dueDate: new Date('2026-07-15'), invoiceNumber: 'INV-4' }),
    at(1500, { id: 'o1', status: 'sent',  dueDate: new Date('2026-05-01'), invoiceNumber: 'INV-5' }),
    at(6000, { id: 'p1', status: 'paid',  dueDate: new Date('2026-04-01'), invoiceNumber: 'INV-6' }),
  ]

  it('leaves drafts out of Total Billed', () => {
    // 3000 + 2000 + 1500 + 6000. Not the 19,000 the page used to show.
    expect(invoiceKpis(MIX, NOW).billed).toBe(12500)
  })

  it('reports only what customers actually owe as Outstanding', () => {
    // The defect: 19,000 − 6,000 = 13,000 against a real 6,500.
    expect(invoiceKpis(MIX, NOW).outstanding).toBe(6500)
  })

  it('keeps Outstanding equal to billed less paid', () => {
    const k = invoiceKpis(MIX, NOW)
    expect(k.outstanding).toBe(k.billed - k.paid)
  })

  it('reports the draft money separately rather than discarding it', () => {
    const k = invoiceKpis(MIX, NOW)
    expect(k.draft).toBe(6500)
    expect(k.draftCount).toBe(2)
  })

  it('counts a past-due invoice as overdue and as outstanding', () => {
    const k = invoiceKpis(MIX, NOW)
    expect(k.overdue).toBe(1500)
    expect(k.overdue).toBeLessThanOrEqual(k.outstanding)
  })

  it('never counts a draft as overdue, however old', () => {
    const stale = [at(900, { status: 'draft', dueDate: new Date('2019-01-01') })]
    const k = invoiceKpis(stale, NOW)
    expect(k.overdue).toBe(0)
    expect(k.billed).toBe(0)
    expect(k.outstanding).toBe(0)
    expect(k.draft).toBe(900)
  })

  it('leaves a paid invoice out of Outstanding even when it is past due', () => {
    const k = invoiceKpis([at(500, { status: 'paid', dueDate: new Date('2020-01-01') })], NOW)
    expect(k.billed).toBe(500)
    expect(k.paid).toBe(500)
    expect(k.outstanding).toBe(0)
    expect(k.overdue).toBe(0)
  })

  it('is all zeroes for an empty list', () => {
    expect(invoiceKpis([], NOW)).toEqual({
      billed: 0, paid: 0, outstanding: 0, overdue: 0, draft: 0, draftCount: 0,
    })
  })

  it('includes tax in every figure', () => {
    const taxed = [makeInvoice({ status: 'sent', taxRate: 10, lineItems: [{ description: 'x', qty: 1, rate: 100 }] })]
    expect(invoiceKpis(taxed, NOW).billed).toBeCloseTo(110, 6)
  })

  it('never reports a negative Outstanding', () => {
    // Every paid invoice is also billed, so the subtraction cannot invert.
    const allPaid = [at(100, { status: 'paid' }), at(250, { status: 'paid' })]
    expect(invoiceKpis(allPaid, NOW).outstanding).toBe(0)
  })
})

describe('sortInvoices', () => {
  const at = (n: number, over: Partial<Invoice> = {}): Invoice =>
    makeInvoice({ lineItems: [{ description: 'Work', qty: 1, rate: n }], taxRate: 0, ...over })

  const A = at(500,  { id: 'a', customerName: 'Zoe Adams',  invoiceNumber: 'INV-003', dueDate: new Date('2026-03-01'), issueDate: new Date('2026-02-01') })
  const B = at(9000, { id: 'b', customerName: 'Alan Brown',  invoiceNumber: 'INV-001', dueDate: new Date('2026-01-01'), issueDate: new Date('2026-01-01') })
  const C = at(1200, { id: 'c', customerName: 'Mia Carter',  invoiceNumber: 'INV-002', dueDate: new Date('2026-02-01'), issueDate: new Date('2026-03-01') })
  const items = [A, B, C]

  const ids = (key: InvoiceSortKey) => sortInvoices(items, key).map(i => i.id)

  it('puts the longest-overdue invoice first by default', () => {
    expect(DEFAULT_INVOICE_SORT).toBe('dueAsc')
    expect(ids('dueAsc')).toEqual(['b', 'c', 'a'])
  })

  it('sorts by due date in both directions', () => {
    expect(ids('dueDesc')).toEqual(['a', 'c', 'b'])
  })

  it('sorts by amount, tax included, in both directions', () => {
    expect(ids('amountDesc')).toEqual(['b', 'c', 'a'])
    expect(ids('amountAsc')).toEqual(['a', 'c', 'b'])
  })

  it('sorts by issue date in both directions', () => {
    expect(ids('issuedDesc')).toEqual(['c', 'a', 'b'])
    expect(ids('issuedAsc')).toEqual(['b', 'a', 'c'])
  })

  it('sorts by customer name', () => {
    expect(ids('customer')).toEqual(['b', 'c', 'a'])
  })

  it('offers every key it can sort by, and no key it cannot', () => {
    const offered = INVOICE_SORTS.map(s => s.key).sort()
    expect(offered).toEqual([
      'amountAsc', 'amountDesc', 'customer', 'dueAsc', 'dueDesc', 'issuedAsc', 'issuedDesc',
    ])
    expect(offered).toContain(DEFAULT_INVOICE_SORT)
    for (const s of INVOICE_SORTS) expect(s.label.trim()).not.toBe('')
  })

  it('breaks ties on the invoice number, so equal rows hold their place', () => {
    const x = at(100, { id: 'x', invoiceNumber: 'INV-200', dueDate: new Date('2026-05-01') })
    const y = at(100, { id: 'y', invoiceNumber: 'INV-100', dueDate: new Date('2026-05-01') })
    expect(sortInvoices([x, y], 'dueAsc').map(i => i.id)).toEqual(['y', 'x'])
    expect(sortInvoices([y, x], 'dueAsc').map(i => i.id)).toEqual(['y', 'x'])
  })

  it('does not reorder the array it was given', () => {
    const input = [A, B, C]
    sortInvoices(input, 'amountDesc')
    expect(input.map(i => i.id)).toEqual(['a', 'b', 'c'])
  })

  it('keeps the fields the list page attaches to each row', () => {
    // filtered items are Invoice & { _status }, and the row renders _status.
    const enriched = items.map(i => ({ ...i, _status: effectiveStatus(i, new Date('2026-06-15')) }))
    const out = sortInvoices(enriched, 'dueAsc')
    expect(out[0]._status).toBe('overdue')
    expect(out).toHaveLength(3)
  })

  it('handles an empty list and a single row', () => {
    expect(sortInvoices([], 'dueAsc')).toEqual([])
    expect(sortInvoices([A], 'customer').map(i => i.id)).toEqual(['a'])
  })
})

describe('generateInvoiceNumber', () => {
  it('matches the INV-YYYYMM-#### format', () => {
    expect(generateInvoiceNumber()).toMatch(/^INV-\d{6}-\d{4}$/)
  })
})
