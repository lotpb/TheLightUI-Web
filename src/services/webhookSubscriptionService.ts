import {
  collection, doc, addDoc, updateDoc, deleteDoc,
  onSnapshot, query, where, orderBy,
  serverTimestamp, Timestamp, type Unsubscribe,
} from 'firebase/firestore'
import { db } from '../firebase/config'
import { getCompanyId } from '../stores/authStore'
import { generateWebhookSecret, type WebhookSubscription, type WebhookEvent, type WebhookStatus } from '../models/webhookSubscription'

const COL = 'webhookSubscriptions'

function toDate(v: unknown): Date {
  if (v instanceof Timestamp) return v.toDate()
  return new Date()
}

function toSub(id: string, d: Record<string, unknown>): WebhookSubscription {
  return {
    id,
    companyId: String(d['companyId'] ?? ''),
    url:       String(d['url']       ?? ''),
    events:    Array.isArray(d['events']) ? d['events'] as WebhookEvent[] : [],
    secret:    String(d['secret']    ?? ''),
    enabled:   Boolean(d['enabled']  ?? true),
    createdAt: toDate(d['createdAt']),
    lastTriggeredAt: d['lastTriggeredAt'] ? toDate(d['lastTriggeredAt']) : null,
    lastStatus: (d['lastStatus'] as WebhookStatus) ?? null,
    lastError:  d['lastError'] ? String(d['lastError']) : null,
    failureCount: Number(d['failureCount'] ?? 0),
  }
}

export function subscribeToWebhooks(
  onData:  (items: WebhookSubscription[]) => void,
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
    snap => onData(snap.docs.map(d => toSub(d.id, d.data()))),
    onError,
  )
}

export async function createWebhook(url: string, events: WebhookEvent[]): Promise<string> {
  const companyId = getCompanyId()
  if (!companyId) throw new Error('Not authenticated')

  const ref = await addDoc(collection(db, COL), {
    companyId,
    url,
    events,
    secret: generateWebhookSecret(),
    enabled: true,
    createdAt: serverTimestamp(),
    lastTriggeredAt: null,
    lastStatus: null,
    lastError: null,
    failureCount: 0,
  })
  return ref.id
}

export async function updateWebhook(
  id: string,
  fields: Partial<Pick<WebhookSubscription, 'url' | 'events' | 'enabled'>>,
): Promise<void> {
  await updateDoc(doc(db, COL, id), { ...fields })
}

export async function deleteWebhook(id: string): Promise<void> {
  await deleteDoc(doc(db, COL, id))
}
