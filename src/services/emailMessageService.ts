import {
  collection, doc, updateDoc,
  onSnapshot, query, where, orderBy, limit,
  Timestamp, type Unsubscribe,
} from 'firebase/firestore'
import { db } from '../firebase/config'
import { getCompanyId } from '../stores/authStore'
import type { EmailMessage, EmailDirection } from '../models/emailMessage'

const COL = 'emailMessages'

function toDate(v: unknown): Date {
  if (v instanceof Timestamp) return v.toDate()
  return new Date()
}

function toMessage(id: string, d: Record<string, unknown>): EmailMessage {
  return {
    id,
    companyId:   String(d['companyId']   ?? ''),
    customerId:  String(d['customerId']  ?? ''),
    direction:   (d['direction'] as EmailDirection) ?? 'outbound',
    fromAddress: String(d['fromAddress'] ?? ''),
    toAddress:   String(d['toAddress']   ?? ''),
    subject:     String(d['subject']     ?? ''),
    body:        String(d['body']        ?? ''),
    createdAt:   toDate(d['createdAt']),
    read:        Boolean(d['read'] ?? false),
  }
}

// Full thread (sent + received) for one customer, oldest first.
export function subscribeToEmailThread(
  customerId: string,
  onData:  (items: EmailMessage[]) => void,
  onError: (e: Error) => void,
): Unsubscribe {
  const companyId = getCompanyId()
  if (!companyId || !customerId) { onData([]); return () => {} }

  const q = query(
    collection(db, COL),
    where('companyId', '==', companyId),
    where('customerId', '==', customerId),
    orderBy('createdAt', 'asc'),
  )

  return onSnapshot(
    q,
    snap => onData(snap.docs.map(d => toMessage(d.id, d.data()))),
    onError,
  )
}

// Unified inbox of inbound replies across all customers, newest first.
export function subscribeToInboundInbox(
  onData:  (items: EmailMessage[]) => void,
  onError: (e: Error) => void,
): Unsubscribe {
  const companyId = getCompanyId()
  if (!companyId) { onData([]); return () => {} }

  const q = query(
    collection(db, COL),
    where('companyId', '==', companyId),
    where('direction', '==', 'inbound'),
    orderBy('createdAt', 'desc'),
    limit(100),
  )

  return onSnapshot(
    q,
    snap => onData(snap.docs.map(d => toMessage(d.id, d.data()))),
    onError,
  )
}

export async function markEmailRead(id: string): Promise<void> {
  await updateDoc(doc(db, COL, id), { read: true })
}
