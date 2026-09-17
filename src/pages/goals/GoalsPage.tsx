import { useEffect, useMemo, useState } from 'react'
import { subscribeToCustomers } from '../../services/customerService'
import { subscribeToGoals, saveGoalsForPeriod } from '../../services/goalService'
import { type CustomerItem, formatCurrency } from '../../models/customer'
import {
  emptyGoalValues, goalActuals, goalProgress, goalsDirty, parseTarget,
  periodRange, daysInPeriod,
  GOAL_FIELDS, GOAL_PERIODS, GOAL_STATE_STYLES,
  type GoalDoc, type GoalFieldDef, type GoalPeriod, type GoalProgress,
  type GoalValues, type PeriodRange,
} from '../../models/goal'
import { usePageTitle } from '../../hooks/usePageTitle'
import { useToast } from '../../components/Toast'
import PartialDataBanner from '../../components/PartialDataBanner'
import { Icon, ICONS } from '../../components/Icon'

/** How many periods back the navigator will go. */
const MAX_HISTORY = 12

function fmtValue(field: GoalFieldDef, v: number): string {
  return field.money ? formatCurrency(v) : String(Math.round(v))
}

/** A rate reads better rounded to something a person would say out loud. */
function fmtRate(field: GoalFieldDef, v: number): string {
  if (field.money) return formatCurrency(Math.round(v))
  return v >= 10 ? String(Math.round(v)) : v.toFixed(1)
}

