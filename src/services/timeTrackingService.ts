import {
  collection, doc, addDoc, updateDoc, deleteDoc,
  onSnapshot, query, where, limit, Timestamp, serverTimestamp,
  type Unsubscribe,
} from 'firebase/firestore'
import { db } from '../firebase/config'
import { getCompanyId } from '../stores/authStore'
import { warnIfCapped } from './realtimeCap'

const COL = 'timeEntries'

// Safety cap for the real-time listener — same reasoning as customerService's
// REALTIME_LIMIT. Clock-in/out entries accumulate fast (one per employee per
// shift), so this is one of the higher-risk collections for hitting scale.
const TIME_ENTRY_REALTIME_LIMIT = 5_000

export interface GeoPoint {
  lat: number
  lng: number
  accuracy: number
}

export interface TimeEntry {
  id: string
  companyId: string
  customerId: string
  customerName: string
  clockedInBy: string
  clockedInById: string
  clockIn: Date
  clockOut: Date | null
  notes: string
  durationMinutes: number | null
  clockInLocation: GeoPoint | null
  clockOutLocation: GeoPoint | null
}

function toGeoPoint(v: unknown): GeoPoint | null {
  if (!v || typeof v !== 'object') return null
  const g = v as Record<string, unknown>
  if (typeof g.lat !== 'number' || typeof g.lng !== 'number') return null
  return { lat: g.lat, lng: g.lng, accuracy: typeof g.accuracy === 'number' ? g.accuracy : 0 }
}

function toDate(v: unknown): Date {
  if (v instanceof Timestamp) return v.toDate()
  return new Date()
}

function docToEntry(id: string, d: Record<string, unknown>): TimeEntry {
  return {
    id,
    companyId:     String(d.companyId     ?? ''),
    customerId:    String(d.customerId    ?? ''),
    customerName:  String(d.customerName  ?? ''),
    clockedInBy:   String(d.clockedInBy   ?? ''),
    clockedInById: String(d.clockedInById ?? ''),
    clockIn:       toDate(d.clockIn),
    clockOut:      d.clockOut ? toDate(d.clockOut) : null,
    notes:         String(d.notes         ?? ''),
    durationMinutes: d.durationMinutes != null ? Number(d.durationMinutes) : null,
    clockInLocation:  toGeoPoint(d.clockInLocation),
    clockOutLocation: toGeoPoint(d.clockOutLocation),
  }
}

export function subscribeToTimeEntries(
  onData: (entries: TimeEntry[], hitCap?: boolean) => void,
  onError: (err: Error) => void,
): Unsubscribe {
  const companyId = getCompanyId()
  if (!companyId) { onError(new Error('Not authenticated')); return () => {} }
  return onSnapshot(
    query(collection(db, COL), where('companyId', '==', companyId), limit(TIME_ENTRY_REALTIME_LIMIT)),
    snap => {
      const hitCap = warnIfCapped('timeEntries', snap.size, companyId, TIME_ENTRY_REALTIME_LIMIT)
      const entries: TimeEntry[] = []
      for (const s of snap.docs) {
        try { entries.push(docToEntry(s.id, s.data() as Record<string, unknown>)) } catch { }
      }
      entries.sort((a, b) => b.clockIn.getTime() - a.clockIn.getTime())
      onData(entries, hitCap)
    },
    onError,
  )
}

export async function clockIn(params: {
  customerId: string
  customerName: string
  workerName: string
  workerId: string
  notes: string
  location: GeoPoint | null
}): Promise<string> {
  const companyId = getCompanyId()
  if (!companyId) throw new Error('Not authenticated')
  const ref = await addDoc(collection(db, COL), {
    companyId,
    customerId:    params.customerId,
    customerName:  params.customerName,
    clockedInBy:   params.workerName,
    clockedInById: params.workerId,
    clockIn:       serverTimestamp(),
    clockOut:      null,
    notes:         params.notes,
    durationMinutes: null,
    clockInLocation:  params.location,
    clockOutLocation: null,
  })
  return ref.id
}

export async function clockOut(entry: TimeEntry, location: GeoPoint | null): Promise<void> {
  const now = new Date()
  const minutes = Math.round((now.getTime() - entry.clockIn.getTime()) / 60_000)
  await updateDoc(doc(db, COL, entry.id), {
    clockOut: Timestamp.fromDate(now),
    durationMinutes: minutes,
    clockOutLocation: location,
  })
}

export async function deleteTimeEntry(id: string): Promise<void> {
  await deleteDoc(doc(db, COL, id))
}

// Per-customer scope for the detail page's Related Records. Two equality
// filters need no composite index; sorting client-side avoids one.
export function subscribeToCustomerTimeEntries(
  customerId: string,
  onData: (entries: TimeEntry[]) => void,
  onError: (err: Error) => void,
): Unsubscribe {
  const companyId = getCompanyId()
  if (!companyId) { onError(new Error('Not authenticated')); return () => {} }
  return onSnapshot(
    query(
      collection(db, COL),
      where('companyId', '==', companyId),
      where('customerId', '==', customerId),
    ),
    snap => {
      const entries: TimeEntry[] = []
      for (const s of snap.docs) {
        try { entries.push(docToEntry(s.id, s.data() as Record<string, unknown>)) } catch { }
      }
      entries.sort((a, b) => b.clockIn.getTime() - a.clockIn.getTime())
      onData(entries)
    },
    onError,
  )
}
