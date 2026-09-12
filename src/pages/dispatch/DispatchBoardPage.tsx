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
import ConfirmModal from '../../components/ConfirmModal'
import { Icon, ICONS } from '../../components/Icon'
import { weekDayLoads, CELL_VISIBLE_LIMIT, type DayLoad } from '../../models/dispatchLoad'
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
  scheduled: 'Scheduled', in_progress: 'In progress', done: 'Done', cancelled: 'Cancelled',
}

/** How a day's load against the portal cap reads. */
const LOAD_STYLE: Record<DayLoad['state'], string> = {
  open: 'text-gray-300',
  full: 'text-amber-300',
  over: 'text-red-300',
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
  /**
   * Actions open a modal, not a popover.
   *
   * The ⋯ menu was an absolutely-positioned panel inside `overflow-x-auto`.
   * Per CSS, `overflow-x: auto` with `overflow-y: visible` computes the y axis
   * to `auto`, so the board clipped its own menu — and the menu was ~250px
   * tall against ~100px cells, so cards in the lower tech rows lost it
   * entirely. A modal also gives the actions a real touch target and works on
   * a phone, where the popover's Move list only ever offered "same day".
   */
  const [actionsFor, setActionsFor] = useState<DispatchAssignment | null>(null)
  const [movingAssignment, setMovingAssignment] = useState<DispatchAssignment | null>(null)
  const [confirmRemove, setConfirmRemove] = useState<DispatchAssignment | null>(null)
  const [removing, setRemoving] = useState(false)
  const [schedulingBacklog, setSchedulingBacklog] = useState<DragPayload | null>(null)
  /** Cells collapse past CELL_VISIBLE_LIMIT; this tracks the expanded ones. */
  const [expandedCells, setExpandedCells] = useState<Set<string>>(new Set())

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

  /**
   * Five listeners defaulted to empty with no loading flag, so the first paint
   * was a confident wrong answer: one "Unassigned" row, seven empty cells and
   * three backlog sections reading "Nothing unscheduled".
   */
  const [loadedTeam, setLoadedTeam] = useState(false)
  const [loadedAssignments, setLoadedAssignments] = useState(false)
  const loading = !loadedTeam || !loadedAssignments

  useEffect(() => {
    setLoadedAssignments(false)
    return subscribeToAssignments(
      weekStart, weekEnd,
      a => { setAssignments(a); setLoadedAssignments(true) },
      () => setLoadedAssignments(true),
    )
  }, [weekStart, weekEnd])
  useEffect(() => subscribeToTeam(
    members => { setTeam([...members].sort(compareMembers)); setLoadedTeam(true) },
    () => setLoadedTeam(true),
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

  /**
   * What the customer portal sees, shown where the visits are made.
   *
   * maxVisitsPerDay is set on this page and read by getPortalDayAvailability
   * to close days on the customer booking form — and the board showed no
   * per-day count at all, so filling a day silently shut the portal.
   */
  const cap = profile.maxVisitsPerDay ?? 0
  const dayLoads = useMemo(
    () => weekDayLoads(assignments, weekStart, cap),
    [assignments, weekStart, cap],
  )

  async function handleRemove(a: DispatchAssignment) {
    setRemoving(true)
    try {
      await deleteAssignment(a.id, a.customerId, a.sourceType)
      setConfirmRemove(null)
      toast('Visit removed — it is back in the backlog.', 'success')
    } catch {
      toast('Could not remove that visit', 'error')
    } finally {
      setRemoving(false)
    }
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
        {jobBacklog.length === 0 && <p className="text-xs text-gray-400 px-1">Nothing unscheduled.</p>}
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
        {requestBacklog.length === 0 && <p className="text-xs text-gray-400 px-1">Nothing unscheduled.</p>}
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
        {planBacklog.length === 0 && <p className="text-xs text-gray-400 px-1">Nothing due.</p>}
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

      {/* Its own card, and it says what it does. This sat bare between the
          banner and the board, reading as board chrome, with a label that
          wasn't tied to its input. */}
      {canEdit && (
        <div className="card p-3 mb-4 flex items-center gap-2 flex-wrap text-sm">
          <label htmlFor="max-visits" className="text-gray-300">Daily visit cap</label>
          <input
            id="max-visits"
            type="number"
            min={0}
            value={maxVisitsInput}
            onChange={e => setMaxVisitsInput(e.target.value)}
            className="input-field w-20 text-sm py-1"
          />
          <button onClick={handleSaveMaxVisits} disabled={savingMaxVisits} className="btn-secondary text-xs px-3 py-1.5">
            {savingMaxVisits ? 'Saving…' : 'Save'}
          </button>
          <span className="text-xs text-gray-400">
            Closes the customer booking form once a day reaches this many visits. 0 = no limit.
          </span>
        </div>
      )}

      {loading && (
        <div className="space-y-2 animate-pulse" aria-busy="true" aria-label="Loading the board">
          <div className="hidden md:grid grid-cols-[120px_repeat(7,1fr)] gap-1.5">
            <div />
            {Array.from({ length: 7 }).map((_, i) => <div key={i} className="h-7 bg-gray-800 rounded-lg" />)}
          </div>
          {Array.from({ length: 4 }).map((_, r) => (
            <div key={r} className="grid grid-cols-1 md:grid-cols-[120px_repeat(7,1fr)] gap-1.5">
              <div className="h-5 md:h-16 bg-gray-800 rounded" />
              {Array.from({ length: 7 }).map((_, i) => (
                <div key={i} className="hidden md:block h-16 bg-gray-900/60 border border-gray-800 rounded-lg" />
              ))}
            </div>
          ))}
        </div>
      )}

      {/* Desktop: backlog rail + full week grid */}
      <div className={`${loading ? 'hidden' : 'hidden md:flex'} gap-4`}>
        <div className="w-72 shrink-0 space-y-3">{backlogRail}</div>

        {/* min-w 1120, not 900, and a 120px label column. At 900 each cell
            was 102px and the customer name — the thing you actually read —
            got 49px, about eight characters. */}
        <div className="flex-1 overflow-x-auto">
          <div className="min-w-[1120px]">
            <div className="grid grid-cols-[120px_repeat(7,1fr)] gap-1.5 mb-1">
              <div />
              {weekDays.map((d, i) => (
                <div key={i} className={`text-center text-xs font-semibold px-2 py-1.5 rounded-lg ${isToday(d) ? 'bg-indigo-600/30 text-indigo-300' : 'text-gray-300'}`}>
                  {fmtDay(d)}
                </div>
              ))}
            </div>

            {/* The count the customer portal acts on, per day. */}
            <div className="grid grid-cols-[120px_repeat(7,1fr)] gap-1.5 mb-2">
              <div className="text-[11px] text-gray-400 px-2 flex items-center">
                {cap > 0 ? `Visits / cap ${cap}` : 'Visits'}
              </div>
              {dayLoads.map((load, i) => (
                <div
                  key={i}
                  title={load.state === 'over'
                    ? `${load.count} visits — over the ${load.cap} cap. The customer booking form is closed for this day.`
                    : load.state === 'full'
                      ? `${load.count} of ${load.cap} — the customer booking form is closed for this day.`
                      : `${load.count} visit${load.count === 1 ? '' : 's'}`}
                  className={`text-center text-[11px] font-semibold tabular-nums py-0.5 rounded ${LOAD_STYLE[load.state]} ${
                    load.state === 'over' ? 'bg-red-500/15' : load.state === 'full' ? 'bg-amber-500/15' : ''
                  }`}
                >
                  {load.count}{cap > 0 && <span className="font-normal text-gray-400">/{cap}</span>}
                  {load.state !== 'open' && (
                    <span className="ml-1">{load.state === 'over' ? 'over' : 'full'}</span>
                  )}
                </div>
              ))}
            </div>

            {rows.map(member => {
              const cells = cellsFor(member.uid)
              return (
                <div key={member.uid || 'unassigned'} className="grid grid-cols-[120px_repeat(7,1fr)] gap-1.5 mb-1.5">
                  <div className="flex items-center px-2">
                    <p className={`text-sm truncate ${member.uid ? 'text-gray-200' : 'text-gray-400 italic'}`}>
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
                        {/* A cell had no ceiling: nine visits grew one tech's
                            row to ~400px while the rows around it stayed at
                            64px, so the grid stopped reading as a grid. */}
                        {(expandedCells.has(cellKey) ? items : items.slice(0, CELL_VISIBLE_LIMIT)).map(a => (
                          <AssignmentCard
                            key={a.id}
                            assignment={a}
                            draggable={canEdit}
                            onDragStart={() => { dragRef.current = { kind: 'assignment', assignmentId: a.id, assignment: a } }}
                            onOpenActions={() => setActionsFor(a)}
                          />
                        ))}
                        {items.length > CELL_VISIBLE_LIMIT && (
                          <button
                            onClick={() => setExpandedCells(prev => {
                              const next = new Set(prev)
                              if (next.has(cellKey)) next.delete(cellKey); else next.add(cellKey)
                              return next
                            })}
                            className="w-full text-[11px] text-indigo-400 hover:text-indigo-300 py-0.5 rounded
                                       focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                          >
                            {expandedCells.has(cellKey)
                              ? 'Show fewer'
                              : `+${items.length - CELL_VISIBLE_LIMIT} more`}
                          </button>
                        )}
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
      <div className={`${loading ? 'hidden' : 'md:hidden'} space-y-4`}>
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
                  <p className={`text-xs font-medium mb-1.5 ${member.uid ? 'text-gray-300' : 'text-gray-400 italic'}`}>
                    {member.uid ? [member.firstName, member.lastName].filter(Boolean).join(' ') || member.email : 'Unassigned'}
                  </p>
                  {items.length === 0 ? (
                    <p className="text-xs text-gray-400">Nothing scheduled</p>
                  ) : (
                    <div className="space-y-1.5">
                      {items.map(a => (
                        <AssignmentCard
                          key={a.id}
                          assignment={a}
                          draggable={false}
                          onDragStart={() => {}}
                          onOpenActions={() => setActionsFor(a)}
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
          title="Schedule visit"
          rows={rows}
          weekDays={weekDays}
          onConfirm={(uid, dayIndex) => handleScheduleFromBacklog(schedulingBacklog, uid, dayIndex)}
          onCancel={() => setSchedulingBacklog(null)}
        />
      )}

      {actionsFor && (
        <ActionsModal
          assignment={actionsFor}
          onStatus={s => { const a = actionsFor; setActionsFor(null); void handleStatusChange(a, s) }}
          onMove={() => { setMovingAssignment(actionsFor); setActionsFor(null) }}
          onRemove={() => { setConfirmRemove(actionsFor); setActionsFor(null) }}
          onClose={() => setActionsFor(null)}
        />
      )}

      {/* The Move list in the old popover only offered the visit's current
          day, so on a phone — where drag is off — a visit could never be
          moved to another day. Same picker the backlog uses. */}
      {movingAssignment && (
        <ScheduleModal
          title="Move visit"
          rows={rows}
          weekDays={weekDays}
          initialUid={movingAssignment.assignedToUid}
          initialDayIndex={Math.max(0, dayIndexInWeek(movingAssignment.startAt, weekStart))}
          confirmLabel="Move"
          onConfirm={(uid, dayIndex) => {
            const a = movingAssignment
            setMovingAssignment(null)
            void handleMoveExisting(a, uid, dayIndex)
          }}
          onCancel={() => setMovingAssignment(null)}
        />
      )}

      {/* deleteAssignment is a deleteDoc — the visit's status, tech and times
          are gone, and for a job it rewrites the customer's start/completion
          dates that Jobs, Calendar and the forecast all read. It had no
          confirmation. */}
      <ConfirmModal
        isOpen={!!confirmRemove}
        message={confirmRemove
          ? `Remove the visit for ${confirmRemove.customerName || 'this customer'} from the board? It returns to the backlog, but its status, assigned tech and times are discarded.`
          : ''}
        confirmLabel={removing ? 'Removing…' : 'Remove visit'}
        onConfirm={() => { if (confirmRemove) void handleRemove(confirmRemove) }}
        onCancel={() => setConfirmRemove(null)}
      />
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
        <span className="text-xs text-gray-300 tabular-nums">{count}</span>
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
        {/* text-[11px], not 10: the app floors at text-xs and these are the
            only labels saying which queue a card came from. */}
        <span className={`text-[11px] font-medium px-1.5 py-0.5 rounded-full ${badge.className}`}>{badge.label}</span>
        {urgent && <span className="text-[11px] font-medium px-1.5 py-0.5 rounded-full bg-red-900/40 text-red-300">Urgent</span>}
      </div>
      <p className="text-xs font-medium text-gray-200 truncate mt-1">{title}</p>
      {/* Was text-gray-500 — 3.04:1 — for the customer's name on a request
          or plan card. */}
      <p className="text-xs text-gray-300 truncate" title={subtitle}>{subtitle}</p>
      {draggable && (
        <button
          onClick={onSchedule}
          className="text-[11px] text-indigo-400 hover:text-indigo-300 mt-1 px-1 py-0.5 -ml-1 rounded
                     focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        >
          Schedule…
        </button>
      )}
    </div>
  )
}

// ─── Board card ─────────────────────────────────────────────────────────────

function AssignmentCard({
  assignment: a, draggable, onDragStart, onOpenActions,
}: {
  assignment: DispatchAssignment
  draggable: boolean
  onDragStart: () => void
  onOpenActions: () => void
}) {
  const badge = SOURCE_BADGE[a.sourceType]
  return (
    <div
      draggable={draggable}
      onDragStart={onDragStart}
      className={`group relative rounded-md bg-gray-800 border border-gray-700/60 px-1.5 py-1 text-left ${
        draggable ? 'cursor-grab active:cursor-grabbing' : ''
      }`}
    >
      {/* The name gets the whole first line. The ⋯ used to sit in this row,
          spending ~27px of the ~82px a cell had at the board's own minimum
          width — so the name was down to about eight characters. It's a
          corner button now, revealed on hover and always reachable by
          keyboard. */}
      <div className="flex items-center gap-1">
        <span
          className={`w-1.5 h-1.5 rounded-full shrink-0 ${STATUS_DOT[a.status]}`}
          title={STATUS_LABEL[a.status]}
          aria-hidden="true"
        />
        <Link
          to={`/records/${a.customerId}`}
          className="text-xs font-medium text-gray-100 truncate hover:underline flex-1 min-w-0 rounded
                     focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        >
          {a.customerName || '—'}
        </Link>
      </div>
      <p className={`text-[11px] px-1 py-0.5 rounded-full inline-block mt-0.5 max-w-full truncate ${badge.className}`}
         title={a.title || badge.label}>
        {a.title || badge.label}
      </p>

      {/* 28px, over the 24px floor. Was a ⋯ glyph at ~19x16px with no
          text-size class, at text-gray-500 — 3.04:1 — and it was the only
          route to move, re-status or delete a visit. */}
      <button
        type="button"
        onClick={e => { e.stopPropagation(); onOpenActions() }}
        aria-label={`Actions for ${a.customerName || 'this visit'}`}
        className="absolute top-0 right-0 p-1.5 rounded text-gray-300 bg-gray-800/90 opacity-0
                   group-hover:opacity-100 focus-visible:opacity-100 hover:text-white transition-opacity
                   focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
      >
        <Icon d={ICONS.ellipsis} className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}

// ─── Actions sheet ──────────────────────────────────────────────────────────

/**
 * Status, move and remove in a modal rather than a popover.
 *
 * The popover was clipped by the board's own `overflow-x-auto` container, its
 * trigger was a 19x16px glyph, and its Move list only ever offered the visit's
 * current day — so on a phone, where drag is off, a visit could never be moved
 * to another day at all.
 */
function ActionsModal({
  assignment: a, onStatus, onMove, onRemove, onClose,
}: {
  assignment: DispatchAssignment
  onStatus: (s: DispatchStatus) => void
  onMove: () => void
  onRemove: () => void
  onClose: () => void
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="dispatch-actions-title"
        className="relative bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-xs shadow-2xl overflow-hidden"
      >
        <div className="px-4 py-3 border-b border-gray-700/60">
          <p id="dispatch-actions-title" className="text-sm font-semibold text-white truncate">
            {a.customerName || 'Visit'}
          </p>
          <p className="text-xs text-gray-400 truncate">
            {a.title || SOURCE_BADGE[a.sourceType].label} · {STATUS_LABEL[a.status]}
          </p>
        </div>

        <p className="px-4 pt-3 pb-1 text-xs font-semibold uppercase tracking-wider text-gray-400">Status</p>
        {(Object.keys(STATUS_LABEL) as DispatchStatus[]).filter(s => s !== a.status).map(s => (
          <button
            key={s}
            onClick={() => onStatus(s)}
            className="w-full text-left px-4 py-2 text-sm text-gray-200 hover:bg-gray-700/50 transition-colors
                       focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500"
          >
            <span className="inline-flex items-center gap-2">
              <span className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT[s]}`} />
              Mark {STATUS_LABEL[s].toLowerCase()}
            </span>
          </button>
        ))}

        <div className="border-t border-gray-700/60 mt-2">
          <button
            onClick={onMove}
            className="w-full text-left px-4 py-2.5 text-sm text-gray-200 hover:bg-gray-700/50 transition-colors
                       focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500"
          >
            Move to another tech or day…
          </button>
          <button
            onClick={onRemove}
            className="w-full text-left px-4 py-2.5 text-sm text-red-400 hover:bg-red-900/20 transition-colors
                       border-t border-gray-700/60
                       focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500"
          >
            Remove from the board
          </button>
        </div>

        <div className="px-4 py-3 border-t border-gray-700/60">
          <button onClick={onClose} className="btn-secondary text-sm w-full py-2">Close</button>
        </div>
      </div>
    </div>
  )
}


// ─── Touch-friendly scheduling modal (backlog → board without drag) ────────

function ScheduleModal({
  title, rows, weekDays, onConfirm, onCancel,
  initialUid, initialDayIndex = 0, confirmLabel = 'Schedule',
}: {
  title: string
  rows: TeamMember[]
  weekDays: Date[]
  onConfirm: (uid: string, dayIndex: number) => void
  onCancel: () => void
  initialUid?: string
  initialDayIndex?: number
  confirmLabel?: string
}) {
  const [uid, setUid] = useState(initialUid ?? rows[0]?.uid ?? '')
  const [dayIndex, setDayIndex] = useState(initialDayIndex)

  // Was a plain div: no role, no aria-modal, no Escape, no backdrop dismiss,
  // no autofocus — the pattern ConfirmModal has handled in ten other files.
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onCancel() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onCancel])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/60" onClick={onCancel} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="dispatch-schedule-title"
        className="relative bg-gray-900 border border-gray-700 rounded-2xl p-6 w-full max-w-xs shadow-2xl"
      >
        <h3 id="dispatch-schedule-title" className="text-base font-semibold text-white mb-4">{title}</h3>

        <label htmlFor="sched-tech" className="block text-xs text-gray-300 mb-1">Assign to</label>
        <select
          id="sched-tech"
          autoFocus
          value={uid}
          onChange={e => setUid(e.target.value)}
          className="input-field text-sm w-full mb-3"
        >
          {rows.map(r => (
            <option key={r.uid || 'unassigned'} value={r.uid}>
              {r.uid ? [r.firstName, r.lastName].filter(Boolean).join(' ') || r.email : 'Unassigned'}
            </option>
          ))}
        </select>

        <label htmlFor="sched-day" className="block text-xs text-gray-300 mb-1">Day</label>
        <select
          id="sched-day"
          value={dayIndex}
          onChange={e => setDayIndex(Number(e.target.value))}
          className="input-field text-sm w-full mb-1"
        >
          {weekDays.map((d, i) => <option key={i} value={i}>{fmtDay(d)}</option>)}
        </select>
        {/* The day list is the week on screen — worth saying, since the only
            way to reach another week is the board's own navigation. */}
        <p className="text-xs text-gray-400 mb-4">
          Days in the week shown on the board. Use Prev/Next to reach another week.
        </p>

        <div className="flex gap-2 justify-end">
          <button onClick={onCancel} className="btn-secondary text-sm px-4 py-2">Cancel</button>
          <button onClick={() => onConfirm(uid, dayIndex)} className="btn-primary text-sm px-4 py-2">
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
