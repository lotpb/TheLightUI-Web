import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { usePageTitle } from '../../hooks/usePageTitle'
import { subscribeToTodos, addTodo, toggleTodo, deleteTodos } from '../../services/todoService'
import { useAuthStore } from '../../stores/authStore'
import type { Todo } from '../../models/todo'
import {
  customerLabel, describeTodoFilter, filterTodos, isTodoState, priorityLabel,
  sortTodos, todoCounts,
  DEFAULT_TODO_SORT, TODO_SORTS, TODO_STATES,
  type TodoSortKey, type TodoState,
} from '../../models/todoList'
import { dueMeta, fmtDue } from '../../utils/dueDate'
import { esc } from '../../utils/exportUtils'
import { Icon, ICONS } from '../../components/Icon'
import ConfirmModal from '../../components/ConfirmModal'
import PartialDataBanner from '../../components/PartialDataBanner'

const PRIORITY_STYLES: Record<Todo['priority'], string> = {
  low:    'bg-gray-500/20 text-gray-400 border-gray-600/40',
  medium: 'bg-yellow-500/20 text-yellow-400 border-yellow-600/40',
  high:   'bg-red-500/20 text-red-400 border-red-600/40',
}

const PRIORITY_DOT: Record<Todo['priority'], string> = {
  low:    'bg-gray-400',
  medium: 'bg-yellow-400',
  high:   'bg-red-400',
}

