import {
  collection, doc, addDoc, updateDoc, deleteDoc,
  onSnapshot, query, where, orderBy,
  serverTimestamp, Timestamp, type Unsubscribe,
} from 'firebase/firestore'
import { db } from '../firebase/config'
import { getCompanyId, getCurrentUserLabel } from '../stores/authStore'
import { generatePONumber, type PurchaseOrder, type PurchaseOrderLineItem, type PurchaseOrderStatus } from '../models/purchaseOrder'

const COL = 'purchaseOrders'

function toDate(v: unknown): Date {
  if (v instanceof Timestamp) return v.toDate()
  return new Date()
}

function toPO(id: string, d: Record<string, unknown>): PurchaseOrder {
  const rawItems = Array.isArray(d['lineItems']) ? d['lineItems'] as Record<string, unknown>[] : []
  const lineItems: PurchaseOrderLineItem[] = rawItems.map(i => ({
    description: String(i['description'] ?? ''),
    qty:      Number(i['qty']      ?? 1),
    unitCost: Number(i['unitCost'] ?? 0),
  }))
  return {
    id,
    companyId:     String(d['companyId']     ?? ''),
    poNumber:      String(d['poNumber']      ?? ''),
    vendorId:      String(d['vendorId']      ?? ''),
    vendorName:    String(d['vendorName']    ?? ''),
    jobId:         String(d['jobId']         ?? ''),
    jobName:       String(d['jobName']       ?? ''),
    status:        (d['status'] as PurchaseOrderStatus) ?? 'draft',
    lineItems,
    notes:         String(d['notes']         ?? ''),
    orderDate:     toDate(d['orderDate']),
    expectedDate:  d['expectedDate'] ? toDate(d['expectedDate']) : null,
    receivedDate:  d['receivedDate'] ? toDate(d['receivedDate']) : null,
    createdAt:     toDate(d['createdAt']),
    updatedAt:     toDate(d['updatedAt']),
    createdByName:    String(d['createdByName']    ?? ''),
    lastEditedByName: String(d['lastEditedByName'] ?? ''),
  }
}

export function subscribeToPurchaseOrders(
  onData:  (items: PurchaseOrder[]) => void,
  onError: (e: Error) => void,
): Unsubscribe {
  const companyId = getCompanyId()
  if (!companyId) { onData([]); return () => {} }

  const q = query(
    collection(db, COL),
    where('companyId', '==', companyId),
    orderBy('createdAt', 'desc'),
  )

  return onSnapshot(
    q,
    snap => onData(snap.docs.map(d => toPO(d.id, d.data()))),
    onError,
  )
}

export async function createPurchaseOrder(
  fields: Pick<PurchaseOrder, 'vendorId' | 'vendorName' | 'jobId' | 'jobName' | 'lineItems' | 'notes' | 'orderDate' | 'expectedDate'>,
): Promise<string> {
  const companyId = getCompanyId()
  if (!companyId) throw new Error('Not authenticated')

  const ref = await addDoc(collection(db, COL), {
    companyId,
    poNumber: generatePONumber(),
    vendorId: fields.vendorId,
    vendorName: fields.vendorName,
    jobId: fields.jobId,
    jobName: fields.jobName,
    status: 'draft',
    lineItems: fields.lineItems,
    notes: fields.notes,
    orderDate: Timestamp.fromDate(fields.orderDate),
    expectedDate: fields.expectedDate ? Timestamp.fromDate(fields.expectedDate) : null,
    receivedDate: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdByName: getCurrentUserLabel().name,
    lastEditedByName: getCurrentUserLabel().name,
  })
  return ref.id
}

export async function updatePurchaseOrder(
  id: string,
  fields: Partial<Pick<PurchaseOrder, 'vendorId' | 'vendorName' | 'jobId' | 'jobName' | 'lineItems' | 'notes' | 'orderDate' | 'expectedDate' | 'status'>>,
): Promise<void> {
  const updates: Record<string, unknown> = { updatedAt: serverTimestamp(), lastEditedByName: getCurrentUserLabel().name }
  if (fields.vendorId      !== undefined) updates.vendorId      = fields.vendorId
  if (fields.vendorName    !== undefined) updates.vendorName    = fields.vendorName
  if (fields.jobId         !== undefined) updates.jobId         = fields.jobId
  if (fields.jobName       !== undefined) updates.jobName       = fields.jobName
  if (fields.lineItems     !== undefined) updates.lineItems     = fields.lineItems
  if (fields.notes         !== undefined) updates.notes         = fields.notes
  if (fields.orderDate     !== undefined) updates.orderDate     = Timestamp.fromDate(fields.orderDate)
  if (fields.expectedDate  !== undefined) updates.expectedDate  = fields.expectedDate ? Timestamp.fromDate(fields.expectedDate) : null
  if (fields.status        !== undefined) {
    updates.status = fields.status
    if (fields.status === 'received') updates.receivedDate = serverTimestamp()
  }
  await updateDoc(doc(db, COL, id), updates)
}

export async function deletePurchaseOrder(id: string): Promise<void> {
  await deleteDoc(doc(db, COL, id))
}
