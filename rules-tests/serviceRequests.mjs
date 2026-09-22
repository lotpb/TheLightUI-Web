/**
 * Firestore rules tests for the public serviceRequests create path.
 *
 * Run against the emulator, not the vitest suite — the suite must stay
 * runnable without Java:
 *
 *   npx firebase-tools emulators:exec --only firestore \
 *     "node rules-tests/serviceRequests.mjs"
 *
 * serviceRequests had `allow create: if true`, so this exists to prove two
 * things at once: that the tightened rule still accepts exactly what the
 * customer portal sends, and that it rejects everything else. The first half
 * matters more — a rule that's too strict on a public form fails silently, and
 * nobody on the company's side ever sees the submission that didn't arrive.
 */
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} from '@firebase/rules-unit-testing'
import { readFileSync } from 'fs'
import {
  addDoc, collection, serverTimestamp, setDoc, doc,
} from 'firebase/firestore'

const PROJECT_ID = 'thelightui-rules-test'
const TOKEN       = 'portal-token-abc123'
const OTHER_TOKEN = 'portal-token-zzz999'
const COMPANY     = 'company-1'
const CUSTOMER    = 'customer-1'

let passed = 0
let failed = 0

async function check(name, fn) {
  try {
    await fn()
    console.log(`  ✓ ${name}`)
    passed++
  } catch (err) {
    console.error(`  ✗ ${name}\n      ${err?.message ?? err}`)
    failed++
  }
}

const testEnv = await initializeTestEnvironment({
  projectId: PROJECT_ID,
  firestore: {
    rules: readFileSync('firestore.rules', 'utf8'),
    host: '127.0.0.1',
    port: 8080,
  },
})

// Two issued portals, so "a valid token for the wrong customer" is testable.
await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore()
  await setDoc(doc(db, 'customerPortals', TOKEN), {
    companyId: COMPANY, customerId: CUSTOMER, customerName: 'Jane Doe',
  })
  await setDoc(doc(db, 'customerPortals', OTHER_TOKEN), {
    companyId: 'company-2', customerId: 'customer-2', customerName: 'Other Person',
  })
})

/** Exactly what submitServiceRequest() in customerPortalService.ts writes. */
function portalPayload(over = {}) {
  return {
    token:         TOKEN,
    companyId:     COMPANY,
    customerId:    CUSTOMER,
    name:          'Jane Doe',
    phone:         '(555) 123-4567',
    email:         'jane@example.com',
    description:   'Air conditioning is making a grinding noise.',
    preferredDate: '2026-09-25',
    status:        'new',
    createdAt:     serverTimestamp(),
    ...over,
  }
}

const anon = () => testEnv.unauthenticatedContext().firestore()
const create = (payload) => addDoc(collection(anon(), 'serviceRequests'), payload)

console.log('\nserviceRequests create — what the portal sends must still work')

await check('the exact portal payload is accepted', () =>
  assertSucceeds(create(portalPayload())))

await check('a blank phone is accepted (the form does not require one)', () =>
  assertSucceeds(create(portalPayload({ phone: '' }))))

await check('a blank email is accepted', () =>
  assertSucceeds(create(portalPayload({ email: '' }))))

await check('a blank preferredDate is accepted (the date picker is optional)', () =>
  assertSucceeds(create(portalPayload({ preferredDate: '' }))))

await check('a blank name is accepted (customer records can have none)', () =>
  assertSucceeds(create(portalPayload({ name: '' }))))

await check('all three optional fields blank at once is accepted', () =>
  assertSucceeds(create(portalPayload({ name: '', phone: '', email: '', preferredDate: '' }))))

await check('a long but plausible description is accepted', () =>
  assertSucceeds(create(portalPayload({ description: 'x'.repeat(4000) }))))

console.log('\nserviceRequests create — the hole that was open')

await check('a token that was never issued is rejected', () =>
  assertFails(create(portalPayload({ token: 'never-issued' }))))

await check('an empty token is rejected', () =>
  assertFails(create(portalPayload({ token: '' }))))

await check('a valid token cannot file against another company', () =>
  assertFails(create(portalPayload({ token: OTHER_TOKEN }))))

