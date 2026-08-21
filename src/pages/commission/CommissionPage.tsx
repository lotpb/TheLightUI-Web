import { useEffect, useMemo, useState } from 'react'
import { usePageTitle } from '../../hooks/usePageTitle'
import { subscribeToCustomers } from '../../services/customerService'
import type { CustomerItem } from '../../models/customer'
import { formatCurrency } from '../../models/customer'
import { useAuthStore } from '../../stores/authStore'
import { usePickerStore } from '../../stores/pickerStore'
import {
  subscribeToCommissionStructure,
  saveCommissionStructure,
  calcCommission,
  DEFAULT_STRUCTURE,
  type CommissionStructure,
  type CommissionTier,
} from '../../services/commissionStructureService'

type Period = 'week' | 'month' | 'lastMonth' | 'quarter' | 'year' | 'last12' | 'all'

const PERIOD_LABELS: Record<Period, string> = {
  week: 'This Week', month: 'This Month', lastMonth: 'Last Month',
  quarter: 'This Quarter', year: 'This Year', last12: 'Last 12M', all: 'All Time',
}
const PERIODS: Period[] = ['week', 'month', 'lastMonth', 'quarter', 'year', 'last12', 'all']

function getPeriodRange(period: Period): { start: Date; end: Date } {
  const now = new Date()
  const start = new Date(now)
  const end   = new Date(now)
  end.setHours(23, 59, 59, 999)
  switch (period) {
    case 'week':
      start.setDate(now.getDate() - now.getDay()); start.setHours(0, 0, 0, 0); break
    case 'month':
      start.setDate(1); start.setHours(0, 0, 0, 0); break
    case 'lastMonth':
      start.setMonth(now.getMonth() - 1, 1); start.setHours(0, 0, 0, 0)
      end.setDate(0); end.setHours(23, 59, 59, 999); break
    case 'quarter': {
      const qMonth = Math.floor(now.getMonth() / 3) * 3
      start.setMonth(qMonth, 1); start.setHours(0, 0, 0, 0); break
    }
    case 'year':
      start.setMonth(0, 1); start.setHours(0, 0, 0, 0); break
    case 'last12':
      start.setMonth(now.getMonth() - 11, 1); start.setHours(0, 0, 0, 0); break
    case 'all':
      start.setFullYear(2000); break
  }
  return { start, end }
}

function periodKey(start: Date, end: Date): string {
  return `${start.toISOString().slice(0, 10)}_${end.toISOString().slice(0, 10)}`
}

interface CommissionRow {
  name: string
  customers: number
  revenue: number
  rate: number
  commission: number
  isOverride: boolean
  paid: boolean
}

// ─── Structure Editor ─────────────────────────────────────────────────────────

function TierRow({
  tier, index, sortedTiers, onChange, onRemove,
}: {
  tier: CommissionTier
  index: number
  sortedTiers: CommissionTier[]
  onChange: (i: number, t: CommissionTier) => void
  onRemove: (i: number) => void
}) {
  const isUnlimited = tier.upTo === null
  const canRemove   = sortedTiers.length > 1 && !isUnlimited

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {isUnlimited ? (
        <span className="text-sm text-gray-400 flex-1">All revenue above previous tiers</span>
      ) : (
        <>
          <span className="text-sm text-gray-400 shrink-0">Revenue ≤ $</span>
          <input
            type="number"
            min="0"
            step="500"
            value={tier.upTo ?? ''}
            onChange={e => onChange(index, { ...tier, upTo: parseFloat(e.target.value) || 0 })}
            className="w-24 bg-gray-700 border border-gray-600 rounded px-2 py-1 text-right text-sm text-white focus:outline-none focus:border-indigo-500"
          />
        </>
      )}
      <span className="text-sm text-gray-500 shrink-0">→</span>
      <input
        type="number"
        min="0"
        max="100"
        step="0.1"
        value={tier.rate}
        onChange={e => onChange(index, { ...tier, rate: parseFloat(e.target.value) || 0 })}
        className="w-16 bg-gray-700 border border-gray-600 rounded px-2 py-1 text-right text-sm text-white focus:outline-none focus:border-indigo-500"
      />
      <span className="text-sm text-gray-400 shrink-0">%</span>
      {canRemove && (
        <button onClick={() => onRemove(index)} className="text-red-400 hover:text-red-300 text-base leading-none">✕</button>
      )}
    </div>
  )
}

