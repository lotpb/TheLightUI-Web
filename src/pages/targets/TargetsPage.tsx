import { useEffect, useMemo, useState } from 'react'
import { usePageTitle } from '../../hooks/usePageTitle'
import { subscribeToCustomers } from '../../services/customerService'
import { formatCurrency, type CustomerItem } from '../../models/customer'
import { usePickerStore } from '../../stores/pickerStore'
import { useToast } from '../../components/Toast'
import { Icon, ICONS } from '../../components/Icon'
import ConfirmModal from '../../components/ConfirmModal'
import {
  subscribeToTargets, saveTargets, DEFAULT_GOALS,
  type GoalsMap, type PersonGoals,
} from '../../services/targetService'

// ─── Period ───────────────────────────────────────────────────────────────────

type Period = 'week' | 'month' | 'lastMonth' | 'quarter' | 'year'

const PERIOD_LABELS: Record<Period, string> = {
  week: 'This Week', month: 'This Month', lastMonth: 'Last Month',
  quarter: 'This Quarter', year: 'This Year',
}

const PERIODS: Period[] = ['week', 'month', 'lastMonth', 'quarter', 'year']

function getPeriodRange(period: Period): { start: Date; end: Date } {
  const now = new Date()
  const start = new Date(now)
  const end = new Date(now)
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
  }
  return { start, end }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Records with no salesman. Aggregated, but never ranked or given goals. */
const UNASSIGNED = 'Unassigned'

/**
 * True percentage, uncapped.
 *
 * This was `Math.min(100, …)`, so $50k against a $10k goal read "100%" and drew
 * a full bar — visually identical to exactly hitting the number. On a targets
 * page, beating the target is the thing you most want to see. The bar still
 * clamps its width; the label doesn't.
 */
function pct(actual: number, goal: number): number {
  if (!goal) return 0
  return Math.round((actual / goal) * 100)
}

function barColor(p: number): string {
  if (p >= 100) return 'bg-emerald-500'
  if (p >= 80) return 'bg-green-500'
  if (p >= 50) return 'bg-yellow-500'
  return 'bg-red-500'
}

function labelColor(p: number): string {
  if (p >= 100) return 'text-emerald-400'
  if (p >= 80) return 'text-green-400'
  if (p >= 50) return 'text-yellow-400'
  return 'text-red-400'
}

// ─── Progress bar ─────────────────────────────────────────────────────────────

function ProgressBar({
  label, actual, goal, format,
}: {
  label: string
  actual: number
  goal: number
  format: 'currency' | 'number'
}) {
  const show = (n: number) => format === 'currency' ? formatCurrency(n) : String(n)

  /**
   * No goal, no bar.
   *
   * The bar used to fall back to `width: actual / 10 %` — five leads drew a
   * 0.5% sliver, $1,000 of revenue drew a full bar — rendered in the same
   * component, and the same green, as real progress. It looked like
   * attainment and meant nothing.
   */
  if (!goal) {
    return (
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-gray-400">{label}</span>
        <span className="text-xs tabular-nums text-gray-400">
          {show(actual)} <span className="text-gray-400">· no goal set</span>
        </span>
      </div>
    )
  }

  const p = pct(actual, goal)
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-gray-400">{label}</span>
        <span className={`text-xs font-semibold tabular-nums ${labelColor(p)}`}>
          {show(actual)} / {show(goal)}
          <span className="font-normal ml-1">({p}%)</span>
        </span>
      </div>
      <div className="w-full bg-gray-700/60 rounded-full h-1.5 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${barColor(p)}`}
          style={{ width: `${Math.min(100, p)}%` }}
        />
      </div>
    </div>
  )
}

// ─── Goal editor ─────────────────────────────────────────────────────────────

