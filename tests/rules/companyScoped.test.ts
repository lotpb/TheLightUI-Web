import { beforeAll, afterAll, beforeEach, describe, it } from 'vitest'
import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { collection, doc, getDoc, getDocs, query, setDoc, updateDoc, deleteDoc, where } from 'firebase/firestore'
import {
  setupTestEnv, resetAndSeedUsers, asUser, asAnonymous, seedDoc,
  COMPANY_A, COMPANY_B, ALICE, VIEWER_A, BOB, NOCLAIM,
} from './helpers'

/**
 * The core multi-tenancy invariant, applied to every company-scoped collection:
 *
 *   1. A member of company A can read and write company A's documents.
 *   2. A member of company B can do NONE of those things to company A's documents.
 *   3. A viewer (read-only role) can read but not write.
 *   4. A user with no companyId claim, and an anonymous caller, can do nothing.
 *
 * These are table-driven because firestore.rules implements the same five-line
 * block ~40 times; a per-collection hand-written test would drift from it.
 */

interface Spec {
  /** Collection name as it appears in firestore.rules. */
  name: string
  /** Create is Cloud-Functions-only (admin SDK bypasses rules). */
  functionsOnlyCreate?: boolean
  /** Anyone, including unauthenticated callers, may create (public intake forms). */
  publicCreate?: boolean
  /** No `allow update` in the rule at all — updates are denied for everyone. */
  noUpdate?: boolean
  /** Update is a shared "mark read" flag, intentionally allowed for viewers. */
  viewerCanUpdate?: boolean
  /** Entirely read-only for clients: no create, update, or delete. */
  readOnly?: boolean
  /** Extra fields required by the rule beyond companyId. */
  extra?: Record<string, unknown>
}

const SPECS: Spec[] = [
  // Standard CRUD, viewer read-only.
  { name: 'Customers' },
  { name: 'Expenses' },
  { name: 'ToDoItems' },
  { name: 'ServicePlans' },
  { name: 'Warranties' },
  { name: 'Activities' },
  { name: 'Invoices' },
  { name: 'dispatchAssignments' },
  { name: 'Proposals' },
  // Upload metadata is immutable: documentService only creates and deletes,
  // and the rule has no `allow update` to match.
  { name: 'Documents', noUpdate: true },
  { name: 'docTemplates' },
  { name: 'campaigns' },
  { name: 'campaignRecipients' },
  { name: 'apiKeys' },
  { name: 'webhookSubscriptions' },
  { name: 'purchaseOrders' },
  { name: 'savedViews' },
  { name: 'customFieldDefs' },
  { name: 'automationRules' },
  { name: 'messageTemplates' },
  { name: 'sequences' },
  { name: 'sequenceEnrollments' },
  { name: 'catalog' },
  { name: 'timeEntries' },

  // Public intake: anyone can create, only the owning company can read back.
  { name: 'serviceRequests', publicCreate: true },
  { name: 'leadSubmissions', publicCreate: true },

  // Referrals have no update rule.
  { name: 'referrals', noUpdate: true },

  // Written by Cloud Functions; clients read and toggle a read flag.
  { name: 'notifications',  functionsOnlyCreate: true, viewerCanUpdate: true },
  { name: 'emailMessages',  functionsOnlyCreate: true, viewerCanUpdate: true },
  { name: 'smsMessages',    functionsOnlyCreate: true, viewerCanUpdate: true },

  // Fully read-only for clients.
  { name: 'auditLog',               readOnly: true },
  { name: 'automationLog',          readOnly: true },
  { name: 'facebookLeadErrors',     readOnly: true },
  { name: 'financingApplications',  readOnly: true },
]

let env: RulesTestEnvironment

beforeAll(async () => { env = await setupTestEnv('rules-company-scoped') })
afterAll(async () => { await env.cleanup() })
beforeEach(async () => { await resetAndSeedUsers(env) })

