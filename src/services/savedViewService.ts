import {
  collection, doc, addDoc, deleteDoc,
  onSnapshot, query, where, orderBy,
  serverTimestamp, Timestamp, type Unsubscribe,
} from 'firebase/firestore'
import { db } from '../firebase/config'
import { getCompanyId } from '../stores/authStore'
import { emptySavedViewFilters, type SavedView, type SavedViewFilters } from '../models/savedView'

const COL = 'savedViews'

function toDate(v: unknown): Date {
  if (v instanceof Timestamp) return v.toDate()
  return new Date()
}

function toSavedView(id: string, d: Record<string, unknown>): SavedView {
  const rawFilters = (d['filters'] ?? {}) as Record<string, unknown>
  const defaults = emptySavedViewFilters()
  const filters: SavedViewFilters = {
    search:           String(rawFilters['search']           ?? defaults.search),
    showInactive:     Boolean(rawFilters['showInactive']     ?? defaults.showInactive),
    tagFilter:        rawFilters['tagFilter'] ? String(rawFilters['tagFilter']) : null,
    sortField:        String(rawFilters['sortField']         ?? defaults.sortField),
    sortDir:          String(rawFilters['sortDir']           ?? defaults.sortDir),
    filterSalesman:   String(rawFilters['filterSalesman']    ?? ''),
    filterState:      String(rawFilters['filterState']       ?? ''),
    filterLeadSource: String(rawFilters['filterLeadSource']  ?? ''),
    filterProduct:    String(rawFilters['filterProduct']     ?? ''),
    filterCallback:   String(rawFilters['filterCallback']    ?? ''),
    filterDateFrom:   String(rawFilters['filterDateFrom']    ?? ''),
    filterDateTo:     String(rawFilters['filterDateTo']      ?? ''),
    filterAmtMin:     String(rawFilters['filterAmtMin']      ?? ''),
    filterAmtMax:     String(rawFilters['filterAmtMax']      ?? ''),
  }
  return {
    id,
    companyId: String(d['companyId'] ?? ''),
    category:  String(d['category']  ?? ''),
    name:      String(d['name']      ?? ''),
    filters,
    createdAt: toDate(d['createdAt']),
  }
}

export function subscribeToSavedViews(
  category: string,
  onData:  (items: SavedView[]) => void,
  onError: (e: Error) => void,
): Unsubscribe {
  const companyId = getCompanyId()
  if (!companyId) { onData([]); return () => {} }

  const q = query(
    collection(db, COL),
    where('companyId', '==', companyId),
    where('category', '==', category),
    orderBy('createdAt', 'asc'),
  )

  return onSnapshot(
    q,
    snap => onData(snap.docs.map(d => toSavedView(d.id, d.data()))),
    onError,
  )
}

export async function createSavedView(
  category: string,
  name: string,
  filters: SavedViewFilters,
): Promise<string> {
  const companyId = getCompanyId()
  if (!companyId) throw new Error('Not authenticated')

  const ref = await addDoc(collection(db, COL), {
    companyId,
    category,
    name,
    filters,
    createdAt: serverTimestamp(),
  })
  return ref.id
}

export async function deleteSavedView(id: string): Promise<void> {
  await deleteDoc(doc(db, COL, id))
}
