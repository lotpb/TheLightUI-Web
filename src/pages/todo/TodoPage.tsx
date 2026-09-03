import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { usePageTitle } from '../../hooks/usePageTitle'
import { subscribeToTodos, addTodo, toggleTodo } from '../../services/todoService'
import { useAuthStore } from '../../stores/authStore'
import type { Todo } from '../../models/todo'

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

type Filter = 'all' | 'active' | 'completed'

type DueStatus = 'overdue' | 'today' | 'tomorrow' | 'later' | 'done'

/** Whole-day index for a date, read in UTC. Due dates are day-granular: every
 *  write path lands them on UTC midnight (`new Date('2026-09-12')` from the
 *  date input, `safeDate` in the CSV import), so the day the user picked only
 *  survives if it's read back in UTC. A bare toLocaleDateString() renders the
 *  day before for anyone west of UTC. */
function dayIndexUTC(d: Date) {
  return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 86400000)
}

/** Today as the same kind of index, from the viewer's local calendar day. */
function todayIndexLocal() {
  const now = new Date()
  return Math.floor(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / 86400000)
}

function fmtDue(d: Date) {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

/** The customer a task belongs to, or null when there isn't one to show.
 *  Tasks created from a record page before the customerName argument was fixed
 *  stored the task's own title in that field; suppress those rather than print
 *  the title twice, since a real customer name matching the title is
 *  implausible. */
function customerLabel(t: Todo): string | null {
  return t.customerName && t.customerName !== t.title ? t.customerName : null
}

/** The print popup interpolates task-authored strings straight into markup. */
function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Due-date urgency, following the /serviceplans treatment: red + medium weight
 *  once late, amber inside the next day, plain gray beyond that. A completed
 *  task is never urgent no matter how late it was. */
function dueMeta(due: Date, isCompleted: boolean): { status: DueStatus, label: string, cls: string } {
  if (isCompleted) return { status: 'done', label: `Due ${fmtDue(due)}`, cls: 'text-gray-400' }

  const days = dayIndexUTC(due) - todayIndexLocal()
  if (days < 0) {
    const late = -days
    return {
      status: 'overdue',
      label: `Due ${fmtDue(due)} · ${late} day${late === 1 ? '' : 's'} overdue`,
      cls: 'text-red-400 font-medium',
    }
  }
  if (days === 0) return { status: 'today',    label: 'Due today',    cls: 'text-amber-400 font-medium' }
  if (days === 1) return { status: 'tomorrow', label: 'Due tomorrow', cls: 'text-amber-400' }
  return { status: 'later', label: `Due ${fmtDue(due)}`, cls: 'text-gray-400' }
}

export default function TodoPage() {
  usePageTitle('Tasks')
  const navigate   = useNavigate()
  const user       = useAuthStore(s => s.user)
  const companyId  = useAuthStore(s => s.companyId)
  const [todos, setTodos]     = useState<Todo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)
  const [filter, setFilter]   = useState<Filter>('active')
  const [showAdd, setShowAdd] = useState(false)

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
      items => { setTodos(items); setLoading(false) },
      err   => { setError(err.message); setLoading(false) },
    )
    return unsub
  }, [user, companyId])

  function openAdd() {
    setShowAdd(true)
    setTimeout(() => addInputRef.current?.focus(), 50)
  }

  function closeAdd() {
    setShowAdd(false)
    setAddTitle(''); setAddNotes(''); setAddPriority('medium'); setAddDueDate('')
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!addTitle.trim() || !user) return
    setAdding(true)
    const due = addDueDate ? new Date(addDueDate) : null
    await addTodo(user.uid, addTitle.trim(), addPriority, addNotes.trim(), due)
    setAdding(false)
    closeAdd()
  }

  const filtered = todos.filter(t =>
    filter === 'all'       ? true :
    filter === 'active'    ? !t.isCompleted :
    t.isCompleted
  )

  const counts: Record<Filter, number> = {
    all:       todos.length,
    active:    todos.filter(t => !t.isCompleted).length,
    completed: todos.filter(t => t.isCompleted).length,
  }

  function handlePrint() {
    const printTodos = filter === 'all' ? todos : filtered
    const dateStr = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    const rows = printTodos.map(t => {
      // Keep the printed column a date column, but carry the same urgency the
      // screen shows so a printed list is still triageable.
      const dueStatus = t.dueDate ? dueMeta(t.dueDate, t.isCompleted).status : 'later'
      const due = t.dueDate
        ? fmtDue(t.dueDate) + (dueStatus === 'overdue' ? ' (overdue)' : dueStatus === 'today' ? ' (today)' : '')
        : ''
      const dueColor = dueStatus === 'overdue' ? '#dc2626' : dueStatus === 'today' ? '#b45309' : '#6b7280'
      const created = t.createdAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      const priorityColor = t.priority === 'high' ? '#dc2626' : t.priority === 'medium' ? '#d97706' : '#6b7280'
      const customer = customerLabel(t)
      return `
        <tr style="border-bottom:1px solid #e5e7eb;">
          <td style="padding:10px 8px;vertical-align:top;">
            <span style="display:inline-block;width:14px;height:14px;border-radius:50%;border:2px solid #9ca3af;margin-right:8px;vertical-align:middle;${t.isCompleted ? 'background:#16a34a;border-color:#16a34a;' : ''}"></span>
            <span style="font-size:14px;font-weight:500;${t.isCompleted ? 'text-decoration:line-through;color:#6b7280;' : 'color:#111;'}">${escapeHtml(t.title)}</span>
            ${t.notes ? `<div style="font-size:12px;color:#6b7280;margin-left:22px;margin-top:2px;">${escapeHtml(t.notes)}</div>` : ''}
          </td>
          <td style="padding:10px 8px;font-size:12px;color:#374151;vertical-align:top;">${customer ? escapeHtml(customer) : '—'}</td>
          <td style="padding:10px 8px;font-size:12px;color:${priorityColor};text-transform:capitalize;white-space:nowrap;vertical-align:top;">${t.priority}</td>
          <td style="padding:10px 8px;font-size:12px;color:${dueColor};white-space:nowrap;vertical-align:top;${dueStatus === 'overdue' ? 'font-weight:500;' : ''}">${due || '—'}</td>
          <td style="padding:10px 8px;font-size:12px;color:#9ca3af;white-space:nowrap;vertical-align:top;">${created}</td>
        </tr>`
    }).join('')

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>Tasks</title>
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
  <h1>Tasks</h1>
  <p class="sub">Printed ${dateStr} · ${printTodos.length} item${printTodos.length !== 1 ? 's' : ''}</p>
  <table>
    <thead>
      <tr>
        <th>Task</th>
        <th>Customer</th>
        <th>Priority</th>
        <th>Due Date</th>
        <th>Created</th>
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
    <div className="max-w-2xl mx-auto px-4 py-6">

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
              to the app's quiet toolbar-button treatment (bg-gray-800 + border,
              as used by the /customers filter and view toggles). The old style
              was a one-off: the only bg-gray-700 rounded-xl button in the app,
              duplicating .btn-secondary's colours at a different radius. */}
          <button
            onClick={handlePrint}
            className="flex items-center gap-1.5 bg-gray-800 border border-gray-700 text-gray-400 hover:text-gray-200 text-sm font-medium px-3 py-2 rounded-xl transition-colors"
          >
            {/* SVG, not 🖨: emoji render from Apple Color Emoji, which paints
                its own colour and ignores the button's — the same trap the
                .icon-star comment in index.css documents. stroke=currentColor
                means this follows the hover state. */}
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6.72 13.829c-.24.03-.48.062-.72.096m.72-.096a42.415 42.415 0 0 1 10.56 0m-10.56 0L6.34 18m10.94-4.171c.24.03.48.062.72.096m-.72-.096L17.66 18m0 0 .229 2.523a1.125 1.125 0 0 1-1.12 1.227H7.231c-.662 0-1.18-.568-1.12-1.227L6.34 18m11.318 0h1.091A2.25 2.25 0 0 0 21 15.75V9.456c0-1.081-.768-2.015-1.837-2.175a48.055 48.055 0 0 0-1.913-.247M6.34 18H5.25A2.25 2.25 0 0 1 3 15.75V9.456c0-1.081.768-2.015 1.837-2.175a48.041 48.041 0 0 1 1.913-.247m10.5 0a48.536 48.536 0 0 0-10.5 0m10.5 0V3.375c0-.621-.504-1.125-1.125-1.125h-8.25c-.621 0-1.125.504-1.125 1.125v3.659M18 10.5h.008v.008H18V10.5Zm-3 0h.008v.008H15V10.5Z" />
            </svg>
            Print
          </button>
        </div>
      </div>

      {/* Add form */}
      {showAdd && (
        <form onSubmit={handleAdd} className="card p-4 mb-4 space-y-3 no-print">
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm font-semibold text-white">New Task</span>
            {/* Matches the close button in CSVImportModal / Toast / RemindersPanel:
                SVG rather than a ✕ glyph, and p-1.5 + hover surface so it's a
                real target instead of a bare character with px-1. */}
            <button
              type="button"
              onClick={closeAdd}
              aria-label="Cancel new task"
              className="text-gray-400 hover:text-gray-200 hover:bg-gray-700 transition-colors p-1.5 rounded-lg"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div>
            <label className="form-label">Title</label>
            <input ref={addInputRef} type="text" className="input-field" placeholder="What needs to be done?"
              value={addTitle} onChange={e => setAddTitle(e.target.value)} autoComplete="off" required />
          </div>
          <div>
            <label className="form-label">Notes</label>
            <input type="text" className="input-field" placeholder="Add a note… (optional)"
              value={addNotes} onChange={e => setAddNotes(e.target.value)} autoComplete="off" />
          </div>
          <div>
            <label className="form-label">Due Date</label>
            <input type="date" className="input-field"
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

      {/* Filter tabs. Counts follow the /serviceplans pill pattern — without
          them there's no way to tell how many completed tasks exist without
          switching filters. Suppressed while loading, when every count is 0. */}
      <div className="flex flex-nowrap gap-2 mb-4 no-print overflow-x-auto scrollbar-none">
        {(['active', 'all', 'completed'] as Filter[]).map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`shrink-0 px-3 py-1 rounded-full text-xs font-medium capitalize transition-colors ${
              filter === f ? 'bg-indigo-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-gray-200'
            }`}>
            {f}{loading ? '' : ` (${counts[f]})`}
          </button>
        ))}
      </div>

      {error && (
        <div className="bg-red-900/30 border border-red-700/50 rounded-xl px-4 py-3 text-red-300 text-sm mb-4">{error}</div>
      )}

      {/* List. No print-only duplicate of the heading here: the h1 above now
          prints dark instead of white-on-white, so one title is enough. */}
      <div id="todo-list" className="space-y-2">
        {loading ? (
          // Mirrors TodoRow's structure — w-12 toggle strip, pr-4 py-3.5 body,
          // two text lines — so the list doesn't jump when real rows land. The
          // old single-bar skeleton was ~26px shorter than a real row.
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
          <EmptyState filter={filter} counts={counts} onAdd={openAdd} />
        ) : (
          filtered.map(todo => (
            <TodoRow
              key={todo.id}
              todo={todo}
              onEdit={() => navigate(`/todo/${todo.id}/edit`)}
            />
          ))
        )}
      </div>
    </div>
  )
}