describe.each(SPECS)('$name', (spec) => {
  const docA = `${spec.name}/doc-owned-by-a`
  const docB = `${spec.name}/doc-owned-by-b`
  const base = { ...spec.extra }

  async function seedBoth() {
    await seedDoc(env, docA, { ...base, companyId: COMPANY_A, title: 'A record' })
    await seedDoc(env, docB, { ...base, companyId: COMPANY_B, title: 'B record' })
  }

  // ── Reads ────────────────────────────────────────────────────────────────

  it('lets a member read their own company document', async () => {
    await seedBoth()
    const db = asUser(env, ALICE).firestore()
    await assertSucceeds(getDoc(doc(db, docA)))
  })

  it('denies reading another company document', async () => {
    await seedBoth()
    const db = asUser(env, BOB).firestore()
    await assertFails(getDoc(doc(db, docA)))
  })

  it('lets a member list their own company documents', async () => {
    await seedBoth()
    const db = asUser(env, ALICE).firestore()
    await assertSucceeds(
      getDocs(query(collection(db, spec.name), where('companyId', '==', COMPANY_A))),
    )
  })

  it('denies an unfiltered list', async () => {
    await seedBoth()
    const db = asUser(env, ALICE).firestore()
    await assertFails(getDocs(collection(db, spec.name)))
  })

  it('denies listing another company documents', async () => {
    await seedBoth()
    const db = asUser(env, BOB).firestore()
    await assertFails(
      getDocs(query(collection(db, spec.name), where('companyId', '==', COMPANY_A))),
    )
  })

  it('denies reads from a user with no companyId claim', async () => {
    await seedBoth()
    const db = asUser(env, NOCLAIM).firestore()
    await assertFails(getDoc(doc(db, docA)))
  })

  it('denies reads from an anonymous caller', async () => {
    await seedBoth()
    const db = asAnonymous(env).firestore()
    await assertFails(getDoc(doc(db, docA)))
  })

  it('lets a viewer read', async () => {
    await seedBoth()
    const db = asUser(env, VIEWER_A).firestore()
    await assertSucceeds(getDoc(doc(db, docA)))
  })

  // ── Creates ──────────────────────────────────────────────────────────────

  if (spec.readOnly || spec.functionsOnlyCreate) {
    it('denies client creates', async () => {
      const db = asUser(env, ALICE).firestore()
      await assertFails(setDoc(doc(db, `${spec.name}/new-doc`), { ...base, companyId: COMPANY_A }))
    })
  } else if (spec.publicCreate) {
    it('allows an anonymous create (public intake form)', async () => {
      const db = asAnonymous(env).firestore()
      await assertSucceeds(setDoc(doc(db, `${spec.name}/new-doc`), { ...base, companyId: COMPANY_A }))
    })
  } else {
    it('lets a member create with their own companyId', async () => {
      const db = asUser(env, ALICE).firestore()
      await assertSucceeds(setDoc(doc(db, `${spec.name}/new-doc`), { ...base, companyId: COMPANY_A }))
    })

    it('denies creating a document stamped with another companyId', async () => {
      const db = asUser(env, ALICE).firestore()
      await assertFails(setDoc(doc(db, `${spec.name}/new-doc`), { ...base, companyId: COMPANY_B }))
    })

    it('denies creates with no companyId at all', async () => {
      const db = asUser(env, ALICE).firestore()
      await assertFails(setDoc(doc(db, `${spec.name}/new-doc`), { ...base, title: 'orphan' }))
    })

    it('denies creates by a viewer', async () => {
      const db = asUser(env, VIEWER_A).firestore()
      await assertFails(setDoc(doc(db, `${spec.name}/new-doc`), { ...base, companyId: COMPANY_A }))
    })

    it('denies creates by an anonymous caller', async () => {
      const db = asAnonymous(env).firestore()
      await assertFails(setDoc(doc(db, `${spec.name}/new-doc`), { ...base, companyId: COMPANY_A }))
    })
  }

  // ── Updates ──────────────────────────────────────────────────────────────

  if (spec.readOnly || spec.noUpdate) {
    it('denies updates', async () => {
      await seedBoth()
      const db = asUser(env, ALICE).firestore()
      await assertFails(updateDoc(doc(db, docA), { title: 'edited' }))
    })
  } else {
    it('lets a member update their own company document', async () => {
      await seedBoth()
      const db = asUser(env, ALICE).firestore()
      await assertSucceeds(updateDoc(doc(db, docA), { title: 'edited' }))
    })

    it('denies updating another company document', async () => {
      await seedBoth()
      const db = asUser(env, BOB).firestore()
      await assertFails(updateDoc(doc(db, docA), { title: 'hijacked' }))
    })

    it('denies re-stamping a document into another company', async () => {
      await seedBoth()
      const db = asUser(env, ALICE).firestore()
      await assertFails(updateDoc(doc(db, docA), { companyId: COMPANY_B }))
    })

    if (spec.viewerCanUpdate) {
      it('lets a viewer toggle the read flag', async () => {
        await seedBoth()
        const db = asUser(env, VIEWER_A).firestore()
        await assertSucceeds(updateDoc(doc(db, docA), { read: true }))
      })
    } else {
      it('denies updates by a viewer', async () => {
        await seedBoth()
        const db = asUser(env, VIEWER_A).firestore()
        await assertFails(updateDoc(doc(db, docA), { title: 'edited' }))
      })
    }
  }

  // ── Deletes ──────────────────────────────────────────────────────────────

  if (spec.readOnly) {
    it('denies deletes', async () => {
      await seedBoth()
      const db = asUser(env, ALICE).firestore()
      await assertFails(deleteDoc(doc(db, docA)))
    })
  } else {
    it('lets a member delete their own company document', async () => {
      await seedBoth()
      const db = asUser(env, ALICE).firestore()
      await assertSucceeds(deleteDoc(doc(db, docA)))
    })

    it('denies deleting another company document', async () => {
      await seedBoth()
      const db = asUser(env, BOB).firestore()
      await assertFails(deleteDoc(doc(db, docA)))
    })

    it('denies deletes by a viewer', async () => {
      await seedBoth()
      const db = asUser(env, VIEWER_A).firestore()
      await assertFails(deleteDoc(doc(db, docA)))
    })

    it('denies deletes by an anonymous caller', async () => {
      await seedBoth()
      const db = asAnonymous(env).firestore()
      await assertFails(deleteDoc(doc(db, docA)))
    })
  }
})
