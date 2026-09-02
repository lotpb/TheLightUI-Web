import { useEffect, useMemo, useState } from 'react'
import PartialDataBanner from '../../components/PartialDataBanner'
import { usePageTitle } from '../../hooks/usePageTitle'
import { subscribeToCustomers } from '../../services/customerService'
import type { CustomerItem } from '../../models/customer'
import { formatCurrency } from '../../models/customer'
import { useAuthStore } from '../../stores/authStore'
import { usePickerStore } from '../../stores/pickerStore'

type Period = 'week' | 'month' | 'quarter' | 'year' | 'all'
type Metric = 'revenue' | 'customers' | 'leads' | 'avgDeal'

const PERIOD_LABELS: Record<Period, string> = {
  week: 'This Week', month: 'This Month',
  quarter: 'This Quarter', year: 'This Year', all: 'All Time',
}
const PERIODS: Period[] = ['week', 'month', 'quarter', 'year', 'all']

const METRIC_LABELS: Record<Metric, string> = {
  revenue:   'Revenue',
  customers: 'Customers',
  leads:     'Leads',
  avgDeal:   'Avg Deal',
}

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
    case 'quarter': {
      const qMonth = Math.floor(now.getMonth() / 3) * 3
      start.setMonth(qMonth, 1); start.setHours(0, 0, 0, 0); break
    }
    case 'year':
      start.setMonth(0, 1); start.setHours(0, 0, 0, 0); break
    case 'all':
      start.setFullYear(2000); break
  }
  return { start, end }
}

interface SalesmanStats {
  name: string
  revenue: number
  customers: number
  leads: number
  avgDeal: number
}

const MEDALS = ['🥇', '🥈', '🥉']

function metricValue(s: SalesmanStats, metric: Metric): number {
  return s[metric]
}

function formatMetric(value: number, metric: Metric): string {
  if (metric === 'revenue' || metric === 'avgDeal') return formatCurrency(value)
  return value.toLocaleString()
}

function metricColor(metric: Metric): string {
  switch (metric) {
    case 'revenue':   return 'bg-green-500'
    case 'customers': return 'bg-indigo-500'
    case 'leads':     return 'bg-violet-500'
    case 'avgDeal':   return 'bg-teal-500'
  }
}

function metricTextColor(metric: Metric): string {
  switch (metric) {
    case 'revenue':   return 'text-green-400'
    case 'customers': return 'text-indigo-400'
    case 'leads':     return 'text-violet-400'
    case 'avgDeal':   return 'text-teal-400'
  }
}

// ─── Podium card for top 3 ────────────────────────────────────────────────────

