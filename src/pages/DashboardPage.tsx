import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { getDoc, doc } from 'firebase/firestore'
import { db } from '../firebase/config'
import { usePageTitle } from '../hooks/usePageTitle'
import { fetchSnapshot, type SnapshotData, type SaleEntry } from '../services/snapshotService'
import {
  formatCurrency, fullName, displayName, customerFromDoc, categoryMatches,
} from '../models/customer'
import { avatarColor, avatarOriginal } from '../utils/avatarColor'
import { usePrefStore } from '../stores/prefStore'
import { usePickerStore } from '../stores/pickerStore'
import { useChatStore } from '../stores/chatStore'
import StatCard from '../components/StatCard'
import OnboardingChecklist from '../components/OnboardingChecklist'

// Lazy-load recharts via SnapshotChart so the 115 KB recharts chunk is deferred
// until the chart actually renders, not on every post-login dashboard load.
const SnapshotChart = lazy(() => import('../components/SnapshotChart'))
import { esc } from '../utils/exportUtils'
import { subscribeToTodos } from '../services/todoService'
import { subscribeToExpensesInRange } from '../services/expenseService'
import { subscribeToFollowUps, subscribeToCustomers, REALTIME_LIMIT } from '../services/customerService'
import { subscribeToAllActivities } from '../services/activityService'
import { getGoals } from '../services/goalService'
import type { Activity } from '../models/activity'
import { buildFeedRows, timeAgo, type FeedRow } from '../models/activityFeed'
import { type GoalDoc, type GoalValues, type PeriodRange } from '../models/goal'
import { type JobStage, JOB_STAGE_CONFIG, getJobStage } from '../models/jobPipeline'
import { subscribeToPipelineStages } from '../services/pipelineStageService'
import { DEFAULT_STAGES, STAGE_COLOR_CLASSES, effectiveStageId, type PipelineStageConfig } from '../models/pipelineStage'
import { subscribeToProposals } from '../services/proposalService'
import {
  effectiveStatus as proposalEffectiveStatus, proposalTotal, fmtCurrency as fmtProposalCurrency,
  type Proposal,
} from '../models/proposal'
import { fmtMoneyCompact, fmtMoneyExact } from '../models/salesReport'
import type { RepStats } from '../models/leaderboard'
import {
  ACTIVITY_TINT, MONEY_BASIS, MONEY_LABELS, PERIOD_PHRASE, PERIOD_SUFFIX, PERIOD_TABS,
  PERIOD_TITLE, SCOPE_NOTE, SCOPE_SUFFIX, SNAPSHOT_PERIODS, UPCOMING_WINDOW_DAYS,
  appointmentsOnDay, dashboardRange, goalsForPeriod, stageCountsOf, topPerformerIn,
  upcomingAppointments, type BlockScope, type SnapshotPeriod,
} from '../models/dashboard'
import { useAuthStore } from '../stores/authStore'
import type { Todo } from '../models/todo'
import type { Expense } from '../models/expense'
import type { CustomerItem } from '../models/customer'
import { dueMeta, dueMetaCompact, isOverdue } from '../utils/dueDate'
import { Icon, ICONS, ACTIVITY_ICONS } from '../components/Icon'
import CollapsibleSection from '../components/CollapsibleSection'

const ACTIVITY_PREVIEW = 20

// A company name outranks the person's name on a record row: it becomes the
// title, and the person's name joins the subtitle — matching the record list,
// pipeline and detail page.
function recordRow(c: CustomerItem, detail: string) {
  const hasCompany = c.companyName.trim() !== ''
  const title = displayName(c)
  return {
    title,
    sub: [hasCompany ? fullName(c) : '', detail].filter(Boolean).join(' · '),
    initials: (hasCompany
      ? title.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('')
      : [c.first[0], c.lastname[0]].filter(Boolean).join('')
    ).toUpperCase(),
  }
}

// Name cell for the printed/emailed tables, which take plain strings.
function nameCell(c: CustomerItem): string {
  const person = fullName(c)
  const company = c.companyName.trim()
  if (!company) return person
  return person ? `${company} (${person})` : company
}
const CHART_ENTRIES = (data: SnapshotData) => [
  { label: 'Leads',    count: data.leadsToday.length,         color: '#6366f1' },
  { label: 'Appts',   count: data.appointmentsToday.length,  color: '#f97316' },
  { label: 'Customer',count: data.customersToday.length,     color: '#818cf8' },
  { label: 'Jobs',    count: data.jobsStartingToday.length,  color: '#14b8a6' },
]

/**
 * Heading for a card, with the scope it reports on.
 *
 * Period-scoped cards say nothing extra — the tab above already names the
 * period. Cards the tabs don't reach say so, because ten of the fourteen
 * blocks on this page ignore the tabs and an unchanged figure otherwise reads
 * as stale data.
 */
function CardHeader({
  title, scope = 'period', to, children,
}: {
  title: string
  scope?: BlockScope
  to?: string
  children?: ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-2 mb-2">
      <div className="flex items-center gap-2 min-w-0">
        <p className="section-header mb-0 truncate">
          {title}
          {SCOPE_SUFFIX[scope] && (
            <span className="font-normal normal-case tracking-normal text-gray-400" title={SCOPE_NOTE[scope]}>
              {' · '}{SCOPE_SUFFIX[scope]}
            </span>
          )}
        </p>
        {children}
      </div>
      {to && (
        <Link to={to} className="inline-flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300 transition-colors shrink-0">
          View all
          <Icon d={ICONS.arrowRight} className="w-3 h-3" />
        </Link>
      )}
    </div>
  )
}

/**
 * The count beside a section heading.
 *
 * Was seven pills in six hues — gray, red, slate, sky, amber, green, orange —
 * one per section, encoding nothing. StatCard's own docstring had already
 * diagnosed and fixed this a level up ("a saturated number reads as though it
 * means something"); the section headings never got the same pass, and the red
 * that does mean something was diluted by five that don't. Neutral by default,
 * `tone="alert"` only for genuinely overdue work.
 */
function CountPill({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'neutral' | 'alert' }) {
  return (
    <span
      className={`text-xs font-semibold px-2 py-0.5 rounded-full tabular-nums shrink-0 ${
        tone === 'alert' ? 'bg-red-500/15 text-red-300' : 'bg-gray-700 text-gray-200'
      }`}
    >
      {children}
    </span>
  )
}

