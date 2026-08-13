import { useEffect, useMemo, useState } from 'react'
import { subscribeToCustomers } from '../../services/customerService'
import { getGoals, saveGoals } from '../../services/goalService'
import { type CustomerItem, formatCurrency, categoryMatches } from '../../models/customer'
import { type GoalPeriod, type GoalValues, currentPeriodRange, emptyGoalValues } from '../../models/goal'
import { usePageTitle } from '../../hooks/usePageTitle'
import { useToast } from '../../components/Toast'

const PERIODS: { key: GoalPeriod; label: string }[] = [
  { key: 'month',   label: 'Month'   },
  { key: 'quarter', label: 'Quarter' },
  { key: 'year',    label: 'Year'    },
]

export default function GoalsPage() {
  usePageTitle('Goals')
  const toast = useToast()

  const [customers, setCustomers]   = useState<CustomerItem[]>([])
  const [loadingData, setLoadingData] = useState(true)

  const [savedGoals, setSavedGoals] = useState<Record<GoalPeriod, GoalValues>>({
    month:   emptyGoalValues(),
    quarter: emptyGoalValues(),
    year:    emptyGoalValues(),
  })
  const [editTargets, setEditTargets] = useState<Record<GoalPeriod, GoalValues>>({
    month:   emptyGoalValues(),
    quarter: emptyGoalValues(),
    year:    emptyGoalValues(),
  })
  const [editing, setEditing] = useState(false)
  const [saving, setSaving]   = useState(false)
  const [period, setPeriod]   = useState<GoalPeriod>('month')

  // Subscribe to customers
  useEffect(() => {
    const unsub = subscribeToCustomers(
      items => { setCustomers(items); setLoadingData(false) },
      ()    => setLoadingData(false),
    )
    return unsub
  }, [])

  // Load saved goals
  useEffect(() => {
    getGoals().then(doc => {
      if (!doc) return
      const vals = {
        month:   doc.month,
        quarter: doc.quarter,
        year:    doc.year,
      }
      setSavedGoals(vals)
      setEditTargets(structuredClone(vals))
    })
  }, [])

  const range = useMemo(() => currentPeriodRange(period), [period])

  // Calculate actuals for each period from customer data
  const actuals = useMemo<Record<GoalPeriod, GoalValues>>(() => {
    function compute(p: GoalPeriod): GoalValues {
      const r = currentPeriodRange(p)
      const inPeriod = customers.filter(c => {
        const t = c.creationDate?.getTime() ?? 0
        return t >= r.start.getTime() && t <= r.end.getTime()
      })
      return {
        revenue:   inPeriod.reduce((s, c) => s + (c.amount ?? 0), 0),
        leads:     inPeriod.filter(c => categoryMatches(c.category, 'Lead')).length,
        customers: inPeriod.filter(c => categoryMatches(c.category, 'Customer')).length,
      }
    }
    return { month: compute('month'), quarter: compute('quarter'), year: compute('year') }
  }, [customers])

  // Days remaining in current period
  const daysLeft = useMemo(() => {
    const msLeft = range.end.getTime() - Date.now()
    return Math.max(0, Math.ceil(msLeft / 86_400_000))
  }, [range])

  // Fraction of period elapsed
  const periodFraction = useMemo(() => {
    const total = range.end.getTime() - range.start.getTime()
    const elapsed = Date.now() - range.start.getTime()
    return Math.min(1, Math.max(0, elapsed / total))
  }, [range])

  function startEditing() {
    setEditTargets(structuredClone(savedGoals))
    setEditing(true)
  }

  function cancelEditing() {
    setEditTargets(structuredClone(savedGoals))
    setEditing(false)
  }

  async function handleSave() {
    setSaving(true)
    try {
      await saveGoals(editTargets)
      setSavedGoals(structuredClone(editTargets))
      setEditing(false)
      toast('Goals saved.', 'success')
    } catch {
      toast('Failed to save goals.', 'error')
    } finally {
      setSaving(false)
    }
  }

  function setTarget(p: GoalPeriod, field: keyof GoalValues, raw: string) {
    const n = parseFloat(raw.replace(/[^0-9.]/g, '')) || 0
    setEditTargets(prev => ({
      ...prev,
      [p]: { ...prev[p], [field]: n },
    }))
  }

  const currentActuals  = actuals[period]
  const currentSaved    = savedGoals[period]
  const currentEdit     = editTargets[period]

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Goals</h1>
          <p className="text-sm text-gray-400 mt-0.5">{range.label} · {daysLeft} day{daysLeft !== 1 ? 's' : ''} remaining</p>
        </div>
        <div className="flex items-center gap-2">
          {editing ? (
            <>
              <button
                onClick={cancelEditing}
                disabled={saving}
                className="btn-secondary text-sm px-3 py-1.5"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="btn-primary text-sm px-4 py-1.5 disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </>
          ) : (
            <button
              onClick={startEditing}
              className="btn-secondary text-sm px-3 py-1.5 flex items-center gap-1.5"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125" />
              </svg>
              Edit Targets
            </button>
          )}
        </div>
      </div>

      {/* Period tabs */}
      <div className="flex gap-1 mb-6 bg-gray-800/50 p-1 rounded-xl">
        {PERIODS.map(p => (
          <button
            key={p.key}
            onClick={() => setPeriod(p.key)}
            className={`flex-1 text-center text-sm font-medium py-1.5 rounded-lg transition-colors ${
              period === p.key
                ? 'bg-indigo-600 text-white'
                : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Goal cards */}
      <div className="space-y-4">
        <GoalCard
          icon="💰"
          title="Revenue"
          actual={currentActuals.revenue}
          target={editing ? currentEdit.revenue : currentSaved.revenue}
          formatValue={v => formatCurrency(v)}
          periodFraction={periodFraction}
          daysLeft={daysLeft}
          editing={editing}
          onTargetChange={v => setTarget(period, 'revenue', v)}
          loading={loadingData}
          prefix="$"
        />
        <GoalCard
          icon="👤"
          title="New Leads"
          actual={currentActuals.leads}
          target={editing ? currentEdit.leads : currentSaved.leads}
          formatValue={v => String(Math.round(v))}
          periodFraction={periodFraction}
          daysLeft={daysLeft}
          editing={editing}
          onTargetChange={v => setTarget(period, 'leads', v)}
          loading={loadingData}
        />
        <GoalCard
          icon="✅"
          title="New Customers"
          actual={currentActuals.customers}
          target={editing ? currentEdit.customers : currentSaved.customers}
          formatValue={v => String(Math.round(v))}
          periodFraction={periodFraction}
          daysLeft={daysLeft}
          editing={editing}
          onTargetChange={v => setTarget(period, 'customers', v)}
          loading={loadingData}
        />
      </div>

      {/* All periods summary table */}
      {!editing && (
        <div className="mt-8">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">All Periods</h2>
          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-700/60">
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wider w-28">Period</th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">Revenue</th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">Leads</th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">Customers</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700/50">
                {PERIODS.map(p => {
                  const a = actuals[p.key]
                  const g = savedGoals[p.key]
                  const r = currentPeriodRange(p.key)
                  return (
                    <tr key={p.key} className={`hover:bg-gray-700/20 ${period === p.key ? 'bg-indigo-600/5' : ''}`}>
                      <td className="px-4 py-3 text-gray-300 font-medium">
                        {r.short}
                        {period === p.key && <span className="ml-1.5 text-xs text-indigo-400 font-semibold">CURRENT</span>}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <MiniProgress actual={a.revenue}   target={g.revenue}   format={v => formatCurrency(v)} />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <MiniProgress actual={a.leads}     target={g.leads}     format={v => String(Math.round(v))} />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <MiniProgress actual={a.customers} target={g.customers} format={v => String(Math.round(v))} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

// ── GoalCard ──────────────────────────────────────────────────────────────────

function GoalCard({
  icon, title, actual, target, formatValue, periodFraction, daysLeft,
  editing, onTargetChange, loading, prefix = '',
}: {
  icon: string
  title: string
  actual: number
  target: number
  formatValue: (v: number) => string
  periodFraction: number
  daysLeft: number
  editing: boolean
  onTargetChange: (v: string) => void
  loading: boolean
  prefix?: string
}) {
  const pct          = target > 0 ? Math.min(100, (actual / target) * 100) : 0
  const isGoalMet    = target > 0 && actual >= target
  const isOnTrack    = isGoalMet || (target > 0 && pct / 100 >= periodFraction - 0.05)
  const hasTarget    = target > 0

  let statusLabel: string
  let statusClass:  string
  let barClass:     string

  if (!hasTarget) {
    statusLabel = 'No target set'
    statusClass = 'text-gray-500'
    barClass    = 'bg-gray-700'
  } else if (isGoalMet) {
    statusLabel = 'Goal Met! 🎉'
    statusClass = 'text-green-400'
    barClass    = 'bg-green-500'
  } else if (isOnTrack) {
    statusLabel = 'On Track'
    statusClass = 'text-green-400'
    barClass    = 'bg-green-500'
  } else {
    statusLabel = 'Behind'
    statusClass = 'text-yellow-400'
    barClass    = 'bg-yellow-500'
  }

  return (
    <div className="card px-5 py-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="flex items-center gap-2.5">
          <span className="text-xl">{icon}</span>
          <span className="font-semibold text-white">{title}</span>
        </div>
        {hasTarget && !editing && (
          <span className={`text-xs font-semibold ${statusClass}`}>{statusLabel}</span>
        )}
      </div>

      {/* Progress row */}
      {loading ? (
        <div className="h-8 bg-gray-700 animate-pulse rounded-lg mb-3" />
      ) : (
        <div className="flex items-end gap-3 mb-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-1 mb-1.5">
              <span className="text-2xl font-bold text-white tabular-nums">
                {formatValue(actual)}
              </span>
              <span className="text-gray-500 text-sm">of</span>
              {editing ? (
                <span className="flex items-center gap-0.5">
                  {prefix && <span className="text-gray-400 text-sm">{prefix}</span>}
                  <input
                    type="number"
                    min={0}
                    step={prefix === '$' ? 1000 : 1}
                    defaultValue={target || ''}
                    onChange={e => onTargetChange(e.target.value)}
                    placeholder="set target"
                    className="w-28 bg-gray-800 border border-indigo-500 rounded-lg px-2 py-0.5 text-sm text-white outline-none focus:ring-1 focus:ring-indigo-500 tabular-nums"
                  />
                </span>
              ) : (
                <span className={`text-sm font-medium ${hasTarget ? 'text-gray-300' : 'text-gray-600 italic'}`}>
                  {hasTarget ? formatValue(target) : 'no target'}
                </span>
              )}
            </div>

            {/* Progress bar */}
            <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
              {hasTarget && (
                <div
                  className={`h-full rounded-full transition-all duration-700 ${barClass}`}
                  style={{ width: `${pct}%` }}
                />
              )}
            </div>
          </div>

          {/* Percentage badge */}
          {hasTarget && !editing && (
            <div className={`text-lg font-bold tabular-nums shrink-0 ${
              isGoalMet ? 'text-green-400' : isOnTrack ? 'text-green-400' : 'text-yellow-400'
            }`}>
              {Math.round(pct)}%
            </div>
          )}
        </div>
      )}

      {/* Footer */}
      {!editing && (
        <div className="flex items-center justify-between text-xs text-gray-500">
          <span>{daysLeft} day{daysLeft !== 1 ? 's' : ''} remaining</span>
          {hasTarget && !isGoalMet && target > actual && (
            <span>
              {formatValue(target - actual)} to go
            </span>
          )}
        </div>
      )}

      {/* Expected pace marker */}
      {hasTarget && !editing && !loading && !isGoalMet && (
        <div className="relative mt-2">
          <div className="h-px bg-gray-700/60 relative overflow-visible">
            <div
              className="absolute top-1/2 -translate-y-1/2 w-px h-2.5 bg-gray-500"
              style={{ left: `${Math.round(periodFraction * 100)}%` }}
              title="Expected pace"
            />
          </div>
          <div
            className="text-xs text-gray-600 absolute -top-0.5"
            style={{ left: `${Math.round(periodFraction * 100)}%`, transform: 'translateX(-50%)' }}
          >
            pace
          </div>
        </div>
      )}
    </div>
  )
}

// ── MiniProgress (summary table cell) ────────────────────────────────────────

function MiniProgress({ actual, target, format }: {
  actual: number
  target: number
  format: (v: number) => string
}) {
  if (target === 0) {
    return <span className="text-gray-600 text-sm">{format(actual)} / —</span>
  }
  const pct = Math.min(100, Math.round((actual / target) * 100))
  const met = actual >= target
  return (
    <span className={`text-sm font-medium tabular-nums ${met ? 'text-green-400' : 'text-gray-300'}`}>
      {format(actual)} / {format(target)}
      <span className={`ml-1.5 text-xs ${met ? 'text-green-500' : 'text-gray-500'}`}>{pct}%</span>
    </span>
  )
}