function StructureEditor({
  initial, onSave, onCancel,
}: {
  initial: CommissionStructure
  onSave: (s: CommissionStructure) => Promise<void>
  onCancel: () => void
}) {
  const [draft, setDraft]     = useState<CommissionStructure>(initial)
  const [saving, setSaving]   = useState(false)
  const [newName, setNewName] = useState('')

  const sortedTiers = useMemo(
    () => [...draft.tiers].sort((a, b) => (a.upTo ?? Infinity) - (b.upTo ?? Infinity)),
    [draft.tiers],
  )

  function updateTier(sortedIndex: number, t: CommissionTier) {
    const tierToReplace = sortedTiers[sortedIndex]
    setDraft(d => ({ ...d, tiers: d.tiers.map(x => x === tierToReplace ? t : x) }))
  }

  function removeTier(sortedIndex: number) {
    const tierToRemove = sortedTiers[sortedIndex]
    setDraft(d => ({ ...d, tiers: d.tiers.filter(x => x !== tierToRemove) }))
  }

  function addTier() {
    const bounded = draft.tiers.filter(t => t.upTo !== null)
    const maxUpTo = bounded.length > 0 ? Math.max(...bounded.map(t => t.upTo!)) : 0
    const newTier: CommissionTier = { upTo: maxUpTo + 5000, rate: draft.defaultRate }
    const unlimited = draft.tiers.find(t => t.upTo === null) ?? { upTo: null, rate: draft.defaultRate }
    setDraft(d => ({ ...d, tiers: [...d.tiers.filter(t => t.upTo !== null), newTier, unlimited] }))
  }

  function switchToTiered() {
    const tiers = draft.tiers.length > 0 ? draft.tiers : [
      { upTo: 5000,  rate: 5  },
      { upTo: 10000, rate: 8  },
      { upTo: null,  rate: 10 },
    ]
    setDraft(d => ({ ...d, mode: 'tiered', tiers }))
  }

  function addOverride() {
    const name = newName.trim()
    if (!name || draft.overrides[name] !== undefined) return
    setDraft(d => ({ ...d, overrides: { ...d.overrides, [name]: d.defaultRate } }))
    setNewName('')
  }

  function removeOverride(name: string) {
    const { [name]: _, ...rest } = draft.overrides
    setDraft(d => ({ ...d, overrides: rest }))
  }

  async function handleSave() {
    setSaving(true)
    try { await onSave(draft) } finally { setSaving(false) }
  }

  return (
    <div className="card border border-indigo-500/30 p-5 space-y-5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white">Commission Structure</h3>
        <button onClick={onCancel} className="text-gray-500 hover:text-gray-300 text-lg leading-none">✕</button>
      </div>

      {/* Mode toggle */}
      <div>
        <p className="text-xs text-gray-500 mb-2">Rate mode</p>
        <div className="flex gap-2">
          <button
            onClick={() => setDraft(d => ({ ...d, mode: 'flat' }))}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              draft.mode === 'flat' ? 'bg-indigo-600 text-white' : 'bg-gray-700 text-gray-400 hover:text-gray-200'
            }`}
          >
            Flat Rate
          </button>
          <button
            onClick={switchToTiered}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              draft.mode === 'tiered' ? 'bg-indigo-600 text-white' : 'bg-gray-700 text-gray-400 hover:text-gray-200'
            }`}
          >
            Tiered Brackets
          </button>
        </div>
      </div>

      {/* Flat mode */}
      {draft.mode === 'flat' && (
        <div className="flex items-center gap-3">
          <label className="text-sm text-gray-400">Default rate</label>
          <input
            type="number"
            min="0"
            max="100"
            step="0.1"
            value={draft.defaultRate}
            onChange={e => setDraft(d => ({ ...d, defaultRate: parseFloat(e.target.value) || 0 }))}
            className="w-20 bg-gray-700 border border-gray-600 rounded px-2 py-1 text-right text-sm text-white focus:outline-none focus:border-indigo-500"
          />
          <span className="text-sm text-gray-400">%</span>
        </div>
      )}

      {/* Tiered mode */}
      {draft.mode === 'tiered' && (
        <div className="space-y-2.5">
          <p className="text-xs text-gray-500">
            Revenue is compared to each tier's ceiling — the entire amount is rated at the matching tier's rate.
          </p>
          {sortedTiers.map((tier, i) => (
            <TierRow
              key={i}
              tier={tier}
              index={i}
              sortedTiers={sortedTiers}
              onChange={updateTier}
              onRemove={removeTier}
            />
          ))}
          <button
            onClick={addTier}
            className="text-sm text-indigo-400 hover:text-indigo-300 transition-colors"
          >
            + Add Tier
          </button>
        </div>
      )}

      {/* Per-salesman overrides */}
      <div className="border-t border-gray-700/60 pt-4 space-y-3">
        <div>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Per-Salesman Overrides</p>
          <p className="text-xs text-gray-600 mt-0.5">Overrides the structure for a specific person and takes priority over all tiers.</p>
        </div>
        {Object.entries(draft.overrides).map(([name, rate]) => (
          <div key={name} className="flex items-center gap-3">
            <span className="text-sm text-gray-300 flex-1 truncate">{name}</span>
            <input
              type="number"
              min="0"
              max="100"
              step="0.1"
              value={rate}
              onChange={e => setDraft(d => ({ ...d, overrides: { ...d.overrides, [name]: parseFloat(e.target.value) || 0 } }))}
              className="w-16 bg-gray-700 border border-gray-600 rounded px-2 py-1 text-right text-sm text-white focus:outline-none focus:border-indigo-500"
            />
            <span className="text-sm text-gray-400">%</span>
            <button onClick={() => removeOverride(name)} className="text-red-400 hover:text-red-300 text-base leading-none">✕</button>
          </div>
        ))}
        <div className="flex items-center gap-2">
          <input
            type="text"
            placeholder="Salesman name…"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addOverride()}
            className="flex-1 bg-gray-700 border border-gray-600 rounded px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"
          />
          <button
            onClick={addOverride}
            disabled={!newName.trim()}
            className="text-sm text-indigo-400 hover:text-indigo-300 disabled:opacity-40 transition-colors"
          >
            + Add
          </button>
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-3 pt-1">
        <button onClick={onCancel} className="btn-secondary text-sm px-4 py-2">Cancel</button>
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-500 disabled:opacity-50 transition-colors"
        >
          {saving ? 'Saving…' : 'Save Structure'}
        </button>
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function CommissionPage() {
  usePageTitle('Commission')
  const companyId = useAuthStore(s => s.companyId)
  const labels    = usePickerStore(s => s.labels)
  const smLabel   = labels.salesman ?? 'Salesman'

  const [all, setAll]         = useState<CustomerItem[]>([])
  const [loading, setLoading] = useState(true)
  const [period, setPeriod]   = useState<Period>('month')

  const [structure, setStructure]   = useState<CommissionStructure>(DEFAULT_STRUCTURE)
  const [showEditor, setShowEditor] = useState(false)

  const [paid, setPaid]           = useState<Record<string, boolean>>({})
  const [editingRate, setEditingRate] = useState<string | null>(null)
  const [editValue,   setEditValue]   = useState('')
  const [inclCats, setInclCats] = useState<Set<string>>(new Set(['customer', 'lead']))

  function toggleCat(cat: string) {
    setInclCats(prev => {
      const next = new Set(prev)
      if (next.has(cat) && next.size > 1) next.delete(cat)
      else next.add(cat)
      return next
    })
  }

  // Load paid status from localStorage (period-specific, local is fine)
  useEffect(() => {
    if (!companyId) return
    try { setPaid(JSON.parse(localStorage.getItem(`commission_paid_${companyId}`) ?? '{}')) } catch { setPaid({}) }
  }, [companyId])

  // Subscribe to commission structure from Firestore (shared across team)
  useEffect(() => subscribeToCommissionStructure(setStructure), [companyId])

  useEffect(() => {
    setLoading(true)
    const unsub = subscribeToCustomers(
      items => { setAll(items); setLoading(false) },
      ()    => setLoading(false),
    )
    return unsub
  }, [companyId])

  const { start, end } = useMemo(() => getPeriodRange(period), [period])
  const pKey = useMemo(() => periodKey(start, end), [start, end])

  const periodItems = useMemo(
    () => all.filter(c => c.creationDate >= start && c.creationDate <= end),
    [all, start, end],
  )

  const rows = useMemo<CommissionRow[]>(() => {
    const map = new Map<string, { customers: number; revenue: number }>()
    for (const c of periodItems) {
      if (!inclCats.has(c.category.toLowerCase())) continue
      const name = c.salesman.trim() || 'Unassigned'
      const row  = map.get(name) ?? { customers: 0, revenue: 0 }
      row.customers++
      row.revenue += c.amount
      map.set(name, row)
    }
    return [...map.entries()]
      .map(([name, { customers, revenue }]) => {
        const { commission, rate, isOverride } = calcCommission(revenue, structure, name)
        const isPaid = paid[`${name}|||${pKey}`] ?? false
        return { name, customers, revenue, rate, commission, isOverride, paid: isPaid }
      })
      .sort((a, b) => b.revenue - a.revenue)
  }, [periodItems, structure, paid, pKey, inclCats])

  const totals = useMemo(() => ({
    revenue:     rows.reduce((s, r) => s + r.revenue, 0),
    commission:  rows.reduce((s, r) => s + r.commission, 0),
    paidAmt:     rows.filter(r =>  r.paid).reduce((s, r) => s + r.commission, 0),
    outstanding: rows.filter(r => !r.paid).reduce((s, r) => s + r.commission, 0),
  }), [rows])

  function togglePaid(name: string) {
    const key  = `${name}|||${pKey}`
    const next = { ...paid, [key]: !(paid[key] ?? false) }
    setPaid(next)
    if (companyId) localStorage.setItem(`commission_paid_${companyId}`, JSON.stringify(next))
  }

  // Inline rate edit writes a per-salesman override to Firestore
  function startEdit(name: string, rate: number) {
    setEditingRate(name)
    setEditValue(String(rate))
  }

  function commitEdit(name: string) {
    const n = parseFloat(editValue)
    if (!isNaN(n) && n >= 0 && n <= 100) {
      const next = { ...structure, overrides: { ...structure.overrides, [name]: n } }
      saveCommissionStructure(next).catch(() => {})
    }
    setEditingRate(null)
  }

  function clearOverride(name: string, e: React.MouseEvent) {
    e.stopPropagation()
    const { [name]: _, ...rest } = structure.overrides
    saveCommissionStructure({ ...structure, overrides: rest }).catch(() => {})
  }

  function structureLabel(): string {
    if (structure.mode === 'flat') return `Flat ${structure.defaultRate}%`
    return `${structure.tiers.length}-tier bracket`
  }

  function exportCSV() {
    const header  = [smLabel, 'Customers', 'Revenue', 'Rate %', 'Override', 'Commission', 'Status']
    const csvRows = rows.map(r => [
      r.name, r.customers, r.revenue.toFixed(2),
      r.rate.toFixed(1), r.isOverride ? 'Yes' : 'No',
      r.commission.toFixed(2), r.paid ? 'Paid' : 'Unpaid',
    ])
    const csv  = [header, ...csvRows].map(row => row.map(v => `"${v}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `commission-${period}-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-5">

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-white">Commission Tracker</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            Tap a rate to override · tap a row to mark paid
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <button
            onClick={() => setShowEditor(s => !s)}
            className={`text-sm px-3 py-1.5 rounded-lg font-medium transition-colors ${
              showEditor
                ? 'bg-indigo-600 text-white'
                : 'bg-gray-700 text-gray-300 hover:text-white'
            }`}
          >
            ⚙ Structure
            <span className="ml-1.5 text-xs opacity-60">({structureLabel()})</span>
          </button>
          <button onClick={exportCSV} disabled={loading || rows.length === 0} className="btn-secondary text-sm px-3 py-1.5">
            ↓ CSV
          </button>
        </div>
      </div>

      {/* Structure editor panel */}
      {showEditor && (
        <StructureEditor
          initial={structure}
          onSave={async s => { await saveCommissionStructure(s); setShowEditor(false) }}
          onCancel={() => setShowEditor(false)}
        />
      )}

      {/* Period selector + category toggles */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex gap-1.5 flex-wrap">
          {PERIODS.map(p => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors whitespace-nowrap ${
                period === p ? 'bg-indigo-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-gray-200'
              }`}
            >
              {PERIOD_LABELS[p]}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5 border-l border-gray-700 pl-4">
          <span className="text-xs text-gray-500 mr-0.5">Include:</span>
          {(['customer', 'lead'] as const).map(cat => (
            <button
              key={cat}
              onClick={() => toggleCat(cat)}
              className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors capitalize ${
                inclCats.has(cat)
                  ? cat === 'customer' ? 'bg-teal-600 text-white' : 'bg-orange-600 text-white'
                  : 'bg-gray-800 text-gray-500 hover:text-gray-300'
              }`}
            >
              {cat === 'customer' ? 'Customers' : 'Leads'}
            </button>
          ))}
        </div>
      </div>

      {/* KPI cards */}
      {!loading && rows.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <div className="card p-4">
            <p className="text-xs text-gray-500 mb-1.5">Total Commission</p>
            <p className="text-xl font-bold text-yellow-400">{formatCurrency(totals.commission)}</p>
          </div>
          <div className="card p-4">
            <p className="text-xs text-gray-500 mb-1.5">Paid</p>
            <p className="text-xl font-bold text-green-400">{formatCurrency(totals.paidAmt)}</p>
          </div>
          <div className="card p-4">
            <p className="text-xs text-gray-500 mb-1.5">Outstanding</p>
            <p className={`text-xl font-bold ${totals.outstanding > 0 ? 'text-red-400' : 'text-gray-500'}`}>
              {formatCurrency(totals.outstanding)}
            </p>
          </div>
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div className="card animate-pulse h-48" />
      ) : rows.length === 0 ? (
        <div className="card p-10 text-center">
          <p className="text-gray-400 text-sm">No customer revenue for this period.</p>
          <p className="text-gray-600 text-xs mt-1">Try selecting a wider date range.</p>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-700/50 bg-gray-800/50 flex items-center justify-between">
            <p className="text-sm font-semibold text-gray-200">
              {smLabel} Commission
              {inclCats.size > 1 && <span className="ml-2 text-xs font-normal text-gray-500">(Leads + Customers)</span>}
            </p>
            <div className="flex items-center gap-3">
              {structure.mode === 'tiered' && (
                <span className="text-xs text-indigo-400 bg-indigo-900/30 px-2 py-0.5 rounded-full">
                  {structure.tiers.length}-tier bracket
                </span>
              )}
              <p className="text-xs text-gray-500">Default: {structure.defaultRate}%</p>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-500 uppercase tracking-wider border-b border-gray-700/40">
                  <th className="px-4 py-2 text-left font-medium">{smLabel}</th>
                  <th className="px-3 py-2 text-right font-medium">Sales</th>
                  <th className="px-3 py-2 text-right font-medium">Revenue</th>
                  <th className="px-3 py-2 text-right font-medium">Rate</th>
                  <th className="px-3 py-2 text-right font-medium">Commission</th>
                  <th className="px-3 py-2 text-center font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700/30">
                {rows.map(r => (
                  <tr
                    key={r.name}
                    onClick={() => togglePaid(r.name)}
                    className={`cursor-pointer transition-colors ${
                      r.paid ? 'bg-green-900/10 hover:bg-green-900/20' : 'hover:bg-gray-700/20'
                    }`}
                  >
                    <td className="px-4 py-3 text-gray-200 font-medium">{r.name}</td>
                    <td className="px-3 py-3 text-right text-gray-400 tabular-nums">{r.customers}</td>
                    <td className="px-3 py-3 text-right text-gray-300 font-medium tabular-nums">
                      {formatCurrency(r.revenue)}
                    </td>
                    <td
                      className="px-3 py-3 text-right"
                      onClick={e => { e.stopPropagation(); startEdit(r.name, r.rate) }}
                    >
                      {editingRate === r.name ? (
                        <input
                          autoFocus
                          type="number"
                          min="0"
                          max="100"
                          step="0.1"
                          value={editValue}
                          onChange={e => setEditValue(e.target.value)}
                          onBlur={() => commitEdit(r.name)}
                          onKeyDown={e => {
                            if (e.key === 'Enter')  commitEdit(r.name)
                            if (e.key === 'Escape') setEditingRate(null)
                          }}
                          className="w-16 bg-gray-700 border border-indigo-500 rounded px-1.5 py-0.5 text-right text-xs text-white focus:outline-none"
                          onClick={e => e.stopPropagation()}
                        />
                      ) : (
                        <span className="inline-flex items-center gap-1">
                          <span className={`text-xs hover:text-indigo-100 cursor-text underline decoration-dotted tabular-nums ${
                            r.isOverride ? 'text-orange-300' : 'text-indigo-300'
                          }`}>
                            {r.rate.toFixed(1)}%
                          </span>
                          {r.isOverride && (
                            <button
                              title="Clear override"
                              onClick={e => clearOverride(r.name, e)}
                              className="text-gray-600 hover:text-red-400 text-xs leading-none transition-colors"
                            >
                              ×
                            </button>
                          )}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-right text-yellow-400 font-semibold tabular-nums">
                      {formatCurrency(r.commission)}
                    </td>
                    <td className="px-3 py-3 text-center">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                        r.paid ? 'bg-green-900/40 text-green-400' : 'bg-gray-700/60 text-gray-400'
                      }`}>
                        {r.paid ? '✓ Paid' : 'Unpaid'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-gray-700 bg-gray-800/60">
                  <td className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider" colSpan={2}>
                    Totals
                  </td>
                  <td className="px-3 py-3 text-right text-white font-bold tabular-nums">
                    {formatCurrency(totals.revenue)}
                  </td>
                  <td />
                  <td className="px-3 py-3 text-right text-yellow-400 font-bold tabular-nums">
                    {formatCurrency(totals.commission)}
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
          {/* Tier legend */}
          {structure.mode === 'tiered' && structure.tiers.length > 0 && (
            <div className="px-4 py-2.5 border-t border-gray-700/40 bg-gray-800/30">
              <p className="text-xs text-gray-500">
                Brackets: {[...structure.tiers]
                  .sort((a, b) => (a.upTo ?? Infinity) - (b.upTo ?? Infinity))
                  .map(t => t.upTo !== null
                    ? `≤${formatCurrency(t.upTo)} → ${t.rate}%`
                    : `above → ${t.rate}%`
                  ).join(' · ')}
              </p>
            </div>
          )}
        </div>
      )}

      <p className="text-xs text-gray-600 text-center pb-2">
        Structure synced across team · paid status saved in this browser
      </p>
    </div>
  )
}
