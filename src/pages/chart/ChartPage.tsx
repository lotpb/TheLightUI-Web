import { useEffect, useMemo, useState } from 'react'
import { usePageTitle } from '../../hooks/usePageTitle'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, CartesianGrid,
} from 'recharts'
import { subscribeToCustomers } from '../../services/customerService'
import type { CustomerItem } from '../../models/customer'

type Category = 'Customer' | 'Lead' | 'Vendor' | 'Employee'

const CATEGORIES: Category[] = ['Customer', 'Lead', 'Vendor', 'Employee']
const COLORS = [
  { from: '#818cf8', to: '#4338ca' },
  { from: '#a78bfa', to: '#6d28d9' },
  { from: '#22d3ee', to: '#0e7490' },
  { from: '#34d399', to: '#047857' },
  { from: '#fbbf24', to: '#b45309' },
  { from: '#f87171', to: '#b91c1c' },
  { from: '#f472b6', to: '#be185d' },
  { from: '#a3e635', to: '#4d7c0f' },
]

const TOOLTIP_STYLE = {
  contentStyle: { backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: 8 },
  labelStyle: { color: '#f3f4f6' },
  itemStyle: { color: '#e5e7eb' },
  cursor: false as const,
}

function formatCurrency(n: number) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

function groupByMonth(items: CustomerItem[]) {
  const map: Record<string, number> = {}
  for (const item of items) {
    const d = new Date(item.creationDate)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    map[key] = (map[key] ?? 0) + item.amount
  }
  return Object.entries(map)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, total]) => {
      const [year, m] = month.split('-')
      const label = new Date(Number(year), Number(m) - 1)
        .toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
      return { month: label, total }
    })
}

function groupByField(items: CustomerItem[], key: keyof CustomerItem) {
  const map: Record<string, number> = {}
  for (const item of items) {
    const val = (item[key] as string) || 'None'
    map[val] = (map[val] ?? 0) + item.amount
  }
  return Object.entries(map)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10)
    .map(([name, value]) => ({ name, value }))
}

// ── Chart components ──────────────────────────────────────────────────────────

