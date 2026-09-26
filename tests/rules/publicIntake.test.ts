import { beforeAll, afterAll, beforeEach, describe, it } from 'vitest'
import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { addDoc, collection, serverTimestamp } from 'firebase/firestore'
import {
  setupTestEnv, resetAndSeedUsers, asAnonymous, seedDoc,
  COMPANY_A, COMPANY_B,
} from './helpers'

/**
 * The two collections anyone on the internet can write to: service requests
 * from the customer portal, and submissions from the public lead form.
 *
 * Each payload below is built exactly the way its real client builds it
 * (customerPortalService.submitServiceRequest, leadFormService.submitLead), so
 * if a rule change would break a live form, the "accepted" case here fails.
 * The negative cases pin what makes the write safe to leave unauthenticated:
 * an exact field shape, a server-owned status, and proof of a real entry point.
 */

let env: RulesTestEnvironment

beforeAll(async () => { env = await setupTestEnv('rules-public-intake') })
afterAll(async () => { await env.cleanup() })
beforeEach(async () => { await resetAndSeedUsers(env) })

describe('serviceRequests (customer portal)', () => {
  const TOKEN = 'portal-token-abc'
  const CUSTOMER = 'customer-1'

  function request(overrides: Record<string, unknown> = {}) {
    return {
      token: TOKEN,
      companyId: COMPANY_A,
      customerId: CUSTOMER,
      name: 'Ann Lee',
      phone: '555-0100',
      email: 'ann@example.com',
      description: 'Furnace is making a noise',
      preferredDate: '2026-10-01',
      status: 'new',
      createdAt: serverTimestamp(),
      ...overrides,
    }
  }

  beforeEach(async () => {
    await seedDoc(env, `customerPortals/${TOKEN}`, { companyId: COMPANY_A, customerId: CUSTOMER })
  })

  const submit = (data: Record<string, unknown>) =>
    addDoc(collection(asAnonymous(env).firestore(), 'serviceRequests'), data)

  it('accepts the portal payload with a matching token', async () => {
    await assertSucceeds(submit(request()))
  })

  it('denies a token with no portal behind it', async () => {
    await assertFails(submit(request({ token: 'made-up-token' })))
  })

  it('denies a real token pointed at another company', async () => {
    await assertFails(submit(request({ companyId: COMPANY_B })))
  })

  it('denies a real token pointed at another customer', async () => {
    await assertFails(submit(request({ customerId: 'customer-2' })))
  })

  it('denies a submitter choosing its own status', async () => {
    await assertFails(submit(request({ status: 'scheduled' })))
  })

  it('denies an extra field smuggled into the request', async () => {
    await assertFails(submit(request({ assignedTo: 'uid-bob' })))
  })

  it('denies an empty description', async () => {
    await assertFails(submit(request({ description: '' })))
  })
})

describe('leadSubmissions (public lead form)', () => {
  function submission(companyId: string, overrides: Record<string, unknown> = {}) {
    return {
      companyId,
      first: 'Ann',
      lastname: 'Lee',
      email: 'ann@example.com',
      phone: '555-0100',
      street: '',
      city: '',
      state: '',
      zip: '',
      message: 'Looking for a quote',
      status: 'new',
      submittedAt: serverTimestamp(),
      ...overrides,
    }
  }

  const submit = (data: Record<string, unknown>) =>
    addDoc(collection(asAnonymous(env).firestore(), 'leadSubmissions'), data)

  it('accepts the form payload when the company form is enabled', async () => {
    await seedDoc(env, `leadForms/${COMPANY_A}`, { enabled: true })
    await assertSucceeds(submit(submission(COMPANY_A)))
  })

  it('denies submissions to a disabled form', async () => {
    await seedDoc(env, `leadForms/${COMPANY_A}`, { enabled: false })
    await assertFails(submit(submission(COMPANY_A)))
  })

  it('denies submissions to a company with no form', async () => {
    // The public page shows its error state in this case and never renders a
    // submittable form, so the rule and the UI agree.
    await assertFails(submit(submission('company-without-a-form')))
  })

  it('denies a submitter choosing its own status', async () => {
    await seedDoc(env, `leadForms/${COMPANY_A}`, { enabled: true })
    await assertFails(submit(submission(COMPANY_A, { status: 'won' })))
  })

  it('denies an extra field smuggled into the submission', async () => {
    await seedDoc(env, `leadForms/${COMPANY_A}`, { enabled: true })
    await assertFails(submit(submission(COMPANY_A, { assignedToUid: 'uid-bob' })))
  })

  it('denies a submission missing a required field', async () => {
    await seedDoc(env, `leadForms/${COMPANY_A}`, { enabled: true })
    const { email: _omit, ...withoutEmail } = submission(COMPANY_A)
    await assertFails(submit(withoutEmail))
  })
})
