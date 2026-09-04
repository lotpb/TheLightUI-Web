import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, PieChart, Pie } from 'recharts'
import { subscribeToExpenses, deleteExpense } from '../../services/expenseService'
import { formatCurrency, type Expense, type ExpenseCategory } from '../../models/expense'
import { useAuthStore } from '../../stores/authStore'
import { useDebounce } from '../../hooks/useDebounce'
import ConfirmModal from '../../components/ConfirmModal'
import { usePageTitle } from '../../hooks/usePageTitle'
import { useSearchShortcut } from '../../hooks/useSearchShortcut'
import { esc } from '../../utils/exportUtils'
import CollapsibleSection from '../../components/CollapsibleSection'
import { Icon, ICONS } from '../../components/Icon'

const MONTHS = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
]

/**
 * One entry per category, driving the row pill, the donut slice and the legend
 * dot from the same place.
 *
 * These used to be two independent systems: CATEGORY_COLORS mapped names to
 * Tailwind tints, while DONUT_GRADIENTS assigned slice colours by *sort
 * position* (`DONUT_GRADIENTS[i % 9]`). So Travel's pill was cyan while its
 * slice was whatever index it happened to land on — and the index moved as
 * amounts reordered. The legend used the donut colour, so nothing bridged the
 * two and a slice could not be traced back to a row.
 *
 * Typed against ExpenseCategory so adding a category to the model's enum fails
 * the build until it gets a colour here. `from`/`to` are lighter/darker steps
 * of the same Tailwind hue as `pill`, so the slice reads as the same colour.
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

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

interface DayBucket {
  label: string
  total: number
  isToday: boolean
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate()
}

function sumOn(expenses: Expense[], day: Date): number {
  return expenses.reduce((s, e) => (sameDay(e.date, day) ? s + e.amount : s), 0)
}

/**
 * The seven days ending today.
 *
 * This used to start from the most recent Sunday and walk *forward* seven days
 * — the current calendar week, not the last seven days, despite the name. On a
 * Monday that rendered one populated bar and six empty future ones. A trailing
 * window is always seven days of real history.
 */
function groupTrailing7Days(expenses: Expense[]): DayBucket[] {
  const today = new Date()
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today)
    d.setDate(today.getDate() - (6 - i))
    return {
      label: DAY_LABELS[d.getDay()],
      total: sumOn(expenses, d),
      isToday: i === 6,
    }
  })
}

/** Every day of the given month, so the chart matches the month being viewed. */
function groupMonthDays(expenses: Expense[], year: number, month: number): DayBucket[] {
  const today = new Date()
  const dayCount = new Date(year, month + 1, 0).getDate()
  return Array.from({ length: dayCount }, (_, i) => {
    const d = new Date(year, month, i + 1)
    return {
      label: String(i + 1),
      total: sumOn(expenses, d),
      isToday: sameDay(d, today),
    }
  })
}

type Period = 'all' | 'month'

