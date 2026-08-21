import {
  collection, doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc,
  onSnapshot, query, where, orderBy, serverTimestamp, Timestamp,
} from 'firebase/firestore'
import { db } from '../firebase/config'
import { getCompanyId } from '../stores/authStore'
import type { LeadFormSettings, LeadSubmission, SubmissionStatus } from '../models/leadForm'

const FORMS_COL = 'leadForms'
const SUBS_COL  = 'leadSubmissions'

function toSettings(companyId: string, d: Record<string, unknown>): LeadFormSettings {
  return {
    companyId,
    title:            String(d['title']            ?? 'Contact Us'),
    subtitle:         String(d['subtitle']          ?? ''),
    thankYouMessage:  String(d['thankYouMessage']   ?? "Thank you! We'll be in touch soon."),
    showPhone:        Boolean(d['showPhone']         ?? true),
    showAddress:      Boolean(d['showAddress']       ?? false),
    showMessage:      Boolean(d['showMessage']       ?? true),
    enabled:          Boolean(d['enabled']           ?? true),
    updatedAt:        (d['updatedAt'] as Timestamp)?.toDate() ?? new Date(),
  }
}

function toSubmission(id: string, d: Record<string, unknown>): LeadSubmission {
  return {
    id,
    companyId: String(d['companyId'] ?? ''),
    first:     String(d['first']     ?? ''),
    lastname:  String(d['lastname']  ?? ''),
    phone:     String(d['phone']     ?? ''),
    email:     String(d['email']     ?? ''),
    street:    String(d['street']    ?? ''),
    city:      String(d['city']      ?? ''),
    state:     String(d['state']     ?? ''),
    zip:       String(d['zip']       ?? ''),
    message:   String(d['message']   ?? ''),
    submittedAt: (d['submittedAt'] as Timestamp)?.toDate() ?? new Date(),
    status:    (d['status'] as SubmissionStatus) ?? 'new',
  }
}

export async function getLeadFormSettings(companyId: string): Promise<LeadFormSettings | null> {
  const snap = await getDoc(doc(db, FORMS_COL, companyId))
  if (!snap.exists()) return null
  return toSettings(companyId, snap.data() as Record<string, unknown>)
}

export async function saveLeadFormSettings(
  settings: Omit<LeadFormSettings, 'updatedAt'>,
): Promise<void> {
  await setDoc(doc(db, FORMS_COL, settings.companyId), {
    ...settings,
    updatedAt: serverTimestamp(),
  })
}

export function subscribeToLeadSubmissions(
  onData:  (subs: LeadSubmission[]) => void,
  onError: (e: Error) => void,
): () => void {
  const companyId = getCompanyId()
  if (!companyId) { onData([]); return () => {} }

  const q = query(
    collection(db, SUBS_COL),
    where('companyId', '==', companyId),
    orderBy('submittedAt', 'desc'),
  )

  return onSnapshot(
    q,
    snap => onData(snap.docs.map(d => toSubmission(d.id, d.data()))),
    onError,
  )
}

export async function submitLead(
  companyId: string,
  data: Omit<LeadSubmission, 'id' | 'companyId' | 'submittedAt' | 'status'>,
): Promise<string> {
  const ref = await addDoc(collection(db, SUBS_COL), {
    companyId,
    ...data,
    status: 'new',
    submittedAt: serverTimestamp(),
  })
  return ref.id
}

export async function updateSubmissionStatus(id: string, status: SubmissionStatus): Promise<void> {
  await updateDoc(doc(db, SUBS_COL, id), { status })
}

export async function deleteSubmission(id: string): Promise<void> {
  await deleteDoc(doc(db, SUBS_COL, id))
}