await check('a valid token cannot file against another customer', () =>
  assertFails(create(portalPayload({ customerId: 'customer-99' }))))

await check('a valid token cannot claim a different companyId', () =>
  assertFails(create(portalPayload({ companyId: 'company-2' }))))

console.log('\nserviceRequests create — shape and bounds')

await check('an arbitrary document is rejected', () =>
  assertFails(create({ anything: 'at all' })))

await check('an extra field is rejected', () =>
  assertFails(create(portalPayload({ injected: 'surprise' }))))

await check('a missing field is rejected', () => {
  const { phone, ...withoutPhone } = portalPayload()
  return assertFails(create(withoutPhone))
})

await check('the submitter cannot choose its own status', () =>
  assertFails(create(portalPayload({ status: 'resolved' }))))

await check('a client-chosen createdAt is rejected', () =>
  assertFails(create(portalPayload({ createdAt: new Date('2020-01-01') }))))

await check('an empty description is rejected', () =>
  assertFails(create(portalPayload({ description: '' }))))

await check('a megabyte of description is rejected', () =>
  assertFails(create(portalPayload({ description: 'x'.repeat(1_000_000) }))))

// The exact edges, because this is where the client and the rule have to agree
// and where a <= / < slip lives. models/portalRequest.ts validates against
// these same numbers, and portalRequest.test.ts parses them out of the rules
// file — these two prove the real engine draws the line in the same place.
await check('a description of exactly 4000 characters is accepted', () =>
  assertSucceeds(create(portalPayload({ description: 'x'.repeat(4000) }))))

await check('a description of 4001 characters is rejected', () =>
  assertFails(create(portalPayload({ description: 'x'.repeat(4001) }))))

await check('a name of exactly 200 characters is accepted', () =>
  assertSucceeds(create(portalPayload({ name: 'x'.repeat(200) }))))

await check('a preferredDate of exactly 40 characters is accepted', () =>
  assertSucceeds(create(portalPayload({ preferredDate: 'x'.repeat(40) }))))

await check('a preferredDate of 41 characters is rejected', () =>
  assertFails(create(portalPayload({ preferredDate: 'x'.repeat(41) }))))

await check('an over-long name is rejected', () =>
  assertFails(create(portalPayload({ name: 'x'.repeat(201) }))))

await check('an over-long email is rejected', () =>
  assertFails(create(portalPayload({ email: 'x'.repeat(321) }))))

await check('a non-string description is rejected', () =>
  assertFails(create(portalPayload({ description: 12345 }))))

await check('an empty companyId is rejected', () =>
  assertFails(create(portalPayload({ companyId: '' }))))

console.log('\nserviceRequests read — unchanged, still company-scoped')

/**
 * The read rule is per-document (`resource.data.companyId == claimed`), so a
 * list only authorizes when the query itself is constrained to that company —
 * which is exactly how subscribeToServiceRequests builds it. An unconstrained
 * getDocs(collection(...)) fails even for the owning company, by design.
 */
const scopedQuery = async (db, companyId) => {
  const { getDocs, query, where } = await import('firebase/firestore')
  return getDocs(query(collection(db, 'serviceRequests'), where('companyId', '==', companyId)))
}

await check('an anonymous visitor cannot read submissions back', () =>
  assertFails(scopedQuery(anon(), COMPANY)))

await check('a member of another company cannot read this company’s', () => {
  const other = testEnv.authenticatedContext('u2', { companyId: 'company-2', role: 'owner' }).firestore()
  return assertFails(scopedQuery(other, COMPANY))
})

await check('the owning company can read them, queried the way the app does', () => {
  const mine = testEnv.authenticatedContext('u1', { companyId: COMPANY, role: 'owner' }).firestore()
  return assertSucceeds(scopedQuery(mine, COMPANY))
})

await check('an unconstrained list fails even for the owning company', async () => {
  const { getDocs } = await import('firebase/firestore')
  const mine = testEnv.authenticatedContext('u1', { companyId: COMPANY, role: 'owner' }).firestore()
  return assertFails(getDocs(collection(mine, 'serviceRequests')))
})

await testEnv.cleanup()

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed === 0 ? 0 : 1)
