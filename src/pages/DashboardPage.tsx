import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { usePageTitle } from '../hooks/usePageTitle'
import { fetchSnapshot, type SnapshotData } from '../services/snapshotService'
import { formatCurrency, fullName } from '../models/customer'
import { avatarColor, AVATAR_ORIGINAL } from '../utils/avatarColor'
import { usePrefStore } from '../stores/prefStore'
import StatCard from '../components/StatCard'
import SnapshotChart from '../components/SnapshotChart'
import { esc } from '../utils/exportUtils'
import { subscribeToTodos } from '../services/todoService'
import { subscribeToExpenses } from '../services/expenseService'
import { subscribeToFollowUps } from '../services/customerService'
import { useAuthStore } from '../stores/authStore'
import type { Todo } from '../models/todo'
import type { Expense } from '../models/expense'
import type { CustomerItem } from '../models/customer'

const CHART_ENTRIES = (data: SnapshotData) => [
  { label: 'Leads',    count: data.leadsToday.length,         color: '#6366f1' },
  { label: 'Appts',   count: data.appointmentsToday.length,  color: '#f97316' },
  { label: 'Customer',count: data.customersToday.length,     color: '#818cf8' },
  { label: 'Jobs',    count: data.jobsStartingToday.length,  color: '#14b8a6' },
]

function todayLabel() {
  return new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
}

