import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { getDoc, doc } from 'firebase/firestore'
import { db } from '../firebase/config'
import { usePageTitle } from '../hooks/usePageTitle'
import { fetchSnapshot, type SnapshotData, type SaleEntry, type SnapshotPeriod } from '../services/snapshotService'
import { formatCurrency, fullName, displayName, categoryMatches } from '../models/customer'
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
import { ACTIVITY_TYPES, type Activity } from '../models/activity'
import { type GoalDoc, type GoalValues, type PeriodRange, emptyGoalValues, currentPeriodRange } from '../models/goal'
import { endOfToday } from '../models/pipeline'
import { type JobStage, JOB_STAGE_CONFIG, getJobStage } from '../models/jobPipeline'
import { subscribeToPipelineStages } from '../services/pipelineStageService'
import { DEFAULT_STAGES, STAGE_COLOR_CLASSES, effectiveStageId, type PipelineStageConfig } from '../models/pipelineStage'
import { subscribeToProposals } from '../services/proposalService'
import {
  effectiveStatus as proposalEffectiveStatus, proposalTotal, fmtCurrency as fmtProposalCurrency,
  type Proposal,
} from '../models/proposal'
import { useAuthStore } from '../stores/authStore'
import type { Todo } from '../models/todo'
import type { Expense } from '../models/expense'
import type { CustomerItem } from '../models/customer'
import { dueMeta, isOverdue } from '../utils/dueDate'
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
const UPCOMING_WINDOW_DAYS = 7

