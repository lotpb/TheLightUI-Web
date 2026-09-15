import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, PieChart, Pie } from 'recharts'
import { subscribeToExpenses, deleteExpense } from '../../services/expenseService'
import { formatCurrency, type Expense, type ExpenseCategory } from '../../models/expense'
import {
  availableMonths, chartSummary, describeFilters, expenseTotals, filterExpenses,
  groupByCategory, groupMonthDays, groupTrailing7Days, sortExpenses,
  DEFAULT_EXPENSE_SORT, EXPENSE_SORTS, MONTHS,
  type ExpenseFilters, type ExpenseSortKey,
} from '../../models/expenseAnalytics'
import { useAuthStore } from '../../stores/authStore'
import { useDebounce } from '../../hooks/useDebounce'
import { useChartTheme } from '../../hooks/useChartTheme'
import { useIsLightMode } from '../../hooks/useIsLightMode'
import ConfirmModal from '../../components/ConfirmModal'
import PartialDataBanner from '../../components/PartialDataBanner'
import { usePageTitle } from '../../hooks/usePageTitle'
import { useSearchShortcut } from '../../hooks/useSearchShortcut'
import { esc } from '../../utils/exportUtils'
import CollapsibleSection from '../../components/CollapsibleSection'
import { Icon, ICONS } from '../../components/Icon'

/**
 * One entry per category, driving the row pill, the donut slice and the legend
 * dot from the same place.
 *
 * These used to be two independent systems: CATEGORY_COLORS mapped names to
 * Tailwind tints, while DONUT_GRADIENTS assigned slice colours by *sort
 * position* (`DONUT_GRADIENTS[i % 9]`). So Travel's pill was cyan while its
 * slice was whatever index it happened to land on — and the index moved as
 * amounts reordered.
 *
 * Typed against ExpenseCategory so adding a category to the model's enum fails
 * the build until it gets a colour here.
 *
 * `from` is the pale end of the slice gradient and only works on the dark
 * card: measured against white it runs 1.16:1 to 1.38:1, so in light mode the
 * top half of every slice disappeared and the legend dot with it (Food's was
 * 1.53:1). Light mode starts the gradient at `solid` instead and takes the
 * legend dot from `to`, which is 4.92:1 or better on white for all nine.
 */
const CATEGORY_STYLE: Record<ExpenseCategory, {
  pill: string
  solid: string
  from: string
  to: string
}> = {
  Food:          { pill: 'bg-yellow-500/20 text-yellow-300', solid: '#facc15', from: '#fef08a', to: '#a16207' },
  Meals:         { pill: 'bg-orange-500/20 text-orange-300', solid: '#fb923c', from: '#fed7aa', to: '#c2410c' },
  Travel:        { pill: 'bg-cyan-500/20 text-cyan-300',     solid: '#22d3ee', from: '#a5f3fc', to: '#0e7490' },
  Entertainment: { pill: 'bg-pink-500/20 text-pink-300',     solid: '#f472b6', from: '#fbcfe8', to: '#be185d' },
  Software:      { pill: 'bg-blue-500/20 text-blue-300',     solid: '#60a5fa', from: '#bfdbfe', to: '#1d4ed8' },
  // purple had no html.light-mode pill rule at all until this pass — the one
  // hue of the nine that fell through, at 1.38:1 on a white card.
  Supplies:      { pill: 'bg-purple-500/20 text-purple-300', solid: '#c084fc', from: '#e9d5ff', to: '#7e22ce' },
  Utilities:     { pill: 'bg-green-500/20 text-green-300',   solid: '#4ade80', from: '#bbf7d0', to: '#15803d' },
  Tithes:        { pill: 'bg-indigo-500/20 text-indigo-300', solid: '#818cf8', from: '#c7d2fe', to: '#4338ca' },
  Other:         { pill: 'bg-gray-500/20 text-gray-300',     solid: '#9ca3af', from: '#d1d5db', to: '#4b5563' },
}

/** Legacy or imported values that aren't in the enum fall back to Other. */
function catStyle(cat: string) {
  return CATEGORY_STYLE[cat as ExpenseCategory] ?? CATEGORY_STYLE.Other
}

