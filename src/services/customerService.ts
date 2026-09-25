import {
  collection, doc, addDoc, updateDoc, deleteDoc,
  onSnapshot, getDoc, getDocs, writeBatch, query, where, orderBy,
  runTransaction, startAfter, limit, Timestamp, getCountFromServer,
  type QueryDocumentSnapshot, type Unsubscribe,
} from 'firebase/firestore'
import { getFunctions, httpsCallable } from 'firebase/functions'
import { db } from '../firebase/config'
import { customerFromDoc, customerToFirestore, diffCustomerEdit, restoredFirestoreKeys, type CustomerItem } from '../models/customer'
import { getCompanyId, getCurrentUserLabel } from '../stores/authStore'
import { usePlanStore } from '../stores/planStore'
import { PLAN_LIMITS, recordCapError } from '../models/plan'

const COLLECTION = 'Customers'

/**
 * Throws, with a message fit for a toast, when adding `adding` records would
 * push the company past its plan's record cap (Starter: 500). Plans without a
 * cap skip the count query entirely.
 *
 * Client-side only: Firestore rules can't count documents, so this stops the
 * app's create and import paths but not a hand-crafted SDK write.
 */
export async function assertRecordCapacity(companyId: string, adding: number): Promise<void> {
  const { plan } = usePlanStore.getState()
  if (PLAN_LIMITS[plan].leads === null || adding <= 0) return
  const agg = await getCountFromServer(
    query(collection(db, COLLECTION), where('companyId', '==', companyId)),
  )
  const error = recordCapError(plan, agg.data().count, adding)
  if (error) throw new Error(error)
}

// Safety cap for the real-time listener. Prevents loading 100k+ documents into
// the browser's JS heap. Companies that grow past this limit should migrate to
// server-side aggregation (Cloud Functions) for analytics and cursor pagination
// for the list view. Exported so consumers can show an accurate warning
// instead of hardcoding the number (and so it can be tuned in one place).
export const REALTIME_LIMIT = 5_000

export function subscribeToCustomers(
  onData: (items: CustomerItem[], hitCap: boolean) => void,
  onError: (err: Error) => void,
): Unsubscribe {
  const companyId = getCompanyId()
  if (!companyId) {
    onError(new Error('Not authenticated'))
    return () => {}
  }
  // No orderBy on a data field — docs missing that field are silently dropped
  // by Firestore when orderBy is used. Sort client-side so every document is
  // included. The limit is applied without orderBy; Firestore uses document-ID
  // order as the default, which is stable and requires no composite index.
  return onSnapshot(
    query(collection(db, COLLECTION), where('companyId', '==', companyId), limit(REALTIME_LIMIT)),
    (snap) => {
      const hitCap = snap.size === REALTIME_LIMIT
      if (hitCap) {
        console.warn(
          `[subscribeToCustomers] hit ${REALTIME_LIMIT}-document cap for company ${companyId}. ` +
          'Records beyond this limit are not visible. Implement server-side aggregation and ' +
          'cursor pagination to support larger datasets.'
        )
      }
      const items: CustomerItem[] = []
      for (const d of snap.docs) {
        try {
          items.push(customerFromDoc(d))
        } catch {
          // skip malformed doc rather than crashing the whole list
        }
      }
      items.sort((a, b) => b.creationDate.getTime() - a.creationDate.getTime())
      onData(items, hitCap)
    },
    onError,
  )
}

export async function getCustomer(id: string): Promise<CustomerItem | null> {
  const myCompanyId = getCompanyId()
  const snap = await getDoc(doc(db, COLLECTION, id))
  if (!snap.exists()) return null
  if ((snap.data()['companyId'] as string | undefined) !== myCompanyId) {
    console.error(`[getCustomer] companyId mismatch on doc ${id}`)
    return null
  }
  return customerFromDoc(snap)
}

export async function createCustomer(
  customer: Omit<CustomerItem, 'id'>,
  userId?: string,
): Promise<string> {
  const companyId = getCompanyId()
  await assertRecordCapacity(companyId, 1)
  const me = getCurrentUserLabel()
  const data: Record<string, unknown> = {
    ...customerToFirestore(customer as CustomerItem, userId),
    companyId,
    createdByName: me.name,
    // Records who created the record, so the list's "My Leads" filter can find
    // it without touching salesman/assignedToUid — creating a lead doesn't make
    // you its salesman. Written only here: updateCustomer must never overwrite
    // it, and `uid` can't serve this purpose because updates restamp it with the
    // last editor.
    createdByUid: me.uid,
  }

  const ref = await addDoc(collection(db, COLLECTION), data)
  return ref.id
}

