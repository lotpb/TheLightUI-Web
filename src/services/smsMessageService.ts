import {
  collection, doc, updateDoc, deleteDoc, writeBatch,
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

/**
 * Unified inbox of inbound replies across all customers, newest first.
 *
 * The cap is reported rather than silent: at the old hard limit of 100 the
 * hundred-and-first text simply stopped existing.
 */
export const SMS_INBOX_LIMIT = 300

export function subscribeToInboundSmsInbox(
  onData:  (items: SmsMessage[], hitCap: boolean) => void,
  onError: (e: Error) => void,
): Unsubscribe {
  const companyId = getCompanyId()
  if (!companyId) { onData([], false); return () => {} }

  const q = query(
    collection(db, COL),
    where('companyId', '==', companyId),
    where('direction', '==', 'inbound'),
    orderBy('createdAt', 'desc'),
    limit(SMS_INBOX_LIMIT),
  )

  return onSnapshot(
    q,
    snap => onData(snap.docs.map(d => toMessage(d.id, d.data())), snap.size === SMS_INBOX_LIMIT),
    onError,
  )
}

/**
 * Outbound texts Twilio could not deliver.
 *
 * smsStatusWebhook writes status: 'failed' and an errorMessage, and no page
 * read either — so a text that never arrived was knowable only by opening
 * that one customer's thread.
 *
 * Two equality filters need no composite index; the client-side sort avoids
 * one that orderBy would require. Inbound messages are 'received', never
 * 'failed', so direction doesn't need filtering.
 */
export function subscribeToFailedSms(
  onData:  (items: SmsMessage[]) => void,
  onError: (e: Error) => void,
): Unsubscribe {
  const companyId = getCompanyId()
  if (!companyId) { onData([]); return () => {} }

  const q = query(
    collection(db, COL),
    where('companyId', '==', companyId),
    where('status', '==', 'failed'),
    limit(SMS_INBOX_LIMIT),
  )

  return onSnapshot(
    q,
    snap => {
      const items = snap.docs.map(d => toMessage(d.id, d.data()))
      items.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      onData(items)
    },
    onError,
  )
}

/** Read was a one-way door: markSmsRead only ever wrote `true`. */
export async function setSmsRead(id: string, read: boolean): Promise<void> {
  await updateDoc(doc(db, COL, id), { read })
}

/** Back-compat alias for the per-customer thread on the record page. */
export async function markSmsRead(id: string): Promise<void> {
  await setSmsRead(id, true)
}

export async function markAllSmsRead(ids: string[]): Promise<void> {
  if (ids.length === 0) return
  // Firestore caps a batch at 500 writes.
  for (let i = 0; i < ids.length; i += 450) {
    const batch = writeBatch(db)
    for (const id of ids.slice(i, i + 450)) batch.update(doc(db, COL, id), { read: true })
    await batch.commit()
  }
}

/**
 * Ties a text from an unrecognised number to a record.
 *
 * The webhook tries an exact phone match then a bounded last-ten-digits scan,
 * so an unmatched text means the number is on no record — and without a
 * customerId there's nobody to send a reply to.
 */
export async function attachSmsToCustomer(id: string, customerId: string): Promise<void> {
  await updateDoc(doc(db, COL, id), { customerId })
}

/** firestore.rules permits this for non-viewers; nothing offered it. */
export async function deleteSmsMessage(id: string): Promise<void> {
  await deleteDoc(doc(db, COL, id))
}

export async function sendSms(customerId: string, body: string): Promise<void> {
  const fn = httpsCallable<{ customerId: string; body: string }, { sid: string }>(getFunctions(), 'sendSms')
  await fn({ customerId, body })
}
