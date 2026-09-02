import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { usePageTitle } from '../../hooks/usePageTitle'
import { useToast } from '../../components/Toast'
import { usePermissions } from '../../hooks/usePermissions'
import { useSharedCustomers } from '../../hooks/useSharedCustomers'
import { categoryMatches, fullName } from '../../models/customer'
import { subscribeToTeam, compareMembers, type TeamMember } from '../../services/teamService'
import { subscribeToServiceRequests } from '../../services/serviceRequestService'
import { isFirstContactBreached, STATUS_LABELS as REQUEST_STATUS_LABELS, type ServiceRequest } from '../../models/serviceRequest'
import { subscribeToServicePlans } from '../../services/servicePlanService'
import type { ServicePlan } from '../../models/servicePlan'
import {
  subscribeToAssignments, createAssignment, moveAssignment, updateAssignmentStatus, deleteAssignment,
} from '../../services/dispatchService'
import {
  getWeekStart, getWeekDays, dayIndexInWeek,
  type DispatchAssignment, type DispatchSourceType, type DispatchStatus,
} from '../../models/dispatchAssignment'
import PipelineJobsTabs from '../../components/PipelineJobsTabs'
import { subscribeToCompanyProfile, saveCompanyProfile, EMPTY_PROFILE, type CompanyProfile } from '../../services/companyProfileService'

const DAY_MS = 86_400_000

const SOURCE_BADGE: Record<DispatchSourceType, { label: string; className: string }> = {
  job:            { label: 'Job',     className: 'bg-teal-900/40 text-teal-300' },
  serviceRequest: { label: 'Request', className: 'bg-amber-900/40 text-amber-300' },
  servicePlan:    { label: 'Plan',    className: 'bg-indigo-900/40 text-indigo-300' },
}

const STATUS_DOT: Record<DispatchStatus, string> = {
  scheduled:   'bg-blue-400',
  in_progress: 'bg-teal-400',
  done:        'bg-green-400',
  cancelled:   'bg-gray-500',
}

const STATUS_LABEL: Record<DispatchStatus, string> = {
  scheduled: 'Scheduled', in_progress: 'In Progress', done: 'Done', cancelled: 'Cancelled',
}

function fmtDay(d: Date): string {
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}
function atHour(d: Date, h: number): Date {
  const copy = new Date(d)
  copy.setHours(h, 0, 0, 0)
  return copy
}
function isToday(d: Date): boolean {
  const now = new Date()
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
}

interface DragPayload {
  kind: 'assignment' | 'backlog'
  assignmentId?: string
  assignment?: DispatchAssignment
  backlogSourceType?: DispatchSourceType
  backlogSourceId?: string
  backlogCustomerId?: string
  backlogCustomerName?: string
  backlogTitle?: string
}