// There is deliberately no whole-document update. updateCustomer wrote every
// field from the caller's copy and was behind each silent-revert bug found on
// this collection; use saveCustomerEdits for the edit form and the targeted
// setters below for everything else.

/** Thrown by saveCustomerEdits when another edit touched the same fields. */
export class CustomerEditConflictError extends Error {
  constructor(readonly fields: string[], readonly editedBy: string) {
    super('This record was changed by someone else while you were editing it.')
    this.name = 'CustomerEditConflictError'
  }
}

/**
 * Saves the record edit form as a three-way merge (see diffCustomerEdit)
 * inside a transaction, so the document can't change between the read and
 * the write.
 *
 * Replaces a full-document updateCustomer, which wrote every field from the
 * form's copy: saving silently reverted whatever had changed since the form
 * opened — terms typed on /quote, notes added from /followups, tag edits,
 * snoozes, and any other user's edits to the same record. Now only the fields
 * this user changed are written; if another edit changed one of those same
 * fields, it throws CustomerEditConflictError unless `overwrite` is set.
 *
 * Returns false when nothing changed and nothing was written.
 */
export async function saveCustomerEdits(
  id: string,
  base: CustomerItem,
  edited: CustomerItem,
  opts: { userId?: string; overwrite?: boolean } = {},
): Promise<boolean> {
  const companyId = getCompanyId()
  const ref = doc(db, COLLECTION, id)
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists() || snap.data()['companyId'] !== companyId) {
      throw new Error('This record no longer exists.')
    }
    const { changes, conflicts } = diffCustomerEdit(base, edited, customerFromDoc(snap))
    if (conflicts.length > 0 && !opts.overwrite) {
      throw new CustomerEditConflictError(conflicts, String(snap.data()['lastEditedByName'] ?? ''))
    }
    if (Object.keys(changes).length === 0) return false
    tx.update(ref, {
      ...changes,
      lastUpdate: Timestamp.fromDate(new Date()),
      ...(opts.userId ? { uid: opts.userId } : {}),
      lastEditedByName: getCurrentUserLabel().name,
    })
    return true
  })
}

export async function deleteCustomer(id: string): Promise<void> {
  // Stamp the actor's name before the delete so the auditLog trigger's "before"
  // snapshot (the only data it has left to read) can attribute the deletion.
  await updateDoc(doc(db, COLLECTION, id), { lastEditedByName: getCurrentUserLabel().name })
  await deleteDoc(doc(db, COLLECTION, id))
}

export async function deactivateCustomer(id: string, extraFields: Record<string, unknown> = {}): Promise<void> {
  await updateDoc(doc(db, COLLECTION, id), { active: '0', ...extraFields })
}

/** Counterpart to deactivateCustomer — writes only the flag and `extraFields`. */
export async function reactivateCustomer(id: string, extraFields: Record<string, unknown> = {}): Promise<void> {
  await updateDoc(doc(db, COLLECTION, id), { active: '1', ...extraFields })
}

export async function setPaymentStatus(id: string, paymentStatus: string): Promise<void> {
  await updateDoc(doc(db, COLLECTION, id), { paymentStatus })
}

/**
 * Writes `active` alongside `employeeStatus` so the two can't drift apart.
 * Setting employeeStatus alone let a record sit at isActive:true with an
 * 'Inactive' employment status — listed under "Active Employees" while its own
 * badge said Inactive. 'Active' and 'On Leave' are both still employed, so
 * only 'Inactive' clears the record's active flag.
 */
export async function setEmployeeStatus(
  id: string,
  employeeStatus: string,
  isActive?: boolean,
): Promise<void> {
  await updateDoc(doc(db, COLLECTION, id), {
    employeeStatus,
    ...(isActive === undefined ? {} : { active: isActive ? '1' : '0' }),
  })
}

// Records which customerPortals snapshot belongs to this customer, so
// regenerating a portal link refreshes that one snapshot instead of minting a
// new permanently-public token every time (see generatePortalLink).
export async function setPortalToken(id: string, portalToken: string): Promise<void> {
  await updateDoc(doc(db, COLLECTION, id), { portalToken })
}

