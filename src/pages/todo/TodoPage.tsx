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

export default function TodoPage() {
  usePageTitle('To-Do')
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

  function handlePrint() {
    const printTodos = filter === 'all' ? todos : filtered
    const dateStr = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    const rows = printTodos.map(t => {
      const due = t.dueDate
        ? t.dueDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
        : ''
      const created = t.createdAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      const priorityColor = t.priority === 'high' ? '#dc2626' : t.priority === 'medium' ? '#d97706' : '#6b7280'
      return `
        <tr style="border-bottom:1px solid #e5e7eb;">
          <td style="padding:10px 8px;vertical-align:top;">
            <span style="display:inline-block;width:14px;height:14px;border-radius:50%;border:2px solid #9ca3af;margin-right:8px;vertical-align:middle;${t.isCompleted ? 'background:#16a34a;border-color:#16a34a;' : ''}"></span>
            <span style="font-size:14px;font-weight:500;${t.isCompleted ? 'text-decoration:line-through;color:#6b7280;' : 'color:#111;'}">${t.title}</span>
            ${t.notes ? `<div style="font-size:12px;color:#6b7280;margin-left:22px;margin-top:2px;">${t.notes}</div>` : ''}
          </td>
          <td style="padding:10px 8px;font-size:12px;color:${priorityColor};text-transform:capitalize;white-space:nowrap;vertical-align:top;">${t.priority}</td>
          <td style="padding:10px 8px;font-size:12px;color:#6b7280;white-space:nowrap;vertical-align:top;">${due || '—'}</td>
          <td style="padding:10px 8px;font-size:12px;color:#9ca3af;white-space:nowrap;vertical-align:top;">${created}</td>
        </tr>`
    }).join('')

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>To-Do List</title>
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
  <h1>To-Do List</h1>
  <p class="sub">Printed ${dateStr} · ${printTodos.length} item${printTodos.length !== 1 ? 's' : ''}</p>
  <table>
    <thead>
      <tr>
        <th>Task</th>
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
        <h1 className="text-2xl font-bold text-white">To-Do</h1>
        <div className="flex items-center gap-2 no-print">
          <button
            onClick={openAdd}
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium px-4 py-2 rounded-xl transition-colors"
          >
            <span className="text-lg leading-none">+</span>
            New
          </button>
          <button
            onClick={handlePrint}
            className="flex items-center gap-1.5 bg-gray-700 hover:bg-gray-600 text-gray-200 text-sm font-medium px-4 py-2 rounded-xl transition-colors"
          >
            🖨 Print
          </button>
        </div>
      </div>

      {/* Add form */}
      {showAdd && (
        <form onSubmit={handleAdd} className="card p-4 mb-4 space-y-3 no-print">
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm font-semibold text-white">New Task</span>
            <button type="button" onClick={closeAdd} className="text-gray-500 hover:text-gray-300 text-lg leading-none px-1">✕</button>
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

      {/* Filter tabs */}
      <div className="flex flex-nowrap gap-2 mb-4 no-print overflow-x-auto scrollbar-none">
        {(['active', 'all', 'completed'] as Filter[]).map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`shrink-0 px-3 py-1 rounded-full text-xs font-medium capitalize transition-colors ${
              filter === f ? 'bg-indigo-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-gray-200'
            }`}>
            {f}
          </button>
        ))}
      </div>

      {error && (
        <div className="bg-red-900/30 border border-red-700/50 rounded-xl px-4 py-3 text-red-300 text-sm mb-4">{error}</div>
      )}

      {/* List */}
      <div className="print-only-title hidden">
        <h2 className="text-xl font-bold text-black mb-4">To-Do List</h2>
      </div>
      <div id="todo-list" className="space-y-2">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="card px-4 py-3.5 animate-pulse flex gap-3 items-center">
              <div className="w-5 h-5 rounded-full bg-gray-700 shrink-0" />
              <div className="h-3.5 bg-gray-700 rounded flex-1" />
            </div>
          ))
        ) : filtered.length === 0 ? (
          <div className="card px-4 py-10 text-center">
            <p className="text-gray-400 text-sm">
              {filter === 'completed' ? 'No completed tasks' : 'No tasks yet — tap New to add one'}
            </p>
          </div>
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

function PriorityPicker({ value, onChange }: { value: Todo['priority'], onChange: (p: Todo['priority']) => void }) {
  return (
    <div className="flex items-center gap-2 overflow-x-auto scrollbar-none">
      <span className="text-xs text-gray-400 shrink-0">Priority</span>
      <div className="flex flex-nowrap gap-2">
        {(['low', 'medium', 'high'] as Todo['priority'][]).map(p => (
          <button key={p} type="button" onClick={() => onChange(p)}
            className={`shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${
              value === p ? PRIORITY_STYLES[p] : 'border-gray-700 text-gray-500 opacity-60'
            }`}>
            <span className={`w-2 h-2 rounded-full ${PRIORITY_DOT[p]}`} />
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
  async function handleToggle(e: React.MouseEvent) {
    e.stopPropagation()
    await toggleTodo(todo.id, !todo.isCompleted)
  }

  return (
    <button
      type="button"
      onClick={onEdit}
      className="card w-full px-4 py-3.5 flex items-center gap-3 text-left transition-all hover:bg-gray-700/50"
    >
      {/* Checkbox */}
      <span
        role="checkbox"
        aria-checked={todo.isCompleted}
        onClick={handleToggle}
        className="w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-all"
        style={todo.isCompleted
          ? { backgroundImage: 'linear-gradient(135deg, #34d399, #059669)', borderColor: '#059669' }
          : todo.priority === 'high'
            ? { borderColor: '#f87171' }
            : todo.priority === 'medium'
              ? { borderColor: '#fbbf24' }
              : { borderColor: '#9ca3af' }}
      >
        {todo.isCompleted && (
          <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        )}
      </span>

      {/* Title + Notes + Due Date */}
      <div className="flex-1 min-w-0">
        <p className={`text-sm ${todo.isCompleted ? 'line-through text-gray-500' : 'text-gray-100'}`}>
          {todo.title}
        </p>
        {todo.notes && (
          <p className="text-sm text-gray-400 mt-1">{todo.notes}</p>
        )}
        {todo.dueDate && (
          <p className="text-xs text-indigo-400 mt-0.5">
            Due {todo.dueDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
          </p>
        )}
      </div>

      {/* Priority badge + timestamp */}
      <div className="flex flex-col items-end gap-1 shrink-0">
        <span className={`text-xs px-2 py-0.5 rounded-full border ${PRIORITY_STYLES[todo.priority]}`}>
          {todo.priority}
        </span>
        <span className="text-xs text-gray-400 leading-none">
          {todo.createdAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
        </span>
      </div>
    </button>
  )
}
