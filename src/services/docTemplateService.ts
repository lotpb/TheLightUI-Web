import {
  collection, query, where, orderBy,
  onSnapshot, addDoc, updateDoc, deleteDoc,
  doc, getDoc, serverTimestamp, Timestamp,
} from 'firebase/firestore'
import { db } from '../firebase/config'
import { getCompanyId } from '../stores/authStore'
import type { DocTemplate, DocTemplateKind, DocSection } from '../models/docTemplate'

const COLLECTION = 'docTemplates'

function docToTemplate(id: string, d: Record<string, unknown>): DocTemplate {
  return {
    id,
    companyId: String(d['companyId'] ?? ''),
    name:      String(d['name'] ?? ''),
    kind:      (d['kind'] as DocTemplateKind) ?? 'proposal',
    intro:     String(d['intro'] ?? ''),
    sections:  (d['sections'] as DocSection[]) ?? [],
    closing:   String(d['closing'] ?? ''),
    createdAt: (d['createdAt'] as Timestamp)?.toDate() ?? new Date(),
    updatedAt: (d['updatedAt'] as Timestamp)?.toDate() ?? new Date(),
  }
}

export function subscribeToDocTemplates(
  onData:  (templates: DocTemplate[]) => void,
  onError: (e: Error) => void,
): () => void {
  const companyId = getCompanyId()
  if (!companyId) { onData([]); return () => {} }

  const q = query(
    collection(db, COLLECTION),
    where('companyId', '==', companyId),
    orderBy('createdAt', 'asc'),
  )

  return onSnapshot(
    q,
    snap => onData(snap.docs.map(d => docToTemplate(d.id, d.data()))),
    onError,
  )
}

export async function getDocTemplate(id: string): Promise<DocTemplate | null> {
  const snap = await getDoc(doc(db, COLLECTION, id))
  if (!snap.exists()) return null
  return docToTemplate(snap.id, snap.data() as Record<string, unknown>)
}

export async function createDocTemplate(
  t: Pick<DocTemplate, 'name' | 'kind' | 'intro' | 'sections' | 'closing'>,
): Promise<string> {
  const companyId = getCompanyId()
  if (!companyId) throw new Error('Not authenticated')

  const ref = await addDoc(collection(db, COLLECTION), {
    companyId,
    name:      t.name,
    kind:      t.kind,
    intro:     t.intro,
    sections:  t.sections,
    closing:   t.closing,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
  return ref.id
}

export async function updateDocTemplate(
  id: string,
  t: Pick<DocTemplate, 'name' | 'kind' | 'intro' | 'sections' | 'closing'>,
): Promise<void> {
  await updateDoc(doc(db, COLLECTION, id), {
    name:      t.name,
    kind:      t.kind,
    intro:     t.intro,
    sections:  t.sections,
    closing:   t.closing,
    updatedAt: serverTimestamp(),
  })
}

export async function deleteDocTemplate(id: string): Promise<void> {
  await deleteDoc(doc(db, COLLECTION, id))
}
