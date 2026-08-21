import {
  collection, doc, addDoc, updateDoc, deleteDoc,
  onSnapshot, getDoc, getDocs, writeBatch, query, where, orderBy,
  startAfter, limit, Timestamp,
  type QueryDocumentSnapshot, type Unsubscribe,
} from 'firebase/firestore'
import { db } from '../firebase/config'
import { customerFromDoc, customerToFirestore, type CustomerItem } from '../models/customer'
import { getCompanyId } from '../stores/authStore'

const COLLECTION = 'Customers'

// Safety cap for the real-time listener. Prevents loading 100k+ documents into
// the browser's JS heap. Companies that grow past this limit should migrate to
// server-side aggregation (Cloud Functions) for analytics and cursor pagination
// for the list view. 2 000 covers virtually all production use cases today.
const REALTIME_LIMIT = 2_000

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
  const data = { ...customerToFirestore(customer as CustomerItem, userId), companyId }
  const ref = await addDoc(collection(db, COLLECTION), data)
  return ref.id
}

export async function updateCustomer(
  id: string,
  customer: CustomerItem,
  userId?: string,
): Promise<void> {
  const companyId = getCompanyId()
  const data = { ...customerToFirestore(customer, userId), companyId }
  await updateDoc(doc(db, COLLECTION, id), data)
}

export async function deleteCustomer(id: string): Promise<void> {
  await deleteDoc(doc(db, COLLECTION, id))
}

export async function deactivateCustomer(id: string, extraFields: Record<string, unknown> = {}): Promise<void> {
  await updateDoc(doc(db, COLLECTION, id), { active: '0', ...extraFields })
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

export async function bulkDeactivate(ids: string[]): Promise<void> {
  if (!getCompanyId()) throw new Error('Not authenticated')
  const BATCH_SIZE = 500
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const batch = writeBatch(db)
    for (const id of ids.slice(i, i + BATCH_SIZE)) {
      batch.update(doc(db, COLLECTION, id), { active: '0' })
    }
    await batch.commit()
  }
}

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

export async function setFollowUpDate(id: string, date: Date | null): Promise<void> {
  await updateDoc(doc(db, COLLECTION, id), {
    followUpDate: date ? Timestamp.fromDate(date) : null,
  })
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
