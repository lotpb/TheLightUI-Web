import { useEffect, useMemo, useState } from 'react'
import PartialDataBanner from '../../components/PartialDataBanner'
import { Icon, ICONS } from '../../components/Icon'
import { usePageTitle } from '../../hooks/usePageTitle'
import { subscribeToCustomers } from '../../services/customerService'
import { formatCurrency, type CustomerItem } from '../../models/customer'
import {
  barPercent, buildLeaderboard, describeBasis, formatMetricValue, metricValue,
  customersInRange, periodRange,
  METRIC_BAR, METRIC_LABELS, METRIC_TEXT, PERIOD_LABELS,
  type Metric, type Period, type RepStats,
} from '../../models/leaderboard'
import { useAuthStore } from '../../stores/authStore'
import { usePickerStore } from '../../stores/pickerStore'

/**
 * The page kept its own five-period list and its own getPeriodRange, whose
 * All Time branch was `start.setFullYear(2000)` on a copy of *now* — so All
 * Time began on this day-of-year in 2000. Both now come from the shared
 * helpers /reports uses, which also brings Last Month and Last 12M.
 */
const PERIODS: Period[] = ['week', 'month', 'lastMonth', 'quarter', 'year', 'last12', 'all']
const METRICS: Metric[] = ['revenue', 'customers', 'leads', 'avgDeal']

