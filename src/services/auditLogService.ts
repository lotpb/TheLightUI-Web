import {
  collection, getDocs, onSnapshot, query, where, orderBy, limit, startAfter,
  Timestamp, type DocumentData, type QueryDocumentSnapshot, type Unsubscribe,
} from 'firebase/firestore'
import { db } from '../firebase/config'
import { getCompanyId } from '../stores/authStore'
import type {
  AuditLogEntry, AuditAction, AuditEntityType, AuditChange, AuditFilter,
} from '../models/auditLog'

const COL = 'auditLog'

/** Entries per page, live and paged alike. */
export const AUDIT_PAGE_SIZE = 100

function toDate(v: unknown): Date {
  if (v instanceof Timestamp) return v.toDate()
  return new Date()
}

function toEntry(id: string, d: Record<string, unknown>): AuditLogEntry {
  return {
    id,
    companyId:   String(d['companyId']   ?? ''),
    entityType:  (d['entityType'] as AuditEntityType) ?? 'customer',
    entityId:    String(d['entityId']    ?? ''),
    entityLabel: String(d['entityLabel'] ?? ''),
    action:      (d['action'] as AuditAction) ?? 'updated',
    changedBy:   String(d['changedBy']   ?? 'Unknown'),
    changes:     Array.isArray(d['changes']) ? d['changes'] as AuditChange[] : [],
    createdAt:   toDate(d['createdAt']),
  }
}

/**
 * Builds the base query, narrowing on entityType in Firestore rather than in
 * the browser.
 *
 * The page fetched the 200 most recent entries company-wide and filtered them
 * client-side, so "Proposals" showed whichever proposal rows happened to fall
 * inside that window. One bulk operation across a few hundred customers filled
 * it entirely and the other two tabs went empty while their history sat
 * untouched in Firestore. The composite index this needs is in
 * firestore.indexes.json.
 */
function baseQuery(companyId: string, filter: AuditFilter) {
  const col = collection(db, COL)
  return filter === 'all'
    ? query(col, where('companyId', '==', companyId), orderBy('createdAt', 'desc'))
    : query(
        col,
        where('companyId', '==', companyId),
        where('entityType', '==', filter),
        orderBy('createdAt', 'desc'),
      )
}

export interface AuditPage {
  entries: AuditLogEntry[]
  /** Cursor for the next call, or null when the feed is exhausted. */
  cursor: QueryDocumentSnapshot<DocumentData> | null
  /** False once a short page proves there's nothing older. */
  hasMore: boolean
}

/**
 * Live subscription to the newest page for a filter.
 *
 * Still capped — an unbounded listener on an append-only log would grow
 * without limit — but the cap is one page with loadOlderAuditEntries behind
 * it, rather than a hard 200-entry ceiling with nothing past it.
 */
export function subscribeToAuditLog(
  filter: AuditFilter,
  onData: (page: AuditPage) => void,
  onError: (e: Error) => void,
): Unsubscribe {
  const companyId = getCompanyId()
  if (!companyId) { onData({ entries: [], cursor: null, hasMore: false }); return () => {} }

  return onSnapshot(
    query(baseQuery(companyId, filter), limit(AUDIT_PAGE_SIZE)),
    snap => onData({
      entries: snap.docs.map(d => toEntry(d.id, d.data())),
      cursor: snap.docs.length > 0 ? snap.docs[snap.docs.length - 1] : null,
      hasMore: snap.size === AUDIT_PAGE_SIZE,
    }),
    onError,
  )
}

/**
 * One page of older entries, after `cursor`.
 *
 * A one-shot read rather than a listener: history that has already happened
 * doesn't change — the collection is append-only, with create, update and
 * delete all denied in the rules.
 */
export async function loadOlderAuditEntries(
  filter: AuditFilter,
  cursor: QueryDocumentSnapshot<DocumentData>,
): Promise<AuditPage> {
  const companyId = getCompanyId()
  if (!companyId) return { entries: [], cursor: null, hasMore: false }

  const snap = await getDocs(
    query(baseQuery(companyId, filter), startAfter(cursor), limit(AUDIT_PAGE_SIZE)),
  )
  return {
    entries: snap.docs.map(d => toEntry(d.id, d.data())),
    cursor: snap.docs.length > 0 ? snap.docs[snap.docs.length - 1] : null,
    hasMore: snap.size === AUDIT_PAGE_SIZE,
  }
}

// History for one record, newest first.
export function subscribeToEntityAuditLog(
  entityId: string,
  onData:  (items: AuditLogEntry[]) => void,
  onError: (e: Error) => void,
): Unsubscribe {
  const companyId = getCompanyId()
  if (!companyId || !entityId) { onData([]); return () => {} }

  const q = query(
    collection(db, COL),
    where('companyId', '==', companyId),
    where('entityId', '==', entityId),
    orderBy('createdAt', 'desc'),
  )

  return onSnapshot(
    q,
    snap => onData(snap.docs.map(d => toEntry(d.id, d.data()))),
    onError,
  )
}