function HorizontalBarChart({ data }: { data: { name: string; value: number }[] }) {
  if (!data.length) return <p className="text-gray-500 text-sm py-4 text-center">No data</p>
  return (
    <ResponsiveContainer width="100%" height={Math.max(160, data.length * 56)}>
      <BarChart
        data={data}
        layout="vertical"
        margin={{ left: 8, right: 40, top: 4, bottom: 4 }}
        style={{ background: 'transparent' }}
      >
        <defs>
          {COLORS.map((c, i) => (
            <linearGradient key={i} id={`hg${i}`} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor={c.from} stopOpacity={1} />
              <stop offset="100%" stopColor={c.to} stopOpacity={1} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid strokeDasharray="" stroke="#6b7280" horizontal={false} />
        <XAxis
          type="number"
          tick={{ fill: '#9ca3af', fontSize: 11 }}
          tickFormatter={v => `$${(v / 1000).toFixed(0)}k`}
        />
        <YAxis type="category" dataKey="name" width={90} tick={{ fill: '#9ca3af', fontSize: 12 }} />
        <Tooltip formatter={(v: number) => formatCurrency(v)} {...TOOLTIP_STYLE} />
        <Bar dataKey="value" radius={[0, 4, 4, 0]} activeBar={false}>
          {data.map((_, i) => <Cell key={i} fill={`url(#hg${i % COLORS.length})`} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

function MonthlyBarChart({ data }: { data: { month: string; total: number }[] }) {
  if (!data.length) return <p className="text-gray-500 text-sm py-4 text-center">No data</p>
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart
        data={data}
        margin={{ left: 8, right: 8, top: 8, bottom: 4 }}
        style={{ background: 'transparent' }}
      >
        <CartesianGrid strokeDasharray="" stroke="#6b7280" vertical={false} />
        <XAxis dataKey="month" tick={{ fill: '#9ca3af', fontSize: 11 }} />
        <YAxis
          tickFormatter={v => `$${(v / 1000).toFixed(0)}k`}
          tick={{ fill: '#9ca3af', fontSize: 11 }}
          width={45}
        />
        <defs>
          <linearGradient id="monthlyGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#60a5fa" stopOpacity={1} />
            <stop offset="100%" stopColor="#2563eb" stopOpacity={1} />
          </linearGradient>
        </defs>
        <Tooltip formatter={(v: number) => formatCurrency(v)} {...TOOLTIP_STYLE} />
        <Bar dataKey="total" fill="url(#monthlyGrad)" radius={[4, 4, 0, 0]} activeBar={false} />
      </BarChart>
    </ResponsiveContainer>
  )
}

// ── Print table ───────────────────────────────────────────────────────────────

function PrintTable({ title, rows, colLabel }: {
  title: string
  rows: { name: string; value: number }[]
  colLabel: string
}) {
  if (!rows.length) return null
  return (
    <div style={{ marginTop: 20 }}>
      <p style={{ fontSize: 13, fontWeight: 600, color: '#555', marginBottom: 4 }}>{title}</p>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left', fontSize: 11, color: '#777', borderBottom: '1px solid #ccc', padding: '3px 6px' }}>{colLabel}</th>
            <th style={{ textAlign: 'right', fontSize: 11, color: '#777', borderBottom: '1px solid #ccc', padding: '3px 6px' }}>Amount</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.name}>
              <td style={{ fontSize: 13, padding: '5px 6px', borderBottom: '1px solid #f0f0f0' }}>{r.name}</td>
              <td style={{ fontSize: 13, padding: '5px 6px', borderBottom: '1px solid #f0f0f0', textAlign: 'right' }}>{formatCurrency(r.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ChartPage() {
  usePageTitle('Chart')
  const [all, setAll] = useState<CustomerItem[]>([])
  const [loading, setLoading] = useState(true)
  const [category, setCategory] = useState<Category>('Customer')

  useEffect(() => {
    const unsub = subscribeToCustomers(
      items => { setAll(items); setLoading(false) },
      () => setLoading(false),
    )
    return unsub
  }, [])

  const items = useMemo(
    () => all.filter(c => c.category.toLowerCase() === category.toLowerCase()),
    [all, category],
  )

  const totalAmount    = useMemo(() => items.reduce((s, c) => s + c.amount, 0), [items])
  const activeCount    = useMemo(() => items.filter(c => c.isActive).length, [items])
  const monthlySales   = useMemo(() => groupByMonth(items), [items])
  const jobTotals      = useMemo(() => groupByField(items, 'job'), [items])
  const productTotals  = useMemo(() => groupByField(items, 'product'), [items])
  const salesmanTotals = useMemo(() => groupByField(items, 'salesman'), [items])
  const contractorTotals = useMemo(() => groupByField(items, 'contractor'), [items])

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">

      {/* Print-only — hidden on screen, shown via @media print CSS */}
      <div id="chart-print" style={{ display: 'none', fontFamily: '-apple-system, Helvetica, sans-serif', color: '#111' }}>
        <h1 style={{ fontSize: 22, margin: '0 0 4px' }}>Charts — {category}</h1>
        <p style={{ fontSize: 12, color: '#888', marginBottom: 20 }}>
          {new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
        </p>
        <div style={{ display: 'flex', gap: 32, marginBottom: 24 }}>
          <div>
            <div style={{ fontSize: 26, fontWeight: 700 }}>{items.length}</div>
            <div style={{ fontSize: 11, color: '#888' }}>Total</div>
          </div>
          <div>
            <div style={{ fontSize: 26, fontWeight: 700, color: '#16a34a' }}>{activeCount}</div>
            <div style={{ fontSize: 11, color: '#888' }}>Active</div>
          </div>
          <div>
            <div style={{ fontSize: 26, fontWeight: 700, color: '#4338ca' }}>{formatCurrency(totalAmount)}</div>
            <div style={{ fontSize: 11, color: '#888' }}>Amount</div>
          </div>
        </div>
        {monthlySales.length > 0 && (
          <PrintTable
            title="Monthly Sales"
            rows={monthlySales.map(r => ({ name: r.month, value: r.total }))}
            colLabel="Month"
          />
        )}
        <PrintTable title="By Job"        rows={jobTotals}        colLabel="Job" />
        <PrintTable title="By Product"    rows={productTotals}    colLabel="Product" />
        <PrintTable title="By Salesman"   rows={salesmanTotals}   colLabel="Salesman" />
        <PrintTable title="By Contractor" rows={contractorTotals} colLabel="Contractor" />
      </div>

      {/* Screen UI */}
      <div id="chart-screen">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-white">Charts</h1>
          <button
            type="button"
            onClick={() => window.print()}
            className="btn-secondary text-sm px-3 py-1.5"
          >
            ⎙ Print
          </button>
        </div>

        <div className="flex gap-2 flex-nowrap overflow-x-auto pb-1 pt-2 scrollbar-none">
          {CATEGORIES.map(cat => (
            <button
              key={cat}
              onClick={() => setCategory(cat)}
              className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
                category === cat
                  ? 'bg-indigo-600 text-white'
                  : 'bg-gray-800 text-gray-400 hover:text-gray-200'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="space-y-4 animate-pulse pt-4">
            {[200, 220, 180, 160].map((h, i) => (
              <div key={i} className="card" style={{ height: h }} />
            ))}
          </div>
        ) : (
          <div className="space-y-6 pt-2">
            {/* Summary stats */}
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-xl bg-gray-500 p-4 text-center">
                <p className="text-2xl font-bold text-white">{items.length}</p>
                <p className="text-xs text-gray-200 mt-1">Total</p>
              </div>
              <div className="rounded-xl bg-gray-600 p-4 text-center">
                <p className="text-2xl font-bold text-white">{activeCount}</p>
                <p className="text-xs text-gray-200 mt-1">Active</p>
              </div>
              <div className="rounded-xl bg-gray-700 p-4 text-center">
                <p className="text-lg font-bold text-white">{formatCurrency(totalAmount)}</p>
                <p className="text-xs text-gray-300 mt-1">Amount</p>
              </div>
            </div>

            <div className="card p-4">
              <h2 className="text-sm font-semibold text-indigo-400 mb-3">Monthly Sales</h2>
              <MonthlyBarChart data={monthlySales} />
            </div>

            {jobTotals.length > 0 && (
              <div className="card p-4">
                <h2 className="text-sm font-semibold text-purple-400 mb-3">By Job</h2>
                <HorizontalBarChart data={jobTotals} />
              </div>
            )}

            {productTotals.length > 0 && (
              <div className="card p-4">
                <h2 className="text-sm font-semibold text-cyan-400 mb-3">By Product</h2>
                <HorizontalBarChart data={productTotals} />
              </div>
            )}

            {salesmanTotals.length > 0 && (
              <div className="card p-4">
                <h2 className="text-sm font-semibold text-emerald-400 mb-3">By Salesman</h2>
                <HorizontalBarChart data={salesmanTotals} />
              </div>
            )}

            {contractorTotals.length > 0 && (
              <div className="card p-4">
                <h2 className="text-sm font-semibold text-amber-400 mb-3">By Contractor</h2>
                <HorizontalBarChart data={contractorTotals} />
              </div>
            )}

            {items.length === 0 && (
              <div className="card px-4 py-10 text-center">
                <p className="text-gray-400">No {category.toLowerCase()}s found</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