function catColor(cat: string): string {
  return catStyle(cat).pill
}

/** Gradient ids are keyed by category, not by position, so a slice keeps its
 *  colour when the sort order changes. */
function catGradientId(cat: string): string {
  return `expgrad-${cat.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
}

/** Matches /customers, /invoices and /proposals. */
const PAGE_SIZE = 50

export default function ExpenseListPage() {
  usePageTitle('Expenses')
  const user      = useAuthStore(s => s.user)
  const companyId = useAuthStore(s => s.companyId)
  const chartTheme = useChartTheme()
  const isLight    = useIsLightMode()

  const [all, setAll]             = useState<Expense[]>([])
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState<string | null>(null)
  const [hitCap, setHitCap]       = useState(false)
  const [search, setSearch] = useState('')
  const searchInputRef = useRef<HTMLInputElement>(null)
  useSearchShortcut(searchInputRef, () => setSearch(''))
  const [pendingDelete, setPendingDelete] = useState<Expense | null>(null)
  const debouncedSearch = useDebounce(search)

  const now = new Date()
  const [period, setPeriod] = useState<'all' | 'month'>('month')
  const [year,   setYear]   = useState(now.getFullYear())
  const [month,  setMonth]  = useState(now.getMonth())
  const [category, setCategory] = useState<string | null>(null)
  const [reimbursableOnly, setReimbursableOnly] = useState(false)
  const [sort, setSort] = useState<ExpenseSortKey>(DEFAULT_EXPENSE_SORT)
  const [page, setPage] = useState(1)
  const [pageInput, setPageInput] = useState('1')

  useEffect(() => {
    if (!user) return
    setLoading(true)
    const unsub = subscribeToExpenses(
      // The second argument is the cap flag. It was dropped here, so at the
      // 5,000-document limit every total, the donut and the chart were
      // computed from an arbitrary subset with nothing on screen saying so.
      (items, cap) => { setAll(items); setHitCap(cap === true); setLoading(false) },
      err   => { setError(err.message); setLoading(false) },
    )
    return unsub
  }, [user, companyId])

  const filters: ExpenseFilters = useMemo(
    () => ({ period, year, month, search: debouncedSearch, category, reimbursableOnly }),
    [period, year, month, debouncedSearch, category, reimbursableOnly],
  )

  const filtered = useMemo(
    () => sortExpenses(filterExpenses(all, filters), sort),
    [all, filters, sort],
  )

  const totals = useMemo(() => expenseTotals(filtered), [filtered])

  /**
   * Category totals for the donut ignore the category filter.
   *
   * Otherwise clicking Travel leaves a single full ring labelled Travel, and
   * the chart you clicked to drill in becomes the one thing that can't take
   * you back out.
   */
  const donutData = useMemo(
    () => groupByCategory(filterExpenses(all, { ...filters, category: null })),
    [all, filters],
  )
  const donutTotal = useMemo(() => donutData.reduce((s, [, v]) => s + v, 0), [donutData])

  /**
   * The chart follows the page's filters. It used to be built from `all`, so
   * with the period on "By Month → March" and a search active it still showed
   * the current week from the full dataset.
   *
   * The window tracks the period rather than just intersecting with it: a
   * seven-day window inside a past month would render empty every time.
   */
  const chart = useMemo(() => (
    period === 'month'
      ? { title: `${MONTHS[month]} ${year} — daily`, data: groupMonthDays(filtered, year, month) }
      : { title: 'Last 7 days', data: groupTrailing7Days(filtered) }
  ), [filtered, period, year, month])
  const summary = useMemo(() => chartSummary(chart.data), [chart.data])

  /**
   * Every month from the oldest record to today, with a count each.
   *
   * The navigator moved one month per click with no picker, so reaching a
   * record four years back took up to 48 clicks, and nothing told an empty
   * month from the end of the data until the arrow greyed out.
   */
  const months = useMemo(() => availableMonths(all), [all])
  const monthIdx = months.findIndex(m => m.year === year && m.month === month)
  const canGoPrev = monthIdx >= 0 && monthIdx < months.length - 1
  const canGoNext = monthIdx > 0
  const isCurrentMonth = year === now.getFullYear() && month === now.getMonth()

  function pick(i: number) {
    const m = months[i]
    if (!m) return
    setYear(m.year)
    setMonth(m.month)
  }
  // months is newest-first, so "previous month" is the next index along.
  const prevMonth = () => canGoPrev && pick(monthIdx + 1)
  const nextMonth = () => canGoNext && pick(monthIdx - 1)
  function goToCurrentMonth() {
    setYear(now.getFullYear())
    setMonth(now.getMonth())
  }

  // Back to the first page whenever the set being paged through changes.
  useEffect(() => { setPage(1) }, [period, year, month, debouncedSearch, category, reimbursableOnly, sort])

  const pageCount  = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const current    = Math.min(page, pageCount)
  const paginated  = filtered.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE)
  const rangeStart = filtered.length === 0 ? 0 : (current - 1) * PAGE_SIZE + 1
  const rangeEnd   = Math.min(current * PAGE_SIZE, filtered.length)

  useEffect(() => { setPageInput(String(current)) }, [current])

  function goToPage(n: number) {
    const clamped = Math.min(Math.max(1, n), pageCount)
    setPage(clamped)
    setPageInput(String(clamped))
  }
  function commitPageInput() {
    const n = parseInt(pageInput, 10)
    if (Number.isFinite(n)) goToPage(n)
    else setPageInput(String(current))
  }

  /** Clicking the slice you're already filtered to clears the filter. */
  function toggleCategory(cat: string) {
    setCategory(prev => (prev === cat ? null : cat))
  }
  function clearFilters() {
    setCategory(null)
    setReimbursableOnly(false)
    setSearch('')
  }

  async function confirmDelete() {
    if (!pendingDelete) return
    const toDelete = pendingDelete
    setPendingDelete(null)
    try {
      await deleteExpense(toDelete.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed.')
    }
  }

  function handlePrint() {
    const dateStr = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    // Names every active filter, not just the period: the header used to say
    // "All Time" while the table held six of two hundred rows.
    const periodLabel = describeFilters(filters)

    const rows = filtered.map(e => {
      const d = e.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      return `
        <tr style="border-bottom:1px solid #e5e7eb;">
          <td style="padding:10px 8px;font-size:14px;font-weight:500;color:#111;vertical-align:top;">${esc(e.title) || '—'}</td>
          <td style="padding:10px 8px;font-size:13px;color:#374151;white-space:nowrap;vertical-align:top;">${formatCurrency(e.amount)}</td>
          <td style="padding:10px 8px;font-size:12px;color:#6b7280;white-space:nowrap;vertical-align:top;">${esc(e.category)}</td>
          <td style="padding:10px 8px;font-size:12px;color:#6b7280;white-space:nowrap;vertical-align:top;">${d}</td>
          <td style="padding:10px 8px;font-size:12px;color:#6b7280;vertical-align:top;">${esc(e.notes || '')}</td>
          <td style="padding:10px 8px;font-size:12px;text-align:center;vertical-align:top;">${e.isReimbursable ? '✓' : ''}</td>
        </tr>`
    }).join('')

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>Expenses — ${esc(periodLabel)}</title>
  <style>
    body { font-family: -apple-system, Helvetica, sans-serif; color: #111; margin: 32px; }
    h1 { font-size: 22px; margin: 0 0 4px; }
    p.sub { font-size: 12px; color: #888; margin: 0 0 20px; }
    table { width: 100%; border-collapse: collapse; }
    th { text-align: left; font-size: 11px; color: #888; text-transform: uppercase; letter-spacing: .05em; border-bottom: 2px solid #e5e7eb; padding: 6px 8px; }
    tfoot td { font-size: 13px; font-weight: 600; padding: 10px 8px; border-top: 2px solid #e5e7eb; }
    @media print { body { margin: 16px; } }
  </style>
  <script>window.onload = function() { window.print(); }</script>
</head>
<body>
  <h1>Expenses — ${esc(periodLabel)}</h1>
  <p class="sub">Printed ${dateStr} · ${filtered.length} expense${filtered.length !== 1 ? 's' : ''}${hitCap ? ' · partial data: the 5,000-record cap was reached, so these totals are understated' : ''}</p>
  <table>
    <thead>
      <tr>
        <th>Title</th>
        <th>Amount</th>
        <th>Category</th>
        <th>Date</th>
        <th>Notes</th>
        <th>Reimb.</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
    <tfoot>
      <tr>
        <td colspan="1">Total</td>
        <td>${formatCurrency(totals.total)}</td>
        <td colspan="4">${totals.reimbursable > 0 ? `Reimbursable: ${formatCurrency(totals.reimbursable)} (${totals.reimbursableCount})` : ''}</td>
      </tr>
    </tfoot>
  </table>
</body>
</html>`

    const w = window.open('', '_blank', 'width=900,height=650')
    if (!w) return
    w.document.write(html)
    w.document.close()
  }

  const hasFilters = category !== null || reimbursableOnly || search.trim() !== ''

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold text-white">Expenses</h1>
        <div className="flex items-center gap-2">
          <Link to="/expenses/new" className="btn-primary text-sm px-3 py-1.5 inline-flex items-center gap-1.5">
            <Icon d={ICONS.plus} className="w-4 h-4" />
            Add
          </Link>
          <button
            onClick={handlePrint}
            className="text-sm font-medium px-3 py-1.5 rounded-lg bg-gray-700 text-gray-200 hover:bg-gray-600 transition-colors"
          >
            <span className="flex items-center gap-1.5">
              <Icon d={ICONS.printer} className="w-4 h-4" />
              Print
            </span>
          </button>
        </div>
      </div>

      {/* The service computes this and the page threw it away. Every figure
          here is a total, so the banner says they're understated. */}
      {hitCap && <PartialDataBanner totals />}

      {/* Period toggle */}
      <div className="flex gap-2 mb-3">
        <button
          onClick={() => setPeriod('all')}
          className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
            period === 'all' ? 'bg-indigo-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-gray-200'
          }`}
        >
          All Time
        </button>
        <button
          onClick={() => setPeriod('month')}
          className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
            period === 'month' ? 'bg-indigo-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-gray-200'
          }`}
        >
          By Month
        </button>
      </div>

      {/* Month navigator — a picker, not just arrows. Each option carries its
          count, so an empty month is visible before you travel to it. */}
      {period === 'month' && (
        <div className="flex items-center gap-2 card px-2 py-2 mb-4">
          <button
            onClick={prevMonth}
            disabled={!canGoPrev}
            aria-label="Previous month"
            className="w-9 h-9 shrink-0 flex items-center justify-center rounded-lg text-gray-400 hover:text-white hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent transition-colors"
          >
            <Icon d={ICONS.chevronLeft} className="w-4 h-4" />
          </button>

          <label htmlFor="month-pick" className="sr-only">Month</label>
          <select
            id="month-pick"
            value={monthIdx >= 0 ? monthIdx : 0}
            onChange={e => pick(Number(e.target.value))}
            className="input-field flex-1 min-w-0 text-sm py-1.5 font-semibold cursor-pointer"
          >
            {months.map((m, i) => (
              <option key={`${m.year}-${m.month}`} value={i}>
                {MONTHS[m.month]} {m.year}{m.count === 0 ? ' — none' : ` (${m.count})`}
              </option>
            ))}
          </select>

          {!isCurrentMonth && (
            <button
              onClick={goToCurrentMonth}
              className="text-xs font-medium text-indigo-400 hover:text-indigo-300 transition-colors shrink-0 px-1"
            >
              This month
            </button>
          )}

          <button
            onClick={nextMonth}
            disabled={!canGoNext}
            aria-label="Next month"
            className="w-9 h-9 shrink-0 flex items-center justify-center rounded-lg text-gray-400 hover:text-white hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent transition-colors"
          >
            <Icon d={ICONS.chevronRight} className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Search and sort */}
      <div className="flex gap-2 mb-3">
        <div className="relative flex-1 min-w-0">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
            <Icon d={ICONS.search} className="w-4 h-4" />
          </span>
          <input
            ref={searchInputRef}
            type="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by title, category, or notes…"
            aria-label="Search expenses by title, category or notes"
            className="input-field w-full pl-9 pr-9 py-2 text-sm"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded text-gray-400 hover:text-gray-200 hover:bg-gray-700/50 transition-colors"
              aria-label="Clear search"
            >
              <Icon d={ICONS.close} className="w-4 h-4" />
            </button>
          )}
        </div>
        <select
          value={sort}
          onChange={e => setSort(e.target.value as ExpenseSortKey)}
          aria-label="Sort expenses"
          className="input-field text-sm py-2 shrink-0 w-36 sm:w-40 cursor-pointer"
        >
          {EXPENSE_SORTS.map(s => (
            <option key={s.key} value={s.key}>{s.label}</option>
          ))}
        </select>
      </div>

      {/* Active filters, with the only way back out of a donut drill-down. */}
      {hasFilters && (
        <div className="flex items-center gap-2 flex-wrap mb-3">
          {category !== null && (
            <button
              onClick={() => setCategory(null)}
              className={`inline-flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-full ${catColor(category)}`}
            >
              {category}
              <Icon d={ICONS.close} className="w-3 h-3" />
            </button>
          )}
          {reimbursableOnly && (
            <button
              onClick={() => setReimbursableOnly(false)}
              className="inline-flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-full bg-green-500/20 text-green-300"
            >
              Reimbursable only
              <Icon d={ICONS.close} className="w-3 h-3" />
            </button>
          )}
          <button onClick={clearFilters} className="text-xs text-gray-400 hover:text-gray-200 transition-colors">
            Clear all
          </button>
        </div>
      )}

      {/* Total. The inner mb-3 left 16px of padding above the row and 28px
          below it. */}
      {!loading && filtered.length > 0 && (
        <div className="card p-4 mb-4">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-sm text-gray-400 min-w-0 truncate">
              Total — {describeFilters(filters)}
            </span>
            <span className="text-2xl font-bold text-white tabular-nums shrink-0">{formatCurrency(totals.total)}</span>
          </div>
        </div>
      )}

      {/* Analysis, collapsed. The donut and the daily chart stacked above the
          list added roughly 600px, so on a laptop you scrolled past every
          visualisation to reach the expenses the page is named after. */}
      {!loading && filtered.length > 0 && (
        <CollapsibleSection title="Breakdown" count={donutData.length}>
          {donutData.length > 0 && (
            <div className="card p-4">
              <div className="relative">
                <ResponsiveContainer width="100%" height={180}>
                  <PieChart>
                    <defs>
                      {donutData.map(([cat]) => {
                        const st = catStyle(cat)
                        return (
                          <linearGradient key={cat} id={catGradientId(cat)} x1="0" y1="0" x2="0" y2="1">
                            {/* The pale `from` stop is 1.16–1.38:1 on a white
                                card, so light mode starts at `solid`. */}
                            <stop offset="0%" stopColor={isLight ? st.solid : st.from} stopOpacity={1} />
                            <stop offset="100%" stopColor={st.to} stopOpacity={1} />
                          </linearGradient>
                        )
                      })}
                    </defs>
                    <Pie
                      data={donutData.map(([name, value]) => ({ name, value }))}
                      cx="50%"
                      cy="50%"
                      innerRadius={52}
                      outerRadius={78}
                      dataKey="value"
                      paddingAngle={2}
                      onClick={(_, index) => {
                        const cat = donutData[index]?.[0]
                        if (cat) toggleCategory(cat)
                      }}
                      className="cursor-pointer"
                    >
                      {donutData.map(([cat]) => (
                        <Cell
                          key={cat}
                          fill={`url(#${catGradientId(cat)})`}
                          stroke={catStyle(cat).to}
                          // A defined edge at 4.92:1 or better on white, so a
                          // slice has a boundary even where the fill is pale.
                          strokeWidth={isLight ? 1.5 : 0.5}
                          opacity={category === null || category === cat ? 1 : 0.35}
                        />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(v: number) => formatCurrency(v)}
                      contentStyle={chartTheme.tooltip.contentStyle}
                      labelStyle={chartTheme.tooltip.labelStyle}
                      itemStyle={chartTheme.tooltip.itemStyle}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="text-center">
                    <p className="text-base font-bold text-white">{formatCurrency(donutTotal)}</p>
                    <p className="text-xs text-gray-400">{category === null ? 'Total' : 'All categories'}</p>
                  </div>
                </div>
              </div>
              {/* The legend was decoration: you could see Travel was $4,200
                  and had no way to list the Travel expenses. */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-3 gap-y-1 mt-1">
                {donutData.map(([cat, amt]) => {
                  const active = category === cat
                  return (
                    <button
                      key={cat}
                      onClick={() => toggleCategory(cat)}
                      aria-pressed={active}
                      className={`flex items-start gap-2 text-left px-2 py-1.5 rounded-lg transition-colors
                                  ${active ? 'bg-gray-700/60' : 'hover:bg-gray-700/40'}
                                  focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500`}
                    >
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0 mt-1"
                        // `solid` is 1.53:1 on white; `to` is 4.92:1 or better.
                        style={{ backgroundColor: isLight ? catStyle(cat).to : catStyle(cat).solid }}
                      />
                      <span className="min-w-0">
                        <span className="block text-xs text-gray-400 truncate">{cat}</span>
                        <span className="block text-xs font-semibold text-gray-200">{formatCurrency(amt)}</span>
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* Spend-over-time chart lives in the same disclosure as the donut —
              both are analysis rather than the page's primary content. */}
          <div className="card p-4">
            <div className="flex items-baseline justify-between gap-2 mb-3">
              <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">{chart.title}</h2>
              {/* Was the period total, which the card above and the donut's
                  centre already showed — the same figure three times in
                  400px. The average and the peak are what only the bars say. */}
              <span className="text-xs text-gray-400 tabular-nums shrink-0">
                {formatCurrency(summary.perDay)}/day
                {summary.peak && ` · peak ${formatCurrency(summary.peak.total)}`}
              </span>
            </div>
            <ResponsiveContainer width="100%" height={140}>
              <BarChart data={chart.data} margin={{ left: 0, right: 4, top: 4, bottom: 0 }}>
                {/* Month mode has up to 31 bars, so thin the labels out. */}
                <XAxis
                  dataKey="label"
                  tick={{ fill: chartTheme.label, fontSize: 12 }}
                  stroke={chartTheme.axisLine}
                  interval={period === 'month' ? 4 : 0}
                />
                <YAxis
                  tickFormatter={v => `$${v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}`}
                  tick={{ fill: chartTheme.tick, fontSize: 11 }}
                  stroke={chartTheme.axisLine}
                  width={38}
                />
                <Tooltip
                  formatter={(v: number) => [formatCurrency(v), 'Spent']}
                  contentStyle={chartTheme.tooltip.contentStyle}
                  labelStyle={chartTheme.tooltip.labelStyle}
                  itemStyle={chartTheme.tooltip.itemStyle}
                  cursor={chartTheme.tooltip.cursor}
                />
                <Bar dataKey="total" radius={[4, 4, 0, 0]} activeBar={false}>
                  {chart.data.map((d, i) => (
                    <Cell key={i} fill={d.isToday ? chartTheme.accents[1] : chartTheme.accents[0]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            {/* The bars' numbers existed nowhere else on the page — the donut's
                at least repeat in its legend. */}
            <table className="sr-only">
              <caption>{chart.title}</caption>
              <thead>
                <tr><th scope="col">Day</th><th scope="col">Spent</th></tr>
              </thead>
              <tbody>
                {chart.data.map(d => (
                  <tr key={d.date.toISOString()}>
                    <th scope="row">{d.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</th>
                    <td>{formatCurrency(d.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CollapsibleSection>
      )}

      {/* Reimbursable — a filter now, not just a figure you couldn't act on. */}
      {!loading && (totals.reimbursableCount > 0 || reimbursableOnly) && (
        <button
          onClick={() => setReimbursableOnly(v => !v)}
          aria-pressed={reimbursableOnly}
          className={`w-full flex items-center justify-between gap-3 border rounded-xl px-4 py-2.5 mt-3 mb-3 text-sm transition-colors
                      ${reimbursableOnly
                        ? 'bg-green-900/20 border-green-500/60'
                        : 'bg-green-900/20 border-green-700/30 hover:border-green-600/60'}`}
        >
          <span className="text-green-400">
            Reimbursable
            <span className="text-gray-400 ml-1.5">
              · {totals.reimbursableCount} {reimbursableOnly ? 'shown' : 'of ' + totals.count}
            </span>
          </span>
          <span className="font-semibold text-green-300 tabular-nums">
            {formatCurrency(totals.reimbursable)}
          </span>
        </button>
      )}

      {error && (
        <div className="bg-red-900/30 border border-red-700/50 rounded-xl px-4 py-3 text-red-300 text-sm mb-4">
          {error}
        </div>
      )}

      {!loading && filtered.length > 0 && (
        <div className="flex items-baseline justify-between gap-2 mb-3">
          <p className="text-xs text-gray-400">
            {filtered.length} {filtered.length === 1 ? 'expense' : 'expenses'}
          </p>
          {pageCount > 1 && (
            <p className="text-xs text-gray-400 tabular-nums">{rangeStart}–{rangeEnd} of {filtered.length}</p>
          )}
        </div>
      )}

      {/* List */}
      <div className="card divide-y divide-gray-700/50">
        {loading ? (
          Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} />)
        ) : filtered.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <div className="w-12 h-12 rounded-full bg-gray-700/50 flex items-center justify-center mx-auto mb-4">
              <Icon d={ICONS.receipt} className="w-6 h-6 text-gray-400" />
            </div>
            {hasFilters ? (
              <>
                <p className="text-gray-300 font-medium mb-1">Nothing matches these filters</p>
                <p className="text-sm text-gray-400 mb-4">{describeFilters(filters)}</p>
                <button onClick={clearFilters} className="btn-secondary text-sm px-5 py-2">
                  Clear filters
                </button>
              </>
            ) : all.length === 0 ? (
              <>
                <p className="text-gray-300 font-medium mb-1">No expenses yet</p>
                <p className="text-sm text-gray-400 mb-4">Start tracking your spending by adding your first expense.</p>
                <Link to="/expenses/new" className="btn-primary text-sm px-5 py-2 inline-flex items-center gap-1.5">
                  <Icon d={ICONS.plus} className="w-4 h-4" />
                  Add Expense
                </Link>
              </>
            ) : (
              <>
                <p className="text-gray-300 font-medium mb-1">Nothing for {MONTHS[month]} {year}</p>
                <p className="text-sm text-gray-400 mb-4">No expenses recorded in this month.</p>
                <Link to="/expenses/new" className="btn-primary text-sm px-5 py-2 inline-flex items-center gap-1.5">
                  <Icon d={ICONS.plus} className="w-4 h-4" />
                  Add Expense
                </Link>
                <div className="mt-3">
                  <button
                    onClick={() => setPeriod('all')}
                    className="text-sm text-gray-400 hover:text-gray-200 inline-flex items-center gap-1 transition-colors"
                  >
                    View all time
                    <Icon d={ICONS.arrowRight} className="w-3 h-3" />
                  </button>
                </div>
              </>
            )}
          </div>
        ) : (
          <>
            {paginated.map(e => (
              <ExpenseRow key={e.id} expense={e} onDelete={setPendingDelete} />
            ))}

            {/* First/last and a jump field: PAGE_SIZE is 50 against a
                5,000-expense cap, so this can run to a hundred pages. */}
            {pageCount > 1 && (
              <div className="flex items-center justify-between gap-2 px-4 py-3">
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => goToPage(1)}
                    disabled={current === 1}
                    aria-label="First page"
                    title="First page"
                    className="p-1.5 rounded text-gray-400 hover:text-gray-200 hover:bg-gray-700/50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors
                               focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                  >
                    <Icon d={ICONS.chevronDoubleLeft} className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => goToPage(current - 1)}
                    disabled={current === 1}
                    className="flex items-center gap-1 text-sm text-gray-400 hover:text-gray-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    <Icon d={ICONS.chevronLeft} className="w-4 h-4" />
                    Prev
                  </button>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-gray-400">
                  <label htmlFor="expense-page-jump" className="sr-only">Jump to page</label>
                  <input
                    id="expense-page-jump"
                    type="number"
                    min={1}
                    max={pageCount}
                    value={pageInput}
                    onChange={e => setPageInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') commitPageInput() }}
                    onBlur={commitPageInput}
                    className="input-field w-14 text-xs py-1 text-center tabular-nums"
                  />
                  <span className="tabular-nums whitespace-nowrap">of {pageCount}</span>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => goToPage(current + 1)}
                    disabled={current === pageCount}
                    className="flex items-center gap-1 text-sm text-gray-400 hover:text-gray-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    Next
                    <Icon d={ICONS.chevronRight} className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => goToPage(pageCount)}
                    disabled={current === pageCount}
                    aria-label="Last page"
                    title="Last page"
                    className="p-1.5 rounded text-gray-400 hover:text-gray-200 hover:bg-gray-700/50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors
                               focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                  >
                    <Icon d={ICONS.chevronDoubleRight} className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <ConfirmModal
        isOpen={!!pendingDelete}
        message={pendingDelete ? `Delete "${pendingDelete.title}"? This cannot be undone.` : ''}
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  )
}

function ExpenseRow({
  expense: e,
  onDelete,
}: {
  expense: Expense
  onDelete: (e: Expense) => void
}) {
  const dateStr = e.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

  return (
    <div className="flex items-stretch">
      {/* The row itself is the edit target, the way /todo works. It used to
          toggle a selection whose only purpose was enabling a separate Edit
          button in the header. */}
      <Link
        to={`/expenses/${e.id}/edit`}
        className="flex items-center gap-3 flex-1 min-w-0 px-4 py-3.5 text-left hover:bg-gray-700/30 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5 flex-wrap">
            <span className="font-medium text-gray-100 truncate">{e.title || '—'}</span>
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full shrink-0 ${catColor(e.category)}`}>
              {e.category}
            </span>
            {/* bg-green-700/20 text-green-400 was 3.81:1 in light mode, and
                the only tint on the page rescued by a standalone colour rule
                rather than a pill rule. The 500/20 + 300 pair is the covered
                combination: 7.25:1 dark, 7.68:1 light. */}
            {e.isReimbursable && (
              <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-green-500/20 text-green-300 shrink-0">
                Reimbursable
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-xs text-gray-400 shrink-0">{dateStr}</span>
            {e.notes && <span className="text-xs text-gray-400 truncate">· {e.notes}</span>}
          </div>
        </div>
        <span className="font-semibold text-white shrink-0 tabular-nums">{formatCurrency(e.amount)}</span>
      </Link>

      {/* Delete stays a sibling of the link, never nested inside it, and is
          always visible — it sat in opacity-0 group-hover:opacity-100, so on
          touch it never appeared and there was no other delete path anywhere
          on the page. */}
      <div className="flex items-center shrink-0 pr-2">
        <button
          type="button"
          onClick={() => onDelete(e)}
          aria-label={`Delete ${e.title || 'expense'}`}
          className="w-9 h-9 flex items-center justify-center rounded-lg text-gray-400 hover:text-red-400 hover:bg-gray-700 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
        >
          <Icon d={ICONS.trash} className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}

function SkeletonRow() {
  return (
    <div className="flex items-center gap-4 px-4 py-3.5 animate-pulse">
      <div className="flex-1 space-y-2">
        <div className="h-3.5 bg-gray-700 rounded w-40" />
        <div className="h-3 bg-gray-700/60 rounded w-24" />
      </div>
      <div className="h-4 bg-gray-700 rounded w-16" />
    </div>
  )
}
