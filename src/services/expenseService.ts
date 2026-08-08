import {
  collection, doc, setDoc, updateDoc, deleteDoc,
  onSnapshot, getDoc, query, where,
  type Unsubscribe,
} from 'firebase/firestore'
import { db } from '../firebase/config'
import { expenseFromDoc, expenseToFirestore, type Expense } from '../models/expense'
import { getCompanyId } from '../stores/authStore'

const COL = 'Expenses'

export function subscribeToExpenses(
  onData: (items: Expense[]) => void,
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
      const items: Expense[] = []
      for (const d of snap.docs) {
        try { items.push(expenseFromDoc(d)) } catch { /* skip malformed */ }
      }
      items.sort((a, b) => b.date.getTime() - a.date.getTime())
      onData(items)
    },
    onError,
  )
}

export async function getExpense(id: string): Promise<Expense | null> {
  const snap = await getDoc(doc(db, COL, id))
  if (!snap.exists()) return null
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
