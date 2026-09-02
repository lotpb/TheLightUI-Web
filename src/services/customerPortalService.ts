import {
  doc, setDoc, getDoc, addDoc, collection,
  Timestamp, serverTimestamp,
} from 'firebase/firestore'
import { getFunctions, httpsCallable } from 'firebase/functions'
import { db } from '../firebase/config'
import { getCompanyId } from '../stores/authStore'
import type { CustomerItem } from '../models/customer'
import { fullName } from '../models/customer'
import type { Invoice } from '../models/invoice'
import { invoiceTotal } from '../models/invoice'
import type { ServicePlan } from '../models/servicePlan'
import { getSignedDocumentsForCustomer } from './signingRequestService'
import { setPortalToken } from './customerService'

export interface PortalInvoiceSummary {
  id: string
  invoiceNumber: string
  status: string
  total: number
  dueDate: Date
  shareToken?: string
}

export interface PortalPlanSummary {
  title: string
  frequency: string
  nextDate: Date
}

export interface PortalSignedDoc {
  templateName: string
  signedAt: Date
}

export interface CustomerPortalSnapshot {
  token: string
  companyId: string
  customerId: string
  customerName: string
  customerPhone: string
  customerEmail: string
  customerAddress: string
  invoices: PortalInvoiceSummary[]
  paidHistory: PortalInvoiceSummary[]
  servicePlans: PortalPlanSummary[]
  signedDocuments: PortalSignedDoc[]
  updatedAt: Date
}

