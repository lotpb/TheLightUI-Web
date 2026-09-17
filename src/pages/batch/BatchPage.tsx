import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  subscribeToCustomers,
  bulkDeactivate,
  bulkAssignSalesman,
  bulkSetCategory,
  bulkSetFollowUpDate,
  bulkSetCallback,
  bulkDelete,
} from '../../services/customerService'
import { usePageTitle } from '../../hooks/usePageTitle'
import { useToast } from '../../components/Toast'
import ConfirmModal from '../../components/ConfirmModal'
import PartialDataBanner from '../../components/PartialDataBanner'
import { Icon, ICONS } from '../../components/Icon'
import { CATEGORIES, type CustomerItem } from '../../models/customer'
import {
  describeBatchFilters, EMPTY_BATCH_FILTERS, filterBatchRecords, filtersActive,
  rangeIds, selectionScope, type BatchFilters,
} from '../../models/batchSelection'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtDate(d: Date) {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function addDays(d: Date, days: number): Date {
  const r = new Date(d)
  r.setDate(r.getDate() + days)
  r.setHours(0, 0, 0, 0)
  return r
}

function plural(n: number, word = 'record') {
  return `${n.toLocaleString()} ${word}${n !== 1 ? 's' : ''}`
}

type Action =
  | 'assign-salesman'
  | 'set-category'
  | 'set-followup'
  | 'set-callback'
  | 'deactivate'
  | 'delete'
  | 'export-csv'

interface ActionDef {
  id: Action
  label: string
  /** An SVG path from ICONS. These were emoji, which paint their own bitmap
   *  from Apple Color Emoji and so never take the button's colour — the
   *  danger red never reached the 🗑️ — and sit on a different baseline than
   *  the label beside them. See the note at the top of Icon.tsx. */
  icon: string | readonly string[]
  danger?: boolean
}

const ACTIONS: ActionDef[] = [
  { id: 'assign-salesman', label: 'Assign Salesperson',  icon: ICONS.user },
  { id: 'set-category',    label: 'Change Category',     icon: ICONS.tag },
  { id: 'set-followup',    label: 'Set Follow-up Date',  icon: ICONS.calendar },
  { id: 'set-callback',    label: 'Set Callback Status', icon: ICONS.phone },
  { id: 'export-csv',      label: 'Export as CSV',       icon: ICONS.downloadTray },
  { id: 'deactivate',      label: 'Deactivate Records',  icon: ICONS.minus, danger: true },
  { id: 'delete',          label: 'Delete Records',      icon: ICONS.trash, danger: true },
]

// ─── CSV export ───────────────────────────────────────────────────────────────

function exportCSV(items: CustomerItem[]) {
  const headers = ['First', 'Last', 'Phone', 'Email', 'City', 'State', 'Category', 'Salesman', 'Amount', 'AdNo', 'Callback']
  const rows = items.map(c => [
    c.first, c.lastname, c.phone, c.email,
    c.city, c.state, c.category, c.salesman,
    c.amount, c.adNo, c.callback,
  ].map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','))
  const csv = [headers.join(','), ...rows].join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = `export-${Date.now()}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function BatchPage() {
  usePageTitle('Batch Actions')
  const toast = useToast()

  const [customers, setCustomers] = useState<CustomerItem[]>([])
  const [loading, setLoading]     = useState(true)
  const [selected, setSelected]   = useState<Set<string>>(new Set())
  const [busy, setBusy]           = useState(false)
  // subscribeToCustomers calls back with (items, hitCap). The page passed a
  // one-argument callback, so the flag went in as React's second setState
  // argument and was discarded — past the 5,000-record cap "12,480 records"
  // was really 5,000 and "Select all" covered an arbitrary subset silently.
  const [hitCap, setHitCap]       = useState(false)

  const [filters, setFilters] = useState<BatchFilters>({ ...EMPTY_BATCH_FILTERS })
  const setFilter = <K extends keyof BatchFilters>(k: K, v: BatchFilters[K]) =>
    setFilters(f => ({ ...f, [k]: v }))

  // Action panel
  const [activeAction, setActiveAction] = useState<Action | null>(null)

  // Action params
  const [paramSalesman, setParamSalesman]     = useState('')
  const [paramCategory, setParamCategory]     = useState<string>(CATEGORIES[0])
  const [paramFollowDays, setParamFollowDays] = useState(7)
  const [paramCallback, setParamCallback]     = useState('yes')
  const [confirmDelete, setConfirmDelete]     = useState(false)
  const [confirmDeactivate, setConfirmDeactivate] = useState(false)

  const searchRef = useRef<HTMLInputElement>(null)
  /** Last row toggled, so shift-click can select a range from it. */
  const anchorId = useRef<string | null>(null)

  useEffect(() => {
    const unsub = subscribeToCustomers(
      (list, cap) => { setCustomers(list); setHitCap(!!cap); setLoading(false) },
      ()           => setLoading(false),
    )
    return unsub
  }, [])

  const allReps = useMemo(() => {
    const s = new Set<string>()
    customers.forEach(c => { if (c.salesman) s.add(c.salesman) })
    return Array.from(s).sort()
  }, [customers])

  const allCats = useMemo(() => {
    const s = new Set<string>()
    customers.forEach(c => { if (c.category) s.add(c.category) })
    return Array.from(s).sort()
  }, [customers])

  const filtered   = useMemo(() => filterBatchRecords(customers, filters), [customers, filters])
  const visibleIds = useMemo(() => filtered.map(c => c.id), [filtered])

  /**
   * The one answer to "what will an action touch". Everything on screen —
   * button labels, Apply counts, both confirmations — reads from this, so a
   * dialog can no longer promise to delete rows the filter has hidden.
   */
  const scope = useMemo(() => selectionScope(selected, visibleIds), [selected, visibleIds])
  const scopeCount = scope.inScope.length
  const selectedRecords = useMemo(() => filtered.filter(c => selected.has(c.id)), [filtered, selected])

  const allChecked  = filtered.length > 0 && scopeCount === filtered.length
  const someChecked = scopeCount > 0

  function toggleOne(id: string, shift = false) {
    const ids = shift && anchorId.current ? rangeIds(visibleIds, anchorId.current, id) : [id]
    // A shift-range adopts the state the clicked row is moving to, which is
    // what every list with range selection does — otherwise dragging over a
    // mixed range flips rows in both directions at once.
    const turnOn = !selected.has(id)
    setSelected(prev => {
      const n = new Set(prev)
      for (const i of ids) { if (turnOn) n.add(i); else n.delete(i) }
      return n
    })
    anchorId.current = id
  }

  function toggleAll() {
    setSelected(prev => {
      const n = new Set(prev)
      if (allChecked) filtered.forEach(c => n.delete(c.id))
      else            filtered.forEach(c => n.add(c.id))
      return n
    })
  }

  function clearSelection() {
    setSelected(new Set())
    setActiveAction(null)
    anchorId.current = null
  }

  function clearFilters() {
    setFilters({ ...EMPTY_BATCH_FILTERS })
  }

  /**
   * Shift+Space on a row's checkbox selects the range from the last one
   * touched. preventDefault stops the browser's own toggle from firing
   * onChange as well, which would undo half the range; a plain Space is left
   * alone so the native checkbox behaviour still applies.
   */
  function onRowKeyDown(e: React.KeyboardEvent, id: string) {
    if (e.key === ' ' && e.shiftKey) {
      e.preventDefault()
      toggleOne(id, true)
    }
  }

  // ── Execute actions ───────────────────────────────────────────────────────

  async function run(action: Action) {
    const ids = scope.inScope
    if (ids.length === 0) {
      // Was a bare `return` before any toast, so confirming a permanent
      // deletion closed the dialog and reported nothing at all.
      toast(
        scope.hiddenCount > 0
          ? `Nothing to act on — all ${plural(scope.hiddenCount)} you selected are hidden by the current filters.`
          : 'Select at least one record first.',
        'error',
      )
      return
    }
    setBusy(true)
    try {
      switch (action) {
        case 'assign-salesman':
          if (!paramSalesman.trim()) { toast('Enter a salesperson name', 'error'); return }
          await bulkAssignSalesman(ids, paramSalesman.trim())
          toast(`Assigned “${paramSalesman.trim()}” to ${plural(ids.length)}`, 'success')
          break
        case 'set-category':
          await bulkSetCategory(ids, paramCategory)
          toast(`Changed category to “${paramCategory}” for ${plural(ids.length)}`, 'success')
          break
        case 'set-followup':
          await bulkSetFollowUpDate(ids, addDays(new Date(), paramFollowDays))
          toast(`Follow-up set to ${fmtDate(addDays(new Date(), paramFollowDays))} for ${plural(ids.length)}`, 'success')
          break
        case 'set-callback':
          await bulkSetCallback(ids, paramCallback)
          toast(`Callback set to “${paramCallback}” for ${plural(ids.length)}`, 'success')
          break
        case 'export-csv':
          exportCSV(selectedRecords)
          toast(`Exported ${plural(ids.length)} as CSV`, 'success')
          setBusy(false)
          setActiveAction(null)
          return
        case 'deactivate':
          await bulkDeactivate(ids)
          toast(`Deactivated ${plural(ids.length)}`, 'success')
          break
        case 'delete':
          await bulkDelete(ids)
          toast(`Deleted ${plural(ids.length)}`, 'success')
          break
      }
      // Only the rows that were acted on are cleared. Clearing the whole Set
      // would silently throw away a selection the filters were hiding.
      setSelected(prev => {
        const n = new Set(prev)
        ids.forEach(id => n.delete(id))
        return n
      })
      setActiveAction(null)
    } catch {
      toast('Action failed — please try again', 'error')
    } finally {
      setBusy(false)
    }
  }

  // ── Category badge color ──────────────────────────────────────────────────

  function catBadge(cat: string) {
    const lc = cat.toLowerCase()
    if (lc === 'customer') return 'bg-green-900/40 text-green-300 border-green-700/30'
    if (lc === 'lead')     return 'bg-indigo-900/40 text-indigo-300 border-indigo-700/30'
    if (lc === 'vendor')   return 'bg-orange-900/40 text-orange-300 border-orange-700/30'
    if (lc === 'employee') return 'bg-blue-900/40 text-blue-300 border-blue-700/30'
    // Fallback for legacy category values. Was bg-gray-800 on a bg-gray-800
    // card — the same colour-over-itself case as the header band, so the
    // badge had no fill at all. gray-700 reads at 1.42:1 dark / 1.39:1 light.
    return 'bg-gray-700 text-gray-200 border-gray-600'
  }

  const filterSummary = describeBatchFilters(filters)

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-4">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-white">Batch Actions</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            Select records, then apply an action to all at once. Shift-click to select a range.
          </p>
        </div>
        {scope.totalSelected > 0 && (
          <button
            onClick={clearSelection}
            className="text-sm text-gray-300 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded px-2 py-1"
          >
            Clear selection ({scope.totalSelected.toLocaleString()})
          </button>
        )}
      </div>

      {hitCap && (
        <PartialDataBanner detail="Records beyond the cap aren't listed here, so they can't be selected and no action below will reach them." />
      )}

      {/* Filters */}
      <div className="card p-3 flex flex-wrap items-center gap-2">
        <input
          ref={searchRef}
          type="text"
          value={filters.search}
          onChange={e => setFilter('search', e.target.value)}
          placeholder="Search name, phone, city…"
          className="input-field text-sm py-1.5 flex-1 min-w-[180px]"
        />
        <select value={filters.category} onChange={e => setFilter('category', e.target.value)} className="input-field text-sm py-1.5 pr-8">
          <option value="all">All Categories</option>
          {allCats.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={filters.salesman} onChange={e => setFilter('salesman', e.target.value)} className="input-field text-sm py-1.5 pr-8">
          <option value="all">All Salespeople</option>
          {allReps.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
        <select value={filters.callback} onChange={e => setFilter('callback', e.target.value)} className="input-field text-sm py-1.5 pr-8">
          <option value="all">Any Callback</option>
          <option value="yes">Callback: Yes</option>
          <option value="no">Callback: No</option>
        </select>
        {filtersActive(filters) && (
          <button
            onClick={clearFilters}
            className="text-xs text-indigo-400 hover:text-indigo-300 px-2 py-1 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          >
            Clear filters
          </button>
        )}
        <span className="text-xs text-gray-400 ml-auto tabular-nums">{plural(filtered.length)}</span>
      </div>

      {/* Floating action bar */}
      {scope.totalSelected > 0 && (
        <div className="sticky top-3 z-30">
          <div className="card border border-indigo-700/40 bg-gray-900/95 backdrop-blur-sm p-3 space-y-2 shadow-2xl">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-indigo-300 mr-1 tabular-nums">
                {scopeCount.toLocaleString()} selected
              </span>
              <div className="flex flex-wrap gap-1.5">
                {ACTIONS.map(a => (
                  <button
                    key={a.id}
                    disabled={scopeCount === 0}
                    onClick={() => {
                      if (a.id === 'delete')      { setConfirmDelete(true);     return }
                      if (a.id === 'deactivate')  { setConfirmDeactivate(true); return }
                      if (a.id === 'export-csv')  { run('export-csv');          return }
                      setActiveAction(activeAction === a.id ? null : a.id)
                    }}
                    className={`text-xs px-3 py-1.5 rounded-xl border font-medium transition-colors
                                inline-flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed
                                focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                      a.danger
                        ? 'border-red-700/40 text-red-400 bg-red-900/20 hover:bg-red-900/40'
                        : activeAction === a.id
                          ? 'border-indigo-500 text-indigo-200 bg-indigo-600/40'
                          : 'border-gray-600 text-gray-300 bg-gray-800 hover:bg-gray-700'
                    }`}
                  >
                    <Icon d={a.icon} className="w-3.5 h-3.5 shrink-0" />
                    {a.label}
                  </button>
                ))}
              </div>
            </div>

            {/* The gap that made every count on this page wrong: rows stay
                ticked when a filter hides them, and no action reaches them. */}
            {scope.hiddenCount > 0 && (
              <div className="flex items-start gap-2 text-xs bg-amber-900/25 border border-amber-600/40 rounded-lg px-2.5 py-2 text-amber-200">
                <Icon d={ICONS.warning} className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span className="flex-1">
                  {plural(scope.hiddenCount)} you selected {scope.hiddenCount === 1 ? 'is' : 'are'} hidden
                  {filterSummary ? ` by the ${filterSummary} filter` : ' by the current filters'} and will be skipped.
                </span>
                <button
                  onClick={clearFilters}
                  className="shrink-0 underline hover:no-underline focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 rounded"
                >
                  Show them
                </button>
              </div>
            )}
          </div>

          {/* Action input panel */}
          {activeAction && (
            <div className="card border border-indigo-700/30 mt-2 p-4 flex flex-wrap items-end gap-3">
              {activeAction === 'assign-salesman' && (
                <>
                  <div className="flex-1 min-w-[180px]">
                    <label htmlFor="batch-rep" className="block text-xs text-gray-300 mb-1">Salesperson Name</label>
                    <input
                      id="batch-rep"
                      type="text"
                      list="rep-options"
                      value={paramSalesman}
                      onChange={e => setParamSalesman(e.target.value)}
                      placeholder="e.g. John Smith"
                      className="input-field text-sm py-1.5 w-full"
                    />
                    <datalist id="rep-options">
                      {allReps.map(r => <option key={r} value={r} />)}
                    </datalist>
                  </div>
                  <ApplyBtn busy={busy} count={scopeCount} onClick={() => run('assign-salesman')} />
                </>
              )}

              {activeAction === 'set-category' && (
                <>
                  <div>
                    <label htmlFor="batch-cat" className="block text-xs text-gray-300 mb-1">New Category</label>
                    {/* Was a local five-entry list including 'Inactive', which
                        is not a CustomerCategory — bulkSetCategory takes a
                        bare string, so it wrote a value no category filter in
                        the app matches. Deactivate, two buttons away, is the
                        real way to make a record inactive. */}
                    <select
                      id="batch-cat"
                      value={paramCategory}
                      onChange={e => setParamCategory(e.target.value)}
                      className="input-field text-sm py-1.5 pr-8"
                    >
                      {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <ApplyBtn busy={busy} count={scopeCount} onClick={() => run('set-category')} />
                </>
              )}

              {activeAction === 'set-followup' && (
                <>
                  <div>
                    <p className="block text-xs text-gray-300 mb-1">Days from today</p>
                    <div className="flex rounded-lg overflow-hidden border border-gray-600 text-sm" role="group">
                      {[1, 3, 7, 14, 30, 60].map(d => (
                        <button
                          key={d}
                          aria-pressed={paramFollowDays === d}
                          onClick={() => setParamFollowDays(d)}
                          className={`px-3 py-1.5 font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 ${
                            paramFollowDays === d ? 'bg-indigo-600 text-white' : 'text-gray-300 hover:text-white hover:bg-gray-700'
                          }`}
                        >
                          {d}d
                        </button>
                      ))}
                    </div>
                    <p className="text-xs text-gray-400 mt-1">Sets to {fmtDate(addDays(new Date(), paramFollowDays))}</p>
                  </div>
                  <ApplyBtn busy={busy} count={scopeCount} onClick={() => run('set-followup')} />
                </>
              )}

              {activeAction === 'set-callback' && (
                <>
                  <div>
                    <p className="block text-xs text-gray-300 mb-1">Callback Status</p>
                    <div className="flex rounded-lg overflow-hidden border border-gray-600 text-sm" role="group">
                      {['yes', 'no'].map(v => (
                        <button
                          key={v}
                          aria-pressed={paramCallback === v}
                          onClick={() => setParamCallback(v)}
                          className={`px-5 py-1.5 font-medium transition-colors capitalize focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 ${
                            paramCallback === v ? 'bg-indigo-600 text-white' : 'text-gray-300 hover:text-white hover:bg-gray-700'
                          }`}
                        >
                          {v}
                        </button>
                      ))}
                    </div>
                  </div>
                  <ApplyBtn busy={busy} count={scopeCount} onClick={() => run('set-callback')} />
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* Table */}
      <div className="card overflow-hidden">
        {/* Table header. The band was bg-gray-800/50 sitting on .card, which
            *is* bg-gray-800 — 40% of a colour over itself is that colour, so
            the header strip was a perfect 1.000:1 against the rows below it. */}
        <div className="border-b border-gray-700 bg-gray-700/50">
          <div className="flex items-center gap-3 px-4 py-2.5">
            <input
              type="checkbox"
              checked={allChecked}
              ref={el => { if (el) el.indeterminate = someChecked && !allChecked }}
              onChange={toggleAll}
              aria-label={allChecked ? 'Deselect all visible records' : 'Select all visible records'}
              className="w-4 h-4 rounded accent-indigo-500 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            />
            <span className="text-xs font-semibold text-gray-300 uppercase tracking-wider flex-1 tabular-nums">
              {someChecked
                ? `${scopeCount.toLocaleString()} of ${filtered.length.toLocaleString()} selected`
                : plural(filtered.length)}
            </span>
            <span className="text-xs font-semibold text-gray-300 uppercase tracking-wider w-24 hidden sm:block">Category</span>
            <span className="text-xs font-semibold text-gray-300 uppercase tracking-wider w-28 hidden md:block">Salesperson</span>
            <span className="text-xs font-semibold text-gray-300 uppercase tracking-wider w-20 hidden lg:block">Callback</span>
            <span className="text-xs font-semibold text-gray-300 uppercase tracking-wider w-24 hidden lg:block">Follow-up</span>
          </div>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-12">
            <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {!loading && filtered.length === 0 && (
          <div className="py-12 text-center text-gray-300 text-sm">
            No records match {filterSummary ? `the ${filterSummary} filter` : 'the current filters'}.
          </div>
        )}

        {/* No max-height and no inner overflow: an inner scroller nested in
            the page scroll gave two scrollbars, showed ~12 of up to 5,000
            rows, and left the sticky bar above anchored to the wrong scroll
            context. */}
        <div className="divide-y divide-gray-700">
          {filtered.map(c => {
            const isSelected = selected.has(c.id)
            const hasFU = c.followUpDate && c.followUpDate.getTime() > 86_400_000

            return (
              <div
                key={c.id}
                onClick={e => toggleOne(c.id, e.shiftKey)}
                /* Selection was bg-indigo-900/20 on bg-gray-800: 1.04:1, i.e.
                   indistinguishable from an unselected row on the one page
                   whose whole job is showing what's selected. This fill is
                   1.40:1 dark / 1.48:1 light, with a hard left edge on top of
                   it. The transparent edge on unselected rows keeps the text
                   from shifting 2px as you tick things. */
                className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors border-l-2 ${
                  isSelected
                    ? 'bg-indigo-500/30 border-indigo-400'
                    : 'border-transparent hover:bg-gray-700/50'
                }`}
              >
                {/* The checkbox, not the row, is the accessible control: the
                    row contains a link, so it can't carry role="option"
                    without breaking the listbox contract. Shift+Space here
                    selects a range, which is the keyboard equivalent of
                    shift-click — otherwise picking 200 records means 200
                    separate Tab/Space cycles. */}
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => toggleOne(c.id)}
                  onClick={e => e.stopPropagation()}
                  onKeyDown={e => onRowKeyDown(e, c.id)}
                  aria-label={`Select ${c.first} ${c.lastname}`}
                  className="w-4 h-4 rounded accent-indigo-500 shrink-0 cursor-pointer
                             focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-indigo-400"
                />

                {/* Name + phone */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <Link
                      to={`/records/${c.id}`}
                      onClick={e => e.stopPropagation()}
                      className="text-sm font-medium text-gray-100 hover:text-indigo-300 transition-colors truncate
                                 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded"
                    >
                      {c.first} {c.lastname}
                    </Link>
                  </div>
                  {/* Was text-gray-500 at 3.04:1 — and this line is the only
                      way to tell two same-named records apart before deleting
                      one of them. */}
                  <p className="text-xs text-gray-300 truncate">
                    {[c.phone, c.city && c.state ? `${c.city}, ${c.state}` : c.city || c.state].filter(Boolean).join(' · ')}
                  </p>
                </div>

                {/* Category */}
                <div className="w-24 hidden sm:block">
                  {c.category && (
                    <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${catBadge(c.category)}`}>
                      {c.category}
                    </span>
                  )}
                </div>

                {/* Salesman */}
                <div className="w-28 hidden md:block">
                  <p className="text-xs text-gray-300 truncate">{c.salesman || '—'}</p>
                </div>

                {/* Callback */}
                <div className="w-20 hidden lg:block">
                  {c.callback.toLowerCase() === 'yes' ? (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-green-900/30 text-green-400 border border-green-700/30">Yes</span>
                  ) : (
                    /* Was text-gray-600 — 1.94:1. */
                    <span className="text-xs text-gray-400">—</span>
                  )}
                </div>

                {/* Follow-up */}
                <div className="w-24 hidden lg:block">
                  {hasFU ? (
                    <p className="text-xs text-indigo-300">{fmtDate(c.followUpDate!)}</p>
                  ) : (
                    <span className="text-xs text-gray-400">—</span>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {/* Selection footer. Was hidden whenever everything was checked, which
            is exactly when its 'Deselect all' branch would have been needed —
            so that branch could never render. */}
        {filtered.length > 0 && (
          <div className="px-4 py-2 border-t border-gray-700 bg-gray-700/40 flex items-center justify-between gap-3">
            <span className="text-xs text-gray-300">
              {scope.totalSelected > 0
                ? `${scopeCount.toLocaleString()} of ${filtered.length.toLocaleString()} shown selected${scope.hiddenCount > 0 ? ` · ${scope.hiddenCount.toLocaleString()} hidden by filters` : ''}`
                : 'Click a row to select it · shift-click for a range'}
            </span>
            <button
              onClick={toggleAll}
              className="text-xs text-indigo-400 hover:text-indigo-300 shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded px-1"
            >
              {allChecked ? 'Deselect all' : `Select all ${filtered.length.toLocaleString()}`}
            </button>
          </div>
        )}
      </div>

      {/* Confirm modals. Both counted selected.size — everything ever ticked —
          while the action ran on the visible subset, so the delete dialog
          could promise 50 and delete 10. Deactivate also passed no
          confirmLabel, so ConfirmModal's default put a red button reading
          "Delete" on a reversible hide. */}
      <ConfirmModal
        isOpen={confirmDeactivate}
        tone="primary"
        confirmLabel={`Deactivate ${scopeCount.toLocaleString()}`}
        message={
          `Deactivate ${plural(scopeCount)}? They stay in your data and can be reactivated, but they're hidden from most views.` +
          (scope.hiddenCount > 0 ? ` ${plural(scope.hiddenCount)} you selected ${scope.hiddenCount === 1 ? 'is' : 'are'} hidden by the current filters and will be skipped.` : '')
        }
        onConfirm={() => { setConfirmDeactivate(false); run('deactivate') }}
        onCancel={() => setConfirmDeactivate(false)}
      />
      <ConfirmModal
        isOpen={confirmDelete}
        confirmLabel={`Delete ${scopeCount.toLocaleString()}`}
        message={
          `Permanently delete ${plural(scopeCount)}${filterSummary ? ` from the ${filterSummary} view` : ''}? This cannot be undone.` +
          (scope.hiddenCount > 0 ? ` ${plural(scope.hiddenCount)} you selected ${scope.hiddenCount === 1 ? 'is' : 'are'} hidden by the current filters and will not be deleted.` : '')
        }
        onConfirm={() => { setConfirmDelete(false); run('delete') }}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  )
}

// ─── Apply button ─────────────────────────────────────────────────────────────

function ApplyBtn({ busy, count, onClick }: { busy: boolean; count: number; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={busy || count === 0}
      className="btn-primary text-sm px-5 py-2 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2
                 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
    >
      {busy && <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />}
      Apply to {count.toLocaleString()}
    </button>
  )
}
