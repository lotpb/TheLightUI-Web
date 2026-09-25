import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'

// ── Firestore fake: one document, transactions read and write it ────────────
let stored: Record<string, unknown> | null = null
const writes: Record<string, unknown>[] = []
vi.mock('firebase/firestore', async (orig) => {
  const real = await orig<typeof import('firebase/firestore')>()
  const snap = () => ({
    id: 'c1',
    exists: () => stored !== null,
    data: () => stored ?? undefined,
    get: (k: string) => stored?.[k],
  })
  return {
    ...real,
    doc: () => ({}),
    updateDoc: vi.fn(),
    runTransaction: async (_db: unknown, fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        get: async () => snap(),
        update: (_ref: unknown, data: Record<string, unknown>) => {
          writes.push(data)
          stored = { ...stored, ...data }
        },
      }),
  }
})
vi.mock('../firebase/config', () => ({ db: {} }))
vi.mock('../stores/authStore', () => ({
  getCompanyId: () => 'co1',
  getCurrentUserLabel: () => ({ name: 'Pat', uid: 'u1' }),
}))
vi.mock('../stores/planStore', () => ({ usePlanStore: { getState: () => ({ plan: 'free' }) } }))
vi.mock('firebase/functions', () => ({ getFunctions: vi.fn(), httpsCallable: vi.fn() }))

import { customerToFirestore, diffCustomerEdit, emptyCustomer, type CustomerItem } from './customer'
import { saveCustomerEdits, CustomerEditConflictError } from '../services/customerService'

const base: CustomerItem = {
  ...emptyCustomer(),
  id: 'c1',
  category: 'Customer',
  lastname: 'Rossi',
  phone: '555-0100',
  email: 'a@x.com',
  comments: 'first note',
  quoteNotes: 'Net 30',
  tags: ['vip'],
  creationDate: new Date('2026-01-01T00:00:00Z'),
  followUpDate: new Date('2026-10-01T00:00:00Z'),
  customFields: { gate: '1234' },
} as CustomerItem

/** Puts `c` in the fake store the way Firestore would hold it. */
function store(c: CustomerItem) {
  stored = { ...customerToFirestore(c), companyId: 'co1', lastEditedByName: 'Sam' }
}

describe('diffCustomerEdit', () => {
  it('an unchanged form has no changes and no conflicts', () => {
    expect(diffCustomerEdit(base, { ...base }, { ...base })).toEqual({ changes: {}, conflicts: [] })
  })

  it('only fields the user changed are written', () => {
    const d = diffCustomerEdit(base, { ...base, phone: '555-0199' }, base)
    expect(d.changes).toEqual({ phone: '555-0199' })
  })

  it('edits elsewhere to fields the user did not touch are not conflicts and not overwritten', () => {
    const theirs = { ...base, quoteNotes: 'Net 15', comments: 'first note\nsecond', tags: ['vip', 'hot'], followUpDate: null }
    const d = diffCustomerEdit(base, { ...base, phone: '555-0199' }, theirs)
    expect(d.conflicts).toEqual([])
    expect(Object.keys(d.changes)).toEqual(['phone'])
  })

  it('both sides changing the same field differently is a conflict', () => {
    const d = diffCustomerEdit(base, { ...base, phone: '555-0199' }, { ...base, phone: '555-0142' })
    expect(d.conflicts).toEqual(['phone'])
  })

  it('both sides making the same change is not a conflict', () => {
    const d = diffCustomerEdit(base, { ...base, phone: '555-0199' }, { ...base, phone: '555-0199' })
    expect(d.conflicts).toEqual([])
  })

  it('compares dates, arrays and maps by value, not identity', () => {
    const clone = {
      ...base,
      creationDate: new Date(base.creationDate.getTime()),
      tags: [...base.tags],
      customFields: { ...base.customFields },
    }
    expect(diffCustomerEdit(base, clone, clone).changes).toEqual({})
    expect(diffCustomerEdit(base, { ...base, customFields: { gate: '9' } }, base).changes)
      .toEqual({ customFields: { gate: '9' } })
  })

  it('clearing a date is a change written as null', () => {
    expect(diffCustomerEdit(base, { ...base, followUpDate: null }, base).changes).toEqual({ followUpDate: null })
  })
})