/** Empty state. The three reasons a list can be empty are different situations
 *  and used to share one message: "no tasks at all" needs a way in, "nothing
 *  active but things are done" is a result worth stating, and "no completed
 *  tasks" is neither. The call to action is a real button rather than copy
 *  telling the user to "tap New" — which was also mobile wording on a desktop
 *  web app. */
function EmptyState({ filter, counts, onAdd }: {
  filter: Filter
  counts: Record<Filter, number>
  onAdd: () => void
}) {
  const neverHadAny = counts.all === 0

  const { title, detail, showAdd } =
    filter === 'completed'
      ? { title: 'Nothing completed yet', detail: 'Tasks you check off will collect here.', showAdd: false }
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
        {/* Unselected pills used text-gray-500 under opacity-60, which composites
            to ~2.0:1 on a card — the labels were near-invisible while the dots
            stayed fully saturated. The dot carries the dimming now; the label
            stays legible at gray-400. */}
        {(['low', 'medium', 'high'] as Todo['priority'][]).map(p => (
          <button key={p} type="button" onClick={() => onChange(p)}
            className={`shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${
              value === p ? PRIORITY_STYLES[p] : 'border-gray-700 text-gray-400'
            }`}>
            <span className={`w-2 h-2 rounded-full ${PRIORITY_DOT[p]} ${value === p ? '' : 'opacity-40'}`} />
            {p.charAt(0).toUpperCase() + p.slice(1)}
          </button>
        ))}
      </div>
    </div>
  )
}

