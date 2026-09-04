import { useEffect, useMemo, useState } from 'react'
import { Icon, ICONS } from '../../components/Icon'
import PartialDataBanner from '../../components/PartialDataBanner'
import StatCard from '../../components/StatCard'
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

// ─── Row controls ─────────────────────────────────────────────────────────────
// Extracted because the table and the phone card layout both render them, and
// they're the two controls this page exists to operate — a second copy is how
// the paid pill and the rate affordance would drift apart.

/** The paid/unpaid state, as the control that sets it. */
function PaidToggle({ row, onToggle }: { row: CommissionRow; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={row.paid}
      aria-label={`Mark ${row.name}'s commission of ${formatCurrency(row.commission)} as ${row.paid ? 'unpaid' : 'paid'}`}
      onClick={onToggle}
      className={`inline-flex items-center gap-1.5 pl-1.5 pr-2.5 py-1 rounded-full border text-xs font-semibold shrink-0
                  transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
        row.paid
          ? 'bg-green-900/40 text-green-400 border-green-600/50 hover:bg-green-900/60'
          : 'bg-gray-700/60 text-gray-300 border-gray-500 hover:bg-gray-700'
      }`}
    >
      <span className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${
        row.paid ? 'bg-green-600 border-green-600' : 'border-gray-400'
      }`}>
        {/* Inline rather than <Icon>: that component pins strokeWidth 2, which at
            12px renders a check too faint to read inside the filled circle. */}
        {row.paid && (
          <svg className="w-2.5 h-2.5 icon-on-solid" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        )}
      </span>
      {row.paid ? 'Paid' : 'Unpaid'}
    </button>
  )
}

/** The commission rate, editable in place. */
function RateControl({
  row, isEditing, value, onChange, onStart, onCommit, onCancel, onClear,
}: {
  row: CommissionRow
  isEditing: boolean
  value: string
  onChange: (v: string) => void
  onStart: () => void
  onCommit: () => void
  onCancel: () => void
  onClear: (e: React.MouseEvent) => void
}) {
  if (isEditing) {
    return (
      <input
        autoFocus
        type="number"
        min="0"
        max="100"
        step="0.1"
        value={value}
        onChange={e => onChange(e.target.value)}
        onBlur={onCommit}
        onKeyDown={e => {
          if (e.key === 'Enter')  onCommit()
          if (e.key === 'Escape') onCancel()
        }}
        className="w-16 bg-gray-700 border border-indigo-500 rounded px-1.5 py-0.5 text-right text-xs text-white focus:outline-none"
      />
    )
  }
  return (
    <span className="inline-flex items-center gap-1">
      {/* A dashed outline plus a pencil, not the old dotted underline with
          cursor-text: a dotted underline reads as "definition, hover for a
          tooltip", and cursor-text promised a text field that wasn't there. A
          real button also makes the editor keyboard-reachable, which a span with
          a click handler on its parent cell never was. */}
      <button
        type="button"
        onClick={onStart}
        title={row.isOverride ? 'Overridden rate — edit' : 'Edit rate for this person'}
        aria-label={`Edit commission rate for ${row.name}, currently ${row.rate.toFixed(1)}%`}
        className={`inline-flex items-center gap-1 px-1.5 py-1 rounded border border-dashed
                    transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
          row.isOverride
            ? 'text-orange-300 border-orange-400/50 hover:bg-orange-900/20'
            : 'text-indigo-300 border-indigo-400/50 hover:bg-indigo-900/20'
        }`}
      >
        <span className="text-xs tabular-nums">{row.rate.toFixed(1)}%</span>
        <Icon d={ICONS.pencil} className="w-3 h-3 opacity-70" />
      </button>
      {/* Was a bare × glyph — a different codepoint from the ✕ used elsewhere on
          this page — at text-xs, giving a roughly 7×8px target against the 24px
          WCAG 2.5.8 minimum, coloured text-gray-600 at 1.94:1 on the card. The
          padded icon button is ~26px and gray-400 is 5.78:1. */}
      {row.isOverride && (
        <button
          type="button"
          title="Clear override"
          aria-label={`Clear the rate override for ${row.name}`}
          onClick={onClear}
          className="p-1.5 rounded text-gray-400 hover:text-red-400 hover:bg-gray-700/50 transition-colors
                     focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        >
          <Icon d={ICONS.close} className="w-3.5 h-3.5" />
        </button>
      )}
    </span>
  )
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
      <Icon d={ICONS.arrowRight} className="w-3.5 h-3.5 text-gray-400 shrink-0" />
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
        <button
          type="button"
          onClick={() => onRemove(index)}
          aria-label="Remove this tier"
          title="Remove tier"
          className="p-1.5 rounded text-red-400 hover:text-red-300 hover:bg-gray-700/50 transition-colors
                     focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        >
          <Icon d={ICONS.close} className="w-3.5 h-3.5" />
        </button>
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
        <button
          type="button"
          onClick={onCancel}
          aria-label="Close the structure editor"
          className="p-1.5 -mr-1.5 rounded text-gray-400 hover:text-gray-200 hover:bg-gray-700/50 transition-colors
                     focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        >
          <Icon d={ICONS.close} className="w-4 h-4" />
        </button>
      </div>

      {/* Mode toggle */}
      <div>
        <p className="text-xs text-gray-400 mb-2">Rate mode</p>
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
          <p className="text-xs text-gray-400">
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
          <p className="text-xs text-gray-400 mt-0.5">Overrides the structure for a specific person and takes priority over all tiers.</p>
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
            <button
              type="button"
              onClick={() => removeOverride(name)}
              aria-label={`Remove the rate override for ${name}`}
              title="Remove override"
              className="p-1.5 rounded text-red-400 hover:text-red-300 hover:bg-gray-700/50 transition-colors
                         focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            >
              <Icon d={ICONS.close} className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
        <div className="flex items-center gap-2">
          <input
            type="text"
            placeholder="Salesman name…"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addOverride()}
            className="flex-1 bg-gray-700 border border-gray-600 rounded px-3 py-1.5 text-sm text-white placeholder-gray-400 focus:outline-none focus:border-indigo-500"
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

      {/* Actions. The "synced across team" half of the old page footnote lives
          here, next to the button that does the syncing, rather than centred at
          the bottom of the page in text-gray-600. */}
      <div className="flex items-center gap-3 pt-1">
        <button onClick={onCancel} className="btn-secondary text-sm px-4 py-2">Cancel</button>
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-500 disabled:opacity-50 transition-colors"
        >
          {saving ? 'Saving…' : 'Save Structure'}
        </button>
        <p className="text-xs text-gray-400">Shared with everyone on your team.</p>
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
  const [hitCap, setHitCap] = useState(false)
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
      (items, cap) => { setAll(items); setHitCap(!!cap); setLoading(false) },
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
      {hitCap && <PartialDataBanner totals />}

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-white">Commission Tracker</h1>
          {/* Was "Tap a rate to override · tap a row to mark paid" — instructions
              standing in for affordances that didn't exist. The rate and the paid
              status are now buttons that look like buttons, so the subtitle can
              describe the page instead of operating it. */}
          <p className="text-sm text-gray-400 mt-0.5">
            Rates, payouts and structure for the selected period
          </p>
        </div>
        {/* ⚙ and ↓ were rendered from Apple Color Emoji, which paints its own
            colour and ignores the button's — so neither followed the Structure
            button's active state or its light-mode text colour. Both are now
            currentColor SVGs from the shared Icon set. */}
        <div className="flex gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setShowEditor(s => !s)}
            aria-expanded={showEditor}
            className={`inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg font-medium transition-colors ${
              showEditor
                ? 'bg-indigo-600 text-white'
                : 'bg-gray-700 text-gray-300 hover:text-white'
            }`}
          >
            <Icon d={[ICONS.cog, ICONS.cogInner]} className="w-4 h-4 shrink-0" />
            Structure
            <span className="text-xs opacity-60">({structureLabel()})</span>
          </button>
          <button
            type="button"
            onClick={exportCSV}
            disabled={loading || rows.length === 0}
            className="btn-secondary inline-flex items-center gap-1.5 text-sm px-3 py-1.5 disabled:opacity-50"
          >
            <Icon d={ICONS.downloadTray} className="w-4 h-4 shrink-0" />
            CSV
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
        {/* Divider only from sm up: the header is flex-wrap, so on a phone this
            group drops to its own line and a left border became a stray vertical
            rule hanging off the start of it. */}
        <div className="flex items-center gap-1.5 sm:border-l sm:border-gray-700 sm:pl-4">
          <span className="text-xs text-gray-400 mr-0.5">Include:</span>
          {/* Selected is indigo, the same as the period pills above, because
              "selected" is one idea and the app already spells it that way. The
              teal/orange pair it replaces gave two hues no meaning beyond
              identifying which pill was which — and teal-600 against orange-600
              is 1.05:1 in relative luminance, i.e. identical brightness, so the
              on/off read was pure hue and vanished in greyscale or for a
              red-green colourblind viewer. Dropping orange here also leaves it
              meaning exactly one thing on this page: an overridden rate. */}
          {(['customer', 'lead'] as const).map(cat => {
            const on   = inclCats.has(cat)
            const last = on && inclCats.size === 1
            return (
              <button
                key={cat}
                type="button"
                aria-pressed={on}
                onClick={() => toggleCat(cat)}
                title={last ? 'At least one category has to stay included' : undefined}
                className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                  on ? 'bg-indigo-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-gray-200'
                } ${last ? 'cursor-default' : ''}`}
              >
                {cat === 'customer' ? 'Customers' : 'Leads'}
              </button>
            )
          })}
        </div>
      </div>

      {/* Three StatCards, not three hand-rolled ones. The originals reimplemented
          the component from scratch and so missed its sm:text-2xl step-up, its
          min-h-[78px] alignment and its truncate guard — and at text-xl they were
          outweighed by an h1 at text-2xl, on a page whose entire purpose is the
          money. Total Commission keeps text-yellow-400 so it matches the column
          and the totals row rather than restating the same figure in a third
          size and weight.

          The responsive grid stays from the overflow fix: grid-cols-3 with no
          breakpoint left 74px of content width per card at 375px (343px − 24px of
          gaps − 32px of padding) against ~89px for "$124,500", which StatCard
          would truncate rather than overflow. Full width on a phone costs about
          96px of height and clips nothing. */}
      {!loading && rows.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-3">
          <StatCard title="Total Commission" value={formatCurrency(totals.commission)} color="text-yellow-400" />
          <StatCard title="Paid"             value={formatCurrency(totals.paidAmt)}    color="text-green-400" />
          <StatCard
            title="Outstanding"
            value={formatCurrency(totals.outstanding)}
            color={totals.outstanding > 0 ? 'text-red-400' : 'text-gray-400'}
          />
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div className="card animate-pulse h-48" />
      ) : rows.length === 0 ? (
        <div className="card p-10 text-center">
          <p className="text-gray-400 text-sm">No customer revenue for this period.</p>
          <p className="text-gray-400 text-xs mt-1">Try selecting a wider date range.</p>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-700/50 bg-gray-800/50 space-y-1.5">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-semibold text-gray-200">
                {smLabel} Commission
                {inclCats.size > 1 && <span className="ml-2 text-xs font-normal text-gray-400">(Leads + Customers)</span>}
              </p>
              <div className="flex items-center gap-3">
                {structure.mode === 'tiered' && (
                  <span className="text-xs text-indigo-400 bg-indigo-900/30 px-2 py-0.5 rounded-full">
                    {structure.tiers.length}-tier bracket
                  </span>
                )}
                <p className="text-xs text-gray-400">Default: {structure.defaultRate}%</p>
              </div>
            </div>
            {/* Half of the old centred footnote, moved to the thing it describes.
                "paid status saved in this browser" sat at text-gray-600 (1.94:1)
                below the fold — a data-durability warning styled as a footnote, on
                the one page where the durability of a payout record matters. It
                now sits above the Status column at 5.78:1, with the other half
                ("structure synced across team") moved into the structure editor. */}
            <p className="flex items-start gap-1.5 text-xs text-gray-400">
              <Icon d={ICONS.warning} className="w-3.5 h-3.5 shrink-0 mt-px text-amber-400" />
              Paid marks are saved in this browser only — teammates won't see them, and clearing site data clears them.
            </p>
          </div>
          {/* Six columns in an overflow-x-auto meant a phone couldn't show a name
              and their commission at the same time — you scrolled right to read
              the number and lost the label. Every other list route in this app
              pairs its table with a card layout; this one had none, while its own
              subtitle said "Tap". The two controls come from PaidToggle and
              RateControl so both layouts stay in step. */}
          <div className="hidden sm:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                {/* Status leads the row rather than trailing it. As the last of
                    six columns it was the first thing pushed off-screen by the
                    horizontal scroller, so the one piece of state the page tracks
                    was the one you had to scroll to find. Leading it also matches
                    the toggle-strip-on-the-left layout /todo uses. */}
                <tr className="text-xs text-gray-400 uppercase tracking-wider border-b border-gray-700/40">
                  <th className="pl-3 pr-2 py-2 text-left font-medium">Status</th>
                  <th className="px-3 py-2 text-left font-medium">{smLabel}</th>
                  <th className="px-3 py-2 text-right font-medium">Sales</th>
                  <th className="px-3 py-2 text-right font-medium">Revenue</th>
                  <th className="px-3 py-2 text-right font-medium">Rate</th>
                  <th className="px-3 py-2 text-right font-medium">Commission</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700/30">
                {/* The row itself is no longer a control. It used to carry an
                    onClick that toggled paid, while the Rate cell stopped
                    propagation to open an editor instead — so the two actions were
                    told apart only by where in the row you happened to click, with
                    no boundary drawn, no confirm and no undo. A click meant for the
                    rate that landed on Revenue silently marked someone paid. */}
                {rows.map(r => (
                  <tr
                    key={r.name}
                    className={`transition-colors ${
                      r.paid ? 'bg-green-900/20 hover:bg-green-900/40' : 'hover:bg-gray-700/20'
                    }`}
                  >
                    {/* A 3px bg-green-600 rule carries the paid state, because the
                        row tint can't: bg-green-900/10 composited to #1e2d36 on the
                        #1f2937 card — 1.04:1 — and 1.18:1 over white in light mode,
                        against the 3:1 WCAG 1.4.11 asks of a state indicator. No
                        alpha tint gets there (even /30 only reaches 1.14:1), so the
                        tint is now decoration and the bar is the signal. green-600
                        is the one shade that clears 3:1 in both themes: 4.45:1 on
                        the dark card, 3.30:1 on the white one. The /20 tint also
                        replaces /10 because /20 is the shade index.css has a
                        light-mode override for. */}
                    <td className={`pl-3 pr-2 py-3 border-l-[3px] ${r.paid ? 'border-green-600' : 'border-transparent'}`}>
                      <PaidToggle row={r} onToggle={() => togglePaid(r.name)} />
                    </td>
                    <td className="px-3 py-3 text-gray-200 font-medium">{r.name}</td>
                    <td className="px-3 py-3 text-right text-gray-400 tabular-nums">{r.customers}</td>
                    <td className="px-3 py-3 text-right text-gray-300 font-medium tabular-nums">
                      {formatCurrency(r.revenue)}
                    </td>
                    <td className="px-3 py-3 text-right">
                      <RateControl
                        row={r}
                        isEditing={editingRate === r.name}
                        value={editValue}
                        onChange={setEditValue}
                        onStart={() => startEdit(r.name, r.rate)}
                        onCommit={() => commitEdit(r.name)}
                        onCancel={() => setEditingRate(null)}
                        onClear={e => clearOverride(r.name, e)}
                      />
                    </td>
                    <td className="px-3 py-3 text-right text-yellow-400 font-semibold tabular-nums">
                      {formatCurrency(r.commission)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-gray-700 bg-gray-800/60">
                  {/* colSpan 3, not 2: Status now sits ahead of the name, so the
                      label has to span Status + name + Sales to keep the Revenue
                      and Commission totals under their columns. */}
                  <td className="pl-3 pr-2 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider" colSpan={3}>
                    Totals
                  </td>
                  <td className="px-3 py-3 text-right text-white font-bold tabular-nums">
                    {formatCurrency(totals.revenue)}
                  </td>
                  <td />
                  <td className="px-3 py-3 text-right text-yellow-400 font-bold tabular-nums">
                    {formatCurrency(totals.commission)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Phone layout: name and commission on one screen, no sideways scroll.
              Same 3px paid rule as the table row, so the two agree. */}
          <div className="sm:hidden divide-y divide-gray-700/30">
            {rows.map(r => (
              <div
                key={r.name}
                className={`p-3 border-l-[3px] ${r.paid ? 'border-green-600 bg-green-900/20' : 'border-transparent'}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium text-gray-200 min-w-0 truncate">{r.name}</p>
                  <PaidToggle row={r} onToggle={() => togglePaid(r.name)} />
                </div>
                <div className="flex items-end justify-between gap-3 mt-2">
                  <div className="min-w-0">
                    <p className="text-xs text-gray-400 tabular-nums">
                      {formatCurrency(r.revenue)} revenue · {r.customers} {r.customers === 1 ? 'sale' : 'sales'}
                    </p>
                    <div className="mt-1.5">
                      <RateControl
                        row={r}
                        isEditing={editingRate === r.name}
                        value={editValue}
                        onChange={setEditValue}
                        onStart={() => startEdit(r.name, r.rate)}
                        onCommit={() => commitEdit(r.name)}
                        onCancel={() => setEditingRate(null)}
                        onClear={e => clearOverride(r.name, e)}
                      />
                    </div>
                  </div>
                  <p className="text-base font-semibold text-yellow-400 tabular-nums shrink-0">
                    {formatCurrency(r.commission)}
                  </p>
                </div>
              </div>
            ))}
            {/* Stands in for the table's tfoot, which a card list has no room for. */}
            <div className="flex items-baseline justify-between gap-3 px-3 py-3 border-t border-gray-700 bg-gray-800/60">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Totals</p>
              <p className="text-xs text-gray-400 tabular-nums">{formatCurrency(totals.revenue)} revenue</p>
              <p className="text-base font-bold text-yellow-400 tabular-nums">{formatCurrency(totals.commission)}</p>
            </div>
          </div>

          {/* Tier legend */}
          {structure.mode === 'tiered' && structure.tiers.length > 0 && (
            <div className="px-4 py-2.5 border-t border-gray-700/40 bg-gray-800/30">
              <p className="text-xs text-gray-400">
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

    </div>
  )
}