function PodiumCard({
  rank, stats, metric,
}: {
  rank: number
  stats: SalesmanStats
  metric: Metric
}) {
  const medal     = MEDALS[rank] ?? `#${rank + 1}`
  const value     = metricValue(stats, metric)
  const formatted = formatMetric(value, metric)
  const isFirst   = rank === 0

  return (
    <div className={`card p-4 flex flex-col items-center text-center gap-2 ${
      isFirst ? 'ring-1 ring-yellow-500/40 bg-yellow-900/5' : ''
    }`}>
      <div className="text-2xl">{medal}</div>
      <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold ${
        isFirst ? 'bg-yellow-900/40 text-yellow-300' : 'bg-gray-800 text-gray-300'
      }`}>
        {stats.name.trim()[0]?.toUpperCase() ?? '?'}
      </div>
      <div>
        <p className={`text-sm font-semibold truncate max-w-[100px] ${isFirst ? 'text-yellow-200' : 'text-gray-200'}`}>
          {stats.name}
        </p>
        <p className={`text-xs font-bold mt-0.5 ${metricTextColor(metric)}`}>{formatted}</p>
      </div>
      {metric !== 'revenue' && (
        <p className="text-xs text-gray-600">{formatCurrency(stats.revenue)}</p>
      )}
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function LeaderboardPage() {
  usePageTitle('Leaderboard')
  const companyId = useAuthStore(s => s.companyId)
  const labels    = usePickerStore(s => s.labels)
  const smLabel   = labels.salesman ?? 'Salesman'

  const [all, setAll]         = useState<CustomerItem[]>([])
  const [loading, setLoading] = useState(true)
  const [hitCap, setHitCap] = useState(false)
  const [period, setPeriod]   = useState<Period>('month')
  const [metric, setMetric]   = useState<Metric>('revenue')

  useEffect(() => {
    setLoading(true)
    const unsub = subscribeToCustomers(
      (items, cap) => { setAll(items); setHitCap(!!cap); setLoading(false) },
      ()    => setLoading(false),
    )
    return unsub
  }, [companyId])

  const { start, end } = useMemo(() => getPeriodRange(period), [period])

  const periodItems = useMemo(
    () => all.filter(c => c.creationDate >= start && c.creationDate <= end),
    [all, start, end],
  )

  const ranked = useMemo<SalesmanStats[]>(() => {
    const map = new Map<string, { revenue: number; customers: number; leads: number }>()
    for (const c of periodItems) {
      const name = c.salesman.trim() || 'Unassigned'
      const row  = map.get(name) ?? { revenue: 0, customers: 0, leads: 0 }
      const cat  = c.category.toLowerCase()
      if (cat === 'customer') {
        row.customers++
        row.revenue += c.amount
      } else if (cat === 'lead') {
        row.leads++
      }
      map.set(name, row)
    }
    return [...map.entries()]
      .map(([name, { revenue, customers, leads }]) => ({
        name, revenue, customers, leads,
        avgDeal: customers > 0 ? revenue / customers : 0,
      }))
      .filter(s => s.revenue > 0 || s.customers > 0 || s.leads > 0)
      .sort((a, b) => metricValue(b, metric) - metricValue(a, metric))
  }, [periodItems, metric])

  const topValue = ranked[0] ? metricValue(ranked[0], metric) : 1

  const totals = useMemo(() => ({
    revenue:   ranked.reduce((s, r) => s + r.revenue, 0),
    customers: ranked.reduce((s, r) => s + r.customers, 0),
    leads:     ranked.reduce((s, r) => s + r.leads, 0),
  }), [ranked])

  const podium = ranked.slice(0, 3)

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-5">
      {hitCap && <PartialDataBanner totals />}

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white">Leaderboard</h1>
        <p className="text-sm text-gray-400 mt-0.5">{smLabel} performance ranking</p>
      </div>

      {/* Period selector */}
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

      {/* Metric selector */}
      <div className="flex gap-1.5 flex-wrap">
        {(Object.keys(METRIC_LABELS) as Metric[]).map(m => (
          <button
            key={m}
            onClick={() => setMetric(m)}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
              metric === m
                ? `${metricColor(m)} text-white`
                : 'bg-gray-800 text-gray-400 hover:text-gray-200'
            }`}
          >
            {METRIC_LABELS[m]}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="card animate-pulse h-64" />
      ) : ranked.length === 0 ? (
        <div className="card p-10 text-center">
          <p className="text-4xl mb-3">🏆</p>
          <p className="text-gray-400 text-sm">No data for this period.</p>
          <p className="text-gray-600 text-xs mt-1">Try selecting a wider date range.</p>
        </div>
      ) : (
        <>
          {/* KPI strip */}
          <div className="grid grid-cols-3 gap-3">
            <div className="card p-4">
              <p className="text-xs text-gray-500 mb-1">Total Revenue</p>
              <p className="text-lg font-bold text-green-400">{formatCurrency(totals.revenue)}</p>
            </div>
            <div className="card p-4">
              <p className="text-xs text-gray-500 mb-1">Customers</p>
              <p className="text-lg font-bold text-indigo-400">{totals.customers}</p>
            </div>
            <div className="card p-4">
              <p className="text-xs text-gray-500 mb-1">Leads</p>
              <p className="text-lg font-bold text-violet-400">{totals.leads}</p>
            </div>
          </div>

          {/* Podium — top 3 */}
          {podium.length >= 2 && (
            <div className={`grid gap-3 ${podium.length === 3 ? 'grid-cols-3' : 'grid-cols-2'}`}>
              {podium.map((s, i) => (
                <PodiumCard key={s.name} rank={i} stats={s} metric={metric} />
              ))}
            </div>
          )}

          {/* Full table */}
          <div className="card overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-700/50 bg-gray-800/50">
              <p className="text-sm font-semibold text-gray-200">
                All Rankings — {METRIC_LABELS[metric]}
              </p>
            </div>
            <div className="divide-y divide-gray-700/30">
              {ranked.map((s, i) => {
                const val      = metricValue(s, metric)
                const pct      = topValue > 0 ? (val / topValue) * 100 : 0
                const medal    = MEDALS[i]
                const isTop3   = i < 3

                return (
                  <div key={s.name} className={`px-4 py-3 ${isTop3 ? '' : ''}`}>
                    <div className="flex items-center gap-3 mb-1.5">
                      {/* Rank */}
                      <span className={`text-sm w-6 text-center shrink-0 ${
                        medal ? 'text-base' : 'text-gray-600 font-medium'
                      }`}>
                        {medal ?? `${i + 1}`}
                      </span>

                      {/* Avatar */}
                      <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                        i === 0 ? 'bg-yellow-900/40 text-yellow-300'
                        : i === 1 ? 'bg-gray-600/40 text-gray-300'
                        : i === 2 ? 'bg-orange-900/40 text-orange-300'
                        : 'bg-gray-800 text-gray-400'
                      }`}>
                        {s.name.trim()[0]?.toUpperCase() ?? '?'}
                      </div>

                      {/* Name */}
                      <span className="text-sm font-medium text-gray-200 flex-1 truncate">{s.name}</span>

                      {/* Secondary stats */}
                      <div className="hidden sm:flex items-center gap-4 text-xs text-gray-500 shrink-0">
                        {metric !== 'customers' && (
                          <span>{s.customers} sales</span>
                        )}
                        {metric !== 'leads' && (
                          <span>{s.leads} leads</span>
                        )}
                        {metric !== 'revenue' && metric !== 'avgDeal' && (
                          <span>{formatCurrency(s.revenue)}</span>
                        )}
                      </div>

                      {/* Primary value */}
                      <span className={`text-sm font-bold shrink-0 tabular-nums ${metricTextColor(metric)}`}>
                        {formatMetric(val, metric)}
                      </span>
                    </div>

                    {/* Progress bar */}
                    <div className="ml-9 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${metricColor(metric)}`}
                        style={{ width: `${pct}%`, opacity: isTop3 ? 1 : 0.6 }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
