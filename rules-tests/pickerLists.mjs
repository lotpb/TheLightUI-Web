/**
 * Firestore rules tests for the dropdown (picker) lists.
 *
 *   npx firebase-tools emulators:exec --only firestore "node rules-tests/pickerLists.mjs"
 *
 * The iOS app read and wrote one top-level settings/pickerLists shared by
 * every company, open to any signed-in user. It's closed now; each company's
 * lists live at companies/{companyId}/settings/pickerLists. This proves the
 * old path is shut to everyone and the per-company one is tenant-isolated.
 */
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing'
import { readFileSync } from 'fs'
import { doc, getDoc, setDoc } from 'firebase/firestore'

let passed = 0, failed = 0
async function check(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++ }
  catch (err) { console.error(`  ✗ ${name}\n      ${err?.message ?? err}`); failed++ }
}

const testEnv = await initializeTestEnvironment({
  projectId: 'thelightui-rules-test',
  firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
})

await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore()
  await setDoc(doc(db, 'settings/pickerLists'), { salesman: ['', 'Peter'] })
  await setDoc(doc(db, 'companies/co-a/settings/pickerLists'), { salesman: ['Peter'] })
  for (const [uid, role] of [['owner-a', 'owner'], ['sales-a', 'salesman'], ['viewer-a', 'viewer'], ['owner-b', 'owner']]) {
    await setDoc(doc(db, `users/${uid}`), { role, companyId: uid.endsWith('-b') ? 'co-b' : 'co-a' })
  }
})

const as = (uid) => testEnv.authenticatedContext(uid, { companyId: uid.endsWith('-b') ? 'co-b' : 'co-a' }).firestore()

console.log('legacy settings/pickerLists')
for (const uid of ['owner-a', 'owner-b']) {
  await check(`${uid} cannot read it`, () => assertFails(getDoc(doc(as(uid), 'settings/pickerLists'))))
  await check(`${uid} cannot write it`, () => assertFails(setDoc(doc(as(uid), 'settings/pickerLists'), { salesman: ['x'] })))
}
await check('signed-out cannot read it', () =>
  assertFails(getDoc(doc(testEnv.unauthenticatedContext().firestore(), 'settings/pickerLists'))))

console.log('companies/{id}/settings/pickerLists')
await check('own company can read', () => assertSucceeds(getDoc(doc(as('sales-a'), 'companies/co-a/settings/pickerLists'))))
await check('salesman can write own company (iOS arrayUnion path)', () =>
  assertSucceeds(setDoc(doc(as('sales-a'), 'companies/co-a/settings/pickerLists'), { job: ['Roof'] }, { merge: true })))
await check('viewer cannot write', () =>
  assertFails(setDoc(doc(as('viewer-a'), 'companies/co-a/settings/pickerLists'), { job: ['x'] }, { merge: true })))
await check('another company cannot read', () => assertFails(getDoc(doc(as('owner-b'), 'companies/co-a/settings/pickerLists'))))
await check('another company cannot write', () =>
  assertFails(setDoc(doc(as('owner-b'), 'companies/co-a/settings/pickerLists'), { job: ['x'] }, { merge: true })))

await testEnv.cleanup()
console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
