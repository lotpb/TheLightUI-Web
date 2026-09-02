import { useEffect, useMemo, useState } from 'react'
import PartialDataBanner from '../../components/PartialDataBanner'
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine, type TooltipProps,
} from 'recharts'
import { subscribeToCustomers } from '../../services/customerService'
import { usePageTitle } from '../../hooks/usePageTitle'
import type { CustomerItem } from '../../models/customer'

// ─── Helpers ─────────────────────────────────────────────────────────────────

const EPOCH_THRESHOLD = 86_400_000   // dates at/before epoch+1day are sentinel zeros

function isValidDate(d: Date | null): d is Date { return !!d && d.getTime() > EPOCH_THRESHOLD }

function isCustomer(c: CustomerItem) {
  return c.category.toLowerCase() === 'customer'
}
function isLead(c: CustomerItem) {
  return c.category.toLowerCase() === 'lead'
}

function revenueDate(c: CustomerItem): Date | null {
  if (isValidDate(c.completionDate)) return c.completionDate
  if (isValidDate(c.startDate))      return c.startDate
  return null
}

function monthKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function fmtMon(key: string) {
  const [y, m] = key.split('-')
  return new Date(parseInt(y), parseInt(m) - 1, 1)
    .toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
}

function fmtK(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(1)}K`
  return `$${n.toLocaleString()}`
}

function fmtPct(n: number) {
  return (n >= 0 ? '+' : '') + n.toFixed(1) + '%'
}

// Linear regression on (x, y) pairs → returns [slope, intercept]
function linReg(points: [number, number][]): [number, number] {
  if (points.length < 2) return [0, points[0]?.[1] ?? 0]
  const n  = points.length
  const sx  = points.reduce((s, [x]) => s + x, 0)
  const sy  = points.reduce((s, [, y]) => s + y, 0)
  const sxy = points.reduce((s, [x, y]) => s + x * y, 0)
  const sxx = points.reduce((s, [x]) => s + x * x, 0)
  const denom = n * sxx - sx * sx
  if (denom === 0) return [0, sy / n]
  const slope = (n * sxy - sx * sy) / denom
  const intercept = (sy - slope * sx) / n
  return [slope, intercept]
}

// Generate the last N month keys ending at (or before) today
function lastNMonths(n: number): string[] {
  const keys: string[] = []
  const d = new Date()
  for (let i = n - 1; i >= 0; i--) {
    const m = new Date(d.getFullYear(), d.getMonth() - i, 1)
    keys.push(monthKey(m))
  }
  return keys
}

// Generate next N month keys after today
function nextNMonths(n: number): string[] {
  const keys: string[] = []
  const d = new Date()
  for (let i = 1; i <= n; i++) {
    const m = new Date(d.getFullYear(), d.getMonth() + i, 1)
    keys.push(monthKey(m))
  }
  return keys
}

type Period = '6m' | '12m' | 'ytd' | 'all'
type ForecastMonths = 3 | 6 | 12

// ─── Main page ────────────────────────────────────────────────────────────────

export default function ForecastPage() {
  usePageTitle('Revenue Forecast')

  const [customers, setCustomers] = useState<CustomerItem[]>([])
  const [loading, setLoading]     = useState(true)
  const [hitCap, setHitCap] = useState(false)
  const [period, setPeriod]       = useState<Period>('12m')
  const [fwdMonths, setFwdMonths] = useState<ForecastMonths>(6)
  const [repFilter, setRepFilter] = useState('all')

  useEffect(() => {
    const unsub = subscribeToCustomers(
      (list, cap) => { setCustomers(list); setHitCap(!!cap); setLoading(false) },
      ()   => setLoading(false),
    )
    return unsub
  }, [])

  const allReps = useMemo(() => {
    const s = new Set<string>()
    customers.forEach(c => { if (c.salesman) s.add(c.salesman) })
    return Array.from(s).sort()
  }, [customers])

  // Filter by rep
  const filtered = useMemo(() => (
    repFilter === 'all' ? customers : customers.filter(c => c.salesman === repFilter)
  ), [customers, repFilter])

  // Revenue records — customers with valid amount + date
  const revenueRecords = useMemo(() =>
    filtered
      .filter(c => isCustomer(c) && c.amount > 0)
      .map(c => ({ date: revenueDate(c), amount: c.amount, salesman: c.salesman }))
      .filter(r => r.date !== null) as { date: Date; amount: number; salesman: string }[],
    [filtered]
  )

  // Date range for "period" filter
  const periodStart = useMemo(() => {
    const now = new Date()
    if (period === 'ytd') return new Date(now.getFullYear(), 0, 1)
    if (period === '6m')  return new Date(now.getFullYear(), now.getMonth() - 5, 1)
    if (period === '12m') return new Date(now.getFullYear(), now.getMonth() - 11, 1)
    return null   // 'all'
  }, [period])

  const inPeriod = useMemo(() =>
    revenueRecords.filter(r => !periodStart || r.date >= periodStart),
    [revenueRecords, periodStart]
  )

  // Build monthly revenue map for historical chart
  const historicalMap = useMemo(() => {
    const map = new Map<string, number>()
    inPeriod.forEach(r => {
      const k = monthKey(r.date)
      map.set(k, (map.get(k) ?? 0) + r.amount)
    })
    return map
  }, [inPeriod])

  // Chart window
  const histKeys = useMemo(() => {
    const n = period === '6m' ? 6 : period === 'ytd'
      ? new Date().getMonth() + 1
      : period === '12m' ? 12 : 24
    return lastNMonths(n)
  }, [period])

  // Forecast via linear regression on last 6 data points (or all if fewer)
  const forecast = useMemo(() => {
    const keys  = lastNMonths(12)
    const actuals = keys.map((k, i) => [i, historicalMap.get(k) ?? 0] as [number, number])
    const nonZero = actuals.filter(([, v]) => v > 0)
    if (nonZero.length < 2) return null

    const [slope, intercept] = linReg(nonZero.slice(-6))
    const nextKeys = nextNMonths(fwdMonths)
    const base = 12   // index offset for future months
    return nextKeys.map((k, i) => ({
      key: k,
      projected: Math.max(0, Math.round(slope * (base + i) + intercept)),
      low:  Math.max(0, Math.round((slope * (base + i) + intercept) * 0.8)),
      high: Math.max(0, Math.round((slope * (base + i) + intercept) * 1.2)),
    }))
  }, [historicalMap, fwdMonths])

  // Combined chart data: historical + forecast
  const chartData = useMemo(() => {
    const hist = histKeys.map(k => ({
      month: fmtMon(k),
      actual: historicalMap.get(k) ?? 0,
      projected: undefined as number | undefined,
      low: undefined as number | undefined,
      high: undefined as number | undefined,
    }))
    const fwd = (forecast ?? []).map(f => ({
      month: fmtMon(f.key),
      actual: undefined as number | undefined,
      projected: f.projected,
      low: f.low,
      high: f.high,
    }))
    return [...hist, ...fwd]
  }, [histKeys, historicalMap, forecast])

  // KPIs
  const totalActual  = inPeriod.reduce((s, r) => s + r.amount, 0)
  const avgDeal      = inPeriod.length > 0 ? totalActual / inPeriod.length : 0
  const monthCount   = histKeys.filter(k => (historicalMap.get(k) ?? 0) > 0).length
  const avgMonthly   = monthCount > 0 ? totalActual / monthCount : 0
  const projectedTotal = (forecast ?? []).reduce((s, f) => s + f.projected, 0)

  // Growth rate: compare first half vs second half of period
  const growthRate = useMemo(() => {
    const keys = histKeys.filter(k => (historicalMap.get(k) ?? 0) > 0)
    if (keys.length < 4) return null
    const half = Math.floor(keys.length / 2)
    const first  = keys.slice(0, half).reduce((s, k) => s + (historicalMap.get(k) ?? 0), 0)
    const second = keys.slice(half).reduce((s, k) => s + (historicalMap.get(k) ?? 0), 0)
    if (first === 0) return null
    return (second - first) / first * 100
  }, [histKeys, historicalMap])
      {hitCap && <PartialDataBanner totals />}

  // Pipeline value — leads with an amount set
  const pipelineRecords = useMemo(() =>
    filtered.filter(c => isLead(c) && c.amount > 0),
    [filtered]
  )
  const pipelineTotal = pipelineRecords.reduce((s, c) => s + c.amount, 0)

  // By salesman
  const byRep = useMemo(() => {
    const map = new Map<string, { revenue: number; deals: number }>()
    inPeriod.forEach(r => {
      const rep = r.salesman || '(unassigned)'
      const cur = map.get(rep) ?? { revenue: 0, deals: 0 }
      map.set(rep, { revenue: cur.revenue + r.amount, deals: cur.deals + 1 })
    })
    return Array.from(map.entries())
      .map(([rep, v]) => ({ rep, ...v }))
      .sort((a, b) => b.revenue - a.revenue)
  }, [inPeriod])

  // Monthly deals count chart (bar)
  const dealsData = useMemo(() => {
    const map = new Map<string, number>()
    inPeriod.forEach(r => {
      const k = monthKey(r.date)
      map.set(k, (map.get(k) ?? 0) + 1)
    })
    return histKeys.map(k => ({ month: fmtMon(k), deals: map.get(k) ?? 0 }))
  }, [histKeys, inPeriod])

  const customTooltip = ({ active, payload, label }: TooltipProps<number, string>) => {
    if (!active || !payload?.length) return null
    return (
      <div className="bg-gray-900 border border-gray-700 rounded-xl p-3 text-xs shadow-xl">
        <p className="font-semibold text-gray-200 mb-1.5">{label}</p>
        {payload.filter(p => p.value !== undefined).map(p => (
          <div key={p.name} className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full" style={{ background: p.color ?? '#6366f1' }} />
            <span className="text-gray-400 capitalize">{p.name}:</span>
            <span className="text-gray-100 font-medium">{fmtK(p.value ?? 0)}</span>
          </div>
        ))}
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[300px]">
        <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-white">Revenue Forecast</h1>
          <p className="text-sm text-gray-400 mt-0.5">Historical revenue with forward projection</p>
        </div>
      </div>

      {/* Controls */}
      <div className="card p-3 flex flex-wrap items-center gap-3">
        {/* Period */}
        <div className="flex rounded-lg overflow-hidden border border-gray-700 text-sm">
          {([
            { key: 'ytd',  label: 'YTD' },
            { key: '6m',   label: '6M' },
            { key: '12m',  label: '12M' },
            { key: 'all',  label: 'All' },
          ] as { key: Period; label: string }[]).map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setPeriod(key)}
              className={`px-4 py-1.5 font-medium transition-colors ${period === key ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-gray-100'}`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Forecast window */}
        <div className="flex items-center gap-2 text-sm">
          <span className="text-gray-400 text-xs">Forecast:</span>
          <div className="flex rounded-lg overflow-hidden border border-gray-700">
            {([3, 6, 12] as ForecastMonths[]).map(m => (
              <button
                key={m}
                onClick={() => setFwdMonths(m)}
                className={`px-3 py-1.5 font-medium transition-colors ${fwdMonths === m ? 'bg-violet-600 text-white' : 'text-gray-400 hover:text-gray-100'}`}
              >
                +{m}mo
              </button>
            ))}
          </div>
        </div>

        {/* Rep filter */}
        <select
          value={repFilter}
          onChange={e => setRepFilter(e.target.value)}
          className="input-field text-sm py-1.5 pr-8 ml-auto"
        >
          <option value="all">All Salespeople</option>
          {allReps.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard
          label="Revenue (Period)"
          value={fmtK(totalActual)}
          sub={`${inPeriod.length} closed deal${inPeriod.length !== 1 ? 's' : ''}`}
          color="text-green-400"
        />
        <KpiCard
          label="Avg Deal Size"
          value={fmtK(avgDeal)}
          sub="per closed deal"
          color="text-indigo-400"
        />
        <KpiCard
          label="Monthly Avg"
          value={fmtK(avgMonthly)}
          sub={growthRate !== null ? `${fmtPct(growthRate)} growth` : 'across active months'}
          color={growthRate !== null && growthRate >= 0 ? 'text-green-400' : 'text-red-400'}
        />
        <KpiCard
          label={`${fwdMonths}-Mo Forecast`}
          value={fmtK(projectedTotal)}
          sub={`Pipeline: ${fmtK(pipelineTotal)}`}
          color="text-violet-400"
        />
      </div>

      {/* Revenue trend + forecast chart */}
      <div className="card p-4">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <p className="text-sm font-semibold text-gray-300">Revenue Trend & Forecast</p>
          <div className="flex items-center gap-4 text-xs text-gray-400">
            <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-1 rounded bg-emerald-500" /> Actual</span>
            <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-1 rounded bg-violet-400 opacity-70 border-dashed border-b border-violet-400" /> Projected</span>
          </div>
        </div>
        {chartData.some(d => (d.actual ?? 0) > 0 || (d.projected ?? 0) > 0) ? (
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={chartData} margin={{ left: 0, right: 16, top: 4 }}>
              <defs>
                <linearGradient id="gradActual" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#10b981" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gradProjected" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#8b5cf6" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gradBand" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%"  stopColor="#8b5cf6" stopOpacity={0.12} />
                  <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0.03} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis dataKey="month" tick={{ fill: '#9ca3af', fontSize: 10 }} />
              <YAxis
                tickFormatter={v => fmtK(v)}
                tick={{ fill: '#9ca3af', fontSize: 10 }}
                width={56}
              />
              <Tooltip content={customTooltip} />
              <ReferenceLine
                x={fmtMon(nextNMonths(1)[0])}
                stroke="#6b7280"
                strokeDasharray="4 3"
                label={{ value: 'Today', fill: '#6b7280', fontSize: 10, position: 'insideTopRight' }}
              />
              {/* Confidence band */}
              <Area type="monotone" dataKey="high" stroke="none" fill="url(#gradBand)" legendType="none" />
              <Area type="monotone" dataKey="low"  stroke="none" fill="#1f2937"        legendType="none" />
              {/* Actual revenue */}
              <Area
                type="monotone"
                dataKey="actual"
                name="actual"
                stroke="#10b981"
                strokeWidth={2}
                fill="url(#gradActual)"
                dot={{ r: 3, fill: '#10b981', strokeWidth: 0 }}
                activeDot={{ r: 5 }}
                connectNulls={false}
              />
              {/* Forecast */}
              <Area
                type="monotone"
                dataKey="projected"
                name="projected"
                stroke="#8b5cf6"
                strokeWidth={2}
                strokeDasharray="5 3"
                fill="url(#gradProjected)"
                dot={{ r: 3, fill: '#8b5cf6', strokeWidth: 0 }}
                activeDot={{ r: 5 }}
                connectNulls={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex items-center justify-center h-[200px] text-gray-500 text-sm">
            No revenue data in this period
          </div>
        )}
        {forecast && (
          <p className="text-xs text-gray-600 mt-2 text-center">
            Projection based on linear trend of recent months · ±20% confidence band shown
          </p>
        )}
      </div>

      {/* Deals closed per month */}
      <div className="card p-4">
        <p className="text-sm font-semibold text-gray-300 mb-3">Deals Closed Per Month</p>
        {dealsData.some(d => d.deals > 0) ? (
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={dealsData} margin={{ left: 0, right: 16 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
              <XAxis dataKey="month" tick={{ fill: '#9ca3af', fontSize: 10 }} />
              <YAxis tick={{ fill: '#9ca3af', fontSize: 10 }} width={24} allowDecimals={false} />
              <Tooltip
                contentStyle={{ background: '#1f2937', border: '1px solid #374151', borderRadius: '8px', color: '#f9fafb', fontSize: 12 }}
                formatter={(v: number) => [v, 'Deals']}
              />
              <Bar dataKey="deals" name="Deals" fill="#6366f1" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex items-center justify-center h-[100px] text-gray-500 text-sm">No deals in this period</div>
        )}
      </div>

      {/* Two-column: by rep + forecast table */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* By salesperson */}
        <div className="card overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-700/50 bg-gray-800/50">
            <p className="text-sm font-semibold text-gray-300">By Salesperson</p>
          </div>
          {byRep.length > 0 ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-700/40 bg-gray-800/20">
                  <th className="text-left px-4 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wider">Rep</th>
                  <th className="text-right px-4 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wider">Revenue</th>
                  <th className="text-right px-4 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wider">Deals</th>
                  <th className="text-right px-4 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wider">Avg</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700/30">
                {byRep.map((r, i) => (
                  <tr key={r.rep} className="hover:bg-gray-800/30">
                    <td className="px-4 py-2.5 text-gray-200 font-medium flex items-center gap-1.5">
                      {i === 0 && <span className="text-xs">🥇</span>}
                      {i === 1 && <span className="text-xs">🥈</span>}
                      {i === 2 && <span className="text-xs">🥉</span>}
                      {i > 2 && <span className="text-xs text-gray-600 w-4">{i + 1}</span>}
                      {r.rep}
                    </td>
                    <td className="px-4 py-2.5 text-green-400 font-semibold text-right">{fmtK(r.revenue)}</td>
                    <td className="px-4 py-2.5 text-gray-400 text-right">{r.deals}</td>
                    <td className="px-4 py-2.5 text-gray-400 text-right">{fmtK(r.revenue / r.deals)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="px-4 py-8 text-center text-gray-500 text-sm">No revenue data</div>
          )}
        </div>

        {/* Forecast table */}
        <div className="card overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-700/50 bg-gray-800/50">
            <p className="text-sm font-semibold text-gray-300">Monthly Forecast (+{fwdMonths} months)</p>
          </div>
          {forecast ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-700/40 bg-gray-800/20">
                  <th className="text-left px-4 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wider">Month</th>
                  <th className="text-right px-4 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wider">Low</th>
                  <th className="text-right px-4 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wider">Projected</th>
                  <th className="text-right px-4 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wider">High</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700/30">
                {forecast.map(f => (
                  <tr key={f.key} className="hover:bg-gray-800/30">
                    <td className="px-4 py-2.5 text-gray-200 font-medium">{fmtMon(f.key)}</td>
                    <td className="px-4 py-2.5 text-gray-500 text-right">{fmtK(f.low)}</td>
                    <td className="px-4 py-2.5 text-violet-300 font-semibold text-right">{fmtK(f.projected)}</td>
                    <td className="px-4 py-2.5 text-gray-500 text-right">{fmtK(f.high)}</td>
                  </tr>
                ))}
                <tr className="border-t border-gray-600/50 bg-gray-800/30">
                  <td className="px-4 py-2.5 font-semibold text-gray-200">Total</td>
                  <td className="px-4 py-2.5 text-gray-400 font-semibold text-right">
                    {fmtK(forecast.reduce((s, f) => s + f.low, 0))}
                  </td>
                  <td className="px-4 py-2.5 text-violet-300 font-bold text-right">
                    {fmtK(projectedTotal)}
                  </td>
                  <td className="px-4 py-2.5 text-gray-400 font-semibold text-right">
                    {fmtK(forecast.reduce((s, f) => s + f.high, 0))}
                  </td>
                </tr>
              </tbody>
            </table>
          ) : (
            <div className="px-4 py-8 text-center text-gray-500 text-sm">
              Need at least 2 months of data to generate a forecast
            </div>
          )}
        </div>
      </div>

      {/* Pipeline */}
      {pipelineRecords.length > 0 && (
        <div className="card p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-semibold text-gray-300">Pipeline — Open Leads with Est. Value</p>
            <span className="text-sm font-bold text-indigo-300">{fmtK(pipelineTotal)} total</span>
          </div>
          <div className="space-y-2">
            {pipelineRecords
              .sort((a, b) => b.amount - a.amount)
              .slice(0, 10)
              .map(c => (
                <div key={c.id} className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-200 truncate">{c.first} {c.lastname}</p>
                    {c.salesman && <p className="text-xs text-gray-500">{c.salesman}</p>}
                  </div>
                  <span className="text-sm font-semibold text-indigo-300 shrink-0">{fmtK(c.amount)}</span>
                  <div className="w-24 h-1.5 rounded-full bg-gray-700 overflow-hidden shrink-0">
                    <div
                      className="h-full rounded-full bg-indigo-500"
                      style={{ width: `${Math.round(c.amount / pipelineRecords[0].amount * 100)}%` }}
                    />
                  </div>
                </div>
              ))}
            {pipelineRecords.length > 10 && (
              <p className="text-xs text-gray-500 pt-1">+ {pipelineRecords.length - 10} more leads in pipeline</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Sub-component ────────────────────────────────────────────────────────────

function KpiCard({ label, value, sub, color }: { label: string; value: string; sub: string; color: string }) {
  return (
    <div className="card p-4">
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">{label}</p>
      <p className={`text-2xl font-bold mt-1 truncate ${color}`}>{value}</p>
      <p className="text-xs text-gray-500 mt-0.5">{sub}</p>
    </div>
  )
}
