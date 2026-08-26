import { describe, it, expect } from 'vitest'
import {
  lineItemTotal, invoiceSubtotal, invoiceTaxAmount, invoiceTotal,
  effectiveStatus, generateInvoiceNumber,
  type Invoice, type InvoiceLineItem,
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
})

describe('generateInvoiceNumber', () => {
  it('matches the INV-YYYYMM-#### format', () => {
    expect(generateInvoiceNumber()).toMatch(/^INV-\d{6}-\d{4}$/)
  })
})
