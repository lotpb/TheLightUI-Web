import {
  collection, doc, updateDoc, writeBatch,
  onSnapshot, query, where, orderBy, limit,
  Timestamp, type Unsubscribe,
} from 'firebase/firestore'
import { db } from '../firebase/config'
import { getCompanyId } from '../stores/authStore'
import type { AppNotification } from '../models/notification'

const COL = 'notifications'

function toDate(v: unknown): Date {
  if (v instanceof Timestamp) return v.toDate()
  return new Date()
}

function toNotification(id: string, d: Record<string, unknown>): AppNotification {
  return {
    id,
    companyId: String(d['companyId'] ?? ''),
    type:      String(d['type']      ?? ''),
    title:     String(d['title']     ?? ''),
    body:      String(d['body']      ?? ''),
    linkTo:    String(d['linkTo']    ?? '/'),
    read:      Boolean(d['read']     ?? false),
    createdAt: toDate(d['createdAt']),
  }
}

export function subscribeToNotifications(
  onData:  (items: AppNotification[]) => void,
  onError: (e: Error) => void,
): Unsubscribe {
  const companyId = getCompanyId()
  if (!companyId) { onData([]); return () => {} }

  const q = query(
    collection(db, COL),
    where('companyId', '==', companyId),
    orderBy('createdAt', 'desc'),
    limit(50),
  )

  return onSnapshot(
    q,
    snap => onData(snap.docs.map(d => toNotification(d.id, d.data()))),
    onError,
  )
}

export async function markNotificationRead(id: string): Promise<void> {
  await updateDoc(doc(db, COL, id), { read: true })
}

export async function markAllNotificationsRead(ids: string[]): Promise<void> {
  if (ids.length === 0) return
  const batch = writeBatch(db)
  for (const id of ids) batch.update(doc(db, COL, id), { read: true })
  await batch.commit()
}