export interface MergeOutcome {
  /** Documents repointed, keyed `collection.field`. */
  moved: Record<string, number>
  totalMoved: number
  /**
   * True when the server ran out of time. The secondary is deliberately left
   * active in that case, so the pair stays on /duplicates and the merge can
   * simply be run again.
   */
  incomplete: boolean
  remaining: string[]
}

/**
 * Merges two customer records, moving everything attached to the secondary.
 *
 * This used to be a two-document batch: copy the secondary's empty fields onto
 * the primary, set the secondary's `active` to '0', done. Nothing else moved —
 * and sixteen collection/field pairs reference a customer by id, so every
 * invoice, proposal, warranty, service plan, task, document, signed request,
 * email and text thread belonging to the retired record stayed pointed at it
 * and vanished from the surviving customer.
 *
 * It's a Cloud Function now because it's a data migration: potentially
 * thousands of documents, and it has to survive the tab closing and be safe to
 * repeat. See functions/src/customers.ts.
 */
export async function mergeCustomers(
  primaryId: string,
  secondaryId: string,
  primaryUpdates: Record<string, unknown>,
): Promise<MergeOutcome> {
  const call = httpsCallable<
    { primaryId: string; secondaryId: string; updates: Record<string, unknown> },
    MergeOutcome
  >(getFunctions(), 'mergeCustomerRecords')
  const res = await call({ primaryId, secondaryId, updates: primaryUpdates })
  return res.data
}

/**
 * How many documents are attached to each of up to two customers.
 *
 * Counted server-side with aggregation queries — sixteen `count()` calls bill
 * one read per thousand matched documents rather than one per document, which
 * is what makes it affordable to show before a merge instead of after.
 */
export async function countCustomerRelated(
  customerIds: string[],
): Promise<Record<string, Record<string, number>>> {
  const call = httpsCallable<{ customerIds: string[] }, { counts: Record<string, Record<string, number>> }>(
    getFunctions(), 'countCustomerRecords',
  )
  const res = await call({ customerIds })
  return res.data.counts
}

/**
 * `extraFields` mirrors deactivateCustomer, so employees can keep
 * `employeeStatus` in step with `active`. The two are separate fields that must
 * agree: deactivating a record while leaving employeeStatus 'Active' makes the
 * list render an Active badge on a row it simultaneously marks inactive.
 * CustomerDetailPage.handleToggleActive establishes the same pairing for the
 * single-record path.
 */
export async function bulkDeactivate(
  ids: string[],
  extraFields: Record<string, unknown> = {},
): Promise<void> {
  if (!getCompanyId()) throw new Error('Not authenticated')
  // Stamped so the auditLog trigger can attribute the change. Without it every
  // bulk-changed record logged as "Unknown".
  const lastEditedByName = getCurrentUserLabel().name
  const BATCH_SIZE = 500
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const batch = writeBatch(db)
    for (const id of ids.slice(i, i + BATCH_SIZE)) {
      batch.update(doc(db, COLLECTION, id), { active: '0', lastEditedByName, ...extraFields })
    }
    await batch.commit()
  }
}

// Free-text assignment — used for Vendor/Employee categories where the `salesman`
// field is repurposed (Callback / "is a salesperson" flags), not a real user link.
export async function bulkAssignSalesman(ids: string[], salesman: string): Promise<void> {
  if (!getCompanyId()) throw new Error('Not authenticated')
  const lastEditedByName = getCurrentUserLabel().name
  const BATCH_SIZE = 500
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const batch = writeBatch(db)
    for (const id of ids.slice(i, i + BATCH_SIZE)) {
      batch.update(doc(db, COLLECTION, id), { salesman, lastEditedByName })
    }
    await batch.commit()
  }
}

// Real user assignment — used for Lead/Customer categories. Stamps assignedToUid
// so the onCustomerAssigned Cloud Function can look up the salesman's account and
// notify them, plus keeps `salesman` as the display name for existing UI/reports.
export async function bulkAssignSalesmanUser(ids: string[], uid: string, displayName: string): Promise<void> {
  if (!getCompanyId()) throw new Error('Not authenticated')
  const BATCH_SIZE = 500
  const lastEditedByName = getCurrentUserLabel().name
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const batch = writeBatch(db)
    for (const id of ids.slice(i, i + BATCH_SIZE)) {
      batch.update(doc(db, COLLECTION, id), { salesman: displayName, assignedToUid: uid, lastEditedByName })
    }
    await batch.commit()
  }
}

