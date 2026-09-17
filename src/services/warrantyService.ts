import {
  collection, onSnapshot, addDoc, updateDoc, deleteDoc,
  doc, serverTimestamp, Timestamp, query, where, limit,
  type Unsubscribe,
} from 'firebase/firestore'
import { db } from '../firebase/config'
import { getCompanyId } from '../stores/authStore'
import type { Warranty } from '../models/warranty'
import { warnIfCapped } from './realtimeCap'

const COL = 'Warranties'

// Safety cap for the real-time listener — same reasoning as customerService's
// REALTIME_LIMIT.
const WARRANTY_REALTIME_LIMIT = 5_000

function toDate(val: unknown): Date {
  if (val instanceof Timestamp) return val.toDate()
  if (val && typeof val === 'object' && 'seconds' in val)
    return new Date((val as { seconds: number }).seconds * 1000)
  if (typeof val === 'string' || typeof val === 'number') return new Date(val)
  return new Date()
}

function docToWarranty(id: string, data: Record<string, unknown>): Warranty {
  return {
    id,
    companyId:          String(data.companyId    ?? ''),
    customerId:         String(data.customerId    ?? ''),
    customerName:       String(data.customerName  ?? ''),
    title:              String(data.title         ?? ''),
    provider:           String(data.provider      ?? ''),
    startDate:          toDate(data.startDate),
    expirationDate:     toDate(data.expirationDate),
    notes:              String(data.notes         ?? ''),
    isActive:           data.isActive !== false,
    lastReminderSentAt: data.lastReminderSentAt ? toDate(data.lastReminderSentAt) : null,
    createdAt:          toDate(data.createdAt),
  }
}

export function subscribeToWarranties(
  onData: (items: Warranty[], hitCap?: boolean) => void,
  onError: (err: Error) => void,
): Unsubscribe {
  const companyId = getCompanyId()
  if (!companyId) {
    onError(new Error('Not authenticated'))
    return () => {}
  }
  return onSnapshot(
    query(collection(db, COL), where('companyId', '==', companyId), limit(WARRANTY_REALTIME_LIMIT)),
    snap => {
      const hitCap = warnIfCapped('Warranties', snap.size, companyId, WARRANTY_REALTIME_LIMIT)
      const items: Warranty[] = []
      for (const d of snap.docs) {
        try { items.push(docToWarranty(d.id, d.data() as Record<string, unknown>)) }
        catch (e) { console.warn('[Warranties] skipping malformed doc', d.id, e) }
      }
      items.sort((a, b) => a.expirationDate.getTime() - b.expirationDate.getTime())
      onData(items, hitCap)
    },
    onError,
  )
}

/**
 * The writable fields of a warranty.
 *
 * These were nine positional parameters, which is how `handleDeactivate` came
 * to read `updateWarranty(w.id, w.customerId, w.customerName, w.title,
 * w.provider, w.startDate, w.expirationDate, w.notes, false)` — a call where
 * transposing any two of the four adjacent strings compiles cleanly and
 * silently rewrites the record.
 */
export interface WarrantyFields {
  customerId: string
  customerName: string
  title: string
  provider: string
  startDate: Date
  expirationDate: Date
  notes: string
}

export async function addWarranty(fields: WarrantyFields): Promise<void> {
  const companyId = getCompanyId()
  await addDoc(collection(db, COL), {
    companyId, ...fields,
    isActive: true,
    lastReminderSentAt: null,
    createdAt: serverTimestamp(),
  })
}

/**
 * Updates a warranty, re-arming its expiry reminder if the term moved.
 *
 * warrantyExpirationReminders skips any warranty that already has a
 * `lastReminderSentAt`, so exactly one reminder was ever sent per document:
 * extending coverage by five years left the stamp in place and guaranteed the
 * new expiration date would never be announced to anyone. Clearing it when
 * the date changes makes a renewal behave like the new coverage period it is,
 * while an edit that only touches the title or notes leaves the stamp alone,
 * so nobody receives a second copy of the same reminder.
 */
export async function updateWarranty(
  id: string,
  fields: WarrantyFields & { isActive: boolean },
  opts: { previousExpiration?: Date | null } = {},
): Promise<void> {
  const { previousExpiration } = opts
  const termMoved =
    previousExpiration instanceof Date &&
    previousExpiration.getTime() !== fields.expirationDate.getTime()

  await updateDoc(doc(db, COL, id), {
    ...fields,
    ...(termMoved ? { lastReminderSentAt: null } : {}),
  })
}

export async function deleteWarranty(id: string): Promise<void> {
  await deleteDoc(doc(db, COL, id))
}

// Per-customer scope for the detail page. See subscribeToCustomerInvoices.
export function subscribeToCustomerWarranties(
  customerId: string,
  onData: (items: Warranty[]) => void,
  onError: (err: Error) => void,
): Unsubscribe {
  const companyId = getCompanyId()
  if (!companyId) { onError(new Error('Not authenticated')); return () => {} }
  return onSnapshot(
    query(
      collection(db, COL),
      where('companyId', '==', companyId),
      where('customerId', '==', customerId),
    ),
    snap => {
      const items: Warranty[] = []
      for (const d of snap.docs) {
        try { items.push(docToWarranty(d.id, d.data() as Record<string, unknown>)) } catch { }
      }
      items.sort((a, b) => b.expirationDate.getTime() - a.expirationDate.getTime())
      onData(items)
    },
    onError,
  )
}
