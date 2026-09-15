import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { getFunctions, httpsCallable } from 'firebase/functions'
import { usePageTitle } from '../../hooks/usePageTitle'
import { subscribeToProposals, deleteProposal, updateProposal } from '../../services/proposalService'
import {
  effectiveStatus, expiryLabel, expiryState, fmtCurrency, proposalKpis, proposalTotal,
  sortProposals, statusClasses, statusLabel,
  DEFAULT_PROPOSAL_SORT, EXPIRING_SOON_DAYS, PROPOSAL_SORTS,
  type Proposal, type ProposalSortKey, type ProposalStatus,
} from '../../models/proposal'
import { useAuthStore } from '../../stores/authStore'
import { usePermissions } from '../../hooks/usePermissions'
import { useToast } from '../../components/Toast'
import ConfirmModal from '../../components/ConfirmModal'
import PartialDataBanner from '../../components/PartialDataBanner'
import { Icon, ICONS } from '../../components/Icon'
import { runBulk, bulkResultMessage } from '../../utils/bulkResult'

const TABS: { key: ProposalStatus | 'all'; label: string }[] = [
  { key: 'all',      label: 'All' },
  { key: 'draft',    label: 'Draft' },
  { key: 'sent',     label: 'Sent' },
  { key: 'accepted', label: 'Accepted' },
  { key: 'declined', label: 'Declined' },
  { key: 'expired',  label: 'Expired' },
]

/** Matches /customers and /invoices. 5,000 proposals was 5,000 rows. */
const PAGE_SIZE = 50

/**
 * Which bulk action is awaiting confirmation.
 *
 * One nullable object rather than a boolean per action: setting counts and
 * flipping a separate flag in the same handler renders the dialog from the
 * previous values, and four independent booleans can disagree.
 */
type PendingBulk =
  | { kind: 'delete' }
  | { kind: 'status'; status: 'accepted' | 'declined' }
  | { kind: 'remind'; sendable: number; skipped: number }

