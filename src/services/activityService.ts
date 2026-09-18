import {
  collection, query, where, limit, onSnapshot, orderBy, startAfter, getDocs,
  addDoc, deleteDoc, doc, serverTimestamp, Timestamp,
  type DocumentData, type QueryDocumentSnapshot, type Unsubscribe,
} from 'firebase/firestore'
import { db } from '../firebase/config'
import { getCompanyId } from '../stores/authStore'
import type { Activity, ActivityType } from '../models/activity'

const COL = 'Activities'

function docToActivity(id: string, data: Record<string, unknown>): Activity {
  return {
    id,
    customerId: String(data.customerId ?? ''),
    companyId:  String(data.companyId  ?? ''),
    type:       (data.type as ActivityType) ?? 'note',
    note:       String(data.note     ?? ''),
    userId:     String(data.userId   ?? ''),
    userName:   String(data.userName ?? ''),
    createdAt:  data.createdAt instanceof Timestamp
      ? data.createdAt.toDate()
      : new Date(),
  }
}

/** Entries per page, live and paged alike. */
export const ACTIVITY_PAGE_SIZE = 100

export interface ActivityPage {
  items: Activity[]
  /** Cursor for the next call, or null when the feed is exhausted. */
  cursor: QueryDocumentSnapshot<DocumentData> | null
  /** False once a short page proves there's nothing older. */
  hasMore: boolean
}

function feedQuery(companyId: string) {
  return query(
    collection(db, COL),
    where('companyId', '==', companyId),
    orderBy('createdAt', 'desc'),
  )
}

/**
 * Company-wide feed, newest first.
 *
 * This used to be `limit(5000)` with **no orderBy** — chosen to avoid a
 * composite index — so Firestore returned an arbitrary 5,000 documents in
 * document-ID order and the page sorted them client-side. The result read as
 * "the most recent activity" while being a random slice that merely looked
 * chronological, with the genuinely newest entries potentially absent. The
 * index is in firestore.indexes.json; the cap is now one page with
 * loadOlderActivities behind it.
 */
export function subscribeToAllActivities(
  onData: (page: ActivityPage) => void,
  onError: (err: Error) => void,
): Unsubscribe {
  const companyId = getCompanyId()
  if (!companyId) { onError(new Error('Not authenticated')); return () => {} }
  return onSnapshot(
    query(feedQuery(companyId), limit(ACTIVITY_PAGE_SIZE)),
    snap => {
      const items: Activity[] = []
      for (const d of snap.docs) {
        try { items.push(docToActivity(d.id, d.data() as Record<string, unknown>)) } catch { /* skip */ }
      }
      onData({
        items,
        cursor: snap.docs.length > 0 ? snap.docs[snap.docs.length - 1] : null,
        hasMore: snap.size === ACTIVITY_PAGE_SIZE,
      })
    },
    onError,
  )
}

/**
 * One page of older activity, after `cursor`.
 *
 * A one-shot read: history that has already happened doesn't change, and a
 * second listener per page would keep every page live for the session.
 */
export async function loadOlderActivities(
  cursor: QueryDocumentSnapshot<DocumentData>,
): Promise<ActivityPage> {
  const companyId = getCompanyId()
  if (!companyId) return { items: [], cursor: null, hasMore: false }

  const snap = await getDocs(
    query(feedQuery(companyId), startAfter(cursor), limit(ACTIVITY_PAGE_SIZE)),
  )
  const items: Activity[] = []
  for (const d of snap.docs) {
    try { items.push(docToActivity(d.id, d.data() as Record<string, unknown>)) } catch { /* skip */ }
  }
  return {
    items,
    cursor: snap.docs.length > 0 ? snap.docs[snap.docs.length - 1] : null,
    hasMore: snap.size === ACTIVITY_PAGE_SIZE,
  }
}

// No composite index needed — filter companyId + customerId, sort client-side
export function subscribeToActivities(
  customerId: string,
  onData: (items: Activity[]) => void,
  onError: (err: Error) => void,
): Unsubscribe {
  const companyId = getCompanyId()
  if (!companyId) {
    onError(new Error('Not authenticated'))
    return () => {}
  }
  return onSnapshot(
    query(
      collection(db, COL),
      where('companyId', '==', companyId),
      where('customerId', '==', customerId),
    ),
    snap => {
      const items: Activity[] = []
      for (const d of snap.docs) {
        try { items.push(docToActivity(d.id, d.data() as Record<string, unknown>)) } catch { /* skip malformed */ }
      }
      items.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      onData(items)
    },
    onError,
  )
}

export async function addActivity(
  customerId: string,
  type: ActivityType,
  note: string,
  userId: string,
  userName: string,
): Promise<void> {
  const companyId = getCompanyId()
  if (!companyId) throw new Error('Not authenticated')
  await addDoc(collection(db, COL), {
    companyId,
    customerId,
    type,
    note,
    userId,
    userName,
    createdAt: serverTimestamp(),
  })
}

export async function deleteActivity(id: string): Promise<void> {
  await deleteDoc(doc(db, COL, id))
}
