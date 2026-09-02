// Firebase handles and helpers shared across every domain module.
// Importing this module is what initialises the Admin SDK.

import * as functions from 'firebase-functions/v1'
import { initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { getMessaging } from 'firebase-admin/messaging'

initializeApp()
import { Timestamp } from 'firebase-admin/firestore'

export const db        = getFirestore()
export const auth      = getAuth()
export const messaging = getMessaging()

// Super-admin allowlist for cross-tenant read-only views (adminListAllTeams).
// Compared case-insensitively against the caller's verified ID-token email.
export const SUPER_ADMIN_EMAILS = ['eunitedws@gmail.com', 'eunitedws@icloud.com'] as const

export function isSuperAdmin(email: unknown): boolean {
  return typeof email === 'string'
    && SUPER_ADMIN_EMAILS.includes(email.toLowerCase() as typeof SUPER_ADMIN_EMAILS[number])
}

export function isoOrNull(v: unknown): string | null {
  if (v instanceof Timestamp) return v.toDate().toISOString()
  if (v instanceof Date) return v.toISOString()
  return null
}
// ── Shared rate limiter ─────────────────────────────────────────────────────────
// Per-instance sliding-window. Good enough to block naive bulk callers without
// requiring an external store. Key is caller IP or uid depending on context.
export function makeRateLimiter(windowMs: number, limit: number) {
  const bucket = new Map<string, number[]>()
  return function check(key: string): void {
    const now  = Date.now()
    const hits = (bucket.get(key) ?? []).filter(t => now - t < windowMs)
    if (hits.length >= limit) {
      throw new functions.https.HttpsError('resource-exhausted', 'Too many requests — try again later')
    }
    hits.push(now)
    bucket.set(key, hits)
  }
}

// ── HTML escaping ────────────────────────────────────────────────────────────────
// Firebase Auth displayName and Firestore customer fields are user-controlled
// and not sanitized at the source; both flow into transactional/campaign email
// HTML bodies below. Escape before interpolating into any HTML template.
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// ── Bulk reminder emails (Invoices / Proposals) ─────────────────────────────────
// Callable: reminds each selected record's customer by email. Skips records
// with no email on file. Stamps lastReminderSentAt (already in
// AUDIT_IGNORE_FIELDS, so this doesn't spam the audit log) so the UI can show
// "reminded Xd ago" if it wants to.

export function lineItemsTotal(data: Record<string, unknown>): number {
  const items = Array.isArray(data['lineItems']) ? data['lineItems'] as Record<string, unknown>[] : []
  const subtotal = items.reduce((s, i) => s + (Number(i['qty'] ?? 0) * Number(i['rate'] ?? 0)), 0)
  const taxRate = Number(data['taxRate'] ?? 0)
  return subtotal + subtotal * (taxRate / 100)
}

export function fmtMoney(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 })
}

export function fmtDateShort(v: unknown): string {
  if (v instanceof Timestamp) return v.toDate().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
  return ''
}

export function lastTenDigits(s: string): string {
  return s.replace(/\D/g, '').slice(-10)
}

// Fixed-window rate limit: max REQUESTS_PER_WINDOW calls per API key per
// WINDOW_MS. Counters live directly on the apiKeys doc (no new collection
// needed) and are updated inside a transaction so concurrent requests from
// the same key can't race past the limit.
export const API_RATE_LIMIT_WINDOW_MS = 60_000
export const API_RATE_LIMIT_PER_WINDOW = 60

export async function checkApiRateLimit(keyRef: FirebaseFirestore.DocumentReference): Promise<boolean> {
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(keyRef)
    const data = snap.data() ?? {}
    const windowStart = (data['rateLimitWindowStart'] as Timestamp | undefined)?.toMillis() ?? 0
    const count = typeof data['rateLimitCount'] === 'number' ? data['rateLimitCount'] : 0
    const now = Date.now()

    if (now - windowStart > API_RATE_LIMIT_WINDOW_MS) {
      tx.update(keyRef, { rateLimitWindowStart: Timestamp.fromMillis(now), rateLimitCount: 1 })
      return true
    }
    if (count >= API_RATE_LIMIT_PER_WINDOW) {
      return false
    }
    tx.update(keyRef, { rateLimitCount: count + 1 })
    return true
  })
}
// Integrations are owner/admin-only. Prefers the custom claim (set by
// syncUserClaims) and falls back to the user doc for sessions holding a token
// minted before the claim was added.
export async function assertCompanyAdmin(context: functions.https.CallableContext): Promise<string> {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Must be signed in')
  const companyId = context.auth.token.companyId as string
  if (!companyId) throw new functions.https.HttpsError('failed-precondition', 'Account not fully set up')

  let role = String(context.auth.token.role ?? '')
  if (!role) {
    const userSnap = await db.collection('users').doc(context.auth.uid).get()
    role = String(userSnap.data()?.['role'] ?? '')
  }
  if (role !== 'owner' && role !== 'admin') {
    throw new functions.https.HttpsError('permission-denied', 'Only owners and admins can manage integrations')
  }
  return companyId
}
