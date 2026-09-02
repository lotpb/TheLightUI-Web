import {
  collection, doc, updateDoc,
  onSnapshot, query, where, orderBy, limit,
  Timestamp, type Unsubscribe,
} from 'firebase/firestore'
import { getFunctions, httpsCallable } from 'firebase/functions'
import { db } from '../firebase/config'
import { getCompanyId } from '../stores/authStore'
import type { SmsMessage, SmsDirection, SmsStatus } from '../models/smsMessage'

const COL = 'smsMessages'

function toDate(v: unknown): Date {
  if (v instanceof Timestamp) return v.toDate()
  return new Date()
}

function toMessage(id: string, d: Record<string, unknown>): SmsMessage {
  return {
    id,
    companyId:    String(d['companyId']  ?? ''),
    customerId:   String(d['customerId'] ?? ''),
    direction:    (d['direction'] as SmsDirection) ?? 'outbound',
    fromNumber:   String(d['fromNumber'] ?? ''),
    toNumber:     String(d['toNumber']   ?? ''),
    body:         String(d['body']       ?? ''),
    status:       (d['status'] as SmsStatus) ?? 'sent',
    errorMessage: String(d['errorMessage'] ?? ''),
    createdAt:    toDate(d['createdAt']),
    read:         Boolean(d['read'] ?? false),
  }
}

// Full thread (sent + received) for one customer, oldest first.
export function subscribeToSmsThread(
  customerId: string,
  onData:  (items: SmsMessage[]) => void,
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
export function subscribeToInboundSmsInbox(
  onData:  (items: SmsMessage[]) => void,
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

export async function markSmsRead(id: string): Promise<void> {
  await updateDoc(doc(db, COL, id), { read: true })
}

export async function sendSms(customerId: string, body: string): Promise<void> {
  const fn = httpsCallable<{ customerId: string; body: string }, { sid: string }>(getFunctions(), 'sendSms')
  await fn({ customerId, body })
}