export async function updateTags(id: string, tags: string[]): Promise<void> {
  await updateDoc(doc(db, COLLECTION, id), { tags })
}

export async function bulkSetCategory(ids: string[], category: string): Promise<void> {
  if (!getCompanyId()) throw new Error('Not authenticated')
  const lastEditedByName = getCurrentUserLabel().name
  const BATCH_SIZE = 500
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const batch = writeBatch(db)
    for (const id of ids.slice(i, i + BATCH_SIZE)) {
      batch.update(doc(db, COLLECTION, id), { category, lastEditedByName })
    }
    await batch.commit()
  }
}

export async function bulkSetFollowUpDate(ids: string[], date: Date | null): Promise<void> {
  if (!getCompanyId()) throw new Error('Not authenticated')
  const lastEditedByName = getCurrentUserLabel().name
  const BATCH_SIZE = 500
  const value = date ? Timestamp.fromDate(date) : null
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const batch = writeBatch(db)
    for (const id of ids.slice(i, i + BATCH_SIZE)) {
      batch.update(doc(db, COLLECTION, id), { followUpDate: value, lastEditedByName })
    }
    await batch.commit()
  }
}

export async function bulkSetCallback(ids: string[], callback: string): Promise<void> {
  if (!getCompanyId()) throw new Error('Not authenticated')
  const lastEditedByName = getCurrentUserLabel().name
  const BATCH_SIZE = 500
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const batch = writeBatch(db)
    for (const id of ids.slice(i, i + BATCH_SIZE)) {
      batch.update(doc(db, COLLECTION, id), { callback, lastEditedByName })
    }
    await batch.commit()
  }
}

/**
 * Deletes records, stamping the actor first so the deletion can be attributed.
 *
 * deleteCustomer has always done this — the auditLog trigger's delete branch
 * reads `before.lastEditedByName`, the only data left once the document is
 * gone, and its comment names that contract. bulkDelete skipped it, so a bulk
 * deletion was logged against whoever last *edited* each record: delete a
 * record Ann edited and the audit log says Ann deleted it.
 *
 * The stamp is a separate commit because Firestore rejects two writes to the
 * same document in one batch.
 */
export async function bulkDelete(ids: string[]): Promise<void> {
  if (!getCompanyId()) throw new Error('Not authenticated')
  const lastEditedByName = getCurrentUserLabel().name
  const BATCH_SIZE = 500

  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const slice = ids.slice(i, i + BATCH_SIZE)

    const stamp = writeBatch(db)
    for (const id of slice) stamp.update(doc(db, COLLECTION, id), { lastEditedByName })
    await stamp.commit()

    const remove = writeBatch(db)
    for (const id of slice) remove.delete(doc(db, COLLECTION, id))
    await remove.commit()
  }
}

/**
 * Sets or clears the "called" flag — the field /callback filters on.
 *
 * Vendors keep that flag in `salesman` while every other category keeps it in
 * `callback` (see vendorFields in models/customer), so the category has to be
 * passed in rather than assumed.
 */
/*
 * These three stamp `lastEditedByName`, like every other write in this file.
 *
 * They are the inline controls in /records/:id's sidebar — the only write paths
 * on that page that don't go through the edit form — and they were the only
 * ones that didn't stamp it. The audit trigger reads `lastEditedByName` off the
 * document to attribute the change, so a follow-up date, an attempt count or a
 * Called toggle was logged against whoever last did a *full* edit. The History
 * panel showing that wrong name sits on the same page as the controls.
 *
 * Their bulk equivalents above (bulkSetFollowUpDate, bulkSetCallback) already
 * did this, which is what made the single-record versions look deliberate.
 */

export async function setCalledFlag(id: string, category: string, called: boolean): Promise<void> {
  const field = category.toLowerCase() === 'vendor' ? 'salesman' : 'callback'
  await updateDoc(doc(db, COLLECTION, id), {
    [field]: called ? 'Yes' : 'No',
    lastEditedByName: getCurrentUserLabel().name,
  })
}

export async function setFollowUpDate(id: string, date: Date | null): Promise<void> {
  await updateDoc(doc(db, COLLECTION, id), {
    followUpDate: date ? Timestamp.fromDate(date) : null,
    lastEditedByName: getCurrentUserLabel().name,
  })
}

