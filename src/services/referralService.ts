import {
  collection, doc, addDoc, deleteDoc,
  onSnapshot, query, where, limit, serverTimestamp,
  type Unsubscribe,
} from 'firebase/firestore'
import { db } from '../firebase/config'
import { getCompanyId } from '../stores/authStore'
import { warnIfCapped } from './realtimeCap'

const COL = 'referrals'

// Safety cap for the real-time listener — same reasoning as customerService's
// REALTIME_LIMIT.
const REFERRAL_REALTIME_LIMIT = 5_000

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
  onData: (items: Referral[], hitCap?: boolean) => void,
  onError: (err: Error) => void,
): Unsubscribe {
  const companyId = getCompanyId()
  if (!companyId) { onError(new Error('Not authenticated')); return () => {} }
  return onSnapshot(
    query(collection(db, COL), where('companyId', '==', companyId), limit(REFERRAL_REALTIME_LIMIT)),
    snap => {
      const hitCap = warnIfCapped('referrals', snap.size, companyId, REFERRAL_REALTIME_LIMIT)
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
      onData(items, hitCap)
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

function toReferral(id: string, r: Record<string, unknown>): Referral {
  return {
    id,
    companyId:      String(r.companyId     ?? ''),
    referrerId:     String(r.referrerId    ?? ''),
    referrerName:   String(r.referrerName  ?? ''),
    referredId:     String(r.referredId    ?? ''),
    referredName:   String(r.referredName  ?? ''),
    referredAmount: Number(r.referredAmount ?? 0),
    notes:          String(r.notes         ?? ''),
    createdAt:      toDate(r.createdAt),
  }
}

/**
 * Referrals touching one customer, for the detail page's Related Records.
 *
 * A customer can be either side of a referral and Firestore has no OR across
 * two different fields, so this runs both queries and merges. Each side is
 * reported separately because the UI labels them differently ("Referred: X"
 * vs "Referred by: Y").
 */
export function subscribeToCustomerReferrals(
  customerId: string,
  onData: (referredByThem: Referral[], referredToThem: Referral[]) => void,
  onError: (err: Error) => void,
): Unsubscribe {
  const companyId = getCompanyId()
  if (!companyId) { onError(new Error('Not authenticated')); return () => {} }

  let asReferrer: Referral[] = []
  let asReferred: Referral[] = []
  const byDateDesc = (a: Referral, b: Referral) => b.createdAt.getTime() - a.createdAt.getTime()
  const emit = () => onData([...asReferrer].sort(byDateDesc), [...asReferred].sort(byDateDesc))

  const unsubReferrer = onSnapshot(
    query(collection(db, COL), where('companyId', '==', companyId), where('referrerId', '==', customerId)),
    snap => { asReferrer = snap.docs.map(d => toReferral(d.id, d.data() as Record<string, unknown>)); emit() },
    onError,
  )
  const unsubReferred = onSnapshot(
    query(collection(db, COL), where('companyId', '==', companyId), where('referredId', '==', customerId)),
    snap => { asReferred = snap.docs.map(d => toReferral(d.id, d.data() as Record<string, unknown>)); emit() },
    onError,
  )

  return () => { unsubReferrer(); unsubReferred() }
}