export default function TodoPage() {
  usePageTitle('Tasks')
  const navigate   = useNavigate()
  const user       = useAuthStore(s => s.user)
  const companyId  = useAuthStore(s => s.companyId)
  const [todos, setTodos]     = useState<Todo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)
  const [hitCap, setHitCap]   = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<Todo | null>(null)

  /**
   * Filter, search and sort live in the URL.
   *
   * None of them were addressable, so "my overdue tasks" couldn't be linked,
   * bookmarked or survive a reload.
   */
  const [params, setParams] = useSearchParams()
  const stateParam = params.get('state')
  const state: TodoState = isTodoState(stateParam) ? stateParam : 'active'
  const search = params.get('q') ?? ''
  const sortParam = params.get('sort')
  const sort: TodoSortKey = TODO_SORTS.some(s => s.key === sortParam)
    ? sortParam as TodoSortKey
    : DEFAULT_TODO_SORT

  function setParam(key: string, value: string, fallback: string) {
    const next = new URLSearchParams(params)
    if (value === fallback) next.delete(key)
    else next.set(key, value)
    setParams(next, { replace: true })
  }

  // Add form state
  const [addTitle, setAddTitle]       = useState('')
  const [addNotes, setAddNotes]       = useState('')
  const [addPriority, setAddPriority] = useState<Todo['priority']>('medium')
  const [addDueDate, setAddDueDate]   = useState('')
  const [adding, setAdding]           = useState(false)
  const addInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!user) { setLoading(false); return }
    const unsub = subscribeToTodos(
      // The cap flag is the service's second argument and was dropped here, so
      // at 5,000 tasks every tab count and the printed total went silently
      // short with nothing on screen saying so.
      (items, cap) => { setTodos(items); setHitCap(cap === true); setLoading(false) },
      err   => { setError(err.message); setLoading(false) },
    )
    return unsub
  }, [user, companyId])

  // Focus when the form actually mounts, rather than guessing at 50ms.
  useEffect(() => {
    if (showAdd) addInputRef.current?.focus()
  }, [showAdd])

  function openAdd() {
    setShowAdd(true)
  }

  function closeAdd() {
    setShowAdd(false)
    setAddTitle(''); setAddNotes(''); setAddPriority('medium'); setAddDueDate('')
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!addTitle.trim() || !user) return
    setAdding(true)
    // UTC midnight is deliberate — utils/dueDate.ts reads day-granular dates
    // back in UTC so the day the user picked survives west of Greenwich.
    const due = addDueDate ? new Date(addDueDate) : null
    await addTodo(user.uid, addTitle.trim(), addPriority, addNotes.trim(), due)
    setAdding(false)
    closeAdd()
  }

  const counts = useMemo(() => todoCounts(todos), [todos])
  const filtered = useMemo(
    () => sortTodos(filterTodos(todos, state, search), sort),
    [todos, state, search, sort],
  )

  async function handleDeleteOne() {
    if (!pendingDelete) return
    const target = pendingDelete
    setPendingDelete(null)
    try {
      await deleteTodos([target.id])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed.')
    }
  }

  async function handleClearCompleted() {
    setConfirmClear(false)
    setClearing(true)
    try {
      await deleteTodos(todos.filter(t => t.isCompleted).map(t => t.id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not clear completed tasks.')
    } finally {
      setClearing(false)
    }
  }

  function handlePrint() {
    const dateStr = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    // Names the filter and the search. The header read "Tasks · 12 items"
    // whichever tab was active, so a sheet of finished work was
    // indistinguishable from a sheet of outstanding work.
    const scope = describeTodoFilter(state, search)
    const rows = filtered.map(t => {
      // Keep the printed column a date column, but carry the same urgency the
      // screen shows so a printed list is still triageable.
      const dueStatus = t.dueDate ? dueMeta(t.dueDate, t.isCompleted).status : 'later'
      const due = t.dueDate
        ? fmtDue(t.dueDate) + (dueStatus === 'overdue' ? ' (overdue)' : dueStatus === 'today' ? ' (today)' : '')
        : ''
      const dueColor = dueStatus === 'overdue' ? '#dc2626' : dueStatus === 'today' ? '#b45309' : '#6b7280'
      const stamp = t.isCompleted && t.completedAt
        ? `Done ${t.completedAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
        : t.createdAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      const priorityColor = t.priority === 'high' ? '#dc2626' : t.priority === 'medium' ? '#d97706' : '#6b7280'
      const customer = customerLabel(t)
      return `
        <tr style="border-bottom:1px solid #e5e7eb;">
          <td style="padding:10px 8px;vertical-align:top;">
            <span style="display:inline-block;width:14px;height:14px;border-radius:50%;border:2px solid #9ca3af;margin-right:8px;vertical-align:middle;${t.isCompleted ? 'background:#16a34a;border-color:#16a34a;' : ''}"></span>
            <span style="font-size:14px;font-weight:500;${t.isCompleted ? 'text-decoration:line-through;color:#6b7280;' : 'color:#111;'}">${esc(t.title)}</span>
            ${t.notes ? `<div style="font-size:12px;color:#6b7280;margin-left:22px;margin-top:2px;">${esc(t.notes)}</div>` : ''}
          </td>
          <td style="padding:10px 8px;font-size:12px;color:#374151;vertical-align:top;">${customer ? esc(customer) : '—'}</td>
          <td style="padding:10px 8px;font-size:12px;color:${priorityColor};white-space:nowrap;vertical-align:top;">${priorityLabel(t.priority)}</td>
          <td style="padding:10px 8px;font-size:12px;color:${dueColor};white-space:nowrap;vertical-align:top;${dueStatus === 'overdue' ? 'font-weight:500;' : ''}">${due || '—'}</td>
          <td style="padding:10px 8px;font-size:12px;color:#9ca3af;white-space:nowrap;vertical-align:top;">${stamp}</td>
        </tr>`
    }).join('')

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>Tasks — ${esc(scope)}</title>
  <style>
    body { font-family: -apple-system, Helvetica, sans-serif; color: #111; margin: 32px; }
    h1 { font-size: 22px; margin: 0 0 4px; }
    p.sub { font-size: 12px; color: #888; margin: 0 0 20px; }
    table { width: 100%; border-collapse: collapse; }
    th { text-align: left; font-size: 11px; color: #888; text-transform: uppercase; letter-spacing: .05em; border-bottom: 2px solid #e5e7eb; padding: 6px 8px; }
    @media print { body { margin: 16px; } }
  </style>
  <script>window.onload = function() { window.print(); }</script>
</head>
<body>
  <h1>Tasks — ${esc(scope)}</h1>
  <p class="sub">Printed ${dateStr} · ${filtered.length} item${filtered.length !== 1 ? 's' : ''}${hitCap ? ' · partial data: the 5,000-task cap was reached, so these counts are understated' : ''}</p>
  <table>
    <thead>
      <tr>
        <th>Task</th>
        <th>Customer</th>
        <th>Priority</th>
        <th>Due Date</th>
        <th>Added / Done</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
</body>
</html>`

    const w = window.open('', '_blank', 'width=800,height=600')
    if (!w) return
    w.document.write(html)
    w.document.close()
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">

      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-2xl font-bold text-white">Tasks</h1>
        <div className="flex items-center gap-2 no-print">
          <button
            onClick={openAdd}
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium px-4 py-2 rounded-xl transition-colors"
          >
            <span className="text-lg leading-none">+</span>
            New
          </button>
          {/* Print is a rare action next to New, so it drops from a filled pill
              to the app's quiet toolbar-button treatment. */}
          <button
            onClick={handlePrint}
            className="flex items-center gap-1.5 bg-gray-800 border border-gray-700 text-gray-400 hover:text-gray-200 text-sm font-medium px-3 py-2 rounded-xl transition-colors"
          >
            {/* The shared Icon set, not an inlined path — and not 🖨, which
                paints its own colour and ignores the button's hover. */}
            <Icon d={ICONS.printer} className="w-4 h-4" />
            Print
          </button>
        </div>
      </div>

      {/* The service computes this and the page threw it away. */}
      {hitCap && <PartialDataBanner />}

      {/* Add form */}
      {showAdd && (
        <form onSubmit={handleAdd} className="card p-4 mb-4 space-y-3 no-print">
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm font-semibold text-white">New Task</span>
            <button
              type="button"
              onClick={closeAdd}
              aria-label="Cancel new task"
              className="text-gray-400 hover:text-gray-200 hover:bg-gray-700 transition-colors p-1.5 rounded-lg"
            >
              <Icon d={ICONS.close} className="w-4 h-4" />
            </button>
          </div>
          <div>
            <label htmlFor="todo-title" className="form-label">Title</label>
            <input id="todo-title" ref={addInputRef} type="text" className="input-field" placeholder="What needs to be done?"
              value={addTitle} onChange={e => setAddTitle(e.target.value)} autoComplete="off" required />
          </div>
          <div>
            <label htmlFor="todo-notes" className="form-label">Notes</label>
            {/* A textarea, not a single-line input: the row renders notes on
                their own line and clamps to three, so the field that collects
                them shouldn't pretend they're one line long. */}
            <textarea id="todo-notes" rows={2} className="input-field resize-y" placeholder="Add a note… (optional)"
              value={addNotes} onChange={e => setAddNotes(e.target.value)} />
          </div>
          <div>
            <label htmlFor="todo-due" className="form-label">Due Date</label>
            <input id="todo-due" type="date" className="input-field"
              value={addDueDate} onChange={e => setAddDueDate(e.target.value)} />
          </div>
          <div className="flex items-center justify-between pt-1">
            <PriorityPicker value={addPriority} onChange={setAddPriority} />
            <button type="submit" disabled={adding || !addTitle.trim()} className="btn-primary text-sm px-4 py-1.5">
              {adding ? 'Adding…' : 'Add'}
            </button>
          </div>
        </form>
      )}

      {/* Search and sort. There was no search at all on a list capped at
          5,000, and no sort on a list ordered by a write-once `position`
          field — so the only way to reach a task was to scroll. */}
      <div className="flex gap-2 mb-3 no-print">
        <div className="relative flex-1 min-w-0">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
            <Icon d={ICONS.search} className="w-4 h-4" />
          </span>
          <input
            type="search"
            value={search}
            onChange={e => setParam('q', e.target.value, '')}
            placeholder="Search tasks, notes, or customer…"
            aria-label="Search tasks by title, notes or customer"
            className="input-field w-full pl-9 pr-9 text-sm py-2"
          />
          {search && (
            <button
              type="button"
              onClick={() => setParam('q', '', '')}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded text-gray-400 hover:text-gray-200 hover:bg-gray-700/50 transition-colors"
            >
              <Icon d={ICONS.close} className="w-4 h-4" />
            </button>
          )}
        </div>
        <select
          value={sort}
          onChange={e => setParam('sort', e.target.value, DEFAULT_TODO_SORT)}
          aria-label="Sort tasks"
          className="input-field text-sm py-2 shrink-0 w-32 sm:w-40 cursor-pointer"
        >
          {TODO_SORTS.map(s => (
            <option key={s.key} value={s.key}>{s.label}</option>
          ))}
        </select>
      </div>

      {/* Filter tabs. Overdue and Today are new: dueMeta computed both for
          every row and painted them red or amber, and then nothing let you
          see them together. */}
      <div className="flex flex-nowrap gap-2 mb-4 no-print overflow-x-auto scrollbar-none">
        {TODO_STATES.map(s => {
          const active = state === s.key
          const count = counts[s.key]
          // Overdue earns colour when there is something in it; the rest stay
          // neutral so the one that matters is the one that stands out.
          const urgent = s.key === 'overdue' && count > 0
          return (
            <button key={s.key} onClick={() => setParam('state', s.key, 'active')}
              aria-pressed={active}
              className={`shrink-0 px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                active
                  ? 'bg-indigo-600 text-white'
                  : urgent
                    ? 'bg-red-500/20 text-red-300 hover:bg-red-500/30'
                    : 'bg-gray-800 text-gray-400 hover:text-gray-200'
              }`}>
              {s.label}{loading ? '' : ` (${count})`}
            </button>
          )
        })}
      </div>

      {error && (
        <div className="bg-red-900/30 border border-red-700/50 rounded-xl px-4 py-3 text-red-300 text-sm mb-4">{error}</div>
      )}

      {/* Both print paths now carry the scope: this line is visible to a
          browser Ctrl+P of the page, and handlePrint puts the same string in
          its own header. */}
      {!loading && filtered.length > 0 && (
        <div className="flex items-baseline justify-between gap-2 mb-2">
          <p className="text-xs text-gray-400">
            {describeTodoFilter(state, search)} · {filtered.length} {filtered.length === 1 ? 'task' : 'tasks'}
          </p>
          {state === 'completed' && counts.completed > 0 && (
            <button
              onClick={() => setConfirmClear(true)}
              disabled={clearing}
              className="text-xs text-gray-400 hover:text-red-400 transition-colors no-print disabled:opacity-40"
            >
              {clearing ? 'Clearing…' : `Clear ${counts.completed} completed`}
            </button>
          )}
        </div>
      )}

      {/* List */}
      <div id="todo-list" className="space-y-2">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="card w-full flex items-stretch overflow-hidden animate-pulse">
              <div className="shrink-0 w-12 flex items-center justify-center">
                <div className="w-5 h-5 rounded-full bg-gray-700" />
              </div>
              <div className="flex-1 min-w-0 pr-4 py-3.5 space-y-2">
                <div className="h-4 bg-gray-700 rounded w-2/3" />
                <div className="h-3 bg-gray-700 rounded w-1/3" />
              </div>
            </div>
          ))
        ) : filtered.length === 0 ? (
          <EmptyState
            state={state}
            search={search}
            counts={counts}
            onAdd={openAdd}
            onClear={() => setParam('q', '', '')}
          />
        ) : (
          filtered.map(todo => (
            <TodoRow
              key={todo.id}
              todo={todo}
              onEdit={() => navigate(`/todo/${todo.id}/edit`)}
              onDelete={() => setPendingDelete(todo)}
            />
          ))
        )}
      </div>

      <ConfirmModal
        isOpen={pendingDelete !== null}
        message={pendingDelete ? `Delete "${pendingDelete.title}"? This cannot be undone.` : ''}
        onConfirm={handleDeleteOne}
        onCancel={() => setPendingDelete(null)}
      />

      <ConfirmModal
        isOpen={confirmClear}
        message={`Delete all ${counts.completed} completed task${counts.completed === 1 ? '' : 's'}? This cannot be undone.`}
        confirmLabel="Clear completed"
        onConfirm={handleClearCompleted}
        onCancel={() => setConfirmClear(false)}
      />
    </div>
  )
}

