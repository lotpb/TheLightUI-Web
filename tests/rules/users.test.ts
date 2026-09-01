import { beforeAll, afterAll, beforeEach, describe, it } from 'vitest'
import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { collection, doc, getDoc, getDocs, query, setDoc, updateDoc, deleteDoc, where } from 'firebase/firestore'
import {
  setupTestEnv, resetAndSeedUsers, asUser, asAnonymous, seedDoc,
  COMPANY_A, COMPANY_B, ALICE, ADMIN_A, VIEWER_A, SALES_A, BOB,
} from './helpers'

let env: RulesTestEnvironment

beforeAll(async () => { env = await setupTestEnv('rules-users') })
afterAll(async () => { await env.cleanup() })
beforeEach(async () => { await resetAndSeedUsers(env) })

describe('users', () => {
  it('lets a user read their own profile', async () => {
    await assertSucceeds(getDoc(doc(asUser(env, ALICE).firestore(), `users/${ALICE}`)))
  })

  it('lets a teammate read a same-company profile', async () => {
    await assertSucceeds(getDoc(doc(asUser(env, ALICE).firestore(), `users/${SALES_A}`)))
  })

  it('denies reading a profile in another company', async () => {
    await assertFails(getDoc(doc(asUser(env, ALICE).firestore(), `users/${BOB}`)))
  })

  it('denies an unfiltered user list', async () => {
    await assertFails(getDocs(collection(asUser(env, ALICE).firestore(), 'users')))
  })

  it('lets a member list their own company teammates', async () => {
    await assertSucceeds(
      getDocs(query(collection(asUser(env, ALICE).firestore(), 'users'), where('companyId', '==', COMPANY_A))),
    )
  })

  it('denies listing another company teammates', async () => {
    await assertFails(
      getDocs(query(collection(asUser(env, ALICE).firestore(), 'users'), where('companyId', '==', COMPANY_B))),
    )
  })

  it('lets a user edit their own profile', async () => {
    await assertSucceeds(updateDoc(doc(asUser(env, ALICE).firestore(), `users/${ALICE}`), { firstName: 'Ally' }))
  })

  it('lets an owner change a teammate role', async () => {
    await assertSucceeds(updateDoc(doc(asUser(env, ALICE).firestore(), `users/${SALES_A}`), { role: 'admin' }))
  })

  it('lets an admin change a teammate role', async () => {
    await assertSucceeds(updateDoc(doc(asUser(env, ADMIN_A).firestore(), `users/${SALES_A}`), { role: 'viewer' }))
  })

  it('denies a salesman changing a teammate role', async () => {
    await assertFails(updateDoc(doc(asUser(env, SALES_A).firestore(), `users/${VIEWER_A}`), { role: 'owner' }))
  })

  it('denies a viewer changing a teammate role', async () => {
    await assertFails(updateDoc(doc(asUser(env, VIEWER_A).firestore(), `users/${SALES_A}`), { role: 'owner' }))
  })

  it('denies an owner changing a role in another company', async () => {
    await assertFails(updateDoc(doc(asUser(env, ALICE).firestore(), `users/${BOB}`), { role: 'viewer' }))
  })

  it('denies an owner editing fields other than role and companyId on a teammate', async () => {
    await assertFails(updateDoc(doc(asUser(env, ALICE).firestore(), `users/${SALES_A}`), { firstName: 'Renamed' }))
  })

  it('denies deleting a user document', async () => {
    await assertFails(deleteDoc(doc(asUser(env, ALICE).firestore(), `users/${ALICE}`)))
    await assertFails(deleteDoc(doc(asUser(env, ALICE).firestore(), `users/${SALES_A}`)))
  })

  it('denies anonymous reads', async () => {
    await assertFails(getDoc(doc(asAnonymous(env).firestore(), `users/${ALICE}`)))
  })
})

describe('messages', () => {
  // messages/{ownerId}/{contactId}/{messageId} — each side keeps its own copy.
  const aliceCopy = `messages/${ALICE}/${SALES_A}/msg-1`
  const salesCopy = `messages/${SALES_A}/${ALICE}/msg-1`
  const body = { fromId: ALICE, toId: SALES_A, text: 'hello' }

  it('lets the path owner read their copy', async () => {
    await seedDoc(env, aliceCopy, body)
    await assertSucceeds(getDoc(doc(asUser(env, ALICE).firestore(), aliceCopy)))
  })

  it('denies reading someone else inbox', async () => {
    await seedDoc(env, salesCopy, body)
    await assertFails(getDoc(doc(asUser(env, BOB).firestore(), salesCopy)))
  })

  it('lets the sender write both copies of a message', async () => {
    const db = asUser(env, ALICE).firestore()
    await assertSucceeds(setDoc(doc(db, aliceCopy), body))
    await assertSucceeds(setDoc(doc(db, salesCopy), body))
  })

  it('denies forging a message from another user', async () => {
    const db = asUser(env, BOB).firestore()
    await assertFails(setDoc(doc(db, salesCopy), { fromId: ALICE, toId: SALES_A, text: 'forged' }))
  })

  it('denies planting a message in an unrelated inbox', async () => {
    const db = asUser(env, ALICE).firestore()
    await assertFails(setDoc(doc(db, `messages/${BOB}/${SALES_A}/msg-2`), body))
  })

  it('denies editing or deleting a sent message', async () => {
    await seedDoc(env, aliceCopy, body)
    const db = asUser(env, ALICE).firestore()
    await assertFails(updateDoc(doc(db, aliceCopy), { text: 'edited' }))
    await assertFails(deleteDoc(doc(db, aliceCopy)))
  })
})

describe('recent_messages', () => {
  const aliceInbox = `recent_messages/${ALICE}/messages/${SALES_A}`

  it('lets the inbox owner read and write their own entry', async () => {
    const db = asUser(env, ALICE).firestore()
    await assertSucceeds(setDoc(doc(db, aliceInbox), { fromId: ALICE, text: 'hi' }))
    await assertSucceeds(getDoc(doc(db, aliceInbox)))
  })

  it('lets a sender stamp the recipient inbox entry', async () => {
    const db = asUser(env, ALICE).firestore()
    await assertSucceeds(
      setDoc(doc(db, `recent_messages/${SALES_A}/messages/${ALICE}`), { fromId: ALICE, text: 'hi' }),
    )
  })

  it('denies reading another user inbox', async () => {
    await seedDoc(env, aliceInbox, { fromId: SALES_A, text: 'hi' })
    await assertFails(getDoc(doc(asUser(env, BOB).firestore(), aliceInbox)))
  })

  it('denies writing an inbox entry attributed to someone else', async () => {
    await assertFails(
      setDoc(doc(asUser(env, BOB).firestore(), aliceInbox), { fromId: SALES_A, text: 'forged' }),
    )
  })
})
