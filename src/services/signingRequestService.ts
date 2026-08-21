import {
  collection, doc, setDoc, getDoc, getDocs, updateDoc, deleteDoc,
  onSnapshot, query, where, orderBy, serverTimestamp, Timestamp,
  type Unsubscribe,
} from 'firebase/firestore'
import { db } from '../firebase/config'
import { getCompanyId } from '../stores/authStore'
import type { SigningRequest, SigningDocSnapshot, SigningStatus } from '../models/signingRequest'
import type { DocTemplateKind, DocSection } from '../models/docTemplate'

const COL = 'signingRequests'

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
  )
  return onSnapshot(
    q,
    snap => onData(snap.docs.map(d => toRequest(d.id, d.data()))),
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
