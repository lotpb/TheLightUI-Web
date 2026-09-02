import { useEffect, useMemo, useState } from 'react'
import PartialDataBanner from '../../components/PartialDataBanner'
import { Link } from 'react-router-dom'
import { usePageTitle } from '../../hooks/usePageTitle'
import { subscribeToCustomers } from '../../services/customerService'
import { type CustomerItem } from '../../models/customer'
import { useAuthStore } from '../../stores/authStore'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, BarChart, Bar,
} from 'recharts'

// ─── Helpers ──────────────────────────────────────────────────────────────────

type Period = 'all' | 'year' | '6m' | '3m' | 'month'

const PERIODS: { key: Period; label: string }[] = [
  { key: 'all',   label: 'All Time' },
  { key: 'year',  label: 'This Year' },
  { key: '6m',    label: '6 Months' },
  { key: '3m',    label: '3 Months' },
  { key: 'month', label: 'This Month' },
]

function periodStart(p: Period): Date | null {
  const d = new Date(); d.setHours(0, 0, 0, 0)
  if (p === 'month') { d.setDate(1); return d }
  if (p === '3m')    { d.setMonth(d.getMonth() - 3); return d }
  if (p === '6m')    { d.setMonth(d.getMonth() - 6); return d }
  if (p === 'year')  { d.setMonth(0, 1); return d }
  return null
}

function pct(n: number, total: number): number {
  return total === 0 ? 0 : Math.round(n / total * 100)
}