function GoalEditor({
  name, goals, saving, onChange, onClose,
}: {
  name: string
  goals: PersonGoals
  saving: boolean
  onChange: (g: PersonGoals) => void
  onClose: () => void
}) {
  const [rev, setRev] = useState(String(goals.revenue))
  const [lds, setLds] = useState(String(goals.leads))
  const [cus, setCus] = useState(String(goals.customers))

  function save() {
    onChange({
      revenue:   Math.max(0, Number(rev) || 0),
      leads:     Math.max(0, Number(lds) || 0),
      customers: Math.max(0, Number(cus) || 0),
    })
  }

  return (
    <div className="bg-gray-800/80 rounded-xl p-4 mt-3 border border-gray-700/60 space-y-3">
      <p className="text-xs text-gray-400 font-medium uppercase tracking-wider">Set goals for {name}</p>
      {/* One column until sm. At three across on a 390px phone each field is
          about 90px, and "Revenue goal ($)" alone needs ~99px. */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {([
          { id: 'goal-rev', label: 'Revenue goal ($)', value: rev, set: setRev },
          { id: 'goal-lds', label: 'Lead goal',        value: lds, set: setLds },
          { id: 'goal-cus', label: 'Customer goal',    value: cus, set: setCus },
        ]).map(({ id, label, value, set }) => (
          <div key={id}>
            <label htmlFor={id} className="text-xs text-gray-400 block mb-1">{label}</label>
            <input
              id={id}
              type="number"
              min="0"
              value={value}
              onChange={e => set(e.target.value)}
              className="input-field text-sm py-1.5 w-full"
              placeholder="0"
            />
          </div>
        ))}
      </div>
      <div className="flex gap-2 pt-1">
        <button onClick={save} disabled={saving} className="btn-primary text-xs px-4 py-1.5 disabled:opacity-40">
          {saving ? 'Saving…' : 'Save Goals'}
        </button>
        <button onClick={onClose} className="text-xs text-gray-400 hover:text-gray-200 transition-colors px-2">
          Cancel
        </button>
      </div>
    </div>
  )
}

// ─── Page ────────────────────────────────────────────────────────────────────

interface Row {
  name: string
  revenue: number
  leads: number
  customers: number
  goals: PersonGoals
  revPct: number
  /** Unassigned aggregates real records but isn't a person, so it never ranks. */
  rankable: boolean
}

export default function TargetsPage() {
  usePageTitle('Targets')
  const labels  = usePickerStore(s => s.labels)
  const smLabel = labels.salesman ?? 'Salesman'
  const toast   = useToast()

  const [all, setAll]         = useState<CustomerItem[]>([])
  const [loading, setLoading] = useState(true)
  const [period, setPeriod]   = useState<Period>('month')
  const [goals, setGoals]     = useState<GoalsMap>({})
  const [editing, setEditing] = useState<string | null>(null)
  const [saving, setSaving]   = useState(false)
  const [removing, setRemoving] = useState<string | null>(null)

  // Shared across the team via the company document, not this browser.
  useEffect(() => subscribeToTargets(setGoals, () => {}), [])

  useEffect(() => {
    setLoading(true)
    const unsub = subscribeToCustomers(
      items => { setAll(items); setLoading(false) },
      ()    => setLoading(false),
    )
    return unsub
  }, [])

  const { start, end } = useMemo(() => getPeriodRange(period), [period])

  const periodItems = useMemo(
    () => all.filter(c => c.creationDate >= start && c.creationDate <= end),
    [all, start, end],
  )

  const rows = useMemo<Row[]>(() => {
    const map = new Map<string, { revenue: number; leads: number; customers: number }>()

    // Seed everyone who has a goal, so a quiet period still shows them at 0.
    for (const name of Object.keys(goals)) {
      if (!map.has(name)) map.set(name, { revenue: 0, leads: 0, customers: 0 })
    }

    for (const c of periodItems) {
      const cat = c.category.toLowerCase()
      if (cat !== 'lead' && cat !== 'customer') continue
      const name = c.salesman.trim() || UNASSIGNED
      const row = map.get(name) ?? { revenue: 0, leads: 0, customers: 0 }
      if (cat === 'lead') row.leads++
      else { row.customers++; row.revenue += c.amount }
      map.set(name, row)
    }

    /**
     * One measure: revenue, descending.
     *
     * The old sort put everyone with a goal above everyone without, then
     * ordered by percentage — so a $1 goal met in full took gold over someone
     * who'd booked $500k with no goal set, and the medals said so. Attainment
     * still shows, as a badge on the row, where it can't masquerade as rank.
     */
    return [...map.entries()]
      .map(([name, { revenue, leads, customers }]) => {
        const g = goals[name] ?? DEFAULT_GOALS
        return {
          name, revenue, leads, customers, goals: g,
          revPct: pct(revenue, g.revenue),
          rankable: name !== UNASSIGNED,
        }
      })
      .sort((a, b) => {
        // Unassigned always sits last — it's a bucket, not a competitor.
        if (a.rankable !== b.rankable) return a.rankable ? -1 : 1
        return b.revenue - a.revenue
      })
  }, [periodItems, goals])

  const ranked = rows.filter(r => r.rankable)

  /**
   * A podium needs three.
   *
   * There was no floor, so the only salesperson on the page collected a gold
   * medal for coming first out of one.
   */
  const showMedals = ranked.length >= 3

  const totals = useMemo(() => ({
    revenue:   rows.reduce((s, r) => s + r.revenue, 0),
    leads:     rows.reduce((s, r) => s + r.leads, 0),
    customers: rows.reduce((s, r) => s + r.customers, 0),
    revGoal:   rows.reduce((s, r) => s + r.goals.revenue, 0),
    leadsGoal: rows.reduce((s, r) => s + r.goals.leads, 0),
    cusGoal:   rows.reduce((s, r) => s + r.goals.customers, 0),
  }), [rows])

  async function updateGoals(name: string, g: PersonGoals) {
    const next = { ...goals, [name]: g }
    setSaving(true)
    try {
      await saveTargets(next)
      setEditing(null)
      toast(`Goals saved for ${name}.`, 'success')
    } catch {
      toast('Could not save goals. Check your connection and try again.', 'error')
    } finally {
      setSaving(false)
    }
  }

  async function removeGoals(name: string) {
    setRemoving(null)
    const next = { ...goals }
    delete next[name]
    try {
      await saveTargets(next)
      toast(`Goals removed for ${name}.`, 'success')
    } catch {
      toast('Could not remove those goals.', 'error')
    }
  }

  /** RFC 4180: a quote inside a quoted field is escaped by doubling it. A
   *  salesman called O"Brien used to corrupt the whole file. */
  function csvCell(v: string | number): string {
    return `"${String(v).replace(/"/g, '""')}"`
  }

  function exportCSV() {
    const header = [smLabel, 'Revenue', 'Rev Goal', 'Rev %', 'Leads', 'Lead Goal', 'Customers', 'Cust Goal']
    const csvRows = rows.map(r => [
      r.name, r.revenue.toFixed(2), r.goals.revenue, pct(r.revenue, r.goals.revenue) + '%',
      r.leads, r.goals.leads, r.customers, r.goals.customers,
    ])
    const csv  = [header, ...csvRows].map(row => row.map(csvCell).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `targets-${period}-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-white">Targets</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            {smLabel} goals and progress · shared with your team
          </p>
        </div>
        <button
          onClick={exportCSV}
          disabled={loading || rows.length === 0}
          className="btn-secondary text-sm px-3 py-1.5 inline-flex items-center gap-1.5 shrink-0 disabled:opacity-40"
        >
          <Icon d={ICONS.downloadTray} className="w-4 h-4 shrink-0" />
          Export CSV
        </button>
      </div>

      {/* Period selector */}
      <div className="flex gap-1.5 flex-wrap">
        {PERIODS.map(p => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            aria-pressed={period === p}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors whitespace-nowrap ${
              period === p
                ? 'bg-indigo-600 text-white'
                : 'bg-gray-800 text-gray-400 hover:text-gray-200'
            }`}
          >
            {PERIOD_LABELS[p]}
          </button>
        ))}
      </div>

      {/* Team summary */}
      {!loading && rows.length > 0 && (
        <div className="card p-4 space-y-3">
          <p className="text-xs text-gray-400 font-medium uppercase tracking-wider">Team Total</p>
          <ProgressBar label="Revenue"   actual={totals.revenue}   goal={totals.revGoal}   format="currency" />
          <ProgressBar label="Leads"     actual={totals.leads}     goal={totals.leadsGoal} format="number" />
          <ProgressBar label="Customers" actual={totals.customers} goal={totals.cusGoal}   format="number" />
        </div>
      )}

      {/* Rows */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => <div key={i} className="card h-28 animate-pulse" />)}
        </div>
      ) : rows.length === 0 ? (
        <div className="card p-10 text-center">
          <p className="text-gray-400 text-sm">No activity this period.</p>
          <p className="text-gray-400 text-xs mt-1">Try selecting a wider date range.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((r, i) => {
            const hasGoal   = r.goals.revenue > 0 || r.goals.leads > 0 || r.goals.customers > 0
            const isEditing = editing === r.name
            const conv      = r.leads > 0 ? Math.round((r.customers / r.leads) * 100) : null
            const medalTone = showMedals && r.rankable && i < 3
              ? ['text-yellow-300', 'text-gray-200', 'text-orange-300'][i]
              : null

            return (
              <div key={r.name} className="card overflow-hidden">
                <div className="flex items-center gap-3 px-4 py-3">
                  {/* Rank. A drawn trophy rather than 🥇🥈🥉, which paint their
                      own bitmap and ignore `color`. */}
                  <div className="w-9 h-9 rounded-full bg-gray-700 flex items-center justify-center shrink-0">
                    {medalTone ? (
                      <Icon d={ICONS.trophy} className={`w-4 h-4 ${medalTone}`} />
                    ) : (
                      <span className="text-xs font-semibold text-gray-300">
                        {r.rankable ? `#${i + 1}` : '—'}
                      </span>
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-semibold text-gray-100">{r.name}</p>
                      {!r.rankable && (
                        <span className="text-xs font-medium px-1.5 py-0.5 rounded-full bg-gray-700 text-gray-300">
                          no {smLabel.toLowerCase()}
                        </span>
                      )}
                      {conv !== null && (
                        <span className={`text-xs font-semibold px-1.5 py-0.5 rounded-full ${
                          conv >= 50 ? 'bg-green-900/30 text-green-400' :
                          conv >= 25 ? 'bg-yellow-900/30 text-yellow-400' :
                          // gray-500 on a gray-700/60 chip was 2.48:1.
                          'bg-gray-700 text-gray-300'
                        }`}>
                          {conv}% conv
                        </span>
                      )}
                      {r.goals.revenue > 0 && (
                        <span className={`text-xs font-bold px-1.5 py-0.5 rounded-full ${labelColor(r.revPct)} bg-gray-700/40`}>
                          {r.revPct}% to goal
                        </span>
                      )}
                    </div>
                    {/* formatCurrency here and in the bars below — the row used
                        to show $25,000 on this line and $25k directly beneath
                        it, from a second currency formatter. */}
                    <div className="flex items-center gap-3 mt-0.5 text-xs text-gray-400 flex-wrap">
                      <span className="tabular-nums">{formatCurrency(r.revenue)}</span>
                      <span>{r.leads} lead{r.leads !== 1 ? 's' : ''}</span>
                      <span>{r.customers} customer{r.customers !== 1 ? 's' : ''}</span>
                    </div>
                  </div>

                  {/* Unassigned is a bucket of records with no owner, so there's
                      nobody to set a goal for. */}
                  {r.rankable && (
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => setEditing(isEditing ? null : r.name)}
                        className={`text-xs px-2.5 py-1 rounded-lg transition-colors ${
                          isEditing
                            ? 'bg-indigo-600/30 text-indigo-300'
                            : 'bg-gray-700/60 text-gray-300 hover:text-white hover:bg-gray-700'
                        }`}
                      >
                        {hasGoal ? 'Edit Goal' : 'Set Goal'}
                      </button>
                      {/* Rows are seeded from whoever has a goal, so without
                          this someone who left the company stays on the board
                          at 0% for ever. */}
                      {hasGoal && (
                        <button
                          onClick={() => setRemoving(r.name)}
                          aria-label={`Remove goals for ${r.name}`}
                          className="p-1.5 rounded text-gray-400 hover:text-red-400 hover:bg-gray-700/50 transition-colors
                                     focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                        >
                          <Icon d={ICONS.trash} className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {hasGoal && (
                  <div className="px-4 pb-4 space-y-2.5">
                    <ProgressBar label="Revenue"   actual={r.revenue}   goal={r.goals.revenue}   format="currency" />
                    {r.goals.leads > 0 && (
                      <ProgressBar label="Leads"   actual={r.leads}     goal={r.goals.leads}     format="number" />
                    )}
                    {r.goals.customers > 0 && (
                      <ProgressBar label="Customers" actual={r.customers} goal={r.goals.customers} format="number" />
                    )}
                  </div>
                )}

                {isEditing && (
                  <div className="px-4 pb-4">
                    <GoalEditor
                      name={r.name}
                      goals={r.goals}
                      saving={saving}
                      onChange={g => updateGoals(r.name, g)}
                      onClose={() => setEditing(null)}
                    />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      <ConfirmModal
        isOpen={removing !== null}
        message={removing ? `Remove the goals set for ${removing}? Their activity stays on the board for as long as they have any this period.` : ''}
        confirmLabel="Remove goals"
        onConfirm={() => removing && removeGoals(removing)}
        onCancel={() => setRemoving(null)}
      />
    </div>
  )
}
