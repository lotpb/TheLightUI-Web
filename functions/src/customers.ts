// Customer record merging.
//
// /duplicates used to "merge" two records by copying the secondary's empty
// fields onto the primary and setting the secondary's `active` to '0'. Nothing
// else moved. Fifteen collections key on `customerId` — invoices, proposals,
// warranties, service plans, service requests, todos, documents, dispatch
// assignments, time entries, email and SMS threads, signing requests, sequence
// enrollments, campaign recipients, activity — plus referrals, which key on
// two different customer fields. After a merge, every one of those still
// pointed at the deactivated record, so a customer's invoices, signed
// documents and payment history became unreachable from the surviving record.
//
// This runs server-side rather than in the browser because it is a data
// migration: it can be thousands of documents across sixteen collections, it
// has to survive the tab closing, and a half-finished run must be safe to
// repeat.

import * as functions from 'firebase-functions/v1'
import { FieldValue } from 'firebase-admin/firestore'
import { db, assertCompanyWriter } from './common'

const CUSTOMERS = 'Customers'

/**
 * Every collection that references a customer by id, and the field it uses.
 *
 * Taken from the client services rather than assumed — each entry matches a
 * `where('customerId', '==', …)` (or the referral equivalent) that some page
 * relies on. Adding a customer-linked collection without adding it here means
 * a merge silently leaves its documents behind, so customers.test.ts on the
 * client checks this list against the services.
 */
export const CUSTOMER_LINKED: { collection: string; field: string }[] = [
  { collection: 'Invoices',            field: 'customerId' },
  { collection: 'Proposals',           field: 'customerId' },
  { collection: 'Warranties',          field: 'customerId' },
  { collection: 'ServicePlans',        field: 'customerId' },
  { collection: 'serviceRequests',     field: 'customerId' },
  { collection: 'ToDoItems',           field: 'customerId' },
  { collection: 'Documents',           field: 'customerId' },
  { collection: 'dispatchAssignments', field: 'customerId' },
  { collection: 'timeEntries',         field: 'customerId' },
  { collection: 'emailMessages',       field: 'customerId' },
  { collection: 'smsMessages',         field: 'customerId' },
  { collection: 'signingRequests',     field: 'customerId' },
  { collection: 'sequenceEnrollments', field: 'customerId' },
  { collection: 'campaignRecipients',  field: 'customerId' },
  { collection: 'Activities',          field: 'customerId' },
  // A referral records both sides, so the same document can need either field
  // repointed — or both, if someone managed to log a self-referral before the
  // guard existed.
  { collection: 'referrals',           field: 'referrerId' },
  { collection: 'referrals',           field: 'referredId' },
]

/** Firestore's hard limit is 500 writes per batch. */
const BATCH_SIZE = 450

/** Leaves headroom under the 540s ceiling to still write the summary. */
const TIME_BUDGET_MS = 480_000

export interface MergeResult {
  moved: Record<string, number>
  totalMoved: number
  /** True when the time budget ran out — the caller should run it again. */
  incomplete: boolean
  remaining: string[]
}

/**
 * Repoints one collection's references from `fromId` to `toId`.
 *
 * Paged rather than read-all-then-write: a customer with 5,000 activity rows
 * would otherwise be one enormous in-memory array. Each page is re-queried on
 * the old id, so a repeated run picks up exactly what's left and a completed
 * run is a no-op — which is what makes this safe to retry after a timeout.
 */
async function repoint(
  companyId: string, collection: string, field: string, fromId: string, toId: string,
  deadline: number,
): Promise<{ moved: number; done: boolean }> {
  let moved = 0

  for (;;) {
    if (Date.now() > deadline) return { moved, done: false }

    const snap = await db.collection(collection)
      .where('companyId', '==', companyId)
      .where(field, '==', fromId)
      .limit(BATCH_SIZE)
      .get()

    if (snap.empty) return { moved, done: true }

    const batch = db.batch()
    for (const doc of snap.docs) batch.update(doc.ref, { [field]: toId })
    await batch.commit()
    moved += snap.size

    // A short page means the query is exhausted.
    if (snap.size < BATCH_SIZE) return { moved, done: true }
  }
}

/**
 * Merges two customer records: applies the field updates the client computed,
 * moves every linked document, then deactivates the secondary.
 *
 * Order matters. The linked documents move *before* the secondary is
 * deactivated, so a run that dies partway leaves the secondary still active
 * and still visible on /duplicates — the pair stays in the queue and the
 * operation can be repeated. Deactivating first would hide the evidence that
 * the move never finished.
 */
