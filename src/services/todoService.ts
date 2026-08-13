import {
  collection, onSnapshot, addDoc, updateDoc, deleteDoc,
  doc, getDocs, writeBatch, serverTimestamp, Timestamp, query, where,
  type Unsubscribe,
} from 'firebase/firestore'
import { db } from '../firebase/config'
import { getCompanyId } from '../stores/authStore'
import type { Todo } from '../models/todo'

// Must match iOS ToDoFirestoreSchema.collection
const COL = 'ToDoItems'

function toDate(val: unknown): Date {
  if (val instanceof Timestamp) return val.toDate()
  if (val && typeof val === 'object' && 'seconds' in val)
    return new Date((val as { seconds: number }).seconds * 1000)
  if (typeof val === 'string' || typeof val === 'number') return new Date(val)
  return new Date()
}

function docToTodo(id: string, data: Record<string, unknown>): Todo {
  const isCompleted = data.isCompleted === true || data.isCompleted === 'true'
  return {
    id,
    title:       String(data.title  ?? ''),
    notes:       String(data.notes  ?? ''),
    isCompleted,
    priority:    (['low','medium','high'].includes(data.priority as string)
                   ? data.priority as Todo['priority']
                   : 'medium'),
    dueDate:     data.dueDate ? toDate(data.dueDate) : null,
    createdAt:   toDate(data.createdAt),
    userId:      String(data.userId ?? ''),
    position:    typeof data.position === 'number' ? data.position : Date.now(),
  }
}

export function subscribeToTodos(
  onData: (todos: Todo[]) => void,
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
      const todos: Todo[] = []
      for (const d of snap.docs) {
        try {
          todos.push(docToTodo(d.id, d.data() as Record<string, unknown>))
        } catch (e) {
          console.warn('[Todos] skipping malformed doc', d.id, e)
        }
      }
      todos.sort((a, b) => a.position - b.position)
      onData(todos)
    },
    onError,
  )
}

export async function addTodo(
  userId: string,
  title: string,
  priority: Todo['priority'],
  notes: string,
  dueDate: Date | null,
): Promise<void> {
  const companyId = getCompanyId()
  await addDoc(collection(db, COL), {
    userId,
    companyId,
    title,
    notes,
    priority,
    dueDate:     dueDate ?? null,
    isCompleted: false,
    position:    Date.now(),
    lastUpdate:  serverTimestamp(),
    createdAt:   serverTimestamp(),
  })
}

export async function getTodo(id: string): Promise<Todo | null> {
  const snap = await import('firebase/firestore').then(({ getDoc, doc: firestoreDoc }) =>
    getDoc(firestoreDoc(db, COL, id))
  )
  if (!snap.exists()) return null
  return docToTodo(snap.id, snap.data() as Record<string, unknown>)
}

export async function toggleTodo(id: string, isCompleted: boolean): Promise<void> {
  await updateDoc(doc(db, COL, id), { isCompleted, lastUpdate: serverTimestamp() })
}

export async function updateTodo(
  id: string,
  title: string,
  notes: string,
  priority: Todo['priority'],
  dueDate: Date | null,
): Promise<void> {
  await updateDoc(doc(db, COL, id), { title, notes, priority, dueDate: dueDate ?? null, lastUpdate: serverTimestamp() })
}

export async function deleteTodo(id: string): Promise<void> {
  await deleteDoc(doc(db, COL, id))
}

export async function getAllTodosOnce(): Promise<Todo[]> {
  const companyId = getCompanyId()
  if (!companyId) throw new Error('Not authenticated')
  const snap = await getDocs(
    query(collection(db, COL), where('companyId', '==', companyId))
  )
  const todos: Todo[] = []
  for (const d of snap.docs) {
    try { todos.push(docToTodo(d.id, d.data() as Record<string, unknown>)) } catch { /* skip malformed */ }
  }
  todos.sort((a, b) => a.position - b.position)
  return todos
}

export async function importTodosFromJSON(
  jsonText: string,
  userId: string,
): Promise<{ count: number }> {
  const companyId = getCompanyId()
  if (!companyId) throw new Error('Not authenticated')

  const parsed: unknown = JSON.parse(jsonText)
  const records: Record<string, unknown>[] = Array.isArray(parsed) ? parsed : []
  if (records.length === 0) throw new Error('No todo records found in file.')

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
      const ref = r['id']
        ? doc(db, COL, String(r['id']))
        : doc(collection(db, COL))
      const priority = ['low', 'medium', 'high'].includes(r['priority'] as string)
        ? r['priority'] as string
        : 'medium'
      batch.set(ref, {
        userId,
        companyId,
        title:       String(r['title']    ?? ''),
        notes:       String(r['notes']    ?? ''),
        isCompleted: Boolean(r['isCompleted'] ?? false),
        priority,
        dueDate:     r['dueDate'] ? safeDate(r['dueDate']) : null,
        createdAt:   r['createdAt'] ? safeDate(r['createdAt']) : serverTimestamp(),
        position:    typeof r['position'] === 'number' ? r['position'] : Date.now(),
        lastUpdate:  serverTimestamp(),
      })
      total++
    }
    await batch.commit()
  }
  return { count: total }
}
