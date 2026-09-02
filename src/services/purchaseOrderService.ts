import {
  collection, doc, addDoc, updateDoc, deleteDoc, getDoc,
  onSnapshot, query, where, orderBy, limit,
  serverTimestamp, Timestamp, type Unsubscribe,
} from 'firebase/firestore'
import { db } from '../firebase/config'
import { getCompanyId, getCurrentUserLabel } from '../stores/authStore'
import { generatePONumber, type PurchaseOrder, type PurchaseOrderLineItem, type PurchaseOrderStatus } from '../models/purchaseOrder'
import { restockForLineItems } from './catalogService'

const COL = 'purchaseOrders'

// Safety cap for the real-time listener — same reasoning as customerService's
// REALTIME_LIMIT.
const PO_REALTIME_LIMIT = 5_000

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
    catalogItemId: i['catalogItemId'] ? String(i['catalogItemId']) : undefined,
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
    limit(PO_REALTIME_LIMIT),
  )

  return onSnapshot(
    q,
    snap => {
      if (snap.size === PO_REALTIME_LIMIT) {
        console.warn(`[subscribeToPurchaseOrders] hit ${PO_REALTIME_LIMIT}-document cap for company ${companyId}.`)
      }
      onData(snap.docs.map(d => toPO(d.id, d.data())))
    },
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
  // Only restock on the transition *into* 'received' — read the current
  // status first so re-saving an already-received PO (e.g. editing its notes)
  // can't double-restock. This is the idempotency guard createInvoice doesn't
  // need, since invoice creation only ever happens once per doc.
  //
  // The real call site (PurchaseOrdersPage's status-change action) sends
  // only `{ status }`, never lineItems — so the items to restock have to come
  // from the existing doc, not assumed to be present in this update's payload.
  let justReceived = false
  let lineItemsToRestock: PurchaseOrderLineItem[] = []
  if (fields.status === 'received') {
    const before = await getDoc(doc(db, COL, id))
    const beforeData = before.data()
    justReceived = before.exists() && beforeData?.['status'] !== 'received'
    if (justReceived) {
      lineItemsToRestock = fields.lineItems ?? toPO(id, beforeData ?? {}).lineItems
    }
  }

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

  if (justReceived) {
    await restockForLineItems(lineItemsToRestock)
  }
}

export async function deletePurchaseOrder(id: string): Promise<void> {
  await deleteDoc(doc(db, COL, id))
}

// Per-customer scope for the detail page's Related Records. POs reference the
// customer through `jobId`, not `customerId`.
export function subscribeToJobPurchaseOrders(
  jobId: string,
  onData:  (items: PurchaseOrder[]) => void,
  onError: (e: Error) => void,
): Unsubscribe {
  const companyId = getCompanyId()
  if (!companyId) { onData([]); return () => {} }

  return onSnapshot(
    query(
      collection(db, COL),
      where('companyId', '==', companyId),
      where('jobId', '==', jobId),
    ),
    snap => {
      const items = snap.docs.map(d => toPO(d.id, d.data()))
      items.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      onData(items)
    },
    onError,
  )
}
