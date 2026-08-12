import { useEffect, useMemo, useState } from 'react'
import { usePageTitle } from '../../hooks/usePageTitle'
import { subscribeToCustomers } from '../../services/customerService'
import type { CustomerItem } from '../../models/customer'
import { useAuthStore } from '../../stores/authStore'
import { usePickerStore } from '../../stores/pickerStore'
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from 'recharts'

type Period = 'week' | 'month' | 'lastMonth' | 'quarter' | 'year' | 'last12' | 'all'
type SalesmanSort = 'revenue' | 'leads' | 'customers'

const PERIOD_LABELS: Record<Period, string> = {
  week: 'This Week',
  month: 'This Month',
  lastMonth: 'Last Month',
  quarter: 'This Quarter',
  year: 'This Year',
  last12: 'Last 12M',
  all: 'All Time',
}

const PERIODS: Period[] = ['week', 'month', 'lastMonth', 'quarter', 'year', 'last12', 'all']

function getPeriodRange(period: Period): { start: Date; end: Date } {
  const now = new Date()
  const start = new Date(now)
  const end = new Date(now)
  end.setHours(23, 59, 59, 999)

  switch (period) {
    case 'week':
      start.setDate(now.getDate() - now.getDay())
      start.setHours(0, 0, 0, 0)
      break
    case 'month':
      start.setDate(1)
      start.setHours(0, 0, 0, 0)
      break
    case 'lastMonth': {
      start.setMonth(now.getMonth() - 1, 1)
      start.setHours(0, 0, 0, 0)
      end.setDate(0)
      end.setHours(23, 59, 59, 999)
      break
    }
    case 'quarter': {
      const qMonth = Math.floor(now.getMonth() / 3) * 3
      start.setMonth(qMonth, 1)
      start.setHours(0, 0, 0, 0)
      break
    }
    case 'year':
      start.setMonth(0, 1)
      start.setHours(0, 0, 0, 0)
      break
    case 'last12':
      start.setMonth(now.getMonth() - 11, 1)
      start.setHours(0, 0, 0, 0)
      break
    case 'all':
      start.setFullYear(2000)
      break
  }

  return { start, end }
}

