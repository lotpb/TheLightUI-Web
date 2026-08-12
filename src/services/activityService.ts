import {
  collection, query, where, onSnapshot,
  addDoc, deleteDoc, doc, serverTimestamp, Timestamp,
  type Unsubscribe,
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

// Company-wide feed — single companyId filter, no composite index needed
export function subscribeToAllActivities(
  onData: (items: Activity[]) => void,
  onError: (err: Error) => void,
): Unsubscribe {
  const companyId = getCompanyId()
  if (!companyId) { onError(new Error('Not authenticated')); return () => {} }
  return onSnapshot(
    query(collection(db, COL), where('companyId', '==', companyId)),
    snap => {
      const items: Activity[] = []
      for (const d of snap.docs) {
        try { items.push(docToActivity(d.id, d.data() as Record<string, unknown>)) } catch { /* skip */ }
      }
      items.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      onData(items)
    },
    onError,
  )
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
