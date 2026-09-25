/**
 * Firestore rules tests for companies/{companyId}/settings/{doc}.
 *
 *   npx firebase-tools emulators:exec --only firestore "node rules-tests/companySettings.mjs"
 *
 * That path was one rule for every document: any non-viewer could write any
 * of them. Each document now names who may write it, and profile.smsNumber
 * can't claim a number another company's smsNumberIndex entry already holds.
 */
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing'
import { readFileSync } from 'fs'
import { doc, setDoc, getDoc, deleteDoc } from 'firebase/firestore'

let passed = 0, failed = 0
async function check(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++ }
  catch (err) { console.error(`  ✗ ${name}\n      ${err?.message ?? err}`); failed++ }
}

const testEnv = await initializeTestEnvironment({
  projectId: 'thelightui-rules-test',
  firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
})

const USERS = {
  'owner-a': ['owner', 'co-a'], 'admin-a': ['admin', 'co-a'], 'sales-a': ['salesman', 'co-a'],
  'member-a': ['member', 'co-a'], 'viewer-a': ['viewer', 'co-a'], 'owner-b': ['owner', 'co-b'],
}
await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore()
  for (const [uid, [role, companyId]] of Object.entries(USERS)) await setDoc(doc(db, `users/${uid}`), { role, companyId })
  await setDoc(doc(db, 'companies/co-a/settings/profile'), { name: 'A Co', smsNumber: '+15550000001' })
  await setDoc(doc(db, 'smsNumberIndex/+15550000001'), { companyId: 'co-a' })
  await setDoc(doc(db, 'smsNumberIndex/+15550000002'), { companyId: 'co-b' })
  await setDoc(doc(db, 'companies/co-a/settings/stripeConnectStatus'), { connected: true })
})
const as = (uid) => testEnv.authenticatedContext(uid, { companyId: USERS[uid][1] }).firestore()
const put = (uid, id, data) => setDoc(doc(as(uid), `companies/co-a/settings/${id}`), data, { merge: true })

console.log('team working state (any non-viewer)')
for (const id of ['pickerLists', 'onboarding', 'duplicateDismissals']) {
  await check(`salesman can write ${id}`, () => assertSucceeds(put('sales-a', id, { x: 1 })))
  await check(`member can write ${id}`, () => assertSucceeds(put('member-a', id, { x: 1 })))
  await check(`viewer cannot write ${id}`, () => assertFails(put('viewer-a', id, { x: 1 })))
}

console.log('company configuration (owner/admin)')
for (const id of ['profile', 'pipelineStages', 'targets']) {
  await check(`admin can write ${id}`, () => assertSucceeds(put('admin-a', id, { name: 'A Co 2' })))
  await check(`salesman cannot write ${id}`, () => assertFails(put('sales-a', id, { name: 'x' })))
  await check(`member cannot write ${id}`, () => assertFails(put('member-a', id, { name: 'x' })))
}
await check('salesman cannot delete profile', () => assertFails(deleteDoc(doc(as('sales-a'), 'companies/co-a/settings/profile'))))

console.log('server-only status docs')
for (const id of ['stripeConnectStatus', 'quickbooksStatus', 'financingStatus', 'facebookStatus']) {
  await check(`owner cannot write ${id}`, () => assertFails(put('owner-a', id, { connected: true })))
}
await check('owner can still read a status doc', () =>
  assertSucceeds(getDoc(doc(as('owner-a'), 'companies/co-a/settings/stripeConnectStatus'))))
await check('an unlisted settings doc is denied', () => assertFails(put('owner-a', 'anythingElse', { x: 1 })))

console.log('smsNumber claims')
await check('keeping the current number is allowed', () => assertSucceeds(put('owner-a', 'profile', { smsNumber: '+15550000001', name: 'A' })))
await check('a number indexed to this company is allowed', () => assertSucceeds(put('owner-a', 'profile', { smsNumber: '+15550000001' })))
await check('an unindexed number is allowed', () => assertSucceeds(put('owner-a', 'profile', { smsNumber: '+15550000009' })))
await check("another company's number is refused", () => assertFails(put('owner-a', 'profile', { smsNumber: '+15550000002' })))
await check('clearing the number is allowed', () => assertSucceeds(put('owner-a', 'profile', { smsNumber: '' })))
await check("company B cannot write company A's settings", () =>
  assertFails(setDoc(doc(as('owner-b'), 'companies/co-a/settings/profile'), { name: 'x' }, { merge: true })))

await testEnv.cleanup()
console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