export default function LeaderboardPage() {
  usePageTitle('Leaderboard')
  const companyId = useAuthStore(s => s.companyId)
  const labels    = usePickerStore(s => s.labels)
  const smLabel   = labels.salesman ?? 'Salesman'

  const [all, setAll]         = useState<CustomerItem[]>([])
  const [loading, setLoading] = useState(true)
  const [hitCap, setHitCap]   = useState(false)
  const [period, setPeriod]   = useState<Period>('month')
  const [metric, setMetric]   = useState<Metric>('revenue')

  useEffect(() => {
    setLoading(true)
    const unsub = subscribeToCustomers(
      (items, cap) => { setAll(items); setHitCap(!!cap); setLoading(false) },
      ()           => setLoading(false),
    )
    return unsub
  }, [companyId])

  const range = useMemo(() => periodRange(period), [period])
  const periodItems = useMemo(
    () => customersInRange(all, range, period),
    [all, range, period],
  )
  const board = useMemo(() => buildLeaderboard(periodItems, metric), [periodItems, metric])

  const hasAnyone = board.ranked.length > 0 || board.excluded.length > 0

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-5">
      {hitCap && <PartialDataBanner totals />}

      <div>
        <h1 className="text-2xl font-bold text-white">Leaderboard</h1>
        <p className="text-sm text-gray-300 mt-0.5">
          {smLabel} performance for {PERIOD_LABELS[period].toLowerCase()}
        </p>
      </div>

      {/* Period selector */}
      <div className="flex gap-1.5 flex-wrap" role="group" aria-label="Period">
        {PERIODS.map(p => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            aria-pressed={period === p}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors whitespace-nowrap
                        focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${
              period === p
                ? 'bg-indigo-600 text-white'
                : 'bg-gray-800 text-gray-300 hover:text-white hover:bg-gray-700'
            }`}
          >
            {PERIOD_LABELS[p]}
          </button>
        ))}
      </div>

      {/* Metric selector */}
      <div className="flex gap-1.5 flex-wrap" role="group" aria-label="Ranking metric">
        {METRICS.map(m => (
          <button
            key={m}
            onClick={() => setMetric(m)}
            aria-pressed={metric === m}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors
                        focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${
              metric === m
                ? `${METRIC_BAR[m]} text-white`
                : 'bg-gray-800 text-gray-300 hover:text-white hover:bg-gray-700'
            }`}
          >
            {METRIC_LABELS[m]}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-3">
            {[1, 2, 3].map(i => <div key={i} className="card h-20 animate-pulse" />)}
          </div>
          <div className="card h-64 animate-pulse" />
        </div>
      ) : !hasAnyone ? (
        <div className="card p-10 text-center">
          {/* Was 🏆 — an emoji that paints its own bitmap and ignores `color`. */}
          <Icon d={ICONS.trophy} className="w-10 h-10 mx-auto mb-3 text-gray-400" />
          <p className="text-gray-100 text-sm font-medium">No data for {PERIOD_LABELS[period].toLowerCase()}.</p>
          <p className="text-gray-300 text-xs mt-1">Try a wider date range.</p>
        </div>
      ) : (
        <>
          {/* Company totals */}
          <div className="grid grid-cols-3 gap-3">
            {/* Were text-gray-500 — 3.04:1 — on the labels that say what each
                number is. */}
            <div className="card p-4">
              <p className="text-xs text-gray-300 mb-1">Total revenue</p>
              <p className="text-lg font-bold text-green-400 tabular-nums">{formatCurrency(board.totals.revenue)}</p>
            </div>
            <div className="card p-4">
              <p className="text-xs text-gray-300 mb-1">Sales</p>
              <p className="text-lg font-bold text-indigo-400 tabular-nums">{board.totals.customers.toLocaleString()}</p>
            </div>
            <div className="card p-4">
              <p className="text-xs text-gray-300 mb-1">Leads</p>
              <p className="text-lg font-bold text-violet-400 tabular-nums">{board.totals.leads.toLocaleString()}</p>
            </div>
          </div>

          {/* Rankings. The podium that used to sit here duplicated the top
              three of this table immediately below it, and rendered for two
              people as a gold-and-silver pair. */}
          <div className="card overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-700 bg-gray-700/50">
              <p className="text-sm font-semibold text-gray-100">
                Ranked by {METRIC_LABELS[metric].toLowerCase()}
              </p>
            </div>

            {board.ranked.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-gray-300">
                Nobody qualifies for this ranking.
              </p>
            ) : (
              <div className="divide-y divide-gray-700">
                {board.ranked.map((s, i) => (
                  <RankRow
                    key={s.name}
                    stats={s}
                    rank={i + 1}
                    metric={metric}
                    topValue={board.topValue}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Held out of the competition, with the reason — rather than
              silently competing (Unassigned) or silently winning on a single
              sale (average deal). */}
          {board.excluded.length > 0 && (
            <div className="card overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-700 bg-gray-700/50">
                <p className="text-sm font-semibold text-gray-100">Not ranked</p>
              </div>
              <div className="divide-y divide-gray-700">
                {board.excluded.map(s => (
                  <div key={s.name} className="px-4 py-3 flex items-center gap-3">
                    <div className="w-7 h-7 rounded-full bg-gray-600 flex items-center justify-center text-xs font-bold shrink-0 text-gray-100">
                      {s.name.trim()[0]?.toUpperCase() ?? '?'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-100 truncate">{s.name}</p>
                      <p className="text-xs text-gray-300">{s.excludedReason}</p>
                    </div>
                    <span className={`text-sm font-bold shrink-0 tabular-nums ${METRIC_TEXT[metric]}`}>
                      {formatMetricValue(metricValue(s, metric), metric, formatCurrency)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* What the ranking is actually measuring. Credit follows the
              record's current assignee, so a reassignment rewrites past
              periods — worth stating rather than implying this is history. */}
          <p className="text-xs text-gray-300">{describeBasis(metric)}</p>
        </>
      )}
    </div>
  )
}

// ─── One ranked row ──────────────────────────────────────────────────────────

function RankRow({ stats: s, rank, metric, topValue }: {
  stats: RepStats
  rank: number
  metric: Metric
  topValue: number
}) {
  const val = metricValue(s, metric)
  const pct = barPercent(val, topValue)
  const isLeader = rank === 1

  return (
    /* First place was bg-yellow-900/5 — a 5% tint measures 1.02:1, which is no
       tint at all — with a 2.37:1 ring. */
    <div className={`px-4 py-3 ${isLeader ? 'bg-amber-500/15' : ''}`}>
      <div className="flex items-center gap-3 mb-1.5">
        {/* Was 🥇🥈🥉 for ranks 1-3 and digits for 4+, so a 6px column
            alternated between emoji and numerals with no consistent way to
            read position — and the digits were text-gray-600 at 1.94:1. */}
        <span className={`text-sm w-6 text-center shrink-0 tabular-nums font-semibold ${
          /* amber-200, not amber-300: only the /15-plus-amber-200 pairing
             has a light-mode rule (index.css:487). amber-300 measures
             1.28:1 on this fill in light mode. */
          isLeader ? 'text-amber-200' : 'text-gray-300'
        }`}>
          {rank}
        </span>

        <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
          /* The leader's avatar matches everyone else's: text-gray-950 is
             near-white in light mode (--gray-950 is 241 245 249), so
             dark-on-amber inverted to 1.96:1. The row tint, the amber rank
             and the trophy carry the distinction instead. */
          'bg-gray-600 text-gray-100'
        }`}>
          {s.name.trim()[0]?.toUpperCase() ?? '?'}
        </div>

        <span className="text-sm font-medium text-gray-100 flex-1 truncate flex items-center gap-1.5">
          {s.name}
          {isLeader && <Icon d={ICONS.trophy} className="w-3.5 h-3.5 text-amber-400 shrink-0" />}
        </span>

        {/* Was text-gray-500 at 3.04:1 — the context that makes a rank mean
            something. */}
        <div className="hidden sm:flex items-center gap-4 text-xs text-gray-300 shrink-0 tabular-nums">
          {metric !== 'customers' && <span>{s.customers} sales</span>}
          {metric !== 'leads' && <span>{s.leads} leads</span>}
          {metric !== 'revenue' && metric !== 'avgDeal' && <span>{formatCurrency(s.revenue)}</span>}
        </div>

        <span className={`text-sm font-bold shrink-0 tabular-nums ${METRIC_TEXT[metric]}`}>
          {formatMetricValue(val, metric, formatCurrency)}
        </span>
      </div>

      {/* The track was bg-gray-800 on a .card that *is* bg-gray-800 — exactly
          1.000:1, so every bar floated with no scale behind it. */}
      <div className="ml-9 h-1.5 bg-gray-600 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${METRIC_BAR[metric]}`}
          style={{ width: `${pct}%`, opacity: isLeader ? 1 : 0.75 }}
        />
      </div>
    </div>
  )
}