function fmt$(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(1)}K`
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 })
}

function isLead(c: CustomerItem)     { return c.category.toLowerCase() === 'lead' }
function isCustomer(c: CustomerItem) { return c.category.toLowerCase() === 'customer' }

const FUNNEL_COLORS = ['#6366f1', '#8b5cf6', '#a855f7', '#ec4899', '#f59e0b']
const REP_COLORS    = ['#6366f1', '#8b5cf6', '#ec4899', '#10b981', '#f59e0b', '#3b82f6', '#f97316', '#ef4444']

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function FunnelPage() {
  usePageTitle('Lead Funnel')
  const companyId = useAuthStore(s => s.companyId)

  const [all, setAll]         = useState<CustomerItem[]>([])
  const [loading, setLoading] = useState(true)
  const [hitCap, setHitCap] = useState(false)
  const [period, setPeriod]   = useState<Period>('all')
  const [repFilter, setRepFilter] = useState('')

  useEffect(() => {
    const unsub = subscribeToCustomers(
      (items, cap) => { setAll(items); setHitCap(!!cap); setLoading(false) },
      ()    => setLoading(false),
    )
    return unsub
  }, [companyId])

  // All reps who have leads or customers
  const reps = useMemo(() => {
    const s = new Set<string>()
    for (const c of all) if (c.salesman) s.add(c.salesman)
    return [...s].sort()
  }, [all])

  // Period-filtered slice (uses creationDate)
  const inPeriod = useMemo(() => {
    const start = periodStart(period)
    let items = all
    if (start) items = items.filter(c => c.creationDate >= start)
    if (repFilter) items = items.filter(c => c.salesman === repFilter)
    return items
  }, [all, period, repFilter])

  // Funnel counts
  const leads     = useMemo(() => inPeriod.filter(isLead), [inPeriod])
  const called    = useMemo(() => leads.filter(c => c.callback.toLowerCase() === 'yes'), [leads])
  const customers = useMemo(() => inPeriod.filter(isCustomer), [inPeriod])
  const withJob   = useMemo(() => customers.filter(c => c.startDate && c.startDate.getTime() > 86_400_000), [customers])
  const completed = useMemo(() => customers.filter(c => c.completionDate && c.completionDate.getTime() > 86_400_000 && c.startDate && c.completionDate > c.startDate), [customers])

  const revenue     = useMemo(() => customers.reduce((s, c) => s + c.amount, 0), [customers])
  const avgDeal     = customers.length > 0 ? revenue / customers.length : 0
  const callRate    = pct(called.length, leads.length)
  const convRate    = pct(customers.length, leads.length)

  const funnelSteps = [
    { label: 'Leads',          count: leads.length,     color: FUNNEL_COLORS[0] },
    { label: 'Called',         count: called.length,    color: FUNNEL_COLORS[1] },
    { label: 'Customers',      count: customers.length, color: FUNNEL_COLORS[2] },
    { label: 'Jobs Started',   count: withJob.length,   color: FUNNEL_COLORS[3] },
    { label: 'Jobs Completed', count: completed.length, color: FUNNEL_COLORS[4] },
  ]
  const maxCount = Math.max(leads.length, 1)

  // Monthly trend — last 12 months (always uses all data, not period-filtered)
  const monthlyTrend = useMemo(() => {
    const now = new Date()
    return Array.from({ length: 12 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - (11 - i), 1)
      const y = d.getFullYear(), m = d.getMonth()
      const inMonth = (c: CustomerItem) => c.creationDate.getFullYear() === y && c.creationDate.getMonth() === m
      const repItems = repFilter ? all.filter(c => c.salesman === repFilter) : all
      return {
        month:     d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
        leads:     repItems.filter(c => isLead(c) && inMonth(c)).length,
        customers: repItems.filter(c => isCustomer(c) && inMonth(c)).length,
      }
    })
  }, [all, repFilter])

  // By salesman
  const byRep = useMemo(() => {
    const repSet = repFilter ? [repFilter] : reps
    return repSet.map(rep => {
      const repItems = inPeriod.filter(c => c.salesman === rep)
      const repLeads = repItems.filter(isLead)
      const repCalled = repLeads.filter(c => c.callback.toLowerCase() === 'yes')
      const repCusts  = repItems.filter(isCustomer)
      const repRev    = repCusts.reduce((s, c) => s + c.amount, 0)
      return {
        rep,
        leads:     repLeads.length,
        called:    repCalled.length,
        callPct:   pct(repCalled.length, repLeads.length),
        customers: repCusts.length,
        convPct:   pct(repCusts.length, repLeads.length),
        revenue:   repRev,
      }
    }).filter(r => r.leads > 0 || r.customers > 0)
      .sort((a, b) => b.revenue - a.revenue)
  }, [inPeriod, reps, repFilter])

  // By lead source
  const bySource = useMemo(() => {
    const src = new Map<string, { leads: number; customers: number }>()
    for (const c of inPeriod) {
      const key = c.leadSource?.trim() || '(none)'
      const cur = src.get(key) ?? { leads: 0, customers: 0 }
      if (isLead(c))     cur.leads++
      if (isCustomer(c)) cur.customers++
      src.set(key, cur)
    }
    return [...src.entries()]
      .map(([source, v]) => ({ source, ...v, total: v.leads + v.customers }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 10)
  }, [inPeriod])

  const maxSource = Math.max(...bySource.map(s => s.total), 1)

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-5">
      {hitCap && <PartialDataBanner totals />}

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-white">Lead Funnel</h1>
          <p className="text-sm text-gray-400 mt-0.5">Conversion rates from lead to completed job</p>
        </div>
        <select
          value={repFilter}
          onChange={e => setRepFilter(e.target.value)}
          className="input-field text-sm py-1.5 w-40 shrink-0"
        >
          <option value="">All Reps</option>
          {reps.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
      </div>

      {/* Period tabs */}
      <div className="flex gap-1.5 flex-wrap">
        {PERIODS.map(p => (
          <button
            key={p.key}
            onClick={() => setPeriod(p.key)}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
              period === p.key
                ? 'bg-indigo-600 text-white'
                : 'bg-gray-800 text-gray-400 hover:text-gray-200'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="card p-12 flex items-center justify-center">
          <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <>
          {/* KPI strip */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'Total Leads',   value: leads.length.toString(),     color: 'text-indigo-400' },
              { label: 'Call Rate',     value: `${callRate}%`,              color: callRate >= 60 ? 'text-green-400' : callRate >= 40 ? 'text-yellow-400' : 'text-red-400' },
              { label: 'Conv. Rate',    value: `${convRate}%`,              color: convRate >= 30 ? 'text-green-400' : convRate >= 15 ? 'text-yellow-400' : 'text-red-400' },
              { label: 'Avg Deal',      value: avgDeal > 0 ? fmt$(avgDeal) : '—', color: 'text-green-400' },
            ].map(k => (
              <div key={k.label} className="card p-4">
                <p className={`text-xl font-bold ${k.color}`}>{k.value}</p>
                <p className="text-xs text-gray-500 mt-0.5">{k.label}</p>
              </div>
            ))}
          </div>

          {/* Funnel visualization */}
          <div className="card overflow-hidden">
            <div className="px-4 py-2 border-b border-gray-700/50 bg-gray-800/50">
              <p className="text-sm font-semibold uppercase tracking-wider text-gray-400">Conversion Funnel</p>
            </div>
            <div className="p-6 space-y-2">
              {funnelSteps.map((step, i) => {
                const barPct = Math.max(12, Math.round(step.count / maxCount * 100))
                const dropPct = i > 0 ? pct(step.count, funnelSteps[i - 1].count) : 100
                return (
                  <div key={step.label}>
                    {i > 0 && (
                      <div className="flex items-center justify-center py-0.5">
                        <span className="text-xs text-gray-600">
                          ↓ {dropPct}% proceed
                        </span>
                      </div>
                    )}
                    <div className="flex items-center gap-3">
                      <div className="w-28 shrink-0 text-right">
                        <span className="text-xs font-medium text-gray-400">{step.label}</span>
                      </div>
                      <div className="flex-1 flex items-center gap-2">
                        <div className="flex-1 bg-gray-800 rounded-full h-8 overflow-hidden">
                          <div
                            className="h-full rounded-full flex items-center justify-end pr-3 transition-all duration-500"
                            style={{ width: `${barPct}%`, background: step.color }}
                          >
                            <span className="text-xs font-bold text-white">{step.count}</span>
                          </div>
                        </div>
                        {i > 0 && (
                          <span className="text-xs text-gray-500 w-12 shrink-0">
                            {pct(step.count, leads.length)}% of leads
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Revenue total */}
            {revenue > 0 && (
              <div className="px-6 pb-5 flex items-center justify-between border-t border-gray-700/30 pt-4">
                <span className="text-sm text-gray-400">Total Revenue from Customers</span>
                <span className="text-lg font-bold text-green-400">{fmt$(revenue)}</span>
              </div>
            )}
          </div>

          {/* Monthly trend */}
          <div className="card overflow-hidden">
            <div className="px-4 py-2 border-b border-gray-700/50 bg-gray-800/50 flex items-center justify-between">
              <p className="text-sm font-semibold uppercase tracking-wider text-gray-400">Monthly Trend</p>
              <div className="flex items-center gap-4 text-xs text-gray-500">
                <span className="flex items-center gap-1.5"><span className="w-3 h-1.5 rounded bg-indigo-500 inline-block" />Leads</span>
                <span className="flex items-center gap-1.5"><span className="w-3 h-1.5 rounded bg-emerald-500 inline-block" />Customers</span>
              </div>
            </div>
            <div className="p-4 h-48">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={monthlyTrend} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gLeads" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#6366f1" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="gCusts" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#10b981" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                  <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#6b7280' }} />
                  <YAxis tick={{ fontSize: 10, fill: '#6b7280' }} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{ background: '#1f2937', border: '1px solid #374151', borderRadius: '8px', fontSize: '12px' }}
                    labelStyle={{ color: '#9ca3af' }}
                    itemStyle={{ color: '#e5e7eb' }}
                  />
                  <Area type="monotone" dataKey="leads"     name="Leads"     stroke="#6366f1" fill="url(#gLeads)" strokeWidth={2} dot={false} />
                  <Area type="monotone" dataKey="customers" name="Customers" stroke="#10b981" fill="url(#gCusts)" strokeWidth={2} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* By Salesman */}
          {byRep.length > 0 && (
            <div className="card overflow-hidden">
              <div className="px-4 py-2 border-b border-gray-700/50 bg-gray-800/50">
                <p className="text-sm font-semibold uppercase tracking-wider text-gray-400">By Salesman</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-700/50">
                      {['Rep', 'Leads', 'Called', 'Call %', 'Customers', 'Conv %', 'Revenue'].map(h => (
                        <th key={h} className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-700/30">
                    {byRep.map((row, i) => (
                      <tr key={row.rep} className="hover:bg-gray-700/20 transition-colors">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div className="w-2 h-2 rounded-full shrink-0" style={{ background: REP_COLORS[i % REP_COLORS.length] }} />
                            <span className="font-medium text-gray-200">{row.rep}</span>
                            {i === 0 && <span className="text-xs">🥇</span>}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-gray-300">{row.leads}</td>
                        <td className="px-4 py-3 text-gray-300">{row.called}</td>
                        <td className="px-4 py-3">
                          <span className={`font-medium ${row.callPct >= 60 ? 'text-green-400' : row.callPct >= 40 ? 'text-yellow-400' : 'text-red-400'}`}>
                            {row.callPct}%
                          </span>
                        </td>
                        <td className="px-4 py-3 text-gray-300">{row.customers}</td>
                        <td className="px-4 py-3">
                          <span className={`font-medium ${row.convPct >= 30 ? 'text-green-400' : row.convPct >= 15 ? 'text-yellow-400' : 'text-gray-400'}`}>
                            {row.convPct}%
                          </span>
                        </td>
                        <td className="px-4 py-3 font-semibold text-green-400">
                          {row.revenue > 0 ? fmt$(row.revenue) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mini bar chart per rep */}
              {byRep.length > 1 && (
                <div className="px-4 pb-4 pt-3 border-t border-gray-700/30 h-36">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={byRep} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
                      <XAxis dataKey="rep" tick={{ fontSize: 10, fill: '#6b7280' }} />
                      <YAxis tick={{ fontSize: 10, fill: '#6b7280' }} allowDecimals={false} />
                      <Tooltip
                        contentStyle={{ background: '#1f2937', border: '1px solid #374151', borderRadius: '8px', fontSize: '12px' }}
                        labelStyle={{ color: '#9ca3af' }}
                        itemStyle={{ color: '#e5e7eb' }}
                      />
                      <Bar dataKey="leads"     name="Leads"     fill="#6366f1" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="customers" name="Customers" fill="#10b981" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          )}

          {/* By Lead Source */}
          {bySource.length > 0 && (
            <div className="card overflow-hidden">
              <div className="px-4 py-2 border-b border-gray-700/50 bg-gray-800/50">
                <p className="text-sm font-semibold uppercase tracking-wider text-gray-400">Lead Sources</p>
              </div>
              <div className="divide-y divide-gray-700/30">
                {bySource.map(src => {
                  const barW = Math.round(src.total / maxSource * 100)
                  const srcConv = pct(src.customers, src.leads)
                  return (
                    <div key={src.source} className="flex items-center gap-3 px-4 py-3">
                      <div className="w-28 shrink-0">
                        <p className="text-sm font-medium text-gray-300 truncate" title={src.source}>
                          {src.source}
                        </p>
                      </div>
                      <div className="flex-1 bg-gray-800 rounded-full h-2 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-indigo-500 transition-all duration-500"
                          style={{ width: `${barW}%` }}
                        />
                      </div>
                      <div className="flex items-center gap-3 shrink-0 text-xs tabular-nums">
                        <span className="text-gray-400 w-16 text-right">{src.leads} leads</span>
                        <span className="text-gray-600">→</span>
                        <span className="text-gray-400 w-20 text-right">{src.customers} customers</span>
                        <span className={`w-10 font-semibold text-right ${srcConv >= 30 ? 'text-green-400' : srcConv >= 15 ? 'text-yellow-400' : 'text-gray-500'}`}>
                          {src.leads > 0 ? `${srcConv}%` : '—'}
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {leads.length === 0 && customers.length === 0 && (
            <div className="card p-12 text-center space-y-2">
              <p className="text-3xl">📊</p>
              <p className="text-gray-400 text-sm">No leads or customers in this period.</p>
              <Link to="/leads" className="inline-block text-sm text-indigo-400 hover:text-indigo-300 mt-1">
                View Leads →
              </Link>
            </div>
          )}
        </>
      )}
    </div>
  )
}