export default function DashboardPage() {
  usePageTitle('Dashboard')
  const [period, setPeriod] = useState<SnapshotPeriod>('today')
  const [data, setData] = useState<SnapshotData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [todos, setTodos] = useState<Todo[]>([])
  const [todosLoading, setTodosLoading] = useState(true)
  const [expensesToday, setExpensesToday] = useState<Expense[]>([])
  const [expensesLoading, setExpensesLoading] = useState(true)
  const [followUps, setFollowUps] = useState<CustomerItem[]>([])
  const [followUpsLoading, setFollowUpsLoading] = useState(true)
  const [followUpsError, setFollowUpsError] = useState<string | null>(null)
  const [activities, setActivities] = useState<Activity[]>([])
  // Only for activity customers that aren't in the subscribed set (deleted, or
  // beyond REALTIME_LIMIT). A miss here is a real absence, not a pending read.
  const [extraCustomers, setExtraCustomers] = useState<Map<string, CustomerItem>>(new Map())
  const fetchedIds = useRef<Set<string>>(new Set())
  const [activitiesLoading, setActivitiesLoading] = useState(true)
  const [allCustomers, setAllCustomers] = useState<CustomerItem[]>([])
  const [allCustomersLoading, setAllCustomersLoading] = useState(true)
  const [customersHitCap, setCustomersHitCap] = useState(false)
  const [pipelineStages, setPipelineStages] = useState<PipelineStageConfig[]>(DEFAULT_STAGES)
  const [proposals, setProposals] = useState<Proposal[]>([])
  const [proposalsLoading, setProposalsLoading] = useState(true)
  const [goals, setGoals] = useState<GoalDoc | null>(null)
  const [chartOpen, setChartOpen] = useState(false)
  const user = useAuthStore(s => s.user)
  const companyId = useAuthStore(s => s.companyId)
  const unreadChats = useChatStore(s => s.unreadCount)
  const salesmanLabel = usePickerStore(s => s.labels.salesman ?? 'Salesman')

  async function load() {
    setLoading(true)
    setError(null)
    try {
      // Goals are a one-shot read, so Refresh has to re-fetch them too — it
      // previously reloaded only the snapshot, leaving a target edited in
      // another tab stale until a full page reload.
      const [snap, goalDoc] = await Promise.all([fetchSnapshot(period), getGoals()])
      setData(snap)
      setGoals(goalDoc)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [period])

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
    setExpensesLoading(true)
    const range = dashboardRange(period)
    const unsub = subscribeToExpensesInRange(
      range.start, range.end,
      items => { setExpensesToday(items); setExpensesLoading(false) },
      ()    => setExpensesLoading(false),
    )
    return unsub
  }, [user, companyId, period])

  useEffect(() => {
    if (!user) { setFollowUpsLoading(false); return }
    const unsub = subscribeToFollowUps(
      items => { setFollowUps(items); setFollowUpsLoading(false); setFollowUpsError(null) },
      err   => { setFollowUpsLoading(false); setFollowUpsError(err.message) },
    )
    return unsub
  }, [user, companyId])

  useEffect(() => {
    if (!user) { setAllCustomersLoading(false); return }
    const unsub = subscribeToCustomers(
      (items, hitCap) => { setAllCustomers(items); setCustomersHitCap(hitCap); setAllCustomersLoading(false) },
      ()               => setAllCustomersLoading(false),
    )
    return unsub
  }, [user, companyId])

  useEffect(() => subscribeToPipelineStages(s => setPipelineStages(s), () => {}), [companyId])

  useEffect(() => {
    if (!user) { setProposalsLoading(false); return }
    const unsub = subscribeToProposals(
      items => { setProposals(items); setProposalsLoading(false) },
      ()    => setProposalsLoading(false),
    )
    return unsub
  }, [user, companyId])

  useEffect(() => {
    if (!user) { setActivitiesLoading(false); return }
    // Ordered by createdAt in the query now, so this preview is genuinely the
    // newest few rather than the first few of an arbitrary 5,000-doc slice.
    const unsub = subscribeToAllActivities(
      page  => { setActivities(page.items.slice(0, ACTIVITY_PREVIEW)); setActivitiesLoading(false) },
      ()    => setActivitiesLoading(false),
    )
    return unsub
  }, [user, companyId])

  const customerIndex = useMemo(() => {
    const m = new Map<string, CustomerItem>()
    for (const c of allCustomers) m.set(c.id, c)
    for (const [id, c] of extraCustomers) if (!m.has(id)) m.set(id, c)
    return m
  }, [allCustomers, extraCustomers])

  /**
   * Fill in activity customers the subscription didn't cover.
   *
   * This used to read all twenty activity customers individually on every
   * change — twenty document reads for names already sitting in `allCustomers`
   * in memory. Now only genuine misses are fetched, and a customer that comes
   * back missing stays missing so the row can say so instead of showing the
   * loading ellipsis forever.
   *
   * `fetchedIds` records every id we've asked about, including the ones that
   * didn't exist. Without it a deleted customer is permanently absent from
   * `customerIndex`, so this effect would re-request it every time the live
   * customer subscription fires.
   */
  useEffect(() => {
    if (activities.length === 0 || allCustomersLoading) return
    const missing = [...new Set(activities.map(a => a.customerId))]
      .filter(id => id && !customerIndex.has(id) && !fetchedIds.current.has(id))
    if (missing.length === 0) return
    for (const id of missing) fetchedIds.current.add(id)

    let cancelled = false
    Promise.all(missing.map(async id => {
      try {
        const snap = await getDoc(doc(db, 'Customers', id))
        return snap.exists() ? ([id, customerFromDoc(snap)] as [string, CustomerItem]) : null
      } catch {
        // A failed read isn't proof of absence, so allow a later retry.
        fetchedIds.current.delete(id)
        return null
      }
    })).then(results => {
      if (cancelled) return
      const found = results.filter((r): r is [string, CustomerItem] => r !== null)
      if (found.length === 0) return
      setExtraCustomers(prev => new Map([...prev, ...found]))
    })
    return () => { cancelled = true }
  }, [activities, customerIndex, allCustomersLoading])

  const feedRows = useMemo(
    () => buildFeedRows(activities, customerIndex),
    [activities, customerIndex],
  )

  const salesTotal = data?.salesToday.reduce((s, c) => s + c.amount, 0) ?? 0
  const chartEntries = data ? CHART_ENTRIES(data) : null

  // The selected period as a range, and its subtitle: today's date,
  // "September 2026" or "2026".
  const range = useMemo(() => dashboardRange(period), [period])

  // Targets and actuals for whichever period the tabs are on. The card was
  // pinned to `goals.month` even on the Year tab, though resolveGoalTargets
  // had already resolved the year target from the same document.
  const periodGoals = useMemo(
    () => goalsForPeriod(goals, allCustomers, period),
    [goals, allCustomers, period],
  )

  const stageCounts = useMemo(
    () => stageCountsOf(allCustomers, c => effectiveStageId(c, pipelineStages), pipelineStages.map(s => s.id)),
    [allCustomers, pipelineStages],
  )

  const proposalStats = useMemo(() => {
    const sent     = proposals.filter(p => proposalEffectiveStatus(p) === 'sent')
    const accepted = proposals.filter(p => proposalEffectiveStatus(p) === 'accepted')
    const responded = proposals.filter(p => {
      const s = proposalEffectiveStatus(p)
      return s === 'accepted' || s === 'declined'
    })
    return {
      pendingValue:  sent.reduce((s, p) => s + proposalTotal(p), 0),
      acceptedValue: accepted.reduce((s, p) => s + proposalTotal(p), 0),
      winRate:       responded.length > 0 ? Math.round((accepted.length / responded.length) * 100) : 0,
      sentCount:     sent.length,
    }
  }, [proposals])

  const jobStageCounts = useMemo(() => {
    const now = new Date()
    const counts: Record<JobStage, number> = { pending: 0, scheduled: 0, active: 0, complete: 0 }
    for (const c of allCustomers) {
      if (!categoryMatches(c.category, 'Customer') || !c.isActive) continue
      counts[getJobStage(c, now)]++
    }
    return counts
  }, [allCustomers])

  // Ranked by /leaderboard's own function, which holds unassigned records out
  // of the competition — the inline version ranked them as a person, so "Top
  // Salesman" could be a data-quality gap wearing a trophy.
  const topPerformer = useMemo(
    () => topPerformerIn(allCustomers, range),
    [allCustomers, range],
  )

  // Triage counts for the Needs Attention block. Deliberately independent of
  // the period tabs: "what needs me right now" is always today, whereas the
  // tabs rescope the strips and lists below to today or this month.
  const overdueFollowUps = useMemo(
    () => followUps.filter(c => c.followUpDate && isOverdue(c.followUpDate)).length,
    [followUps],
  )

  // isOverdue comes from the shared util so this can't disagree with /todo
  // about which tasks are late.
  const overdueTasks = useMemo(
    () => todos.filter(t => !t.isCompleted && t.dueDate && isOverdue(t.dueDate)).length,
    [todos],
  )

  const appointmentsTodayCount = useMemo(
    () => appointmentsOnDay(allCustomers).length,
    [allCustomers],
  )

  const expensesTotal = useMemo(
    () => expensesToday.reduce((sum, e) => sum + e.amount, 0),
    [expensesToday],
  )

  const upcoming = useMemo(() => upcomingAppointments(allCustomers), [allCustomers])

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

    const expenseTotal = expensesToday.reduce((s, e) => s + e.amount, 0)

    // 'Invoiced' and 'Lifetime Value' rather than 'Sales' and 'Total Sales':
    // one is paid invoices issued in the period, the other an all-time sum of
    // customer.amount. Printed side by side under two names that both read as
    // "money earned", they looked like the same figure disagreeing with itself.
    const todayTable = buildTable(
      ['', 'Leads', 'Appts', 'Customers', 'Invoiced', 'Jobs', 'Expenses'],
      [[PERIOD_TABS[period],
        String(snap.leadsToday.length),
        String(snap.appointmentsToday.length),
        String(snap.customersToday.length),
        formatCurrency(salesTotal),
        String(snap.jobsStartingToday.length),
        formatCurrency(expenseTotal),
      ]]
    )

    const overallTable = buildTable(
      ['', 'Active Leads', 'Active Customers', 'Active Tasks', 'Open Follow-ups', 'Lifetime Value'],
      [['All time',
        String(snap.activeLeadCount),
        String(snap.activeCustomerCount),
        String(todos.length),
        String(followUps.length),
        formatCurrency(snap.totalCustomerSales),
      ]]
    )

    const leadsSect = snap.leadsToday.length ? section(
      `Leads ${PERIOD_SUFFIX[period]}`, String(snap.leadsToday.length),
      buildTable(
        ['Name', 'Phone', 'Location', 'Email', 'Salesman', 'Callback', 'Ad #'],
        snap.leadsToday.map(c => [
          nameCell(c), c.phone, [c.city, c.state].filter(Boolean).join(', '),
          c.email, c.salesman, c.callback, c.adNo,
        ]),
      )
    ) : ''

    const apptsSect = snap.appointmentsToday.length ? section(
      `Appointments ${PERIOD_SUFFIX[period]}`, String(snap.appointmentsToday.length),
      buildTable(
        ['Name', 'Phone', 'Location', 'Salesman', 'Appt Date', 'Callback'],
        snap.appointmentsToday.map(c => [
          nameCell(c), c.phone, [c.city, c.state].filter(Boolean).join(', '),
          c.salesman, c.startDate ? fmtDate(c.startDate) : '', c.callback,
        ]),
      )
    ) : ''

    const customersSect = snap.customersToday.length ? section(
      `Customers ${PERIOD_SUFFIX[period]}`, String(snap.customersToday.length),
      buildTable(
        ['Name', 'Phone', 'Location', 'Email', 'Salesman', 'Amount'],
        snap.customersToday.map(c => [
          nameCell(c), c.phone, [c.city, c.state].filter(Boolean).join(', '),
          c.email, c.salesman, c.amount > 0 ? formatCurrency(c.amount) : '',
        ]),
      )
    ) : ''

    const salesTotal2 = snap.salesToday.reduce((s, c) => s + c.amount, 0)
    const salesSect = snap.salesToday.length ? section(
      `Sales ${PERIOD_SUFFIX[period]}`, formatCurrency(salesTotal2),
      buildTable(
        ['Invoice #', 'Name', 'Phone', 'Amount'],
        snap.salesToday.map(s => [
          s.invoiceNumber, s.customerName, s.customerPhone,
          s.amount > 0 ? formatCurrency(s.amount) : '',
        ]),
      )
    ) : ''

    const jobsSect = snap.jobsStartingToday.length ? section(
      'Jobs in Progress', String(snap.jobsStartingToday.length),
      buildTable(
        ['Name', 'Phone', 'Location', 'Salesman', 'Contractor', 'Job', 'Product', 'Start', 'Completion'],
        snap.jobsStartingToday.map(c => [
          nameCell(c), c.phone, [c.city, c.state].filter(Boolean).join(', '),
          c.salesman, c.contractor, c.job, c.product,
          c.startDate ? fmtDate(c.startDate) : '', c.completionDate ? fmtDate(c.completionDate) : '',
        ]),
      )
    ) : ''

    const expensesSect = expensesToday.length ? section(
      `Expenses ${PERIOD_SUFFIX[period]}`, formatCurrency(expenseTotal),
      buildTable(
        ['Title', 'Category', 'Amount'],
        expensesToday.map(e => [e.title, e.category, formatCurrency(e.amount)]),
      )
    ) : ''

    const tasksSect = todos.length ? section(
      'Active Tasks', String(todos.length),
      buildTable(
        ['Task', 'Priority', 'Due Date'],
        todos.map(t => [
          t.title,
          t.priority,
          t.dueDate ? fmtDate(t.dueDate) : '',
        ]),
      )
    ) : ''

    const followUpsSect = followUps.length ? section(
      'Follow-ups', String(followUps.length),
      buildTable(
        ['Name', 'Phone', 'Follow-up Date'],
        followUps.map(c => [
          nameCell(c),
          c.phone,
          c.followUpDate ? fmtDate(c.followUpDate) : '',
        ]),
      )
    ) : ''

    const goalRows: { label: string; actual: number; target: number; format: (n: number) => string }[] = [
      { label: 'Revenue',   actual: periodGoals.actual.revenue,   target: periodGoals.target.revenue,   format: formatCurrency },
      { label: 'Leads',     actual: periodGoals.actual.leads,     target: periodGoals.target.leads,     format: n => n.toLocaleString() },
      { label: 'Customers', actual: periodGoals.actual.customers, target: periodGoals.target.customers, format: n => n.toLocaleString() },
    ]
    const goalsSect = periodGoals.hasTargets ? section(
      `Goals — ${esc(periodGoals.range.label)}`, '',
      buildTable(
        ['Metric', 'Actual', 'Target', '% of Goal'],
        goalRows.map(r => [
          r.label,
          r.format(r.actual),
          r.format(r.target),
          r.target > 0 ? `${Math.min(100, Math.round((r.actual / r.target) * 100))}%` : '—',
        ]),
      )
    ) : ''

    const pipelineTotal = pipelineStages.reduce((s, cfg) => s + (stageCounts[cfg.id] ?? 0), 0)
    const pipelineSect = pipelineTotal > 0 ? section(
      'Pipeline', String(pipelineTotal),
      buildTable(
        ['Stage', 'Count'],
        pipelineStages.map(cfg => [cfg.label, String(stageCounts[cfg.id] ?? 0)]),
      )
    ) : ''

    const proposalSect = proposals.length > 0 ? section(
      'Proposals', `${proposalStats.winRate}% win rate`,
      buildTable(
        ['Metric', 'Value'],
        [
          ['Pending',         formatCurrency(proposalStats.pendingValue)],
          ['Accepted Value',  formatCurrency(proposalStats.acceptedValue)],
          ['Win Rate',        `${proposalStats.winRate}%`],
          ['Awaiting Response', String(proposalStats.sentCount)],
        ],
      )
    ) : ''

    const jobPipelineTotal = JOB_STAGE_CONFIG.reduce((s, cfg) => s + jobStageCounts[cfg.id], 0)
    const jobPipelineSect = jobPipelineTotal > 0 ? section(
      'Jobs Pipeline', String(jobPipelineTotal),
      buildTable(
        ['Stage', 'Count'],
        JOB_STAGE_CONFIG.map(cfg => [cfg.label, String(jobStageCounts[cfg.id])]),
      )
    ) : ''

    // salesmanLabel comes from pickerStore, i.e. it's whatever the company
    // typed into settings — the only user-controlled value that reaches this
    // HTML outside buildTable, which escapes its own cells.
    const topPerformerSect = topPerformer ? section(
      `Top ${esc(salesmanLabel)} — ${esc(range.label)}`, formatCurrency(topPerformer.revenue),
      buildTable(
        ['Name', 'Sales', 'Revenue'],
        [[topPerformer.name, String(topPerformer.customers), formatCurrency(topPerformer.revenue)]],
      )
    ) : ''

    const upcomingSect = upcoming.length ? section(
      `Upcoming Appointments — next ${UPCOMING_WINDOW_DAYS} days`, String(upcoming.length),
      buildTable(
        ['Name', 'Phone', 'Appt Date'],
        upcoming.map(c => [
          nameCell(c), c.phone, c.startDate ? fmtDate(c.startDate) : '',
        ]),
      )
    ) : ''

    const activitySect = feedRows.length ? section(
      'Recent Activity', String(feedRows.length),
      buildTable(
        ['Customer', 'Type', 'User', 'When'],
        feedRows.map(r => [
          r.customerMissing ? 'Deleted record' : (r.customerName ?? '—'),
          r.typeLabel ?? r.type,
          r.userName,
          fmtDate(r.createdAt),
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
  <h1>${PERIOD_TITLE[period]} Snapshot</h1>
  <p class="sub">${esc(range.label)} &middot; printed ${dateStr}</p>

  <div class="summary-section">
    <div class="summary-label">${PERIOD_TABS[period]}</div>
    ${todayTable}
  </div>

  <div class="summary-section" style="margin-top:14px;">
    <div class="summary-label">All time &mdash; not affected by the selected period</div>
    ${overallTable}
  </div>

  ${goalsSect}
  ${pipelineSect}
  ${proposalSect}
  ${jobPipelineSect}
  ${leadsSect}
  ${apptsSect}
  ${customersSect}
  ${salesSect}
  ${jobsSect}
  ${expensesSect}
  ${tasksSect}
  ${followUpsSect}
  ${topPerformerSect}
  ${upcomingSect}
  ${activitySect}
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
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
      {/* Header. "Dashboard", matching the nav entry and the browser title —
          the h1 said "Snapshot" while both of those said Dashboard, so the
          page had three names. The printout keeps "Snapshot" as the report's
          own name, which is a document title rather than the page's. */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Dashboard</h1>
          <p className="text-sm text-gray-400 mt-0.5">{range.label}</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={load}
            disabled={loading}
            className="btn-secondary text-sm px-3 py-1.5"
          >
            <span className="flex items-center gap-1.5">
              <Icon d={ICONS.refresh} className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </span>
          </button>
          <button
            onClick={handlePrint}
            disabled={loading || !data}
            className="text-sm font-medium px-3 py-1.5 rounded-lg bg-gray-700 text-gray-200 hover:bg-gray-600 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <span className="flex items-center gap-1.5">
              <Icon d={ICONS.printer} className="w-4 h-4" />
              Print
            </span>
          </button>
        </div>
      </div>

      <NeedsAttentionCard
        overdueFollowUps={overdueFollowUps}
        overdueTasks={overdueTasks}
        appointmentsToday={appointmentsTodayCount}
        unreadChats={unreadChats}
        loading={followUpsLoading || todosLoading || allCustomersLoading}
      />

      <OnboardingChecklist />

      {customersHitCap && (
        <div className="bg-yellow-900/20 border border-yellow-600/40 rounded-xl px-4 py-3 text-yellow-300 text-sm">
          <span className="flex items-start gap-2">
            <Icon d={ICONS.warning} className="w-4 h-4 shrink-0 mt-0.5" />
            <span>These stats only reflect the first {REALTIME_LIMIT.toLocaleString()} customer records — contact support to raise this limit.</span>
          </span>
        </div>
      )}

      {error && (
        <div className="bg-red-900/30 border border-red-700/50 rounded-xl px-4 py-3 text-red-300 text-sm">
          {error}
        </div>
      )}

      {/* ── Period-scoped zone ────────────────────────────────────────────
          Everything between the tabs and the divider below responds to the
          selected period. The tabs used to sit above all fourteen blocks while
          only four of them actually moved, so picking "Year" left ten figures
          identical — indistinguishable from stale data. Grouping them means an
          unchanged number is explained by where it sits. */}
      <div role="tablist" aria-label="Snapshot period" className="flex gap-1.5">
        {SNAPSHOT_PERIODS.map(p => (
          <button
            key={p}
            role="tab"
            id={`period-tab-${p}`}
            aria-selected={period === p}
            aria-controls="period-panel"
            onClick={() => setPeriod(p)}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors whitespace-nowrap ${
              period === p ? 'bg-indigo-600 text-white' : 'bg-gray-700 text-gray-300 hover:text-gray-100'
            }`}
          >
            {PERIOD_TABS[p]}
          </button>
        ))}
      </div>

      <div
        id="period-panel"
        role="tabpanel"
        aria-labelledby={`period-tab-${period}`}
        className="space-y-6"
      >
        {/* Stat strip. One array, one grid: the six cards were written out
            twice for mobile and desktop, and a previous fix to the Expense
            formatter landed on only one copy. */}
        <section>
          <p className="section-header">{PERIOD_TABS[period]}</p>
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
            {[
              { title: 'Leads',    value: String(data?.leadsToday.length ?? 0),        loading },
              { title: 'Appts',    value: String(data?.appointmentsToday.length ?? 0), loading },
              { title: 'Customer', value: String(data?.customersToday.length ?? 0),    loading },
              { title: 'Jobs',     value: String(data?.jobsStartingToday.length ?? 0), loading },
              { title: 'Expenses', value: fmtMoneyCompact(expensesTotal), loading: expensesLoading, to: '/expenses', basis: MONEY_BASIS.expenses, exact: fmtMoneyExact(expensesTotal) },
              // "Invoiced", not "Sales": this is paid invoices issued in the
              // period, whereas Goals' Revenue and Lifetime Value are both
              // customer.amount. Three measurements under one word read as one
              // figure contradicting itself.
              { title: MONEY_LABELS.invoiced, value: fmtMoneyCompact(salesTotal), loading, basis: MONEY_BASIS.invoiced, exact: fmtMoneyExact(salesTotal) },
            ].map(c => (
              <StatCard
                key={c.title}
                title={c.title}
                value={c.value}
                loading={c.loading}
                to={c.to}
                titleAttr={c.basis ? `${c.exact} — ${c.basis}` : undefined}
              />
            ))}
          </div>
        </section>

        {/* Goals and the leading rep, both of which now follow the tabs */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <GoalsCard
            target={periodGoals.target}
            actual={periodGoals.actual}
            hasTargets={periodGoals.hasTargets}
            range={periodGoals.range}
            period={period}
            loading={allCustomersLoading}
          />
          <TopPerformerCard
            performer={topPerformer}
            label={salesmanLabel}
            rangeLabel={range.short}
            loading={allCustomersLoading}
          />
        </div>

        {/* Bar chart — hidden when loading or all values are zero */}
        {!loading && chartEntries && chartEntries.some(e => e.count > 0) && (
          <section className="card p-4">
            <button
              onClick={() => setChartOpen(v => !v)}
              aria-expanded={chartOpen}
              className="w-full flex items-center justify-between text-left"
            >
              <p className="text-xs font-semibold text-gray-400">{PERIOD_TABS[period]} at a Glance</p>
              <svg
                className={`w-4 h-4 text-gray-400 transition-transform ${chartOpen ? 'rotate-180' : ''}`}
                fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="m19 9-7 7-7-7" />
              </svg>
            </button>
            {chartOpen && (
              <div className="mt-3">
                <Suspense fallback={<div className="h-[140px] rounded-lg meter-track animate-pulse" />}>
                  <SnapshotChart entries={chartEntries} />
                </Suspense>
              </div>
            )}
          </section>
        )}

        <ExpensesTodayCard expenses={expensesToday} loading={expensesLoading} period={period} />

        {/* Browsable record lists — reference material behind one heading, so
            they stop competing with the triage block and the period figures. */}
        <CollapsibleSection title={`Records ${PERIOD_SUFFIX[period]}`}>
          <ListSection
            title={`Leads ${PERIOD_SUFFIX[period]}`}
            items={data?.leadsToday} loading={loading} emptyMsg={`No leads ${PERIOD_PHRASE[period]}`} viewAllTo="/leads"
          />
          <ListSection
            title={`Appointments ${PERIOD_SUFFIX[period]}`}
            items={data?.appointmentsToday} loading={loading} emptyMsg={`No appointments ${PERIOD_PHRASE[period]}`} viewAllTo="/calendar"
          />
          <ListSection
            title={`Customers ${PERIOD_SUFFIX[period]}`}
            items={data?.customersToday} loading={loading} emptyMsg={`No customers ${PERIOD_PHRASE[period]}`} viewAllTo="/customers"
          />
          <SalesTodayCard items={data?.salesToday} loading={loading} period={period} />
          <ListSection
            title="Jobs in Progress"
            items={data?.jobsStartingToday} loading={loading} emptyMsg={`No jobs starting ${PERIOD_PHRASE[period]}`} viewAllTo="/jobs"
          />
        </CollapsibleSection>
      </div>

      {/* ── Period-free zone ──────────────────────────────────────────────
          Current state and all-time figures. These never moved with the tabs;
          now they sit below a divider that says so, and each card repeats its
          scope in its own heading. */}
      <div className="flex items-center gap-3 pt-2">
        <div className="h-px flex-1 bg-gray-700" />
        <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 shrink-0">
          Current &amp; all-time
        </p>
        <div className="h-px flex-1 bg-gray-700" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <PipelineSummaryCard stages={pipelineStages} counts={stageCounts} loading={allCustomersLoading} />
        <ProposalSummaryCard stats={proposalStats} loading={proposalsLoading} />
        <JobsPipelineSummaryCard counts={jobStageCounts} loading={allCustomersLoading} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <TasksCard todos={todos} loading={todosLoading} />
        <FollowUpsCard items={followUps} loading={followUpsLoading} error={followUpsError} />
        <ActivityTimelineCard rows={feedRows} loading={activitiesLoading} />
      </div>

      <UpcomingAppointmentsCard items={upcoming} loading={allCustomersLoading} />

      <CollapsibleSection title="All-time totals">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
          <StatCard title="Active Leads"     value={String(data?.activeLeadCount ?? 0)} loading={loading} />
          <StatCard title="Active Customers" value={String(data?.activeCustomerCount ?? 0)} loading={loading} />
          <StatCard title="Active Tasks"     value={String(todos.length)} loading={todosLoading} to="/todo" />
          <StatCard
            title={MONEY_LABELS.lifetime}
            value={fmtMoneyCompact(data?.totalCustomerSales ?? 0)}
            loading={loading}
            titleAttr={`${fmtMoneyExact(data?.totalCustomerSales ?? 0)} — ${MONEY_BASIS.lifetime}`}
          />
          <StatCard title="Unread Chats"     value={String(unreadChats)}    loading={false} to="/chat" />
        </div>
      </CollapsibleSection>
    </div>
  )
}

/**
 * Action-first triage. The dashboard previously opened with fourteen
 * equal-weight sections, so "what needs me today?" had to be reconstructed by
 * reading the whole page. This promotes the four signals that represent unmet
 * obligations, and only those — every other block on the page is either a
 * performance figure or a reference list.
 *
 * Period-independent by design: it sits above the period tabs because overdue
 * work is overdue regardless of whether you're looking at today or the month.
 */
function NeedsAttentionCard({
  overdueFollowUps, overdueTasks, appointmentsToday, unreadChats, loading,
}: {
  overdueFollowUps: number
  overdueTasks: number
  appointmentsToday: number
  unreadChats: number
  loading: boolean
}) {
  // Follow-ups land on /followups, the page built for them. The chip used to
  // go to an unfiltered /customers and the card's "+N more" to /leads, so
  // clicking "6 overdue follow-ups" dumped you in a record list with no way to
  // see which six.
  const items = [
    { count: overdueFollowUps,  label: 'overdue follow-up', to: '/followups', urgent: true },
    { count: overdueTasks,      label: 'overdue task',      to: '/todo',      urgent: true },
    { count: appointmentsToday, label: 'appointment today', to: '/calendar',  urgent: false },
    { count: unreadChats,       label: 'unread message',    to: '/chat',      urgent: false },
  ].filter(i => i.count > 0)

  if (loading) {
    return (
      <section className="card p-4">
        <div className="animate-pulse flex flex-wrap gap-3">
          <div className="h-10 w-40 bg-gray-700 rounded-lg" />
          <div className="h-10 w-36 bg-gray-700/60 rounded-lg" />
        </div>
      </section>
    )
  }

  // An empty state that says so, rather than a card that silently vanishes —
  // "nothing needs you" is itself the answer the page exists to give. It is
  // only trustworthy now that the follow-up query reaches back a year: with
  // the old one-day window this printed "all caught up" over any backlog
  // older than yesterday.
  if (items.length === 0) {
    return (
      <section className="card p-4 flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <Icon d={ICONS.checkCircle} className="w-5 h-5 text-green-400 shrink-0" />
        <p className="text-sm font-medium text-gray-100">You&rsquo;re all caught up</p>
        <p className="text-sm text-gray-400">
          No overdue work in the past year, no appointments today, no unread messages.
        </p>
      </section>
    )
  }

  return (
    <section className="card p-4">
      <div className="flex flex-wrap gap-2">
        {items.map(i => (
          <Link
            key={i.label}
            to={i.to}
            // The neutral chip was bg-gray-800 on a bg-gray-800 card with a
            // gray-700 border: a 1.000:1 fill inside a 1.42:1 outline, so it
            // had no visible boundary at all while the red chip beside it did.
            className={`flex items-baseline gap-2 px-3 py-2 rounded-lg border transition-colors ${
              i.urgent
                ? 'bg-red-500/10 border-red-500/40 hover:bg-red-500/20'
                : 'bg-gray-700 border-gray-500 hover:bg-gray-600'
            }`}
          >
            <span className={`text-xl font-bold tabular-nums leading-none ${i.urgent ? 'text-red-300' : 'text-gray-100'}`}>
              {i.count}
            </span>
            <span className={`text-sm ${i.urgent ? 'text-red-200' : 'text-gray-300'}`}>
              {i.label}{i.count === 1 ? '' : 's'}
            </span>
          </Link>
        ))}
      </div>
    </section>
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

/**
 * The dashboard had eleven inline spinners collapsed into a single 44px-tall
 * row, inside cards that grow to ~300px once loaded. With seven independent
 * loading flags resolving at different times, every block shoved the ones
 * below it down as it filled — the page churned for seconds before settling.
 *
 * These two skeletons mirror the geometry of the content they stand in for, so
 * a card occupies its final height from first paint and data swaps in without
 * moving anything. They also make the page speak one loading language:
 * animate-pulse, matching the record lists and /todo.
 */
function RowsSkeleton({ rows = MAX_TASKS }: { rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3 animate-pulse">
          <div className="w-8 h-8 rounded-full bg-gray-700 shrink-0" />
          <div className="flex-1 min-w-0 space-y-1.5">
            <div className="h-3.5 bg-gray-700 rounded" style={{ width: `${68 - i * 6}%` }} />
            <div className="h-3 bg-gray-700/60 rounded w-1/3" />
          </div>
          <div className="h-3 w-12 bg-gray-700/60 rounded shrink-0" />
        </div>
      ))}
    </>
  )
}

/** For `card p-4` panels: stacked label/value lines rather than avatar rows. */
function LinesSkeleton({ lines = 3, bar = false }: { lines?: number; bar?: boolean }) {
  return (
    <div className="animate-pulse space-y-3">
      {bar && <div className="h-2 rounded-full bg-gray-700" />}
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="space-y-1.5">
          <div className="flex items-baseline justify-between">
            <div className="h-3 w-20 bg-gray-700 rounded" />
            <div className="h-3 w-14 bg-gray-700/60 rounded" />
          </div>
          {!bar && <div className="h-1.5 rounded-full bg-gray-700/60" style={{ width: `${80 - i * 15}%` }} />}
        </div>
      ))}
    </div>
  )
}

function TasksCard({ todos, loading }: { todos: Todo[]; loading: boolean }) {
  const preview = todos.slice(0, MAX_TASKS)
  return (
    <section className="h-full flex flex-col">
      <CardHeader title="Tasks" scope="now" to="/todo">
        {todos.length > 0 && <CountPill>{todos.length}</CountPill>}
      </CardHeader>
      <div className="card divide-y divide-gray-700/50 flex-1">
        {loading ? (
          <RowsSkeleton />
        ) : todos.length === 0 ? (
          <p className="px-4 py-3 text-sm text-gray-400">No active tasks</p>
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
                    {todo.dueDate && (() => {
                      // Same treatment as /todo, from the shared helper: the
                      // flat indigo date here carried no urgency AND was built
                      // from a bare toLocaleDateString(), so it showed the day
                      // before for anyone west of UTC.
                      const due = dueMeta(todo.dueDate, todo.isCompleted)
                      return <p className={`text-xs mt-0.5 ${due.cls}`}>{due.label}</p>
                    })()}
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

function ExpensesTodayCard({ expenses, loading, period }: { expenses: Expense[]; loading: boolean; period: SnapshotPeriod }) {
  const preview = expenses.slice(0, MAX_TASKS)
  const total   = expenses.reduce((s, e) => s + e.amount, 0)
  return (
    <section>
      <CardHeader title={`Expenses ${PERIOD_SUFFIX[period]}`} to="/expenses">
        {expenses.length > 0 && (
          // fmtMoneyCompact so this agrees with the Expenses stat tile above,
          // which used the compact formatter while this badge used the exact
          // one — the same total appeared as "$1.2K" and "$1,234" on one
          // screen. The exact figure is on hover.
          <CountPill>
            <span title={`${fmtMoneyExact(total)} — ${MONEY_BASIS.expenses}`}>{fmtMoneyCompact(total)}</span>
          </CountPill>
        )}
      </CardHeader>
      <div className="card divide-y divide-gray-700/50">
        {loading ? (
          <RowsSkeleton />
        ) : expenses.length === 0 ? (
          <p className="px-4 py-3 text-sm text-gray-400">No expenses {PERIOD_PHRASE[period]}</p>
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
                  <span className="text-sm font-semibold text-gray-100 shrink-0">{formatCurrency(expense.amount)}</span>
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

function FollowUpsCard({ items, loading, error }: { items: CustomerItem[]; loading: boolean; error: string | null }) {
  // isOverdue/dueMetaCompact from utils/dueDate rather than a local copy. The
  // local one rendered its fallback date with a bare toLocaleDateString() on a
  // value written at UTC midnight, so a follow-up due the 30th read "Sep 29"
  // west of UTC — and it was a second implementation of a question /followups
  // and /todo already answer.
  const overdue  = items.filter(c => c.followUpDate && isOverdue(c.followUpDate))
  const upcoming = items.filter(c => c.followUpDate && !isOverdue(c.followUpDate))
  const preview  = items.slice(0, MAX_TASKS)

  return (
    <section className="h-full flex flex-col">
      <CardHeader title="Follow-Ups" scope="now" to="/followups">
        {overdue.length > 0 && <CountPill tone="alert">{overdue.length} overdue</CountPill>}
        {upcoming.length > 0 && <CountPill>{upcoming.length} upcoming</CountPill>}
      </CardHeader>
      <div className="card divide-y divide-gray-700/50 flex-1">
        {loading ? (
          <RowsSkeleton />
        ) : error ? (
          <p className="px-4 py-3 text-sm text-red-400">{error}</p>
        ) : items.length === 0 ? (
          <p className="px-4 py-3 text-sm text-gray-400">No follow-ups due</p>
        ) : (
          <>
            {preview.map(c => {
              const due = dueMetaCompact(c.followUpDate!, false)
              const row = recordRow(c, c.phone)
              return (
                <Link
                  key={c.id}
                  to={`/records/${c.id}`}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-gray-700/30 transition-colors"
                >
                  {/* Icon rather than 🔔: emoji render in Apple Color Emoji and
                      ignore currentColor, so they couldn't be tinted or dimmed
                      alongside the SVG glyphs used everywhere else. */}
                  <Icon d={ICONS.bell} className="w-4 h-4 shrink-0 text-gray-400" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-100 truncate">{row.title || '—'}</p>
                    {row.sub && <p className="text-xs text-gray-400 truncate">{row.sub}</p>}
                  </div>
                  <span className={`text-xs font-semibold shrink-0 text-right ${due.cls}`}>{due.label}</span>
                </Link>
              )
            })}
            {items.length > MAX_TASKS && (
              <Link to="/followups" className="block px-4 py-2.5 text-xs text-center text-indigo-400 hover:text-indigo-300 transition-colors">
                +{items.length - MAX_TASKS} more
              </Link>
            )}
          </>
        )}
      </div>
    </section>
  )
}

/**
 * The newest activity, sharing /activity's row builder.
 *
 * Two things this used to get wrong. `ACTIVITY_TYPES.find(...) ?? ACTIVITY_TYPES[4]`
 * labelled any unrecognised type "Note" via a magic index, so a sixth type or
 * any reordering displayed a confidently wrong label. And a customer the name
 * lookup missed rendered as '…' — the loading placeholder — so a deleted record
 * looked like it was loading forever, while still linking to a record that
 * 404s. buildFeedRows answers both with an explicit `customerMissing` and a
 * nullable `typeLabel`.
 */
function ActivityTimelineCard({ rows, loading }: { rows: FeedRow[]; loading: boolean }) {
  return (
    <section className="h-full flex flex-col">
      <CardHeader title="Recent Activity" scope="now" to="/activity">
        {!loading && rows.length > 0 && <CountPill>{rows.length}</CountPill>}
      </CardHeader>
      <div className="card px-4 py-3 flex-1">
        {loading ? (
          <div className="space-y-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex gap-3 animate-pulse">
                <div className="w-7 h-7 rounded-full bg-gray-700 shrink-0" />
                <div className="flex-1 space-y-2 pt-0.5">
                  <div className="h-3 bg-gray-700 rounded w-40" />
                  <div className="h-3 bg-gray-700/60 rounded w-2/3" />
                </div>
              </div>
            ))}
          </div>
        ) : rows.length === 0 ? (
          <p className="text-sm text-gray-400 py-1">No activity logged yet</p>
        ) : (
          <div className="relative max-h-[420px] overflow-y-auto">
            {/* Was bg-gray-800 on a bg-gray-800 card, i.e. a spine at 1.000:1 */}
            <div className="absolute left-3.5 top-0 bottom-0 w-px bg-gray-500" aria-hidden="true" />
            <div className="space-y-0">
              {rows.map((r, idx) => {
                const isLast = idx === rows.length - 1
                const name = r.customerMissing ? 'Deleted record' : (r.customerName ?? '—')
                return (
                  <div key={r.id} className={`relative flex gap-3 ${isLast ? 'pb-0' : 'pb-4'}`}>
                    <div className="w-7 h-7 rounded-full bg-gray-700 border border-gray-500 flex items-center justify-center shrink-0 z-10">
                      {/* ACTIVITY_ICONS.call is already ICONS.phone, so the
                          hand-inlined phone SVG that used to live here existed
                          only to carry a colour class. */}
                      <Icon
                        d={ACTIVITY_ICONS[r.type] ?? ACTIVITY_ICONS.note}
                        className={`w-3.5 h-3.5 ${ACTIVITY_TINT[r.type] ?? 'text-gray-400'}`}
                      />
                    </div>
                    <div className="flex-1 min-w-0 pt-0.5">
                      <div className="flex items-baseline gap-1.5">
                        {r.customerMissing ? (
                          <span className="text-sm font-semibold text-gray-400 italic truncate min-w-0">{name}</span>
                        ) : (
                          <Link
                            to={`/records/${r.customerId}`}
                            className="text-sm font-semibold text-gray-100 hover:text-indigo-300 transition-colors truncate min-w-0"
                          >
                            {name}
                          </Link>
                        )}
                        {/* Was text-gray-700: 1.42:1 dark, 1.39:1 light — the
                            one field a timeline exists to show. */}
                        <span className="text-xs text-gray-400 ml-auto shrink-0">{timeAgo(r.createdAt)}</span>
                      </div>
                      <div className="flex items-baseline gap-1.5 mt-0.5 min-w-0">
                        <span className="text-xs text-gray-400 shrink-0">{r.typeLabel ?? r.type}</span>
                        <span className="text-xs text-gray-400 shrink-0">·</span>
                        <span className="text-xs text-gray-400 truncate" title={r.userName}>{r.userName}</span>
                      </div>
                      {r.note && (
                        <p className="text-xs text-gray-400 mt-0.5 line-clamp-2">{r.note}</p>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </section>
  )
}

function ListSection({
  title, items, loading, emptyMsg, viewAllTo,
}: {
  title: string
  items?: CustomerItem[]
  loading: boolean
  emptyMsg: string
  viewAllTo: string
}) {
  const coloredAvatars = usePrefStore(s => s.coloredAvatars)
  const preview = items ? items.slice(0, MAX_TASKS) : []
  return (
    <section>
      <CardHeader title={title} to={viewAllTo}>
        {items && items.length > 0 && <CountPill>{items.length}</CountPill>}
      </CardHeader>
      <div className="card divide-y divide-gray-700/50">
        {loading ? (
          <RowsSkeleton />
        ) : !items || items.length === 0 ? (
          <p className="px-4 py-3 text-sm text-gray-400">{emptyMsg}</p>
        ) : (
          <>
            {preview.map(c => {
              const row = recordRow(c, [c.city, c.state].filter(Boolean).join(', '))
              const color = coloredAvatars ? avatarColor(row.title) : avatarOriginal()
              return (
              <Link
                key={c.id}
                to={`/records/${c.id}`}
                className="flex items-center gap-3 px-4 py-3 hover:bg-gray-700/30 transition-colors"
              >
                <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ background: color.bg }}>
                  <span className="text-xs font-semibold" style={{ color: color.text }}>
                    {row.initials || '?'}
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-100 truncate">{row.title || '—'}</p>
                  {row.sub && <p className="text-xs text-gray-400 truncate">{row.sub}</p>}
                </div>
                {c.amount > 0 && (
                  <span className="text-sm font-semibold text-green-400 shrink-0">{formatCurrency(c.amount)}</span>
                )}
              </Link>
              )
            })}
            {items.length > MAX_TASKS && (
              <Link to={viewAllTo} className="block px-4 py-2.5 text-xs text-center text-indigo-400 hover:text-indigo-300 transition-colors">
                +{items.length - MAX_TASKS} more
              </Link>
            )}
          </>
        )}
      </div>
    </section>
  )
}

function SalesTodayCard({ items, loading, period }: { items?: SaleEntry[]; loading: boolean; period: SnapshotPeriod }) {
  const coloredAvatars = usePrefStore(s => s.coloredAvatars)
  const total = items?.reduce((s, e) => s + e.amount, 0) ?? 0
  const preview = items ? items.slice(0, MAX_TASKS) : []
  return (
    <section>
      {/* "Paid Invoices", not "Sales" — these rows are invoices with status
          'paid', which is a different measurement from the deal value that
          Goals and Lifetime Value both use. */}
      <CardHeader title={`Paid Invoices ${PERIOD_SUFFIX[period]}`} to="/invoices">
        {items && items.length > 0 && (
          <CountPill>
            <span title={`${fmtMoneyExact(total)} — ${MONEY_BASIS.invoiced}`}>{fmtMoneyCompact(total)}</span>
          </CountPill>
        )}
      </CardHeader>
      <div className="card divide-y divide-gray-700/50">
        {loading ? (
          <RowsSkeleton />
        ) : !items || items.length === 0 ? (
          <p className="px-4 py-3 text-sm text-gray-400">No paid invoices {PERIOD_PHRASE[period]}</p>
        ) : (
          <>
            {preview.map(entry => {
              const color = coloredAvatars ? avatarColor(entry.customerName) : avatarOriginal()
              const initial = entry.customerName.trim()[0]?.toUpperCase() || '?'
              return (
                <Link
                  key={entry.id}
                  to={`/invoices/${entry.id}`}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-gray-700/30 transition-colors"
                >
                  <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ background: color.bg }}>
                    <span className="text-xs font-semibold" style={{ color: color.text }}>{initial}</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-100 truncate">{entry.customerName || '—'}</p>
                    {entry.invoiceNumber && <p className="text-xs text-gray-400">{entry.invoiceNumber}</p>}
                  </div>
                  {entry.amount > 0 && (
                    <span className="text-sm font-semibold text-green-400 shrink-0">{formatCurrency(entry.amount)}</span>
                  )}
                </Link>
              )
            })}
            {items.length > MAX_TASKS && (
              <Link to="/invoices" className="block px-4 py-2.5 text-xs text-center text-indigo-400 hover:text-indigo-300 transition-colors">
                +{items.length - MAX_TASKS} more
              </Link>
            )}
          </>
        )}
      </div>
    </section>
  )
}

function GoalsCard({
  target, actual, hasTargets, range, period, loading,
}: {
  target: GoalValues
  actual: GoalValues
  hasTargets: boolean
  range: PeriodRange
  period: SnapshotPeriod
  loading: boolean
}) {
  const rows: { label: string; actual: number; target: number; barClass: string; format: (n: number) => string; basis?: string }[] = [
    { label: 'Revenue',   actual: actual.revenue,   target: target.revenue,   barClass: 'bg-green-500',  format: fmtMoneyExact, basis: MONEY_BASIS.dealValue },
    { label: 'Leads',     actual: actual.leads,     target: target.leads,     barClass: 'bg-indigo-500', format: n => n.toLocaleString() },
    { label: 'Customers', actual: actual.customers, target: target.customers, barClass: 'bg-violet-500', format: n => n.toLocaleString() },
  ]
  return (
    <section className="h-full flex flex-col">
      {/* The full period label, not just `range.short` ("Sep"). There are no
          daily targets, so the Today tab reports the month it sits inside and
          this heading is the only thing that says so. */}
      <CardHeader title={`Goals · ${range.label}`} to="/goals" />
      <div className="card p-4 space-y-3 flex-1">
        {loading ? (
          <LinesSkeleton />
        ) : !hasTargets ? (
          <p className="text-sm text-gray-400">No goals set for {range.label}</p>
        ) : (
          <>
            {period === 'today' && (
              <p className="text-xs text-gray-400">
                Targets are monthly — the Today tab reports progress through {range.label}.
              </p>
            )}
            {rows.map(r => {
              const pct = r.target > 0 ? Math.min(100, Math.round((r.actual / r.target) * 100)) : 0
              return (
                <div key={r.label}>
                  <div className="flex items-baseline justify-between mb-1 gap-2">
                    <span className="text-xs text-gray-400" title={r.basis}>{r.label}</span>
                    <span className="text-xs text-gray-300 text-right">
                      {r.format(r.actual)} <span className="text-gray-400">/ {r.format(r.target)}</span>
                    </span>
                  </div>
                  {/* meter-track: was bg-gray-800 on a bg-gray-800 card, so a
                      bar at 18% was a floating stub with no visible container
                      and the remaining 82% wasn't expressed at all. */}
                  <div
                    className="h-1.5 meter-track"
                    role="progressbar"
                    aria-label={`${r.label} goal`}
                    aria-valuenow={pct}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  >
                    <div className={`h-full ${r.barClass}`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              )
            })}
          </>
        )}
      </div>
    </section>
  )
}

function PipelineSummaryCard({ stages, counts, loading }: { stages: PipelineStageConfig[]; counts: Record<string, number>; loading: boolean }) {
  const total = stages.reduce((s, cfg) => s + (counts[cfg.id] ?? 0), 0)
  return (
    <section className="h-full flex flex-col">
      <CardHeader title="Pipeline" scope="now" to="/pipeline">
        {total > 0 && <CountPill>{total}</CountPill>}
      </CardHeader>
      <div className="card p-4 flex-1 flex flex-col justify-start">
        {loading ? (
          <LinesSkeleton bar lines={2} />
        ) : total === 0 ? (
          <p className="text-sm text-gray-400">No active leads or customers</p>
        ) : (
          <>
            <div className="flex h-2 meter-track">
              {stages.map(cfg => {
                const count = counts[cfg.id] ?? 0
                if (count === 0) return null
                return <div key={cfg.id} className={STAGE_COLOR_CLASSES[cfg.colorKey].bar} style={{ width: `${(count / total) * 100}%` }} />
              })}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-3">
              {stages.map(cfg => (
                <div key={cfg.id} className="flex items-center gap-1.5 text-xs">
                  <span className={`w-2 h-2 rounded-full ${STAGE_COLOR_CLASSES[cfg.colorKey].bar}`} />
                  <span className="text-gray-400">{cfg.label}</span>
                  <span className={`font-semibold ${STAGE_COLOR_CLASSES[cfg.colorKey].text}`}>{counts[cfg.id] ?? 0}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </section>
  )
}

function ProposalSummaryCard({ stats, loading }: {
  stats: { pendingValue: number; acceptedValue: number; winRate: number; sentCount: number }
  loading: boolean
}) {
  const hasData = stats.pendingValue > 0 || stats.acceptedValue > 0 || stats.sentCount > 0
  return (
    <section className="h-full flex flex-col">
      <CardHeader title="Proposals" scope="allTime" to="/proposals" />
      <div className="card p-4 flex-1 flex flex-col justify-start">
        {loading ? (
          <LinesSkeleton lines={2} />
        ) : !hasData ? (
          <p className="text-sm text-gray-400">No proposals yet</p>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-sm font-bold text-gray-100">{fmtProposalCurrency(stats.pendingValue)}</p>
              <p className="text-xs text-gray-400">Pending</p>
            </div>
            <div>
              <p className="text-sm font-bold text-green-400">{fmtProposalCurrency(stats.acceptedValue)}</p>
              <p className="text-xs text-gray-400">Accepted Value</p>
            </div>
            <div>
              {/* text-gray-100 like its three siblings — this one figure was
                  text-white, a different shade for no reason. */}
              <p className="text-sm font-bold text-gray-100">{stats.winRate}%</p>
              <p className="text-xs text-gray-400">Win Rate</p>
            </div>
            <div>
              <p className="text-sm font-bold text-gray-100">{stats.sentCount}</p>
              <p className="text-xs text-gray-400">Awaiting Response</p>
            </div>
          </div>
        )}
      </div>
    </section>
  )
}

function JobsPipelineSummaryCard({ counts, loading }: { counts: Record<JobStage, number>; loading: boolean }) {
  const total = JOB_STAGE_CONFIG.reduce((s, cfg) => s + counts[cfg.id], 0)
  return (
    <section className="h-full flex flex-col">
      <CardHeader title="Jobs Pipeline" scope="now" to="/jobs">
        {total > 0 && <CountPill>{total}</CountPill>}
      </CardHeader>
      <div className="card p-4 flex-1 flex flex-col justify-start">
        {loading ? (
          <LinesSkeleton bar lines={2} />
        ) : total === 0 ? (
          <p className="text-sm text-gray-400">No customer jobs on file</p>
        ) : (
          <>
            <div className="flex h-2 meter-track">
              {JOB_STAGE_CONFIG.map(cfg => {
                const count = counts[cfg.id]
                if (count === 0) return null
                return <div key={cfg.id} className={cfg.barClass} style={{ width: `${(count / total) * 100}%` }} />
              })}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-3">
              {JOB_STAGE_CONFIG.map(cfg => (
                <div key={cfg.id} className="flex items-center gap-1.5 text-xs">
                  <span className={`w-2 h-2 rounded-full ${cfg.barClass}`} />
                  <span className="text-gray-400">{cfg.label}</span>
                  <span className={`font-semibold ${cfg.colorClass}`}>{counts[cfg.id]}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </section>
  )
}

function TopPerformerCard({
  performer, label, rangeLabel, loading,
}: {
  performer: RepStats | null
  label: string
  rangeLabel: string
  loading: boolean
}) {
  return (
    <section className="h-full flex flex-col">
      {/* Follows the period tabs now; it was hardcoded to the current month
          whatever the tabs said. */}
      <CardHeader title={`Top ${label} · ${rangeLabel}`} to="/leaderboard" />
      <div className="card p-4 flex-1">
        {loading ? (
          <LinesSkeleton lines={1} />
        ) : !performer ? (
          <p className="text-sm text-gray-400">No sales recorded in this period</p>
        ) : (
          <div className="flex items-center gap-3">
            <Icon d={ICONS.trophy} className="w-6 h-6 shrink-0 text-yellow-400" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-gray-100 truncate">{performer.name}</p>
              <p className="text-xs text-gray-400">{performer.customers} sale{performer.customers === 1 ? '' : 's'}</p>
            </div>
            <span
              className="text-base font-bold text-green-400 shrink-0"
              title={`${fmtMoneyExact(performer.revenue)} — ${MONEY_BASIS.dealValue}`}
            >
              {fmtMoneyCompact(performer.revenue)}
            </span>
          </div>
        )}
      </div>
    </section>
  )
}

function UpcomingAppointmentsCard({ items, loading }: { items: CustomerItem[]; loading: boolean }) {
  const preview = items.slice(0, MAX_TASKS)
  return (
    <section>
      <CardHeader title={`Upcoming Appointments · next ${UPCOMING_WINDOW_DAYS} days`} scope="now" to="/calendar">
        {items.length > 0 && <CountPill>{items.length}</CountPill>}
      </CardHeader>
      <div className="card divide-y divide-gray-700/50">
        {loading ? (
          <RowsSkeleton />
        ) : items.length === 0 ? (
          <p className="px-4 py-3 text-sm text-gray-400">No appointments in the next {UPCOMING_WINDOW_DAYS} days</p>
        ) : (
          <>
            {preview.map(c => {
              const row = recordRow(c, c.phone)
              return (
              <Link
                key={c.id}
                to={`/records/${c.id}`}
                className="flex items-center gap-3 px-4 py-3 hover:bg-gray-700/30 transition-colors"
              >
                {/* Icon rather than 📅, for the same reason as the bell above */}
                <Icon d={ICONS.calendar} className="w-4 h-4 shrink-0 text-gray-400" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-100 truncate">{row.title || '—'}</p>
                  {row.sub && <p className="text-xs text-gray-400 truncate">{row.sub}</p>}
                </div>
                <span className="text-xs font-semibold text-gray-300 shrink-0">
                  {c.startDate!.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </span>
              </Link>
              )
            })}
            {items.length > MAX_TASKS && (
              <Link to="/calendar" className="block px-4 py-2.5 text-xs text-center text-indigo-400 hover:text-indigo-300 transition-colors">
                +{items.length - MAX_TASKS} more
              </Link>
            )}
          </>
        )}
      </div>
    </section>
  )
}