/** Empty state. The reasons a list can be empty are different situations and
 *  used to share one message: "no tasks at all" needs a way in, "nothing
 *  active but things are done" is a result worth stating, and a search that
 *  matched nothing needs its search cleared rather than a new task. */
function EmptyState({ state, search, counts, onAdd, onClear }: {
  state: TodoState
  search: string
  counts: Record<TodoState, number>
  onAdd: () => void
  onClear: () => void
}) {
  if (search.trim()) {
    return (
      <div className="card px-4 py-10 text-center">
        <p className="text-gray-100 text-sm font-medium">No tasks match “{search.trim()}”</p>
        <p className="text-gray-400 text-sm mt-1">
          {counts[state]} {state === 'all' ? '' : state} task{counts[state] === 1 ? '' : 's'} in this view.
        </p>
        <button onClick={onClear} className="btn-secondary text-sm px-4 py-2 mt-4">Clear search</button>
      </div>
    )
  }

  const neverHadAny = counts.all === 0

  const { title, detail, showAdd } =
    state === 'completed'
      ? { title: 'Nothing completed yet', detail: 'Tasks you check off will collect here.', showAdd: false }
      : state === 'overdue'
        ? { title: 'Nothing overdue', detail: `${counts.active} active task${counts.active === 1 ? '' : 's'}, none past due.`, showAdd: false }
        : state === 'today'
          ? { title: 'Nothing due today', detail: `${counts.overdue} overdue · ${counts.active} active.`, showAdd: false }
          : neverHadAny
            ? { title: 'No tasks yet', detail: 'Add your first task to get started.', showAdd: true }
            : { title: 'All caught up', detail: `Nothing active — ${counts.completed} completed.`, showAdd: true }

  return (
    <div className="card px-4 py-10 text-center">
      <p className="text-gray-100 text-sm font-medium">{title}</p>
      <p className="text-gray-400 text-sm mt-1">{detail}</p>
      {showAdd && (
        <button
          onClick={onAdd}
          className="mt-4 inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium px-4 py-2 rounded-xl transition-colors"
        >
          <span className="text-lg leading-none">+</span>
          New Task
        </button>
      )}
    </div>
  )
}

