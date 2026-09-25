import { describe, it, expect, vi, beforeEach } from 'vitest'

const updateDoc = vi.fn()
vi.mock('firebase/firestore', async (orig) => ({
  ...(await orig<typeof import('firebase/firestore')>()),
  updateDoc: (...a: unknown[]) => updateDoc(...a),
  doc: (_db: unknown, col: string, id: string) => ({ path: `${col}/${id}` }),
}))
vi.mock('../firebase/config', () => ({ db: {} }))
vi.mock('../stores/authStore', () => ({
  getCompanyId: () => 'co1',
  getCurrentUserLabel: () => ({ name: 'Pat', uid: 'u1' }),
}))

vi.mock('../stores/planStore', () => ({ usePlanStore: { getState: () => ({ plan: 'free' }) } }))
vi.mock('firebase/functions', () => ({ getFunctions: vi.fn(), httpsCallable: vi.fn() }))

import { emptyCustomer, formUnownedFields, type CustomerItem } from './customer'
import { updateCustomer } from '../services/customerService'
import { readFileSync } from 'node:fs'

const stripComments = (s: string) =>
  s.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

function record(category: string): CustomerItem {
  return {
    ...emptyCustomer(),
    id: 'c1',
    category,
    quoteNotes: 'stale terms',
    comments: 'stale comments',
    tags: ['stale'],
  } as CustomerItem
}

describe('record edit form only writes fields it owns', () => {
  beforeEach(() => updateDoc.mockReset())

  it('omits quote notes, comments, tags and follow-up date for non-vendors', () => {
    expect(formUnownedFields(record('Customer')).sort())
      .toEqual(['comments', 'followUpDate', 'quoteNotes', 'tags'])
    expect(formUnownedFields(record('Lead'))).toContain('followUpDate')
  })

  it('keeps follow-up date for vendors, where the form has an input for it', () => {
    expect(formUnownedFields(record('Vendor'))).not.toContain('followUpDate')
    expect(formUnownedFields(record('vendor'))).not.toContain('followUpDate')
  })

  it('updateCustomer drops omitted keys and still writes the form-owned ones', async () => {
    const c = record('Customer')
    await updateCustomer('c1', c, 'u1', formUnownedFields(c))
    const data = updateDoc.mock.calls[0][1] as Record<string, unknown>
    for (const k of ['quoteNotes', 'comments', 'tags', 'followUpDate']) expect(data).not.toHaveProperty(k)
    for (const k of ['lastname', 'contactAttempts', 'paymentStatus', 'callback', 'companyId', 'lastEditedByName'])
      expect(data).toHaveProperty(k)
  })

  it('updateCustomer without omit still writes the whole document (other callers unchanged)', async () => {
    await updateCustomer('c1', record('Customer'), 'u1')
    const data = updateDoc.mock.calls[0][1] as Record<string, unknown>
    expect(data.quoteNotes).toBe('stale terms')
    expect(data).toHaveProperty('comments')
  })

  it('the edit form passes the omit list on update, and create is untouched', () => {
    const src = stripComments(readFileSync('src/pages/customers/CustomerFormPage.tsx', 'utf8'))
    expect(src).toMatch(/updateCustomer\(id!, form, user\?\.uid, formUnownedFields\(form\)\)/)
    expect(src).toMatch(/createCustomer\(form, user\?\.uid\)/)
  })
})
