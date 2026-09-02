import {
  collection, doc, updateDoc,
  onSnapshot, query, where, orderBy, limit,
  Timestamp, type Unsubscribe,
} from 'firebase/firestore'
import { getFunctions, httpsCallable } from 'firebase/functions'
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

// Sends a single email to one customer.
//
// Deliberately reuses the bulkSendEmail callable with a one-element recipient
// list rather than adding a near-duplicate function: that path already sets the
// per-company reply_to (so replies thread back) and logs an outbound
// emailMessages doc, which is what makes the sent message show up in the thread.
export async function sendEmail(customerId: string, subject: string, body: string): Promise<void> {
  const fn = httpsCallable<
    { customerIds: string[]; subject: string; body: string },
    { sent: number; skipped: number }
  >(getFunctions(), 'bulkSendEmail')

  const result = await fn({ customerIds: [customerId], subject, body })
  // bulkSendEmail reports per-recipient outcomes instead of throwing, so a
  // skipped send (missing/invalid address) would otherwise look like success.
  if (result.data.sent < 1) {
    throw new Error('Email was not sent — check that this customer has a valid email address.')
  }
}