function fmtCompact(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(1)}K`
  return `$${n.toLocaleString()}`
}

const CHART_ENTRIES = (data: SnapshotData) => [
  { label: 'Leads',    count: data.leadsToday.length,         color: '#6366f1' },
  { label: 'Appts',   count: data.appointmentsToday.length,  color: '#f97316' },
  { label: 'Customer',count: data.customersToday.length,     color: '#818cf8' },
  { label: 'Jobs',    count: data.jobsStartingToday.length,  color: '#14b8a6' },
]

function todayLabel() {
  return new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
}

const PERIODS: SnapshotPeriod[] = ['today', 'month', 'year']

const PERIOD_TABS: Record<SnapshotPeriod, string> = { today: 'Today', month: 'Month', year: 'Year' }

// Three phrasings of the selected period: the standalone heading ("Month"),
// a title suffix ("Leads This Month") and an empty-state phrase ("no leads
// this month"). The printout adds a fourth ("Monthly Snapshot").
const PERIOD_SUFFIX: Record<SnapshotPeriod, string> = { today: 'Today', month: 'This Month', year: 'This Year' }
const PERIOD_PHRASE: Record<SnapshotPeriod, string> = { today: 'today', month: 'this month', year: 'this year' }
const PERIOD_TITLE:  Record<SnapshotPeriod, string> = { today: 'Daily', month: 'Monthly', year: 'Yearly' }

export default function DashboardPage() {
  usePageTitle('Dashboard')
  const [period, setPeriod] = useState<SnapshotPeriod>('today')
  const [data, setData] = useState<SnapshotData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [today, setToday] = useState(todayLabel)
  const [todos, setTodos] = useState<Todo[]>([])
  const [todosLoading, setTodosLoading] = useState(true)
  const [expensesToday, setExpensesToday] = useState<Expense[]>([])
  const [expensesLoading, setExpensesLoading] = useState(true)
  const [followUps, setFollowUps] = useState<CustomerItem[]>([])
  const [followUpsLoading, setFollowUpsLoading] = useState(true)
  const [followUpsError, setFollowUpsError] = useState<string | null>(null)
  const [activities, setActivities] = useState<Activity[]>([])
  const [activityNameMap, setActivityNameMap] = useState<Map<string, string>>(new Map())
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
    setToday(todayLabel())
    try {
      setData(await fetchSnapshot(period))
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
    const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0)
    const range = period === 'today'
      ? { start: dayStart, end: endOfToday() }
      : currentPeriodRange(period)
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

  useEffect(() => subscribeToPipelineStages(setPipelineStages, () => {}), [companyId])

  useEffect(() => {
    if (!user) { setProposalsLoading(false); return }
    const unsub = subscribeToProposals(
      items => { setProposals(items); setProposalsLoading(false) },
      ()    => setProposalsLoading(false),
    )
    return unsub
  }, [user, companyId])

  useEffect(() => { getGoals().then(setGoals) }, [])

  useEffect(() => {
    if (!user) { setActivitiesLoading(false); return }
    const unsub = subscribeToAllActivities(
      items => { setActivities(items.slice(0, ACTIVITY_PREVIEW)); setActivitiesLoading(false) },
      ()    => setActivitiesLoading(false),
    )
    return unsub
  }, [user, companyId])

  // Resolve customer names for the preview entries via individual doc reads
  useEffect(() => {
    if (activities.length === 0) return
    const ids = [...new Set(activities.map(a => a.customerId))]
    Promise.all(ids.map(async id => {
      try {
        const snap = await getDoc(doc(db, 'Customers', id))
        if (!snap.exists()) return null
        const d = snap.data() as Record<string, unknown>
        const person  = `${d.first ?? ''} ${d.lastname ?? ''}`.trim()
        const company = typeof d.companyName === 'string' ? d.companyName.trim() : ''
        return [id, company || person || '—'] as [string, string]
      } catch { return null }
    })).then(results => {
      const map = new Map<string, string>()
      for (const r of results) if (r) map.set(r[0], r[1])
      setActivityNameMap(map)
    })
  }, [activities])

  const salesTotal = data?.salesToday.reduce((s, c) => s + c.amount, 0) ?? 0
  const chartEntries = data ? CHART_ENTRIES(data) : null

  const monthRange = useMemo(() => currentPeriodRange('month'), [])

  // Subtitle for the selected tab: today's date, "September 2026" or "2026".
  const periodDateLabel = period === 'today' ? today : currentPeriodRange(period).label

  const monthActuals = useMemo<GoalValues>(() => {
    const inPeriod = allCustomers.filter(c =>
      c.creationDate.getTime() >= monthRange.start.getTime() &&
      c.creationDate.getTime() <= monthRange.end.getTime()
    )
    return {
      revenue:   inPeriod.reduce((s, c) => s + (categoryMatches(c.category, 'Customer') ? c.amount : 0), 0),
      leads:     inPeriod.filter(c => categoryMatches(c.category, 'Lead')).length,
      customers: inPeriod.filter(c => categoryMatches(c.category, 'Customer')).length,
    }
  }, [allCustomers, monthRange])

  const stageCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const s of pipelineStages) counts[s.id] = 0
    for (const c of allCustomers) {
      if (!(categoryMatches(c.category, 'Lead') || categoryMatches(c.category, 'Customer'))) continue
      const id = effectiveStageId(c, pipelineStages)
      counts[id] = (counts[id] ?? 0) + 1
    }
    return counts
  }, [allCustomers, pipelineStages])

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

  const topPerformer = useMemo(() => {
    const inPeriod = allCustomers.filter(c =>
      categoryMatches(c.category, 'Customer') &&
      c.creationDate.getTime() >= monthRange.start.getTime() &&
      c.creationDate.getTime() <= monthRange.end.getTime()
    )
    const map = new Map<string, { revenue: number; customers: number }>()
    for (const c of inPeriod) {
      const name = c.salesman.trim() || 'Unassigned'
      const row  = map.get(name) ?? { revenue: 0, customers: 0 }
      row.revenue += c.amount
      row.customers++
      map.set(name, row)
    }
    const ranked = [...map.entries()]
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.revenue - a.revenue)
    return ranked[0] ?? null
  }, [allCustomers, monthRange])

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

  const appointmentsTodayCount = useMemo(() => {
    const start = new Date(); start.setHours(0, 0, 0, 0)
    const end = new Date(start.getTime() + 86_400_000)
    return allCustomers.filter(c => c.isActive && c.startDate && c.startDate >= start && c.startDate < end).length
  }, [allCustomers])

  // One formatter for one metric. The mobile card used fmtCompact and the sm+
  // card formatCurrency on the same figure, so resizing the window turned
  // $12,480.00 into $12.5k. fmtCompact wins because it's what the Sales card
  // beside it already uses, and it fits the 3-column mobile grid.
  const expensesTotal = useMemo(
    () => expensesToday.reduce((sum, e) => sum + e.amount, 0),
    [expensesToday],
  )

  const upcomingAppointments = useMemo(() => {
    const startBound = endOfToday()
    const endBound = new Date(startBound.getTime() + UPCOMING_WINDOW_DAYS * 86_400_000)
    return allCustomers
      .filter(c => c.isActive && c.startDate && c.startDate > startBound && c.startDate <= endBound)
      .sort((a, b) => a.startDate!.getTime() - b.startDate!.getTime())
  }, [allCustomers])

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

    const todayTable = buildTable(
      ['', 'Leads', 'Appts', 'Customers', 'Sales', 'Jobs', 'Expenses'],
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
      ['', 'Active Leads', 'Active Customers', 'Active Tasks', 'Open Follow-ups', 'Total Sales'],
      [['Overall',
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

    const goalTarget = goals?.month ?? emptyGoalValues()
    const goalHasTargets = goalTarget.revenue > 0 || goalTarget.leads > 0 || goalTarget.customers > 0
    const goalRows: { label: string; actual: number; target: number; format: (n: number) => string }[] = [
      { label: 'Revenue',   actual: monthActuals.revenue,   target: goalTarget.revenue,   format: formatCurrency },
      { label: 'Leads',     actual: monthActuals.leads,     target: goalTarget.leads,     format: n => n.toLocaleString() },
      { label: 'Customers', actual: monthActuals.customers, target: goalTarget.customers, format: n => n.toLocaleString() },
    ]
    const goalsSect = goalHasTargets ? section(
      `Goals — ${monthRange.short}`, '',
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

    const topPerformerSect = topPerformer ? section(
      `Top ${salesmanLabel} This Month`, formatCurrency(topPerformer.revenue),
      buildTable(
        ['Name', 'Sales', 'Revenue'],
        [[topPerformer.name, String(topPerformer.customers), formatCurrency(topPerformer.revenue)]],
      )
    ) : ''

    const upcomingSect = upcomingAppointments.length ? section(
      'Upcoming Appointments', String(upcomingAppointments.length),
      buildTable(
        ['Name', 'Phone', 'Appt Date'],
        upcomingAppointments.map(c => [
          nameCell(c), c.phone, c.startDate ? fmtDate(c.startDate) : '',
        ]),
      )
    ) : ''

    const activitySect = activities.length ? section(
      'Recent Activity', String(activities.length),
      buildTable(
        ['Customer', 'Type', 'User', 'When'],
        activities.map(a => {
          const meta = ACTIVITY_TYPES.find(t => t.value === a.type) ?? ACTIVITY_TYPES[4]
          return [
            activityNameMap.get(a.customerId) ?? '—',
            meta.label,
            a.userName,
            fmtDate(a.createdAt),
          ]
        }),
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
  <p class="sub">${period === 'today' ? dateStr : periodDateLabel}</p>

  <div class="summary-section">
    <div class="summary-label">${PERIOD_TABS[period]}</div>
    ${todayTable}
  </div>

  <div class="summary-section" style="margin-top:14px;">
    <div class="summary-label">Overall</div>
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
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Snapshot</h1>
          <p className="text-sm text-gray-400 mt-0.5">{periodDateLabel}</p>
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

      {/* Period tabs — drive every "today"/"this month" figure below */}
      <div className="flex gap-1.5" role="tablist" aria-label="Snapshot period">
        {PERIODS.map(p => (
          <button
            key={p}
            role="tab"
            aria-selected={period === p}
            onClick={() => setPeriod(p)}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors whitespace-nowrap ${
              period === p ? 'bg-indigo-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-gray-200'
            }`}
          >
            {PERIOD_TABS[p]}
          </button>
        ))}
      </div>

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

      {/* Today / Month stat strip */}
      <section>
        <p className="section-header">{PERIOD_TABS[period]}</p>
        {/* Mobile: two rows of 3; sm+: single row of 6 */}
        <div className="sm:hidden space-y-2">
          <div className="grid grid-cols-3 gap-2">
            <StatCard title="Leads"    value={String(data?.leadsToday.length ?? 0)} loading={loading} />
            <StatCard title="Appts"    value={String(data?.appointmentsToday.length ?? 0)} loading={loading} />
            <StatCard title="Customer" value={String(data?.customersToday.length ?? 0)} loading={loading} />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <StatCard title="Jobs"     value={String(data?.jobsStartingToday.length ?? 0)}   loading={loading} />
            <StatCard title="Expense"  value={fmtCompact(expensesTotal)} loading={expensesLoading} to="/expenses" />
            <StatCard title="Sales"    value={fmtCompact(salesTotal)}  loading={loading} />
          </div>
        </div>
        <div className="hidden sm:grid gap-2" style={{ gridTemplateColumns: 'repeat(5, 1fr) 1.4fr' }}>
          <StatCard title="Leads"    value={String(data?.leadsToday.length ?? 0)} loading={loading} />
          <StatCard title="Appts"    value={String(data?.appointmentsToday.length ?? 0)} loading={loading} />
          <StatCard title="Customer" value={String(data?.customersToday.length ?? 0)} loading={loading} />
          <StatCard title="Jobs"     value={String(data?.jobsStartingToday.length ?? 0)}   loading={loading} />
          <StatCard title="Expense"  value={fmtCompact(expensesTotal)} loading={expensesLoading} to="/expenses" />
          <StatCard title="Sales"    value={fmtCompact(salesTotal)}  loading={loading} />
        </div>
      </section>

      {/* All-time totals — reference, not triage: these never change day to day. */}
      <CollapsibleSection title="Overall totals">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
          <StatCard title="Active Leads"     value={String(data?.activeLeadCount ?? 0)} loading={loading} />
          <StatCard title="Active Customers" value={String(data?.activeCustomerCount ?? 0)} loading={loading} />
          <StatCard title="Active Tasks"     value={String(todos.length)} loading={todosLoading} to="/todo" />
          <StatCard title="Total Sales"      value={formatCurrency(data?.totalCustomerSales ?? 0)}  loading={loading} />
          <StatCard title="Unread Chats"     value={String(unreadChats)}    loading={false} to="/chat" />
        </div>
      </CollapsibleSection>

      {/* Goals / Pipeline / Proposals / Jobs Pipeline */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        <GoalsCard goals={goals} actuals={monthActuals} range={monthRange} loading={allCustomersLoading} />
        <PipelineSummaryCard stages={pipelineStages} counts={stageCounts} loading={allCustomersLoading} />
        <ProposalSummaryCard stats={proposalStats} loading={proposalsLoading} />
        <JobsPipelineSummaryCard counts={jobStageCounts} loading={allCustomersLoading} />
      </div>

      {/* Bar chart — hidden when loading or all values are zero */}
      {!loading && chartEntries && chartEntries.some(e => e.count > 0) && (
        <section className="card p-4">
          <button
            onClick={() => setChartOpen(v => !v)}
            className="w-full flex items-center justify-between text-left"
          >
            <p className="text-xs font-semibold text-gray-400">{PERIOD_TABS[period]} at a Glance</p>
            <svg
              className={`w-4 h-4 text-gray-400 transition-transform ${chartOpen ? 'rotate-180' : ''}`}
              fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="m19 9-7 7-7-7" />
            </svg>
          </button>
          {chartOpen && (
            <div className="mt-3">
              <Suspense fallback={<div className="h-[140px] rounded-lg bg-gray-800 animate-pulse" />}>
                <SnapshotChart entries={chartEntries} />
              </Suspense>
            </div>
          )}
        </section>
      )}

      {/* Tasks / Follow-ups / Recent Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <TasksCard todos={todos} loading={todosLoading} />
        <FollowUpsCard items={followUps} loading={followUpsLoading} error={followUpsError} />
        <ActivityTimelineCard
          activities={activities}
          nameMap={activityNameMap}
          loading={activitiesLoading}
        />
      </div>

      {/* Top performer / Upcoming appointments */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <TopPerformerCard performer={topPerformer} label={salesmanLabel} loading={allCustomersLoading} />
        <UpcomingAppointmentsCard items={upcomingAppointments} loading={allCustomersLoading} />
      </div>

      {/* Expenses */}
      <ExpensesTodayCard expenses={expensesToday} loading={expensesLoading} period={period} />

      {/* Browsable record lists — reference material behind one heading, so
          they stop competing with the triage block and the period figures. */}
      <CollapsibleSection title={`Records ${PERIOD_SUFFIX[period]}`}>
      {/* Leads */}
      <ListSection
        title={`Leads ${PERIOD_SUFFIX[period]}`}
        items={data?.leadsToday} loading={loading} emptyMsg={`No leads ${PERIOD_PHRASE[period]}`} viewAllTo="/leads"
      />

      {/* Appointments */}
      <ListSection
        title={`Appointments ${PERIOD_SUFFIX[period]}`}
        items={data?.appointmentsToday} loading={loading} emptyMsg={`No appointments ${PERIOD_PHRASE[period]}`} viewAllTo="/calendar"
      />

      {/* Customers */}
      <ListSection
        title={`Customers ${PERIOD_SUFFIX[period]}`}
        items={data?.customersToday} loading={loading} emptyMsg={`No customers ${PERIOD_PHRASE[period]}`} viewAllTo="/customers"
      />

      {/* Sales */}
      <SalesTodayCard items={data?.salesToday} loading={loading} period={period} />

      {/* Jobs */}
      <ListSection
        title="Jobs in Progress"
        items={data?.jobsStartingToday} loading={loading} emptyMsg={`No jobs starting ${PERIOD_PHRASE[period]}`} viewAllTo="/jobs"
      />
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
  const items = [
    { count: overdueFollowUps, label: 'overdue follow-up',  to: '/customers', urgent: true },
    { count: overdueTasks,     label: 'overdue task',       to: '/todo',      urgent: true },
    { count: appointmentsToday, label: 'appointment today', to: '/calendar',  urgent: false },
    { count: unreadChats,      label: 'unread message',     to: '/chat',      urgent: false },
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
  // "nothing needs you" is itself the answer the page exists to give.
  if (items.length === 0) {
    return (
      <section className="card p-4 flex items-center gap-2.5">
        <svg className="w-5 h-5 text-green-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
        </svg>
        <p className="text-sm font-medium text-gray-100">You&rsquo;re all caught up</p>
        <p className="text-sm text-gray-400">No overdue work, appointments or unread messages.</p>
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
            className={`flex items-baseline gap-2 px-3 py-2 rounded-lg border transition-colors ${
              i.urgent
                ? 'bg-red-500/10 border-red-500/40 hover:bg-red-500/20'
                : 'bg-gray-800 border-gray-700 hover:bg-gray-700/60'
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
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <p className="section-header mb-0">Tasks · active</p>
          {todos.length > 0 && (
            <span className="text-xs font-semibold text-gray-200 px-2 py-0.5 rounded-full bg-gray-700 tabular-nums">
              {todos.length}
            </span>
          )}
        </div>
        <Link to="/todo" className="inline-flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300 transition-colors">
          View all
          <Icon d={ICONS.arrowRight} className="w-3 h-3" />
        </Link>
      </div>
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
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <p className="section-header mb-0">Expenses {PERIOD_SUFFIX[period]}</p>
          {expenses.length > 0 && (
            <span className="text-xs font-semibold text-white px-2 py-0.5 rounded-full bg-amber-600">
              {formatCurrency(total)}
            </span>
          )}
        </div>
        <Link to="/expenses" className="inline-flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300 transition-colors">
          View all
          <Icon d={ICONS.arrowRight} className="w-3 h-3" />
        </Link>
      </div>
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
    <section className="h-full flex flex-col">
      <div className="flex items-center gap-2 mb-2">
        <p className="section-header mb-0">Follow-ups · scheduled</p>
        {overdueOrToday.length > 0 && (
          <span className="text-xs font-semibold text-white px-2 py-0.5 rounded-full bg-red-600">
            {overdueOrToday.length} due
          </span>
        )}
        {upcoming.length > 0 && (
          <span className="text-xs font-semibold text-white px-2 py-0.5 rounded-full bg-slate-600">
            +{upcoming.length} upcoming
          </span>
        )}
      </div>
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
              const label = followUpLabel(c.followUpDate!)
              const row = recordRow(c, c.phone)
              return (
                <Link
                  key={c.id}
                  to={`/records/${c.id}`}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-gray-700/30 transition-colors"
                >
                  <span className="text-base shrink-0">🔔</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-100 truncate">{row.title || '—'}</p>
                    {row.sub && <p className="text-xs text-gray-400 truncate">{row.sub}</p>}
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
          </>
        )}
      </div>
    </section>
  )
}

function timeAgo(d: Date): string {
  const diff = Date.now() - d.getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 1)   return 'Just now'
  if (mins < 60)  return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24)   return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 7)   return `${days}d ago`
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function ActivityTimelineCard({
  activities,
  nameMap,
  loading,
}: {
  activities: Activity[]
  nameMap: Map<string, string>
  loading: boolean
}) {
  return (
    <section className="h-full flex flex-col">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <p className="section-header mb-0">Recent Activity</p>
          {!loading && activities.length > 0 && (
            <span className="text-xs font-semibold text-white px-2 py-0.5 rounded-full bg-sky-600">
              {activities.length}
            </span>
          )}
        </div>
        <Link to="/activity" className="inline-flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300 transition-colors">
          View all
          <Icon d={ICONS.arrowRight} className="w-3 h-3" />
        </Link>
      </div>
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
        ) : activities.length === 0 ? (
          <p className="text-sm text-gray-400 py-1">No activity logged yet</p>
        ) : (
          <div className="relative max-h-[420px] overflow-y-auto">
            <div className="absolute left-3.5 top-0 bottom-0 w-px bg-gray-800" aria-hidden="true" />
            <div className="space-y-0">
              {activities.map((a, idx) => {
                const meta = ACTIVITY_TYPES.find(t => t.value === a.type) ?? ACTIVITY_TYPES[4]
                const customerName = nameMap.get(a.customerId) ?? '…'
                const isLast = idx === activities.length - 1
                return (
                  <div key={a.id} className={`relative flex gap-3 ${isLast ? 'pb-0' : 'pb-4'}`}>
                    <div className="w-7 h-7 rounded-full bg-gray-800 border border-gray-700 flex items-center justify-center shrink-0 z-10">
                      {a.type === 'call' ? (
                        // Emoji glyphs can't be tinted, so calls use a currentColor SVG phone
                        <svg
                          className="w-3.5 h-3.5 text-green-400"
                          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                          aria-hidden="true"
                        >
                          <path
                            strokeLinecap="round" strokeLinejoin="round"
                            d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 0 0 2.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 0 1-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.94 3.102a1.125 1.125 0 0 0-1.091-.852H4.5A2.25 2.25 0 0 0 2.25 4.5v2.25Z"
                          />
                        </svg>
                      ) : (
                        <Icon d={ACTIVITY_ICONS[a.type] ?? ACTIVITY_ICONS.note} className="w-3.5 h-3.5 text-gray-400" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0 pt-0.5">
                      <div className="flex items-baseline gap-1.5">
                        <Link
                          to={`/records/${a.customerId}`}
                          className="text-sm font-semibold text-gray-100 hover:text-indigo-300 transition-colors truncate min-w-0"
                        >
                          {customerName}
                        </Link>
                        <span className="text-xs text-gray-700 ml-auto shrink-0">{timeAgo(a.createdAt)}</span>
                      </div>
                      <div className="flex items-baseline gap-1.5 mt-0.5 min-w-0">
                        <span className="text-xs text-gray-400 shrink-0">{meta.label}</span>
                        <span className="text-xs text-gray-400 shrink-0">·</span>
                        <span className="text-xs text-gray-400 truncate" title={a.userName}>{a.userName}</span>
                      </div>
                      {a.note && (
                        <p className="text-xs text-gray-400 mt-0.5 line-clamp-2">{a.note}</p>
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
      <div className="flex items-center gap-2 mb-2">
        <p className="section-header mb-0">{title}</p>
        {items && items.length > 0 && (
          <span className="text-xs font-semibold text-gray-200 px-2 py-0.5 rounded-full bg-gray-700 tabular-nums">
            {items.length}
          </span>
        )}
      </div>
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
      <div className="flex items-center gap-2 mb-2">
        <p className="section-header mb-0">Sales {PERIOD_SUFFIX[period]}</p>
        {items && items.length > 0 && (
          <span className="text-xs font-semibold text-white px-2 py-0.5 rounded-full bg-green-600">
            {formatCurrency(total)}
          </span>
        )}
      </div>
      <div className="card divide-y divide-gray-700/50">
        {loading ? (
          <RowsSkeleton />
        ) : !items || items.length === 0 ? (
          <p className="px-4 py-3 text-sm text-gray-400">No sales {PERIOD_PHRASE[period]}</p>
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
  goals, actuals, range, loading,
}: {
  goals: GoalDoc | null
  actuals: GoalValues
  range: PeriodRange
  loading: boolean
}) {
  const target = goals?.month ?? emptyGoalValues()
  const hasTargets = target.revenue > 0 || target.leads > 0 || target.customers > 0
  const rows: { label: string; actual: number; target: number; barClass: string; format: (n: number) => string }[] = [
    { label: 'Revenue',   actual: actuals.revenue,   target: target.revenue,   barClass: 'bg-green-500',  format: formatCurrency },
    { label: 'Leads',     actual: actuals.leads,     target: target.leads,     barClass: 'bg-indigo-500', format: n => n.toLocaleString() },
    { label: 'Customers', actual: actuals.customers, target: target.customers, barClass: 'bg-violet-500', format: n => n.toLocaleString() },
  ]
  return (
    <section className="h-full flex flex-col">
      <div className="flex items-center justify-between mb-2">
        <p className="section-header mb-0">Goals · {range.short}</p>
        <Link to="/goals" className="inline-flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300 transition-colors">
          View all
          <Icon d={ICONS.arrowRight} className="w-3 h-3" />
        </Link>
      </div>
      <div className="card p-4 space-y-3 flex-1">
        {loading ? (
          <LinesSkeleton />
        ) : !hasTargets ? (
          <p className="text-sm text-gray-400">No goals set for this month</p>
        ) : (
          rows.map(r => {
            const pct = r.target > 0 ? Math.min(100, Math.round((r.actual / r.target) * 100)) : 0
            return (
              <div key={r.label}>
                <div className="flex items-baseline justify-between mb-1">
                  <span className="text-xs text-gray-400">{r.label}</span>
                  <span className="text-xs text-gray-300">
                    {r.format(r.actual)} <span className="text-gray-400">/ {r.format(r.target)}</span>
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-gray-800 overflow-hidden">
                  <div className={`h-full ${r.barClass}`} style={{ width: `${pct}%` }} />
                </div>
              </div>
            )
          })
        )}
      </div>
    </section>
  )
}

function PipelineSummaryCard({ stages, counts, loading }: { stages: PipelineStageConfig[]; counts: Record<string, number>; loading: boolean }) {
  const total = stages.reduce((s, cfg) => s + (counts[cfg.id] ?? 0), 0)
  return (
    <section className="h-full flex flex-col">
      <div className="flex items-center justify-between mb-2">
        <p className="section-header mb-0">Pipeline · current</p>
        <Link to="/pipeline" className="inline-flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300 transition-colors">
          View all
          <Icon d={ICONS.arrowRight} className="w-3 h-3" />
        </Link>
      </div>
      <div className="card p-4 flex-1 flex flex-col justify-start">
        {loading ? (
          <LinesSkeleton bar lines={2} />
        ) : total === 0 ? (
          <p className="text-sm text-gray-400">No active leads or customers</p>
        ) : (
          <>
            <div className="flex h-2 rounded-full overflow-hidden bg-gray-800">
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
      <div className="flex items-center justify-between mb-2">
        <p className="section-header mb-0">Proposals · all time</p>
        <Link to="/proposals" className="inline-flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300 transition-colors">
          View all
          <Icon d={ICONS.arrowRight} className="w-3 h-3" />
        </Link>
      </div>
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
              <p className="text-sm font-bold text-white">{stats.winRate}%</p>
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
      <div className="flex items-center justify-between mb-2">
        <p className="section-header mb-0">Jobs Pipeline · current</p>
        <Link to="/jobs" className="inline-flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300 transition-colors">
          View all
          <Icon d={ICONS.arrowRight} className="w-3 h-3" />
        </Link>
      </div>
      <div className="card p-4 flex-1 flex flex-col justify-start">
        {loading ? (
          <LinesSkeleton bar lines={2} />
        ) : total === 0 ? (
          <p className="text-sm text-gray-400">No customer jobs on file</p>
        ) : (
          <>
            <div className="flex h-2 rounded-full overflow-hidden bg-gray-800">
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
  performer, label, loading,
}: {
  performer: { name: string; revenue: number; customers: number } | null
  label: string
  loading: boolean
}) {
  return (
    <section>
      <div className="flex items-center justify-between mb-2">
        <p className="section-header mb-0">Top {label} This Month</p>
        <Link to="/leaderboard" className="inline-flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300 transition-colors">
          View all
          <Icon d={ICONS.arrowRight} className="w-3 h-3" />
        </Link>
      </div>
      <div className="card p-4">
        {loading ? (
          <LinesSkeleton lines={1} />
        ) : !performer ? (
          <p className="text-sm text-gray-400">No sales recorded this month</p>
        ) : (
          <div className="flex items-center gap-3">
            <Icon d={ICONS.trophy} className="w-6 h-6 shrink-0 text-yellow-400" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-gray-100 truncate">{performer.name}</p>
              <p className="text-xs text-gray-400">{performer.customers} sale{performer.customers === 1 ? '' : 's'}</p>
            </div>
            <span className="text-base font-bold text-green-400 shrink-0">{formatCurrency(performer.revenue)}</span>
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
      <div className="flex items-center gap-2 mb-2">
        <p className="section-header mb-0">Upcoming Appointments · next {UPCOMING_WINDOW_DAYS}d</p>
        {items.length > 0 && (
          <span className="text-xs font-semibold text-white px-2 py-0.5 rounded-full bg-orange-600">
            {items.length}
          </span>
        )}
      </div>
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
                <span className="text-base shrink-0">📅</span>
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
