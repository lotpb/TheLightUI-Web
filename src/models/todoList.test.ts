import { describe, it, expect } from 'vitest'
import type { Todo } from './todo'
import {
  sortTodos, filterTodos, matchesState, searchTodos, todoCounts,
  describeTodoFilter, priorityLabel, customerLabel, isTodoState,
  TODO_SORTS, DEFAULT_TODO_SORT, TODO_STATES,
  type TodoSortKey,
} from './todoList'

/**
 * Due dates are stored at UTC midnight on purpose — see utils/dueDate.ts,
 * which reads them back with timeZone: 'UTC' so the day the user picked
 * survives. Fixtures use the same convention, which is why these are
 * `new Date('YYYY-MM-DD')` rather than a local-midnight helper.
 */
const utcDay = (iso: string) => new Date(iso)

/** Relative to the real clock, since daysUntilDue reads today locally. */
function dueInDays(n: number): Date {
  const now = new Date()
  const d = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate() + n)
  return new Date(d)
}

function todo(over: Partial<Todo> = {}): Todo {
  return {
    id: 't1',
    title: 'Call the roofer',
    notes: '',
    isCompleted: false,
    priority: 'medium',
    dueDate: null,
    createdAt: new Date(2026, 0, 1),
    userId: 'u1',
    position: 1,
    customerId: null,
    customerName: null,
    completedAt: null,
    ...over,
  }
}

describe('priorityLabel', () => {
  it('capitalises, matching the picker', () => {
    // The row badge printed the raw value while the picker capitalised it.
    expect(priorityLabel('high')).toBe('High')
    expect(priorityLabel('medium')).toBe('Medium')
    expect(priorityLabel('low')).toBe('Low')
  })
})

describe('customerLabel', () => {
  it('shows a real customer name', () => {
    expect(customerLabel(todo({ customerName: 'Acme Roofing' }))).toBe('Acme Roofing')
  })

  it('suppresses the legacy case where the title was stored as the name', () => {
    expect(customerLabel(todo({ title: 'Fix gutter', customerName: 'Fix gutter' }))).toBeNull()
  })

  it('is null when there is no customer', () => {
    expect(customerLabel(todo({ customerName: null }))).toBeNull()
  })
})

describe('sortTodos', () => {
  const a = todo({ id: 'a', title: 'Zebra', priority: 'low',    dueDate: utcDay('2026-06-10'), createdAt: new Date(2026, 0, 3) })
  const b = todo({ id: 'b', title: 'Apple', priority: 'high',   dueDate: utcDay('2026-06-01'), createdAt: new Date(2026, 0, 1) })
  const c = todo({ id: 'c', title: 'Mango', priority: 'medium', dueDate: null,                 createdAt: new Date(2026, 0, 2) })
  const items = [a, b, c]
  const ids = (k: TodoSortKey) => sortTodos(items, k).map(t => t.id)

  it('defaults to due soonest', () => {
    expect(DEFAULT_TODO_SORT).toBe('dueSoonest')
    expect(ids('dueSoonest')).toEqual(['b', 'a', 'c'])
  })

  it('puts undated tasks after dated ones, both ways', () => {
    // Treating null as the epoch would rank an undated task as maximally
    // overdue, which is the opposite of true.
    expect(ids('dueSoonest')[2]).toBe('c')
    expect(ids('dueLatest')[2]).toBe('c')
  })

  it('sorts by due date descending', () => {
    expect(ids('dueLatest')).toEqual(['a', 'b', 'c'])
  })

  it('sorts by priority, then by due date within a priority', () => {
    const hi1 = todo({ id: 'h1', priority: 'high', dueDate: utcDay('2026-07-01') })
    const hi2 = todo({ id: 'h2', priority: 'high', dueDate: utcDay('2026-06-01') })
    const lo  = todo({ id: 'l1', priority: 'low',  dueDate: utcDay('2026-01-01') })
    expect(sortTodos([lo, hi1, hi2], 'priority').map(t => t.id)).toEqual(['h2', 'h1', 'l1'])
  })

  it('sorts by creation and by title', () => {
    expect(ids('newest')).toEqual(['a', 'c', 'b'])
    expect(ids('oldest')).toEqual(['b', 'c', 'a'])
    expect(ids('title')).toEqual(['b', 'c', 'a'])
  })

  it('breaks ties on creation, newest first', () => {
    const x = todo({ id: 'x', dueDate: utcDay('2026-05-01'), createdAt: new Date(2026, 0, 1) })
    const y = todo({ id: 'y', dueDate: utcDay('2026-05-01'), createdAt: new Date(2026, 0, 9) })
    expect(sortTodos([x, y], 'dueSoonest').map(t => t.id)).toEqual(['y', 'x'])
    expect(sortTodos([y, x], 'dueSoonest').map(t => t.id)).toEqual(['y', 'x'])
  })

  it('does not reorder the array it was given', () => {
    const input = [a, b, c]
    sortTodos(input, 'title')
    expect(input.map(t => t.id)).toEqual(['a', 'b', 'c'])
  })

  it('ignores `position` entirely', () => {
    // The field the page used to sort on is write-once and unmanageable.
    const first  = todo({ id: 'first',  position: 1, dueDate: utcDay('2026-09-01') })
    const second = todo({ id: 'second', position: 2, dueDate: utcDay('2026-01-01') })
    expect(sortTodos([first, second], 'dueSoonest').map(t => t.id)).toEqual(['second', 'first'])
  })

  it('offers every key it can sort by, and no key it cannot', () => {
    const offered = TODO_SORTS.map(s => s.key).sort()
    expect(offered).toEqual(['dueLatest', 'dueSoonest', 'newest', 'oldest', 'priority', 'title'])
    expect(offered).toContain(DEFAULT_TODO_SORT)
  })

  it('handles empty and single-item lists', () => {
    expect(sortTodos([], 'dueSoonest')).toEqual([])
    expect(sortTodos([a], 'priority').map(t => t.id)).toEqual(['a'])
  })
})

