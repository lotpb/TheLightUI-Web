import { useEffect, useMemo, useState } from 'react'
import PartialDataBanner from '../../components/PartialDataBanner'
import { usePageTitle } from '../../hooks/usePageTitle'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  AreaChart, Area,
} from 'recharts'
import { subscribeToCustomers } from '../../services/customerService'
import type { CustomerItem } from '../../models/customer'
import { useChartTheme } from '../../hooks/useChartTheme'

type Category = 'Customer' | 'Lead' | 'Vendor' | 'Employee'

const CATEGORIES: Category[] = ['Customer', 'Lead', 'Vendor', 'Employee']

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

// ── Icons ─────────────────────────────────────────────────────────────────────

function IconUsers() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  )
}

function IconCheck() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  )
}

function IconDollar() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
      <line x1="12" y1="1" x2="12" y2="23" />
      <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </svg>
  )
}

function IconPrint() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      <polyline points="6 9 6 2 18 2 18 9" />
      <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
      <rect x="6" y="14" width="12" height="8" />
    </svg>
  )
}

// ── Chart components ──────────────────────────────────────────────────────────

/**
 * One flat colour for every bar in the chart.
 *
 * Each bar used to get its own gradient by index — ten bars, ten colours, for
 * data whose only variable is length. That advertises a dimension that isn't
 * there, and with eight gradients feeding up to ten bars the ninth and tenth
 * silently repeated the first two, implying a relationship as well. The accent
 * now identifies the chart, not the row; `accentIndex` is what makes "By Job"
 * and "By Product" tell each other apart.
 *
 * Flat rather than a gradient, too. A left-to-right ramp on a horizontal bar
 * shades the end that encodes the value, which is the one part of a bar that
 * should be reading at full strength.
 */
