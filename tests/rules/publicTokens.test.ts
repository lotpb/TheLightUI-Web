import { beforeAll, afterAll, beforeEach, describe, it } from 'vitest'
import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc } from 'firebase/firestore'
import {
  setupTestEnv, resetAndSeedUsers, asUser, asAnonymous, seedDoc,
  COMPANY_A, COMPANY_B, ALICE, VIEWER_A, ADMIN_A, SALES_A, BOB,
} from './helpers'

/**
 * Token-addressed documents shared with customers over a public link. The
 * random document ID is the bearer secret, so `get` is deliberately open —
 * which makes it critical that `list` is not, and that the narrow
 * unauthenticated write paths cannot be widened into arbitrary edits.
 */

let env: RulesTestEnvironment

beforeAll(async () => { env = await setupTestEnv('rules-public-tokens') })
afterAll(async () => { await env.cleanup() })
beforeEach(async () => { await resetAndSeedUsers(env) })

describe.each(['publicInvoices', 'customerPortals'])('%s', (name) => {
  const path = `${name}/token-abc`

  it('allows an anonymous get by token', async () => {
    await seedDoc(env, path, { companyId: COMPANY_A, total: 100 })
    await assertSucceeds(getDoc(doc(asAnonymous(env).firestore(), path)))
  })

  it('denies enumerating the collection', async () => {
    await seedDoc(env, path, { companyId: COMPANY_A, total: 100 })
    await assertFails(getDocs(collection(asAnonymous(env).firestore(), name)))
    await assertFails(getDocs(collection(asUser(env, ALICE).firestore(), name)))
  })

  it('denies anonymous writes', async () => {
    await seedDoc(env, path, { companyId: COMPANY_A, total: 100 })
    await assertFails(updateDoc(doc(asAnonymous(env).firestore(), path), { total: 0 }))
    await assertFails(deleteDoc(doc(asAnonymous(env).firestore(), path)))
  })

  it('lets the owning company create and update', async () => {
    const db = asUser(env, ALICE).firestore()
    await assertSucceeds(setDoc(doc(db, path), { companyId: COMPANY_A, total: 100 }))
    await assertSucceeds(updateDoc(doc(db, path), { total: 150 }))
  })

  it('denies another company creating or editing the token', async () => {
    const db = asUser(env, BOB).firestore()
    await assertFails(setDoc(doc(db, path), { companyId: COMPANY_A, total: 100 }))
    await seedDoc(env, path, { companyId: COMPANY_A, total: 100 })
    await assertFails(updateDoc(doc(db, path), { total: 0 }))
    await assertFails(deleteDoc(doc(db, path)))
  })
})

describe('publicProposals', () => {
  const path = 'publicProposals/token-abc'

  it('allows an anonymous get by token', async () => {
    await seedDoc(env, path, { companyId: COMPANY_A, status: 'sent' })
    await assertSucceeds(getDoc(doc(asAnonymous(env).firestore(), path)))
  })

  it('lets an unauthenticated customer accept a sent proposal', async () => {
    await seedDoc(env, path, { companyId: COMPANY_A, status: 'sent' })
    await assertSucceeds(
      updateDoc(doc(asAnonymous(env).firestore(), path), { status: 'accepted', respondedAt: 1 }),
    )
  })

  it('lets an unauthenticated customer decline a sent proposal', async () => {
    await seedDoc(env, path, { companyId: COMPANY_A, status: 'sent' })
    await assertSucceeds(
      updateDoc(doc(asAnonymous(env).firestore(), path), { status: 'declined', respondedAt: 1 }),
    )
  })

  it('denies a customer editing anything but status and respondedAt', async () => {
    await seedDoc(env, path, { companyId: COMPANY_A, status: 'sent', total: 5000 })
    await assertFails(
      updateDoc(doc(asAnonymous(env).firestore(), path), { status: 'accepted', total: 1 }),
    )
  })

  it('denies a customer moving the proposal to another company', async () => {
    await seedDoc(env, path, { companyId: COMPANY_A, status: 'sent' })
    await assertFails(
      updateDoc(doc(asAnonymous(env).firestore(), path), { status: 'accepted', companyId: COMPANY_B }),
    )
  })

  it('denies re-responding to an already accepted proposal', async () => {
    await seedDoc(env, path, { companyId: COMPANY_A, status: 'accepted' })
    await assertFails(
      updateDoc(doc(asAnonymous(env).firestore(), path), { status: 'declined', respondedAt: 2 }),
    )
  })

  it('denies an arbitrary status value', async () => {
    await seedDoc(env, path, { companyId: COMPANY_A, status: 'sent' })
    await assertFails(
      updateDoc(doc(asAnonymous(env).firestore(), path), { status: 'paid', respondedAt: 1 }),
    )
  })

  it('denies a viewer creating a snapshot', async () => {
    await assertFails(
      setDoc(doc(asUser(env, VIEWER_A).firestore(), path), { companyId: COMPANY_A, status: 'sent' }),
    )
  })

  it('denies another company deleting the snapshot', async () => {
    await seedDoc(env, path, { companyId: COMPANY_A, status: 'sent' })
    await assertFails(deleteDoc(doc(asUser(env, BOB).firestore(), path)))
  })
})

