import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, PieChart, Pie } from 'recharts'
import { subscribeToExpenses, deleteExpense } from '../../services/expenseService'
import { formatCurrency, type Expense } from '../../models/expense'
import { useAuthStore } from '../../stores/authStore'

const MONTHS = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
]

const CATEGORY_COLORS: Record<string, string> = {
  Food:          'bg-yellow-500/20 text-yellow-300',
  Meals:         'bg-orange-500/20 text-orange-300',
  Travel:        'bg-cyan-500/20 text-cyan-300',
  Entertainment: 'bg-pink-500/20 text-pink-300',
  Software:      'bg-blue-500/20 text-blue-300',
  Supplies:      'bg-purple-500/20 text-purple-300',
  Utilities:     'bg-green-500/20 text-green-300',
  Tithes:        'bg-indigo-500/20 text-indigo-300',
  Other:         'bg-gray-500/20 text-gray-300',
}

function catColor(cat: string): string {
  return CATEGORY_COLORS[cat] ?? 'bg-gray-500/20 text-gray-300'
}

const DONUT_GRADIENTS = [
  { id: 'dg0', from: '#c7d2fe', to: '#4338ca', solid: '#818cf8' },
  { id: 'dg1', from: '#fef08a', to: '#b45309', solid: '#fbbf24' },
  { id: 'dg2', from: '#a5f3fc', to: '#0e7490', solid: '#22d3ee' },
  { id: 'dg3', from: '#fbcfe8', to: '#be185d', solid: '#f472b6' },
  { id: 'dg4', from: '#a7f3d0', to: '#047857', solid: '#34d399' },
  { id: 'dg5', from: '#fed7aa', to: '#c2410c', solid: '#fb923c' },
  { id: 'dg6', from: '#ddd6fe', to: '#6d28d9', solid: '#a78bfa' },
  { id: 'dg7', from: '#ecfccb', to: '#4d7c0f', solid: '#a3e635' },
  { id: 'dg8', from: '#fee2e2', to: '#b91c1c', solid: '#f87171' },
]

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function groupLast7Days(expenses: Expense[]) {
  const today = new Date()
  today.setHours(23, 59, 59, 999)
  // Start from the most recent Sunday
  const sunday = new Date(today)
  sunday.setDate(today.getDate() - today.getDay())
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(sunday)
    d.setDate(sunday.getDate() + i)
    return d
  })
  return days.map(d => {
    const total = expenses
      .filter(e =>
        e.date.getFullYear() === d.getFullYear() &&
        e.date.getMonth()    === d.getMonth()    &&
        e.date.getDate()     === d.getDate()
      )
      .reduce((s, e) => s + e.amount, 0)
    const isToday =
      d.getFullYear() === today.getFullYear() &&
      d.getMonth()    === today.getMonth()    &&
      d.getDate()     === today.getDate()
    return { day: DAY_LABELS[d.getDay()], total, isToday }
  })
}

type Period = 'all' | 'month'

