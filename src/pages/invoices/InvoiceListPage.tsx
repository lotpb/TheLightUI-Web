import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { getFunctions, httpsCallable } from 'firebase/functions'
import { usePageTitle } from '../../hooks/usePageTitle'
import { subscribeToInvoices, deleteInvoice, updateInvoice, INVOICE_REALTIME_LIMIT } from '../../services/invoiceService'
import {
  effectiveStatus, fmtCurrency, invoiceKpis, invoiceTotal, sortInvoices,
  statusClasses, statusLabel, DEFAULT_INVOICE_SORT, INVOICE_SORTS,
  type Invoice, type InvoiceSortKey, type InvoiceStatus,
} from '../../models/invoice'
import { useAuthStore } from '../../stores/authStore'
import { usePermissions } from '../../hooks/usePermissions'
import { useToast } from '../../components/Toast'
import ConfirmModal from '../../components/ConfirmModal'
import { Icon, ICONS } from '../../components/Icon'
import { runBulk, bulkResultMessage } from '../../utils/bulkResult'

const TABS: { key: InvoiceStatus | 'all'; label: string }[] = [
  { key: 'all',     label: 'All' },
  { key: 'draft',   label: 'Draft' },
  { key: 'sent',    label: 'Sent' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'paid',    label: 'Paid' },
]

/** Matches /customers. 5,000 invoices was 5,000 rows in the DOM. */
const PAGE_SIZE = 50

/**
 * Which bulk action is awaiting confirmation.
 *
 * One nullable object rather than a boolean per action: setting the counts and
 * flipping a separate flag in the same handler renders the dialog from the
 * previous values, and three independent booleans can disagree.
 */
type PendingBulk =
  | { kind: 'delete' }
  | { kind: 'paid' }
  | { kind: 'remind'; sendable: number; skipped: number }