export default function DispatchBoardPage() {
  usePageTitle('Dispatch')
  const toast = useToast()
  const { canEdit } = usePermissions()

  const [weekStart, setWeekStart] = useState(() => getWeekStart(new Date()))
  const weekDays = useMemo(() => getWeekDays(weekStart), [weekStart])
  const weekEnd = useMemo(() => new Date(weekStart.getTime() + 7 * DAY_MS), [weekStart])

  const [assignments, setAssignments] = useState<DispatchAssignment[]>([])
  const [team, setTeam] = useState<TeamMember[]>([])
  const [requests, setRequests] = useState<ServiceRequest[]>([])
  const [profile, setProfile] = useState<CompanyProfile>(EMPTY_PROFILE)
  const [maxVisitsInput, setMaxVisitsInput] = useState('0')
  const [savingMaxVisits, setSavingMaxVisits] = useState(false)
  const [plans, setPlans] = useState<ServicePlan[]>([])
  const { items: allCustomers } = useSharedCustomers()

  const [railOpen, setRailOpen] = useState({ jobs: true, requests: true, plans: true })
  const [dragOverCell, setDragOverCell] = useState<string | null>(null) // `${uid}|${dayIndex}`
  const dragRef = useRef<DragPayload | null>(null)
  const [menuFor, setMenuFor] = useState<string | null>(null) // assignment id with ⋯ menu open
  const [schedulingBacklog, setSchedulingBacklog] = useState<DragPayload | null>(null)

  // Mobile shows one day at a time rather than the full week grid (which
  // needs horizontal scrolling on a phone and whose drag-and-drop doesn't
  // work on touch anyway). Defaults to today's column within the current
  // week; clamped to 0 if today isn't in the visible week (e.g. after Prev/Next).
  const [selectedDayIndex, setSelectedDayIndex] = useState(() => Math.max(0, dayIndexInWeek(new Date(), getWeekStart(new Date()))))

  function goToPrevDay() {
    if (selectedDayIndex === 0) {
      setWeekStart(w => new Date(w.getTime() - 7 * DAY_MS))
      setSelectedDayIndex(6)
    } else {
      setSelectedDayIndex(i => i - 1)
    }
  }
  function goToNextDay() {
    if (selectedDayIndex === 6) {
      setWeekStart(w => new Date(w.getTime() + 7 * DAY_MS))
      setSelectedDayIndex(0)
    } else {
      setSelectedDayIndex(i => i + 1)
    }
  }
  function goToTodayMobile() {
    const todayStart = getWeekStart(new Date())
    setWeekStart(todayStart)
    setSelectedDayIndex(Math.max(0, dayIndexInWeek(new Date(), todayStart)))
  }

  useEffect(() => subscribeToAssignments(weekStart, weekEnd, setAssignments, () => {}), [weekStart, weekEnd])
  useEffect(() => subscribeToTeam(
    members => setTeam([...members].sort(compareMembers)),
    () => {},
  ), [])
  useEffect(() => subscribeToServiceRequests(setRequests, () => {}), [])
  useEffect(() => subscribeToServicePlans(setPlans, () => {}), [])
  useEffect(() => subscribeToCompanyProfile(
    p => { setProfile(p); setMaxVisitsInput(String(p.maxVisitsPerDay ?? 0)) },
    () => {},
  ), [])

  async function handleSaveMaxVisits() {
    const n = Math.max(0, Number(maxVisitsInput) || 0)
    setSavingMaxVisits(true)
    try {
      // saveCompanyProfile writes every field on the object (merge:true only
      // skips fields absent from it) — spread the last-loaded profile so this
      // doesn't blank out name/address/phone/email, same reasoning as the
      // reviewLink save on AutomationsPage.
      await saveCompanyProfile({ ...profile, maxVisitsPerDay: n })
      toast('Saved', 'success')
    } catch {
      toast('Could not save', 'error')
    } finally {
      setSavingMaxVisits(false)
    }
  }

  const rows = useMemo(() => [{ uid: '', firstName: 'Unassigned', lastName: '', email: '', role: null } as TeamMember, ...team], [team])

  // Sets of source ids already scheduled somewhere in the visible week, so
  // the backlog rail only shows what's still unscheduled for this week.
  const scheduledJobCustomerIds = useMemo(
    () => new Set(assignments.filter(a => a.sourceType === 'job').map(a => a.customerId)),
    [assignments],
  )
  const scheduledRequestIds = useMemo(
    () => new Set(assignments.filter(a => a.sourceType === 'serviceRequest').map(a => a.sourceId)),
    [assignments],
  )
  const scheduledPlanIds = useMemo(
    () => new Set(assignments.filter(a => a.sourceType === 'servicePlan').map(a => a.sourceId)),
    [assignments],
  )

  const jobBacklog = useMemo(
    () => allCustomers.filter(c =>
      categoryMatches(c.category, 'Customer') && c.isActive && !scheduledJobCustomerIds.has(c.id),
    ).slice(0, 100),
    [allCustomers, scheduledJobCustomerIds],
  )
  const requestBacklog = useMemo(
    () => requests.filter(r =>
      (r.status === 'new' || r.status === 'contacted') && !scheduledRequestIds.has(r.id),
    ),
    [requests, scheduledRequestIds],
  )
  const planBacklog = useMemo(
    () => plans.filter(p => p.isActive && p.nextDate <= weekEnd && !scheduledPlanIds.has(p.id)),
    [plans, weekEnd, scheduledPlanIds],
  )

  // Bucket assignments by (row uid, day index) for rendering. Multi-day spans
  // are placed on their start day only — the board shows a single card per
  // visit, not a Gantt-style bar across days.
  const grid = useMemo(() => {
    const map = new Map<string, DispatchAssignment[]>()
    for (const a of assignments) {
      const idx = dayIndexInWeek(a.startAt, weekStart)
      if (idx < 0) continue
      const key = `${a.assignedToUid}|${idx}`
      const list = map.get(key) ?? []
      list.push(a)
      map.set(key, list)
    }
    return map
  }, [assignments, weekStart])

  function cellsFor(uid: string): DispatchAssignment[][] {
    return weekDays.map((_, i) => grid.get(`${uid}|${i}`) ?? [])
  }

  async function handleDropOnCell(uid: string, dayIndex: number) {
    const payload = dragRef.current
    dragRef.current = null
    setDragOverCell(null)
    if (!payload) return
    const day = weekDays[dayIndex]
    const memberName = rows.find(r => r.uid === uid)
    const assignedToName = uid ? [memberName?.firstName, memberName?.lastName].filter(Boolean).join(' ') : ''

    try {
      if (payload.kind === 'assignment' && payload.assignmentId && payload.assignment) {
        await moveAssignment(
          payload.assignmentId,
          { assignedToUid: uid, assignedToName, startAt: atHour(day, 8), endAt: atHour(day, 17) },
          payload.assignment.customerId,
          payload.assignment.sourceType,
        )
      } else if (payload.kind === 'backlog' && payload.backlogSourceType && payload.backlogSourceId) {
        await createAssignment({
          sourceType: payload.backlogSourceType,
          sourceId: payload.backlogSourceId,
          customerId: payload.backlogCustomerId ?? '',
          customerName: payload.backlogCustomerName ?? '',
          title: payload.backlogTitle ?? '',
          assignedToUid: uid,
          assignedToName,
          startAt: atHour(day, 8),
          endAt: atHour(day, 17),
        })
      }
    } catch {
      toast('Could not schedule that — please try again', 'error')
    }
  }

  async function handleMoveExisting(a: DispatchAssignment, uid: string, dayIndex: number) {
    const day = weekDays[dayIndex]
    const memberName = rows.find(r => r.uid === uid)
    const assignedToName = uid ? [memberName?.firstName, memberName?.lastName].filter(Boolean).join(' ') : ''
    try {
      await moveAssignment(
        a.id,
        { assignedToUid: uid, assignedToName, startAt: atHour(day, 8), endAt: atHour(day, 17) },
        a.customerId,
        a.sourceType,
      )
    } catch {
      toast('Could not move that visit', 'error')
    }
  }

  async function handleStatusChange(a: DispatchAssignment, status: DispatchStatus) {
    try {
      await updateAssignmentStatus(a.id, status)
    } catch {
      toast('Could not update status', 'error')
    }
  }

  async function handleReturnToBacklog(a: DispatchAssignment) {
    try {
      await deleteAssignment(a.id, a.customerId, a.sourceType)
    } catch {
      toast('Could not remove that visit', 'error')
    }
  }

  async function handleScheduleFromBacklog(payload: DragPayload, uid: string, dayIndex: number) {
    dragRef.current = payload
    await handleDropOnCell(uid, dayIndex)
    setSchedulingBacklog(null)
  }

  const backlogRail = (
    <>
      <BacklogSection
        title="Jobs" count={jobBacklog.length} open={railOpen.jobs}
        onToggle={() => setRailOpen(v => ({ ...v, jobs: !v.jobs }))}
      >
        {jobBacklog.map(c => (
          <BacklogCard
            key={c.id}
            sourceType="job"
            title={c.job || 'Job'}
            subtitle={fullName(c) || '—'}
            draggable={canEdit}
            onDragStart={() => { dragRef.current = {
              kind: 'backlog', backlogSourceType: 'job', backlogSourceId: c.id,
              backlogCustomerId: c.id, backlogCustomerName: fullName(c), backlogTitle: c.job || 'Job',
            } }}
            onSchedule={() => canEdit && setSchedulingBacklog({
              kind: 'backlog', backlogSourceType: 'job', backlogSourceId: c.id,
              backlogCustomerId: c.id, backlogCustomerName: fullName(c), backlogTitle: c.job || 'Job',
            })}
          />
        ))}
        {jobBacklog.length === 0 && <p className="text-xs text-gray-600 px-1">Nothing unscheduled.</p>}
      </BacklogSection>

      <BacklogSection
        title="Service Requests" count={requestBacklog.length} open={railOpen.requests}
        onToggle={() => setRailOpen(v => ({ ...v, requests: !v.requests }))}
      >
        {requestBacklog.map(r => (
          <BacklogCard
            key={r.id}
            sourceType="serviceRequest"
            title={r.name || 'Service request'}
            subtitle={REQUEST_STATUS_LABELS[r.status]}
            urgent={isFirstContactBreached(r)}
            draggable={canEdit}
            onDragStart={() => { dragRef.current = {
              kind: 'backlog', backlogSourceType: 'serviceRequest', backlogSourceId: r.id,
              backlogCustomerId: r.customerId, backlogCustomerName: r.name, backlogTitle: r.description || 'Service request',
            } }}
            onSchedule={() => canEdit && setSchedulingBacklog({
              kind: 'backlog', backlogSourceType: 'serviceRequest', backlogSourceId: r.id,
              backlogCustomerId: r.customerId, backlogCustomerName: r.name, backlogTitle: r.description || 'Service request',
            })}
          />
        ))}
        {requestBacklog.length === 0 && <p className="text-xs text-gray-600 px-1">Nothing unscheduled.</p>}
      </BacklogSection>

      <BacklogSection
        title="Service Plan Visits" count={planBacklog.length} open={railOpen.plans}
        onToggle={() => setRailOpen(v => ({ ...v, plans: !v.plans }))}
      >
        {planBacklog.map(p => (
          <BacklogCard
            key={p.id}
            sourceType="servicePlan"
            title={p.title || 'Service visit'}
            subtitle={p.customerName}
            draggable={canEdit}
            onDragStart={() => { dragRef.current = {
              kind: 'backlog', backlogSourceType: 'servicePlan', backlogSourceId: p.id,
              backlogCustomerId: p.customerId, backlogCustomerName: p.customerName, backlogTitle: p.title || 'Service visit',
            } }}
            onSchedule={() => canEdit && setSchedulingBacklog({
              kind: 'backlog', backlogSourceType: 'servicePlan', backlogSourceId: p.id,
              backlogCustomerId: p.customerId, backlogCustomerName: p.customerName, backlogTitle: p.title || 'Service visit',
            })}
          />
        ))}
        {planBacklog.length === 0 && <p className="text-xs text-gray-600 px-1">Nothing due.</p>}
      </BacklogSection>
    </>
  )

  return (
    <div className="px-4 py-6">
      <PipelineJobsTabs />

      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Dispatch</h1>
          <p className="text-sm text-gray-400 mt-0.5">Drag a job, request, or visit onto a tech's day to schedule it</p>
        </div>

        {/* Desktop: week navigation */}
        <div className="hidden md:flex items-center gap-2">
          <button onClick={() => setWeekStart(w => new Date(w.getTime() - 7 * DAY_MS))} className="btn-secondary text-sm px-3 py-1.5">
            ← Prev
          </button>
          <button onClick={() => setWeekStart(getWeekStart(new Date()))} className="btn-secondary text-sm px-3 py-1.5">
            Today
          </button>
          <button onClick={() => setWeekStart(w => new Date(w.getTime() + 7 * DAY_MS))} className="btn-secondary text-sm px-3 py-1.5">
            Next →
          </button>
        </div>

        {/* Mobile: day navigation — one day at a time instead of the week grid */}
        <div className="flex md:hidden items-center gap-2">
          <button onClick={goToPrevDay} className="btn-secondary text-sm px-3 py-1.5">←</button>
          <button onClick={goToTodayMobile} className="btn-secondary text-sm px-3 py-1.5">Today</button>
          <button onClick={goToNextDay} className="btn-secondary text-sm px-3 py-1.5">→</button>
        </div>
      </div>

      {!canEdit && (
        <div className="bg-gray-800/60 border border-gray-700/50 rounded-xl px-4 py-2.5 text-sm text-gray-400 mb-4">
          Read-only — you don't have permission to schedule or move visits.
        </div>
      )}

      {canEdit && (
        <div className="flex items-center gap-2 mb-4 text-sm">
          <label className="text-gray-400">Max visits/day on the customer portal:</label>
          <input
            type="number"
            min={0}
            value={maxVisitsInput}
            onChange={e => setMaxVisitsInput(e.target.value)}
            className="input-field w-20 text-sm py-1"
          />
          <button onClick={handleSaveMaxVisits} disabled={savingMaxVisits} className="btn-secondary text-xs px-3 py-1.5">
            {savingMaxVisits ? 'Saving…' : 'Save'}
          </button>
          <span className="text-xs text-gray-600">0 = no limit shown to customers</span>
        </div>
      )}

      {/* Desktop: backlog rail + full week grid */}
      <div className="hidden md:flex gap-4">
        <div className="w-72 shrink-0 space-y-3">{backlogRail}</div>

        <div className="flex-1 overflow-x-auto">
          <div className="min-w-[900px]">
            <div className="grid grid-cols-[140px_repeat(7,1fr)] gap-1.5 mb-2">
              <div />
              {weekDays.map((d, i) => (
                <div key={i} className={`text-center text-xs font-semibold px-2 py-1.5 rounded-lg ${isToday(d) ? 'bg-indigo-600/30 text-indigo-300' : 'text-gray-400'}`}>
                  {fmtDay(d)}
                </div>
              ))}
            </div>

            {rows.map(member => {
              const cells = cellsFor(member.uid)
              return (
                <div key={member.uid || 'unassigned'} className="grid grid-cols-[140px_repeat(7,1fr)] gap-1.5 mb-1.5">
                  <div className="flex items-center px-2">
                    <p className={`text-sm truncate ${member.uid ? 'text-gray-200' : 'text-gray-500 italic'}`}>
                      {member.uid ? [member.firstName, member.lastName].filter(Boolean).join(' ') || member.email : 'Unassigned'}
                    </p>
                  </div>
                  {cells.map((items, dayIndex) => {
                    const cellKey = `${member.uid}|${dayIndex}`
                    const isOver = dragOverCell === cellKey
                    return (
                      <div
                        key={dayIndex}
                        onDragOver={e => { e.preventDefault(); if (canEdit) setDragOverCell(cellKey) }}
                        onDragLeave={() => setDragOverCell(null)}
                        onDrop={e => { e.preventDefault(); if (canEdit) handleDropOnCell(member.uid, dayIndex) }}
                        className={`min-h-[64px] rounded-lg border p-1 space-y-1 transition-colors ${
                          isOver ? 'border-indigo-500 bg-indigo-500/10' : 'border-gray-800 bg-gray-900/60'
                        }`}
                      >
                        {items.map(a => (
                          <AssignmentCard
                            key={a.id}
                            assignment={a}
                            draggable={canEdit}
                            menuOpen={menuFor === a.id}
                            onToggleMenu={() => setMenuFor(v => v === a.id ? null : a.id)}
                            onDragStart={() => { dragRef.current = { kind: 'assignment', assignmentId: a.id, assignment: a } }}
                            rows={rows}
                            weekDays={weekDays}
                            onMove={(uid, di) => { setMenuFor(null); handleMoveExisting(a, uid, di) }}
                            onStatus={s => { setMenuFor(null); handleStatusChange(a, s) }}
                            onReturnToBacklog={() => { setMenuFor(null); handleReturnToBacklog(a) }}
                          />
                        ))}
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Mobile: backlog rail stacked above a single day's assignments, grouped by tech */}
      <div className="md:hidden space-y-4">
        <div className="space-y-3">{backlogRail}</div>

        <div>
          <p className={`text-center text-sm font-semibold px-2 py-1.5 rounded-lg mb-3 ${isToday(weekDays[selectedDayIndex]) ? 'bg-indigo-600/30 text-indigo-300' : 'text-gray-300 bg-gray-800/60'}`}>
            {fmtDay(weekDays[selectedDayIndex])}
          </p>
          <div className="space-y-2">
            {rows.map(member => {
              const items = grid.get(`${member.uid}|${selectedDayIndex}`) ?? []
              return (
                <div key={member.uid || 'unassigned'} className="card p-2.5">
                  <p className={`text-xs font-medium mb-1.5 ${member.uid ? 'text-gray-300' : 'text-gray-500 italic'}`}>
                    {member.uid ? [member.firstName, member.lastName].filter(Boolean).join(' ') || member.email : 'Unassigned'}
                  </p>
                  {items.length === 0 ? (
                    <p className="text-xs text-gray-600">Nothing scheduled</p>
                  ) : (
                    <div className="space-y-1.5">
                      {items.map(a => (
                        <AssignmentCard
                          key={a.id}
                          assignment={a}
                          draggable={false}
                          menuOpen={menuFor === a.id}
                          onToggleMenu={() => setMenuFor(v => v === a.id ? null : a.id)}
                          onDragStart={() => {}}
                          rows={rows}
                          weekDays={weekDays}
                          onMove={(uid, di) => { setMenuFor(null); handleMoveExisting(a, uid, di) }}
                          onStatus={s => { setMenuFor(null); handleStatusChange(a, s) }}
                          onReturnToBacklog={() => { setMenuFor(null); handleReturnToBacklog(a) }}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {schedulingBacklog && (
        <ScheduleModal
          rows={rows}
          weekDays={weekDays}
          onConfirm={(uid, dayIndex) => handleScheduleFromBacklog(schedulingBacklog, uid, dayIndex)}
          onCancel={() => setSchedulingBacklog(null)}
        />
      )}
    </div>
  )
}

// ─── Backlog rail ───────────────────────────────────────────────────────────

function BacklogSection({
  title, count, open, onToggle, children,
}: { title: string; count: number; open: boolean; onToggle: () => void; children: React.ReactNode }) {
  return (
    <div className="card overflow-hidden">
      <button onClick={onToggle} className="w-full flex items-center justify-between px-3 py-2 bg-gray-800/50 border-b border-gray-700/50">
        <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">{title}</span>
        <span className="text-xs text-gray-500">{count}</span>
      </button>
      {open && <div className="p-2 space-y-1.5 max-h-64 overflow-y-auto">{children}</div>}
    </div>
  )
}

function BacklogCard({
  sourceType, title, subtitle, urgent, draggable, onDragStart, onSchedule,
}: {
  sourceType: DispatchSourceType
  title: string
  subtitle: string
  urgent?: boolean
  draggable: boolean
  onDragStart: () => void
  onSchedule: () => void
}) {
  const badge = SOURCE_BADGE[sourceType]
  return (
    <div
      draggable={draggable}
      onDragStart={onDragStart}
      className={`rounded-lg border border-gray-700/50 bg-gray-800/60 p-2 ${draggable ? 'cursor-grab active:cursor-grabbing' : ''}`}
    >
      <div className="flex items-center justify-between gap-1.5">
        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${badge.className}`}>{badge.label}</span>
        {urgent && <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-red-900/40 text-red-300">Urgent</span>}
      </div>
      <p className="text-xs font-medium text-gray-200 truncate mt-1">{title}</p>
      <p className="text-xs text-gray-500 truncate">{subtitle}</p>
      {draggable && (
        <button onClick={onSchedule} className="text-[11px] text-indigo-400 hover:text-indigo-300 mt-1">
          Schedule…
        </button>
      )}
    </div>
  )
}

// ─── Board card ─────────────────────────────────────────────────────────────

function AssignmentCard({
  assignment: a, draggable, menuOpen, onToggleMenu, onDragStart, rows, weekDays, onMove, onStatus, onReturnToBacklog,
}: {
  assignment: DispatchAssignment
  draggable: boolean
  menuOpen: boolean
  onToggleMenu: () => void
  onDragStart: () => void
  rows: TeamMember[]
  weekDays: Date[]
  onMove: (uid: string, dayIndex: number) => void
  onStatus: (status: DispatchStatus) => void
  onReturnToBacklog: () => void
}) {
  const menuRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!menuOpen) return
    function onDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onToggleMenu()
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [menuOpen]) // eslint-disable-line react-hooks/exhaustive-deps

  const badge = SOURCE_BADGE[a.sourceType]
  const sameDayIndex = weekDays.findIndex(wd => wd.toDateString() === a.startAt.toDateString())

  return (
    <div
      draggable={draggable}
      onDragStart={onDragStart}
      className={`relative rounded-md bg-gray-800 border border-gray-700/60 px-1.5 py-1 text-left ${draggable ? 'cursor-grab active:cursor-grabbing' : ''}`}
    >
      <div className="flex items-center gap-1">
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${STATUS_DOT[a.status]}`} />
        <Link to={`/records/${a.customerId}`} className="text-[11px] font-medium text-gray-200 truncate hover:underline flex-1 min-w-0">
          {a.customerName || '—'}
        </Link>
        <button
          type="button"
          onClick={e => { e.stopPropagation(); onToggleMenu() }}
          className="text-gray-500 hover:text-gray-200 shrink-0 leading-none px-0.5"
          aria-label="Options"
        >
          ⋯
        </button>
      </div>
      <p className={`text-[10px] px-1 py-0.5 rounded-full inline-block mt-0.5 ${badge.className}`}>{a.title || badge.label}</p>

      {menuOpen && (
        <div ref={menuRef} className="absolute right-0 top-full mt-1 w-48 bg-gray-900 border border-gray-700 rounded-xl shadow-2xl z-30 overflow-hidden">
          <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-500 border-b border-gray-800">Move to</div>
          <div className="max-h-40 overflow-y-auto">
            {rows.map(r => (
              <button
                key={r.uid || 'unassigned'}
                onClick={() => onMove(r.uid, sameDayIndex)}
                className="w-full text-left px-3 py-1.5 text-xs text-gray-200 hover:bg-gray-700/50 transition-colors truncate"
              >
                {r.uid ? [r.firstName, r.lastName].filter(Boolean).join(' ') || r.email : 'Unassigned'} — same day
              </button>
            ))}
          </div>
          <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-500 border-t border-b border-gray-800">Status</div>
          {(Object.keys(STATUS_LABEL) as DispatchStatus[]).filter(s => s !== a.status).map(s => (
            <button key={s} onClick={() => onStatus(s)} className="w-full text-left px-3 py-1.5 text-xs text-gray-200 hover:bg-gray-700/50 transition-colors">
              Mark {STATUS_LABEL[s]}
            </button>
          ))}
          <button onClick={onReturnToBacklog} className="w-full text-left px-3 py-1.5 text-xs text-red-400 hover:bg-gray-700/50 transition-colors border-t border-gray-800">
            Return to backlog
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Touch-friendly scheduling modal (backlog → board without drag) ────────

function ScheduleModal({
  rows, weekDays, onConfirm, onCancel,
}: {
  rows: TeamMember[]
  weekDays: Date[]
  onConfirm: (uid: string, dayIndex: number) => void
  onCancel: () => void
}) {
  const [uid, setUid] = useState(rows[0]?.uid ?? '')
  const [dayIndex, setDayIndex] = useState(0)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 w-full max-w-xs shadow-2xl">
        <h3 className="text-base font-semibold text-white mb-4">Schedule Visit</h3>

        <label className="block text-xs text-gray-500 mb-1">Assign to</label>
        <select value={uid} onChange={e => setUid(e.target.value)} className="input-field text-sm w-full mb-3">
          {rows.map(r => (
            <option key={r.uid || 'unassigned'} value={r.uid}>
              {r.uid ? [r.firstName, r.lastName].filter(Boolean).join(' ') || r.email : 'Unassigned'}
            </option>
          ))}
        </select>

        <label className="block text-xs text-gray-500 mb-1">Day</label>
        <select value={dayIndex} onChange={e => setDayIndex(Number(e.target.value))} className="input-field text-sm w-full mb-4">
          {weekDays.map((d, i) => <option key={i} value={i}>{fmtDay(d)}</option>)}
        </select>

        <div className="flex gap-2 justify-end">
          <button onClick={onCancel} className="btn-secondary text-sm px-4 py-2">Cancel</button>
          <button onClick={() => onConfirm(uid, dayIndex)} className="btn-primary text-sm px-4 py-2">Schedule</button>
        </div>
      </div>
    </div>
  )
}