describe('matchesState', () => {
  const overdue   = todo({ id: 'o', dueDate: dueInDays(-3) })
  const dueToday  = todo({ id: 'd', dueDate: dueInDays(0) })
  const later     = todo({ id: 'l', dueDate: dueInDays(5) })
  const undated   = todo({ id: 'u', dueDate: null })
  const done      = todo({ id: 'c', dueDate: dueInDays(-9), isCompleted: true })

  it('separates active from completed', () => {
    expect(matchesState(overdue, 'active')).toBe(true)
    expect(matchesState(done, 'active')).toBe(false)
    expect(matchesState(done, 'completed')).toBe(true)
  })

  it('finds overdue tasks', () => {
    expect(matchesState(overdue, 'overdue')).toBe(true)
    expect(matchesState(dueToday, 'overdue')).toBe(false)
    expect(matchesState(later, 'overdue')).toBe(false)
    expect(matchesState(undated, 'overdue')).toBe(false)
  })

  it('never counts a completed task as overdue, however late it was finished', () => {
    // Same rule dueMeta applies to the row's own colour.
    expect(matchesState(done, 'overdue')).toBe(false)
  })

  it('finds tasks due today, and today is not overdue', () => {
    expect(matchesState(dueToday, 'today')).toBe(true)
    expect(matchesState(overdue, 'today')).toBe(false)
  })

  it('passes everything through for "all"', () => {
    for (const t of [overdue, dueToday, later, undated, done]) {
      expect(matchesState(t, 'all')).toBe(true)
    }
  })
})

describe('searchTodos', () => {
  const items = [
    todo({ id: 'a', title: 'Order shingles', notes: 'from the supplier' }),
    todo({ id: 'b', title: 'Call back', customerName: 'Acme Roofing' }),
    todo({ id: 'c', title: 'Invoice review' }),
  ]

  it('matches title, notes and customer name', () => {
    expect(searchTodos(items, 'shingles').map(t => t.id)).toEqual(['a'])
    expect(searchTodos(items, 'supplier').map(t => t.id)).toEqual(['a'])
    expect(searchTodos(items, 'acme').map(t => t.id)).toEqual(['b'])
  })

  it('is case- and whitespace-insensitive', () => {
    expect(searchTodos(items, '  ACME ').map(t => t.id)).toEqual(['b'])
  })

  it('returns everything for a blank query', () => {
    expect(searchTodos(items, '   ')).toHaveLength(3)
  })
})

describe('filterTodos', () => {
  it('applies the state and the search together', () => {
    const items = [
      todo({ id: 'a', title: 'Roof quote', dueDate: dueInDays(-2) }),
      todo({ id: 'b', title: 'Roof invoice', dueDate: dueInDays(-2), isCompleted: true }),
      todo({ id: 'c', title: 'Gutter quote', dueDate: dueInDays(-2) }),
    ]
    expect(filterTodos(items, 'overdue', 'roof').map(t => t.id)).toEqual(['a'])
    expect(filterTodos(items, 'completed', 'roof').map(t => t.id)).toEqual(['b'])
  })
})

describe('todoCounts', () => {
  const items = [
    todo({ id: 'o1', dueDate: dueInDays(-1) }),
    todo({ id: 'o2', dueDate: dueInDays(-8) }),
    todo({ id: 'd1', dueDate: dueInDays(0) }),
    todo({ id: 'l1', dueDate: dueInDays(4) }),
    todo({ id: 'u1', dueDate: null }),
    todo({ id: 'c1', dueDate: dueInDays(-30), isCompleted: true }),
  ]

  it('counts every tab the page shows', () => {
    const c = todoCounts(items)
    expect(c.all).toBe(6)
    expect(c.active).toBe(5)
    expect(c.completed).toBe(1)
    expect(c.overdue).toBe(2)
    expect(c.today).toBe(1)
  })

  it('treats overdue and today as subsets of active, not extra rows', () => {
    const c = todoCounts(items)
    expect(c.active + c.completed).toBe(c.all)
    expect(c.overdue).toBeLessThanOrEqual(c.active)
    expect(c.today).toBeLessThanOrEqual(c.active)
  })

  it('is all zeroes for an empty list', () => {
    expect(todoCounts([])).toEqual({ active: 0, overdue: 0, today: 0, completed: 0, all: 0 })
  })

  it('covers every state the tab strip offers', () => {
    const c = todoCounts(items)
    for (const s of TODO_STATES) expect(typeof c[s.key]).toBe('number')
  })
})

describe('describeTodoFilter', () => {
  it('names the state, so a printed sheet says what it excludes', () => {
    // The print header read "Tasks · 12 items" whichever tab was active, so a
    // sheet of finished work looked like a sheet of outstanding work.
    expect(describeTodoFilter('completed', '')).toBe('Completed')
    expect(describeTodoFilter('overdue', '')).toBe('Overdue')
  })

  it('names the search too', () => {
    expect(describeTodoFilter('active', 'roof')).toBe('Active · matching “roof”')
  })

  it('ignores a blank search', () => {
    expect(describeTodoFilter('all', '   ')).toBe('All')
  })
})

describe('isTodoState', () => {
  it('accepts the five real states', () => {
    for (const s of TODO_STATES) expect(isTodoState(s.key)).toBe(true)
  })

  it('rejects anything else, so a hand-edited URL falls back', () => {
    expect(isTodoState('archived')).toBe(false)
    expect(isTodoState('')).toBe(false)
    expect(isTodoState(null)).toBe(false)
  })
})
