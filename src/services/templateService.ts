import {
  collection, query, where, orderBy,
  onSnapshot, addDoc, updateDoc, deleteDoc,
  doc, serverTimestamp, Timestamp,
} from 'firebase/firestore'
import { db } from '../firebase/config'
import { getCompanyId } from '../stores/authStore'
import type { MessageTemplate, TemplateType } from '../models/template'

function docToTemplate(id: string, d: Record<string, unknown>): MessageTemplate {
  return {
    id,
    name:      String(d['name'] ?? ''),
    type:      (d['type'] as TemplateType) ?? 'both',
    subject:   String(d['subject'] ?? ''),
    body:      String(d['body'] ?? ''),
    createdAt: (d['createdAt'] as Timestamp)?.toDate() ?? new Date(),
    updatedAt: (d['updatedAt'] as Timestamp)?.toDate() ?? new Date(),
  }
}

export function subscribeToTemplates(
  onData: (templates: MessageTemplate[]) => void,
  onError: (e: Error) => void,
): () => void {
  const companyId = getCompanyId()
  if (!companyId) { onData([]); return () => {} }

  const q = query(
    collection(db, 'messageTemplates'),
    where('companyId', '==', companyId),
    orderBy('createdAt', 'asc'),
  )

  return onSnapshot(
    q,
    snap => onData(snap.docs.map(d => docToTemplate(d.id, d.data()))),
    onError,
  )
}

export async function createTemplate(
  t: Pick<MessageTemplate, 'name' | 'type' | 'subject' | 'body'>,
): Promise<string> {
  const companyId = getCompanyId()
  if (!companyId) throw new Error('Not authenticated')

  const ref = await addDoc(collection(db, 'messageTemplates'), {
    companyId,
    name:      t.name,
    type:      t.type,
    subject:   t.subject,
    body:      t.body,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
  return ref.id
}

export async function updateTemplate(
  id: string,
  t: Pick<MessageTemplate, 'name' | 'type' | 'subject' | 'body'>,
): Promise<void> {
  await updateDoc(doc(db, 'messageTemplates', id), {
    name:      t.name,
    type:      t.type,
    subject:   t.subject,
    body:      t.body,
    updatedAt: serverTimestamp(),
  })
}

export async function deleteTemplate(id: string): Promise<void> {
  await deleteDoc(doc(db, 'messageTemplates', id))
}
