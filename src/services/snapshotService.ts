import {
  collection, query, where, orderBy, getDocs, Timestamp,
  getAggregateFromServer, sum,
} from 'firebase/firestore'
import { db } from '../firebase/config'
import { customerFromDoc, categoryMatches, type CustomerItem } from '../models/customer'
import { invoiceTotal, type InvoiceLineItem } from '../models/invoice'
import { getCompanyId } from '../stores/authStore'

const COL = 'Customers'
const INVOICES_COL = 'Invoices'

// A paid invoice issued today — what "Sales Today" actually tracks. Kept
// separate from CustomerItem since customer.amount is a lifetime total, not
// today's total, and a customer can have zero or several invoices today.
export interface SaleEntry {
  id: string
  customerId: string
  customerName: string
  customerPhone: string
  invoiceNumber: string
  amount: number
}

export interface SnapshotData {
  leadsToday: CustomerItem[]
  customersToday: CustomerItem[]
  appointmentsToday: CustomerItem[]
  jobsStartingToday: CustomerItem[]
  salesToday: SaleEntry[]
  activeLeadCount: number
  activeCustomerCount: number
  totalCustomerSales: number
}

export async function fetchSnapshot(): Promise<SnapshotData> {
  const companyId = getCompanyId()
  if (!companyId) throw new Error('Not authenticated')

  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const end = new Date(start.getTime() + 86_400_000)
  const tsStart = Timestamp.fromDate(start)
  const tsEnd = Timestamp.fromDate(end)

  const company = [where('companyId', '==', companyId)]

  const [createdSnap, apptSnap, activeCustomerSnap, activeLeadSnap, salesAgg, paidTodaySnap] =
    await Promise.all([
      getDocs(query(collection(db, COL), ...company,
        where('creationDate', '>=', tsStart),
        where('creationDate', '<', tsEnd),
        orderBy('creationDate', 'desc'))),
      getDocs(query(collection(db, COL), ...company,
        where('start', '>=', tsStart),
        where('start', '<', tsEnd),
        orderBy('start', 'asc'))),
      getDocs(query(collection(db, COL), ...company,
        where('active', '==', '1'),
        where('category', '==', 'Customer'))),
      getDocs(query(collection(db, COL), ...company,
        where('active', '==', '1'),
        where('category', '==', 'Lead'))),
      getAggregateFromServer(
        query(collection(db, COL), ...company, where('category', '==', 'Customer')),
        { totalSales: sum('amount') },
      ),
      // Requires a Firestore composite index (companyId + status + issueDate).
      // Firestore logs a direct link to create it in the browser console if missing.
      getDocs(query(collection(db, INVOICES_COL), ...company,
        where('status', '==', 'paid'),
        where('issueDate', '>=', tsStart),
        where('issueDate', '<', tsEnd))),
    ])

  const allCreatedToday = createdSnap.docs.map(customerFromDoc)
  const leadsToday = allCreatedToday.filter(c => categoryMatches(c.category, 'Lead'))
  const customersToday = allCreatedToday.filter(c => categoryMatches(c.category, 'Customer'))

  const allStartToday = apptSnap.docs.map(customerFromDoc)
  const appointmentsToday = allStartToday.filter(c => categoryMatches(c.category, 'Lead'))
  const jobsStartingToday = allStartToday.filter(
    c => categoryMatches(c.category, 'Customer') && !!c.completionDate && !!c.startDate && c.completionDate > c.startDate,
  )

  const salesToday: SaleEntry[] = paidTodaySnap.docs.map(d => {
    const data = d.data()
    const rawItems = Array.isArray(data.lineItems) ? (data.lineItems as Record<string, unknown>[]) : []
    const lineItems: InvoiceLineItem[] = rawItems.map(item => ({
      description: String(item.description ?? ''),
      qty:  Number(item.qty  ?? 1),
      rate: Number(item.rate ?? 0),
    }))
    return {
      id: d.id,
      customerId:     String(data.customerId     ?? ''),
      customerName:   String(data.customerName   ?? ''),
      customerPhone:  String(data.customerPhone  ?? ''),
      invoiceNumber:  String(data.invoiceNumber  ?? ''),
      amount: invoiceTotal({ lineItems, taxRate: Number(data.taxRate ?? 0) }),
    }
  })

  const totalCustomerSales = salesAgg.data().totalSales ?? 0

  return {
    leadsToday,
    customersToday,
    appointmentsToday,
    jobsStartingToday,
    salesToday,
    activeLeadCount: activeLeadSnap.size,
    activeCustomerCount: activeCustomerSnap.size,
    totalCustomerSales,
  }
}
