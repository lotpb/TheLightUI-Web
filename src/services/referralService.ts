import {
  collection, doc, addDoc, deleteDoc,
  onSnapshot, query, where, serverTimestamp,
  type Unsubscribe,
} from 'firebase/firestore'
import { db } from '../firebase/config'
import { getCompanyId } from '../stores/authStore'

const COL = 'referrals'

export interface Referral {
  id: string
  companyId: string
  referrerId: string
  referrerName: string
  referredId: string
  referredName: string
  referredAmount: number
  notes: string
  createdAt: Date
}

function toDate(v: unknown): Date {
  if (v && typeof v === 'object' && 'toDate' in v) {
    return (v as { toDate(): Date }).toDate()
  }
  return new Date()
}

export function subscribeToReferrals(
  onData: (items: Referral[]) => void,
  onError: (err: Error) => void,
): Unsubscribe {
  const companyId = getCompanyId()
  if (!companyId) { onError(new Error('Not authenticated')); return () => {} }
  return onSnapshot(
    query(collection(db, COL), where('companyId', '==', companyId)),
    snap => {
      const items: Referral[] = snap.docs.map(d => {
        const r = d.data() as Record<string, unknown>
        return {
          id: d.id,
          companyId:     String(r.companyId     ?? ''),
          referrerId:    String(r.referrerId    ?? ''),
          referrerName:  String(r.referrerName  ?? ''),
          referredId:    String(r.referredId    ?? ''),
          referredName:  String(r.referredName  ?? ''),
          referredAmount: Number(r.referredAmount ?? 0),
          notes:         String(r.notes         ?? ''),
          createdAt:     toDate(r.createdAt),
        }
      })
      items.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      onData(items)
    },
    onError,
  )
}

export async function addReferral(params: {
  referrerId: string
  referrerName: string
  referredId: string
  referredName: string
  referredAmount: number
  notes: string
}): Promise<string> {
  const companyId = getCompanyId()
  if (!companyId) throw new Error('Not authenticated')
  const ref = await addDoc(collection(db, COL), {
    companyId,
    referrerId:    params.referrerId,
    referrerName:  params.referrerName,
    referredId:    params.referredId,
    referredName:  params.referredName,
    referredAmount: params.referredAmount,
    notes:         params.notes,
    createdAt:     serverTimestamp(),
  })
  return ref.id
}

export async function deleteReferral(id: string): Promise<void> {
  await deleteDoc(doc(db, COL, id))
}
