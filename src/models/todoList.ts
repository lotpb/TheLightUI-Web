import type { Todo } from './todo'
import { daysUntilDue } from '../utils/dueDate'

/**
 * Ordering, filtering and counting for /todo.
 *
 * The page sorted on `position`, which addTodo sets to Date.now() once and no
 * service function ever changes — so the list was oldest-created-first
 * permanently, with no sort control, no due-date order and no reorder
 * affordance anywhere. On a task list the order *is* the product.
 */

export const PRIORITY_RANK: Record<Todo['priority'], number> = { high: 0, medium: 1, low: 2 }

/** Capitalised. The row badge printed the raw value while the picker
 *  capitalised the same three words, so the two disagreed. */
export function priorityLabel(p: Todo['priority']): string {
  return p.charAt(0).toUpperCase() + p.slice(1)
}

export type TodoSortKey =
  | 'dueSoonest' | 'dueLatest' | 'priority' | 'newest' | 'oldest' | 'title'

export const TODO_SORTS: { key: TodoSortKey; label: string }[] = [
  { key: 'dueSoonest', label: 'Due soonest' },
  { key: 'dueLatest',  label: 'Due latest' },
  { key: 'priority',   label: 'Priority' },
  { key: 'newest',     label: 'Newest first' },
  { key: 'oldest',     label: 'Oldest first' },
  { key: 'title',      label: 'Title A–Z' },
]

export const DEFAULT_TODO_SORT: TodoSortKey = 'dueSoonest'

/**
 * Returns a new array; the caller's input is never reordered in place.
 *
 * Tasks with no due date sort *after* dated ones under both due-date orders —
 * an undated task isn't urgent, and interleaving it with dated ones by
 * treating null as 0 (the epoch) would rank it as maximally overdue.
 */
export function sortTodos(todos: Todo[], key: TodoSortKey): Todo[] {
  const byCreatedDesc = (a: Todo, b: Todo) => b.createdAt.getTime() - a.createdAt.getTime()

  function byDue(a: Todo, b: Todo, dir: 1 | -1): number {
    if (!a.dueDate && !b.dueDate) return 0
    if (!a.dueDate) return 1
    if (!b.dueDate) return -1
    return (a.dueDate.getTime() - b.dueDate.getTime()) * dir
  }

  const cmp: Record<TodoSortKey, (a: Todo, b: Todo) => number> = {
    dueSoonest: (a, b) => byDue(a, b, 1),
    dueLatest:  (a, b) => byDue(a, b, -1),
    priority:   (a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || byDue(a, b, 1),
    newest:     byCreatedDesc,
    oldest:     (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
    title:      (a, b) => a.title.localeCompare(b.title),
  }

  const primary = cmp[key]
  return [...todos].sort((a, b) => primary(a, b) || byCreatedDesc(a, b))
}

// ── Filtering ─────────────────────────────────────────────────────────────────

/**
 * 'overdue' and 'today' are new.
 *
 * dueMeta already computed both for every row and painted them red or amber,
 * and then the page offered no way to see them together — on a list with no
 * search and no sort. The one question a task list exists to answer required
 * reading every row.
 */
export type TodoState = 'active' | 'overdue' | 'today' | 'completed' | 'all'

export const TODO_STATES: { key: TodoState; label: string }[] = [
  { key: 'active',    label: 'Active' },
  { key: 'overdue',   label: 'Overdue' },
  { key: 'today',     label: 'Today' },
  { key: 'completed', label: 'Completed' },
  { key: 'all',       label: 'All' },
]

export function isTodoState(v: string | null): v is TodoState {
  return v === 'active' || v === 'overdue' || v === 'today' || v === 'completed' || v === 'all'
}

export function matchesState(t: Todo, state: TodoState): boolean {
  switch (state) {
    case 'all':       return true
    case 'completed': return t.isCompleted
    case 'active':    return !t.isCompleted
    // A completed task is never overdue however late it was finished, which
    // is the same rule dueMeta applies to the row's own colour.
    case 'overdue':   return !t.isCompleted && t.dueDate !== null && daysUntilDue(t.dueDate) < 0
    case 'today':     return !t.isCompleted && t.dueDate !== null && daysUntilDue(t.dueDate) === 0
  }
}

export function searchTodos(todos: Todo[], search: string): Todo[] {
  const q = search.trim().toLowerCase()
  if (!q) return todos
  return todos.filter(t =>
    t.title.toLowerCase().includes(q) ||
    t.notes.toLowerCase().includes(q) ||
    (t.customerName ?? '').toLowerCase().includes(q),
  )
}

export function filterTodos(todos: Todo[], state: TodoState, search: string): Todo[] {
  return searchTodos(todos.filter(t => matchesState(t, state)), search)
}

export type TodoCounts = Record<TodoState, number>

export function todoCounts(todos: Todo[]): TodoCounts {
  const counts: TodoCounts = { active: 0, overdue: 0, today: 0, completed: 0, all: todos.length }
  for (const t of todos) {
    for (const s of ['active', 'overdue', 'today', 'completed'] as const) {
      if (matchesState(t, s)) counts[s]++
    }
  }
  return counts
}

/** Names the active filter, for the printed sheet and the empty state. */
export function describeTodoFilter(state: TodoState, search: string): string {
  const label = TODO_STATES.find(s => s.key === state)?.label ?? 'All'
  const q = search.trim()
  return q ? `${label} · matching “${q}”` : label
}

/**
 * The customer a task belongs to, or null when there isn't one to show.
 *
 * Tasks created from a record page before the customerName argument was fixed
 * stored the task's own title in that field; suppress those rather than print
 * the title twice, since a real customer name matching the title is
 * implausible.
 */
export function customerLabel(t: Todo): string | null {
  return t.customerName && t.customerName !== t.title ? t.customerName : null
}
