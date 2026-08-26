import {
  collection, doc, addDoc, updateDoc, deleteDoc, getDoc,
  onSnapshot, query, where, Timestamp, serverTimestamp,
  type Unsubscribe,
} from 'firebase/firestore'
import { db } from '../firebase/config'
import { getCompanyId, getCurrentUserLabel } from '../stores/authStore'
import { createInvoice } from './invoiceService'
import { generateInvoiceNumber } from '../models/invoice'
import type { Proposal, ProposalLineItem } from '../models/proposal'

const COL = 'Proposals'

function toDate(v: unknown): Date {
  if (v instanceof Timestamp) return v.toDate()
  if (typeof v === 'string') { const d = new Date(v); if (!isNaN(d.getTime())) return d }
  return new Date()
}

function docToProposal(id: string, data: Record<string, unknown>): Proposal {
  const rawItems = Array.isArray(data.lineItems) ? (data.lineItems as Record<string, unknown>[]) : []
  const lineItems: ProposalLineItem[] = rawItems.map(item => ({
    description: String(item.description ?? ''),
    qty:  Number(item.qty  ?? 1),
    rate: Number(item.rate ?? 0),
  }))
  return {
    id,
    companyId:       String(data.companyId       ?? ''),
    shareToken:      data.shareToken ? String(data.shareToken) : undefined,
    customerId:      String(data.customerId       ?? ''),
    customerName:    String(data.customerName     ?? ''),
    customerPhone:   String(data.customerPhone    ?? ''),
    customerEmail:   String(data.customerEmail    ?? ''),
    customerAddress: String(data.customerAddress  ?? ''),
    proposalNumber:  String(data.proposalNumber   ?? ''),
    issueDate:   toDate(data.issueDate),
    expiresDate: toDate(data.expiresDate),
    status:      (data.status as Proposal['status']) ?? 'draft',
    lineItems,
    notes:      String(data.notes    ?? ''),
    taxRate:    Number(data.taxRate  ?? 0),
    createdAt:  toDate(data.createdAt),
    updatedAt:  toDate(data.updatedAt),
    respondedAt:        data.respondedAt ? toDate(data.respondedAt) : null,
    convertedInvoiceId: data.convertedInvoiceId ? String(data.convertedInvoiceId) : null,
    lastReminderSentAt: data.lastReminderSentAt ? toDate(data.lastReminderSentAt) : null,
  }
}

export function subscribeToProposals(
  onData: (items: Proposal[]) => void,
  onError: (err: Error) => void,
): Unsubscribe {
  const companyId = getCompanyId()
  if (!companyId) { onError(new Error('Not authenticated')); return () => {} }
  return onSnapshot(
    query(collection(db, COL), where('companyId', '==', companyId)),
    snap => {
      const items: Proposal[] = []
      for (const d of snap.docs) {
        try { items.push(docToProposal(d.id, d.data() as Record<string, unknown>)) } catch { }
      }
      items.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      onData(items)
    },
    onError,
  )
}

export async function getProposal(id: string): Promise<Proposal | null> {
  const myCompanyId = getCompanyId()
  const snap = await getDoc(doc(db, COL, id))
  if (!snap.exists()) return null
  const data = snap.data() as Record<string, unknown>
  if ((data['companyId'] as string | undefined) !== myCompanyId) {
    console.error(`[getProposal] companyId mismatch on doc ${id}`)
    return null
  }
  return docToProposal(snap.id, data)
}

export async function createProposal(
  p: Omit<Proposal, 'id' | 'createdAt' | 'updatedAt'>,
): Promise<string> {
  const companyId = getCompanyId()
  if (!companyId) throw new Error('Not authenticated')
  const ref = await addDoc(collection(db, COL), {
    companyId,
    customerId:      p.customerId,
    customerName:    p.customerName,
    customerPhone:   p.customerPhone,
    customerEmail:   p.customerEmail,
    customerAddress: p.customerAddress,
    proposalNumber:  p.proposalNumber,
    issueDate:   Timestamp.fromDate(p.issueDate),
    expiresDate: Timestamp.fromDate(p.expiresDate),
    status:      p.status,
    lineItems:   p.lineItems,
    notes:       p.notes,
    taxRate:     p.taxRate,
    createdAt:  serverTimestamp(),
    updatedAt:  serverTimestamp(),
    createdByName: getCurrentUserLabel().name,
  })
  return ref.id
}

export async function updateProposal(
  id: string,
  fields: Partial<Omit<Proposal, 'id' | 'companyId' | 'createdAt'>>,
): Promise<void> {
  const updates: Record<string, unknown> = { updatedAt: serverTimestamp(), lastEditedByName: getCurrentUserLabel().name }
  if (fields.customerId      !== undefined) updates.customerId      = fields.customerId
  if (fields.customerName    !== undefined) updates.customerName    = fields.customerName
  if (fields.customerPhone   !== undefined) updates.customerPhone   = fields.customerPhone
  if (fields.customerEmail   !== undefined) updates.customerEmail   = fields.customerEmail
  if (fields.customerAddress !== undefined) updates.customerAddress = fields.customerAddress
  if (fields.proposalNumber  !== undefined) updates.proposalNumber  = fields.proposalNumber
  if (fields.issueDate       !== undefined) updates.issueDate       = Timestamp.fromDate(fields.issueDate)
  if (fields.expiresDate     !== undefined) updates.expiresDate     = Timestamp.fromDate(fields.expiresDate)
  if (fields.status          !== undefined) updates.status          = fields.status
  if (fields.lineItems       !== undefined) updates.lineItems       = fields.lineItems
  if (fields.notes           !== undefined) updates.notes           = fields.notes
  if (fields.taxRate         !== undefined) updates.taxRate         = fields.taxRate
  if (fields.convertedInvoiceId !== undefined) updates.convertedInvoiceId = fields.convertedInvoiceId
  await updateDoc(doc(db, COL, id), updates)
}

export async function deleteProposal(id: string): Promise<void> {
  // Stamp the actor's name before the delete so the auditLog trigger's "before"
  // snapshot (the only data it has left to read) can attribute the deletion.
  await updateDoc(doc(db, COL, id), { lastEditedByName: getCurrentUserLabel().name })
  await deleteDoc(doc(db, COL, id))
}

// Creates a real Invoice from an accepted proposal's line items and links the
// two records together so neither the proposal nor the resulting invoice
// silently duplicates work.
export async function convertProposalToInvoice(p: Proposal): Promise<string> {
  const dueDate = new Date()
  dueDate.setDate(dueDate.getDate() + 30)

  const invoiceId = await createInvoice({
    companyId:       p.companyId,
    customerId:      p.customerId,
    customerName:    p.customerName,
    customerPhone:   p.customerPhone,
    customerEmail:   p.customerEmail,
    customerAddress: p.customerAddress,
    invoiceNumber:   generateInvoiceNumber(),
    issueDate: new Date(),
    dueDate,
    status:    'draft',
    lineItems: p.lineItems,
    notes:     p.notes,
    taxRate:   p.taxRate,
    generatedFrom: p.id,
  })

  await updateProposal(p.id, { convertedInvoiceId: invoiceId })
  return invoiceId
}
