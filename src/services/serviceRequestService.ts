import {
  collection, doc, getDoc, updateDoc, deleteDoc,
  onSnapshot, query, where, orderBy, limit, serverTimestamp,
  Timestamp, type Unsubscribe,
} from 'firebase/firestore'
import { db } from '../firebase/config'
import { getCompanyId } from '../stores/authStore'
import type { ServiceRequest, ServiceRequestStatus } from '../models/serviceRequest'

const COL = 'serviceRequests'

// Safety cap for the real-time listener. Especially important here since
// this collection accepts anonymous public submissions from the customer
// portal — nothing stops it from growing unbounded.
const REQUEST_REALTIME_LIMIT = 5_000

function toDate(v: unknown): Date {
  if (v instanceof Timestamp) return v.toDate()
  return new Date()
}

function toRequest(id: string, d: Record<string, unknown>): ServiceRequest {
  return {
    id,
    companyId:     String(d['companyId']     ?? ''),
    token:         String(d['token']         ?? ''),
    customerId:    String(d['customerId']    ?? ''),
    name:          String(d['name']          ?? ''),
    phone:         String(d['phone']         ?? ''),
    email:         String(d['email']         ?? ''),
    description:   String(d['description']  ?? ''),
    preferredDate: String(d['preferredDate'] ?? ''),
    status:        (d['status'] as ServiceRequestStatus) ?? 'new',
    createdAt:     toDate(d['createdAt']),
    firstContactedAt: d['firstContactedAt'] ? toDate(d['firstContactedAt']) : null,
    resolvedAt:       d['resolvedAt']       ? toDate(d['resolvedAt'])       : null,
  }
}

export function subscribeToServiceRequests(
  onData:  (items: ServiceRequest[]) => void,
  onError: (e: Error) => void,
): Unsubscribe {
  const companyId = getCompanyId()
  if (!companyId) { onData([]); return () => {} }

  const q = query(
    collection(db, COL),
    where('companyId', '==', companyId),
    orderBy('createdAt', 'desc'),
    limit(REQUEST_REALTIME_LIMIT),
  )

  return onSnapshot(
    q,
    snap => {
      if (snap.size === REQUEST_REALTIME_LIMIT) {
        console.warn(`[subscribeToServiceRequests] hit ${REQUEST_REALTIME_LIMIT}-document cap for company ${companyId}.`)
      }
      onData(snap.docs.map(d => toRequest(d.id, d.data())))
    },
    onError,
  )
}

export async function getServiceRequest(id: string): Promise<ServiceRequest | null> {
  const snap = await getDoc(doc(db, COL, id))
  if (!snap.exists()) return null
  return toRequest(snap.id, snap.data())
}

export async function updateServiceRequestStatus(request: ServiceRequest, status: ServiceRequestStatus): Promise<void> {
  const updates: Record<string, unknown> = { status }
  if (!request.firstContactedAt && status !== 'new') {
    updates.firstContactedAt = serverTimestamp()
  }
  if ((status === 'completed' || status === 'dismissed') && !request.resolvedAt) {
    updates.resolvedAt = serverTimestamp()
  }
  if (status === 'new') {
    updates.resolvedAt = null
  }
  await updateDoc(doc(db, COL, request.id), updates)
}

export async function deleteServiceRequest(id: string): Promise<void> {
  await deleteDoc(doc(db, COL, id))
}

// Per-customer scope for the detail page's Related Records. Two equality
// filters need no composite index; the client-side sort avoids one that
// orderBy would require, and avoids dropping docs missing createdAt.
export function subscribeToCustomerServiceRequests(
  customerId: string,
  onData:  (items: ServiceRequest[]) => void,
  onError: (e: Error) => void,
): Unsubscribe {
  const companyId = getCompanyId()
  if (!companyId) { onData([]); return () => {} }

  return onSnapshot(
    query(
      collection(db, COL),
      where('companyId', '==', companyId),
      where('customerId', '==', customerId),
    ),
    snap => {
      const items = snap.docs.map(d => toRequest(d.id, d.data()))
      items.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      onData(items)
    },
    onError,
  )
}