export const mergeCustomerRecords = functions
  .runWith({ timeoutSeconds: 540, memory: '512MB' })
  .https.onCall(async (data, context) => {
    const companyId = await assertCompanyWriter(context)

    const primaryId   = String((data as Record<string, unknown>)?.['primaryId'] ?? '')
    const secondaryId = String((data as Record<string, unknown>)?.['secondaryId'] ?? '')
    const updates     = ((data as Record<string, unknown>)?.['updates'] ?? {}) as Record<string, unknown>

    if (!primaryId || !secondaryId) {
      throw new functions.https.HttpsError('invalid-argument', 'primaryId and secondaryId are required')
    }
    if (primaryId === secondaryId) {
      throw new functions.https.HttpsError('invalid-argument', 'Cannot merge a record into itself')
    }

    // Both records must exist and belong to the caller's company. Without
    // this, a crafted call could repoint another company's documents.
    const [primarySnap, secondarySnap] = await Promise.all([
      db.collection(CUSTOMERS).doc(primaryId).get(),
      db.collection(CUSTOMERS).doc(secondaryId).get(),
    ])
    for (const [snap, label] of [[primarySnap, 'primary'], [secondarySnap, 'secondary']] as const) {
      if (!snap.exists) {
        throw new functions.https.HttpsError('not-found', `The ${label} record no longer exists`)
      }
      if (String(snap.data()?.['companyId'] ?? '') !== companyId) {
        throw new functions.https.HttpsError('permission-denied', `The ${label} record belongs to another company`)
      }
    }

    // Only fields the customer document actually has, so a crafted call can't
    // write companyId, uid or arbitrary keys onto the surviving record.
    const safeUpdates: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(updates)) {
      if (MERGEABLE_FIELDS.has(key)) safeUpdates[key] = value
    }
    if (Object.keys(safeUpdates).length > 0) {
      safeUpdates['lastUpdate'] = FieldValue.serverTimestamp()
      await db.collection(CUSTOMERS).doc(primaryId).update(safeUpdates)
    }

    const deadline = Date.now() + TIME_BUDGET_MS
    const moved: Record<string, number> = {}
    const remaining: string[] = []
    let totalMoved = 0

    for (const { collection, field } of CUSTOMER_LINKED) {
      const label = `${collection}.${field}`
      try {
        const res = await repoint(companyId, collection, field, secondaryId, primaryId, deadline)
        if (res.moved > 0) {
          moved[label] = (moved[label] ?? 0) + res.moved
          totalMoved += res.moved
        }
        if (!res.done) remaining.push(label)
      } catch (err) {
        // One collection failing must not abandon the rest — and it must not
        // report success either.
        console.error(`mergeCustomerRecords: ${label} failed for ${secondaryId}:`, err)
        remaining.push(label)
      }
    }

    if (remaining.length > 0) {
      console.warn(`mergeCustomerRecords: ${secondaryId} -> ${primaryId} incomplete; left: ${remaining.join(', ')}`)
      return { moved, totalMoved, incomplete: true, remaining } satisfies MergeResult
    }

    // Everything moved: retire the secondary. mergedInto is a breadcrumb for
    // anyone who later wonders where the record went.
    await db.collection(CUSTOMERS).doc(secondaryId).update({
      active: '0',
      mergedInto: primaryId,
      mergedAt: FieldValue.serverTimestamp(),
      lastUpdate: FieldValue.serverTimestamp(),
    })

    console.log(`mergeCustomerRecords: ${secondaryId} -> ${primaryId}, ${totalMoved} documents moved`)
    return { moved, totalMoved, incomplete: false, remaining: [] } satisfies MergeResult
  })

/**
 * Fields a merge is allowed to copy onto the surviving record.
 *
 * Mirrors the string/scalar fields computeMergeChanges offers on the client.
 * `companyId`, `uid`, `active`, `mergedInto` and the timestamps are
 * deliberately absent.
 */
const MERGEABLE_FIELDS = new Set([
  'phone', 'email', 'street', 'address', 'city', 'state', 'zip',
  'salesman', 'adNo', 'product', 'contractor', 'job', 'spouse',
  'birthDate', 'driverLicense', 'amount', 'photo', 'comments', 'tags',
  'profession', 'manager', 'leadSource', 'companyName',
])

/**
 * Counts what is attached to each of two records, so the merge dialog can say
 * what is at stake before anyone commits.
 *
 * The dialog previously offered name, phone, email and a creation date — and
 * given that a merge moves every linked document, the number of documents each
 * side owns is the most important input to "which one do we keep", and it
 * wasn't on screen.
 */
export const countCustomerRecords = functions
  .runWith({ timeoutSeconds: 60, memory: '256MB' })
  .https.onCall(async (data, context) => {
    const companyId = await assertCompanyWriter(context)
    const ids = ((data as Record<string, unknown>)?.['customerIds'] ?? []) as unknown[]
    const wanted = ids.map(String).filter(Boolean).slice(0, 2)
    if (wanted.length === 0) {
      throw new functions.https.HttpsError('invalid-argument', 'customerIds is required')
    }

    const out: Record<string, Record<string, number>> = {}

    for (const id of wanted) {
      const counts: Record<string, number> = {}
      await Promise.all(CUSTOMER_LINKED.map(async ({ collection, field }) => {
        try {
          // An aggregation query bills one read per 1,000 matched documents
          // rather than one per document.
          const agg = await db.collection(collection)
            .where('companyId', '==', companyId)
            .where(field, '==', id)
            .count()
            .get()
          const n = agg.data().count
          if (n > 0) counts[collection] = (counts[collection] ?? 0) + n
        } catch (err) {
          console.error(`countCustomerRecords: ${collection}.${field} failed:`, err)
        }
      }))
      out[id] = counts
    }

    return { counts: out }
  })
