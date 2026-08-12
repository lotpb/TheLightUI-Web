import { useEffect, useMemo, useState } from 'react'
import { usePageTitle } from '../../hooks/usePageTitle'
import { subscribeToCustomers } from '../../services/customerService'
import { formatCurrency, type CustomerItem } from '../../models/customer'
import { useAuthStore } from '../../stores/authStore'
import { usePickerStore } from '../../stores/pickerStore'

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

// ─── Goals storage ────────────────────────────────────────────────────────────

interface PersonGoals { revenue: number; leads: number; customers: number }
type GoalsMap = Record<string, PersonGoals>

const DEFAULT_GOALS: PersonGoals = { revenue: 0, leads: 0, customers: 0 }

function loadGoals(companyId: string): GoalsMap {
  try { return JSON.parse(localStorage.getItem(`thelight.targets_${companyId}`) ?? '{}') } catch { return {} }
}

function saveGoals(companyId: string, goals: GoalsMap) {
  localStorage.setItem(`thelight.targets_${companyId}`, JSON.stringify(goals))
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function pct(actual: number, goal: number): number {
  if (!goal) return 0
  return Math.min(100, Math.round((actual / goal) * 100))
}

function barColor(p: number): string {
  if (p >= 80) return 'bg-green-500'
  if (p >= 50) return 'bg-yellow-500'
  return 'bg-red-500'
}

function labelColor(p: number): string {
  if (p >= 80) return 'text-green-400'
  if (p >= 50) return 'text-yellow-400'
  return 'text-red-400'
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(0)}k`
  return formatCurrency(n)
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
  const p = pct(actual, goal)
  const actualStr = format === 'currency' ? fmt(actual) : String(actual)
  const goalStr   = format === 'currency' ? fmt(goal)   : String(goal)

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-500">{label}</span>
        <span className={`text-xs font-semibold tabular-nums ${goal ? labelColor(p) : 'text-gray-600'}`}>
          {actualStr}{goal ? ` / ${goalStr}` : ''}
          {goal > 0 && <span className="text-gray-600 font-normal ml-1">({p}%)</span>}
        </span>
      </div>
      <div className="w-full bg-gray-700/60 rounded-full h-1.5 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${goal ? barColor(p) : 'bg-gray-600'}`}
          style={{ width: goal ? `${p}%` : `${Math.min(100, actual / 10)}%` }}
        />
      </div>
    </div>
  )
}

// ─── Goal editor ─────────────────────────────────────────────────────────────

