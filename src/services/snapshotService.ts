import {
  collection, query, where, orderBy, getDocs, Timestamp,
  getAggregateFromServer, sum,
} from 'firebase/firestore'
import { db } from '../firebase/config'
import { customerFromDoc, categoryMatches, type CustomerItem } from '../models/customer'
import { getCompanyId } from '../stores/authStore'

const COL = 'Customers'

export interface SnapshotData {
  leadsToday: CustomerItem[]
  customersToday: CustomerItem[]
  appointmentsToday: CustomerItem[]
  jobsStartingToday: CustomerItem[]
  salesToday: CustomerItem[]
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

  const [createdSnap, apptSnap, activeCustomerSnap, activeLeadSnap, salesAgg] =
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
    ])

  const allCreatedToday = createdSnap.docs.map(customerFromDoc)
  const leadsToday = allCreatedToday.filter(c => categoryMatches(c.category, 'Lead'))
  const customersToday = allCreatedToday.filter(c => categoryMatches(c.category, 'Customer'))

  const allStartToday = apptSnap.docs.map(customerFromDoc)
  const appointmentsToday = allStartToday.filter(c => categoryMatches(c.category, 'Lead'))
  const jobsStartingToday = allStartToday.filter(
    c => categoryMatches(c.category, 'Customer') && c.completionDate > c.startDate,
  )

  const salesToday = customersToday.filter(c => c.amount > 0)

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
