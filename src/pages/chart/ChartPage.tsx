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
import { Icon, ICONS } from '../../components/Icon'

type Category = 'Customer' | 'Lead' | 'Vendor' | 'Employee'

const CATEGORIES: Category[] = ['Customer', 'Lead', 'Vendor', 'Employee']

function formatCurrency(n: number) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

/**
 * Axis ticks: $400, $2.5K, $45K, $1.3M.
 *
 * The ticks were `$${(v / 1000).toFixed(0)}k`, which divides by a thousand no
 * matter the range. Any value under $500 came out as "$0k", so a category whose
 * amounts are in the hundreds got an axis reading $0k, $0k, $0k — and at the
 * other end $1,250,000 read "$1250k" instead of $1.3M.
 *
 * Intl's compact notation picks the unit from the value, so both ends behave and
 * the thresholds aren't ours to maintain.
 */
const COMPACT_CURRENCY = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  notation: 'compact',
  maximumFractionDigits: 1,
})

function compactCurrency(n: number) {
  return COMPACT_CURRENCY.format(n)
}

/**
 * Width of the category axis, and how far a label can run before it truncates.
 *
 * ~6.2px per character at the 11px the ticks render at.
 */
const AXIS_CHAR_PX = 6.2
const AXIS_MIN_WIDTH = 72
const AXIS_MAX_WIDTH = 140

/**
 * Fit the axis to the names it actually has to show, up to a cap.
 *
 * It was a flat `width={88}`, so anything past about fourteen characters was
 * cut off by the axis box — "Kitchen Remodel" needs 93px, "Bathroom
 * Renovation" 118px — and job, product and contractor names are exactly the
 * data that runs long. Short names got 88px whether they needed it or not,
 * which is chart area spent on nothing.
 */
function categoryAxisWidth(names: string[]): number {
  const longest = names.reduce((n, s) => Math.max(n, s.length), 0)
  return Math.min(AXIS_MAX_WIDTH, Math.max(AXIS_MIN_WIDTH, Math.ceil(longest * AXIS_CHAR_PX) + 8))
}

/** Trims to what the axis can show. The tooltip still carries the full name. */
function truncateToWidth(s: string, px: number): string {
  const max = Math.floor(px / AXIS_CHAR_PX)
  return s.length <= max ? s : `${s.slice(0, Math.max(1, max - 1))}…`
}

/**
 * Records dated before this are treated as bad data, not history.
 *
 * The legacy 2015 import carries "0000-00-00" placeholders, which arrive as the
 * epoch or as unparseable dates. Unfiltered they put a "Dec 69" column and an
 * "Invalid Date" column on the axis — both already visible today — and once the
 * gaps below are filled they would stretch the series to 672 points.
 */
const MIN_PLAUSIBLE_YEAR = 2000

/**
 * Revenue per month across the whole span, including the months with none.
 *
 * This only emitted months that had records, so a gap closed up: revenue in
 * January, February and May rendered as three evenly spaced points and the line
 * ran Feb → May as though it were one step. A revenue trend that drops its zero
 * months doesn't just lose detail, it reports the wrong shape — a dead quarter
 * looks like no quarter at all.
 *
 * Keyed on year * 12 + month so the walk from first to last is arithmetic rather
 * than string parsing and calendar rollover.
 */
function groupByMonth(items: CustomerItem[]) {
  const byMonth = new Map<number, number>()
  for (const item of items) {
    const d = item.creationDate instanceof Date ? item.creationDate : new Date(item.creationDate)
    if (isNaN(d.getTime()) || d.getFullYear() < MIN_PLAUSIBLE_YEAR) continue
    const key = d.getFullYear() * 12 + d.getMonth()
    byMonth.set(key, (byMonth.get(key) ?? 0) + item.amount)
  }
  if (byMonth.size === 0) return []

  const keys = [...byMonth.keys()].sort((a, b) => a - b)
  const out: { month: string; total: number }[] = []
  for (let key = keys[0]; key <= keys[keys.length - 1]; key++) {
    const label = new Date(Math.floor(key / 12), key % 12)
      .toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
    out.push({ month: label, total: byMonth.get(key) ?? 0 })
  }
  return out
}

interface FieldBreakdown {
  rows: { name: string; value: number }[]
  /** Revenue on records where the field is blank: real money, but not a category. */
  unspecified: { total: number; count: number }
}

/**
 * Top ten values of a field by revenue, with the blanks held out.
 *
 * Blanks were bucketed as `'None'` and then sorted against the real values on
 * equal footing — so on a dataset where most records have no contractor, the
 * tallest bar in "By Contractor" was "None". It won a top-ten slot, took an
 * accent colour, and set the axis scale that every real category was then
 * measured against.
 *
 * Held out rather than dropped, because "$48k of revenue isn't attributed to a
 * contractor" is worth knowing — it just isn't a contractor. It reads as a note
 * under the chart instead of competing inside it.
 */