export default function ProposalListPage() {
  usePageTitle('Proposals')
  const companyId = useAuthStore(s => s.companyId)
  const perms = usePermissions()
  const toast = useToast()

  const [proposals, setProposals] = useState<Proposal[]>([])
  const [loading, setLoading]     = useState(true)
  const [tab,     setTab]         = useState<ProposalStatus | 'all'>('all')
  const [search,  setSearch]      = useState('')
  const [sort,    setSort]        = useState<ProposalSortKey>(DEFAULT_PROPOSAL_SORT)

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkWorking, setBulkWorking] = useState(false)
  const [pending,     setPending]     = useState<PendingBulk | null>(null)
  const [hitCap, setHitCap] = useState(false)
  const [page,      setPage]      = useState(1)
  const [pageInput, setPageInput] = useState('1')

  useEffect(() => {
    const unsub = subscribeToProposals(
      (items, cap) => { setProposals(items); setHitCap(cap); setLoading(false) },
      ()           => setLoading(false),
    )
    return unsub
  }, [companyId])

  const enriched = useMemo(() =>
    proposals.map(p => ({ ...p, _status: effectiveStatus(p), _expiry: expiryState(p) })),
  [proposals])

  const filtered = useMemo(() => {
    let items = enriched
    if (tab !== 'all') items = items.filter(p => p._status === tab)
    if (search.trim()) {
      const q = search.toLowerCase()
      items = items.filter(p =>
        p.customerName.toLowerCase().includes(q) ||
        p.proposalNumber.toLowerCase().includes(q),
      )
    }
    return sortProposals(items, sort)
  }, [enriched, tab, search, sort])

  // Drop selections that scrolled out of the current filter so the bulk bar
  // count never silently includes hidden rows. Scoped to `filtered`, not to
  // the current page — paging must not throw a selection away.
  useEffect(() => {
    const visible = new Set(filtered.map(p => p.id))
    setSelectedIds(prev => {
      const next = new Set([...prev].filter(id => visible.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [filtered])

  // Back to the first page whenever the set being paged through changes.
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

  // Win rate counts silent expiries as losses, and is null rather than 0%
  // when nothing has been decided — see proposalKpis.
  const kpis = useMemo(() => proposalKpis(proposals), [proposals])

  const counts = useMemo(() => {
    const m: Record<string, number> = { all: enriched.length }
    for (const p of enriched) m[p._status] = (m[p._status] ?? 0) + 1
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
    const ids = paginated.map(p => p.id)
    const allOn = ids.length > 0 && ids.every(id => selectedIds.has(id))
    setSelectedIds(prev => {
      const next = new Set(prev)
      for (const id of ids) { if (allOn) next.delete(id); else next.add(id) }
      return next
    })
  }
  function selectAllFiltered() {
    setSelectedIds(new Set(filtered.map(p => p.id)))
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
  async function handleBulkStatus(status: ProposalStatus) {
    const ids = [...selectedIds]
    setPending(null)
    setBulkWorking(true)
    const out = await runBulk(ids, id => updateProposal(id, { status }))
    if (out.firstError) console.error('[proposals] bulk status update:', out.firstError)
    const { text, variant } = bulkResultMessage({
      done: out.succeeded.length, total: ids.length,
      noun: 'proposal', action: `marked as ${statusLabel(status)}`,
    })
    toast(text, variant)
    setSelectedIds(new Set(out.failed))
    setBulkWorking(false)
  }

  async function handleBulkDelete() {
    const ids = [...selectedIds]
    setPending(null)
    setBulkWorking(true)
    const out = await runBulk(ids, id => deleteProposal(id))
    if (out.firstError) console.error('[proposals] bulk delete:', out.firstError)
    const { text, variant } = bulkResultMessage({
      done: out.succeeded.length, total: ids.length, noun: 'proposal', action: 'deleted',
    })
    toast(text, variant)
    // Only what's still there — a retry must not re-delete what's gone.
    setSelectedIds(new Set(out.failed))
    setBulkWorking(false)
  }

  /**
   * Opens the confirmation. This used to be the send itself: one click on the
   * most prominent button in the bar and real email left for every selected
   * customer, with nothing said first.
   */
  function askToRemind() {
    const selected = filtered.filter(p => selectedIds.has(p.id))
    const sendable = selected.filter(p => p.customerEmail.includes('@')).length
    if (sendable === 0) {
      toast(`No email address on file for ${selected.length === 1 ? 'that proposal' : 'any of those proposals'}`, 'error')
      return
    }
    setPending({ kind: 'remind', sendable, skipped: selected.length - sendable })
  }

  async function handleBulkRemind() {
    setPending(null)
    setBulkWorking(true)
    try {
      const fns = getFunctions()
      const result = await httpsCallable<{ proposalIds: string[] }, { sent: number; skipped: number }>(
        fns, 'bulkSendProposalReminders',
      )({ proposalIds: [...selectedIds] })
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
  /** Selected proposals the current page doesn't show. */
  const offPageSelected = selectedIds.size - paginated.filter(p => selectedIds.has(p.id)).length
  const allPageSelected = paginated.length > 0 && paginated.every(p => selectedIds.has(p.id))

  /**
   * Names which control emptied the list.
   *
   * "No proposals match your search." was shown whether the search, the tab or
   * both were responsible, named neither, and offered no way out of either.
   */
  const tabLabel  = TABS.find(t => t.key === tab)?.label ?? ''
  const hasSearch = search.trim() !== ''
  const emptyReason =
    hasSearch && tab !== 'all' ? `No ${tabLabel.toLowerCase()} proposals match “${search.trim()}”.`
    : hasSearch               ? `No proposals match “${search.trim()}”.`
    : tab !== 'all'           ? `No ${tabLabel.toLowerCase()} proposals.`
    : 'No proposals to show.'
  const emptyAction =
    hasSearch && tab !== 'all' ? 'Clear search and show all proposals'
    : hasSearch               ? 'Clear search'
    : 'Show all proposals'

  const n = selectedIds.size
  const confirmText = !pending ? '' :
    pending.kind === 'delete'
      ? `Delete ${n} selected proposal${n === 1 ? '' : 's'}? This cannot be undone.`
      : pending.kind === 'status'
      ? `Mark ${n} proposal${n === 1 ? '' : 's'} as ${statusLabel(pending.status)}? ` +
        `This is the outcome your win rate and forecast are built from, and it stamps ${n === 1 ? 'it' : 'them'} with today's date as the response date.`
      : `Email a reminder to ${pending.sendable} customer${pending.sendable === 1 ? '' : 's'} now?` +
        (pending.skipped > 0 ? ` ${pending.skipped} of the selected proposals ${pending.skipped === 1 ? 'has' : 'have'} no email address and will be skipped.` : '') +
        ' Mail goes out immediately and cannot be recalled.'

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Proposals</h1>
          <p className="text-sm text-gray-400 mt-0.5">Quotes &amp; estimates sent to customers</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Link to="/proposals/pipeline" className="btn-secondary text-sm px-3 py-2">Board View</Link>
          <Link to="/proposals/new" className="btn-primary text-sm px-4 py-2">
            + New Proposal
          </Link>
        </div>
      </div>

      {/* The shared banner, not a hand-rolled box: this page totals, so it
          needs the "every total is understated" wording. */}
      {hitCap && <PartialDataBanner totals />}

      {/* Label above value, matching KpiCard on /chart, /forecast and
          /heatmap. "Awaiting Response" was a second count of the same `sent`
          proposals as "Pending", so half the strip said one thing twice;
          that slot now carries what's about to lapse, which is the only
          thing on this page you can still act on. */}
      {!loading && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            {
              label: 'Pending', value: fmtCurrency(kpis.pendingValue), color: 'text-blue-400',
              sub: `${kpis.pendingCount} awaiting a reply`,
            },
            {
              label: `Expiring in ${EXPIRING_SOON_DAYS}d`,
              value: fmtCurrency(kpis.expiringValue),
              color: kpis.expiringCount > 0 ? 'text-amber-400' : 'text-gray-100',
              sub: kpis.expiringCount === 0 ? 'Nothing lapsing soon' : `${kpis.expiringCount} to chase`,
            },
            {
              label: 'Accepted Value', value: fmtCurrency(kpis.acceptedValue), color: 'text-green-400',
              sub: `${kpis.acceptedCount} won`,
            },
            {
              label: 'Win Rate',
              // Null, not 0%: "nothing decided yet" and "we lose everything"
              // are different, and the old code rendered both as 0%.
              value: kpis.winRate === null ? '—' : `${kpis.winRate}%`,
              color: 'text-white',
              sub: kpis.winRate === null
                ? 'Nothing decided yet'
                : `${kpis.acceptedCount} of ${kpis.decidedCount} decided`,
            },
          ].map(k => (
            <div key={k.label} className="card p-4">
              <p className="card-section-title">{k.label}</p>
              <p className={`text-lg sm:text-xl font-bold mt-1 truncate ${k.color}`}>{k.value}</p>
              <p className="text-xs text-gray-400 mt-0.5">{k.sub}</p>
            </div>
          ))}
        </div>
      )}

      {/* Expiries are counted as losses in the win rate, so the page has to
          say so somewhere rather than leaving the number unexplained. */}
      {!loading && kpis.expiredCount > 0 && (
        <p className="text-xs text-gray-400 -mt-2">
          {kpis.expiredCount} proposal{kpis.expiredCount === 1 ? '' : 's'} worth {fmtCurrency(kpis.expiredValue)} lapsed
          unanswered — counted as {kpis.expiredCount === 1 ? 'a loss' : 'losses'} in the win rate.
        </p>
      )}

      {/* Search and sort */}
      <div className="flex gap-2">
        {/* type="search" gives a clear affordance in WebKit and nothing in
            Firefox, and the placeholder was the only label. */}
        <div className="relative flex-1 min-w-0">
          <input
            type="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by customer or proposal number…"
            aria-label="Search proposals by customer or proposal number"
            className="input-field w-full text-sm py-2 pr-9"
          />
          {search !== '' && (
            <button
              onClick={() => setSearch('')}
              aria-label="Clear search"
              title="Clear search"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1.5 rounded text-gray-400 hover:text-gray-200 hover:bg-gray-700/50 transition-colors
                         focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            >
              <Icon d={ICONS.close} className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        <select
          value={sort}
          onChange={e => setSort(e.target.value as ProposalSortKey)}
          aria-label="Sort proposals"
          className="input-field text-sm py-2 shrink-0 w-40 sm:w-48 cursor-pointer"
        >
          {PROPOSAL_SORTS.map(s => (
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
            {/* opacity-60 put these at 3.03:1 — the count is half the reason
                to look at the tab. */}
            {counts[t.key] !== undefined && (
              <span className="ml-1 font-normal tabular-nums">({counts[t.key]})</span>
            )}
          </button>
        ))}
      </div>

      {/* Bulk action bar */}
      {!loading && someSelected && perms.canBulkAction && (
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={clearSelection} className="text-gray-400 hover:text-gray-200 transition-colors" aria-label="Clear selection">
            <Icon d={ICONS.close} className="w-4 h-4" />
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
          {/* Accepted and Declined are the pipeline outcome the win rate,
              forecast and commission are all computed from — not a status you
              flip on forty records without being asked. */}
          <button onClick={() => setPending({ kind: 'status', status: 'accepted' })} disabled={bulkWorking} className="text-sm px-3 py-1.5 rounded-lg bg-green-700/70 text-white hover:bg-green-600 transition-colors disabled:opacity-40">
            Mark Accepted
          </button>
          <button onClick={() => setPending({ kind: 'status', status: 'declined' })} disabled={bulkWorking} className="text-sm px-3 py-1.5 rounded-lg bg-red-700/70 text-white hover:bg-red-600 transition-colors disabled:opacity-40">
            Mark Declined
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

      {/* Proposal list */}
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
          {/* Was a 📝 glyph, which paints its own colour. */}
          <Icon d={ICONS.documentText} className="w-10 h-10 mx-auto text-gray-400" />
          <p className="text-gray-400 text-sm">
            {proposals.length === 0
              ? 'No proposals yet. Create one from a customer record or click + New Proposal.'
              : emptyReason}
          </p>
          {proposals.length === 0 ? (
            <Link to="/proposals/new" className="inline-block mt-2 text-sm text-indigo-400 hover:text-indigo-300">
              Create your first proposal →
            </Link>
          ) : (
            <button
              onClick={() => { setSearch(''); setTab('all') }}
              className="inline-block mt-2 text-sm text-indigo-400 hover:text-indigo-300 transition-colors"
            >
              {emptyAction}
            </button>
          )}
        </div>
      ) : (
        <div className="card divide-y divide-gray-700/30 overflow-hidden">
          {/* The checkbox acts on the rows below it, so it says so — it used
              to read "Select all" while selecting the whole filtered set.
              The strip itself isn't gated on the permission: a viewer who
              can't bulk-edit still needs to know which fifty they're on. */}
          {/* bg-gray-900, not bg-gray-800/30: 30% of a colour over itself is
              that colour, so this strip was 1.000:1 against the card. */}
          <div className="flex items-center gap-3 px-4 py-2 bg-gray-900">
            {perms.canBulkAction && (
              <>
                <input
                  id="select-page"
                  type="checkbox"
                  checked={allPageSelected}
                  onChange={togglePage}
                  className="w-4 h-4 rounded border-gray-600 bg-gray-700 text-indigo-500 cursor-pointer shrink-0"
                />
                <label htmlFor="select-page" className="text-xs text-gray-400 cursor-pointer">
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
          {paginated.map(p => {
            const total  = proposalTotal(p)
            const status = p._status
            const expiry = p._expiry
            // The hover was gray-700/20 — 1.068:1 on the card, a list of
            // clickable rows with no usable hover state. /50 is 1.185:1.
            return (
              <div key={p.id} className="flex items-center gap-3 px-4 py-4 hover:bg-gray-700/50 transition-colors">
                {perms.canBulkAction && (
                  <input
                    type="checkbox"
                    checked={selectedIds.has(p.id)}
                    onChange={() => toggleOne(p.id)}
                    className="w-4 h-4 rounded border-gray-600 bg-gray-700 text-indigo-500 cursor-pointer shrink-0"
                  />
                )}
                <Link to={`/proposals/${p.id}`} className="flex items-center gap-4 flex-1 min-w-0">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <p className="text-sm font-semibold text-gray-100 truncate">{p.customerName}</p>
                      {/* Was gray-600: 1.94:1, the least readable thing on the
                          row, on the field you quote back to a customer. */}
                      <p className="text-xs text-gray-400 shrink-0">{p.proposalNumber}</p>
                    </div>
                    {/* An answered proposal no longer shows an expiry date it
                        outlived; it shows when it was answered. Was gray-500
                        at 3.04:1 either way. */}
                    <p className="text-xs text-gray-400 mt-0.5">
                      Issued {fmtDate(p.issueDate)}
                      {expiry === 'closed'
                        ? p.respondedAt
                          ? ` · ${statusLabel(status)} ${fmtDate(p.respondedAt)}`
                          : ''
                        : ` · Expires ${fmtDate(p.expiresDate)}`}
                    </p>
                    {/* The whole point of a quote list, and it wasn't here:
                        a proposal lapsing on Friday read exactly like one
                        lapsing in six months. */}
                    {expiry === 'expiring' && (
                      <p className="text-xs font-medium text-amber-400 mt-0.5">{expiryLabel(p)}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <p className="text-sm font-bold text-white">{fmtCurrency(total)}</p>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${statusClasses(status)}`}>
                      {statusLabel(status)}
                    </span>
                  </div>
                </Link>
                {/* The 🧾 was a tooltip on a glyph, holding the invoice's id
                    and going nowhere — so the one place you'd want to go next
                    meant hunting for it by customer name. Outside the row's
                    Link, because a link can't nest inside another. */}
                {p.convertedInvoiceId && (
                  <Link
                    to={`/invoices/${p.convertedInvoiceId}`}
                    title="Open the invoice this became"
                    className="shrink-0 p-1.5 rounded text-emerald-400 hover:text-emerald-300 hover:bg-gray-700/50 transition-colors
                               focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                  >
                    <Icon d={ICONS.receipt} className="w-4 h-4" />
                    <span className="sr-only">Open the invoice this proposal became</span>
                  </Link>
                )}
              </div>
            )
          })}

          {/* First/last and a jump field, not just Prev/Next: PAGE_SIZE is 50
              against a 5,000-proposal cap, so this can run to a hundred pages. */}
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
                <label htmlFor="proposal-page-jump" className="sr-only">Jump to page</label>
                {/* Committed on Enter or blur, so typing "12" doesn't navigate
                    to page 1 first and re-render fifty rows on the way. */}
                <input
                  id="proposal-page-jump"
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

      {/* One dialog for all four guarded actions. Red is for the two that
          can't be taken back — the delete, and mail that has left the
          building; a status change gets the primary tone. */}
      <ConfirmModal
        isOpen={pending !== null}
        message={confirmText}
        confirmLabel={
          pending?.kind === 'delete' ? 'Delete' :
          pending?.kind === 'status' ? `Mark ${statusLabel(pending.status)}` : 'Send reminders'
        }
        tone={pending?.kind === 'status' ? 'primary' : 'danger'}
        onConfirm={
          pending?.kind === 'delete' ? handleBulkDelete :
          pending?.kind === 'status' ? () => handleBulkStatus(pending.status) : handleBulkRemind
        }
        onCancel={() => setPending(null)}
      />
    </div>
  )
}
