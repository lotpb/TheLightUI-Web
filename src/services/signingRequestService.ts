import {
  collection, doc, setDoc, getDoc, getDocs, updateDoc, deleteDoc,
  onSnapshot, query, where, orderBy, limit, serverTimestamp, Timestamp,
  type Unsubscribe,
} from 'firebase/firestore'
import { db } from '../firebase/config'
import { getCompanyId } from '../stores/authStore'
import type { SigningRequest, SigningDocSnapshot, SigningStatus } from '../models/signingRequest'
import type { DocTemplateKind, DocSection } from '../models/docTemplate'

const COL = 'signingRequests'

// Safety cap for the real-time listener — same reasoning as customerService's
// REALTIME_LIMIT.
const SIGNING_REALTIME_LIMIT = 5_000

function toDate(v: unknown): Date {
  if (v instanceof Timestamp) return v.toDate()
  return new Date()
}

function toDocSnapshot(d: Record<string, unknown>): SigningDocSnapshot {
  const doc = (d['document'] ?? {}) as Record<string, unknown>
  return {
    templateName:   String(doc['templateName']   ?? ''),
    templateKind:   (doc['templateKind'] as DocTemplateKind) ?? 'contract',
    intro:          String(doc['intro']          ?? ''),
    sections:       (doc['sections'] as DocSection[]) ?? [],
    closing:        String(doc['closing']        ?? ''),
    companyName:    String(doc['companyName']    ?? ''),
    companyAddress: String(doc['companyAddress'] ?? ''),
    companyPhone:   String(doc['companyPhone']   ?? ''),
    companyEmail:   String(doc['companyEmail']   ?? ''),
    customerName:   String(doc['customerName']   ?? ''),
    customerEmail:  String(doc['customerEmail']  ?? ''),
    customerPhone:  String(doc['customerPhone']  ?? ''),
    customerStreet: String(doc['customerStreet'] ?? ''),
    customerCity:   String(doc['customerCity']   ?? ''),
    customerState:  String(doc['customerState']  ?? ''),
    customerZip:    String(doc['customerZip']    ?? ''),
  }
}

function toRequest(id: string, d: Record<string, unknown>): SigningRequest {
  return {
    id,
    companyId:        String(d['companyId']        ?? ''),
    templateId:       String(d['templateId']       ?? ''),
    customerId:       String(d['customerId']        ?? ''),
    document:         toDocSnapshot(d),
    status:           (d['status'] as SigningStatus) ?? 'pending',
    createdAt:        toDate(d['createdAt']),
    signedAt:         d['signedAt']         ? toDate(d['signedAt'])         : null,
    signatureDataUrl: d['signatureDataUrl'] ? String(d['signatureDataUrl']) : null,
    signerName:       d['signerName']       ? String(d['signerName'])       : null,
  }
}

export function subscribeToSigningRequests(
  onData:  (items: SigningRequest[]) => void,
  onError: (e: Error) => void,
): Unsubscribe {
  const companyId = getCompanyId()
  if (!companyId) { onData([]); return () => {} }

  const q = query(
    collection(db, COL),
    where('companyId', '==', companyId),
    orderBy('createdAt', 'desc'),
    limit(SIGNING_REALTIME_LIMIT),
  )
  return onSnapshot(
    q,
    snap => {
      if (snap.size === SIGNING_REALTIME_LIMIT) {
        console.warn(`[subscribeToSigningRequests] hit ${SIGNING_REALTIME_LIMIT}-document cap for company ${companyId}.`)
      }
      onData(snap.docs.map(d => toRequest(d.id, d.data())))
    },
    onError,
  )
}

export async function getSignedDocumentsForCustomer(customerId: string): Promise<SigningRequest[]> {
  const companyId = getCompanyId()
  if (!companyId) return []

  const q = query(
    collection(db, COL),
    where('companyId', '==', companyId),
    where('customerId', '==', customerId),
    where('status', '==', 'signed'),
  )
  const snap = await getDocs(q)
  return snap.docs.map(d => toRequest(d.id, d.data()))
}

export async function getSigningRequest(token: string): Promise<SigningRequest | null> {
  const snap = await getDoc(doc(db, COL, token))
  if (!snap.exists()) return null
  return toRequest(snap.id, snap.data() as Record<string, unknown>)
}

export async function createSigningRequest(
  templateId: string,
  customerId: string,
  document: SigningDocSnapshot,
): Promise<string> {
  const companyId = getCompanyId()
  if (!companyId) throw new Error('Not authenticated')

  const token = crypto.randomUUID()
  await setDoc(doc(db, COL, token), {
    companyId,
    templateId,
    customerId,
    document,
    status:           'pending',
    createdAt:        serverTimestamp(),
    signedAt:         null,
    signatureDataUrl: null,
    signerName:       null,
  })
  return token
}

export async function signDocument(
  token: string,
  signatureDataUrl: string,
  signerName: string,
): Promise<void> {
  await updateDoc(doc(db, COL, token), {
    status:           'signed',
    signedAt:         serverTimestamp(),
    signatureDataUrl,
    signerName,
  })
}

export async function deleteSigningRequest(token: string): Promise<void> {
  await deleteDoc(doc(db, COL, token))
}

// Per-customer scope for the detail page's Related Records. See the equivalent
// in serviceRequestService for why there is no orderBy.
export function subscribeToCustomerSigningRequests(
  customerId: string,
  onData:  (items: SigningRequest[]) => void,
  onError: (e: Error) => void,
): Unsubscribe {
  const companyId = getCompanyId()
  if (!companyId) { onData([]); return () => {} }

  return onSnapshot(
    query(
      collection(db, COL),
      where('companyId', '==', companyId),
      where('customerId', '==', customerId),
    ),
    snap => {
      const items = snap.docs.map(d => toRequest(d.id, d.data()))
      items.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      onData(items)
    },
    onError,
  )
}
