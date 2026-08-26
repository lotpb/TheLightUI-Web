import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { usePageTitle } from '../../hooks/usePageTitle'
import { subscribeToCustomers } from '../../services/customerService'
import { subscribeToInvoices } from '../../services/invoiceService'
import { subscribeToServicePlans } from '../../services/servicePlanService'
import { categoryMatches, fullName, type CustomerItem } from '../../models/customer'
import type { Invoice } from '../../models/invoice'
import type { ServicePlan } from '../../models/servicePlan'
import { calculateHealthScore, type HealthLabel } from '../../utils/customerHealth'

type Filter = 'all' | HealthLabel

const LABEL_ORDER: HealthLabel[] = ['At Risk', 'Fair', 'Good', 'Excellent']

function fmtDate(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function CustomerHealthPage() {
  usePageTitle('Customer Health')

  const [customers, setCustomers] = useState<CustomerItem[]>([])
  const [invoices, setInvoices]   = useState<Invoice[]>([])
  const [plans, setPlans]         = useState<ServicePlan[]>([])
  const [loading, setLoading]     = useState(true)
  const [filter, setFilter]       = useState<Filter>('all')
  const [salesmanFilter, setSalesmanFilter] = useState('')

  useEffect(() => subscribeToCustomers(items => { setCustomers(items); setLoading(false) }, () => setLoading(false)), [])
  useEffect(() => subscribeToInvoices(setInvoices, () => {}), [])
  useEffect(() => subscribeToServicePlans(setPlans, () => {}), [])

  const scored = useMemo(() => {
    return customers
      .filter(c => categoryMatches(c.category, 'Customer') && c.isActive)
      .map(c => ({ customer: c, health: calculateHealthScore(c, invoices, plans) }))
      .sort((a, b) => a.health.score - b.health.score)
  }, [customers, invoices, plans])

  const salesmen = useMemo(() => {
    const set = new Set<string>()
    scored.forEach(s => { if (s.customer.salesman) set.add(s.customer.salesman) })
    return [...set].sort()
  }, [scored])

  const counts = useMemo(() => {
    const c: Record<HealthLabel, number> = { 'Excellent': 0, 'Good': 0, 'Fair': 0, 'At Risk': 0 }
    scored.forEach(s => { c[s.health.label]++ })
    return c
  }, [scored])

  const avgScore = useMemo(() => {
    if (scored.length === 0) return 0
    return Math.round(scored.reduce((sum, s) => sum + s.health.score, 0) / scored.length)
  }, [scored])

  const filtered = useMemo(() => {
    return scored.filter(s => {
      if (filter !== 'all' && s.health.label !== filter) return false
      if (salesmanFilter && s.customer.salesman !== salesmanFilter) return false
      return true
    })
  }, [scored, filter, salesmanFilter])

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">

      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Customer Health</h1>
        <p className="text-sm text-gray-500 mt-0.5">Account health across your active customer book, worst first</p>
      </div>

      {loading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : (
        <>
          {/* Summary tiles */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-5">
            <button
              onClick={() => setFilter('all')}
              className={`card px-3 py-3 text-left transition-colors ${filter === 'all' ? 'ring-1 ring-indigo-500/50' : 'hover:bg-gray-700/40'}`}
            >
              <p className="text-2xl font-bold text-white">{avgScore}</p>
              <p className="text-xs text-gray-400 mt-0.5">Avg Score</p>
            </button>
            {LABEL_ORDER.map(label => {
              const colorMap: Record<HealthLabel, string> = {
                'Excellent': 'text-emerald-400',
                'Good': 'text-cyan-400',
                'Fair': 'text-amber-400',
                'At Risk': 'text-red-400',
              }
              return (
                <button
                  key={label}
                  onClick={() => setFilter(label)}
                  className={`card px-3 py-3 text-left transition-colors ${filter === label ? 'ring-1 ring-indigo-500/50' : 'hover:bg-gray-700/40'}`}
                >
                  <p className={`text-2xl font-bold ${colorMap[label]}`}>{counts[label]}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{label}</p>
                </button>
              )
            })}
          </div>

          {/* Salesman filter */}
          {salesmen.length > 0 && (
            <div className="mb-4">
              <select
                value={salesmanFilter}
                onChange={e => setSalesmanFilter(e.target.value)}
                className="input-field text-sm py-1.5"
              >
                <option value="">All Sales Reps</option>
                {salesmen.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          )}

          {/* List */}
          {filtered.length === 0 ? (
            <div className="card p-8 text-center">
              <p className="text-gray-400">No customers match this filter.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {filtered.map(({ customer, health }) => (
                <Link
                  key={customer.id}
                  to={`/records/${customer.id}`}
                  className="card px-4 py-3 flex items-center gap-3 hover:bg-gray-700/40 transition-colors"
                >
                  <div className={`w-2 h-10 rounded-full shrink-0 ${health.barClass}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-medium text-gray-100 truncate">{fullName(customer)}</p>
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${health.badgeClass}`}>{health.label}</span>
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {customer.salesman && `${customer.salesman} · `}
                      Last updated {fmtDate(customer.lastUpdateDate)}
                    </p>
                  </div>
                  <p className="text-xl font-bold text-white shrink-0">{health.score}</p>
                </Link>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
