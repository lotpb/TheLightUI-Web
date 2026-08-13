import {
  collection, onSnapshot, addDoc, updateDoc, deleteDoc,
  doc, serverTimestamp, Timestamp, query, where,
  type Unsubscribe,
} from 'firebase/firestore'
import { db } from '../firebase/config'
import { getCompanyId } from '../stores/authStore'
import { advanceByFrequency, type ServicePlan, type ServicePlanFrequency } from '../models/servicePlan'

const COL = 'ServicePlans'

function toDate(val: unknown): Date {
  if (val instanceof Timestamp) return val.toDate()
  if (val && typeof val === 'object' && 'seconds' in val)
    return new Date((val as { seconds: number }).seconds * 1000)
  if (typeof val === 'string' || typeof val === 'number') return new Date(val)
  return new Date()
}

function docToPlan(id: string, data: Record<string, unknown>): ServicePlan {
  const freq = (['weekly','monthly','quarterly','biannual','annual'] as ServicePlanFrequency[])
    .includes(data.frequency as ServicePlanFrequency)
    ? data.frequency as ServicePlanFrequency
    : 'monthly'
  return {
    id,
    companyId:         String(data.companyId         ?? ''),
    customerId:        String(data.customerId         ?? ''),
    customerName:      String(data.customerName       ?? ''),
    title:             String(data.title              ?? ''),
    frequency:         freq,
    nextDate:          toDate(data.nextDate),
    lastCompletedDate: data.lastCompletedDate ? toDate(data.lastCompletedDate) : null,
    notes:             String(data.notes              ?? ''),
    salesman:          String(data.salesman           ?? ''),
    isActive:          data.isActive !== false,
    createdAt:         toDate(data.createdAt),
  }
}

export function subscribeToServicePlans(
  onData: (plans: ServicePlan[]) => void,
  onError: (err: Error) => void,
): Unsubscribe {
  const companyId = getCompanyId()
  if (!companyId) {
    onError(new Error('Not authenticated'))
    return () => {}
  }
  return onSnapshot(
    query(collection(db, COL), where('companyId', '==', companyId)),
    snap => {
      const plans: ServicePlan[] = []
      for (const d of snap.docs) {
        try { plans.push(docToPlan(d.id, d.data() as Record<string, unknown>)) }
        catch (e) { console.warn('[ServicePlans] skipping malformed doc', d.id, e) }
      }
      plans.sort((a, b) => a.nextDate.getTime() - b.nextDate.getTime())
      onData(plans)
    },
    onError,
  )
}

export async function addServicePlan(
  customerId: string,
  customerName: string,
  title: string,
  frequency: ServicePlanFrequency,
  nextDate: Date,
  notes: string,
  salesman: string,
): Promise<void> {
  const companyId = getCompanyId()
  await addDoc(collection(db, COL), {
    companyId, customerId, customerName, title, frequency,
    nextDate, notes, salesman,
    isActive: true,
    lastCompletedDate: null,
    createdAt: serverTimestamp(),
  })
}

export async function updateServicePlan(
  id: string,
  title: string,
  frequency: ServicePlanFrequency,
  nextDate: Date,
  notes: string,
  salesman: string,
  isActive: boolean,
): Promise<void> {
  await updateDoc(doc(db, COL, id), {
    title, frequency, nextDate, notes, salesman, isActive,
  })
}

/** Mark a plan complete: record the date and advance nextDate by one interval. */
export async function completeServicePlan(plan: ServicePlan): Promise<void> {
  const now = new Date()
  await updateDoc(doc(db, COL, plan.id), {
    lastCompletedDate: now,
    nextDate: advanceByFrequency(now, plan.frequency),
  })
}

export async function deleteServicePlan(id: string): Promise<void> {
  await deleteDoc(doc(db, COL, id))
}
