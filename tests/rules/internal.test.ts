import { beforeAll, afterAll, beforeEach, describe, it } from 'vitest'
import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc } from 'firebase/firestore'
import {
  setupTestEnv, resetAndSeedUsers, asUser, asAnonymous, seedDoc,
  COMPANY_A, ALICE, BOB,
} from './helpers'

/**
 * Collections that hold provider credentials, tenancy-resolution indexes, or
 * abuse counters. Cloud Functions reach them through the admin SDK, which
 * bypasses rules entirely — so no client, however privileged, may touch them.
 *
 * These are the highest-consequence rules in the file: a regression here leaks
 * OAuth tokens and API keys rather than CRM records.
 */
const LOCKED_DOWN = [
  'smsNumberIndex',
  'smsOptOuts',
  'quickbooksTokens',
  'oauthStates',
  'stripeConnectAccounts',
  'facebookTokens',
  'facebookPageIndex',
  'facebookLeadgenIds',
  'aiUsage',
  'financingCredentials',
]

let env: RulesTestEnvironment

beforeAll(async () => { env = await setupTestEnv('rules-internal') })
afterAll(async () => { await env.cleanup() })
beforeEach(async () => { await resetAndSeedUsers(env) })

describe.each(LOCKED_DOWN)('%s (Cloud Functions only)', (name) => {
  const path = `${name}/${COMPANY_A}`

  it('denies reads even to the owning company owner', async () => {
    await seedDoc(env, path, { companyId: COMPANY_A, secret: 'token-value' })
    await assertFails(getDoc(doc(asUser(env, ALICE).firestore(), path)))
  })

  it('denies reads to another company', async () => {
    await seedDoc(env, path, { companyId: COMPANY_A, secret: 'token-value' })
    await assertFails(getDoc(doc(asUser(env, BOB).firestore(), path)))
  })

  it('denies anonymous reads', async () => {
    await seedDoc(env, path, { companyId: COMPANY_A, secret: 'token-value' })
    await assertFails(getDoc(doc(asAnonymous(env).firestore(), path)))
  })

  it('denies listing the collection', async () => {
    await seedDoc(env, path, { companyId: COMPANY_A, secret: 'token-value' })
    await assertFails(getDocs(collection(asUser(env, ALICE).firestore(), name)))
  })

  it('denies creates', async () => {
    await assertFails(setDoc(doc(asUser(env, ALICE).firestore(), path), { companyId: COMPANY_A }))
  })

  it('denies updates', async () => {
    await seedDoc(env, path, { companyId: COMPANY_A, secret: 'token-value' })
    await assertFails(updateDoc(doc(asUser(env, ALICE).firestore(), path), { secret: 'overwritten' }))
  })

  it('denies deletes', async () => {
    await seedDoc(env, path, { companyId: COMPANY_A, secret: 'token-value' })
    await assertFails(deleteDoc(doc(asUser(env, ALICE).firestore(), path)))
  })
})

describe('claimRefreshSignals', () => {
  it('lets a user read their own signal', async () => {
    await seedDoc(env, `claimRefreshSignals/${ALICE}`, { at: 1 })
    await assertSucceeds(getDoc(doc(asUser(env, ALICE).firestore(), `claimRefreshSignals/${ALICE}`)))
  })

  it('denies reading another user signal', async () => {
    await seedDoc(env, `claimRefreshSignals/${ALICE}`, { at: 1 })
    await assertFails(getDoc(doc(asUser(env, BOB).firestore(), `claimRefreshSignals/${ALICE}`)))
  })

  it('denies writing your own signal (Functions-only)', async () => {
    await assertFails(setDoc(doc(asUser(env, ALICE).firestore(), `claimRefreshSignals/${ALICE}`), { at: 2 }))
  })
})