function PriorityPicker({ value, onChange }: { value: Todo['priority'], onChange: (p: Todo['priority']) => void }) {
  return (
    <div className="flex items-center gap-2 overflow-x-auto scrollbar-none">
      <span className="text-xs text-gray-400 shrink-0">Priority</span>
      <div className="flex flex-nowrap gap-2">
        {/* Unselected pills used border-gray-700, which is 1.42:1 on a card —
            three selectable controls with no visible edge. gray-500 is 3.04:1,
            clear of the 3:1 non-text floor. The dot still carries the dimming. */}
        {(['low', 'medium', 'high'] as Todo['priority'][]).map(p => (
          <button key={p} type="button" onClick={() => onChange(p)}
            aria-pressed={value === p}
            className={`shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${
              value === p ? PRIORITY_STYLES[p] : 'border-gray-500 text-gray-400'
            }`}>
            <span className={`w-2 h-2 rounded-full ${PRIORITY_DOT[p]} ${value === p ? '' : 'opacity-40'}`} />
            {priorityLabel(p)}
          </button>
        ))}
      </div>
    </div>
  )
}

function TodoRow({ todo, onEdit, onDelete }: {
  todo: Todo
  onEdit: () => void
  onDelete: () => void
}) {
  async function handleToggle() {
    await toggleTodo(todo.id, !todo.isCompleted)
  }

  const customer = customerLabel(todo)

  // Toggle, body and delete are three sibling buttons, not nested controls:
  // nesting is invalid HTML, left the toggle unreachable by keyboard, and made
  // a 20px miss navigate to another page.
  return (
    <div className="card w-full flex items-stretch overflow-hidden">
      {/* Toggle — a 48px full-height strip, so the circle can't be missed */}
      <button
        type="button"
        role="checkbox"
        aria-checked={todo.isCompleted}
        aria-label={`Mark "${todo.title}" as ${todo.isCompleted ? 'not complete' : 'complete'}`}
        onClick={handleToggle}
        className="shrink-0 w-12 flex items-center justify-center transition-colors hover:bg-gray-700/50
                   focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500"
      >
        <span
          className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${
            todo.isCompleted ? 'bg-green-600 border-green-600' : 'border-gray-400'
          }`}
        >
          {todo.isCompleted && (
            // icon-on-solid, not text-white: text-white resolves to the themed
            // --color-white, which is dark navy in light mode.
            <Icon d={ICONS.check} className="w-3 h-3 icon-on-solid" />
          )}
        </span>
      </button>

      {/* Row body — opens the editor */}
      <button
        type="button"
        onClick={onEdit}
        aria-label={`Edit "${todo.title}"`}
        className="flex-1 min-w-0 flex items-center gap-3 py-3.5 text-left transition-colors hover:bg-gray-700/50
                   focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500"
      >
        <div className="flex-1 min-w-0">
          <p className={`text-sm font-medium ${todo.isCompleted ? 'line-through text-gray-400' : 'text-gray-100'}`}>
            {todo.title}
          </p>
          {/* Clamped to three lines. A pasted paragraph made one row as tall
              as ten, pushing everything else off a page that had no search. */}
          {todo.notes && (
            <p className="text-sm text-gray-400 mt-1 line-clamp-3 whitespace-pre-line">{todo.notes}</p>
          )}

          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
            {customer && (
              <span className="text-gray-300 truncate max-w-[14rem]">{customer}</span>
            )}
            {todo.dueDate && (() => {
              const due = dueMeta(todo.dueDate, todo.isCompleted)
              return <span className={due.cls}>{due.label}</span>
            })()}
            {/* A completed task shows when it was finished — the only fact a
                completed list is for. Tasks completed before completedAt
                existed fall back to the creation date rather than lying. */}
            <span className="text-gray-400">
              {todo.isCompleted && todo.completedAt
                ? `Completed ${todo.completedAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
                : `Added ${todo.createdAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`}
            </span>
          </div>
        </div>

        {/* Priority badge — capitalised, and with the picker's dot, so it
            reads at a glance instead of being a lowercase word. */}
        <span className={`text-xs px-2 py-0.5 rounded-full border shrink-0 inline-flex items-center gap-1.5 ${PRIORITY_STYLES[todo.priority]}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${PRIORITY_DOT[todo.priority]}`} />
          {priorityLabel(todo.priority)}
        </span>
      </button>

      {/* Delete — removing a task used to mean a navigation to the editor, a
          confirm, and a navigation back, for a to-do item. */}
      <div className="shrink-0 flex items-center pr-2 pl-1 no-print">
        <button
          type="button"
          onClick={onDelete}
          aria-label={`Delete "${todo.title}"`}
          className="w-9 h-9 flex items-center justify-center rounded-lg text-gray-400 hover:text-red-400 hover:bg-gray-700 transition-colors
                     focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
        >
          <Icon d={ICONS.trash} className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}
