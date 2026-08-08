import type { QueryDocumentSnapshot, DocumentSnapshot } from 'firebase/firestore'
import { Timestamp } from 'firebase/firestore'

export interface Expense {
  id: string
  title: string
  amount: number
  category: string
  date: Date
  notes: string
  isReimbursable: boolean
  lastUpdate: Date
}

// Matches iOS ExpenseCategory enum raw values exactly
export const EXPENSE_CATEGORIES = [
  'Food',
  'Meals',
  'Travel',
  'Entertainment',
  'Software',
  'Supplies',
  'Utilities',
  'Tithes',
  'Other',
] as const

export type ExpenseCategory = typeof EXPENSE_CATEGORIES[number]

export function expenseFromDoc(
  doc: QueryDocumentSnapshot | DocumentSnapshot
): Expense {
  const d = doc.data() ?? {}

  function toDate(v: unknown): Date {
    if (v instanceof Timestamp) return v.toDate()
    if (v instanceof Date) return v
    if (typeof v === 'string' || typeof v === 'number') {
      const parsed = new Date(v)
      if (!isNaN(parsed.getTime())) return parsed
    }
    return new Date()
  }

  return {
    id:             doc.id,
    title:          typeof d['title']    === 'string' ? d['title']    : '',
    amount:         typeof d['amount']   === 'number' ? d['amount']   : parseFloat(d['amount']) || 0,
    category:       typeof d['category'] === 'string' ? d['category'] : 'Other',
    notes:          typeof d['notes']    === 'string' ? d['notes']    : '',
    isReimbursable: typeof d['isReimbursable'] === 'boolean' ? d['isReimbursable'] : false,
    date:           toDate(d['date']),
    lastUpdate:     toDate(d['lastUpdate']),
  }
}

export function expenseToFirestore(
  e: Omit<Expense, 'id'>,
): Record<string, unknown> {
  return {
    title:          e.title,
    amount:         e.amount,
    category:       e.category,
    notes:          e.notes,
    isReimbursable: e.isReimbursable,
    date:           Timestamp.fromDate(e.date),
    lastUpdate:     Timestamp.fromDate(new Date()),
  }
}

export function formatCurrency(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}
