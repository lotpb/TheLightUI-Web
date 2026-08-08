import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { getTodo, updateTodo, deleteTodo } from '../../services/todoService'
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

export default function TodoEditPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const [title,    setTitle]    = useState('')
  const [notes,    setNotes]    = useState('')
  const [priority, setPriority] = useState<Todo['priority']>('medium')
  const [dueDate,  setDueDate]  = useState('')
  const [loading,  setLoading]  = useState(true)
  const [saving,   setSaving]   = useState(false)
  const [error,    setError]    = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    getTodo(id).then(t => {
      if (!t) { navigate('/todo', { replace: true }); return }
      setTitle(t.title)
      setNotes(t.notes)
      setPriority(t.priority)
      setDueDate(t.dueDate ? t.dueDate.toISOString().slice(0, 10) : '')
      setLoading(false)
    })
  }, [id, navigate])

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!id || !title.trim()) return
    setSaving(true)
    setError(null)
    try {
      const due = dueDate ? new Date(dueDate) : null
      await updateTodo(id, title.trim(), notes.trim(), priority, due)
      navigate('/todo')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed.')
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!id) return
    if (!window.confirm('Delete this task?')) return
    try {
      await deleteTodo(id)
      navigate('/todo')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed.')
    }
  }

  if (loading) {
    return (
      <div className="max-w-lg mx-auto px-4 py-6 animate-pulse space-y-4">
        <div className="h-6 bg-gray-700 rounded w-32" />
        <div className="card p-6 space-y-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-10 bg-gray-700 rounded" />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-lg mx-auto px-4 py-6">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate('/todo')} className="text-indigo-400 hover:text-indigo-300 text-sm">
          ← Back
        </button>
        <h1 className="text-xl font-bold text-white">Edit Task</h1>
      </div>

      <form onSubmit={handleSave} className="card p-5 space-y-4">
        {error && (
          <div className="bg-red-900/30 border border-red-700/50 rounded-lg px-3 py-2 text-red-300 text-sm">
            {error}
          </div>
        )}

        <div>
          <label className="form-label">Title</label>
          <input
            type="text"
            value={title}
            onChange={e => setTitle(e.target.value)}
            className="input-field"
            autoFocus
            required
          />
        </div>

        <div>
          <label className="form-label">Notes</label>
          <input
            type="text"
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Optional notes…"
            className="input-field" style={{fontSize: '20px'}}
          />
        </div>

        <div>
          <label className="form-label">Due Date</label>
          <input
            type="date"
            value={dueDate}
            onChange={e => setDueDate(e.target.value)}
            className="input-field"
          />
        </div>

        <div>
          <label className="form-label">Priority</label>
          <div className="flex gap-2 mt-1">
            {(['low', 'medium', 'high'] as Todo['priority'][]).map(p => (
              <button key={p} type="button" onClick={() => setPriority(p)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                  priority === p ? PRIORITY_STYLES[p] : 'border-gray-700 text-gray-500 opacity-60'
                }`}>
                <span className={`w-2 h-2 rounded-full ${PRIORITY_DOT[p]}`} />
                {p.charAt(0).toUpperCase() + p.slice(1)}
              </button>
            ))}
          </div>
        </div>

        <div className="flex gap-3 pt-2">
          <button type="button" onClick={() => navigate('/todo')} className="btn-secondary flex-1">
            Cancel
          </button>
          <button type="submit" disabled={saving || !title.trim()} className="btn-primary flex-1">
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>

      <button
        type="button"
        onClick={handleDelete}
        className="mt-4 w-full btn-danger py-2.5 text-sm font-medium"
      >
        Delete Task
      </button>
    </div>
  )
}
