import {
  collection, doc, addDoc, updateDoc, deleteDoc, getDoc,
  onSnapshot, query, where, Timestamp, serverTimestamp,
  type Unsubscribe,
} from 'firebase/firestore'
import { db } from '../firebase/config'
import { getCompanyId } from '../stores/authStore'
import type { Invoice, InvoiceLineItem } from '../models/invoice'

const COL = 'Invoices'

function toDate(v: unknown): Date {
  if (v instanceof Timestamp) return v.toDate()
  if (typeof v === 'string') { const d = new Date(v); if (!isNaN(d.getTime())) return d }
  return new Date()
}

function docToInvoice(id: string, data: Record<string, unknown>): Invoice {
  const rawItems = Array.isArray(data.lineItems) ? (data.lineItems as Record<string, unknown>[]) : []
  const lineItems: InvoiceLineItem[] = rawItems.map(item => ({
    description: String(item.description ?? ''),
    qty:  Number(item.qty  ?? 1),
    rate: Number(item.rate ?? 0),
  }))
  return {
    id,
    companyId:       String(data.companyId       ?? ''),
    customerId:      String(data.customerId       ?? ''),
    customerName:    String(data.customerName     ?? ''),
    customerPhone:   String(data.customerPhone    ?? ''),
    customerEmail:   String(data.customerEmail    ?? ''),
    customerAddress: String(data.customerAddress  ?? ''),
    invoiceNumber:   String(data.invoiceNumber    ?? ''),
    issueDate:  toDate(data.issueDate),
    dueDate:    toDate(data.dueDate),
    status:     (data.status as Invoice['status']) ?? 'draft',
    lineItems,
    notes:      String(data.notes    ?? ''),
    taxRate:    Number(data.taxRate  ?? 0),
    createdAt:  toDate(data.createdAt),
    updatedAt:  toDate(data.updatedAt),
  }
}

export function subscribeToInvoices(
  onData: (items: Invoice[]) => void,
  onError: (err: Error) => void,
): Unsubscribe {
  const companyId = getCompanyId()
  if (!companyId) { onError(new Error('Not authenticated')); return () => {} }
  return onSnapshot(
    query(collection(db, COL), where('companyId', '==', companyId)),
    snap => {
      const items: Invoice[] = []
      for (const d of snap.docs) {
        try { items.push(docToInvoice(d.id, d.data() as Record<string, unknown>)) } catch { }
      }
      items.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      onData(items)
    },
    onError,
  )
}

export async function getInvoice(id: string): Promise<Invoice | null> {
  const snap = await getDoc(doc(db, COL, id))
  if (!snap.exists()) return null
  return docToInvoice(snap.id, snap.data() as Record<string, unknown>)
}

export async function createInvoice(
  inv: Omit<Invoice, 'id' | 'createdAt' | 'updatedAt'>,
): Promise<string> {
  const companyId = getCompanyId()
  if (!companyId) throw new Error('Not authenticated')
  const ref = await addDoc(collection(db, COL), {
    companyId,
    customerId:      inv.customerId,
    customerName:    inv.customerName,
    customerPhone:   inv.customerPhone,
    customerEmail:   inv.customerEmail,
    customerAddress: inv.customerAddress,
    invoiceNumber:   inv.invoiceNumber,
    issueDate:  Timestamp.fromDate(inv.issueDate),
    dueDate:    Timestamp.fromDate(inv.dueDate),
    status:     inv.status,
    lineItems:  inv.lineItems,
    notes:      inv.notes,
    taxRate:    inv.taxRate,
    createdAt:  serverTimestamp(),
    updatedAt:  serverTimestamp(),
  })
  return ref.id
}

export async function updateInvoice(
  id: string,
  fields: Partial<Omit<Invoice, 'id' | 'companyId' | 'createdAt'>>,
): Promise<void> {
  const updates: Record<string, unknown> = { updatedAt: serverTimestamp() }
  if (fields.customerId      !== undefined) updates.customerId      = fields.customerId
  if (fields.customerName    !== undefined) updates.customerName    = fields.customerName
  if (fields.customerPhone   !== undefined) updates.customerPhone   = fields.customerPhone
  if (fields.customerEmail   !== undefined) updates.customerEmail   = fields.customerEmail
  if (fields.customerAddress !== undefined) updates.customerAddress = fields.customerAddress
  if (fields.invoiceNumber   !== undefined) updates.invoiceNumber   = fields.invoiceNumber
  if (fields.issueDate       !== undefined) updates.issueDate       = Timestamp.fromDate(fields.issueDate)
  if (fields.dueDate         !== undefined) updates.dueDate         = Timestamp.fromDate(fields.dueDate)
  if (fields.status          !== undefined) updates.status          = fields.status
  if (fields.lineItems       !== undefined) updates.lineItems       = fields.lineItems
  if (fields.notes           !== undefined) updates.notes           = fields.notes
  if (fields.taxRate         !== undefined) updates.taxRate         = fields.taxRate
  await updateDoc(doc(db, COL, id), updates)
}

export async function deleteInvoice(id: string): Promise<void> {
  await deleteDoc(doc(db, COL, id))
}