export default function InvoiceListPage() {
  usePageTitle('Invoices')
  const companyId = useAuthStore(s => s.companyId)
  const perms = usePermissions()
  const toast = useToast()

  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [loading, setLoading]   = useState(true)
  const [tab,     setTab]       = useState<InvoiceStatus | 'all'>('all')
  const [search,  setSearch]    = useState('')
  const [sort,    setSort]      = useState<InvoiceSortKey>(DEFAULT_INVOICE_SORT)

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkWorking, setBulkWorking] = useState(false)
  const [pending,     setPending]     = useState<PendingBulk | null>(null)
  const [hitCap, setHitCap] = useState(false)
  const [page,      setPage]      = useState(1)
  const [pageInput, setPageInput] = useState('1')

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
    return sortInvoices(items, sort)
  }, [enriched, tab, search, sort])

  // Drop selections that scrolled out of the current filter so the bulk bar
  // count never silently includes hidden rows. Scoped to `filtered`, not to
  // the current page — paging must not throw a selection away.
  useEffect(() => {
    const visible = new Set(filtered.map(inv => inv.id))
    setSelectedIds(prev => {
      const next = new Set([...prev].filter(id => visible.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [filtered])

  // Back to the first page whenever the set being paged through changes;
  // otherwise narrowing to Overdue while on page 7 shows nothing.
  useEffect(() => { setPage(1) }, [tab, search, sort])

  const pageCount  = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const current    = Math.min(page, pageCount)
  const paginated  = filtered.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE)
  const rangeStart = filtered.length === 0 ? 0 : (current - 1) * PAGE_SIZE + 1
  const rangeEnd   = Math.min(current * PAGE_SIZE, filtered.length)

  useEffect(() => { setPageInput(String(current)) }, [current])

  function goToPage(n: number) {
    const clamped = Math.min(Math.max(1, n), pageCount)
    setPage(clamped)
    setPageInput(String(clamped))
  }

  /** Commit whatever is in the page-jump box, clamped, or restore it. */
  function commitPageInput() {
    const n = parseInt(pageInput, 10)
    if (Number.isFinite(n)) goToPage(n)
    else setPageInput(String(current))
  }

  // KPIs. Drafts are held out of all four figures — see invoiceKpis.
  const kpis = useMemo(() => invoiceKpis(invoices), [invoices])

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
  /** Page-scoped, since the checkbox sits in the page's own header strip. */
  function togglePage() {
    const ids = paginated.map(inv => inv.id)
    const allOn = ids.length > 0 && ids.every(id => selectedIds.has(id))
    setSelectedIds(prev => {
      const next = new Set(prev)
      for (const id of ids) { if (allOn) next.delete(id); else next.add(id) }
      return next
    })
  }
  function selectAllFiltered() {
    setSelectedIds(new Set(filtered.map(inv => inv.id)))
  }
  function clearSelection() {
    setSelectedIds(new Set())
  }

  /**
   * Bulk handlers keep the failures selected.
   *
   * These used Promise.all, which rejects on the first failure — so 39 of 40
   * updates landing reported "Bulk status update failed", and the untouched
   * selection made the obvious retry re-run all forty.
   */
  async function handleBulkStatus(status: InvoiceStatus) {
    const ids = [...selectedIds]
    setPending(null)
    setBulkWorking(true)
    const out = await runBulk(ids, id => updateInvoice(id, { status }))
    if (out.firstError) console.error('[invoices] bulk status update:', out.firstError)
    const { text, variant } = bulkResultMessage({
      done: out.succeeded.length, total: ids.length,
      noun: 'invoice', action: `marked as ${statusLabel(status)}`,
    })
    toast(text, variant)
    setSelectedIds(new Set(out.failed))
    setBulkWorking(false)
  }

  async function handleBulkDelete() {
    const ids = [...selectedIds]
    setPending(null)
    setBulkWorking(true)
    const out = await runBulk(ids, id => deleteInvoice(id))
    if (out.firstError) console.error('[invoices] bulk delete:', out.firstError)
    const { text, variant } = bulkResultMessage({
      done: out.succeeded.length, total: ids.length, noun: 'invoice', action: 'deleted',
    })
    toast(text, variant)
    // Only the ones still there — a retry must not re-delete what's gone.
    setSelectedIds(new Set(out.failed))
    setBulkWorking(false)
  }

  /**
   * Opens the confirmation. This used to be the send itself: one click on the
   * most prominent button in the bar and real email left for every selected
   * customer, with nothing said first.
   */
  function askToRemind() {
    const selected = filtered.filter(inv => selectedIds.has(inv.id))
    const sendable = selected.filter(inv => inv.customerEmail.includes('@')).length
    if (sendable === 0) {
      // Nothing to confirm: the server would skip every one of them.
      toast(`No email address on file for ${selected.length === 1 ? 'that invoice' : 'any of those invoices'}`, 'error')
      return
    }
    setPending({ kind: 'remind', sendable, skipped: selected.length - sendable })
  }

  async function handleBulkRemind() {
    setPending(null)
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
  /** Selected invoices the current page doesn't show. */
  const offPageSelected = selectedIds.size - paginated.filter(inv => selectedIds.has(inv.id)).length
  const allPageSelected = paginated.length > 0 && paginated.every(inv => selectedIds.has(inv.id))

  const confirmText = !pending ? '' :
    pending.kind === 'delete'
      ? `Delete ${selectedIds.size} selected invoice${selectedIds.size === 1 ? '' : 's'}? This cannot be undone.`
      : pending.kind === 'paid'
      ? `Mark ${selectedIds.size} invoice${selectedIds.size === 1 ? '' : 's'} as Paid? This also updates each customer's paid total and converts any leads to customers.`
      : `Email a payment reminder to ${pending.sendable} customer${pending.sendable === 1 ? '' : 's'} now?` +
        (pending.skipped > 0 ? ` ${pending.skipped} of the selected invoices ${pending.skipped === 1 ? 'has' : 'have'} no email address and will be skipped.` : '') +
        ' Mail goes out immediately and cannot be recalled.'

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
            { label: 'Total Billed',  value: kpis.billed,       color: 'text-white' },
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

      {/* Says where the money held out of those four figures went, so a
          draft-heavy month doesn't read as a drop in billing. */}
      {!loading && kpis.draftCount > 0 && (
        <p className="text-xs text-gray-400 -mt-2">
          Excludes {fmtCurrency(kpis.draft)} across {kpis.draftCount} draft{kpis.draftCount === 1 ? '' : 's'} —
          not billed, and not owed.
        </p>
      )}

      {/* Search and sort */}
      <div className="flex gap-2">
        <input
          type="search"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by customer or invoice number…"
          className="input-field flex-1 min-w-0 text-sm py-2"
        />
        <select
          value={sort}
          onChange={e => setSort(e.target.value as InvoiceSortKey)}
          aria-label="Sort invoices"
          className="input-field text-sm py-2 shrink-0 w-44 sm:w-52 cursor-pointer"
        >
          {INVOICE_SORTS.map(s => (
            <option key={s.key} value={s.key}>{s.label}</option>
          ))}
        </select>
      </div>

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
          {/* Selection survives paging, which is the right behaviour and was
              invisible: without this, "12 selected" on a page showing two of
              them looks like a bug. */}
          {offPageSelected > 0 && (
            <span className="text-xs text-gray-400">incl. {offPageSelected} not on this page</span>
          )}
          <div className="flex-1" />
          <button onClick={() => handleBulkStatus('sent')} disabled={bulkWorking} className="text-sm px-3 py-1.5 rounded-lg bg-gray-700 text-gray-200 hover:bg-gray-600 transition-colors disabled:opacity-40">
            Mark Sent
          </button>
          <button onClick={() => setPending({ kind: 'paid' })} disabled={bulkWorking} className="text-sm px-3 py-1.5 rounded-lg bg-green-700/70 text-white hover:bg-green-600 transition-colors disabled:opacity-40">
            Mark Paid
          </button>
          <button onClick={askToRemind} disabled={bulkWorking} className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-500 transition-colors disabled:opacity-40">
            <Icon d={ICONS.envelope} className="w-4 h-4" />
            Send Reminder
          </button>
          <button onClick={() => setPending({ kind: 'delete' })} disabled={bulkWorking} className="text-sm px-3 py-1.5 rounded-lg bg-red-900/60 text-red-200 hover:bg-red-800 transition-colors disabled:opacity-40">
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
          {/* The checkbox acts on the rows below it, so it says so — it used
              to read "Select all" while selecting the whole filtered set,
              which is now up to fifty pages of it. Selecting everything is a
              separate, explicit action. */}
          {/* The strip itself isn't gated on the permission — only the
              checkbox is. A viewer who can't bulk-edit still needs to know
              which fifty of four hundred they're looking at. */}
          <div className="flex items-center gap-3 px-4 py-2 bg-gray-800/30">
            {perms.canBulkAction && (
              <>
                <input
                  id="select-page"
                  type="checkbox"
                  checked={allPageSelected}
                  onChange={togglePage}
                  className="w-4 h-4 rounded border-gray-600 bg-gray-700 text-indigo-500 cursor-pointer shrink-0"
                />
                <label htmlFor="select-page" className="text-xs text-gray-500 cursor-pointer">
                  {allPageSelected ? 'Deselect page' : 'Select page'}
                </label>
                {filtered.length > paginated.length && (
                  <button
                    onClick={selectAllFiltered}
                    className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
                  >
                    Select all {filtered.length}
                  </button>
                )}
              </>
            )}
            <span className="flex-1" />
            <span className="text-xs text-gray-400 tabular-nums">
              {rangeStart}–{rangeEnd} of {filtered.length}
            </span>
          </div>
          {paginated.map(inv => {
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

          {/* First/last and a jump field, not just Prev/Next: PAGE_SIZE is 50
              against a 5,000-invoice cap, so this can run to a hundred pages. */}
          {pageCount > 1 && (
            <div className="flex items-center justify-between gap-2 px-4 py-3">
              <div className="flex items-center gap-1">
                <button
                  onClick={() => goToPage(1)}
                  disabled={current === 1}
                  aria-label="First page"
                  title="First page"
                  className="p-1.5 rounded text-gray-400 hover:text-gray-200 hover:bg-gray-700/50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors
                             focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                >
                  <Icon d={ICONS.chevronDoubleLeft} className="w-4 h-4" />
                </button>
                <button
                  onClick={() => goToPage(current - 1)}
                  disabled={current === 1}
                  className="flex items-center gap-1 text-sm text-gray-400 hover:text-gray-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  <Icon d={ICONS.chevronLeft} className="w-4 h-4" />
                  Prev
                </button>
              </div>
              <div className="flex items-center gap-1.5 text-xs text-gray-400">
                <label htmlFor="invoice-page-jump" className="sr-only">Jump to page</label>
                {/* Committed on Enter or blur, so typing "12" doesn't navigate
                    to page 1 first and re-render fifty rows on the way. */}
                <input
                  id="invoice-page-jump"
                  type="number"
                  min={1}
                  max={pageCount}
                  value={pageInput}
                  onChange={e => setPageInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') commitPageInput() }}
                  onBlur={commitPageInput}
                  className="input-field w-14 text-xs py-1 text-center tabular-nums"
                />
                <span className="tabular-nums whitespace-nowrap">of {pageCount}</span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => goToPage(current + 1)}
                  disabled={current === pageCount}
                  className="flex items-center gap-1 text-sm text-gray-400 hover:text-gray-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  Next
                  <Icon d={ICONS.chevronRight} className="w-4 h-4" />
                </button>
                <button
                  onClick={() => goToPage(pageCount)}
                  disabled={current === pageCount}
                  aria-label="Last page"
                  title="Last page"
                  className="p-1.5 rounded text-gray-400 hover:text-gray-200 hover:bg-gray-700/50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors
                             focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                >
                  <Icon d={ICONS.chevronDoubleRight} className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* One dialog for all three guarded actions. Red is for the two that
          can't be taken back — the delete, and mail that has left the
          building; marking paid only changes state. */}
      <ConfirmModal
        isOpen={pending !== null}
        message={confirmText}
        confirmLabel={
          pending?.kind === 'delete' ? 'Delete' :
          pending?.kind === 'paid'   ? 'Mark paid' : 'Send reminders'
        }
        tone={pending?.kind === 'paid' ? 'primary' : 'danger'}
        onConfirm={
          pending?.kind === 'delete' ? handleBulkDelete :
          pending?.kind === 'paid'   ? () => handleBulkStatus('paid') : handleBulkRemind
        }
        onCancel={() => setPending(null)}
      />
    </div>
  )
}
