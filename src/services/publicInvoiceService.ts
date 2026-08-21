import {
  doc, getDoc, setDoc, updateDoc, Timestamp, serverTimestamp,
} from 'firebase/firestore'
import { db } from '../firebase/config'
import { getCompanyId } from '../stores/authStore'
import type { Invoice, InvoiceLineItem } from '../models/invoice'

const PUBLIC_COL = 'publicInvoices'

export interface PublicCoInfo {
  name: string
  address: string
  phone: string
  email: string
}

export interface PublicInvoiceSnapshot {
  invoiceId: string
  companyId: string
  customerName: string
  customerPhone: string
  customerEmail: string
  customerAddress: string
  invoiceNumber: string
  issueDate: Date
  dueDate: Date
  status: string
  lineItems: InvoiceLineItem[]
  notes: string
  taxRate: number
  coName: string
  coAddress: string
  coPhone: string
  coEmail: string
  sharedAt: Date
  paymentLink: string | null
}

function toDate(v: unknown): Date {
  if (v && typeof v === 'object' && 'toDate' in v) {
    return (v as { toDate(): Date }).toDate()
  }
  return new Date()
}

// Creates or refreshes the public snapshot. Returns the share token.
export async function generateShareToken(
  invoice: Invoice,
  coInfo: PublicCoInfo,
): Promise<string> {
  const companyId = getCompanyId()
  if (!companyId) throw new Error('Not authenticated')

  const token = invoice.shareToken ?? crypto.randomUUID()

  await setDoc(doc(db, PUBLIC_COL, token), {
    invoiceId:       invoice.id,
    companyId,
    customerName:    invoice.customerName,
    customerPhone:   invoice.customerPhone,
    customerEmail:   invoice.customerEmail,
    customerAddress: invoice.customerAddress,
    invoiceNumber:   invoice.invoiceNumber,
    issueDate:       Timestamp.fromDate(invoice.issueDate),
    dueDate:         Timestamp.fromDate(invoice.dueDate),
    status:          invoice.status,
    lineItems:       invoice.lineItems,
    notes:           invoice.notes,
    taxRate:         invoice.taxRate,
    coName:          coInfo.name,
    coAddress:       coInfo.address,
    coPhone:         coInfo.phone,
    coEmail:         coInfo.email,
    sharedAt:        serverTimestamp(),
    paymentLink:     invoice.paymentLink ?? null,
  })

  if (!invoice.shareToken) {
    await updateDoc(doc(db, 'Invoices', invoice.id), { shareToken: token })
  }

  return token
}

export async function getPublicInvoice(token: string): Promise<PublicInvoiceSnapshot | null> {
  const snap = await getDoc(doc(db, PUBLIC_COL, token))
  if (!snap.exists()) return null
  const d = snap.data() as Record<string, unknown>

  return {
    invoiceId:       String(d.invoiceId       ?? ''),
    companyId:       String(d.companyId       ?? ''),
    customerName:    String(d.customerName    ?? ''),
    customerPhone:   String(d.customerPhone   ?? ''),
    customerEmail:   String(d.customerEmail   ?? ''),
    customerAddress: String(d.customerAddress ?? ''),
    invoiceNumber:   String(d.invoiceNumber   ?? ''),
    issueDate:       toDate(d.issueDate),
    dueDate:         toDate(d.dueDate),
    status:          String(d.status          ?? 'sent'),
    lineItems: (Array.isArray(d.lineItems) ? d.lineItems as Record<string, unknown>[] : []).map(i => ({
      description: String(i.description ?? ''),
      qty:         Number(i.qty  ?? 1),
      rate:        Number(i.rate ?? 0),
    })),
    notes:    String(d.notes    ?? ''),
    taxRate:  Number(d.taxRate  ?? 0),
    coName:   String(d.coName   ?? ''),
    coAddress: String(d.coAddress ?? ''),
    coPhone:  String(d.coPhone  ?? ''),
    coEmail:  String(d.coEmail  ?? ''),
    sharedAt: toDate(d.sharedAt),
    paymentLink: d.paymentLink ? String(d.paymentLink) : null,
  }
}