function TodoRow({ todo, onEdit }: {
  todo: Todo
  onEdit: () => void
}) {
  async function handleToggle() {
    await toggleTodo(todo.id, !todo.isCompleted)
  }

  const customer = customerLabel(todo)

  // Toggle and "open the editor" are two sibling buttons, not a checkbox nested
  // inside a row-sized button: nesting is invalid HTML, left the toggle
  // unreachable by keyboard, and made a 20px miss navigate to another page.
  // overflow-hidden keeps each child's hover fill and inset focus ring inside
  // the card's rounded corners.
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
        {/* Neutral ring when empty: indigo is the app's "primary action /
            current selection / focus" accent, so an indigo ring made an
            unchecked task look selected. Flat green when done — bg-green-600
            is the system's solid green, and dropping the inline hex puts both
            states back under the theme layer. gray-400 rather than gray-500:
            5.8:1 on the card vs 3.0:1, so the ring is comfortably clear of the
            3:1 non-text floor and easier to aim at. */}
        <span
          className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${
            todo.isCompleted ? 'bg-green-600 border-green-600' : 'border-gray-400'
          }`}
        >
          {todo.isCompleted && (
            // icon-on-solid, not text-white: text-white resolves to the themed
            // --color-white, which is dark navy in light mode.
            <svg className="w-3 h-3 icon-on-solid" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          )}
        </span>
      </button>

      {/* Row body — opens the editor */}
      <button
        type="button"
        onClick={onEdit}
        aria-label={`Edit "${todo.title}"`}
        className="flex-1 min-w-0 flex items-center gap-3 pr-4 py-3.5 text-left transition-colors hover:bg-gray-700/50
                   focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500"
      >
        {/* Title + Notes + meta */}
        <div className="flex-1 min-w-0">
          {/* Completed titles read as done via the strikethrough; text-gray-500
              on a gray-800 card is only 3.0:1, so the dimming comes from
              gray-400 (5.8:1) instead. Matches the linked-task rows on the
              record page. */}
          {/* font-medium: the title and its notes were both text-sm regular,
              so the row's primary content was styled exactly like its
              subtitle. Weight carries the hierarchy; the notes keep their
              size and stay muted. */}
          <p className={`text-sm font-medium ${todo.isCompleted ? 'line-through text-gray-400' : 'text-gray-100'}`}>
            {todo.title}
          </p>
          {todo.notes && (
            <p className="text-sm text-gray-400 mt-1">{todo.notes}</p>
          )}

          {/* Meta row, in the /serviceplans style: the customer this task
              belongs to leads, urgency follows, and "Added" trails — createdAt
              used to hold the second-most prominent slot in the row while the
              customer wasn't shown at all. Plain text, not a Link: the row
              body is itself a button, and nesting an anchor in it is the
              invalid markup the toggle was just moved out of. */}
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
            {customer && (
              <span className="text-gray-300 truncate max-w-[14rem]">{customer}</span>
            )}
            {todo.dueDate && (() => {
              const due = dueMeta(todo.dueDate, todo.isCompleted)
              return <span className={due.cls}>{due.label}</span>
            })()}
            <span className="text-gray-400">
              Added {todo.createdAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            </span>
          </div>
        </div>

        {/* Priority badge */}
        <span className={`text-xs px-2 py-0.5 rounded-full border shrink-0 ${PRIORITY_STYLES[todo.priority]}`}>
          {todo.priority}
        </span>
      </button>
    </div>
  )
}
