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
import type { CustomerItem } from '../../models/customer'

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

const CATEGORIES = ['Lead', 'Customer', 'Vendor', 'Employee', 'Inactive']

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
  icon: string
  danger?: boolean
}

const ACTIONS: ActionDef[] = [
  { id: 'assign-salesman', label: 'Assign Salesperson',  icon: '👤' },
  { id: 'set-category',    label: 'Change Category',     icon: '🏷️' },
  { id: 'set-followup',    label: 'Set Follow-up Date',  icon: '📅' },
  { id: 'set-callback',    label: 'Set Callback Status', icon: '📞' },
  { id: 'export-csv',      label: 'Export as CSV',       icon: '📥' },
  { id: 'deactivate',      label: 'Deactivate Records',  icon: '⏸️', danger: true },
  { id: 'delete',          label: 'Delete Records',      icon: '🗑️', danger: true },
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

  // Filters
  const [search, setSearch]       = useState('')
  const [catFilter, setCatFilter] = useState('all')
  const [repFilter, setRepFilter] = useState('all')
  const [cbFilter, setCbFilter]   = useState('all')

  // Action panel
  const [activeAction, setActiveAction] = useState<Action | null>(null)

  // Action params
  const [paramSalesman, setParamSalesman]     = useState('')
  const [paramCategory, setParamCategory]     = useState(CATEGORIES[0])
  const [paramFollowDays, setParamFollowDays] = useState(7)
  const [paramCallback, setParamCallback]     = useState('yes')
  const [confirmDelete, setConfirmDelete]     = useState(false)
  const [confirmDeactivate, setConfirmDeactivate] = useState(false)

  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const unsub = subscribeToCustomers(
      list => { setCustomers(list); setLoading(false) },
      ()   => setLoading(false),
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

  // Filtered list
  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    return customers.filter(c => {
      if (catFilter !== 'all' && c.category.toLowerCase() !== catFilter.toLowerCase()) return false
      if (repFilter !== 'all' && c.salesman !== repFilter) return false
      if (cbFilter === 'yes' && c.callback.toLowerCase() !== 'yes') return false
      if (cbFilter === 'no'  && c.callback.toLowerCase() === 'yes') return false
      if (!q) return true
      return (
        `${c.first} ${c.lastname} ${c.phone} ${c.email} ${c.city} ${c.adNo}`.toLowerCase().includes(q)
      )
    })
  }, [customers, catFilter, repFilter, cbFilter, search])

  const filteredIds = useMemo(() => new Set(filtered.map(c => c.id)), [filtered])

  const selectedInView = useMemo(() =>
    filtered.filter(c => selected.has(c.id)),
    [filtered, selected]
  )

  const allChecked  = filtered.length > 0 && filtered.every(c => selected.has(c.id))
  const someChecked = filtered.some(c => selected.has(c.id))

  function toggleOne(id: string) {
    setSelected(prev => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id); else n.add(id)
      return n
    })
  }

  function toggleAll() {
    if (allChecked) {
      setSelected(prev => {
        const n = new Set(prev)
        filtered.forEach(c => n.delete(c.id))
        return n
      })
    } else {
      setSelected(prev => {
        const n = new Set(prev)
        filtered.forEach(c => n.add(c.id))
        return n
      })
    }
  }

  function clearSelection() {
    setSelected(new Set())
    setActiveAction(null)
  }

  const selIds = useMemo(() => [...selected].filter(id => filteredIds.has(id)), [selected, filteredIds])

  // ── Execute actions ───────────────────────────────────────────────────────

  async function run(action: Action) {
    if (selIds.length === 0) return
    setBusy(true)
    try {
      switch (action) {
        case 'assign-salesman':
          if (!paramSalesman.trim()) { toast('Enter a salesperson name', 'error'); return }
          await bulkAssignSalesman(selIds, paramSalesman.trim())
          toast(`Assigned "${paramSalesman.trim()}" to ${selIds.length} records`, 'success')
          break
        case 'set-category':
          await bulkSetCategory(selIds, paramCategory)
          toast(`Changed category to "${paramCategory}" for ${selIds.length} records`, 'success')
          break
        case 'set-followup':
          await bulkSetFollowUpDate(selIds, addDays(new Date(), paramFollowDays))
          toast(`Follow-up set to ${fmtDate(addDays(new Date(), paramFollowDays))} for ${selIds.length} records`, 'success')
          break
        case 'set-callback':
          await bulkSetCallback(selIds, paramCallback)
          toast(`Callback set to "${paramCallback}" for ${selIds.length} records`, 'success')
          break
        case 'export-csv':
          exportCSV(selectedInView)
          toast(`Exported ${selIds.length} records as CSV`, 'success')
          setBusy(false)
          setActiveAction(null)
          return
        case 'deactivate':
          await bulkDeactivate(selIds)
          toast(`Deactivated ${selIds.length} records`, 'success')
          break
        case 'delete':
          await bulkDelete(selIds)
          toast(`Deleted ${selIds.length} records`, 'success')
          break
      }
      setSelected(new Set())
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
    return 'bg-gray-800 text-gray-400 border-gray-700'
  }

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-4">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-white">Batch Actions</h1>
          <p className="text-sm text-gray-400 mt-0.5">Select records, then apply an action to all at once</p>
        </div>
        {selected.size > 0 && (
          <button onClick={clearSelection} className="text-sm text-gray-400 hover:text-gray-200">
            Clear selection ({selected.size})
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="card p-3 flex flex-wrap items-center gap-2">
        <input
          ref={searchRef}
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search name, phone, city…"
          className="input-field text-sm py-1.5 flex-1 min-w-[180px]"
        />
        <select value={catFilter} onChange={e => setCatFilter(e.target.value)} className="input-field text-sm py-1.5 pr-8">
          <option value="all">All Categories</option>
          {allCats.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={repFilter} onChange={e => setRepFilter(e.target.value)} className="input-field text-sm py-1.5 pr-8">
          <option value="all">All Salespeople</option>
          {allReps.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
        <select value={cbFilter} onChange={e => setCbFilter(e.target.value)} className="input-field text-sm py-1.5 pr-8">
          <option value="all">Any Callback</option>
          <option value="yes">Callback: Yes</option>
          <option value="no">Callback: No</option>
        </select>
        <span className="text-xs text-gray-500 ml-auto">{filtered.length.toLocaleString()} records</span>
      </div>

      {/* Floating action bar */}
      {selected.size > 0 && (
        <div className="sticky top-3 z-30">
          <div className="card border border-indigo-700/40 bg-gray-900/95 backdrop-blur-sm p-3 flex flex-wrap items-center gap-2 shadow-2xl">
            <span className="text-sm font-semibold text-indigo-300 mr-1">
              {selected.size} selected
            </span>
            <div className="flex flex-wrap gap-1.5">
              {ACTIONS.map(a => (
                <button
                  key={a.id}
                  onClick={() => {
                    if (a.id === 'delete')      { setConfirmDelete(true);     return }
                    if (a.id === 'deactivate')  { setConfirmDeactivate(true); return }
                    if (a.id === 'export-csv')  { run('export-csv');          return }
                    setActiveAction(activeAction === a.id ? null : a.id)
                  }}
                  className={`text-xs px-3 py-1.5 rounded-xl border font-medium transition-colors ${
                    a.danger
                      ? 'border-red-700/40 text-red-400 bg-red-900/20 hover:bg-red-900/40'
                      : activeAction === a.id
                        ? 'border-indigo-500 text-indigo-200 bg-indigo-600/40'
                        : 'border-gray-600 text-gray-300 bg-gray-800 hover:bg-gray-700'
                  }`}
                >
                  {a.icon} {a.label}
                </button>
              ))}
            </div>
          </div>

          {/* Action input panel */}
          {activeAction && (
            <div className="card border border-indigo-700/30 mt-2 p-4 flex flex-wrap items-end gap-3">
              {activeAction === 'assign-salesman' && (
                <>
                  <div className="flex-1 min-w-[180px]">
                    <label className="block text-xs text-gray-400 mb-1">Salesperson Name</label>
                    <input
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
                  <ApplyBtn busy={busy} count={selected.size} onClick={() => run('assign-salesman')} />
                </>
              )}

              {activeAction === 'set-category' && (
                <>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">New Category</label>
                    <select value={paramCategory} onChange={e => setParamCategory(e.target.value)} className="input-field text-sm py-1.5 pr-8">
                      {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <ApplyBtn busy={busy} count={selected.size} onClick={() => run('set-category')} />
                </>
              )}

              {activeAction === 'set-followup' && (
                <>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Days from today</label>
                    <div className="flex rounded-lg overflow-hidden border border-gray-700 text-sm">
                      {[1, 3, 7, 14, 30, 60].map(d => (
                        <button
                          key={d}
                          onClick={() => setParamFollowDays(d)}
                          className={`px-3 py-1.5 font-medium transition-colors ${paramFollowDays === d ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-gray-100'}`}
                        >
                          {d}d
                        </button>
                      ))}
                    </div>
                    <p className="text-xs text-gray-500 mt-1">Sets to {fmtDate(addDays(new Date(), paramFollowDays))}</p>
                  </div>
                  <ApplyBtn busy={busy} count={selected.size} onClick={() => run('set-followup')} />
                </>
              )}

              {activeAction === 'set-callback' && (
                <>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Callback Status</label>
                    <div className="flex rounded-lg overflow-hidden border border-gray-700 text-sm">
                      {['yes', 'no'].map(v => (
                        <button
                          key={v}
                          onClick={() => setParamCallback(v)}
                          className={`px-5 py-1.5 font-medium transition-colors capitalize ${paramCallback === v ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-gray-100'}`}
                        >
                          {v}
                        </button>
                      ))}
                    </div>
                  </div>
                  <ApplyBtn busy={busy} count={selected.size} onClick={() => run('set-callback')} />
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* Table */}
      <div className="card overflow-hidden">
        {/* Table header */}
        <div className="border-b border-gray-700/50 bg-gray-800/50">
          <div className="flex items-center gap-3 px-4 py-2.5">
            <input
              type="checkbox"
              checked={allChecked}
              ref={el => { if (el) el.indeterminate = someChecked && !allChecked }}
              onChange={toggleAll}
              className="w-4 h-4 rounded accent-indigo-500 cursor-pointer"
            />
            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider flex-1">
              {someChecked
                ? `${selectedInView.length} of ${filtered.length} selected`
                : `${filtered.length.toLocaleString()} records`}
            </span>
            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider w-24 hidden sm:block">Category</span>
            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider w-28 hidden md:block">Salesperson</span>
            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider w-20 hidden lg:block">Callback</span>
            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider w-24 hidden lg:block">Follow-up</span>
          </div>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-12">
            <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {!loading && filtered.length === 0 && (
          <div className="py-12 text-center text-gray-500 text-sm">
            No records match the current filters.
          </div>
        )}

        <div className="divide-y divide-gray-700/30 max-h-[60vh] overflow-y-auto">
          {filtered.map(c => {
            const isSelected = selected.has(c.id)
            const hasFU = c.followUpDate && c.followUpDate.getTime() > 86_400_000

            return (
              <div
                key={c.id}
                onClick={() => toggleOne(c.id)}
                className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors ${
                  isSelected
                    ? 'bg-indigo-900/20 hover:bg-indigo-900/30'
                    : 'hover:bg-gray-800/40'
                }`}
              >
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => toggleOne(c.id)}
                  onClick={e => e.stopPropagation()}
                  className="w-4 h-4 rounded accent-indigo-500 shrink-0 cursor-pointer"
                />

                {/* Name + phone */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <Link
                      to={`/records/${c.id}`}
                      onClick={e => e.stopPropagation()}
                      className="text-sm font-medium text-gray-100 hover:text-indigo-300 transition-colors truncate"
                    >
                      {c.first} {c.lastname}
                    </Link>
                  </div>
                  <p className="text-xs text-gray-500 truncate">
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
                  <p className="text-xs text-gray-400 truncate">{c.salesman || '—'}</p>
                </div>

                {/* Callback */}
                <div className="w-20 hidden lg:block">
                  {c.callback.toLowerCase() === 'yes' ? (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-green-900/30 text-green-400 border border-green-700/30">Yes</span>
                  ) : (
                    <span className="text-xs text-gray-600">—</span>
                  )}
                </div>

                {/* Follow-up */}
                <div className="w-24 hidden lg:block">
                  {hasFU ? (
                    <p className="text-xs text-indigo-300">{fmtDate(c.followUpDate!)}</p>
                  ) : (
                    <span className="text-xs text-gray-600">—</span>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {/* Select all in filter tip */}
        {!allChecked && filtered.length > 0 && (
          <div className="px-4 py-2 border-t border-gray-700/30 bg-gray-800/20 flex items-center justify-between">
            <span className="text-xs text-gray-500">
              {selected.size > 0 ? `${selected.size} total selected across all filters` : 'Click rows or use the checkbox to select'}
            </span>
            <button
              onClick={toggleAll}
              className="text-xs text-indigo-400 hover:text-indigo-300"
            >
              {allChecked ? 'Deselect all' : `Select all ${filtered.length}`}
            </button>
          </div>
        )}
      </div>

      {/* Confirm modals */}
      <ConfirmModal
        isOpen={confirmDeactivate}
        message={`Deactivate ${selected.size} record${selected.size !== 1 ? 's' : ''}? They will be hidden from most views.`}
        onConfirm={() => { setConfirmDeactivate(false); run('deactivate') }}
        onCancel={() => setConfirmDeactivate(false)}
      />
      <ConfirmModal
        isOpen={confirmDelete}
        message={`Permanently delete ${selected.size} record${selected.size !== 1 ? 's' : ''}? This cannot be undone.`}
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
      disabled={busy}
      className="btn-primary text-sm px-5 py-2 disabled:opacity-40 flex items-center gap-2"
    >
      {busy && <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />}
      Apply to {count}
    </button>
  )
}