function groupByField(items: CustomerItem[], key: keyof CustomerItem): FieldBreakdown {
  const map: Record<string, number> = {}
  const unspecified = { total: 0, count: 0 }
  for (const item of items) {
    const val = ((item[key] as string) ?? '').trim()
    if (!val) {
      unspecified.total += item.amount
      unspecified.count += 1
      continue
    }
    map[val] = (map[val] ?? 0) + item.amount
  }
  const rows = Object.entries(map)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10)
    .map(([name, value]) => ({ name, value }))
  return { rows, unspecified }
}

// ── Date range ────────────────────────────────────────────────────────────────

type RangeKey = '12m' | '24m' | 'all'

const RANGES: { key: RangeKey; label: string; months: number | null }[] = [
  { key: '12m', label: '12 months', months: 12 },
  { key: '24m', label: '24 months', months: 24 },
  { key: 'all', label: 'All time',  months: null },
]

/** Start of the window, or null for all time. */
function rangeStart(months: number | null): Date | null {
  if (months == null) return null
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(1)
  d.setMonth(d.getMonth() - (months - 1))
  return d
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
function HorizontalBarChart({
  breakdown, accentIndex = 0,
}: { breakdown: FieldBreakdown; accentIndex?: number }) {
  const theme = useChartTheme()
  const { rows: data, unspecified } = breakdown
  // No rows but money on the books means every record left this field blank —
  // which is worth saying, rather than the bare "No data" that used to appear
  // when the only value was the 'None' bucket.
  if (!data.length) {
    return (
      <p className="text-gray-400 text-sm py-4 text-center">
        {unspecified.total > 0
          ? `${formatCurrency(unspecified.total)} across ${unspecified.count} record${unspecified.count === 1 ? '' : 's'}, none with this field set`
          : 'No data'}
      </p>
    )
  }
  const accent = theme.accents[accentIndex % theme.accents.length]
  const axisWidth = categoryAxisWidth(data.map(d => d.name))
  return (
    <div className="space-y-2.5">
      {/* right: 48 rather than 56 — the labels are compact now, so "$12.5M" is
          about 34px where the exact "$12,500,000" needed 62px and was clipped
          by the 56px margin. */}
      <ResponsiveContainer width="100%" height={Math.max(160, data.length * 52)}>
        <BarChart
          data={data}
          layout="vertical"
          margin={{ left: 8, right: 48, top: 4, bottom: 4 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke={theme.grid} horizontal={false} />
          <XAxis
            type="number"
            tick={{ fill: theme.tick, fontSize: 10 }}
            tickFormatter={compactCurrency}
            axisLine={{ stroke: theme.axisLine }}
            tickLine={false}
          />
          <YAxis
            type="category"
            dataKey="name"
            width={axisWidth}
            tickFormatter={(v: string) => truncateToWidth(v, axisWidth - 8)}
            tick={{ fill: theme.label, fontSize: 11 }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            formatter={(v: number) => [formatCurrency(v), 'Amount']}
            {...theme.tooltip}
          />
          {/* Two jobs split rather than duplicated.
              The bar's own label carries a compact figure, permanently, so it
              reads without hovering and survives a screenshot. The tooltip
              carries what the bar can't: the full category name — which the
              axis may have truncated — and the exact amount. Before, both
              stated the same exact figure and the tooltip earned nothing.

              activeBar outlines whatever you're pointing at. It was `false`, so
              on a ten-bar chart the tooltip appeared with nothing indicating
              which bar it belonged to. */}
          <Bar
            dataKey="value"
            fill={accent}
            radius={[0, 5, 5, 0]}
            activeBar={{ stroke: theme.label, strokeWidth: 1 }}
            label={{ position: 'right', formatter: (v: number) => compactCurrency(v), fill: theme.label, fontSize: 10 }}
          />
        </BarChart>
      </ResponsiveContainer>

      {/* Blank-field revenue, stated but not ranked. */}
      {unspecified.total > 0 && (
        <p className="text-xs text-gray-400 px-1">
          {formatCurrency(unspecified.total)} not specified
          <span className="text-gray-400"> · {unspecified.count} record{unspecified.count === 1 ? '' : 's'}</span>
        </p>
      )}
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
          tickFormatter={compactCurrency}
          tick={{ fill: theme.tick, fontSize: 11 }}
          width={48}
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
  // Category was the only control on a page of six charts, so every figure here
  // was all-time — including a "Total Revenue" headline with no period attached.
  // 12 months by default: it's the period an analytics page is usually asked
  // about, and it also bounds the monthly trend, which now carries its empty
  // months and would otherwise run to one point per month since 2015.
  const [range, setRange] = useState<RangeKey>('12m')

  useEffect(() => {
    const unsub = subscribeToCustomers(
      (items, cap) => { setAll(items); setHitCap(!!cap); setLoading(false) },
      () => setLoading(false),
    )
    return unsub
  }, [])

  const activeRange = RANGES.find(r => r.key === range)!

  const items = useMemo(() => {
    const from = rangeStart(activeRange.months)
    return all.filter(c => {
      if (c.category.toLowerCase() !== category.toLowerCase()) return false
      if (!from) return true
      const d = c.creationDate instanceof Date ? c.creationDate : new Date(c.creationDate)
      return !isNaN(d.getTime()) && d >= from
    })
  }, [all, category, activeRange.months])

  const totalAmount    = useMemo(() => items.reduce((s, c) => s + c.amount, 0), [items])
  const activeCount    = useMemo(() => items.filter(c => c.isActive).length, [items])
  const monthlySales   = useMemo(() => groupByMonth(items), [items])
  const jobTotals      = useMemo(() => groupByField(items, 'job'), [items])
  const productTotals  = useMemo(() => groupByField(items, 'product'), [items])
  const salesmanTotals = useMemo(() => groupByField(items, 'salesman'), [items])
  const contractorTotals = useMemo(() => groupByField(items, 'contractor'), [items])
  const leadSourceTotals = useMemo(() => groupByField(items, 'leadSource'), [items])

  const activeRate = items.length > 0 ? Math.round((activeCount / items.length) * 100) : 0

  // Months that actually earned something, which is what this label always
  // meant. monthlySales.length is now the span rather than the count, because
  // the series carries its empty months — so reading it here would have quietly
  // turned "across 3 months" into "across 14".
  const monthsWithRevenue = useMemo(
    () => monthlySales.filter(m => m.total > 0).length,
    [monthlySales],
  )

  function handlePrint() {
    const dateStr = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })

    function buildTable(
      title: string,
      colLabel: string,
      rows: { name: string; value: number }[],
      unspecified?: { total: number; count: number },
    ): string {
      if (!rows.length) return ''
      const trs = rows.map(r =>
        `<tr><td>${r.name}</td><td class="right">${formatCurrency(r.value)}</td></tr>`
      ).join('')
      // The blank-field total, stated the same way the on-screen chart states
      // it — as a note under the table rather than a row competing in it.
      const note = unspecified && unspecified.total > 0
        ? `<p class="note">${formatCurrency(unspecified.total)} not specified · ${unspecified.count} record${unspecified.count === 1 ? '' : 's'}</p>`
        : ''
      return `<div class="section">
        <div class="section-title">${title}</div>
        <table><thead><tr><th>${colLabel}</th><th class="right">Amount</th></tr></thead><tbody>${trs}</tbody></table>
        ${note}
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
    .note { font-size: 11px; color: #6b7280; margin-top: 5px; }
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
  <p class="sub">${activeRange.label} · printed ${dateStr}</p>
  <div class="stats">
    <div><div class="stat-val">${items.length}</div><div class="stat-label">Total</div></div>
    <div><div class="stat-val green">${activeCount}</div><div class="stat-label">Active</div></div>
    <div><div class="stat-val indigo">${formatCurrency(totalAmount)}</div><div class="stat-label">Amount</div></div>
  </div>
  ${buildTable('Monthly Sales', 'Month', monthRows)}
  ${buildTable('By Job', 'Job', jobTotals.rows, jobTotals.unspecified)}
  ${buildTable('By Product', 'Product', productTotals.rows, productTotals.unspecified)}
  ${buildTable('By Salesman', 'Salesman', salesmanTotals.rows, salesmanTotals.unspecified)}
  ${buildTable('By Contractor', 'Contractor', contractorTotals.rows, contractorTotals.unspecified)}
  ${buildTable('By Lead Source', 'Lead Source', leadSourceTotals.rows, leadSourceTotals.unspecified)}
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
          {/* The period is named here as well as in the control, because every
              figure on the page — including a headline called "Total Revenue" —
              is scoped to it, and previously nothing said so. */}
          <p className="text-sm text-gray-400 mt-0.5">
            Revenue breakdown · {activeRange.label.toLowerCase()}
          </p>
        </div>
        <button
          type="button"
          onClick={handlePrint}
          disabled={loading}
          className="flex items-center gap-2 btn-secondary text-sm px-4 py-2 disabled:opacity-30"
        >
          <Icon d={ICONS.printer} className="w-4 h-4" />
          Print
        </button>
      </div>

      {/* Category tabs + date range. Category was the only control on the page,
          so all six charts and all three headline figures were all-time with
          nothing naming the period. */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
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

        {/* Quieter than the category pills on purpose: category is what the page
            is about, the period is a qualifier on it. */}
        <div className="flex gap-1 shrink-0 rounded-lg bg-gray-800/80 border border-gray-700/50 p-1">
          {RANGES.map(r => (
            <button
              key={r.key}
              onClick={() => setRange(r.key)}
              aria-pressed={range === r.key}
              className={`px-3 py-1 rounded-md text-xs font-semibold whitespace-nowrap transition-colors ${
                range === r.key
                  ? 'bg-gray-700 text-white'
                  : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
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
          {/* A drawn icon, not 📊. Apple Color Emoji paints its own bitmap and
              ignores `color`, which is why this project has been replacing them
              — and it was the only emoji left on the page. */}
          <Icon d={ICONS.chartBar} className="w-8 h-8 mx-auto mb-3 text-gray-400" />
          <p className="text-gray-300 font-medium">No {category.toLowerCase()}s found</p>
          {/* gray-400, not gray-500 — 3.04:1 on a card, and it's the line that
              tells you what to do about an empty chart. Same swap as the
              charts' own "No data". Now names both controls, since a category
              can be empty because of the period rather than the category. */}
          <p className="text-gray-400 text-sm mt-1">
            {activeRange.months == null
              ? 'Try selecting a different category'
              : `Nothing in the last ${activeRange.months} months — try a different category or a wider period`}
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Stat cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <StatCard
              label="Total"
              value={items.length.toLocaleString()}
              icon={<Icon d={ICONS.user} className="w-5 h-5" />}
              gradient="bg-gradient-to-br from-gray-800 to-gray-900"
              iconBg="bg-indigo-500/20"
              iconColor="text-indigo-400"
              sub={activeRange.months == null ? `${category}s on record` : `added in ${activeRange.label}`}
            />
            <StatCard
              label="Active"
              value={activeCount.toLocaleString()}
              icon={<Icon d={ICONS.checkCircle} className="w-5 h-5" />}
              gradient="bg-gradient-to-br from-gray-800 to-gray-900"
              iconBg="bg-emerald-500/20"
              iconColor="text-emerald-400"
              sub={`${activeRate}% activation rate`}
            />
            <StatCard
              label="Total Revenue"
              value={formatCurrency(totalAmount)}
              icon={<Icon d={ICONS.currencyDollar} className="w-5 h-5" />}
              gradient="bg-gradient-to-br from-gray-800 to-gray-900"
              iconBg="bg-amber-500/20"
              iconColor="text-amber-400"
              sub={monthsWithRevenue > 0 ? `across ${monthsWithRevenue} month${monthsWithRevenue === 1 ? '' : 's'}` : undefined}
            />
          </div>

          {/* Monthly trend */}
          <ChartCard title="Monthly Revenue Trend" accentClass="bg-gradient-to-r from-indigo-500 to-violet-500">
            <MonthlyAreaChart data={monthlySales} />
          </ChartCard>

          {/* Breakdown charts — 2-col on wider screens */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {(jobTotals.rows.length > 0 || jobTotals.unspecified.total > 0) && (
              <ChartCard title="By Job" accentClass="bg-gradient-to-r from-violet-500 to-purple-600">
                <HorizontalBarChart breakdown={jobTotals} accentIndex={1} />
              </ChartCard>
            )}

            {(productTotals.rows.length > 0 || productTotals.unspecified.total > 0) && (
              <ChartCard title="By Product" accentClass="bg-gradient-to-r from-cyan-500 to-teal-500">
                <HorizontalBarChart breakdown={productTotals} accentIndex={2} />
              </ChartCard>
            )}

            {(salesmanTotals.rows.length > 0 || salesmanTotals.unspecified.total > 0) && (
              <ChartCard title="By Salesman" accentClass="bg-gradient-to-r from-emerald-500 to-green-600">
                <HorizontalBarChart breakdown={salesmanTotals} accentIndex={3} />
              </ChartCard>
            )}

            {(contractorTotals.rows.length > 0 || contractorTotals.unspecified.total > 0) && (
              <ChartCard title="By Contractor" accentClass="bg-gradient-to-r from-amber-500 to-orange-500">
                <HorizontalBarChart breakdown={contractorTotals} accentIndex={4} />
              </ChartCard>
            )}

            {(leadSourceTotals.rows.length > 0 || leadSourceTotals.unspecified.total > 0) && (
              <ChartCard title="By Lead Source" accentClass="bg-gradient-to-r from-pink-500 to-rose-600">
                <HorizontalBarChart breakdown={leadSourceTotals} accentIndex={5} />
              </ChartCard>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