export default function DashboardPage() {
  usePageTitle('Dashboard')
  const [data, setData] = useState<SnapshotData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [today, setToday] = useState(todayLabel)
  const [todos, setTodos] = useState<Todo[]>([])
  const [todosLoading, setTodosLoading] = useState(true)
  const [expensesToday, setExpensesToday] = useState<Expense[]>([])
  const [expensesLoading, setExpensesLoading] = useState(true)
  const [followUps, setFollowUps] = useState<CustomerItem[]>([])
  const user = useAuthStore(s => s.user)
  const companyId = useAuthStore(s => s.companyId)

  async function load() {
    setLoading(true)
    setError(null)
    setToday(todayLabel())
    try {
      setData(await fetchSnapshot())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  useEffect(() => {
    if (!user) { setTodosLoading(false); return }
    const unsub = subscribeToTodos(
      items => { setTodos(items.filter(t => !t.isCompleted)); setTodosLoading(false) },
      ()    => setTodosLoading(false),
    )
    return unsub
  }, [user, companyId])

  useEffect(() => {
    if (!user) { setExpensesLoading(false); return }
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0)
    const todayEnd   = new Date(); todayEnd.setHours(23, 59, 59, 999)
    const unsub = subscribeToExpenses(
      items => {
        setExpensesToday(items.filter(e => e.date >= todayStart && e.date <= todayEnd))
        setExpensesLoading(false)
      },
      () => setExpensesLoading(false),
    )
    return unsub
  }, [user, companyId])

  useEffect(() => {
    if (!user) return
    const unsub = subscribeToFollowUps(setFollowUps, () => {})
    return unsub
  }, [user, companyId])

  const salesTotal = data?.salesToday.reduce((s, c) => s + c.amount, 0) ?? 0
  const chartEntries = data ? CHART_ENTRIES(data) : null

  function handlePrint() {
    if (!data) return
    const snap = data
    const dateStr = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })

    const fmtDate = (d: Date) =>
      d && d.getTime() > 0
        ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
        : '—'

    function buildTable(headers: string[], rows: string[][]): string {
      const ths = headers.map(h => `<th>${h}</th>`).join('')
      const trs = rows.map(cells =>
        `<tr>${cells.map((c, i) => {
          const isAmt = headers[i] === 'Amount'
          return `<td${isAmt ? ' class="amt"' : ''}>${esc(c) || '—'}</td>`
        }).join('')}</tr>`
      ).join('')
      return `<table><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table>`
    }

    function section(title: string, badge: string, tableHtml: string): string {
      return `<div class="section">
        <div class="section-head"><span class="section-title">${title}</span><span class="badge">${badge}</span></div>
        ${tableHtml}
      </div>`
    }

    const todayTable = buildTable(
      ['', 'Leads', 'Appts', 'Customers', 'Sales', 'Jobs'],
      [['Today',
        String(snap.leadsToday.length),
        String(snap.appointmentsToday.length),
        String(snap.customersToday.length),
        formatCurrency(salesTotal),
        String(snap.jobsStartingToday.length),
      ]]
    )

    const overallTable = buildTable(
      ['', 'Active Leads', 'Active Customers', 'Total Sales'],
      [['Overall',
        String(snap.activeLeadCount),
        String(snap.activeCustomerCount),
        formatCurrency(snap.totalCustomerSales),
      ]]
    )

    const leadsSect = snap.leadsToday.length ? section(
      'Leads Today', String(snap.leadsToday.length),
      buildTable(
        ['Name', 'Phone', 'Location', 'Email', 'Salesman', 'Callback', 'Ad #'],
        snap.leadsToday.map(c => [
          fullName(c), c.phone, [c.city, c.state].filter(Boolean).join(', '),
          c.email, c.salesman, c.callback, c.adNo,
        ]),
      )
    ) : ''

    const apptsSect = snap.appointmentsToday.length ? section(
      'Appointments Today', String(snap.appointmentsToday.length),
      buildTable(
        ['Name', 'Phone', 'Location', 'Salesman', 'Appt Date', 'Callback'],
        snap.appointmentsToday.map(c => [
          fullName(c), c.phone, [c.city, c.state].filter(Boolean).join(', '),
          c.salesman, fmtDate(c.startDate), c.callback,
        ]),
      )
    ) : ''

    const customersSect = snap.customersToday.length ? section(
      'Customers Today', String(snap.customersToday.length),
      buildTable(
        ['Name', 'Phone', 'Location', 'Email', 'Salesman', 'Amount'],
        snap.customersToday.map(c => [
          fullName(c), c.phone, [c.city, c.state].filter(Boolean).join(', '),
          c.email, c.salesman, c.amount > 0 ? formatCurrency(c.amount) : '',
        ]),
      )
    ) : ''

    const salesTotal2 = snap.salesToday.reduce((s, c) => s + c.amount, 0)
    const salesSect = snap.salesToday.length ? section(
      'Sales Today', formatCurrency(salesTotal2),
      buildTable(
        ['Name', 'Phone', 'Salesman', 'Job', 'Product', 'Contractor', 'Amount'],
        snap.salesToday.map(c => [
          fullName(c), c.phone, c.salesman, c.job, c.product, c.contractor,
          c.amount > 0 ? formatCurrency(c.amount) : '',
        ]),
      )
    ) : ''

    const jobsSect = snap.jobsStartingToday.length ? section(
      'Jobs in Progress', String(snap.jobsStartingToday.length),
      buildTable(
        ['Name', 'Phone', 'Location', 'Salesman', 'Contractor', 'Job', 'Product', 'Start', 'Completion'],
        snap.jobsStartingToday.map(c => [
          fullName(c), c.phone, [c.city, c.state].filter(Boolean).join(', '),
          c.salesman, c.contractor, c.job, c.product,
          fmtDate(c.startDate), fmtDate(c.completionDate),
        ]),
      )
    ) : ''

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>Snapshot — ${dateStr}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, Helvetica, Arial, sans-serif; font-size: 12px; color: #111; padding: 28px 32px; }
    h1 { font-size: 20px; font-weight: 700; margin-bottom: 2px; }
    .sub { font-size: 11px; color: #888; margin-bottom: 20px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 4px; }
    th { background: #f3f4f6; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; color: #555; text-align: left; padding: 6px 8px; border: 1px solid #e5e7eb; }
    td { padding: 7px 8px; border: 1px solid #e5e7eb; font-size: 12px; color: #222; vertical-align: top; }
    td.amt { text-align: right; font-weight: 600; color: #059669; }
    tr:nth-child(even) td { background: #fafafa; }
    .section { margin-top: 22px; }
    .section-head { display: flex; align-items: baseline; gap: 8px; margin-bottom: 6px; }
    .section-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .07em; color: #555; }
    .badge { font-size: 12px; font-weight: 700; color: #111; }
    .summary-section { margin-bottom: 4px; }
    .summary-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .07em; color: #888; margin-bottom: 4px; }
    @media print { body { padding: 12px 16px; } @page { margin: 1cm; size: landscape; } }
  </style>
</head>
<body>
  <h1>Daily Snapshot</h1>
  <p class="sub">${dateStr}</p>

  <div class="summary-section">
    <div class="summary-label">Today</div>
    ${todayTable}
  </div>

  <div class="summary-section" style="margin-top:14px;">
    <div class="summary-label">Overall</div>
    ${overallTable}
  </div>

  ${leadsSect}
  ${apptsSect}
  ${customersSect}
  ${salesSect}
  ${jobsSect}
</body>
</html>`

    const w = window.open('', '_blank', 'width=1050,height=750')
    if (!w) return
    w.document.write(html)
    w.document.close()
    w.focus()
    w.print()
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Snapshot</h1>
          <p className="text-sm text-gray-400 mt-0.5">{today}</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={load}
            disabled={loading}
            className="btn-secondary text-sm px-3 py-1.5"
          >
            {loading ? '…' : '↻ Refresh'}
          </button>
          <button
            onClick={handlePrint}
            disabled={loading || !data}
            className="text-sm font-medium px-3 py-1.5 rounded-lg bg-gray-700 text-gray-200 hover:bg-gray-600 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            🖨 Print
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-900/30 border border-red-700/50 rounded-xl px-4 py-3 text-red-300 text-sm">
          {error}
        </div>
      )}

      {/* Today stat strip */}
      <section>
        <p className="section-header">Today</p>
        {/* Mobile: two rows of 3; sm+: single row of 6 */}
        <div className="sm:hidden space-y-2">
          <div className="grid grid-cols-3 gap-2">
            <StatCard title="Leads"    value={String(data?.leadsToday.length ?? 0)}        color="text-indigo-400" loading={loading} />
            <StatCard title="Appts"    value={String(data?.appointmentsToday.length ?? 0)} color="text-orange-400" loading={loading} />
            <StatCard title="Customer" value={String(data?.customersToday.length ?? 0)}    color="text-indigo-300" loading={loading} />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <StatCard title="Jobs"     value={String(data?.jobsStartingToday.length ?? 0)} color="text-teal-400"   loading={loading} />
            <StatCard title="Expense"  value={formatCurrency(expensesToday.reduce((s, e) => s + e.amount, 0))} color="text-amber-400" loading={expensesLoading} to="/expenses" />
            <StatCard title="Sales"    value={formatCurrency(salesTotal)}                  color="text-green-400"  loading={loading} />
          </div>
        </div>
        <div className="hidden sm:grid gap-2" style={{ gridTemplateColumns: 'repeat(5, 1fr) 1.4fr' }}>
          <StatCard title="Leads"    value={String(data?.leadsToday.length ?? 0)}         color="text-indigo-400" loading={loading} />
          <StatCard title="Appts"    value={String(data?.appointmentsToday.length ?? 0)}  color="text-orange-400" loading={loading} />
          <StatCard title="Customer" value={String(data?.customersToday.length ?? 0)}     color="text-indigo-300" loading={loading} />
          <StatCard title="Jobs"     value={String(data?.jobsStartingToday.length ?? 0)}  color="text-teal-400"   loading={loading} />
          <StatCard title="Expense"  value={formatCurrency(expensesToday.reduce((s, e) => s + e.amount, 0))} color="text-amber-400" loading={expensesLoading} to="/expenses" />
          <StatCard title="Sales"    value={formatCurrency(salesTotal)}                   color="text-green-400"  loading={loading} />
        </div>
      </section>

      {/* All-time totals */}
      <section>
        <p className="section-header">Overall</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          <StatCard title="Active Leads"     value={String(data?.activeLeadCount ?? 0)}          color="text-indigo-400" loading={loading} />
          <StatCard title="Active Customers" value={String(data?.activeCustomerCount ?? 0)}       color="text-indigo-300" loading={loading} />
          <StatCard title="Active Tasks"     value={String(todos.length)}                         color="text-violet-400" loading={todosLoading} to="/todo" />
          <StatCard title="Total Sales"      value={formatCurrency(data?.totalCustomerSales ?? 0)} color="text-green-400"  loading={loading} />
        </div>
      </section>

      {/* Bar chart — hidden when loading or all values are zero */}
      {!loading && chartEntries && chartEntries.some(e => e.count > 0) && (
        <section className="card p-4">
          <p className="text-xs font-semibold text-gray-400 mb-3">Today at a Glance</p>
          <SnapshotChart entries={chartEntries} />
        </section>
      )}

      {/* Tasks */}
      <TasksCard todos={todos} loading={todosLoading} />

      {/* Follow-ups */}
      {followUps.length > 0 && <FollowUpsCard items={followUps} />}

      {/* Expenses Today */}
      <ExpensesTodayCard expenses={expensesToday} loading={expensesLoading} />

      {/* Leads today */}
      <ListSection
        title="Leads Today" color="text-indigo-400" badgeColor="bg-indigo-600"
        items={data?.leadsToday} loading={loading} emptyMsg="No leads today"
      />

      {/* Appointments */}
      <ListSection
        title="Appointments Today" color="text-orange-400" badgeColor="bg-orange-600"
        items={data?.appointmentsToday} loading={loading} emptyMsg="No appointments today"
      />

      {/* Customers */}
      <ListSection
        title="Customers Today" color="text-indigo-300" badgeColor="bg-indigo-500"
        items={data?.customersToday} loading={loading} emptyMsg="No customers today"
      />

      {/* Sales */}
      <ListSection
        title="Sales Today" color="text-green-400" badgeColor="bg-green-600"
        items={data?.salesToday} loading={loading} emptyMsg="No sales today"
        valueKey="amount"
      />

      {/* Jobs */}
      <ListSection
        title="Jobs in Progress" color="text-teal-400" badgeColor="bg-teal-600"
        items={data?.jobsStartingToday} loading={loading} emptyMsg="No jobs starting today"
      />
    </div>
  )
}

const PRIORITY_DOT: Record<Todo['priority'], string> = {
  low:    'bg-gray-400',
  medium: 'bg-yellow-400',
  high:   'bg-red-400',
}

const PRIORITY_TEXT: Record<Todo['priority'], string> = {
  low:    'text-gray-400',
  medium: 'text-yellow-400',
  high:   'text-red-400',
}

const MAX_TASKS = 5

function TasksCard({ todos, loading }: { todos: Todo[]; loading: boolean }) {
  const preview = todos.slice(0, MAX_TASKS)
  return (
    <section>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <p className="section-header mb-0 text-violet-400">Tasks</p>
          {todos.length > 0 && (
            <span className="text-xs font-semibold text-white px-2 py-0.5 rounded-full bg-violet-600">
              {todos.length}
            </span>
          )}
        </div>
        <Link to="/todo" className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors">
          View all →
        </Link>
      </div>
      <div className="card divide-y divide-gray-700/50">
        {loading ? (
          <div className="flex items-center gap-2 px-4 py-3 text-gray-400 text-sm">
            <span className="w-4 h-4 border-2 border-gray-500 border-t-transparent rounded-full animate-spin" />
            Loading…
          </div>
        ) : todos.length === 0 ? (
          <p className="px-4 py-3 text-sm text-gray-500">No active tasks</p>
        ) : (
          <>
            {preview.map(todo => {
              const initial = todo.title.trim()[0]?.toUpperCase() || '?'
              const avatarBg = 'rgba(167,139,250,0.2)'
              const avatarText = '#a78bfa'
              return (
                <Link
                  key={todo.id}
                  to={`/todo/${todo.id}/edit`}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-gray-700/30 transition-colors"
                >
                  <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ background: avatarBg }}>
                    <span className="text-xs font-semibold" style={{ color: avatarText }}>{initial}</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-gray-100 truncate">{todo.title}</p>
                    {todo.dueDate && (
                      <p className="text-xs text-indigo-400 mt-0.5">
                        Due {todo.dueDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className={`w-2 h-2 rounded-full ${PRIORITY_DOT[todo.priority]}`} />
                    <span className={`text-xs capitalize ${PRIORITY_TEXT[todo.priority]}`}>{todo.priority}</span>
                  </div>
                </Link>
              )
            })}
            {todos.length > MAX_TASKS && (
              <Link to="/todo" className="block px-4 py-2.5 text-xs text-center text-indigo-400 hover:text-indigo-300 transition-colors">
                +{todos.length - MAX_TASKS} more tasks
              </Link>
            )}
          </>
        )}
      </div>
    </section>
  )
}

function ExpensesTodayCard({ expenses, loading }: { expenses: Expense[]; loading: boolean }) {
  const preview = expenses.slice(0, MAX_TASKS)
  const total   = expenses.reduce((s, e) => s + e.amount, 0)
  return (
    <section>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <p className="section-header mb-0 text-amber-400">Expenses Today</p>
          {expenses.length > 0 && (
            <span className="text-xs font-semibold text-white px-2 py-0.5 rounded-full bg-amber-600">
              {formatCurrency(total)}
            </span>
          )}
        </div>
        <Link to="/expenses" className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors">
          View all →
        </Link>
      </div>
      <div className="card divide-y divide-gray-700/50">
        {loading ? (
          <div className="flex items-center gap-2 px-4 py-3 text-gray-400 text-sm">
            <span className="w-4 h-4 border-2 border-gray-500 border-t-transparent rounded-full animate-spin" />
            Loading…
          </div>
        ) : expenses.length === 0 ? (
          <p className="px-4 py-3 text-sm text-gray-500">No expenses today</p>
        ) : (
          <>
            {preview.map(expense => {
              const initial = expense.title.trim()[0]?.toUpperCase() || '?'
              return (
                <Link
                  key={expense.id}
                  to="/expenses"
                  className="flex items-center gap-3 px-4 py-3 hover:bg-gray-700/30 transition-colors"
                >
                  <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ background: 'rgba(251,191,36,0.2)' }}>
                    <span className="text-xs font-semibold" style={{ color: '#fbbf24' }}>{initial}</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-gray-100 truncate">{expense.title}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{expense.category}</p>
                  </div>
                  <span className="text-sm font-semibold text-amber-400 shrink-0">{formatCurrency(expense.amount)}</span>
                </Link>
              )
            })}
            {expenses.length > MAX_TASKS && (
              <Link to="/expenses" className="block px-4 py-2.5 text-xs text-center text-indigo-400 hover:text-indigo-300 transition-colors">
                +{expenses.length - MAX_TASKS} more expenses
              </Link>
            )}
          </>
        )}
      </div>
    </section>
  )
}

function FollowUpsCard({ items }: { items: CustomerItem[] }) {
  const now = new Date(); now.setHours(0, 0, 0, 0)
  const overdueOrToday = items.filter(c => c.followUpDate && c.followUpDate <= new Date())
  const upcoming       = items.filter(c => c.followUpDate && c.followUpDate > new Date())

  function followUpLabel(d: Date): { text: string; color: string } {
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const diff = Math.round((d.getTime() - today.getTime()) / 86400000)
    if (diff < 0)  return { text: `${Math.abs(diff)}d overdue`, color: 'text-red-400' }
    if (diff === 0) return { text: 'Today',                     color: 'text-yellow-400' }
    if (diff === 1) return { text: 'Tomorrow',                  color: 'text-orange-400' }
    return {
      text: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      color: 'text-gray-400',
    }
  }

  const preview = items.slice(0, 5)

  return (
    <section>
      <div className="flex items-center gap-2 mb-2">
        <p className="section-header mb-0 text-rose-400">Follow-ups</p>
        {overdueOrToday.length > 0 && (
          <span className="text-xs font-semibold text-white px-2 py-0.5 rounded-full bg-red-600">
            {overdueOrToday.length} due
          </span>
        )}
        {upcoming.length > 0 && (
          <span className="text-xs font-semibold text-white px-2 py-0.5 rounded-full bg-gray-600">
            +{upcoming.length} upcoming
          </span>
        )}
      </div>
      <div className="card divide-y divide-gray-700/50">
        {preview.map(c => {
          const label = followUpLabel(c.followUpDate!)
          return (
            <Link
              key={c.id}
              to={`/records/${c.id}`}
              className="flex items-center gap-3 px-4 py-3 hover:bg-gray-700/30 transition-colors"
            >
              <span className="text-base shrink-0">🔔</span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-gray-100 truncate">{fullName(c) || '—'}</p>
                {c.phone && <p className="text-xs text-gray-400">{c.phone}</p>}
              </div>
              <span className={`text-xs font-semibold shrink-0 ${label.color}`}>{label.text}</span>
            </Link>
          )
        })}
        {items.length > 5 && (
          <Link to="/leads" className="block px-4 py-2.5 text-xs text-center text-indigo-400 hover:text-indigo-300 transition-colors">
            +{items.length - 5} more
          </Link>
        )}
      </div>
    </section>
  )
}

function ListSection({
  title, color, badgeColor, items, loading, emptyMsg, valueKey,
}: {
  title: string
  color: string
  badgeColor: string
  items?: CustomerItem[]
  loading: boolean
  emptyMsg: string
  valueKey?: 'amount'
}) {
  const coloredAvatars = usePrefStore(s => s.coloredAvatars)
  return (
    <section>
      <div className="flex items-center gap-2 mb-2">
        <p className={`section-header mb-0 ${color}`}>{title}</p>
        {items && items.length > 0 && (
          <span className={`text-xs font-semibold text-white px-2 py-0.5 rounded-full ${badgeColor}`}>
            {valueKey === 'amount'
              ? formatCurrency(items.reduce((s, c) => s + c.amount, 0))
              : items.length}
          </span>
        )}
      </div>
      <div className="card divide-y divide-gray-700/50">
        {loading ? (
          <div className="flex items-center gap-2 px-4 py-3 text-gray-400 text-sm">
            <span className="w-4 h-4 border-2 border-gray-500 border-t-transparent rounded-full animate-spin" />
            Loading…
          </div>
        ) : !items || items.length === 0 ? (
          <p className="px-4 py-3 text-sm text-gray-500">{emptyMsg}</p>
        ) : (
          items.map(c => {
            const color = coloredAvatars ? avatarColor(fullName(c)) : AVATAR_ORIGINAL
            return (
            <Link
              key={c.id}
              to={`/records/${c.id}`}
              className="flex items-center gap-3 px-4 py-3 hover:bg-gray-700/30 transition-colors"
            >
              <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ background: color.bg }}>
                <span className="text-xs font-semibold" style={{ color: color.text }}>
                  {[c.first[0], c.lastname[0]].filter(Boolean).join('').toUpperCase() || '?'}
                </span>
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-gray-100 truncate">{fullName(c) || '—'}</p>
                {c.city && <p className="text-xs text-gray-400">{c.city}{c.state ? `, ${c.state}` : ''}</p>}
              </div>
              {c.amount > 0 && (
                <span className="text-sm font-semibold text-green-400 shrink-0">{formatCurrency(c.amount)}</span>
              )}
            </Link>
            )
          })
        )}
      </div>
    </section>
  )
}