export default function GoalsPage() {
  usePageTitle('Goals')
  const toast = useToast()

  const [customers, setCustomers]     = useState<CustomerItem[]>([])
  const [loadingData, setLoadingData] = useState(true)
  const [hitCap, setHitCap]           = useState(false)

  const [goals, setGoals] = useState<GoalDoc | null>(null)
  const [draft, setDraft] = useState<GoalValues>(emptyGoalValues())
  /** Raw input text per field, so a half-typed number isn't reformatted. */
  const [raw, setRaw]     = useState<Partial<Record<keyof GoalValues, string>>>({})
  const [editing, setEditing] = useState(false)
  const [saving, setSaving]   = useState(false)

  const [period, setPeriod] = useState<GoalPeriod>('month')
  /** 0 = current period, -1 = the one before it. */
  const [offset, setOffset] = useState(0)

  useEffect(() => {
    const unsub = subscribeToCustomers(
      // The cap flag was dropped, so past 5,000 records every actual on this
      // page is understated with nothing saying so.
      (items, cap) => { setCustomers(items); setHitCap(!!cap); setLoadingData(false) },
      ()           => setLoadingData(false),
    )
    return unsub
  }, [])

  // Was a one-shot getDoc, so the page never saw a colleague's change — and
  // then wrote the whole document back over it.
  useEffect(() => subscribeToGoals(setGoals, () => {}), [])

  const range = useMemo(() => periodRange(period, offset), [period, offset])
  const isCurrent = offset === 0

  /** Targets stored for this exact period instance. */
  const savedTargets = useMemo<GoalValues>(
    () => goals?.periods[range.key] ?? (isCurrent ? (goals?.[period] ?? emptyGoalValues()) : emptyGoalValues()),
    [goals, range.key, period, isCurrent],
  )

  const actuals = useMemo(() => goalActuals(customers, range), [customers, range])

  // Leaving edit mode whenever the period changes is what stops the old
  // uncontrolled input from showing one period's number while writing to
  // another's — the draft is always reset from the period now on screen.
  useEffect(() => {
    setEditing(false)
    setDraft(savedTargets)
    setRaw({})
  }, [range.key])

  useEffect(() => {
    if (!editing) { setDraft(savedTargets); setRaw({}) }
  }, [savedTargets, editing])

  const dirty = editing && goalsDirty(draft, savedTargets)
  const targets = editing ? draft : savedTargets

  function startEditing() {
    setDraft(savedTargets)
    setRaw({})
    setEditing(true)
  }

  function cancelEditing() {
    setDraft(savedTargets)
    setRaw({})
    setEditing(false)
  }

  function setTarget(field: keyof GoalValues, text: string) {
    setRaw(r => ({ ...r, [field]: text }))
    const parsed = parseTarget(text)
    // A cleared or malformed field leaves the stored number alone until it
    // parses, rather than silently writing 0.
    if (parsed !== null) setDraft(d => ({ ...d, [field]: parsed }))
    else if (text.trim() === '') setDraft(d => ({ ...d, [field]: 0 }))
  }

  const invalidFields = GOAL_FIELDS.filter(f => {
    const text = raw[f.key]
    return text !== undefined && text.trim() !== '' && parseTarget(text) === null
  })

  async function handleSave() {
    if (invalidFields.length > 0) {
      toast(`Check the ${invalidFields.map(f => f.label).join(' and ')} target.`, 'error')
      return
    }
    setSaving(true)
    try {
      // Writes only periods.{key}, so a colleague's other periods survive.
      await saveGoalsForPeriod(range.key, draft)
      setEditing(false)
      setRaw({})
      toast(`${range.label} targets saved.`, 'success')
    } catch {
      toast('Failed to save goals.', 'error')
    } finally {
      setSaving(false)
    }
  }

  const periodDays = daysInPeriod(range)

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-5">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-white">Goals</h1>
          {/* "N days remaining" used to appear here and again in all three
              cards — four copies of one string. It lives on the cards, where
              it sits beside the number it qualifies. */}
          <p className="text-sm text-gray-300 mt-0.5">
            {range.label}
            {!isCurrent && <span className="text-gray-400"> · closed</span>}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {editing ? (
            <>
              <button onClick={cancelEditing} disabled={saving} className="btn-secondary text-sm px-3 py-1.5">
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !dirty}
                title={!dirty ? 'No changes to save' : undefined}
                className="btn-primary text-sm px-4 py-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </>
          ) : (
            <button
              onClick={startEditing}
              className="btn-secondary text-sm px-3 py-1.5 flex items-center gap-1.5
                         focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
            >
              {/* Was a hand-rolled inline SVG path while ICONS.pencil existed. */}
              <Icon d={ICONS.pencil} className="w-3.5 h-3.5" />
              {isCurrent ? 'Edit targets' : 'Edit this period'}
            </button>
          )}
        </div>
      </div>

      {hitCap && <PartialDataBanner totals />}

      {/* Period type + instance navigation */}
      <div className="flex items-center gap-2 mb-6">
        <div className="flex gap-1 bg-gray-800 p-1 rounded-xl flex-1" role="group" aria-label="Goal period">
          {GOAL_PERIODS.map(p => (
            <button
              key={p.key}
              onClick={() => { setPeriod(p.key); setOffset(0) }}
              aria-pressed={period === p.key}
              className={`flex-1 text-center text-sm font-medium py-1.5 rounded-lg transition-colors
                          focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${
                period === p.key
                  ? 'bg-indigo-600 text-white'
                  : 'text-gray-300 hover:text-white hover:bg-gray-700'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        {/* Targets are stored per period instance now, so a closed period
            keeps its own — there was previously no way to see whether last
            month's goal had been hit, and nothing recorded that it existed. */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => setOffset(o => Math.max(-MAX_HISTORY, o - 1))}
            disabled={offset <= -MAX_HISTORY}
            aria-label="Previous period"
            className="p-1.5 rounded-lg text-gray-300 hover:text-white hover:bg-gray-700 disabled:opacity-30
                       focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
          >
            <Icon d={ICONS.chevronLeft} className="w-4 h-4" />
          </button>
          <button
            onClick={() => setOffset(o => Math.min(0, o + 1))}
            disabled={offset >= 0}
            aria-label="Next period"
            className="p-1.5 rounded-lg text-gray-300 hover:text-white hover:bg-gray-700 disabled:opacity-30
                       focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
          >
            <Icon d={ICONS.chevronRight} className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Goal cards */}
      <div className="space-y-4">
        {GOAL_FIELDS.map(field => (
          <GoalCard
            key={field.key}
            field={field}
            actual={actuals[field.key]}
            target={targets[field.key]}
            rawText={raw[field.key]}
            range={range}
            periodDays={periodDays}
            editing={editing}
            invalid={invalidFields.some(f => f.key === field.key)}
            onTargetChange={text => setTarget(field.key, text)}
            loading={loadingData}
          />
        ))}
      </div>

      {/* All periods summary */}
      <div className="mt-8">
        <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-3">
          All periods {offset !== 0 && <span className="normal-case font-normal text-gray-400">· same offset</span>}
        </h2>
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700 bg-gray-700/50">
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-300 uppercase tracking-wider w-28">Period</th>
                {GOAL_FIELDS.map(f => (
                  <th key={f.key} className="text-right px-4 py-2.5 text-xs font-semibold text-gray-300 uppercase tracking-wider">
                    {f.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700">
              {GOAL_PERIODS.map(p => {
                const r = periodRange(p.key, offset)
                const a = goalActuals(customers, r)
                const g = goals?.periods[r.key]
                  ?? (offset === 0 ? (goals?.[p.key] ?? emptyGoalValues()) : emptyGoalValues())
                const isRow = period === p.key
                return (
                  <tr
                    key={p.key}
                    /* Was bg-indigo-600/5 — 1.03:1, no highlight at all. */
                    className={`hover:bg-gray-700/50 transition-colors ${isRow ? 'bg-indigo-500/20' : ''}`}
                  >
                    <td className="px-4 py-3 text-gray-100 font-medium">
                      {r.short}
                      {isRow && <span className="ml-1.5 text-xs text-indigo-300 font-semibold">SHOWN</span>}
                    </td>
                    {GOAL_FIELDS.map(f => (
                      <td key={f.key} className="px-4 py-3 text-right">
                        <MiniProgress field={f} actual={a[f.key]} target={g[f.key]} range={r} />
                      </td>
                    ))}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ── GoalCard ──────────────────────────────────────────────────────────────────

function GoalCard({
  field, actual, target, rawText, range, periodDays, editing, invalid, onTargetChange, loading,
}: {
  field: GoalFieldDef
  actual: number
  target: number
  rawText: string | undefined
  range: PeriodRange
  periodDays: number
  editing: boolean
  invalid: boolean
  onTargetChange: (text: string) => void
  loading: boolean
}) {
  const p: GoalProgress = goalProgress(actual, target, range)
  const style = GOAL_STATE_STYLES[p.state]
  const hasTarget = target > 0
  const inputId = `goal-${field.key}`

  return (
    <div className="card px-5 py-4">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="flex items-center gap-2.5">
          {/* Was 💰 / 👤 / ✅ — platform bitmaps that ignore `color`. */}
          <Icon d={ICONS[field.icon]} className="w-5 h-5 text-gray-300" />
          <span className="font-semibold text-white">{field.label}</span>
        </div>
        {!editing && (
          <span className={`text-xs font-semibold ${style.textClass}`}>{style.label}</span>
        )}
      </div>

      {loading ? (
        <div className="h-8 bg-gray-700 animate-pulse rounded-lg mb-3" />
      ) : (
        <div className="flex items-end gap-3 mb-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-1 mb-1.5 flex-wrap">
              <span className="text-2xl font-bold text-white tabular-nums">{fmtValue(field, actual)}</span>
              <span className="text-gray-300 text-sm">of</span>
              {editing ? (
                <span className="flex items-center gap-0.5">
                  {field.money && <span className="text-gray-300 text-sm">$</span>}
                  {/* Controlled, and keyed on the period instance. As an
                      uncontrolled defaultValue this kept the previous
                      period's number on screen while writing to the new one,
                      because switching tabs changes props without remounting. */}
                  <input
                    id={inputId}
                    aria-label={`${field.label} target for ${range.label}`}
                    aria-invalid={invalid || undefined}
                    inputMode="decimal"
                    value={rawText ?? (target ? String(target) : '')}
                    onChange={e => onTargetChange(e.target.value)}
                    placeholder="set target"
                    className={`w-28 bg-gray-800 border rounded-lg px-2 py-0.5 text-sm text-white outline-none
                                focus:ring-1 tabular-nums ${
                      invalid
                        ? 'border-red-500 focus:ring-red-500'
                        : 'border-indigo-500 focus:ring-indigo-500'
                    }`}
                  />
                </span>
              ) : (
                <span className={`text-sm font-medium ${hasTarget ? 'text-gray-200' : 'text-gray-400 italic'}`}>
                  {hasTarget ? fmtValue(field, target) : 'no target'}
                </span>
              )}
            </div>

            {/* Progress bar, with the pace marker inside the same track so it
                lines up with the fill it describes. It used to live in a
                separate full-width block below, while the bar sat in a flex
                child narrowed by the percentage badge — so the 50% tick was
                never above the bar's 50% point. */}
            <div className="relative h-2 bg-gray-700 rounded-full overflow-hidden">
              {hasTarget && (
                <div
                  className={`h-full rounded-full transition-all duration-700 ${style.barClass}`}
                  style={{ width: `${p.barPct}%` }}
                />
              )}
              {hasTarget && !p.met && p.pace > 0 && p.pace < 1 && (
                <div
                  className="absolute top-0 bottom-0 w-0.5 bg-gray-200"
                  style={{ left: `${p.pace * 100}%` }}
                  title={`Expected pace: ${Math.round(p.pace * 100)}% of the period elapsed`}
                />
              )}
            </div>
          </div>

          {/* Uncapped: 100% and 250% used to render identically. */}
          {hasTarget && !editing && (
            <div className={`text-lg font-bold tabular-nums shrink-0 ${style.textClass}`}>
              {Math.round(p.pct)}%
            </div>
          )}
        </div>
      )}

      {/* Footer: what it would take, not just how long is left. */}
      {!editing && !loading && (
        <div className="flex items-center justify-between gap-3 text-xs text-gray-300 flex-wrap">
          <span>
            {p.daysLeft > 0
              ? `${p.daysLeft} of ${periodDays} day${periodDays !== 1 ? 's' : ''} left`
              : 'Period closed'}
          </span>
          {hasTarget && !p.met && p.neededPerDay !== null && (
            <span>
              {fmtValue(field, p.remaining)} to go —{' '}
              <span className={style.textClass}>{fmtRate(field, p.neededPerDay)}/day</span>
              {p.achievedPerDay > 0 && (
                <span className="text-gray-400"> vs {fmtRate(field, p.achievedPerDay)}/day so far</span>
              )}
            </span>
          )}
          {hasTarget && !p.met && p.neededPerDay === null && (
            <span className={style.textClass}>{fmtValue(field, p.remaining)} short</span>
          )}
          {hasTarget && p.met && p.pct > 100 && (
            <span className={style.textClass}>
              {fmtValue(field, actual - target)} over target
            </span>
          )}
        </div>
      )}
    </div>
  )
}

// ── MiniProgress (summary table cell) ────────────────────────────────────────

function MiniProgress({ field, actual, target, range }: {
  field: GoalFieldDef
  actual: number
  target: number
  range: PeriodRange
}) {
  if (target <= 0) {
    return (
      <span className="text-gray-400 text-sm tabular-nums">
        {fmtValue(field, actual)} <span className="text-gray-400">/ —</span>
      </span>
    )
  }
  const p = goalProgress(actual, target, range)
  const style = GOAL_STATE_STYLES[p.state]
  return (
    <span className="text-sm font-medium tabular-nums text-gray-200">
      {fmtValue(field, actual)} / {fmtValue(field, target)}
      {/* Was Math.min(100, …) here too, so an overachieving period read 100%. */}
      <span className={`ml-1.5 text-xs ${style.textClass}`}>{Math.round(p.pct)}%</span>
    </span>
  )
}
