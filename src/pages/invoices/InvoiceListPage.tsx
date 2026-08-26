import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { getFunctions, httpsCallable } from 'firebase/functions'
import { usePageTitle } from '../../hooks/usePageTitle'
import { subscribeToInvoices, deleteInvoice, updateInvoice, INVOICE_REALTIME_LIMIT } from '../../services/invoiceService'
import {
  effectiveStatus, fmtCurrency, invoiceTotal, statusClasses, statusLabel,
  type Invoice, type InvoiceStatus,
} from '../../models/invoice'
import { useAuthStore } from '../../stores/authStore'
import { usePermissions } from '../../hooks/usePermissions'
import { useToast } from '../../components/Toast'
import ConfirmModal from '../../components/ConfirmModal'

const TABS: { key: InvoiceStatus | 'all'; label: string }[] = [
  { key: 'all',     label: 'All' },
  { key: 'draft',   label: 'Draft' },
  { key: 'sent',    label: 'Sent' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'paid',    label: 'Paid' },
]

export default function InvoiceListPage() {
  usePageTitle('Invoices')
  const companyId = useAuthStore(s => s.companyId)
  const perms = usePermissions()
  const toast = useToast()

  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [loading, setLoading]   = useState(true)
  const [tab,     setTab]       = useState<InvoiceStatus | 'all'>('all')
  const [search,  setSearch]    = useState('')

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkWorking, setBulkWorking] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [hitCap, setHitCap] = useState(false)

  useEffect(() => {
    const unsub = subscribeToInvoices(
      (items, cap) => { setInvoices(items); setHitCap(cap); setLoading(false) },
      ()           => setLoading(false),
    )
    return unsub
  }, [companyId])

  // Enrich each invoice with its effective status (overdue detection)
  const enriched = useMemo(() =>
    invoices.map(inv => ({ ...inv, _status: effectiveStatus(inv) })),
  [invoices])

  const filtered = useMemo(() => {
    let items = enriched
    if (tab !== 'all') items = items.filter(inv => inv._status === tab)
    if (search.trim()) {
      const q = search.toLowerCase()
      items = items.filter(inv =>
        inv.customerName.toLowerCase().includes(q) ||
        inv.invoiceNumber.toLowerCase().includes(q),
      )
    }
    return items
  }, [enriched, tab, search])

  // Drop selections that scrolled out of the current filter so the bulk bar
  // count never silently includes hidden rows.
  useEffect(() => {
    const visible = new Set(filtered.map(inv => inv.id))
    setSelectedIds(prev => {
      const next = new Set([...prev].filter(id => visible.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [filtered])

  // KPIs
  const kpis = useMemo(() => {
    const total   = invoices.reduce((s, i) => s + invoiceTotal(i), 0)
    const paid    = invoices.filter(i => i.status === 'paid').reduce((s, i) => s + invoiceTotal(i), 0)
    const overdue = enriched.filter(i => i._status === 'overdue').reduce((s, i) => s + invoiceTotal(i), 0)
    const outstanding = total - paid
    return { total, paid, outstanding, overdue }
  }, [invoices, enriched])

  // Counts per tab
  const counts = useMemo(() => {
    const m: Record<string, number> = { all: enriched.length }
    for (const inv of enriched) m[inv._status] = (m[inv._status] ?? 0) + 1
    return m
  }, [enriched])

  function fmtDate(d: Date) {
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }

  function toggleOne(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }
  function toggleAll() {
    setSelectedIds(prev => prev.size === filtered.length ? new Set() : new Set(filtered.map(inv => inv.id)))
  }
  function clearSelection() {
    setSelectedIds(new Set())
  }

  async function handleBulkStatus(status: InvoiceStatus) {
    setBulkWorking(true)
    try {
      await Promise.all([...selectedIds].map(id => updateInvoice(id, { status })))
      toast(`Marked ${selectedIds.size} invoice${selectedIds.size === 1 ? '' : 's'} as ${statusLabel(status)}`, 'success')
      clearSelection()
    } catch {
      toast('Bulk status update failed', 'error')
    } finally {
      setBulkWorking(false)
    }
  }

  async function handleBulkDelete() {
    setConfirmDelete(false)
    setBulkWorking(true)
    try {
      await Promise.all([...selectedIds].map(id => deleteInvoice(id)))
      toast(`Deleted ${selectedIds.size} invoice${selectedIds.size === 1 ? '' : 's'}`, 'success')
      clearSelection()
    } catch {
      toast('Bulk delete failed', 'error')
    } finally {
      setBulkWorking(false)
    }
  }

  async function handleBulkRemind() {
    setBulkWorking(true)
    try {
      const fns = getFunctions()
      const result = await httpsCallable<{ invoiceIds: string[] }, { sent: number; skipped: number }>(
        fns, 'bulkSendInvoiceReminders',
      )({ invoiceIds: [...selectedIds] })
      const { sent, skipped } = result.data
      toast(`Sent ${sent} reminder${sent === 1 ? '' : 's'}${skipped > 0 ? ` (${skipped} skipped — no email on file)` : ''}`, sent > 0 ? 'success' : 'error')
      clearSelection()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not send reminders', 'error')
    } finally {
      setBulkWorking(false)
    }
  }

  const someSelected = selectedIds.size > 0

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Invoices</h1>
          <p className="text-sm text-gray-400 mt-0.5">Track billing and payments</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Link to="/invoices/pipeline" className="btn-secondary text-sm px-3 py-2">Board View</Link>
          <Link to="/invoices/new" className="btn-primary text-sm px-4 py-2">
            + New Invoice
          </Link>
        </div>
      </div>

      {hitCap && (
        <div className="bg-yellow-900/20 border border-yellow-600/40 rounded-xl px-4 py-3 text-yellow-300 text-sm">
          ⚠ Showing the first {INVOICE_REALTIME_LIMIT.toLocaleString()} invoices only. Some records may not be visible — contact support to raise this limit.
        </div>
      )}

      {/* KPI strip */}
      {!loading && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Total Billed',  value: kpis.total,       color: 'text-white' },
            { label: 'Paid',          value: kpis.paid,         color: 'text-green-400' },
            { label: 'Outstanding',   value: kpis.outstanding,  color: 'text-blue-400' },
            { label: 'Overdue',       value: kpis.overdue,      color: 'text-red-400' },
          ].map(k => (
            <div key={k.label} className="card p-4">
              <p className={`text-lg font-bold ${k.color}`}>{fmtCurrency(k.value)}</p>
              <p className="text-xs text-gray-500 mt-0.5">{k.label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Search */}
      <input
        type="search"
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="Search by customer or invoice number…"
        className="input-field w-full text-sm py-2"
      />

      {/* Status tabs */}
      <div className="flex gap-1.5 flex-wrap">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
              tab === t.key
                ? 'bg-indigo-600 text-white'
                : 'bg-gray-800 text-gray-400 hover:text-gray-200'
            }`}
          >
            {t.label}
            {counts[t.key] !== undefined && (
              <span className="ml-1 opacity-60">({counts[t.key]})</span>
            )}
          </button>
        ))}
      </div>

      {/* Bulk action bar */}
      {!loading && someSelected && perms.canBulkAction && (
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={clearSelection} className="text-gray-400 hover:text-gray-200 transition-colors" aria-label="Clear selection">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
          <span className="text-sm font-medium text-white">{selectedIds.size} selected</span>
          <div className="flex-1" />
          <button onClick={() => handleBulkStatus('sent')} disabled={bulkWorking} className="text-sm px-3 py-1.5 rounded-lg bg-gray-700 text-gray-200 hover:bg-gray-600 transition-colors disabled:opacity-40">
            Mark Sent
          </button>
          <button onClick={() => handleBulkStatus('paid')} disabled={bulkWorking} className="text-sm px-3 py-1.5 rounded-lg bg-green-700/70 text-white hover:bg-green-600 transition-colors disabled:opacity-40">
            Mark Paid
          </button>
          <button onClick={handleBulkRemind} disabled={bulkWorking} className="text-sm px-3 py-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-500 transition-colors disabled:opacity-40">
            ✉️ Send Reminder
          </button>
          <button onClick={() => setConfirmDelete(true)} disabled={bulkWorking} className="text-sm px-3 py-1.5 rounded-lg bg-red-900/60 text-red-200 hover:bg-red-800 transition-colors disabled:opacity-40">
            Delete
          </button>
        </div>
      )}

      {/* Invoice list */}
      {loading ? (
        <div className="card divide-y divide-gray-700/30">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 px-4 py-4 animate-pulse">
              <div className="flex-1 space-y-2">
                <div className="h-3.5 bg-gray-700 rounded w-40" />
                <div className="h-3 bg-gray-700/60 rounded w-24" />
              </div>
              <div className="h-5 bg-gray-700 rounded w-20" />
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="card p-12 text-center space-y-2">
          <p className="text-3xl">🧾</p>
          <p className="text-gray-400 text-sm">
            {invoices.length === 0
              ? 'No invoices yet. Create one from a customer record or click + New Invoice.'
              : 'No invoices match your search.'}
          </p>
          {invoices.length === 0 && (
            <Link to="/invoices/new" className="inline-block mt-2 text-sm text-indigo-400 hover:text-indigo-300">
              Create your first invoice →
            </Link>
          )}
        </div>
      ) : (
        <div className="card divide-y divide-gray-700/30 overflow-hidden">
          {perms.canBulkAction && (
            <div className="flex items-center gap-3 px-4 py-2 bg-gray-800/30">
              <input
                type="checkbox"
                checked={selectedIds.size === filtered.length}
                onChange={toggleAll}
                className="w-4 h-4 rounded border-gray-600 bg-gray-700 text-indigo-500 cursor-pointer shrink-0"
              />
              <span className="text-xs text-gray-500">
                {selectedIds.size === filtered.length ? 'Deselect all' : 'Select all'}
              </span>
            </div>
          )}
          {filtered.map(inv => {
            const total  = invoiceTotal(inv)
            const status = inv._status
            return (
              <div key={inv.id} className="flex items-center gap-3 px-4 py-4 hover:bg-gray-700/20 transition-colors">
                {perms.canBulkAction && (
                  <input
                    type="checkbox"
                    checked={selectedIds.has(inv.id)}
                    onChange={() => toggleOne(inv.id)}
                    className="w-4 h-4 rounded border-gray-600 bg-gray-700 text-indigo-500 cursor-pointer shrink-0"
                  />
                )}
                <Link to={`/invoices/${inv.id}`} className="flex items-center gap-4 flex-1 min-w-0">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <p className="text-sm font-semibold text-gray-100 truncate">{inv.customerName}</p>
                      <p className="text-xs text-gray-600 shrink-0">{inv.invoiceNumber}</p>
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">
                      Issued {fmtDate(inv.issueDate)} · Due {fmtDate(inv.dueDate)}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <p className="text-sm font-bold text-white">{fmtCurrency(total)}</p>
                    {inv.recurring && (
                      <span title={`Recurring ${inv.recurring}`} className="text-violet-400 text-sm">↻</span>
                    )}
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${statusClasses(status)}`}>
                      {statusLabel(status)}
                    </span>
                  </div>
                </Link>
              </div>
            )
          })}
        </div>
      )}

      <ConfirmModal
        isOpen={confirmDelete}
        message={`Delete ${selectedIds.size} selected invoice${selectedIds.size === 1 ? '' : 's'}? This cannot be undone.`}
        onConfirm={handleBulkDelete}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  )
}
