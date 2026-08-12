import { useEffect, useMemo, useState } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell,
} from 'recharts'
import { subscribeToCustomers } from '../../services/customerService'

import { usePageTitle } from '../../hooks/usePageTitle'
import type { CustomerItem } from '../../models/customer'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function norm(s: string) { return s.trim().toUpperCase() }

function isLead(c: CustomerItem) { return norm(c.category) === 'LEAD' }
function isCustomer(c: CustomerItem) { return norm(c.category) === 'CUSTOMER' }

function fmtK(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(1)}K`
  return `$${n.toLocaleString()}`
}

function revenue(c: CustomerItem) {
  return isNaN(c.amount) ? 0 : c.amount
}

// Interpolate between two hex colors by t ∈ [0,1]
function lerpColor(from: string, to: string, t: number): string {
  const f = parseInt(from.slice(1), 16)
  const tC = parseInt(to.slice(1), 16)
  const r = Math.round(((f >> 16) & 0xff) + t * (((tC >> 16) & 0xff) - ((f >> 16) & 0xff)))
  const g = Math.round(((f >> 8) & 0xff) + t * (((tC >> 8) & 0xff) - ((f >> 8) & 0xff)))
  const b = Math.round((f & 0xff) + t * ((tC & 0xff) - (f & 0xff)))
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
}

const HEAT_LOW  = '#1e3a5f'   // cool blue — 1 record
const HEAT_HIGH = '#f97316'   // hot orange — max records

interface CityRow {
  key: string       // "CITY, ST"
  city: string
  state: string
  total: number
  leads: number
  customers: number
  revenue: number
}

interface StateRow {
  state: string
  total: number
  leads: number
  customers: number
  revenue: number
  cities: CityRow[]
}

type SortKey = 'total' | 'leads' | 'customers' | 'revenue'
type View = 'state' | 'city'

// ─── Main page ────────────────────────────────────────────────────────────────

export default function HeatMapPage() {
  usePageTitle('Geographic Distribution')

  const [customers, setCustomers] = useState<CustomerItem[]>([])
  const [loading, setLoading]     = useState(true)

  // Filters
  const [catFilter,  setCatFilter]  = useState<'all' | 'lead' | 'customer'>('all')
  const [salesFilter, setSalesFilter] = useState('all')
  const [stateFilter, setStateFilter] = useState<string | null>(null)   // drill-down
  const [view, setView] = useState<View>('state')
  const [sortKey, setSortKey] = useState<SortKey>('total')
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>('desc')

  useEffect(() => {
    const unsub = subscribeToCustomers(
      list => { setCustomers(list); setLoading(false) },
      ()   => setLoading(false),
    )
    return unsub
  }, [])

  // All unique salespeople
  const allReps = useMemo(() => {
    const s = new Set<string>()
    customers.forEach(c => { if (c.salesman) s.add(c.salesman) })
    return Array.from(s).sort()
  }, [customers])

  // Apply top-level filters (category + salesman)
  const filtered = useMemo(() => customers.filter(c => {
    if (catFilter === 'lead'     && !isLead(c))     return false
    if (catFilter === 'customer' && !isCustomer(c)) return false
    if (salesFilter !== 'all'   && c.salesman !== salesFilter) return false
    return true
  }), [customers, catFilter, salesFilter])

  // Build state rows
  const stateRows = useMemo(() => {
    const map = new Map<string, StateRow>()
    filtered.forEach(c => {
      const st = norm(c.state) || '—'
      let row = map.get(st)
      if (!row) {
        row = { state: st, total: 0, leads: 0, customers: 0, revenue: 0, cities: [] }
        map.set(st, row)
      }
      row.total++
      if (isLead(c)) row.leads++
      if (isCustomer(c)) row.customers++
      row.revenue += revenue(c)

      // city sub-row
      const city = norm(c.city) || '—'
      const cityKey = `${city}, ${st}`
      let cr = row.cities.find(x => x.key === cityKey)
      if (!cr) {
        cr = { key: cityKey, city, state: st, total: 0, leads: 0, customers: 0, revenue: 0 }
        row.cities.push(cr)
      }
      cr.total++
      if (isLead(c)) cr.leads++
      if (isCustomer(c)) cr.customers++
      cr.revenue += revenue(c)
    })
    return Array.from(map.values())
  }, [filtered])

  // Build city rows (all, or filtered by selected state)
  const cityRows = useMemo(() => {
    const rows: CityRow[] = []
    stateRows.forEach(sr => {
      if (!stateFilter || sr.state === stateFilter) {
        rows.push(...sr.cities)
      }
    })
    return rows
  }, [stateRows, stateFilter])

  // Sort helper
  function sortRows<T extends { total: number; leads: number; customers: number; revenue: number }>(rows: T[]): T[] {
    return [...rows].sort((a, b) => {
      const diff = a[sortKey] - b[sortKey]
      return sortDir === 'desc' ? -diff : diff
    })
  }

  const sortedStates = sortRows(stateRows)
  const sortedCities = sortRows(cityRows)

  // Chart data: top 15 states or cities
  const chartData = useMemo(() => {
    const rows = view === 'state' ? sortedStates : sortedCities
    return rows.slice(0, 15).map(r => ({
      name: view === 'state' ? (r as StateRow).state : (r as CityRow).city,
      total: r.total,
      leads: r.leads,
      customers: r.customers,
    }))
  }, [sortedStates, sortedCities, view])

  const maxTotal = useMemo(() => Math.max(...(view === 'state' ? sortedStates : sortedCities).map(r => r.total), 1), [sortedStates, sortedCities, view])

  // KPIs
  const totalRecords  = filtered.length
  const totalStates   = stateRows.length
  const topState      = sortedStates[0]?.state ?? '—'
  const topCity       = useMemo(() => sortRows(cityRows)[0]?.city ?? '—', [cityRows])
  const totalRevenue  = filtered.reduce((s, c) => s + revenue(c), 0)

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    else { setSortKey(key); setSortDir('desc') }
  }

  function sortArrow(key: SortKey) {
    if (sortKey !== key) return <span className="text-gray-700 ml-1">↕</span>
    return <span className="text-indigo-400 ml-1">{sortDir === 'desc' ? '↓' : '↑'}</span>
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[300px]">
        <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const tableRows = view === 'state' ? sortedStates : sortedCities

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-white">Geographic Distribution</h1>
          <p className="text-sm text-gray-400 mt-0.5">Where your business is concentrated</p>
        </div>

        {/* Drill-back breadcrumb */}
        {stateFilter && (
          <button
            onClick={() => { setStateFilter(null); setView('state') }}
            className="text-sm text-indigo-400 hover:text-indigo-300 flex items-center gap-1"
          >
            ← All States
          </button>
        )}
      </div>

      {/* ── Filters ── */}
      <div className="card p-3 flex flex-wrap items-center gap-3">
        {/* Category */}
        <div className="flex rounded-lg overflow-hidden border border-gray-700 text-sm">
          {(['all', 'lead', 'customer'] as const).map(v => (
            <button
              key={v}
              onClick={() => setCatFilter(v)}
              className={`px-3 py-1.5 font-medium capitalize transition-colors ${catFilter === v ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-gray-100'}`}
            >
              {v === 'all' ? 'All' : v.charAt(0).toUpperCase() + v.slice(1) + 's'}
            </button>
          ))}
        </div>

        {/* Salesman */}
        <select
          value={salesFilter}
          onChange={e => setSalesFilter(e.target.value)}
          className="input-field text-sm py-1.5 pr-8"
        >
          <option value="all">All Salespeople</option>
          {allReps.map(r => <option key={r} value={r}>{r}</option>)}
        </select>

        {/* View toggle */}
        <div className="ml-auto flex rounded-lg overflow-hidden border border-gray-700 text-sm">
          <button
            onClick={() => { setView('state'); setStateFilter(null) }}
            className={`px-3 py-1.5 font-medium transition-colors ${view === 'state' ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-gray-100'}`}
          >
            By State
          </button>
          <button
            onClick={() => setView('city')}
            className={`px-3 py-1.5 font-medium transition-colors ${view === 'city' ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-gray-100'}`}
          >
            By City
          </button>
        </div>
      </div>

      {/* ── KPI cards ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard label="Total Records" value={totalRecords.toLocaleString()} sub={`${totalStates} state${totalStates !== 1 ? 's' : ''}`} />
        <KpiCard label="Top State"     value={topState}      sub={`${sortedStates[0]?.total ?? 0} records`} />
        <KpiCard label="Top City"      value={topCity}       sub={`${sortRows(cityRows)[0]?.total ?? 0} records`} />
        <KpiCard label="Total Revenue" value={fmtK(totalRevenue)} sub="from customers" />
      </div>

      {/* ── Bar chart — top 15 ── */}
      {chartData.length > 0 && (
        <div className="card p-4">
          <p className="text-sm font-semibold text-gray-300 mb-3">
            Top {Math.min(chartData.length, 15)} {view === 'state' ? 'States' : 'Cities'}
            {stateFilter ? ` in ${stateFilter}` : ''}
          </p>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={chartData} layout="vertical" margin={{ left: 8, right: 16 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" horizontal={false} />
              <XAxis type="number" tick={{ fill: '#9ca3af', fontSize: 11 }} />
              <YAxis
                type="category"
                dataKey="name"
                tick={{ fill: '#d1d5db', fontSize: 11 }}
                width={view === 'state' ? 36 : 90}
              />
              <Tooltip
                contentStyle={{ background: '#1f2937', border: '1px solid #374151', borderRadius: '8px', color: '#f9fafb', fontSize: 12 }}
                cursor={{ fill: 'rgba(99,102,241,0.1)' }}
                formatter={(value: number, name: string) => [value, name.charAt(0).toUpperCase() + name.slice(1)]}
              />
              <Bar dataKey="leads" name="Leads" stackId="a" fill="#6366f1" radius={[0, 0, 0, 0]}>
                {chartData.map((_, i) => (
                  <Cell key={i} fill={lerpColor(HEAT_LOW, HEAT_HIGH, chartData[i].total / maxTotal)} />
                ))}
              </Bar>
              <Bar dataKey="customers" name="Customers" stackId="a" fill="#10b981" />
            </BarChart>
          </ResponsiveContainer>
          <p className="text-xs text-gray-500 mt-2 text-center">Color intensity indicates concentration — from cool (fewer) to warm (more)</p>
        </div>
      )}

      {/* ── Heat grid — visual block map ── */}
      {view === 'state' && (
        <div className="card p-4">
          <p className="text-sm font-semibold text-gray-300 mb-3">State Heat Map</p>
          <div className="flex flex-wrap gap-2">
            {sortedStates.map(sr => {
              const intensity = sr.total / maxTotal
              const bg = lerpColor(HEAT_LOW, HEAT_HIGH, intensity)
              const isSelected = stateFilter === sr.state
              return (
                <button
                  key={sr.state}
                  onClick={() => {
                    if (isSelected) { setStateFilter(null); setView('state') }
                    else { setStateFilter(sr.state); setView('city') }
                  }}
                  title={`${sr.state}: ${sr.total} records`}
                  style={{ backgroundColor: bg }}
                  className={`relative flex flex-col items-center justify-center w-14 h-14 rounded-lg text-white text-xs font-bold transition-all shadow-md hover:scale-105 ${isSelected ? 'ring-2 ring-white ring-offset-1 ring-offset-gray-900 scale-105' : ''}`}
                >
                  <span className="text-[11px] font-bold leading-none">{sr.state}</span>
                  <span className="text-[9px] font-normal opacity-80 mt-0.5">{sr.total}</span>
                </button>
              )
            })}
            {stateRows.length === 0 && (
              <p className="text-gray-500 text-sm">No geographic data available.</p>
            )}
          </div>
          <div className="flex items-center gap-2 mt-3">
            <span className="text-[10px] text-gray-500">Fewer</span>
            <div className="flex-1 h-2 rounded-full" style={{ background: `linear-gradient(to right, ${HEAT_LOW}, ${HEAT_HIGH})` }} />
            <span className="text-[10px] text-gray-500">More</span>
          </div>
        </div>
      )}

      {/* ── City grid when state is selected ── */}
      {view === 'city' && stateFilter && (
        <div className="card p-4">
          <p className="text-sm font-semibold text-gray-300 mb-3">Cities in {stateFilter}</p>
          <div className="flex flex-wrap gap-2">
            {sortRows(cityRows).map(cr => {
              const intensity = cr.total / maxTotal
              const bg = lerpColor(HEAT_LOW, HEAT_HIGH, intensity)
              return (
                <div
                  key={cr.key}
                  style={{ backgroundColor: bg }}
                  className="flex flex-col items-center justify-center px-3 py-2 rounded-lg text-white text-xs font-semibold shadow-md min-w-[60px]"
                >
                  <span className="text-[10px] font-bold leading-none text-center">{cr.city}</span>
                  <span className="text-[9px] font-normal opacity-80 mt-0.5">{cr.total}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Data table ── */}
      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-700/50 bg-gray-800/50">
          <p className="text-sm font-semibold text-gray-300">
            {view === 'state' ? `All States (${stateRows.length})` : `All Cities${stateFilter ? ` in ${stateFilter}` : ''} (${cityRows.length})`}
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700/50 bg-gray-800/30">
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                  {view === 'state' ? 'State' : 'City'}
                </th>
                {view === 'city' && <th className="text-left px-3 py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wider">State</th>}
                <SortTh label="Total"     sortKey="total"     onSort={toggleSort} sortArrow={sortArrow} />
                <SortTh label="Leads"     sortKey="leads"     onSort={toggleSort} sortArrow={sortArrow} />
                <SortTh label="Customers" sortKey="customers" onSort={toggleSort} sortArrow={sortArrow} />
                <SortTh label="Revenue"   sortKey="revenue"   onSort={toggleSort} sortArrow={sortArrow} />
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wider">Conv %</th>
                <th className="px-4 py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wider">Concentration</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700/30">
              {tableRows.map((row, i) => {
                const isState = view === 'state'
                const label   = isState ? (row as StateRow).state : (row as CityRow).city
                const stLabel = isState ? null : (row as CityRow).state
                const pct     = row.total > 0 ? Math.round(row.customers / row.total * 100) : 0
                const barPct  = Math.round(row.total / maxTotal * 100)
                const bg      = lerpColor(HEAT_LOW, HEAT_HIGH, row.total / maxTotal)

                return (
                  <tr
                    key={i}
                    className={`hover:bg-gray-800/40 transition-colors ${isState ? 'cursor-pointer' : ''}`}
                    onClick={() => {
                      if (isState) { setStateFilter((row as StateRow).state); setView('city') }
                    }}
                  >
                    <td className="px-4 py-2.5">
                      <span className="font-semibold text-white">{label}</span>
                      {isState && <span className="text-gray-500 text-xs ml-1">→</span>}
                    </td>
                    {!isState && <td className="px-3 py-2.5 text-gray-400 text-xs">{stLabel}</td>}
                    <td className="px-4 py-2.5 text-gray-200 font-medium">{row.total.toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-indigo-300">{row.leads.toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-green-400">{row.customers.toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-gray-200">{fmtK(row.revenue)}</td>
                    <td className="px-4 py-2.5 text-gray-300">{pct}%</td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-2 rounded-full bg-gray-700 overflow-hidden">
                          <div
                            style={{ width: `${barPct}%`, backgroundColor: bg }}
                            className="h-full rounded-full"
                          />
                        </div>
                        <span className="text-xs text-gray-500 w-6 text-right">{barPct}%</span>
                      </div>
                    </td>
                  </tr>
                )
              })}
              {tableRows.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-gray-500">
                    No records match the selected filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function KpiCard({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="card p-4">
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">{label}</p>
      <p className="text-2xl font-bold text-white mt-1 truncate">{value}</p>
      <p className="text-xs text-gray-500 mt-0.5">{sub}</p>
    </div>
  )
}

function SortTh({
  label, sortKey, onSort, sortArrow
}: {
  label: string
  sortKey: SortKey
  onSort: (k: SortKey) => void
  sortArrow: (k: SortKey) => React.ReactNode
}) {
  return (
    <th
      onClick={() => onSort(sortKey)}
      className="text-left px-4 py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wider cursor-pointer hover:text-gray-200 select-none"
    >
      {label}{sortArrow(sortKey)}
    </th>
  )
}