function fmt(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

function fmtFull(n: number) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

interface SalesmanRow {
  name: string
  leads: number
  customers: number
  revenue: number
}

interface SourceRow {
  source: string
  count: number
  revenue: number
}

export default function ReportsPage() {
  usePageTitle('Reports')
  const companyId  = useAuthStore(s => s.companyId)
  const labels     = usePickerStore(s => s.labels)

  const [all, setAll]             = useState<CustomerItem[]>([])
  const [loading, setLoading]     = useState(true)
  const [period, setPeriod]       = useState<Period>('month')
  const [smSort, setSmSort]       = useState<SalesmanSort>('revenue')

  useEffect(() => {
    const unsub = subscribeToCustomers(
      items => { setAll(items); setLoading(false) },
      () => setLoading(false),
    )
    return unsub
  }, [companyId])

  const { start, end } = useMemo(() => getPeriodRange(period), [period])

  const periodItems = useMemo(
    () => all.filter(c => c.creationDate >= start && c.creationDate <= end),
    [all, start, end],
  )

  // ── KPIs ─────────────────────────────────────────────────────────────────────
  const kpi = useMemo(() => {
    const leads     = periodItems.filter(c => c.category.toLowerCase() === 'lead')
    const customers = periodItems.filter(c => c.category.toLowerCase() === 'customer')
    const revenue   = customers.reduce((s, c) => s + c.amount, 0)
    const avgDeal   = customers.length > 0 ? revenue / customers.length : 0
    return { leads: leads.length, customers: customers.length, revenue, avgDeal }
  }, [periodItems])

  // ── Salesman performance (all-time) ──────────────────────────────────────────
  const salesmanRows = useMemo<SalesmanRow[]>(() => {
    const map = new Map<string, SalesmanRow>()
    for (const c of all) {
      const cat = c.category.toLowerCase()
      if (cat !== 'lead' && cat !== 'customer') continue
      const name = c.salesman.trim() || 'Unassigned'
      const row  = map.get(name) ?? { name, leads: 0, customers: 0, revenue: 0 }
      if (cat === 'lead') row.leads++
      else { row.customers++; row.revenue += c.amount }
      map.set(name, row)
    }
    return [...map.values()].sort((a, b) => {
      if (smSort === 'revenue')   return b.revenue - a.revenue
      if (smSort === 'leads')     return b.leads - a.leads
      return b.customers - a.customers
    })
  }, [all, smSort])

  // ── Lead sources (all-time) ───────────────────────────────────────────────────
  const sourceRows = useMemo<SourceRow[]>(() => {
    const map = new Map<string, SourceRow>()
    for (const c of all) {
      const cat = c.category.toLowerCase()
      if (cat !== 'lead' && cat !== 'customer') continue
      const source = c.adNo.trim() || 'Unknown'
      const row    = map.get(source) ?? { source, count: 0, revenue: 0 }
      row.count++
      row.revenue += c.amount
      map.set(source, row)
    }
    return [...map.values()].sort((a, b) => b.count - a.count).slice(0, 10)
  }, [all])

  // ── Revenue + leads trend (last 12 months) ───────────────────────────────────
  const trendData = useMemo(() => {
    const now = new Date()
    const months: string[] = []
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
    }
    const rev: Record<string, number>  = {}
    const lds: Record<string, number>  = {}
    const cus: Record<string, number>  = {}
    months.forEach(m => { rev[m] = 0; lds[m] = 0; cus[m] = 0 })
    for (const c of all) {
      const d   = c.creationDate
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      if (!(key in rev)) continue
      const cat = c.category.toLowerCase()
      if (cat === 'customer') { rev[key] += c.amount; cus[key]++ }
      if (cat === 'lead')       lds[key]++
    }
    return months.map(key => {
      const [year, m] = key.split('-')
      const label = new Date(Number(year), Number(m) - 1)
        .toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
      return { month: label, revenue: rev[key], leads: lds[key], customers: cus[key] }
    })
  }, [all])

  const hasTrend = trendData.some(d => d.revenue > 0 || d.leads > 0)

  // ── CSV export ────────────────────────────────────────────────────────────────
  function exportCSV() {
    const smLabel = labels.salesman ?? 'Salesman'
    const header  = [smLabel, 'Leads', 'Customers', 'Revenue', 'Avg Deal', 'Conv %']
    const rows    = salesmanRows.map(r => [
      r.name,
      r.leads,
      r.customers,
      r.revenue.toFixed(2),
      r.customers > 0 ? (r.revenue / r.customers).toFixed(2) : '0',
      r.leads > 0 ? ((r.customers / r.leads) * 100).toFixed(1) + '%' : '—',
    ])
    const csv  = [header, ...rows].map(row => row.map(v => `"${v}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `salesman-report-${new Date().toISOString().split('T')[0]}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">Reports</h1>
        <button onClick={exportCSV} disabled={loading} className="btn-secondary text-sm px-3 py-1.5">
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

      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 animate-pulse">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="card h-20" />
          ))}
        </div>
      ) : (
        <>
          {/* KPI cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <KpiCard label="New Leads"      value={kpi.leads} />
            <KpiCard label="New Customers"  value={kpi.customers} />
            <KpiCard label="Revenue"        value={fmt(kpi.revenue)} green />
            <KpiCard label="Avg Deal"       value={fmt(kpi.avgDeal)} />
          </div>

          {/* Revenue trend chart */}
          {hasTrend && (
            <div className="card overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-700/50 bg-gray-800/50">
                <p className="text-sm font-semibold text-gray-200">
                  Revenue Trend <span className="text-gray-500 font-normal">(last 12 months)</span>
                </p>
              </div>
              <div className="px-2 pt-4 pb-2">
                <ResponsiveContainer width="100%" height={220}>
                  <ComposedChart data={trendData} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
                    <XAxis
                      dataKey="month"
                      tick={{ fill: '#9ca3af', fontSize: 11 }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      yAxisId="rev"
                      tick={{ fill: '#9ca3af', fontSize: 10 }}
                      axisLine={false}
                      tickLine={false}
                      width={56}
                      tickFormatter={v =>
                        v >= 1_000_000 ? `$${(v / 1_000_000).toFixed(1)}M`
                        : v >= 1_000   ? `$${(v / 1_000).toFixed(0)}k`
                        : `$${v}`
                      }
                    />
                    <YAxis
                      yAxisId="cnt"
                      orientation="right"
                      tick={{ fill: '#9ca3af', fontSize: 10 }}
                      axisLine={false}
                      tickLine={false}
                      width={28}
                      allowDecimals={false}
                    />
                    <Tooltip
                      contentStyle={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 8 }}
                      labelStyle={{ color: '#f3f4f6', fontWeight: 600 }}
                      itemStyle={{ color: '#d1d5db' }}
                      formatter={(value: number, name: string) => {
                        if (name === 'revenue') return [fmtFull(value), 'Revenue']
                        if (name === 'leads')   return [value, 'Leads']
                        return [value, name]
                      }}
                    />
                    <Bar yAxisId="rev" dataKey="revenue" fill="#4f46e5" radius={[4, 4, 0, 0]} maxBarSize={36} />
                    <Line yAxisId="cnt" dataKey="leads" type="monotone" stroke="#f97316" strokeWidth={2} dot={false} />
                  </ComposedChart>
                </ResponsiveContainer>
                <div className="flex items-center justify-center gap-5 mt-1">
                  <div className="flex items-center gap-1.5">
                    <div className="w-3 h-3 rounded-sm bg-indigo-500" />
                    <span className="text-xs text-gray-400">Revenue</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-5 border-t-2 border-orange-400" />
                    <span className="text-xs text-gray-400">Leads</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Salesman performance */}
          <div className="card overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700/50 bg-gray-800/50">
              <p className="text-sm font-semibold text-gray-200">
                {labels.salesman ?? 'Salesman'} Performance <span className="text-gray-500 font-normal">(all time)</span>
              </p>
              <div className="flex gap-1">
                {(['revenue', 'leads', 'customers'] as SalesmanSort[]).map(s => (
                  <button
                    key={s}
                    onClick={() => setSmSort(s)}
                    className={`text-xs px-2 py-1 rounded-lg capitalize transition-colors ${
                      smSort === s
                        ? 'bg-indigo-600/30 text-indigo-300'
                        : 'text-gray-500 hover:text-gray-300'
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>

            {salesmanRows.length === 0 ? (
              <p className="text-gray-500 text-sm text-center py-8">No data</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-gray-500 uppercase tracking-wider border-b border-gray-700/40">
                      <th className="px-4 py-2 text-left font-medium">{labels.salesman ?? 'Salesman'}</th>
                      <th className="px-3 py-2 text-right font-medium">Leads</th>
                      <th className="px-3 py-2 text-right font-medium">Customers</th>
                      <th className="px-3 py-2 text-right font-medium">Revenue</th>
                      <th className="px-3 py-2 text-right font-medium">Avg Deal</th>
                      <th className="px-3 py-2 text-right font-medium">Conv %</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-700/30">
                    {salesmanRows.map((r, i) => {
                      const conv = r.leads > 0 ? (r.customers / r.leads) * 100 : null
                      return (
                        <tr key={r.name} className="hover:bg-gray-700/20 transition-colors">
                          <td className="px-4 py-2.5 text-gray-200 font-medium">
                            <span className="text-gray-600 text-xs mr-2 tabular-nums">#{i + 1}</span>
                            {r.name}
                          </td>
                          <td className="px-3 py-2.5 text-right text-gray-400 tabular-nums">{r.leads}</td>
                          <td className="px-3 py-2.5 text-right text-gray-400 tabular-nums">{r.customers}</td>
                          <td className="px-3 py-2.5 text-right text-green-400 font-semibold tabular-nums">
                            {r.revenue > 0 ? fmtFull(r.revenue) : '—'}
                          </td>
                          <td className="px-3 py-2.5 text-right text-gray-400 tabular-nums">
                            {r.customers > 0 ? fmt(r.revenue / r.customers) : '—'}
                          </td>
                          <td className="px-3 py-2.5 text-right tabular-nums">
                            {conv !== null ? (
                              <span className={`text-xs font-semibold ${
                                conv >= 50 ? 'text-green-400' : conv >= 25 ? 'text-yellow-400' : 'text-gray-500'
                              }`}>
                                {conv.toFixed(0)}%
                              </span>
                            ) : '—'}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Lead sources */}
          {sourceRows.length > 0 && (
            <div className="card overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-700/50 bg-gray-800/50">
                <p className="text-sm font-semibold text-gray-200">
                  Lead Sources <span className="text-gray-500 font-normal">(all time)</span>
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-gray-500 uppercase tracking-wider border-b border-gray-700/40">
                      <th className="px-4 py-2 text-left font-medium">Source</th>
                      <th className="px-3 py-2 text-right font-medium">Records</th>
                      <th className="px-3 py-2 text-right font-medium">Revenue</th>
                      <th className="px-3 py-2 text-right font-medium">Share</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-700/30">
                    {sourceRows.map(r => {
                      const total = sourceRows.reduce((s, x) => s + x.count, 0)
                      const pct   = total > 0 ? (r.count / total) * 100 : 0
                      return (
                        <tr key={r.source} className="hover:bg-gray-700/20 transition-colors">
                          <td className="px-4 py-2.5 text-gray-200">{r.source}</td>
                          <td className="px-3 py-2.5 text-right text-gray-400 tabular-nums">{r.count}</td>
                          <td className="px-3 py-2.5 text-right text-green-400 tabular-nums">
                            {r.revenue > 0 ? fmtFull(r.revenue) : '—'}
                          </td>
                          <td className="px-3 py-2.5 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <div className="w-16 bg-gray-700 rounded-full h-1.5 overflow-hidden">
                                <div
                                  className="h-full bg-indigo-500 rounded-full"
                                  style={{ width: `${pct}%` }}
                                />
                              </div>
                              <span className="text-xs text-gray-500 tabular-nums w-8 text-right">
                                {pct.toFixed(0)}%
                              </span>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function KpiCard({ label, value, green }: { label: string; value: string | number; green?: boolean }) {
  return (
    <div className="card p-4">
      <p className="text-xs text-gray-500 mb-1.5">{label}</p>
      <p className={`text-2xl font-bold ${green ? 'text-green-400' : 'text-white'}`}>{value}</p>
    </div>
  )
}
