import {
  collection, onSnapshot, addDoc, updateDoc, deleteDoc,
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

export async function adjustStock(id: string, delta: number): Promise<void> {
  await updateDoc(doc(db, COL, id), { stockQty: increment(delta) })
}
