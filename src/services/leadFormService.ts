import {
  collection, doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc,
  onSnapshot, query, where, orderBy, limit, serverTimestamp, Timestamp,
} from 'firebase/firestore'
import { db } from '../firebase/config'
import { getCompanyId } from '../stores/authStore'
import type { LeadFormSettings, LeadSubmission, SubmissionStatus } from '../models/leadForm'

const FORMS_COL = 'leadForms'
const SUBS_COL  = 'leadSubmissions'

// Safety cap for the real-time listener. Especially important here since
// this form accepts anonymous public submissions — nothing stops it from
// growing unbounded the way an internal-only collection's growth is at
// least gated by how many employees are entering records.
export const SUBMISSION_REALTIME_LIMIT = 5_000

function toSettings(companyId: string, d: Record<string, unknown>): LeadFormSettings {
  return {
    companyId,
    businessName:     String(d['businessName']      ?? ''),
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
  // merge: true — a full overwrite silently deletes any field this type
  // doesn't know about, so the moment a Cloud Function or a later setting
  // adds one, pressing Save here would wipe it.
  await setDoc(doc(db, FORMS_COL, settings.companyId), {
    ...settings,
    updatedAt: serverTimestamp(),
  }, { merge: true })
}

export function subscribeToLeadSubmissions(
  onData:  (subs: LeadSubmission[], hitCap: boolean) => void,
  onError: (e: Error) => void,
): () => void {
  const companyId = getCompanyId()
  if (!companyId) { onData([], false); return () => {} }

  const q = query(
    collection(db, SUBS_COL),
    where('companyId', '==', companyId),
    orderBy('submittedAt', 'desc'),
    limit(SUBMISSION_REALTIME_LIMIT),
  )

  return onSnapshot(
    q,
    snap => {
      const hitCap = snap.size === SUBMISSION_REALTIME_LIMIT
      if (hitCap) {
        console.warn(`[subscribeToLeadSubmissions] hit ${SUBMISSION_REALTIME_LIMIT}-document cap for company ${companyId}.`)
      }
      // Reported, not just logged: past the cap real leads stop appearing on
      // the page with nothing on screen to say so.
      onData(snap.docs.map(d => toSubmission(d.id, d.data())), hitCap)
    },
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
