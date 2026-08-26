import {
  collection, doc, addDoc, updateDoc, deleteDoc,
  onSnapshot, query, where, orderBy,
  serverTimestamp, Timestamp, type Unsubscribe,
} from 'firebase/firestore'
import { db } from '../firebase/config'
import { getCompanyId, getCurrentUserLabel } from '../stores/authStore'
import type { ApiKey, ApiScope } from '../models/apiKey'

const COL = 'apiKeys'

function toDate(v: unknown): Date {
  if (v instanceof Timestamp) return v.toDate()
  return new Date()
}

function toApiKey(id: string, d: Record<string, unknown>): ApiKey {
  return {
    id,
    companyId: String(d['companyId']  ?? ''),
    name:      String(d['name']       ?? ''),
    keyPrefix: String(d['keyPrefix']  ?? ''),
    keyHash:   String(d['keyHash']    ?? ''),
    scopes:    Array.isArray(d['scopes']) ? d['scopes'] as ApiScope[] : [],
    enabled:   Boolean(d['enabled']   ?? true),
    createdAt: toDate(d['createdAt']),
    lastUsedAt: d['lastUsedAt'] ? toDate(d['lastUsedAt']) : null,
    createdByName: String(d['createdByName'] ?? ''),
  }
}

export function subscribeToApiKeys(
  onData:  (items: ApiKey[]) => void,
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
    snap => onData(snap.docs.map(d => toApiKey(d.id, d.data()))),
    onError,
  )
}

function generateRawKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24))
  const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
  return `tlk_${hex}`
}

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

// Returns the raw key — shown to the user exactly once. Only its SHA-256 hash
// is ever persisted, so it cannot be recovered later (matches GitHub/Stripe
// style token issuance).
export async function createApiKey(name: string, scopes: ApiScope[]): Promise<string> {
  const companyId = getCompanyId()
  if (!companyId) throw new Error('Not authenticated')

  const rawKey = generateRawKey()
  const keyHash = await sha256Hex(rawKey)

  await addDoc(collection(db, COL), {
    companyId,
    name,
    scopes,
    keyPrefix: rawKey.slice(0, 12),
    keyHash,
    enabled: true,
    createdAt: serverTimestamp(),
    lastUsedAt: null,
    createdByName: getCurrentUserLabel().name,
  })

  return rawKey
}

export async function updateApiKey(id: string, fields: Partial<Pick<ApiKey, 'enabled'>>): Promise<void> {
  await updateDoc(doc(db, COL, id), { ...fields })
}

export async function deleteApiKey(id: string): Promise<void> {
  await deleteDoc(doc(db, COL, id))
}
