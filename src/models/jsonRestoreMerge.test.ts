import { describe, it, expect, vi, beforeEach } from 'vitest'

const sets: { path: string; data: Record<string, unknown>; opts?: unknown }[] = []
vi.mock('firebase/firestore', async (orig) => ({
  ...(await orig<typeof import('firebase/firestore')>()),
  doc: (_a: unknown, col?: string, id?: string) => ({ path: id ? `${col}/${id}` : 'Customers/<new>' }),
  collection: () => ({}),
  writeBatch: () => ({
    set: (ref: { path: string }, data: Record<string, unknown>, opts?: unknown) => sets.push({ path: ref.path, data, opts }),
    commit: async () => {},
  }),
}))
vi.mock('../firebase/config', () => ({ db: {} }))
vi.mock('../stores/authStore', () => ({
  getCompanyId: () => 'co1',
  getCurrentUserLabel: () => ({ name: 'Pat', uid: 'u1' }),
}))
vi.mock('../stores/planStore', () => ({ usePlanStore: { getState: () => ({ plan: 'professional' }) } }))
vi.mock('firebase/functions', () => ({ getFunctions: vi.fn(), httpsCallable: vi.fn() }))

import { importCustomersFromJSON } from '../services/customerService'

describe('JSON restore over existing records', () => {
  beforeEach(() => { sets.length = 0 })

  it('merges only the fields the file has, so opt-outs, tags, custom fields and the portal link survive', async () => {
    const file = JSON.stringify([{ id: 'c1', isActive: true, first: 'Ann', lastname: 'Rossi', phone: '555', quantity: 3 }])
    await importCustomersFromJSON(file, 'u1')
    expect(sets).toHaveLength(1)
    const { path, data, opts } = sets[0]
    expect(path).toBe('Customers/c1')
    expect(opts).toEqual({ merge: true })
    expect(Object.keys(data).sort()).toEqual(['active', 'companyId', 'first', 'lastUpdate', 'lastname', 'phone', 'quan', 'uid'])
    for (const k of ['smsOptOut', 'emailOptOut', 'tags', 'customFields', 'portalToken', 'assignedToUid', 'followUpDate', 'comments'])
      expect(data, k).not.toHaveProperty(k)
  })

  it('reads tags and follow-up date when an iOS backup carries them', async () => {
    await importCustomersFromJSON(JSON.stringify([{ id: 'c2', lastname: 'X', tags: ['vip', 7], followUpDate: '2026-10-01T00:00:00Z' }]))
    const d = sets[0].data
    expect(d.tags).toEqual(['vip'])
    expect((d.followUpDate as { toDate(): Date }).toDate().toISOString()).toBe('2026-10-01T00:00:00.000Z')
  })

  it('records without an id are still created whole', async () => {
    await importCustomersFromJSON(JSON.stringify([{ lastname: 'New' }]), '', 'Lead')
    const { path, data, opts } = sets[0]
    expect(path).toBe('Customers/<new>')
    expect(opts).toBeUndefined()
    expect(data).toMatchObject({ lastname: 'New', category: 'Lead', tags: [], companyId: 'co1' })
  })

  it("the list page's default category applies when the file has none", async () => {
    await importCustomersFromJSON(JSON.stringify([{ id: 'c3', lastname: 'Y' }]), '', 'Vendor')
    expect(sets[0].data.category).toBe('Vendor')
  })
})