export async function setContactAttempts(id: string, attempts: number): Promise<void> {
  await updateDoc(doc(db, COLLECTION, id), {
    contactAttempts: attempts,
    lastEditedByName: getCurrentUserLabel().name,
  })
}

/**
 * Saves the quote's Notes & Terms onto the record, touching nothing else.
 *
 * These are the terms of a document a customer signs, and they lived in
 * `localStorage['thelight.quote.notes.<id>']` — so printing the same quote from
 * a different machine produced a document with no terms on it, and converting
 * it to an invoice silently dropped them. The quote has no document of its own
 * (it's generated on demand from the customer record), so the record is where
 * they belong.
 *
 * A targeted update rather than updateCustomer, which writes all forty fields
 * from a caller's possibly-stale copy.
 */
export async function setQuoteNotes(id: string, quoteNotes: string): Promise<void> {
  await updateDoc(doc(db, COLLECTION, id), {
    quoteNotes,
    lastEditedByName: getCurrentUserLabel().name,
  })
}

/**
 * Prepends a dated note to a record's `comments`, touching nothing else.
 *
 * /followups' quick-note box did this with
 * `updateCustomer(c.id, { ...c, comments: next })` — a full-document write
 * built from whatever that page had in memory. So saving a one-line note
 * rewrote all forty fields from a snapshot taken when the page loaded, silently
 * reverting anything another rep had changed since. It also read the existing
 * comments from that same stale copy, so two notes added from two tabs would
 * lose one.
 *
 * A transaction fixes both: the current value is read inside it, and only
 * `comments` is written.
 */
export async function appendCustomerComment(id: string, text: string): Promise<void> {
  const body = text.trim()
  if (!body) return

  const stamp = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  const header = `--- [${stamp}] ---`
  const lastEditedByName = getCurrentUserLabel().name

  await runTransaction(db, async tx => {
    const ref = doc(db, COLLECTION, id)
    const snap = await tx.get(ref)
    if (!snap.exists()) throw new Error('Record not found')
    const existing = String(snap.data()['comments'] ?? '').trim()
    tx.update(ref, {
      comments: existing ? `${header}\n${body}\n\n${existing}` : `${header}\n${body}`,
      lastEditedByName,
    })
  })
}

/**
 * How far back and forward the follow-up window reaches, in days.
 *
 * The lower bound used to be yesterday's midnight, so a follow-up due more
 * than one day ago was not returned at all: it vanished from /followups, from
 * the dashboard's Follow-Ups card, and from its overdue count — which meant
 * the dashboard would print "You're all caught up" over an arbitrarily large
 * backlog. Anything genuinely overdue is the most important row on either
 * page, so the window reaches back a year and the pages surface the age.
 */
export const FOLLOWUP_PAST_DAYS = 365
export const FOLLOWUP_FUTURE_DAYS = 14

// Requires a Firestore composite index: companyId ASC + followUpDate ASC.
// If missing, Firestore will log a link to create it in the browser console.
export function subscribeToFollowUps(
  onData: (items: CustomerItem[]) => void,
  onError: (err: Error) => void,
  window: { pastDays?: number; futureDays?: number } = {},
): Unsubscribe {
  const companyId = getCompanyId()
  if (!companyId) {
    onError(new Error('Not authenticated'))
    return () => {}
  }
  const from = new Date()
  from.setDate(from.getDate() - (window.pastDays ?? FOLLOWUP_PAST_DAYS))
  from.setHours(0, 0, 0, 0)

  const to = new Date()
  to.setDate(to.getDate() + (window.futureDays ?? FOLLOWUP_FUTURE_DAYS))
  to.setHours(23, 59, 59, 999)

  return onSnapshot(
    query(
      collection(db, COLLECTION),
      where('companyId', '==', companyId),
      where('followUpDate', '>=', Timestamp.fromDate(from)),
      where('followUpDate', '<=', Timestamp.fromDate(to)),
    ),
    snap => {
      const items: CustomerItem[] = []
      for (const d of snap.docs) {
        try { items.push(customerFromDoc(d)) } catch { /* skip malformed */ }
      }
      items.sort((a, b) => (a.followUpDate?.getTime() ?? 0) - (b.followUpDate?.getTime() ?? 0))
      onData(items)
    },
    onError,
  )
}

// ─── JSON Import / Export ────────────────────────────────────────────────────

