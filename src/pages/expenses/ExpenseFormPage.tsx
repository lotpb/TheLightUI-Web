import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { createExpense, updateExpense, getExpense, deleteExpense } from '../../services/expenseService'
import { EXPENSE_CATEGORIES, type Expense } from '../../models/expense'
import { useAuthStore } from '../../stores/authStore'
import ConfirmModal from '../../components/ConfirmModal'
import { useNavBack } from '../../hooks/useNavBack'
import { usePageTitle } from '../../hooks/usePageTitle'
import { useUnsavedChanges } from '../../hooks/useUnsavedChanges'
import { validateExpenseForm } from '../../validation/expenseFormSchema'

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
  usePageTitle(isNew ? 'New Expense' : 'Edit Expense')
  const navigate = useNavigate()
  const navBack  = useNavBack('/expenses')
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
  const [fieldErrors,   setFieldErrors]   = useState<{ title?: string; amount?: string }>({})
  const [touched,       setTouched]       = useState(false)
  const [confirmOpen,   setConfirmOpen]   = useState(false)
  const blocker = useUnsavedChanges(touched && !saving)

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
    setConfirmOpen(false)
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
    const fe = validateExpenseForm({ title, amount: amtNum })
    if (Object.keys(fe).length > 0) { setFieldErrors(fe); return }

    setSaving(true)
    setError(null)
    setFieldErrors({})
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
        <button onClick={navBack} className="text-indigo-400 hover:text-indigo-300 text-sm">
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
            onChange={e => { setTouched(true); setTitle(e.target.value); if (fieldErrors.title) setFieldErrors(p => ({ ...p, title: undefined })) }}
            placeholder="What was this expense for?"
            className={`input-field w-full ${fieldErrors.title ? 'border-red-500 focus:ring-red-500/50' : ''}`}
            autoFocus
          />
          {fieldErrors.title && <p className="text-red-400 text-xs mt-1">{fieldErrors.title}</p>}
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
              onChange={e => { setTouched(true); setAmount(e.target.value); if (fieldErrors.amount) setFieldErrors(p => ({ ...p, amount: undefined })) }}
              placeholder="0.00"
              className={`input-field w-full pl-7 ${fieldErrors.amount ? 'border-red-500 focus:ring-red-500/50' : ''}`}
            />
          </div>
          {fieldErrors.amount && <p className="text-red-400 text-xs mt-1">{fieldErrors.amount}</p>}
        </div>

        <div>
          <label className="form-label">Category</label>
          <select
            value={category}
            onChange={e => { setTouched(true); setCategory(e.target.value) }}
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
            onChange={e => { setTouched(true); setDate(e.target.value) }}
            className="input-field w-full"
          />
        </div>

        <div>
          <label className="form-label">Notes</label>
          <textarea
            value={notes}
            onChange={e => { setTouched(true); setNotes(e.target.value) }}
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
            onClick={() => { setTouched(true); setIsReimbursable(v => !v) }}
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
            onClick={navBack}
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
          onClick={() => setConfirmOpen(true)}
          className="mt-4 w-full py-2.5 text-sm font-medium rounded-xl bg-red-900/30 border border-red-700/40 text-red-400 hover:bg-red-900/50 hover:text-red-300 transition-colors"
        >
          Delete Expense
        </button>
      )}

      <ConfirmModal
        isOpen={confirmOpen}
        message="Delete this expense? This cannot be undone."
        onConfirm={handleDelete}
        onCancel={() => setConfirmOpen(false)}
      />
      <ConfirmModal
        isOpen={blocker.state === 'blocked'}
        message="You have unsaved changes. Leave anyway?"
        confirmLabel="Leave"
        onConfirm={() => blocker.proceed?.()}
        onCancel={() => blocker.reset?.()}
      />
    </div>
  )
}
