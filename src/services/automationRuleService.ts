import {
  collection, doc, addDoc, updateDoc, deleteDoc,
  onSnapshot, query, where, orderBy, limit,
  serverTimestamp, Timestamp, type Unsubscribe,
} from 'firebase/firestore'
import { db } from '../firebase/config'
import { getCompanyId } from '../stores/authStore'
import type { AutomationRule, AutomationTrigger, AutomationAction, AutomationLogEntry } from '../models/automationRule'

const RULES_COL = 'automationRules'
const LOG_COL   = 'automationLog'

function toDate(v: unknown): Date {
  if (v instanceof Timestamp) return v.toDate()
  return new Date()
}

function toRule(id: string, d: Record<string, unknown>): AutomationRule {
  return {
    id,
    companyId: String(d['companyId'] ?? ''),
    name:      String(d['name']      ?? ''),
    enabled:   Boolean(d['enabled']  ?? true),
    trigger:   d['trigger'] as AutomationTrigger,
    actions:   Array.isArray(d['actions']) ? d['actions'] as AutomationAction[] : [],
    createdAt: toDate(d['createdAt']),
    updatedAt: toDate(d['updatedAt']),
    runCount:  Number(d['runCount'] ?? 0),
    lastRunAt: d['lastRunAt'] ? toDate(d['lastRunAt']) : null,
  }
}

function toLogEntry(id: string, d: Record<string, unknown>): AutomationLogEntry {
  return {
    id,
    companyId:      String(d['companyId']      ?? ''),
    ruleId:         String(d['ruleId']         ?? ''),
    ruleName:       String(d['ruleName']       ?? ''),
    entityType:     (d['entityType'] as AutomationLogEntry['entityType']) ?? 'customer',
    entityId:       String(d['entityId']       ?? ''),
    entityLabel:    String(d['entityLabel']    ?? ''),
    actionsSummary: String(d['actionsSummary'] ?? ''),
    ranAt:          toDate(d['ranAt']),
  }
}

export function subscribeToAutomationRules(
  onData:  (items: AutomationRule[]) => void,
  onError: (e: Error) => void,
): Unsubscribe {
  const companyId = getCompanyId()
  if (!companyId) { onData([]); return () => {} }

  const q = query(
    collection(db, RULES_COL),
    where('companyId', '==', companyId),
    orderBy('createdAt', 'desc'),
  )

  return onSnapshot(
    q,
    snap => onData(snap.docs.map(d => toRule(d.id, d.data()))),
    onError,
  )
}

export function subscribeToAutomationLog(
  onData:  (items: AutomationLogEntry[]) => void,
  onError: (e: Error) => void,
): Unsubscribe {
  const companyId = getCompanyId()
  if (!companyId) { onData([]); return () => {} }

  const q = query(
    collection(db, LOG_COL),
    where('companyId', '==', companyId),
    orderBy('ranAt', 'desc'),
    limit(100),
  )

  return onSnapshot(
    q,
    snap => onData(snap.docs.map(d => toLogEntry(d.id, d.data()))),
    onError,
  )
}

export async function createAutomationRule(
  fields: Pick<AutomationRule, 'name' | 'trigger' | 'actions'>,
): Promise<string> {
  const companyId = getCompanyId()
  if (!companyId) throw new Error('Not authenticated')

  const ref = await addDoc(collection(db, RULES_COL), {
    companyId,
    name:      fields.name,
    enabled:   true,
    trigger:   fields.trigger,
    actions:   fields.actions,
    runCount:  0,
    lastRunAt: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
  return ref.id
}

export async function updateAutomationRule(
  id: string,
  fields: Partial<Pick<AutomationRule, 'name' | 'enabled' | 'trigger' | 'actions'>>,
): Promise<void> {
  await updateDoc(doc(db, RULES_COL, id), {
    ...fields,
    updatedAt: serverTimestamp(),
  })
}

export async function deleteAutomationRule(id: string): Promise<void> {
  await deleteDoc(doc(db, RULES_COL, id))
}