// Matches the iOS CustomerJSONRecord format so backups are cross-platform.
export interface CustomerJSONRecord {
  id: string
  isActive: boolean
  first: string
  lastname: string
  street: string
  city: string
  state: string
  zip: string
  amount: number
  creationDate: string   // ISO 8601
  rate: string
  phone: string
  comments: string
  /** Quote Notes & Terms. Optional: files from before it was added lack it. */
  quoteNotes?: string
  spouse: string
  email: string
  contractor: string
  photo: string
  lastUpdateDate: string // ISO 8601
  startDate: string      // ISO 8601
  completionDate: string // ISO 8601
  quantity: number
  salesman: string
  job: string
  product: string
  category: string
  callback: string
  adNo: string
  // web-only fields (absent in older iOS exports)
  birthDate?: string
  driverLicense?: string
  profession?: string
  manager?: string
  paymentTerms?: string
  taxId?: string
  accountNumber?: string
  payType?: string
  commissionRate?: string
  userRole?: string
  lastLogin?: string
  employeeStatus?: string
  leadStatus?: string
  lastContactDate?: string
  contactAttempts?: number
  companyName?: string
  leadSource?: string
  paymentStatus?: string
  // In iOS exports; the web exporter doesn't write them yet.
  followUpDate?: string | null
  tags?: string[]
}

function safeDate(s: string | undefined): Date {
  if (!s) return new Date()
  const d = new Date(s)
  return isNaN(d.getTime()) ? new Date() : d
}

export function exportCustomersToJSON(items: CustomerItem[]): string {
  const records: CustomerJSONRecord[] = items.map(c => ({
    id: c.id,
    isActive: c.isActive,
    first: c.first,
    lastname: c.lastname,
    street: c.street,
    city: c.city,
    state: c.state,
    zip: c.zip,
    amount: c.amount,
    creationDate: c.creationDate.toISOString(),
    rate: c.rate,
    phone: c.phone,
    comments: c.comments,
    quoteNotes: c.quoteNotes,
    spouse: c.spouse,
    email: c.email,
    contractor: c.contractor,
    photo: c.photo,
    lastUpdateDate: c.lastUpdateDate.toISOString(),
    startDate: c.startDate?.toISOString() ?? '',
    completionDate: c.completionDate?.toISOString() ?? '',
    quantity: c.quantity,
    salesman: c.salesman,
    job: c.job,
    product: c.product,
    category: c.category,
    callback: c.callback,
    adNo: c.adNo,
    birthDate: c.birthDate,
    driverLicense: c.driverLicense,
    profession: c.profession,
    manager: c.manager,
  }))
  return JSON.stringify(records, null, 2)
}

// Fetches all company customers in 500-document cursor-paginated chunks.
// orderBy('__name__') is always indexed (no composite index needed) and
// ensures every document is included regardless of field presence.
const EXPORT_PAGE_SIZE = 500

export async function getAllCustomersOnce(): Promise<CustomerItem[]> {
  const companyId = getCompanyId()
  if (!companyId) throw new Error('Not authenticated')

  const all: CustomerItem[] = []
  let cursor: QueryDocumentSnapshot | undefined

  while (true) {
    const snap = await getDocs(
      cursor
        ? query(collection(db, COLLECTION), where('companyId', '==', companyId), orderBy('__name__'), startAfter(cursor), limit(EXPORT_PAGE_SIZE))
        : query(collection(db, COLLECTION), where('companyId', '==', companyId), orderBy('__name__'), limit(EXPORT_PAGE_SIZE))
    )
    for (const d of snap.docs) {
      try { all.push(customerFromDoc(d)) } catch { /* skip malformed */ }
    }
    if (snap.size < EXPORT_PAGE_SIZE) break   // last page
    cursor = snap.docs[snap.docs.length - 1]
  }

  all.sort((a, b) => b.creationDate.getTime() - a.creationDate.getTime())
  return all
}