export default function ExpenseListPage() {
  const navigate  = useNavigate()
  const user      = useAuthStore(s => s.user)
  const companyId = useAuthStore(s => s.companyId)
  const [all, setAll]             = useState<Expense[]>([])
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)

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
    return all.filter(e => {
      if (period === 'month') {
        const d = e.date
        if (d.getFullYear() !== year || d.getMonth() !== month) return false
      }
      return true
    })
  }, [all, period, year, month])

  const total = useMemo(() => filtered.reduce((s, e) => s + e.amount, 0), [filtered])

  const byCategory = useMemo(() => {
    const map: Record<string, number> = {}
    for (const e of filtered) {
      map[e.category] = (map[e.category] ?? 0) + e.amount
    }
    return Object.entries(map).sort((a, b) => b[1] - a[1])
  }, [filtered])

  const last7Days = useMemo(() => groupLast7Days(all), [all])

  function prevMonth() {
    if (month === 0) { setMonth(11); setYear(y => y - 1) }
    else setMonth(m => m - 1)
  }
  function nextMonth() {
    if (month === 11) { setMonth(0); setYear(y => y + 1) }
    else setMonth(m => m + 1)
  }

  async function handleDelete(e: Expense) {
    if (!window.confirm(`Delete "${e.title}"?`)) return
    try {
      await deleteExpense(e.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed.')
    }
  }

  function handleEditSelected() {
    if (selectedId) navigate(`/expenses/${selectedId}/edit`)
  }

  function handlePrint() {
    const dateStr = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    const periodLabel = period === 'all' ? 'All Time' : `${MONTHS[month]} ${year}`
    const reimbTotal = filtered.filter(e => e.isReimbursable).reduce((s, e) => s + e.amount, 0)

    const rows = filtered.map(e => {
      const d = e.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      return `
        <tr style="border-bottom:1px solid #e5e7eb;">
          <td style="padding:10px 8px;font-size:14px;font-weight:500;color:#111;vertical-align:top;">${e.title || '—'}</td>
          <td style="padding:10px 8px;font-size:13px;color:#374151;white-space:nowrap;vertical-align:top;">${formatCurrency(e.amount)}</td>
          <td style="padding:10px 8px;font-size:12px;color:#6b7280;white-space:nowrap;vertical-align:top;">${e.category}</td>
          <td style="padding:10px 8px;font-size:12px;color:#6b7280;white-space:nowrap;vertical-align:top;">${d}</td>
          <td style="padding:10px 8px;font-size:12px;color:#6b7280;vertical-align:top;">${e.notes || ''}</td>
          <td style="padding:10px 8px;font-size:12px;text-align:center;vertical-align:top;">${e.isReimbursable ? '✓' : ''}</td>
        </tr>`
    }).join('')

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>Expenses — ${periodLabel}</title>
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
  <h1>Expenses — ${periodLabel}</h1>
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
          <button
            onClick={handleEditSelected}
            disabled={!selectedId}
            className="text-sm font-medium px-3 py-1.5 rounded-lg bg-gray-700 text-gray-200 transition-opacity disabled:opacity-30 disabled:cursor-not-allowed hover:bg-gray-600"
          >
            Edit
          </button>
          <Link to="/expenses/new" className="btn-primary text-sm px-3 py-1.5">+ Add</Link>
          <button
            onClick={handlePrint}
            className="text-sm font-medium px-3 py-1.5 rounded-lg bg-gray-700 text-gray-200 hover:bg-gray-600 transition-colors"
          >
            🖨 Print
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
        <div className="flex items-center justify-between card px-4 py-3 mb-4">
          <button onClick={prevMonth} className="text-gray-400 hover:text-white text-lg px-2">‹</button>
          <span className="font-semibold text-white">{MONTHS[month]} {year}</span>
          <button onClick={nextMonth} className="text-gray-400 hover:text-white text-lg px-2">›</button>
        </div>
      )}

      {/* Total + breakdown */}
      {!loading && filtered.length > 0 && (
        <div className="card p-4 mb-4">
          <div className="flex items-baseline justify-between mb-3">
            <span className="text-sm text-gray-400">
              {period === 'all' ? 'Total (all time)' : `Total — ${MONTHS[month]} ${year}`}
            </span>
            <span className="text-2xl font-bold text-white">{formatCurrency(total)}</span>
          </div>
          {byCategory.length > 0 && (
            <div className="mt-3">
              <div className="relative">
                <ResponsiveContainer width="100%" height={180}>
                  <PieChart>
                    <defs>
                      {DONUT_GRADIENTS.map(g => (
                        <linearGradient key={g.id} id={g.id} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={g.from} stopOpacity={1} />
                          <stop offset="100%" stopColor={g.to} stopOpacity={1} />
                        </linearGradient>
                      ))}
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
                      {byCategory.map(([cat], i) => {
                        const g = DONUT_GRADIENTS[i % DONUT_GRADIENTS.length]
                        return <Cell key={cat} fill={`url(#${g.id})`} stroke={g.to} strokeWidth={0.5} />
                      })}
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
                {byCategory.map(([cat, amt], i) => (
                  <div key={cat} className="flex items-start gap-2">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0 mt-0.5" style={{ backgroundColor: DONUT_GRADIENTS[i % DONUT_GRADIENTS.length].solid }} />
                    <div className="min-w-0">
                      <p className="text-xs text-gray-400 truncate">{cat}</p>
                      <p className="text-xs font-semibold text-gray-200">{formatCurrency(amt)}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Reimbursable total */}
      {!loading && filtered.some(e => e.isReimbursable) && (
        <div className="flex items-center justify-between bg-green-900/20 border border-green-700/30 rounded-xl px-4 py-2.5 mb-3 text-sm">
          <span className="text-green-400">Reimbursable</span>
          <span className="font-semibold text-green-300">
            {formatCurrency(filtered.filter(e => e.isReimbursable).reduce((s, e) => s + e.amount, 0))}
          </span>
        </div>
      )}

      {error && (
        <div className="bg-red-900/30 border border-red-700/50 rounded-xl px-4 py-3 text-red-300 text-sm mb-4">
          {error}
        </div>
      )}

      {/* Last 7 days chart */}
      {!loading && (
        <div className="card p-4 mb-4">
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Last 7 Days</h2>
          <ResponsiveContainer width="100%" height={140}>
            <BarChart data={last7Days} margin={{ left: 0, right: 4, top: 4, bottom: 0 }}>
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
              <XAxis dataKey="day" tick={{ fill: '#6b7280', fontSize: 12 }} />
              <YAxis tickFormatter={v => `$${v >= 1000 ? `${(v/1000).toFixed(0)}k` : v}`} tick={{ fill: '#6b7280', fontSize: 11 }} width={38} />
              <Tooltip
                formatter={(v: number) => [formatCurrency(v), 'Spent']}
                contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: 8 }}
                labelStyle={{ color: '#f3f4f6' }}
                itemStyle={{ color: '#e5e7eb' }}
                cursor={false}
              />
              <Bar dataKey="total" radius={[4, 4, 0, 0]} activeBar={false}>
                {last7Days.map((d, i) => (
                  <Cell key={i} fill={d.isToday ? 'url(#todayBarGrad)' : 'url(#blueBarGrad)'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {!loading && (
        <p className="text-xs text-gray-500 mb-3">
          {filtered.length} {filtered.length === 1 ? 'expense' : 'expenses'}
        </p>
      )}

      {/* List */}
      <div className="card divide-y divide-gray-700/50">
        {loading ? (
          Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} />)
        ) : filtered.length === 0 ? (
          <div className="px-4 py-10 text-center">
            <p className="text-gray-400">
              {period === 'month' ? `No expenses for ${MONTHS[month]} ${year}` : 'No expenses yet'}
            </p>
            <Link to="/expenses/new" className="inline-block mt-3 text-sm text-indigo-400 hover:text-indigo-300">
              Add one →
            </Link>
          </div>
        ) : (
          filtered.map(e => (
            <ExpenseRow
              key={e.id}
              expense={e}
              onDelete={handleDelete}
              isSelected={e.id === selectedId}
              onSelect={() => setSelectedId(e.id === selectedId ? null : e.id)}
            />
          ))
        )}
      </div>
    </div>
  )
}

function ExpenseRow({
  expense: e,
  onDelete,
  isSelected,
  onSelect,
}: {
  expense: Expense
  onDelete: (e: Expense) => void
  isSelected: boolean
  onSelect: () => void
}) {
  const dateStr = e.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

  return (
    <div
      onClick={onSelect}
      className={`flex items-center gap-3 px-4 py-3.5 group cursor-pointer transition-colors ${isSelected ? 'bg-indigo-950/60' : ''}`}
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
          <span className="text-xs text-gray-500">{dateStr}</span>
          {e.notes && <span className="text-xs text-gray-500 truncate">· {e.notes}</span>}
        </div>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <span className="font-semibold text-white">{formatCurrency(e.amount)}</span>
        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <Link
            to={`/expenses/${e.id}/edit`}
            className="text-gray-500 hover:text-gray-300 text-sm px-1.5 py-1 rounded"
          >
            ✎
          </Link>
          <button
            onClick={() => onDelete(e)}
            className="text-gray-500 hover:text-red-400 text-sm px-1.5 py-1 rounded"
          >
            ✕
          </button>
        </div>
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