export default function ExpenseListPage() {
  usePageTitle('Expenses')
  const user      = useAuthStore(s => s.user)
  const companyId = useAuthStore(s => s.companyId)
  const [all, setAll]             = useState<Expense[]>([])
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const searchInputRef = useRef<HTMLInputElement>(null)
  useSearchShortcut(searchInputRef, () => setSearch(''))
  const [pendingDelete, setPendingDelete] = useState<Expense | null>(null)
  const debouncedSearch = useDebounce(search)

  const now = new Date()
  const [period, setPeriod] = useState<Period>('month')
  const [year,   setYear]   = useState(now.getFullYear())
  const [month,  setMonth]  = useState(now.getMonth())

  useEffect(() => {
    if (!user) return
    setLoading(true)
    const unsub = subscribeToExpenses(
      items => { setAll(items); setLoading(false) },
      err   => { setError(err.message); setLoading(false) },
    )
    return unsub
  }, [user, companyId])

  const filtered = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase()
    return all.filter(e => {
      if (period === 'month') {
        const d = e.date
        if (d.getFullYear() !== year || d.getMonth() !== month) return false
      }
      if (q) {
        return (
          e.title.toLowerCase().includes(q) ||
          e.category.toLowerCase().includes(q) ||
          (e.notes ?? '').toLowerCase().includes(q)
        )
      }
      return true
    })
  }, [all, period, year, month, debouncedSearch])

  const total = useMemo(() => filtered.reduce((s, e) => s + e.amount, 0), [filtered])

  const byCategory = useMemo(() => {
    const map: Record<string, number> = {}
    for (const e of filtered) {
      map[e.category] = (map[e.category] ?? 0) + e.amount
    }
    return Object.entries(map).sort((a, b) => b[1] - a[1])
  }, [filtered])

  /**
   * The chart follows the page's filters. It used to be built from `all`, so
   * with the period on "By Month → March" and a search active it still showed
   * the current week from the full dataset — a total that could never
   * reconcile with the two filtered summaries directly above it.
   *
   * The window tracks the period rather than just intersecting with it: a
   * seven-day window inside a past month would render empty every time, so
   * month mode charts that month's days instead.
   */
  const chart = useMemo(() => (
    period === 'month'
      ? { title: `${MONTHS[month]} ${year} — daily`, data: groupMonthDays(filtered, year, month) }
      : { title: 'Last 7 days', data: groupTrailing7Days(filtered) }
  ), [filtered, period, year, month])

  /**
   * Navigation bounds, derived from the data rather than hard-coded. The
   * arrows used to walk indefinitely in both directions with no reset, so it
   * was easy to end up in 2031 looking at an empty month with no way back
   * except clicking the same number of times in reverse — and no way to tell
   * an empty month from an out-of-range one.
   *
   * The current month is always reachable even with no data in it, so a fresh
   * account isn't locked out of the view it opens on.
   */
  const monthBounds = useMemo(() => {
    const asIndex = (y: number, m: number) => y * 12 + m
    const nowIdx = asIndex(now.getFullYear(), now.getMonth())
    if (all.length === 0) return { min: nowIdx, max: nowIdx }
    let min = Infinity
    let max = -Infinity
    for (const e of all) {
      const i = asIndex(e.date.getFullYear(), e.date.getMonth())
      if (i < min) min = i
      if (i > max) max = i
    }
    return { min: Math.min(min, nowIdx), max: Math.max(max, nowIdx) }
    // `now` is created fresh each render but only its month matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all])

  const monthIndex = year * 12 + month
  const canGoPrev = monthIndex > monthBounds.min
  const canGoNext = monthIndex < monthBounds.max
  const isCurrentMonth = year === now.getFullYear() && month === now.getMonth()

  function prevMonth() {
    if (!canGoPrev) return
    if (month === 0) { setMonth(11); setYear(y => y - 1) }
    else setMonth(m => m - 1)
  }
  function nextMonth() {
    if (!canGoNext) return
    if (month === 11) { setMonth(0); setYear(y => y + 1) }
    else setMonth(m => m + 1)
  }
  function goToCurrentMonth() {
    setYear(now.getFullYear())
    setMonth(now.getMonth())
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
    const periodLabel = period === 'all' ? 'All Time' : `${MONTHS[month]} ${year}`
    const reimbTotal = filtered.filter(e => e.isReimbursable).reduce((s, e) => s + e.amount, 0)

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
  <p class="sub">Printed ${dateStr} · ${filtered.length} expense${filtered.length !== 1 ? 's' : ''}</p>
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
        <td>${formatCurrency(total)}</td>
        <td colspan="4">${reimbTotal > 0 ? `Reimbursable: ${formatCurrency(reimbTotal)}` : ''}</td>
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

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
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

      {/* Month navigator — only when period === 'month' */}
      {period === 'month' && (
        <div className="flex items-center justify-between card px-2 py-2 mb-4">
          <button
            onClick={prevMonth}
            disabled={!canGoPrev}
            aria-label="Previous month"
            className="w-9 h-9 flex items-center justify-center rounded-lg text-gray-400 hover:text-white hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent transition-colors"
          >
            <Icon d={ICONS.chevronLeft} className="w-4 h-4" />
          </button>

          <div className="flex items-center gap-3 min-w-0">
            <span className="font-semibold text-white truncate">{MONTHS[month]} {year}</span>
            {/* Only offered when it would do something. */}
            {!isCurrentMonth && (
              <button
                onClick={goToCurrentMonth}
                className="text-xs font-medium text-indigo-400 hover:text-indigo-300 transition-colors shrink-0"
              >
                This month
              </button>
            )}
          </div>

          <button
            onClick={nextMonth}
            disabled={!canGoNext}
            aria-label="Next month"
            className="w-9 h-9 flex items-center justify-center rounded-lg text-gray-400 hover:text-white hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent transition-colors"
          >
            <Icon d={ICONS.chevronRight} className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Search */}
      <div className="relative mb-4">
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
        </svg>
        <input
          ref={searchInputRef}
          type="search"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by title, category, or notes…"
          className="input-field pl-9 py-2 text-sm"
        />
        {search && (
          <button
            type="button"
            onClick={() => setSearch('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-200"
            aria-label="Clear search"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* Total + breakdown */}
      {!loading && filtered.length > 0 && (
        <div className="card p-4 mb-4">
          <div className="flex items-baseline justify-between mb-3">
            <span className="text-sm text-gray-400">
              {period === 'all' ? 'Total (all time)' : `Total — ${MONTHS[month]} ${year}`}
            </span>
            <span className="text-2xl font-bold text-white tabular-nums">{formatCurrency(total)}</span>
          </div>
        </div>
      )}

      {/* Analysis, collapsed. The donut and the daily chart stacked above the
          list added roughly 600px, so on a laptop you scrolled past every
          visualisation to reach the expenses the page is named after. The total
          above stays visible — it's one line and it's the headline figure. */}
      {!loading && filtered.length > 0 && (
        <CollapsibleSection title="Breakdown" count={byCategory.length}>
          {byCategory.length > 0 && (
            <div className="card p-4">
              <div className="relative">
                <ResponsiveContainer width="100%" height={180}>
                  <PieChart>
                    <defs>
                      {byCategory.map(([cat]) => {
                        const st = catStyle(cat)
                        return (
                          <linearGradient key={cat} id={catGradientId(cat)} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={st.from} stopOpacity={1} />
                            <stop offset="100%" stopColor={st.to} stopOpacity={1} />
                          </linearGradient>
                        )
                      })}
                    </defs>
                    <Pie
                      data={byCategory.map(([name, value]) => ({ name, value }))}
                      cx="50%"
                      cy="50%"
                      innerRadius={52}
                      outerRadius={78}
                      dataKey="value"
                      paddingAngle={2}
                    >
                      {byCategory.map(([cat]) => (
                        <Cell
                          key={cat}
                          fill={`url(#${catGradientId(cat)})`}
                          stroke={catStyle(cat).to}
                          strokeWidth={0.5}
                        />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(v: number) => formatCurrency(v)}
                      contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: 8 }}
                      labelStyle={{ color: '#f3f4f6' }}
                      itemStyle={{ color: '#e5e7eb' }}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="text-center">
                    <p className="text-base font-bold text-white">{formatCurrency(total)}</p>
                    <p className="text-xs text-gray-400">Total</p>
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-x-3 gap-y-2.5 mt-1">
                {byCategory.map(([cat, amt]) => (
                  <div key={cat} className="flex items-start gap-2">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0 mt-0.5" style={{ backgroundColor: catStyle(cat).solid }} />
                    <div className="min-w-0">
                      <p className="text-xs text-gray-400 truncate">{cat}</p>
                      <p className="text-xs font-semibold text-gray-200">{formatCurrency(amt)}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Spend-over-time chart lives in the same disclosure as the donut —
              both are analysis rather than the page's primary content. */}
          <div className="card p-4">
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">{chart.title}</h2>
            <span className="text-sm font-semibold text-white tabular-nums">
              {formatCurrency(chart.data.reduce((s, d) => s + d.total, 0))}
            </span>
          </div>
          <ResponsiveContainer width="100%" height={140}>
            <BarChart data={chart.data} margin={{ left: 0, right: 4, top: 4, bottom: 0 }}>
              <defs>
                <linearGradient id="blueBarGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#93c5fd" stopOpacity={1} />
                  <stop offset="100%" stopColor="#1d4ed8" stopOpacity={1} />
                </linearGradient>
                <linearGradient id="todayBarGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#c7d2fe" stopOpacity={1} />
                  <stop offset="100%" stopColor="#4338ca" stopOpacity={1} />
                </linearGradient>
              </defs>
              {/* Month mode has up to 31 bars, so thin the labels out. */}
              <XAxis
                dataKey="label"
                tick={{ fill: '#9ca3af', fontSize: 12 }}
                interval={period === 'month' ? 4 : 0}
              />
              <YAxis tickFormatter={v => `$${v >= 1000 ? `${(v/1000).toFixed(0)}k` : v}`} tick={{ fill: '#6b7280', fontSize: 11 }} width={38} />
              <Tooltip
                formatter={(v: number) => [formatCurrency(v), 'Spent']}
                contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: 8 }}
                labelStyle={{ color: '#f3f4f6' }}
                itemStyle={{ color: '#e5e7eb' }}
                cursor={false}
              />
              <Bar dataKey="total" radius={[4, 4, 0, 0]} activeBar={false}>
                {chart.data.map((d, i) => (
                  <Cell key={i} fill={d.isToday ? 'url(#todayBarGrad)' : 'url(#blueBarGrad)'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          </div>
        </CollapsibleSection>
      )}

      {/* Reimbursable total */}
      {!loading && filtered.some(e => e.isReimbursable) && (
        <div className="flex items-center justify-between bg-green-900/20 border border-green-700/30 rounded-xl px-4 py-2.5 mt-3 mb-3 text-sm">
          <span className="text-green-400">Reimbursable</span>
          <span className="font-semibold text-green-300 tabular-nums">
            {formatCurrency(filtered.filter(e => e.isReimbursable).reduce((s, e) => s + e.amount, 0))}
          </span>
        </div>
      )}

      {error && (
        <div className="bg-red-900/30 border border-red-700/50 rounded-xl px-4 py-3 text-red-300 text-sm mb-4">
          {error}
        </div>
      )}

      {!loading && (
        <p className="text-xs text-gray-400 mb-3">
          {filtered.length} {filtered.length === 1 ? 'expense' : 'expenses'}
        </p>
      )}

      {/* List */}
      <div className="card divide-y divide-gray-700/50">
        {loading ? (
          Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} />)
        ) : filtered.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <div className="w-12 h-12 rounded-full bg-gray-700/50 flex items-center justify-center mx-auto mb-4">
              <svg className="w-6 h-6 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0 1 15.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 0 1 3 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 0 0-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 0 1-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 0 0 3 15h-.75M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm3 0h.008v.008H18V10.5Zm-12 0h.008v.008H6V10.5Z" />
              </svg>
            </div>
            {search.trim() ? (
              <>
                <p className="text-gray-300 font-medium mb-1">No results for &ldquo;{search.trim()}&rdquo;</p>
                <p className="text-sm text-gray-400 mb-4">Try a different title, category, or note.</p>
                <button onClick={() => setSearch('')} className="btn-secondary text-sm px-5 py-2">
                  Clear search
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
          filtered.map(e => (
            <ExpenseRow key={e.id} expense={e} onDelete={setPendingDelete} />
          ))
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
          button in the header — so editing had two routes (row-select-then-
          header, or the hover pencil) and the row's own click did nothing
          useful on its own. */}
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
            {e.isReimbursable && (
              <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-green-700/20 text-green-400 shrink-0">
                Reimbursable
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-400">{dateStr}</span>
            {e.notes && <span className="text-xs text-gray-400 truncate">· {e.notes}</span>}
          </div>
        </div>
        <span className="font-semibold text-white shrink-0 tabular-nums">{formatCurrency(e.amount)}</span>
      </Link>

      {/* Delete stays a sibling of the link, never nested inside it, and is
          always visible — it sat in opacity-0 group-hover:opacity-100, so on
          touch it never appeared and there was no other delete path anywhere
          on the page. The pencil that lived here is gone: the row is the edit
          affordance now. */}
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
