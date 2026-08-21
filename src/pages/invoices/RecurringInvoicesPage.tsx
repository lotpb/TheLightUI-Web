import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  subscribeToInvoices, generateNextInvoice, updateInvoice,
} from '../../services/invoiceService'
import {
  invoiceTotal, fmtCurrency,
  type Invoice, type RecurringInterval,
} from '../../models/invoice'
import { useToast } from '../../components/Toast'
import { usePageTitle } from '../../hooks/usePageTitle'

const INTERVAL_LABELS: Record<RecurringInterval, string> = {
  monthly:   'Monthly',
  quarterly: 'Quarterly',
  yearly:    'Yearly',
}

const INTERVAL_COLORS: Record<RecurringInterval, string> = {
  monthly:   'bg-blue-500/15 text-blue-300',
  quarterly: 'bg-violet-500/15 text-violet-300',
  yearly:    'bg-teal-500/15 text-teal-300',
}

function isDue(inv: Invoice): boolean {
  if (!inv.nextRecurDate) return true
  const today = new Date(); today.setHours(23, 59, 59, 999)
  return inv.nextRecurDate <= today
}

function fmtDate(d: Date | null | undefined): string {
  if (!d) return '—'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function RecurringInvoicesPage() {
  usePageTitle('Recurring Invoices')
  const toast    = useToast()
  const navigate = useNavigate()

  const [invoices,    setInvoices]    = useState<Invoice[]>([])
  const [loading,     setLoading]     = useState(true)
  const [generating,  setGenerating]  = useState<string | null>(null)
  const [pausing,     setPausing]     = useState<string | null>(null)

  useEffect(() => {
    return subscribeToInvoices(
      all => { setInvoices(all); setLoading(false) },
      ()  => setLoading(false),
    )
  }, [])

  const recurring = useMemo(() => {
    const list = invoices.filter(inv => !!inv.recurring)
    return list.sort((a, b) => {
      const aDue = isDue(a) ? 0 : 1
      const bDue = isDue(b) ? 0 : 1
      if (aDue !== bDue) return aDue - bDue
      const aT = a.nextRecurDate?.getTime() ?? 0
      const bT = b.nextRecurDate?.getTime() ?? 0
      return aT - bT
    })
  }, [invoices])

  const dueCount = useMemo(() => recurring.filter(isDue).length, [recurring])

  async function handleGenerate(inv: Invoice) {
    setGenerating(inv.id)
    try {
      const newId = await generateNextInvoice(inv)
      toast(`Invoice generated — opening`, 'success')
      navigate(`/invoices/${newId}`)
    } catch {
      toast('Failed to generate invoice', 'error')
      setGenerating(null)
    }
  }

  async function handlePause(inv: Invoice) {
    setPausing(inv.id)
    try {
      await updateInvoice(inv.id, { recurring: null, nextRecurDate: null })
      toast('Recurring schedule paused', 'success')
    } catch {
      toast('Failed to pause schedule', 'error')
    } finally {
      setPausing(null)
    }
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Recurring Invoices</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {dueCount > 0
              ? `${dueCount} invoice${dueCount !== 1 ? 's' : ''} ready to generate`
              : 'Auto-generate invoices on a set schedule'}
          </p>
        </div>
        <Link to="/invoices/new" className="btn-primary text-sm px-4 py-2">
          + New Invoice
        </Link>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="card p-4 animate-pulse">
              <div className="h-4 bg-gray-700 rounded w-40 mb-2" />
              <div className="h-3 bg-gray-700/60 rounded w-64" />
            </div>
          ))}
        </div>
      ) : recurring.length === 0 ? (
        <div className="card p-12 text-center">
          <p className="text-4xl mb-3">↻</p>
          <p className="text-gray-300 font-medium mb-1">No recurring invoices yet</p>
          <p className="text-sm text-gray-500 mb-4">
            Open any invoice, click Edit, and toggle "Recurring Invoice" to set a schedule.
          </p>
          <Link to="/invoices" className="btn-secondary text-sm px-4 py-2">
            View All Invoices
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {recurring.map(inv => {
            const due      = isDue(inv)
            const total    = invoiceTotal(inv)
            const interval = inv.recurring!

            return (
              <div
                key={inv.id}
                className={`card p-4 border ${due ? 'border-orange-500/30 bg-orange-500/5' : 'border-gray-700/50'}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">

                    {/* Title row */}
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="font-semibold text-white">{inv.customerName}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${INTERVAL_COLORS[interval]}`}>
                        {INTERVAL_LABELS[interval]}
                      </span>
                      {due && (
                        <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-orange-500/15 text-orange-300">
                          Due Now
                        </span>
                      )}
                    </div>

                    {/* Amount + invoice number */}
                    <div className="flex items-center gap-3 mb-2">
                      <span className="text-lg font-bold text-white">{fmtCurrency(total)}</span>
                      <span className="text-xs text-gray-500 font-mono">{inv.invoiceNumber}</span>
                    </div>

                    {/* Dates */}
                    <div className="flex flex-wrap gap-x-5 gap-y-0.5 text-xs text-gray-500">
                      <span>
                        Next: <span className={`font-medium ${due ? 'text-orange-300' : 'text-gray-300'}`}>
                          {fmtDate(inv.nextRecurDate)}
                        </span>
                      </span>
                      <span>
                        Last generated: <span className="text-gray-400">{fmtDate(inv.lastGeneratedAt)}</span>
                      </span>
                    </div>

                    {/* Line items preview */}
                    {inv.lineItems.length > 0 && (
                      <p className="text-xs text-gray-600 mt-1.5 line-clamp-1">
                        {inv.lineItems.map(l => l.description).filter(Boolean).join(' · ')}
                      </p>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex flex-col gap-1.5 shrink-0 items-end">
                    <button
                      onClick={() => handleGenerate(inv)}
                      disabled={!!generating}
                      className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors disabled:opacity-40 ${
                        due
                          ? 'bg-orange-500 hover:bg-orange-400 text-white'
                          : 'bg-indigo-600 hover:bg-indigo-500 text-white'
                      }`}
                    >
                      {generating === inv.id ? 'Generating…' : 'Generate Now'}
                    </button>
                    <Link
                      to={`/invoices/${inv.id}/edit`}
                      className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors px-2 py-1 rounded hover:bg-gray-700"
                    >
                      Edit Template
                    </Link>
                    <button
                      onClick={() => handlePause(inv)}
                      disabled={pausing === inv.id}
                      className="text-xs text-gray-500 hover:text-red-400 transition-colors px-2 py-1 rounded hover:bg-gray-700 disabled:opacity-40"
                    >
                      {pausing === inv.id ? 'Pausing…' : 'Pause'}
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {recurring.length > 0 && (
        <p className="text-xs text-gray-600 mt-4 text-center">
          "Generate Now" creates a new sent invoice from the template and advances the schedule.
          To add a recurring schedule, edit any invoice and enable "Recurring Invoice."
        </p>
      )}
    </div>
  )
}
