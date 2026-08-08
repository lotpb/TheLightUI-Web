import {
  collection, doc, addDoc, updateDoc, deleteDoc,
  onSnapshot, getDoc, getDocs, writeBatch, query, where,
  type Unsubscribe,
} from 'firebase/firestore'
import { db } from '../firebase/config'
import { customerFromDoc, customerToFirestore, type CustomerItem } from '../models/customer'
import { getCompanyId } from '../stores/authStore'

const COLLECTION = 'Customers'

export function subscribeToCustomers(
  onData: (items: CustomerItem[]) => void,
  onError: (err: Error) => void,
): Unsubscribe {
  const companyId = getCompanyId()
  if (!companyId) {
    onError(new Error('Not authenticated'))
    return () => {}
  }
  // No orderBy — docs missing creationDate are silently dropped by Firestore
  // when orderBy is used. Sort client-side so every document is included.
  return onSnapshot(
    query(collection(db, COLLECTION), where('companyId', '==', companyId)),
    (snap) => {
      const items: CustomerItem[] = []
      for (const d of snap.docs) {
        try {
          items.push(customerFromDoc(d))
        } catch {
          // skip malformed doc rather than crashing the whole list
        }
      }
      items.sort((a, b) => b.creationDate.getTime() - a.creationDate.getTime())
      onData(items)
    },
    onError,
  )
}

export async function getCustomer(id: string): Promise<CustomerItem | null> {
  const snap = await getDoc(doc(db, COLLECTION, id))
  if (!snap.exists()) return null
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

export async function deactivateCustomer(id: string): Promise<void> {
  await updateDoc(doc(db, COLLECTION, id), { active: '0' })
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
    startDate: c.startDate.toISOString(),
    completionDate: c.completionDate.toISOString(),
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

export async function getAllCustomersOnce(): Promise<CustomerItem[]> {
  const companyId = getCompanyId()
  if (!companyId) throw new Error('Not authenticated')
  const snap = await getDocs(
    query(collection(db, COLLECTION), where('companyId', '==', companyId))
  )
  const items: CustomerItem[] = []
  for (const d of snap.docs) {
    try { items.push(customerFromDoc(d)) } catch { /* skip malformed */ }
  }
  items.sort((a, b) => b.creationDate.getTime() - a.creationDate.getTime())
  return items
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
