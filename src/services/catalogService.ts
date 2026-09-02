import {
  collection, onSnapshot, addDoc, updateDoc, deleteDoc, getDoc,
  doc, serverTimestamp, Timestamp, query, where, increment,
  type Unsubscribe,
} from 'firebase/firestore'
import { db } from '../firebase/config'
import { getCompanyId } from '../stores/authStore'
import type { CatalogItem } from '../models/catalogItem'

const COL = 'catalog'

function toDate(val: unknown): Date {
  if (val instanceof Timestamp) return val.toDate()
  return new Date()
}

function docToItem(id: string, d: Record<string, unknown>): CatalogItem {
  return {
    id,
    companyId:   String(d.companyId   ?? ''),
    name:        String(d.name        ?? ''),
    description: String(d.description ?? ''),
    price:       typeof d.price === 'number' ? d.price : 0,
    unit:        String(d.unit        ?? 'each'),
    category:    String(d.category    ?? ''),
    createdAt:   toDate(d.createdAt),
    trackInventory:    Boolean(d.trackInventory ?? false),
    stockQty:          typeof d.stockQty === 'number' ? d.stockQty : 0,
    lowStockThreshold: typeof d.lowStockThreshold === 'number' ? d.lowStockThreshold : 5,
  }
}

export function subscribeToCatalog(
  onData: (items: CatalogItem[]) => void,
  onError: (err: Error) => void,
): Unsubscribe {
  const companyId = getCompanyId()
  if (!companyId) { onError(new Error('Not authenticated')); return () => {} }
  return onSnapshot(
    query(collection(db, COL), where('companyId', '==', companyId)),
    snap => {
      const items: CatalogItem[] = []
      for (const d of snap.docs) {
        try { items.push(docToItem(d.id, d.data() as Record<string, unknown>)) }
        catch (e) { console.warn('[Catalog] skipping malformed doc', d.id, e) }
      }
      items.sort((a, b) => {
        const catCmp = a.category.localeCompare(b.category)
        return catCmp !== 0 ? catCmp : a.name.localeCompare(b.name)
      })
      onData(items)
    },
    onError,
  )
}

export async function addCatalogItem(
  name: string, description: string, price: number, unit: string, category: string,
  trackInventory = false, stockQty = 0, lowStockThreshold = 5,
): Promise<void> {
  const companyId = getCompanyId()
  await addDoc(collection(db, COL), {
    companyId, name, description, price, unit, category,
    trackInventory, stockQty, lowStockThreshold,
    createdAt: serverTimestamp(),
  })
}

export async function updateCatalogItem(
  id: string, name: string, description: string, price: number, unit: string, category: string,
  trackInventory = false, stockQty = 0, lowStockThreshold = 5,
): Promise<void> {
  await updateDoc(doc(db, COL, id), {
    name, description, price, unit, category,
    trackInventory, stockQty, lowStockThreshold,
  })
}

export async function deleteCatalogItem(id: string): Promise<void> {
  await deleteDoc(doc(db, COL, id))
}

export async function getCatalogItem(id: string): Promise<CatalogItem | null> {
  const snap = await getDoc(doc(db, COL, id))
  if (!snap.exists()) return null
  return docToItem(snap.id, snap.data() as Record<string, unknown>)
}

export async function adjustStock(id: string, delta: number): Promise<void> {
  await updateDoc(doc(db, COL, id), { stockQty: increment(delta) })
}

interface StockLinkedLineItem {
  catalogItemId?: string
  qty: number
}

// Shared by invoiceService (deduct on creation) and purchaseOrderService
// (restock on receiving) — skips items with no catalogItemId (free-text line
// items were never linked to the catalog) and items whose catalog entry
// doesn't have trackInventory on, same as the manual +/- button on
// CatalogPage only appearing for tracked items.
async function applyStockDelta(items: StockLinkedLineItem[], sign: 1 | -1): Promise<void> {
  for (const item of items) {
    if (!item.catalogItemId || !item.qty) continue
    const catalogItem = await getCatalogItem(item.catalogItemId).catch(() => null)
    if (!catalogItem?.trackInventory) continue
    await adjustStock(item.catalogItemId, sign * item.qty).catch(err => {
      console.error(`[Catalog] failed to adjust stock for ${item.catalogItemId}:`, err)
    })
  }
}

/** Deducts stock for each catalog-linked line item — called once when an invoice is created. */
export async function deductStockForLineItems(items: StockLinkedLineItem[]): Promise<void> {
  await applyStockDelta(items, -1)
}

/** Restocks for each catalog-linked line item — called once when a purchase order transitions to 'received'. */
export async function restockForLineItems(items: StockLinkedLineItem[]): Promise<void> {
  await applyStockDelta(items, 1)
}
