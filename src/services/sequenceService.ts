import {
  collection, doc, addDoc, updateDoc, deleteDoc,
  onSnapshot, query, where, orderBy, Timestamp, serverTimestamp,
} from 'firebase/firestore'
import { db } from '../firebase/config'
import { getCompanyId } from '../stores/authStore'
import type { Sequence, SequenceEnrollment, SequenceStep } from '../models/sequence'

// ── Sequences (templates) ─────────────────────────────────────────────────────

function docToSequence(id: string, d: Record<string, unknown>): Sequence {
  return {
    id,
    name:        String(d['name'] ?? ''),
    description: String(d['description'] ?? ''),
    steps:       (Array.isArray(d['steps']) ? d['steps'] : []) as SequenceStep[],
    createdAt:   (d['createdAt'] as Timestamp)?.toDate() ?? new Date(),
  }
}

export function subscribeToSequences(
  onData: (seqs: Sequence[]) => void,
  onError: (e: Error) => void,
): () => void {
  const companyId = getCompanyId()
  if (!companyId) { onData([]); return () => {} }
  return onSnapshot(
    query(collection(db, 'sequences'), where('companyId', '==', companyId), orderBy('createdAt', 'asc')),
    snap => onData(snap.docs.map(d => docToSequence(d.id, d.data()))),
    onError,
  )
}

export async function createSequence(
  s: Pick<Sequence, 'name' | 'description' | 'steps'>,
): Promise<string> {
  const companyId = getCompanyId()
  if (!companyId) throw new Error('Not authenticated')
  const ref = await addDoc(collection(db, 'sequences'), {
    companyId,
    name:        s.name,
    description: s.description,
    steps:       s.steps,
    createdAt:   serverTimestamp(),
  })
  return ref.id
}

export async function updateSequence(
  id: string,
  s: Pick<Sequence, 'name' | 'description' | 'steps'>,
): Promise<void> {
  await updateDoc(doc(db, 'sequences', id), {
    name:        s.name,
    description: s.description,
    steps:       s.steps,
  })
}

export async function deleteSequence(id: string): Promise<void> {
  await deleteDoc(doc(db, 'sequences', id))
}

// ── Enrollments ───────────────────────────────────────────────────────────────

function docToEnrollment(id: string, d: Record<string, unknown>): SequenceEnrollment {
  return {
    id,
    companyId:            String(d['companyId'] ?? ''),
    sequenceId:           String(d['sequenceId'] ?? ''),
    sequenceName:         String(d['sequenceName'] ?? ''),
    customerId:           String(d['customerId'] ?? ''),
    customerName:         String(d['customerName'] ?? ''),
    startedAt:            (d['startedAt'] as Timestamp)?.toDate() ?? new Date(),
    status:               (d['status'] as SequenceEnrollment['status']) ?? 'active',
    completedStepIndices: (Array.isArray(d['completedStepIndices']) ? d['completedStepIndices'] : []) as number[],
    nextStepIdx:          Number(d['nextStepIdx'] ?? 0),
    nextRunAt:            (d['nextRunAt'] as Timestamp)?.toDate() ?? new Date(),
    createdAt:            (d['createdAt'] as Timestamp)?.toDate() ?? new Date(),
  }
}

export function subscribeToCustomerEnrollments(
  customerId: string,
  onData: (enrollments: SequenceEnrollment[]) => void,
  onError: (e: Error) => void,
): () => void {
  const companyId = getCompanyId()
  if (!companyId) { onData([]); return () => {} }
  return onSnapshot(
    query(
      collection(db, 'sequenceEnrollments'),
      where('companyId', '==', companyId),
      where('customerId', '==', customerId),
      orderBy('createdAt', 'desc'),
    ),
    snap => onData(snap.docs.map(d => docToEnrollment(d.id, d.data()))),
    onError,
  )
}

export async function enrollCustomer(
  sequence: Sequence,
  customerId: string,
  customerName: string,
): Promise<void> {
  const companyId = getCompanyId()
  if (!companyId) throw new Error('Not authenticated')

  const now = new Date()
  const firstStep = sequence.steps[0]
  const nextRunAt = firstStep
    ? new Date(now.getTime() + firstStep.delayDays * 86_400_000)
    : now

  await addDoc(collection(db, 'sequenceEnrollments'), {
    companyId,
    sequenceId:           sequence.id,
    sequenceName:         sequence.name,
    customerId,
    customerName,
    startedAt:            Timestamp.fromDate(now),
    status:               'active',
    completedStepIndices: [],
    nextStepIdx:          0,
    nextRunAt:            Timestamp.fromDate(nextRunAt),
    createdAt:            serverTimestamp(),
  })
}

export async function pauseEnrollment(id: string): Promise<void> {
  await updateDoc(doc(db, 'sequenceEnrollments', id), { status: 'paused' })
}

export async function resumeEnrollment(
  id: string,
  steps: SequenceStep[],
  nextStepIdx: number,
  startedAt: Date,
): Promise<void> {
  const step = steps[nextStepIdx]
  const nextRunAt = step
    ? new Date(startedAt.getTime() + step.delayDays * 86_400_000)
    : new Date()
  await updateDoc(doc(db, 'sequenceEnrollments', id), {
    status:    'active',
    nextRunAt: Timestamp.fromDate(nextRunAt),
  })
}

export async function cancelEnrollment(id: string): Promise<void> {
  await updateDoc(doc(db, 'sequenceEnrollments', id), { status: 'cancelled' })
}

export async function deleteEnrollment(id: string): Promise<void> {
  await deleteDoc(doc(db, 'sequenceEnrollments', id))
}