describe('saveCustomerEdits', () => {
  beforeEach(() => { writes.length = 0; store(base) })

  it('keeps quote notes, comments and tags written elsewhere while the form was open', async () => {
    store({ ...base, quoteNotes: 'Net 15, deposit 30%', comments: 'first note\nfrom /followups', tags: ['vip', 'hot'] })
    await saveCustomerEdits('c1', base, { ...base, email: 'b@x.com' }, { userId: 'u1' })
    expect(stored).toMatchObject({
      email: 'b@x.com',
      quoteNotes: 'Net 15, deposit 30%',
      comments: 'first note\nfrom /followups',
      tags: ['vip', 'hot'],
      lastEditedByName: 'Pat',
      uid: 'u1',
    })
    expect(Object.keys(writes[0]).sort()).toEqual(['email', 'lastEditedByName', 'lastUpdate', 'uid'])
  })

  it('refuses a same-field conflict, naming the field and who made the other edit', async () => {
    store({ ...base, phone: '555-0142' })
    const err = await saveCustomerEdits('c1', base, { ...base, phone: '555-0199' }).catch(e => e)
    expect(err).toBeInstanceOf(CustomerEditConflictError)
    expect(err.fields).toEqual(['phone'])
    expect(err.editedBy).toBe('Sam')
    expect(writes).toHaveLength(0)
  })

  it('overwrite writes the conflicting field and still merges the rest', async () => {
    store({ ...base, phone: '555-0142', quoteNotes: 'Net 15' })
    await saveCustomerEdits('c1', base, { ...base, phone: '555-0199' }, { overwrite: true })
    expect(stored).toMatchObject({ phone: '555-0199', quoteNotes: 'Net 15' })
  })

  it('writes nothing when nothing changed', async () => {
    expect(await saveCustomerEdits('c1', base, { ...base })).toBe(false)
    expect(writes).toHaveLength(0)
  })

  it('refuses a deleted or foreign record', async () => {
    stored = null
    await expect(saveCustomerEdits('c1', base, { ...base, phone: '1' })).rejects.toThrow(/no longer exists/)
    store(base); stored!.companyId = 'other'
    await expect(saveCustomerEdits('c1', base, { ...base, phone: '1' })).rejects.toThrow(/no longer exists/)
  })
})

describe('call sites', () => {
  const strip = (s: string) =>
    s.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

  it('the edit form saves through the merge; create is unchanged', () => {
    const src = strip(readFileSync('src/pages/customers/CustomerFormPage.tsx', 'utf8'))
    expect(src).toMatch(/saveCustomerEdits\(id!, loadedRef\.current \?\? form, form,/)
    expect(src).toMatch(/createCustomer\(form, user\?\.uid\)/)
    expect(src).not.toMatch(/updateCustomer\(/)
  })

  it('reactivating from the record page writes only the flag', () => {
    const src = strip(readFileSync('src/pages/customers/CustomerDetailPage.tsx', 'utf8'))
    expect(src).not.toMatch(/updateCustomer\(/)
    expect(src).toMatch(/reactivateCustomer\(id,/)
  })
})

describe('JSON backups carry quoteNotes', () => {
  it('both exporters include it, and both importers read it with an empty default', async () => {
    const { exportCustomersToJSON } = await import('../services/customerService')
    expect(JSON.parse(exportCustomersToJSON([base]))[0].quoteNotes).toBe('Net 30')
    for (const f of ['src/services/customerService.ts', 'src/utils/exportUtils.ts']) {
      const src = readFileSync(f, 'utf8')
      expect(src).toMatch(/quoteNotes:\s+r\.quoteNotes\s+\?\? ''/)
    }
    expect(readFileSync('src/utils/exportUtils.ts', 'utf8')).toMatch(/c\.quoteNotes\s+\? \{ quoteNotes: c\.quoteNotes \}/)
  })
})
