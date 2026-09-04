import {
  collection, doc, addDoc, updateDoc, deleteDoc,
  onSnapshot, getDoc, getDocs, writeBatch, query, where, orderBy,
  startAfter, limit, Timestamp,
  type QueryDocumentSnapshot, type Unsubscribe,
} from 'firebase/firestore'
import { db } from '../firebase/config'
import { customerFromDoc, customerToFirestore, type CustomerItem } from '../models/customer'
import { getCompanyId, getCurrentUserLabel } from '../stores/authStore'

const COLLECTION = 'Customers'

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

export async function updateCustomer(
  id: string,
  customer: CustomerItem,
  userId?: string,
): Promise<void> {
  const companyId = getCompanyId()
  const data = {
    ...customerToFirestore(customer, userId),
    companyId,
    lastEditedByName: getCurrentUserLabel().name,
  }
  await updateDoc(doc(db, COLLECTION, id), data)
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

// Merge two records: apply partial field updates to the primary, deactivate the secondary.
// The caller is responsible for computing which fields to copy over.
export async function mergeCustomers(
  primaryId: string,
  secondaryId: string,
  primaryUpdates: Record<string, unknown>,
): Promise<void> {
  if (!getCompanyId()) throw new Error('Not authenticated')
  const batch = writeBatch(db)
  if (Object.keys(primaryUpdates).length > 0) {
    batch.update(doc(db, COLLECTION, primaryId), primaryUpdates)
  }
  batch.update(doc(db, COLLECTION, secondaryId), { active: '0' })
  await batch.commit()
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
  const BATCH_SIZE = 500
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const batch = writeBatch(db)
    for (const id of ids.slice(i, i + BATCH_SIZE)) {
      batch.update(doc(db, COLLECTION, id), { active: '0', ...extraFields })
    }
    await batch.commit()
  }
}

// Free-text assignment — used for Vendor/Employee categories where the `salesman`
// field is repurposed (Callback / "is a salesperson" flags), not a real user link.
export async function bulkAssignSalesman(ids: string[], salesman: string): Promise<void> {
  if (!getCompanyId()) throw new Error('Not authenticated')
  const BATCH_SIZE = 500
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const batch = writeBatch(db)
    for (const id of ids.slice(i, i + BATCH_SIZE)) {
      batch.update(doc(db, COLLECTION, id), { salesman })
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
  const BATCH_SIZE = 500
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const batch = writeBatch(db)
    for (const id of ids.slice(i, i + BATCH_SIZE)) {
      batch.update(doc(db, COLLECTION, id), { category })
    }
    await batch.commit()
  }
}

export async function bulkSetFollowUpDate(ids: string[], date: Date | null): Promise<void> {
  if (!getCompanyId()) throw new Error('Not authenticated')
  const BATCH_SIZE = 500
  const value = date ? Timestamp.fromDate(date) : null
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const batch = writeBatch(db)
    for (const id of ids.slice(i, i + BATCH_SIZE)) {
      batch.update(doc(db, COLLECTION, id), { followUpDate: value })
    }
    await batch.commit()
  }
}

export async function bulkSetCallback(ids: string[], callback: string): Promise<void> {
  if (!getCompanyId()) throw new Error('Not authenticated')
  const BATCH_SIZE = 500
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const batch = writeBatch(db)
    for (const id of ids.slice(i, i + BATCH_SIZE)) {
      batch.update(doc(db, COLLECTION, id), { callback })
    }
    await batch.commit()
  }
}

export async function bulkDelete(ids: string[]): Promise<void> {
  if (!getCompanyId()) throw new Error('Not authenticated')
  const BATCH_SIZE = 500
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const batch = writeBatch(db)
    for (const id of ids.slice(i, i + BATCH_SIZE)) {
      batch.delete(doc(db, COLLECTION, id))
    }
    await batch.commit()
  }
}

/**
 * Sets or clears the "called" flag — the field /callback filters on.
 *
 * Vendors keep that flag in `salesman` while every other category keeps it in
 * `callback` (see vendorFields in models/customer), so the category has to be
 * passed in rather than assumed.
 */
export async function setCalledFlag(id: string, category: string, called: boolean): Promise<void> {
  const field = category.toLowerCase() === 'vendor' ? 'salesman' : 'callback'
  await updateDoc(doc(db, COLLECTION, id), { [field]: called ? 'Yes' : 'No' })
}

export async function setFollowUpDate(id: string, date: Date | null): Promise<void> {
  await updateDoc(doc(db, COLLECTION, id), {
    followUpDate: date ? Timestamp.fromDate(date) : null,
  })
}

export async function setContactAttempts(id: string, attempts: number): Promise<void> {
  await updateDoc(doc(db, COLLECTION, id), { contactAttempts: attempts })
}

// Requires a Firestore composite index: companyId ASC + followUpDate ASC.
// If missing, Firestore will log a link to create it in the browser console.
export function subscribeToFollowUps(
  onData: (items: CustomerItem[]) => void,
  onError: (err: Error) => void,
): Unsubscribe {
  const companyId = getCompanyId()
  if (!companyId) {
    onError(new Error('Not authenticated'))
    return () => {}
  }
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  yesterday.setHours(0, 0, 0, 0)

  const twoWeeks = new Date()
  twoWeeks.setDate(twoWeeks.getDate() + 14)

  return onSnapshot(
    query(
      collection(db, COLLECTION),
      where('companyId', '==', companyId),
      where('followUpDate', '>=', Timestamp.fromDate(yesterday)),
      where('followUpDate', '<=', Timestamp.fromDate(twoWeeks)),
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
        followUpDate: null,
        tags: [],
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
        assignedToUid: '',
        // Left blank on bulk import: a CSV of thousands of records isn't "mine"
        // in the sense the My Leads filter means, even though I ran the import.
        createdByUid: '',
        portalToken: '',
      }
      const data = { ...customerToFirestore(item, userId), companyId }
      const ref = r.id
        ? doc(db, COLLECTION, r.id)
        : doc(collection(db, COLLECTION))
      batch.set(ref, data)
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
