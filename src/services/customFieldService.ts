import {
  collection, doc, addDoc, updateDoc, deleteDoc,
  onSnapshot, query, where, orderBy,
  serverTimestamp, Timestamp, type Unsubscribe,
} from 'firebase/firestore'
import { db } from '../firebase/config'
import { getCompanyId } from '../stores/authStore'
import { slugifyFieldKey, type CustomFieldDef } from '../models/customField'

const COL = 'customFieldDefs'

function toDate(v: unknown): Date {
  if (v instanceof Timestamp) return v.toDate()
  return new Date()
}

function toDef(id: string, d: Record<string, unknown>): CustomFieldDef {
  return {
    id,
    companyId: String(d['companyId'] ?? ''),
    label:     String(d['label']     ?? ''),
    key:       String(d['key']       ?? ''),
    type:      (d['type'] as CustomFieldDef['type']) ?? 'text',
    options:   Array.isArray(d['options']) ? (d['options'] as unknown[]).map(String) : [],
    order:     Number(d['order'] ?? 0),
    createdAt: toDate(d['createdAt']),
  }
}

export function subscribeToCustomFieldDefs(
  onData:  (items: CustomFieldDef[]) => void,
  onError: (e: Error) => void,
): Unsubscribe {
  const companyId = getCompanyId()
  if (!companyId) { onData([]); return () => {} }

  const q = query(
    collection(db, COL),
    where('companyId', '==', companyId),
    orderBy('order', 'asc'),
  )

  return onSnapshot(
    q,
    snap => onData(snap.docs.map(d => toDef(d.id, d.data()))),
    onError,
  )
}

export async function createCustomFieldDef(
  fields: { label: string; type: CustomFieldDef['type']; options: string[] },
  existingKeys: string[],
): Promise<string> {
  const companyId = getCompanyId()
  if (!companyId) throw new Error('Not authenticated')

  let key = slugifyFieldKey(fields.label)
  let n = 2
  while (existingKeys.includes(key)) { key = `${slugifyFieldKey(fields.label)}_${n}`; n++ }

  const ref = await addDoc(collection(db, COL), {
    companyId,
    label:   fields.label.trim(),
    key,
    type:    fields.type,
    options: fields.type === 'select' ? fields.options.filter(o => o.trim()) : [],
    order:   Date.now(),
    createdAt: serverTimestamp(),
  })
  return ref.id
}

export async function updateCustomFieldDef(
  id: string,
  fields: Partial<Pick<CustomFieldDef, 'label' | 'options'>>,
): Promise<void> {
  await updateDoc(doc(db, COL, id), { ...fields })
}

export async function deleteCustomFieldDef(id: string): Promise<void> {
  await deleteDoc(doc(db, COL, id))
}