describe('signingRequests', () => {
  const path = 'signingRequests/token-abc'

  it('allows an anonymous get by token', async () => {
    await seedDoc(env, path, { companyId: COMPANY_A, status: 'pending' })
    await assertSucceeds(getDoc(doc(asAnonymous(env).firestore(), path)))
  })

  it('lets an unauthenticated signer move pending to signed', async () => {
    await seedDoc(env, path, { companyId: COMPANY_A, status: 'pending' })
    await assertSucceeds(updateDoc(doc(asAnonymous(env).firestore(), path), { status: 'signed' }))
  })

  it('denies re-signing an already signed document', async () => {
    await seedDoc(env, path, { companyId: COMPANY_A, status: 'signed' })
    await assertFails(updateDoc(doc(asAnonymous(env).firestore(), path), { status: 'signed' }))
  })

  it('denies a signer moving the request to another company', async () => {
    await seedDoc(env, path, { companyId: COMPANY_A, status: 'pending' })
    await assertFails(
      updateDoc(doc(asAnonymous(env).firestore(), path), { status: 'signed', companyId: COMPANY_B }),
    )
  })

  it('denies another company listing signing requests', async () => {
    await seedDoc(env, path, { companyId: COMPANY_A, status: 'pending' })
    await assertFails(getDocs(collection(asUser(env, BOB).firestore(), 'signingRequests')))
  })
})

describe('invites', () => {
  const path = 'invites/invite-code-xyz'
  const invite = { companyId: COMPANY_A, role: 'salesman', used: false }

  it('allows an anonymous get so the join page can render', async () => {
    await seedDoc(env, path, invite)
    await assertSucceeds(getDoc(doc(asAnonymous(env).firestore(), path)))
  })

  it('lets an owner create an invite', async () => {
    await assertSucceeds(setDoc(doc(asUser(env, ALICE).firestore(), path), invite))
  })

  it('lets an admin create an invite', async () => {
    await assertSucceeds(setDoc(doc(asUser(env, ADMIN_A).firestore(), path), invite))
  })

  it('denies a salesman creating an invite', async () => {
    await assertFails(setDoc(doc(asUser(env, SALES_A).firestore(), path), invite))
  })

  it('denies a viewer creating an invite', async () => {
    await assertFails(setDoc(doc(asUser(env, VIEWER_A).firestore(), path), invite))
  })

  it('denies anonymous invite creation', async () => {
    await assertFails(setDoc(doc(asAnonymous(env).firestore(), path), invite))
  })

  it('denies another company listing invites', async () => {
    await seedDoc(env, path, invite)
    await assertFails(getDocs(collection(asUser(env, BOB).firestore(), 'invites')))
  })

  it('denies escalating an unused invite to the owner role', async () => {
    // An invite doc is a grant of company membership at a given role. If any
    // signed-in user can rewrite an unused one, they can grant themselves
    // owner in a company they do not belong to.
    await seedDoc(env, path, invite)
    await assertFails(updateDoc(doc(asUser(env, BOB).firestore(), path), { role: 'owner' }))
  })

  it('denies repointing an unused invite at another company', async () => {
    await seedDoc(env, path, invite)
    await assertFails(updateDoc(doc(asUser(env, BOB).firestore(), path), { companyId: COMPANY_B }))
  })

  it('lets a recruit consume an unused invite', async () => {
    // Mirrors inviteService.acceptInvite exactly — if the rule is tightened
    // further, this is the call that must keep working.
    await seedDoc(env, path, invite)
    await assertSucceeds(updateDoc(doc(asUser(env, BOB).firestore(), path), {
      used: true,
      usedBy: BOB,
      usedByEmail: 'recruit@example.com',
      usedByName: 'Recruit',
      usedAt: new Date(),
    }))
  })

  it('denies smuggling a role change into the consumption write', async () => {
    await seedDoc(env, path, invite)
    await assertFails(updateDoc(doc(asUser(env, BOB).firestore(), path), {
      used: true,
      usedBy: BOB,
      role: 'owner',
    }))
  })

  it('denies deleting an invite', async () => {
    await seedDoc(env, path, invite)
    await assertFails(deleteDoc(doc(asUser(env, ALICE).firestore(), path)))
  })
})