export async function importCustomersFromJSON(
  jsonText: string,
  userId = '',
  defaultCategory = '',
): Promise<{ count: number }> {
  const companyId = getCompanyId()
  if (!companyId) throw new Error('Not authenticated')

  const parsed: unknown = JSON.parse(jsonText)
  const records: CustomerJSONRecord[] = Array.isArray(parsed)
    ? (parsed as CustomerJSONRecord[])
    : ((parsed as { records?: CustomerJSONRecord[] }).records ?? [])
  if (!Array.isArray(records)) throw new Error('Invalid format: expected a JSON array.')
  // All-or-nothing: an import that would cross the cap is refused up front,
  // rather than committing the first batches and failing partway through.
  await assertRecordCapacity(companyId, records.length)

  const BATCH_SIZE = 500
  let total = 0

  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const chunk = records.slice(i, i + BATCH_SIZE)
    const batch = writeBatch(db)
    for (const r of chunk) {
      const item: CustomerItem = {
        id: r.id ?? '',
        isActive: r.isActive ?? true,
        first: r.first ?? '',
        lastname: r.lastname ?? '',
        street: r.street ?? '',
        city: r.city ?? '',
        state: r.state ?? '',
        zip: r.zip ?? '',
        amount: r.amount ?? 0,
        creationDate: safeDate(r.creationDate),
        rate: r.rate ?? '',
        phone: r.phone ?? '',
        comments: r.comments ?? '',
        quoteNotes: r.quoteNotes ?? '',
        spouse: r.spouse ?? '',
        email: r.email ?? '',
        contractor: r.contractor ?? '',
        photo: r.photo ?? '',
        lastUpdateDate: safeDate(r.lastUpdateDate),
        startDate: safeDate(r.startDate),
        completionDate: safeDate(r.completionDate),
        quantity: r.quantity ?? 0,
        salesman: r.salesman ?? '',
        job: r.job ?? '',
        product: r.product ?? '',
        category: r.category || defaultCategory,
        callback: r.callback ?? '',
        adNo: r.adNo ?? '',
        birthDate: r.birthDate ?? '',
        driverLicense: r.driverLicense ?? '',
        profession: r.profession ?? '',
        manager: r.manager ?? '',
        followUpDate: r.followUpDate ? safeDate(r.followUpDate) : null,
        tags: Array.isArray(r.tags) ? r.tags.filter((t): t is string => typeof t === 'string') : [],
        paymentTerms: r.paymentTerms ?? '',
        taxId: r.taxId ?? '',
        accountNumber: r.accountNumber ?? '',
        payType: r.payType ?? '',
        commissionRate: r.commissionRate ?? '',
        userRole: r.userRole ?? '',
        lastLogin: r.lastLogin ?? '',
        employeeStatus: r.employeeStatus ?? '',
        leadStatus: r.leadStatus ?? '',
        lastContactDate: r.lastContactDate ?? '',
        contactAttempts: r.contactAttempts ?? 0,
        companyName: r.companyName ?? '',
        leadSource: r.leadSource ?? '',
        paymentStatus: r.paymentStatus ?? '',
        customFields: {},
        pipelineStage: '',
        smsOptOut: false,
        emailOptOut: false,
        assignedToUid: '',
        // Left blank on bulk import: a CSV of thousands of records isn't "mine"
        // in the sense the My Leads filter means, even though I ran the import.
        createdByUid: '',
        portalToken: '',
      }
      const data: Record<string, unknown> = { ...customerToFirestore(item, userId), companyId }
      if (r.id) {
        // Restoring over a record that may exist: write only what the file
        // supplies, merged, so fields a backup never holds survive. See
        // restoredFirestoreKeys.
        const supplied = restoredFirestoreKeys(r)
        const keep = new Set([...supplied, 'companyId', 'uid', 'lastUpdate'])
        if (!supplied.has('category') && data['category']) keep.add('category')
        const merged = Object.fromEntries(Object.entries(data).filter(([k]) => keep.has(k)))
        batch.set(doc(db, COLLECTION, r.id), merged, { merge: true })
      } else {
        batch.set(doc(collection(db, COLLECTION)), data)
      }
      total++
    }
    await batch.commit()
  }

  return { count: total }
}

export async function importCustomersFromCSVRows(
  rows: Omit<CustomerItem, 'id'>[],
): Promise<{ count: number }> {
  const companyId = getCompanyId()
  if (!companyId) throw new Error('Not authenticated')
  await assertRecordCapacity(companyId, rows.length)

  const BATCH_SIZE = 500
  let total = 0

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const chunk = rows.slice(i, i + BATCH_SIZE)
    const batch = writeBatch(db)
    for (const item of chunk) {
      const data = { ...customerToFirestore(item as CustomerItem, ''), companyId }
      const ref = doc(collection(db, COLLECTION))
      batch.set(ref, data)
      total++
    }
    await batch.commit()
  }

  return { count: total }
}
