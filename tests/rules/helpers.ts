import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  initializeTestEnvironment,
  type RulesTestEnvironment,
  type RulesTestContext,
} from '@firebase/rules-unit-testing'

// ── Fixed identities used across every suite ────────────────────────────────
//
//   Two companies, so that every "can company A touch company B's data?"
//   question has a concrete answer. Roles matter because firestore.rules
//   resolves them with a get() against users/{uid} rather than a token claim.
//
export const COMPANY_A = 'company-alpha'
export const COMPANY_B = 'company-beta'

export const ALICE    = 'uid-alice'     // owner  @ company A
export const ADMIN_A  = 'uid-admin-a'   // admin  @ company A
export const VIEWER_A = 'uid-viewer-a'  // viewer @ company A (read-only role)
export const SALES_A  = 'uid-sales-a'   // salesman @ company A
export const BOB      = 'uid-bob'       // owner  @ company B
export const NOCLAIM  = 'uid-noclaim'   // signed in, no companyId claim yet

const USERS: Record<string, { companyId: string; role: string }> = {
  [ALICE]:    { companyId: COMPANY_A, role: 'owner' },
  [ADMIN_A]:  { companyId: COMPANY_A, role: 'admin' },
  [VIEWER_A]: { companyId: COMPANY_A, role: 'viewer' },
  [SALES_A]:  { companyId: COMPANY_A, role: 'salesman' },
  [BOB]:      { companyId: COMPANY_B, role: 'owner' },
  [NOCLAIM]:  { companyId: '',        role: 'salesman' },
}

/**
 * Each test file gets its own projectId so the suites are isolated from one
 * another inside the shared emulator instance.
 */
export async function setupTestEnv(projectId: string): Promise<RulesTestEnvironment> {
  return initializeTestEnvironment({
    projectId,
    firestore: {
      rules: readFileSync(resolve(__dirname, '../../firestore.rules'), 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  })
}

/**
 * Wipes Firestore and re-seeds the users/{uid} documents that callerRole()
 * reads. Must run before every test, because clearFirestore() removes them.
 */
export async function resetAndSeedUsers(env: RulesTestEnvironment): Promise<void> {
  await env.clearFirestore()
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore()
    for (const [uid, data] of Object.entries(USERS)) {
      await db.doc(`users/${uid}`).set({ ...data, email: `${uid}@example.com` })
    }
  })
}

/** Authenticated context carrying the companyId custom claim, like the real app. */
export function asUser(env: RulesTestEnvironment, uid: string): RulesTestContext {
  const { companyId } = USERS[uid]
  // An empty claim must be omitted entirely — hasCompanyId() checks for the
  // key's presence, and the real token would not carry an empty string.
  return env.authenticatedContext(uid, companyId ? { companyId } : {})
}

/** Signed out — the public/customer-link case. */
export function asAnonymous(env: RulesTestEnvironment): RulesTestContext {
  return env.unauthenticatedContext()
}

/** Writes a document bypassing rules, for arranging test state. */
export async function seedDoc(
  env: RulesTestEnvironment,
  path: string,
  data: Record<string, unknown>,
): Promise<void> {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().doc(path).set(data)
  })
}