function GoalEditor({
  name,
  goals,
  onChange,
  onClose,
}: {
  name: string
  goals: PersonGoals
  onChange: (g: PersonGoals) => void
  onClose: () => void
}) {
  const [rev, setRev] = useState(String(goals.revenue))
  const [lds, setLds] = useState(String(goals.leads))
  const [cus, setCus] = useState(String(goals.customers))

  function save() {
    onChange({
      revenue:   Math.max(0, Number(rev)   || 0),
      leads:     Math.max(0, Number(lds)   || 0),
      customers: Math.max(0, Number(cus)   || 0),
    })
    onClose()
  }

  return (
    <div className="bg-gray-800/80 rounded-xl p-4 mt-3 border border-gray-700/60 space-y-3">
      <p className="text-xs text-gray-400 font-medium uppercase tracking-wider">Set goals for {name}</p>
      <div className="grid grid-cols-3 gap-3">
        {([
          { label: 'Revenue goal ($)', value: rev, set: setRev },
          { label: 'Lead goal',        value: lds, set: setLds },
          { label: 'Customer goal',    value: cus, set: setCus },
        ]).map(({ label, value, set }) => (
          <div key={label}>
            <label className="text-xs text-gray-500 block mb-1">{label}</label>
            <input
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
        <button onClick={save} className="btn-primary text-xs px-4 py-1.5">Save Goals</button>
        <button onClick={onClose} className="text-xs text-gray-500 hover:text-gray-300 transition-colors px-2">Cancel</button>
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
}

export default function TargetsPage() {
  usePageTitle('Targets')
  const companyId = useAuthStore(s => s.companyId)
  const labels    = usePickerStore(s => s.labels)
  const smLabel   = labels.salesman ?? 'Salesman'

  const [all, setAll]         = useState<CustomerItem[]>([])
  const [loading, setLoading] = useState(true)
  const [period, setPeriod]   = useState<Period>('month')
  const [goals, setGoals]     = useState<GoalsMap>({})
  const [editing, setEditing] = useState<string | null>(null)

  useEffect(() => {
    if (!companyId) return
    setGoals(loadGoals(companyId))
  }, [companyId])

  useEffect(() => {
    setLoading(true)
    const unsub = subscribeToCustomers(
      items => { setAll(items); setLoading(false) },
      ()    => setLoading(false),
    )
    return unsub
  }, [companyId])

  const { start, end } = useMemo(() => getPeriodRange(period), [period])

  const periodItems = useMemo(
    () => all.filter(c => c.creationDate >= start && c.creationDate <= end),
    [all, start, end],
  )

  const rows = useMemo<Row[]>(() => {
    const map = new Map<string, { revenue: number; leads: number; customers: number }>()

    // Seed every salesman who has goals, even if no activity this period
    for (const name of Object.keys(goals)) {
      if (!map.has(name)) map.set(name, { revenue: 0, leads: 0, customers: 0 })
    }

    for (const c of periodItems) {
      const cat  = c.category.toLowerCase()
      if (cat !== 'lead' && cat !== 'customer') continue
      const name = c.salesman.trim() || 'Unassigned'
      const row  = map.get(name) ?? { revenue: 0, leads: 0, customers: 0 }
      if (cat === 'lead') row.leads++
      else { row.customers++; row.revenue += c.amount }
      map.set(name, row)
    }

    return [...map.entries()]
      .map(([name, { revenue, leads, customers }]) => {
        const g = goals[name] ?? DEFAULT_GOALS
        return { name, revenue, leads, customers, goals: g, revPct: pct(revenue, g.revenue) }
      })
      .sort((a, b) => {
        // Sort: those with goals by % completion desc, then by revenue desc
        const aHasGoal = a.goals.revenue > 0
        const bHasGoal = b.goals.revenue > 0
        if (aHasGoal && bHasGoal) return b.revPct - a.revPct
        if (aHasGoal) return -1
        if (bHasGoal) return 1
        return b.revenue - a.revenue
      })
  }, [periodItems, goals])

  const totals = useMemo(() => ({
    revenue:   rows.reduce((s, r) => s + r.revenue, 0),
    leads:     rows.reduce((s, r) => s + r.leads, 0),
    customers: rows.reduce((s, r) => s + r.customers, 0),
    revGoal:   rows.reduce((s, r) => s + r.goals.revenue, 0),
    leadsGoal: rows.reduce((s, r) => s + r.goals.leads, 0),
    cusGoal:   rows.reduce((s, r) => s + r.goals.customers, 0),
  }), [rows])

  function updateGoals(name: string, g: PersonGoals) {
    const next = { ...goals, [name]: g }
    setGoals(next)
    if (companyId) saveGoals(companyId, next)
  }

  function exportCSV() {
    const header = [smLabel, 'Revenue', 'Rev Goal', 'Rev %', 'Leads', 'Lead Goal', 'Customers', 'Cust Goal']
    const csvRows = rows.map(r => [
      r.name, r.revenue.toFixed(2), r.goals.revenue, pct(r.revenue, r.goals.revenue) + '%',
      r.leads, r.goals.leads, r.customers, r.goals.customers,
    ])
    const csv  = [header, ...csvRows].map(row => row.map(v => `"${v}"`).join(',')).join('\n')
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Targets</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            {smLabel} goals and progress
          </p>
        </div>
        <button onClick={exportCSV} disabled={loading || rows.length === 0} className="btn-secondary text-sm px-3 py-1.5">
          ↓ Export CSV
        </button>
      </div>

      {/* Period selector */}
      <div className="flex gap-1.5 flex-wrap">
        {PERIODS.map(p => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
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

      {/* Team summary KPIs */}
      {!loading && rows.length > 0 && (
        <div className="card p-4 space-y-3">
          <p className="text-xs text-gray-500 font-medium uppercase tracking-wider">Team Total</p>
          <ProgressBar label="Revenue"   actual={totals.revenue}   goal={totals.revGoal}   format="currency" />
          <ProgressBar label="Leads"     actual={totals.leads}     goal={totals.leadsGoal} format="number" />
          <ProgressBar label="Customers" actual={totals.customers} goal={totals.cusGoal}   format="number" />
        </div>
      )}

      {/* Per-salesman rows */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => <div key={i} className="card h-28 animate-pulse" />)}
        </div>
      ) : rows.length === 0 ? (
        <div className="card p-10 text-center">
          <p className="text-gray-400 text-sm">No activity this period.</p>
          <p className="text-gray-600 text-xs mt-1">Try selecting a wider date range.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((r, i) => {
            const hasGoal    = r.goals.revenue > 0 || r.goals.leads > 0 || r.goals.customers > 0
            const isEditing  = editing === r.name
            const conv       = r.leads > 0 ? Math.round((r.customers / r.leads) * 100) : null
            const medal      = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : null

            return (
              <div key={r.name} className="card overflow-hidden">
                {/* Row header */}
                <div className="flex items-center gap-3 px-4 py-3">
                  {/* Rank / avatar */}
                  <div className="w-9 h-9 rounded-full bg-gray-700 flex items-center justify-center shrink-0">
                    {medal ? (
                      <span className="text-lg leading-none">{medal}</span>
                    ) : (
                      <span className="text-xs font-semibold text-gray-400">#{i + 1}</span>
                    )}
                  </div>

                  {/* Name + badges */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-semibold text-gray-100">{r.name}</p>
                      {conv !== null && (
                        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                          conv >= 50 ? 'bg-green-900/30 text-green-400' :
                          conv >= 25 ? 'bg-yellow-900/30 text-yellow-400' :
                          'bg-gray-700/60 text-gray-500'
                        }`}>
                          {conv}% conv
                        </span>
                      )}
                      {hasGoal && r.goals.revenue > 0 && (
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${labelColor(r.revPct)} bg-gray-700/40`}>
                          {r.revPct}% to goal
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-0.5 text-xs text-gray-500 flex-wrap">
                      <span>{formatCurrency(r.revenue)}</span>
                      <span>{r.leads} lead{r.leads !== 1 ? 's' : ''}</span>
                      <span>{r.customers} customer{r.customers !== 1 ? 's' : ''}</span>
                    </div>
                  </div>

                  {/* Edit goal button */}
                  <button
                    onClick={() => setEditing(isEditing ? null : r.name)}
                    className={`text-xs px-2.5 py-1 rounded-lg transition-colors shrink-0 ${
                      isEditing
                        ? 'bg-indigo-600/30 text-indigo-300'
                        : 'bg-gray-700/60 text-gray-400 hover:text-gray-200 hover:bg-gray-700'
                    }`}
                  >
                    {hasGoal ? 'Edit Goal' : '+ Set Goal'}
                  </button>
                </div>

                {/* Progress bars */}
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

                {/* Goal editor */}
                {isEditing && (
                  <div className="px-4 pb-4">
                    <GoalEditor
                      name={r.name}
                      goals={r.goals}
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

      <p className="text-xs text-gray-600 text-center pb-2">
        Goals are saved locally in this browser.
      </p>
    </div>
  )
}
