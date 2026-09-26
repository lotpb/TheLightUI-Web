import { beforeAll, afterAll, beforeEach, describe, it } from 'vitest'
import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import {
  setupTestEnv, resetAndSeedUsers, asUser, asAnonymous, seedDoc,
  COMPANY_A, COMPANY_B, ALICE, VIEWER_A, BOB, NOCLAIM,
} from './helpers'

/**
 * Collections where the document ID *is* the companyId, so the path itself is
 * the ownership check rather than a stored field. Different rule shape from
 * the field-scoped collections, hence a separate suite.
 */
interface Spec {
  name: string
  path: (companyId: string) => string
  /** leadForms is publicly readable so the public form page can load settings. */
  publicRead?: boolean
}

const SPECS: Spec[] = [
  { name: 'Goals',                     path: (c) => `Goals/${c}` },
  { name: 'commissionStructures',      path: (c) => `commissionStructures/${c}` },
  { name: 'leadForms',                 path: (c) => `leadForms/${c}`, publicRead: true },
  { name: 'companies/{id}/settings',   path: (c) => `companies/${c}/settings/pickerLists` },
]

let env: RulesTestEnvironment

beforeAll(async () => { env = await setupTestEnv('rules-docid-scoped') })
afterAll(async () => { await env.cleanup() })
beforeEach(async () => { await resetAndSeedUsers(env) })

describe.each(SPECS)('$name', (spec) => {
  const pathA = spec.path(COMPANY_A)

  it('lets the owning company read', async () => {
    await seedDoc(env, pathA, { value: 'a' })
    await assertSucceeds(getDoc(doc(asUser(env, ALICE).firestore(), pathA)))
  })

  it('denies reads from another company', async () => {
    await seedDoc(env, pathA, { value: 'a' })
    const read = getDoc(doc(asUser(env, BOB).firestore(), pathA))
    if (spec.publicRead) await assertSucceeds(read)
    else await assertFails(read)
  })

  it('denies reads from a user with no companyId claim', async () => {
    await seedDoc(env, pathA, { value: 'a' })
    const read = getDoc(doc(asUser(env, NOCLAIM).firestore(), pathA))
    if (spec.publicRead) await assertSucceeds(read)
    else await assertFails(read)
  })

  it('lets the owning company write', async () => {
    await assertSucceeds(setDoc(doc(asUser(env, ALICE).firestore(), pathA), { value: 'a' }))
  })

  it('denies writes from another company', async () => {
    await assertFails(setDoc(doc(asUser(env, BOB).firestore(), pathA), { value: 'hijacked' }))
  })

  it('denies writes to another company document', async () => {
    const pathB = spec.path(COMPANY_B)
    await assertFails(setDoc(doc(asUser(env, ALICE).firestore(), pathB), { value: 'hijacked' }))
  })

  it('denies writes by a viewer', async () => {
    await assertFails(setDoc(doc(asUser(env, VIEWER_A).firestore(), pathA), { value: 'edited' }))
  })

  it('denies anonymous writes', async () => {
    await assertFails(setDoc(doc(asAnonymous(env).firestore(), pathA), { value: 'edited' }))
  })
})

describe('settings/pickerLists (retired shared document)', () => {
  const path = 'settings/pickerLists'

  // This document predated multi-tenancy and was shared by every company, so
  // one tenant's edit rewrote every tenant's lists. Picker lists now live at
  // companies/{id}/settings/pickerLists and this path is closed outright —
  // pinned here so it can't be quietly reopened.
  it('denies reads to a signed-in owner', async () => {
    await seedDoc(env, path, { leadStatus: ['New'] })
    await assertFails(getDoc(doc(asUser(env, ALICE).firestore(), path)))
  })

  it('denies reads from another company', async () => {
    await seedDoc(env, path, { leadStatus: ['New'] })
    await assertFails(getDoc(doc(asUser(env, BOB).firestore(), path)))
  })

  it('denies writes even to an owner', async () => {
    await assertFails(setDoc(doc(asUser(env, ALICE).firestore(), path), { leadStatus: ['New'] }))
  })

  it('denies anonymous reads', async () => {
    await seedDoc(env, path, { leadStatus: ['New'] })
    await assertFails(getDoc(doc(asAnonymous(env).firestore(), path)))
  })
})
