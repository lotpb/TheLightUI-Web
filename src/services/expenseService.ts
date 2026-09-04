import {
  collection, doc, setDoc, updateDoc, deleteDoc,
  onSnapshot, getDoc, getDocs, writeBatch, query, where, orderBy, limit, Timestamp,
  type Unsubscribe,
} from 'firebase/firestore'
import { db } from '../firebase/config'
import { expenseFromDoc, expenseToFirestore, type Expense } from '../models/expense'
import { getCompanyId } from '../stores/authStore'
import { warnIfCapped } from './realtimeCap'

const COL = 'Expenses'

// Safety cap for the real-time listener — same reasoning as customerService's
// REALTIME_LIMIT.
const EXPENSE_REALTIME_LIMIT = 5_000

export function subscribeToExpenses(
  onData: (items: Expense[], hitCap?: boolean) => void,
  onError: (err: Error) => void,
): Unsubscribe {
  const companyId = getCompanyId()
  if (!companyId) {
    onError(new Error('Not authenticated'))
    return () => {}
  }
  return onSnapshot(
    query(collection(db, COL), where('companyId', '==', companyId), limit(EXPENSE_REALTIME_LIMIT)),
    snap => {
      const hitCap = warnIfCapped('Expenses', snap.size, companyId, EXPENSE_REALTIME_LIMIT)
      const items: Expense[] = []
      for (const d of snap.docs) {
        try { items.push(expenseFromDoc(d)) } catch { /* skip malformed */ }
      }
      items.sort((a, b) => b.date.getTime() - a.date.getTime())
      onData(items, hitCap)
    },
    onError,
  )
}

// Expenses dated within an inclusive [start, end] window — the dashboard
// passes either today's bounds or the current month's.
export function subscribeToExpensesInRange(
  start: Date,
  end: Date,
  onData: (items: Expense[]) => void,
  onError: (err: Error) => void,
): Unsubscribe {
  const companyId = getCompanyId()
  if (!companyId) {
    onError(new Error('Not authenticated'))
    return () => {}
  }
  return onSnapshot(
    query(
      collection(db, COL),
      where('companyId', '==', companyId),
      where('date', '>=', Timestamp.fromDate(start)),
      where('date', '<=', Timestamp.fromDate(end)),
      orderBy('date', 'desc'),
    ),
    snap => {
      const items: Expense[] = []
      for (const d of snap.docs) {
        try { items.push(expenseFromDoc(d)) } catch { /* skip malformed */ }
      }
      onData(items)
    },
    onError,
  )
}

export async function getExpense(id: string): Promise<Expense | null> {
  const myCompanyId = getCompanyId()
  const snap = await getDoc(doc(db, COL, id))
  if (!snap.exists()) return null
  if ((snap.data()['companyId'] as string | undefined) !== myCompanyId) {
    console.error(`[getExpense] companyId mismatch on doc ${id}`)
    return null
  }
  return expenseFromDoc(snap)
}

export async function createExpense(
  expense: Omit<Expense, 'id'>,
): Promise<string> {
  const companyId = getCompanyId()
  const id = crypto.randomUUID()
  await setDoc(doc(db, COL, id), { ...expenseToFirestore(expense), companyId })
  return id
}

export async function updateExpense(
  id: string,
  expense: Omit<Expense, 'id'>,
): Promise<void> {
  const companyId = getCompanyId()
  await updateDoc(doc(db, COL, id), { ...expenseToFirestore(expense), companyId })
}

export async function deleteExpense(id: string): Promise<void> {
  await deleteDoc(doc(db, COL, id))
}

export async function getAllExpensesOnce(): Promise<Expense[]> {
  const companyId = getCompanyId()
  if (!companyId) throw new Error('Not authenticated')
  const snap = await getDocs(
    query(collection(db, COL), where('companyId', '==', companyId))
  )
  const items: Expense[] = []
  for (const d of snap.docs) {
    try { items.push(expenseFromDoc(d)) } catch { /* skip malformed */ }
  }
  items.sort((a, b) => b.date.getTime() - a.date.getTime())
  return items
}

export async function importExpensesFromJSON(jsonText: string): Promise<{ count: number }> {
  const companyId = getCompanyId()
  if (!companyId) throw new Error('Not authenticated')

  const parsed: unknown = JSON.parse(jsonText)
  const records: Record<string, unknown>[] = Array.isArray(parsed) ? parsed : []
  if (records.length === 0) throw new Error('No expense records found in file.')

  function safeDate(v: unknown): Date {
    if (!v) return new Date()
    const d = new Date(v as string)
    return isNaN(d.getTime()) ? new Date() : d
  }

  const BATCH_SIZE = 500
  let total = 0
  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const chunk = records.slice(i, i + BATCH_SIZE)
    const batch = writeBatch(db)
    for (const r of chunk) {
      const expense: Omit<Expense, 'id'> = {
        title:          String(r['title']          ?? ''),
        amount:         Number(r['amount'])         || 0,
        category:       String(r['category']        ?? 'Other'),
        date:           safeDate(r['date']),
        notes:          String(r['notes']           ?? ''),
        isReimbursable: Boolean(r['isReimbursable'] ?? false),
        lastUpdate:     safeDate(r['lastUpdate']),
      }
      const ref = r['id']
        ? doc(db, COL, String(r['id']))
        : doc(collection(db, COL))
      batch.set(ref, { ...expenseToFirestore(expense), companyId })
      total++
    }
    await batch.commit()
  }
  return { count: total }
}
