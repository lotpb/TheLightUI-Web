import {
  collection, doc, updateDoc, deleteDoc, writeBatch,
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
    attachmentNames: Array.isArray(d['attachmentNames'])
      ? (d['attachmentNames'] as unknown[]).map(String).filter(n => n !== '')
      : [],
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

/**
 * Unified inbox of inbound replies across all customers, newest first.
 *
 * The cap is reported rather than silent: at the old hard limit of 100 the
 * hundred-and-first reply simply stopped existing, with nothing on the page
 * saying so.
 */
export const INBOX_LIMIT = 300

export function subscribeToInboundInbox(
  onData:  (items: EmailMessage[], hitCap: boolean) => void,
  onError: (e: Error) => void,
): Unsubscribe {
  const companyId = getCompanyId()
  if (!companyId) { onData([], false); return () => {} }

  const q = query(
    collection(db, COL),
    where('companyId', '==', companyId),
    where('direction', '==', 'inbound'),
    orderBy('createdAt', 'desc'),
    limit(INBOX_LIMIT),
  )

  return onSnapshot(
    q,
    snap => onData(snap.docs.map(d => toMessage(d.id, d.data())), snap.size === INBOX_LIMIT),
    onError,
  )
}

/** Read was a one-way door: markEmailRead only ever wrote `true`. */
export async function setEmailRead(id: string, read: boolean): Promise<void> {
  await updateDoc(doc(db, COL, id), { read })
}

/** Back-compat alias for the per-customer thread on the record page. */
export async function markEmailRead(id: string): Promise<void> {
  await setEmailRead(id, true)
}

export async function markAllEmailsRead(ids: string[]): Promise<void> {
  if (ids.length === 0) return
  // Firestore caps a batch at 500 writes.
  for (let i = 0; i < ids.length; i += 450) {
    const batch = writeBatch(db)
    for (const id of ids.slice(i, i + 450)) batch.update(doc(db, COL, id), { read: true })
    await batch.commit()
  }
}

/**
 * Ties a reply the webhook couldn't match to a customer record.
 *
 * The webhook matches on an exact `email` equality query, so a customer
 * replying from any other address arrives with customerId '' — visible in the
 * inbox, attached to nothing, and impossible to answer, since the reply path
 * needs a customer id.
 */
export async function attachEmailToCustomer(id: string, customerId: string): Promise<void> {
  await updateDoc(doc(db, COL, id), { customerId })
}

/** firestore.rules permits this for non-viewers; nothing offered it. */
export async function deleteEmailMessage(id: string): Promise<void> {
  await deleteDoc(doc(db, COL, id))
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
