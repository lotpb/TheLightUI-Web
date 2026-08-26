import {
  collection, doc, updateDoc, deleteDoc,
  onSnapshot, query, where, orderBy, serverTimestamp,
  Timestamp, type Unsubscribe,
} from 'firebase/firestore'
import { db } from '../firebase/config'
import { getCompanyId } from '../stores/authStore'
import type { ServiceRequest, ServiceRequestStatus } from '../models/serviceRequest'

const COL = 'serviceRequests'

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
  )

  return onSnapshot(
    q,
    snap => onData(snap.docs.map(d => toRequest(d.id, d.data()))),
    onError,
  )
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