function HorizontalBarChart({ data, accentIndex = 0 }: { data: { name: string; value: number }[]; accentIndex?: number }) {
  const theme = useChartTheme()
  if (!data.length) return <p className="text-gray-400 text-sm py-4 text-center">No data</p>
  const accent = theme.accents[accentIndex % theme.accents.length]
  return (
    <div className="space-y-2.5">
      <ResponsiveContainer width="100%" height={Math.max(160, data.length * 52)}>
        <BarChart
          data={data}
          layout="vertical"
          margin={{ left: 8, right: 56, top: 4, bottom: 4 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke={theme.grid} horizontal={false} />
          <XAxis
            type="number"
            tick={{ fill: theme.tick, fontSize: 10 }}
            tickFormatter={v => `$${(v / 1000).toFixed(0)}k`}
            axisLine={{ stroke: theme.axisLine }}
            tickLine={false}
          />
          <YAxis
            type="category"
            dataKey="name"
            width={88}
            tick={{ fill: theme.label, fontSize: 11 }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            formatter={(v: number) => [formatCurrency(v), 'Amount']}
            {...theme.tooltip}
          />
          <Bar
            dataKey="value"
            fill={accent}
            radius={[0, 5, 5, 0]}
            activeBar={false}
            label={{ position: 'right', formatter: (v: number) => formatCurrency(v), fill: theme.label, fontSize: 10 }}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

function MonthlyAreaChart({ data }: { data: { month: string; total: number }[] }) {
  const theme = useChartTheme()
  if (!data.length) return <p className="text-gray-400 text-sm py-4 text-center">No data</p>
  // The area keeps its vertical wash — that fades away from the line rather than
  // along it, so it doesn't shade the value the way a bar gradient does.
  const accent = theme.accents[0]
  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={data} margin={{ left: 4, right: 8, top: 16, bottom: 4 }}>
        <defs>
          <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={accent} stopOpacity={0.5} />
            <stop offset="100%" stopColor={accent} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke={theme.grid} vertical={false} />
        <XAxis
          dataKey="month"
          tick={{ fill: theme.tick, fontSize: 11 }}
          axisLine={{ stroke: theme.axisLine }}
          tickLine={false}
        />
        <YAxis
          tickFormatter={v => `$${(v / 1000).toFixed(0)}k`}
          tick={{ fill: theme.tick, fontSize: 11 }}
          width={44}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip
          formatter={(v: number) => [formatCurrency(v), 'Revenue']}
          {...theme.tooltip}
        />
        <Area
          type="monotone"
          dataKey="total"
          stroke={accent}
          strokeWidth={2.5}
          fill="url(#areaGrad)"
          dot={{ fill: accent, strokeWidth: 0, r: 3 }}
          activeDot={{ r: 5, fill: accent, strokeWidth: 0 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}

// ── Stat card ─────────────────────────────────────────────────────────────────

interface StatCardProps {
  label: string
  value: string
  icon: React.ReactNode
  gradient: string
  iconBg: string
  iconColor: string
  sub?: string
}

function StatCard({ label, value, icon, gradient, iconBg, iconColor, sub }: StatCardProps) {
  return (
    <div className={`relative overflow-hidden rounded-2xl border border-gray-700/40 p-5 ${gradient}`}>
      <div className="flex items-start justify-between">
        {/* min-w-0 so a long value can't push the icon out of the card, and
            text-xl until lg. At three columns the icon shares this row, which
            leaves the value 16px of width on a 390px phone and 100px at 640 —
            a $1,234,568 needs about 144px at text-2xl and 120px at text-xl. */}
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1">{label}</p>
          <p className="text-xl lg:text-2xl font-bold text-white tabular-nums">{value}</p>
          {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
        </div>
        <div className={`flex-shrink-0 rounded-xl p-2.5 ${iconBg} ${iconColor}`}>
          {icon}
        </div>
      </div>
      {/* subtle glow */}
      <div className="pointer-events-none absolute -bottom-4 -right-4 h-20 w-20 rounded-full opacity-10 blur-2xl bg-current" />
    </div>
  )
}

// ── Chart section card ─────────────────────────────────────────────────────────

interface ChartCardProps {
  title: string
  accentClass: string
  children: React.ReactNode
}

function ChartCard({ title, accentClass, children }: ChartCardProps) {
  return (
    <div className="card overflow-hidden">
      <div className={`h-0.5 w-full ${accentClass}`} />
      <div className="p-5">
        <h2 className="text-sm font-semibold text-gray-300 mb-4 uppercase tracking-wider">{title}</h2>
        {children}
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ChartPage() {
  usePageTitle('Chart')
  const [all, setAll] = useState<CustomerItem[]>([])
  const [loading, setLoading] = useState(true)
  const [hitCap, setHitCap] = useState(false)
  const [category, setCategory] = useState<Category>('Customer')

  useEffect(() => {
    const unsub = subscribeToCustomers(
      (items, cap) => { setAll(items); setHitCap(!!cap); setLoading(false) },
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
  const leadSourceTotals = useMemo(() => groupByField(items, 'leadSource'), [items])

  const activeRate = items.length > 0 ? Math.round((activeCount / items.length) * 100) : 0

  function handlePrint() {
    const dateStr = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })

    function buildTable(title: string, colLabel: string, rows: { name: string; value: number }[]): string {
      if (!rows.length) return ''
      const trs = rows.map(r =>
        `<tr><td>${r.name}</td><td class="right">${formatCurrency(r.value)}</td></tr>`
      ).join('')
      return `<div class="section">
        <div class="section-title">${title}</div>
        <table><thead><tr><th>${colLabel}</th><th class="right">Amount</th></tr></thead><tbody>${trs}</tbody></table>
      </div>`
    }

    const monthRows = monthlySales.map(r => ({ name: r.month, value: r.total }))

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>Charts — ${category} — ${dateStr}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, Helvetica, Arial, sans-serif; font-size: 13px; color: #111; background: white; padding: 32px 40px; }
    h1 { font-size: 22px; font-weight: 700; margin-bottom: 2px; }
    .sub { font-size: 12px; color: #888; margin-bottom: 24px; }
    .stats { display: flex; gap: 32px; margin-bottom: 28px; padding-bottom: 20px; border-bottom: 1px solid #e5e7eb; }
    .stat-val { font-size: 28px; font-weight: 700; color: #111; }
    .stat-val.green { color: #16a34a; }
    .stat-val.indigo { color: #4338ca; }
    .stat-label { font-size: 11px; color: #888; margin-top: 2px; }
    .section { margin-top: 24px; }
    .section-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .07em; color: #555; margin-bottom: 6px; }
    table { width: 100%; border-collapse: collapse; }
    th { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; color: #6b7280; text-align: left; padding: 5px 8px; border-bottom: 2px solid #e5e7eb; }
    th.right { text-align: right; }
    td { padding: 7px 8px; border-bottom: 1px solid #f3f4f6; font-size: 13px; color: #222; }
    td.right { text-align: right; font-weight: 600; color: #059669; }
    tr:nth-child(even) td { background: #fafafa; }
    @media print { body { padding: 12px 20px; } @page { margin: 1cm; } }
  </style>
</head>
<body>
  <h1>Charts — ${category}</h1>
  <p class="sub">${dateStr}</p>
  <div class="stats">
    <div><div class="stat-val">${items.length}</div><div class="stat-label">Total</div></div>
    <div><div class="stat-val green">${activeCount}</div><div class="stat-label">Active</div></div>
    <div><div class="stat-val indigo">${formatCurrency(totalAmount)}</div><div class="stat-label">Amount</div></div>
  </div>
  ${buildTable('Monthly Sales', 'Month', monthRows)}
  ${buildTable('By Job', 'Job', jobTotals)}
  ${buildTable('By Product', 'Product', productTotals)}
  ${buildTable('By Salesman', 'Salesman', salesmanTotals)}
  ${buildTable('By Contractor', 'Contractor', contractorTotals)}
  ${buildTable('By Lead Source', 'Lead Source', leadSourceTotals)}
</body>
</html>`

    const w = window.open('', '_blank', 'width=900,height=750')
    if (!w) return
    w.document.write(html)
    w.document.close()
    w.focus()
    w.print()
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
      {hitCap && <PartialDataBanner totals />}
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Analytics</h1>
          <p className="text-sm text-gray-400 mt-0.5">Revenue breakdown by category</p>
        </div>
        <button
          type="button"
          onClick={handlePrint}
          disabled={loading}
          className="flex items-center gap-2 btn-secondary text-sm px-4 py-2 disabled:opacity-30"
        >
          <IconPrint />
          Print
        </button>
      </div>

      {/* Category tabs */}
      <div className="flex gap-2 flex-nowrap overflow-x-auto pb-1 scrollbar-none">
        {CATEGORIES.map(cat => (
          <button
            key={cat}
            onClick={() => setCategory(cat)}
            className={`px-5 py-2 rounded-full text-sm font-semibold transition-all whitespace-nowrap ${
              category === cat
                ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-900/40'
                : 'bg-gray-800/80 text-gray-400 hover:text-gray-200 hover:bg-gray-700 border border-gray-700/50'
            }`}
          >
            {cat}s
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-4 animate-pulse">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[1, 2, 3].map(i => <div key={i} className="card h-24 rounded-2xl" />)}
          </div>
          {[240, 200, 180].map((h, i) => (
            <div key={i} className="card rounded-2xl" style={{ height: h }} />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="card rounded-2xl px-4 py-16 text-center">
          <p className="text-3xl mb-3">📊</p>
          <p className="text-gray-300 font-medium">No {category.toLowerCase()}s found</p>
          {/* gray-400, not gray-500 — 3.04:1 on a card, and it's the line that
              tells you what to do about an empty chart. Same swap as the
              charts' own "No data". */}
          <p className="text-gray-400 text-sm mt-1">Try selecting a different category</p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Stat cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <StatCard
              label="Total"
              value={items.length.toLocaleString()}
              icon={<IconUsers />}
              gradient="bg-gradient-to-br from-gray-800 to-gray-900"
              iconBg="bg-indigo-500/20"
              iconColor="text-indigo-400"
              sub={`${category}s on record`}
            />
            <StatCard
              label="Active"
              value={activeCount.toLocaleString()}
              icon={<IconCheck />}
              gradient="bg-gradient-to-br from-gray-800 to-gray-900"
              iconBg="bg-emerald-500/20"
              iconColor="text-emerald-400"
              sub={`${activeRate}% activation rate`}
            />
            <StatCard
              label="Total Revenue"
              value={formatCurrency(totalAmount)}
              icon={<IconDollar />}
              gradient="bg-gradient-to-br from-gray-800 to-gray-900"
              iconBg="bg-amber-500/20"
              iconColor="text-amber-400"
              sub={monthlySales.length > 0 ? `across ${monthlySales.length} months` : undefined}
            />
          </div>

          {/* Monthly trend */}
          <ChartCard title="Monthly Revenue Trend" accentClass="bg-gradient-to-r from-indigo-500 to-violet-500">
            <MonthlyAreaChart data={monthlySales} />
          </ChartCard>

          {/* Breakdown charts — 2-col on wider screens */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {jobTotals.length > 0 && (
              <ChartCard title="By Job" accentClass="bg-gradient-to-r from-violet-500 to-purple-600">
                <HorizontalBarChart data={jobTotals} accentIndex={1} />
              </ChartCard>
            )}

            {productTotals.length > 0 && (
              <ChartCard title="By Product" accentClass="bg-gradient-to-r from-cyan-500 to-teal-500">
                <HorizontalBarChart data={productTotals} accentIndex={2} />
              </ChartCard>
            )}

            {salesmanTotals.length > 0 && (
              <ChartCard title="By Salesman" accentClass="bg-gradient-to-r from-emerald-500 to-green-600">
                <HorizontalBarChart data={salesmanTotals} accentIndex={3} />
              </ChartCard>
            )}

            {contractorTotals.length > 0 && (
              <ChartCard title="By Contractor" accentClass="bg-gradient-to-r from-amber-500 to-orange-500">
                <HorizontalBarChart data={contractorTotals} accentIndex={4} />
              </ChartCard>
            )}

            {leadSourceTotals.length > 0 && (
              <ChartCard title="By Lead Source" accentClass="bg-gradient-to-r from-pink-500 to-rose-600">
                <HorizontalBarChart data={leadSourceTotals} accentIndex={5} />
              </ChartCard>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
