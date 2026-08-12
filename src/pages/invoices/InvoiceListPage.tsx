import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { usePageTitle } from '../../hooks/usePageTitle'
import { subscribeToInvoices } from '../../services/invoiceService'
import {
  effectiveStatus, fmtCurrency, invoiceTotal, statusClasses, statusLabel,
  type Invoice, type InvoiceStatus,
} from '../../models/invoice'
import { useAuthStore } from '../../stores/authStore'

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

  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [loading, setLoading]   = useState(true)
  const [tab,     setTab]       = useState<InvoiceStatus | 'all'>('all')
  const [search,  setSearch]    = useState('')

  useEffect(() => {
    const unsub = subscribeToInvoices(
      items => { setInvoices(items); setLoading(false) },
      ()    => setLoading(false),
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

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Invoices</h1>
          <p className="text-sm text-gray-400 mt-0.5">Track billing and payments</p>
        </div>
        <Link to="/invoices/new" className="btn-primary text-sm px-4 py-2 shrink-0">
          + New Invoice
        </Link>
      </div>

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
          {filtered.map(inv => {
            const total  = invoiceTotal(inv)
            const status = inv._status
            return (
              <Link
                key={inv.id}
                to={`/invoices/${inv.id}`}
                className="flex items-center gap-4 px-4 py-4 hover:bg-gray-700/20 transition-colors"
              >
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
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${statusClasses(status)}`}>
                    {statusLabel(status)}
                  </span>
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
