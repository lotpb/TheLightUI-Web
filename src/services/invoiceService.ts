import {
  collection, doc, addDoc, updateDoc, deleteDoc, getDoc,
  onSnapshot, query, where, Timestamp, serverTimestamp,
  type Unsubscribe,
} from 'firebase/firestore'
import { db } from '../firebase/config'
import { getCompanyId } from '../stores/authStore'
import { generateInvoiceNumber, type Invoice, type InvoiceLineItem, type RecurringInterval } from '../models/invoice'

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
    shareToken:      data.shareToken ? String(data.shareToken) : undefined,
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
    recurring:       (data.recurring as RecurringInterval | null | undefined) ?? null,
    nextRecurDate:   data.nextRecurDate ? toDate(data.nextRecurDate) : null,
    lastGeneratedAt: data.lastGeneratedAt ? toDate(data.lastGeneratedAt) : null,
    generatedFrom:   data.generatedFrom ? String(data.generatedFrom) : null,
    paymentLink:     data.paymentLink ? String(data.paymentLink) : null,
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
  const myCompanyId = getCompanyId()
  const snap = await getDoc(doc(db, COL, id))
  if (!snap.exists()) return null
  const data = snap.data() as Record<string, unknown>
  if ((data['companyId'] as string | undefined) !== myCompanyId) {
    console.error(`[getInvoice] companyId mismatch on doc ${id}`)
    return null
  }
  return docToInvoice(snap.id, data)
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
    recurring:      inv.recurring     ?? null,
    nextRecurDate:  inv.nextRecurDate  ? Timestamp.fromDate(inv.nextRecurDate)  : null,
    generatedFrom:  inv.generatedFrom  ?? null,
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
  if (fields.recurring        !== undefined) updates.recurring        = fields.recurring ?? null
  if (fields.nextRecurDate    !== undefined) updates.nextRecurDate    = fields.nextRecurDate    ? Timestamp.fromDate(fields.nextRecurDate)    : null
  if (fields.lastGeneratedAt  !== undefined) updates.lastGeneratedAt  = fields.lastGeneratedAt  ? Timestamp.fromDate(fields.lastGeneratedAt)  : null
  if (fields.paymentLink      !== undefined) updates.paymentLink      = fields.paymentLink ?? null
  await updateDoc(doc(db, COL, id), updates)
}

function advanceByInterval(from: Date, interval: RecurringInterval): Date {
  const d = new Date(from)
  switch (interval) {
    case 'monthly':   d.setMonth(d.getMonth() + 1); break
    case 'quarterly': d.setMonth(d.getMonth() + 3); break
    case 'yearly':    d.setFullYear(d.getFullYear() + 1); break
  }
  return d
}

export async function generateNextInvoice(template: Invoice): Promise<string> {
  if (!template.recurring) throw new Error('Invoice is not set to recurring')
  const issueDate = template.nextRecurDate ?? new Date()
  const dueOffset = template.dueDate.getTime() - template.issueDate.getTime()
  const dueDate   = new Date(issueDate.getTime() + Math.max(dueOffset, 0))

  const newId = await createInvoice({
    companyId:       template.companyId,
    customerId:      template.customerId,
    customerName:    template.customerName,
    customerPhone:   template.customerPhone,
    customerEmail:   template.customerEmail,
    customerAddress: template.customerAddress,
    invoiceNumber:   generateInvoiceNumber(),
    issueDate,
    dueDate,
    status:          'sent',
    lineItems:       template.lineItems,
    notes:           template.notes,
    taxRate:         template.taxRate,
    recurring:       null,
    nextRecurDate:   null,
    lastGeneratedAt: null,
    generatedFrom:   template.id,
  })

  await updateInvoice(template.id, {
    nextRecurDate:   advanceByInterval(issueDate, template.recurring),
    lastGeneratedAt: new Date(),
  })

  return newId
}

export async function deleteInvoice(id: string): Promise<void> {
  await deleteDoc(doc(db, COL, id))
}
