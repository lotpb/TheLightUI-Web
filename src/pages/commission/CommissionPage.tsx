import { useEffect, useMemo, useState } from 'react'
import { usePageTitle } from '../../hooks/usePageTitle'
import { subscribeToCustomers } from '../../services/customerService'
import type { CustomerItem } from '../../models/customer'
import { formatCurrency } from '../../models/customer'
import { useAuthStore } from '../../stores/authStore'
import { usePickerStore } from '../../stores/pickerStore'

type Period = 'week' | 'month' | 'lastMonth' | 'quarter' | 'year' | 'last12' | 'all'

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
    case 'last12':
      start.setMonth(now.getMonth() - 11, 1); start.setHours(0, 0, 0, 0); break
    case 'all':
      start.setFullYear(2000); break
  }
  return { start, end }
}

function periodKey(start: Date, end: Date): string {
  return `${start.toISOString().slice(0, 10)}_${end.toISOString().slice(0, 10)}`
}

const DEFAULT_RATE = 10

interface CommissionRow {
  name: string
  customers: number
  revenue: number
  rate: number
  commission: number
  paid: boolean
}

export default function CommissionPage() {
  usePageTitle('Commission')
  const companyId = useAuthStore(s => s.companyId)
  const labels    = usePickerStore(s => s.labels)
  const smLabel   = labels.salesman ?? 'Salesman'

  const [all, setAll]         = useState<CustomerItem[]>([])
  const [loading, setLoading] = useState(true)
  const [period, setPeriod]   = useState<Period>('month')

  const [rates, setRates] = useState<Record<string, number>>({})
  const [paid,  setPaid]  = useState<Record<string, boolean>>({})

  const [editingRate, setEditingRate] = useState<string | null>(null)
  const [editValue,   setEditValue]   = useState('')

  // Load persisted rates + paid status when companyId is available
  useEffect(() => {
    if (!companyId) return
    try { setRates(JSON.parse(localStorage.getItem(`commission_rates_${companyId}`) ?? '{}')) } catch { setRates({}) }
    try { setPaid(JSON.parse(localStorage.getItem(`commission_paid_${companyId}`) ?? '{}')) } catch { setPaid({}) }
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
  const pKey = useMemo(() => periodKey(start, end), [start, end])

  const periodItems = useMemo(
    () => all.filter(c => c.creationDate >= start && c.creationDate <= end),
    [all, start, end],
  )

  const rows = useMemo<CommissionRow[]>(() => {
    const map = new Map<string, { customers: number; revenue: number }>()
    for (const c of periodItems) {
      if (c.category.toLowerCase() !== 'customer') continue
      const name = c.salesman.trim() || 'Unassigned'
      const row  = map.get(name) ?? { customers: 0, revenue: 0 }
      row.customers++
      row.revenue += c.amount
      map.set(name, row)
    }
    return [...map.entries()]
      .map(([name, { customers, revenue }]) => {
        const rate       = rates[name] ?? DEFAULT_RATE
        const commission = revenue * (rate / 100)
        const isPaid     = paid[`${name}|||${pKey}`] ?? false
        return { name, customers, revenue, rate, commission, paid: isPaid }
      })
      .sort((a, b) => b.revenue - a.revenue)
  }, [periodItems, rates, paid, pKey])

  const totals = useMemo(() => ({
    revenue:     rows.reduce((s, r) => s + r.revenue, 0),
    commission:  rows.reduce((s, r) => s + r.commission, 0),
    paidAmt:     rows.filter(r =>  r.paid).reduce((s, r) => s + r.commission, 0),
    outstanding: rows.filter(r => !r.paid).reduce((s, r) => s + r.commission, 0),
  }), [rows])

  function saveRates(next: Record<string, number>) {
    setRates(next)
    if (companyId) localStorage.setItem(`commission_rates_${companyId}`, JSON.stringify(next))
  }

  function togglePaid(name: string) {
    const key  = `${name}|||${pKey}`
    const next = { ...paid, [key]: !(paid[key] ?? false) }
    setPaid(next)
    if (companyId) localStorage.setItem(`commission_paid_${companyId}`, JSON.stringify(next))
  }

  function startEdit(name: string, rate: number) {
    setEditingRate(name)
    setEditValue(String(rate))
  }

  function commitEdit(name: string) {
    const n = parseFloat(editValue)
    if (!isNaN(n) && n >= 0 && n <= 100) saveRates({ ...rates, [name]: n })
    setEditingRate(null)
  }

  function exportCSV() {
    const header   = [smLabel, 'Customers', 'Revenue', 'Rate %', 'Commission', 'Status']
    const csvRows  = rows.map(r => [
      r.name, r.customers, r.revenue.toFixed(2),
      r.rate.toFixed(1), r.commission.toFixed(2), r.paid ? 'Paid' : 'Unpaid',
    ])
    const csv  = [header, ...csvRows].map(row => row.map(v => `"${v}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `commission-${period}-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Commission Tracker</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            Click a rate % to edit · click a row to mark paid/unpaid
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

      {/* KPI summary */}
      {!loading && rows.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <div className="card p-4">
            <p className="text-xs text-gray-500 mb-1.5">Total Commission</p>
            <p className="text-xl font-bold text-yellow-400">{formatCurrency(totals.commission)}</p>
          </div>
          <div className="card p-4">
            <p className="text-xs text-gray-500 mb-1.5">Paid</p>
            <p className="text-xl font-bold text-green-400">{formatCurrency(totals.paidAmt)}</p>
          </div>
          <div className="card p-4">
            <p className="text-xs text-gray-500 mb-1.5">Outstanding</p>
            <p className={`text-xl font-bold ${totals.outstanding > 0 ? 'text-red-400' : 'text-gray-500'}`}>
              {formatCurrency(totals.outstanding)}
            </p>
          </div>
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div className="card animate-pulse h-48" />
      ) : rows.length === 0 ? (
        <div className="card p-10 text-center">
          <p className="text-gray-400 text-sm">No customer revenue for this period.</p>
          <p className="text-gray-600 text-xs mt-1">Try selecting a wider date range.</p>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-700/50 bg-gray-800/50 flex items-center justify-between">
            <p className="text-sm font-semibold text-gray-200">{smLabel} Commission</p>
            <p className="text-xs text-gray-500">Default rate: {DEFAULT_RATE}%</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-500 uppercase tracking-wider border-b border-gray-700/40">
                  <th className="px-4 py-2 text-left font-medium">{smLabel}</th>
                  <th className="px-3 py-2 text-right font-medium">Sales</th>
                  <th className="px-3 py-2 text-right font-medium">Revenue</th>
                  <th className="px-3 py-2 text-right font-medium">Rate</th>
                  <th className="px-3 py-2 text-right font-medium">Commission</th>
                  <th className="px-3 py-2 text-center font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700/30">
                {rows.map(r => (
                  <tr
                    key={r.name}
                    onClick={() => togglePaid(r.name)}
                    className={`cursor-pointer transition-colors ${
                      r.paid
                        ? 'bg-green-900/10 hover:bg-green-900/20'
                        : 'hover:bg-gray-700/20'
                    }`}
                  >
                    <td className="px-4 py-3 text-gray-200 font-medium">{r.name}</td>
                    <td className="px-3 py-3 text-right text-gray-400 tabular-nums">{r.customers}</td>
                    <td className="px-3 py-3 text-right text-gray-300 font-medium tabular-nums">
                      {formatCurrency(r.revenue)}
                    </td>
                    <td
                      className="px-3 py-3 text-right"
                      onClick={e => { e.stopPropagation(); startEdit(r.name, r.rate) }}
                    >
                      {editingRate === r.name ? (
                        <input
                          autoFocus
                          type="number"
                          min="0"
                          max="100"
                          step="0.1"
                          value={editValue}
                          onChange={e => setEditValue(e.target.value)}
                          onBlur={() => commitEdit(r.name)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') commitEdit(r.name)
                            if (e.key === 'Escape') setEditingRate(null)
                          }}
                          className="w-16 bg-gray-700 border border-indigo-500 rounded px-1.5 py-0.5 text-right text-xs text-white focus:outline-none"
                          onClick={e => e.stopPropagation()}
                        />
                      ) : (
                        <span className="text-xs text-indigo-300 hover:text-indigo-100 cursor-text underline decoration-dotted tabular-nums">
                          {r.rate.toFixed(1)}%
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-right text-yellow-400 font-semibold tabular-nums">
                      {formatCurrency(r.commission)}
                    </td>
                    <td className="px-3 py-3 text-center">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                        r.paid
                          ? 'bg-green-900/40 text-green-400'
                          : 'bg-gray-700/60 text-gray-400'
                      }`}>
                        {r.paid ? '✓ Paid' : 'Unpaid'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-gray-700 bg-gray-800/60">
                  <td className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider" colSpan={2}>
                    Totals
                  </td>
                  <td className="px-3 py-3 text-right text-white font-bold tabular-nums">
                    {formatCurrency(totals.revenue)}
                  </td>
                  <td />
                  <td className="px-3 py-3 text-right text-yellow-400 font-bold tabular-nums">
                    {formatCurrency(totals.commission)}
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      <p className="text-xs text-gray-600 text-center pb-2">
        Rates and paid status are saved locally in this browser.
      </p>
    </div>
  )
}