function makeToken(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  return Array.from({ length: 20 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
}

export async function generatePortalLink(
  customer: CustomerItem,
  invoices: Invoice[],
  plans: ServicePlan[],
): Promise<string> {
  const companyId = getCompanyId()
  if (!companyId) throw new Error('Not authenticated')

  // Reuse this customer's existing snapshot when there is one. Minting a fresh
  // token on every click would leave the previous snapshot orphaned and — since
  // customerPortals allows unauthenticated `get` by token — permanently
  // readable, so "regenerate the link" would revoke nothing.
  const existing = customer.portalToken
  const token = existing || makeToken()

  const invoiceSummaries: PortalInvoiceSummary[] = invoices
    .filter(inv => inv.customerId === customer.id && inv.status !== 'paid')
    .slice(0, 10)
    .map(inv => ({
      id:            inv.id,
      invoiceNumber: inv.invoiceNumber,
      status:        inv.status,
      total:         invoiceTotal(inv),
      dueDate:       inv.dueDate,
      shareToken:    inv.shareToken,
    }))

  const paidHistory: PortalInvoiceSummary[] = invoices
    .filter(inv => inv.customerId === customer.id && inv.status === 'paid')
    .slice(0, 10)
    .map(inv => ({
      id:            inv.id,
      invoiceNumber: inv.invoiceNumber,
      status:        'paid',
      total:         invoiceTotal(inv),
      dueDate:       inv.dueDate,
    }))

  const planSummaries: PortalPlanSummary[] = plans
    .filter(p => p.isActive)
    .slice(0, 5)
    .map(p => ({
      title:     p.title,
      frequency: p.frequency,
      nextDate:  p.nextDate,
    }))

  const signedDocs = await getSignedDocumentsForCustomer(customer.id)
  const signedDocSummaries: PortalSignedDoc[] = signedDocs
    .filter(d => d.signedAt)
    .sort((a, b) => (b.signedAt as Date).getTime() - (a.signedAt as Date).getTime())
    .slice(0, 10)
    .map(d => ({ templateName: d.document.templateName, signedAt: d.signedAt as Date }))

  await setDoc(doc(db, 'customerPortals', token), {
    companyId,
    customerId:      customer.id,
    customerName:    fullName(customer),
    customerPhone:   customer.phone,
    customerEmail:   customer.email,
    customerAddress: [customer.street, customer.city, customer.state, customer.zip].filter(Boolean).join(', '),
    invoices:        invoiceSummaries.map(toFirestoreInv),
    paidHistory:     paidHistory.map(toFirestoreInv),
    servicePlans:    planSummaries.map(p => ({
      title:     p.title,
      frequency: p.frequency,
      nextDate:  Timestamp.fromDate(p.nextDate),
    })),
    signedDocuments: signedDocSummaries.map(d => ({
      templateName: d.templateName,
      signedAt:     Timestamp.fromDate(d.signedAt),
    })),
    updatedAt: serverTimestamp(),
  })

  // Persist the token on first generation so the next call reuses this snapshot.
  if (!existing) await setPortalToken(customer.id, token)

  return `https://thelightui.web.app/portal/${token}`
}

function toFirestoreInv(inv: PortalInvoiceSummary) {
  return {
    id:            inv.id,
    invoiceNumber: inv.invoiceNumber,
    status:        inv.status,
    total:         inv.total,
    dueDate:       Timestamp.fromDate(inv.dueDate),
    shareToken:    inv.shareToken ?? null,
  }
}

export async function getPortalSnapshot(token: string): Promise<CustomerPortalSnapshot | null> {
  const snap = await getDoc(doc(db, 'customerPortals', token))
  if (!snap.exists()) return null
  const d = snap.data()

  function toInv(raw: Record<string, unknown>): PortalInvoiceSummary {
    return {
      id:            String(raw['id'] ?? ''),
      invoiceNumber: String(raw['invoiceNumber'] ?? ''),
      status:        String(raw['status'] ?? ''),
      total:         Number(raw['total'] ?? 0),
      dueDate:       (raw['dueDate'] as Timestamp).toDate(),
      shareToken:    raw['shareToken'] ? String(raw['shareToken']) : undefined,
    }
  }

  return {
    token,
    companyId:       String(d['companyId'] ?? ''),
    customerId:      String(d['customerId'] ?? ''),
    customerName:    String(d['customerName'] ?? ''),
    customerPhone:   String(d['customerPhone'] ?? ''),
    customerEmail:   String(d['customerEmail'] ?? ''),
    customerAddress: String(d['customerAddress'] ?? ''),
    invoices:        (Array.isArray(d['invoices'])     ? d['invoices']     : []).map(toInv),
    paidHistory:     (Array.isArray(d['paidHistory'])  ? d['paidHistory']  : []).map(toInv),
    servicePlans:    (Array.isArray(d['servicePlans']) ? d['servicePlans'] : []).map((p: Record<string, unknown>) => ({
      title:     String(p['title'] ?? ''),
      frequency: String(p['frequency'] ?? ''),
      nextDate:  (p['nextDate'] as Timestamp).toDate(),
    })),
    signedDocuments: (Array.isArray(d['signedDocuments']) ? d['signedDocuments'] : []).map((sd: Record<string, unknown>) => ({
      templateName: String(sd['templateName'] ?? ''),
      signedAt:     (sd['signedAt'] as Timestamp)?.toDate() ?? new Date(),
    })),
    updatedAt: (d['updatedAt'] as Timestamp)?.toDate() ?? new Date(),
  }
}

export interface PortalServiceRequest {
  name: string
  phone: string
  email?: string
  description: string
  preferredDate?: string
}

export async function submitServiceRequest(
  token: string,
  companyId: string,
  customerId: string,
  req: PortalServiceRequest,
): Promise<void> {
  await addDoc(collection(db, 'serviceRequests'), {
    token,
    companyId,
    customerId,
    name:          req.name,
    phone:         req.phone,
    email:         req.email ?? '',
    description:   req.description,
    preferredDate: req.preferredDate ?? '',
    status:        'new',
    createdAt:     serverTimestamp(),
  })
}

export interface DayAvailability {
  count: number
  full: boolean
}

/**
 * Day-level scheduling availability for the portal's service-request date
 * picker. Computed live server-side (getPortalDayAvailability) rather than
 * read from a cached collection — see that function's comment for why. Never
 * throws: a stale/invalid token or a network hiccup resolves to "no data",
 * which the picker treats as every day being open rather than blocking the form.
 */
export async function getDayAvailability(
  token: string,
  startDate: string,
  endDate: string,
): Promise<Record<string, DayAvailability>> {
  try {
    const fn = httpsCallable<
      { token: string; startDate: string; endDate: string },
      { availability: Record<string, DayAvailability> }
    >(getFunctions(), 'getPortalDayAvailability')
    const result = await fn({ token, startDate, endDate })
    return result.data.availability
  } catch {
    return {}
  }
}
