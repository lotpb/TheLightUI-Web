import {
  collection, onSnapshot, query, where, orderBy, limit,
  Timestamp, type Unsubscribe,
} from 'firebase/firestore'
import { db } from '../firebase/config'
import { getCompanyId } from '../stores/authStore'
import type { AuditLogEntry, AuditAction, AuditEntityType, AuditChange } from '../models/auditLog'

const COL = 'auditLog'

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

// Company-wide feed, newest first.
export function subscribeToAuditLog(
  onData:  (items: AuditLogEntry[]) => void,
  onError: (e: Error) => void,
): Unsubscribe {
  const companyId = getCompanyId()
  if (!companyId) { onData([]); return () => {} }

  const q = query(
    collection(db, COL),
    where('companyId', '==', companyId),
    orderBy('createdAt', 'desc'),
    limit(200),
  )

  return onSnapshot(
    q,
    snap => onData(snap.docs.map(d => toEntry(d.id, d.data()))),
    onError,
  )
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
