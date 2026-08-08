import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { createExpense, updateExpense, getExpense, deleteExpense } from '../../services/expenseService'
import { EXPENSE_CATEGORIES, type Expense } from '../../models/expense'
import { useAuthStore } from '../../stores/authStore'

function toInputDate(d: Date): string {
  if (!d || isNaN(d.getTime())) return ''
  return d.toISOString().slice(0, 10)
}

function fromInputDate(s: string): Date {
  if (!s) return new Date()
  const d = new Date(s + 'T12:00:00')
  return isNaN(d.getTime()) ? new Date() : d
}

export default function ExpenseFormPage() {
  const { id } = useParams<{ id: string }>()
  const isNew  = !id || id === 'new'
  const navigate = useNavigate()
  const user    = useAuthStore(s => s.user)
  const isReady = useAuthStore(s => s.isReady)

  const [title,         setTitle]         = useState('')
  const [amount,        setAmount]        = useState('')
  const [category,      setCategory]      = useState<string>('Other')
  const [date,          setDate]          = useState(toInputDate(new Date()))
  const [notes,         setNotes]         = useState('')
  const [isReimbursable, setIsReimbursable] = useState(false)
  const [loading,       setLoading]       = useState(!isNew)
  const [saving,        setSaving]        = useState(false)
  const [error,         setError]         = useState<string | null>(null)

  useEffect(() => {
    if (isNew || !id) return
    getExpense(id)
      .then(e => {
        if (!e) { navigate('/expenses', { replace: true }); return }
        setTitle(e.title)
        setAmount(String(e.amount))
        setCategory(e.category)
        setDate(toInputDate(e.date))
        setNotes(e.notes)
        setIsReimbursable(e.isReimbursable)
        setLoading(false)
      })
      .catch(err => {
        setError(err instanceof Error ? err.message : 'Failed to load expense.')
        setLoading(false)
      })
  }, [id, isNew, navigate])

  async function handleDelete() {
    if (!id || isNew) return
    if (!window.confirm('Delete this expense?')) return
    try {
      await deleteExpense(id)
      navigate('/expenses')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed.')
    }
  }

  async function handleSubmit(ev: React.FormEvent) {
    ev.preventDefault()
    if (!user || !isReady) return
    const amtNum = parseFloat(amount)
    if (!title.trim())    { setError('Title is required.');        return }
    if (isNaN(amtNum) || amtNum <= 0) { setError('Enter a valid amount.'); return }

    setSaving(true)
    setError(null)
    try {
      const payload: Omit<Expense, 'id'> = {
        title:          title.trim(),
        amount:         amtNum,
        category,
        date:           fromInputDate(date),
        notes:          notes.trim(),
        isReimbursable,
        lastUpdate:     new Date(),
      }
      if (isNew) {
        await createExpense(payload)
      } else {
        await updateExpense(id!, payload)
      }
      navigate('/expenses')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed.')
      setSaving(false)
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
        <button onClick={() => navigate(-1)} className="text-indigo-400 hover:text-indigo-300 text-sm">
          ← Back
        </button>
        <h1 className="text-xl font-bold text-white">
          {isNew ? 'New Expense' : 'Edit Expense'}
        </h1>
      </div>

      <form onSubmit={handleSubmit} className="card p-5 space-y-4">
        {error && (
          <div className="bg-red-900/30 border border-red-700/50 rounded-lg px-3 py-2 text-red-300 text-sm">
            {error}
          </div>
        )}

        <div>
          <label className="form-label">Title *</label>
          <input
            type="text"
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="What was this expense for?"
            className="input-field w-full"
            autoFocus
          />
        </div>

        <div>
          <label className="form-label">Amount *</label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">$</span>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              placeholder="0.00"
              className="input-field w-full pl-7"
            />
          </div>
        </div>

        <div>
          <label className="form-label">Category</label>
          <select
            value={category}
            onChange={e => setCategory(e.target.value)}
            className="select-field w-full"
          >
            {EXPENSE_CATEGORIES.map(c => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="form-label">Date</label>
          <input
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            className="input-field w-full"
          />
        </div>

        <div>
          <label className="form-label">Notes</label>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Optional notes…"
            rows={3}
            className="input-field w-full resize-none"
          />
        </div>

        <div className="flex items-center justify-between py-1">
          <div>
            <p className="text-sm text-gray-200">Reimbursable</p>
            <p className="text-xs text-gray-500">Mark if this expense will be reimbursed</p>
          </div>
          <button
            type="button"
            onClick={() => setIsReimbursable(v => !v)}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
              isReimbursable ? 'bg-indigo-600' : 'bg-gray-600'
            }`}
          >
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
              isReimbursable ? 'translate-x-6' : 'translate-x-1'
            }`} />
          </button>
        </div>

        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="btn-secondary flex-1"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="btn-primary flex-1"
          >
            {saving ? 'Saving…' : isNew ? 'Add Expense' : 'Save Changes'}
          </button>
        </div>
      </form>

      {!isNew && (
        <button
          type="button"
          onClick={handleDelete}
          className="mt-4 w-full py-2.5 text-sm font-medium rounded-xl bg-red-900/30 border border-red-700/40 text-red-400 hover:bg-red-900/50 hover:text-red-300 transition-colors"
        >
          Delete Expense
        </button>
      )}
    </div>
  )
}
