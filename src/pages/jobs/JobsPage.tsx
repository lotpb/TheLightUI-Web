import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { doc, updateDoc, Timestamp } from 'firebase/firestore'
import { db } from '../../firebase/config'
import { categoryMatches, fullName, formatCurrency, type CustomerItem } from '../../models/customer'
import { type JobStage, JOB_STAGE_CONFIG as STAGE_CONFIG, getJobStage as getStage } from '../../models/jobPipeline'
import { REALTIME_LIMIT } from '../../services/customerService'
import { usePageTitle } from '../../hooks/usePageTitle'
import { useSharedCustomers } from '../../hooks/useSharedCustomers'
import { avatarColor, avatarOriginal } from '../../utils/avatarColor'
import { usePrefStore } from '../../stores/prefStore'
import PipelineJobsTabs from '../../components/PipelineJobsTabs'
import { Icon, ICONS } from '../../components/Icon'

const DAY_MS = 86_400_000
const COLLECTION = 'Customers'

function fmtDate(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
/**
 * Local calendar date, not UTC.
 *
 * This used toISOString().slice(0, 10), so for anyone west of UTC the date
 * input pre-filled the previous day — in the one control whose entire job is
 * picking a date.
 */
function toDateInputStr(d: Date | null | undefined): string {
  if (!d) return ''
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

/**
 * A clock that advances, so the board does too.
 *
 * `now` was memoised once per mount, and every stage derivation and the overdue
 * count read it — so on a board left open all day a job whose start date
 * arrived never moved from Scheduled to In Progress and nothing ever became
 * overdue. JobCard also called its own new Date(), so a card could read
 * "2d overdue" while sitting in a column bucketed against a stale clock.
 */
function useNow(intervalMs = 60_000): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}
function addDays(d: Date, n: number): Date {
  const copy = new Date(d)
  copy.setDate(copy.getDate() + n)
  return copy
}
// Mirrors getJobStage's derivation rule for a bare start/completion pair,
// without needing a full CustomerItem to type-check the preview in the modal.
function deriveStageFromDates(start: Date, completion: Date, now: Date): JobStage {
  const hasSchedule = completion.getTime() > start.getTime() + DAY_MS
  if (!hasSchedule) return 'pending'
  if (start > now) return 'scheduled'
  if (completion > now) return 'active'
  return 'complete'
}
function directionsUrl(c: CustomerItem): string {
  const address = [c.street, c.city, c.state].filter(Boolean).join(', ')
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`
}

const MAX_PER_COL = 30

async function applyJobStageChange(id: string, start: Date | null, completion: Date | null): Promise<void> {
  await updateDoc(doc(db, COLLECTION, id), {
    start:      start      ? Timestamp.fromDate(start)      : null,
    completion: completion ? Timestamp.fromDate(completion) : null,
  })
}

// Sensible starting point for the date picker based on which column the
// card was dropped on — the user can still adjust before confirming.
function defaultDatesFor(targetStage: JobStage, existingStart: Date | null, existingCompletion: Date | null) {
  const today = new Date()
  if (existingStart && existingCompletion) return { start: existingStart, completion: existingCompletion }
  switch (targetStage) {
    case 'scheduled': return { start: addDays(today, 1), completion: addDays(today, 8) }
    case 'active':    return { start: today,             completion: addDays(today, 7) }
    case 'complete':  return { start: addDays(today, -7), completion: today }
    default:          return { start: today,             completion: addDays(today, 7) }
  }
}

export default function JobsPage() {
  usePageTitle('Jobs')
  const coloredAvatars = usePrefStore(s => s.coloredAvatars)
  const { items: all, loading, hitCap } = useSharedCustomers()

  const now = useNow()

  const [search, setSearch] = useState('')
  // Per-column "show more", so a busy column can be expanded in place rather
  // than sending you to an unfiltered customer list.
  const [expanded, setExpanded] = useState<Partial<Record<JobStage, boolean>>>({})

  // Drag state
  const [draggingId,    setDraggingId]    = useState<string | null>(null)
  const [dragOverStage, setDragOverStage] = useState<JobStage | null>(null)
  const draggingIdRef = useRef<string | null>(null)

  // Date-picker modal for transitions that need a start/completion date
  const [pendingSchedule, setPendingSchedule] = useState<{
    id: string
    targetStage: JobStage
    start: Date
    completion: Date
  } | null>(null)

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return all
    return all.filter(c =>
      fullName(c).toLowerCase().includes(q) ||
      c.salesman.toLowerCase().includes(q) ||
      c.city.toLowerCase().includes(q) ||
      c.job.toLowerCase().includes(q) ||
      c.contractor.toLowerCase().includes(q)
    )
  }, [all, search])

  const columns = useMemo(() => {
    const buckets: Record<JobStage, CustomerItem[]> = {
      pending: [], scheduled: [], active: [], complete: [],
    }
    for (const c of filtered) {
      if (!categoryMatches(c.category, 'Customer') || !c.isActive) continue
      buckets[getStage(c, now)].push(c)
    }
    buckets.scheduled.sort((a, b) => (a.startDate?.getTime() ?? 0) - (b.startDate?.getTime() ?? 0))
    buckets.active.sort((a, b) => (a.completionDate?.getTime() ?? 0) - (b.completionDate?.getTime() ?? 0))
    buckets.complete.sort((a, b) => (b.completionDate?.getTime() ?? 0) - (a.completionDate?.getTime() ?? 0))
    buckets.pending.sort((a, b) => b.creationDate.getTime() - a.creationDate.getTime())
    return buckets
  }, [filtered, now])

  const totalActive = columns.active.reduce((s, c) => s + c.amount, 0)
  const totalComplete = columns.complete.reduce((s, c) => s + c.amount, 0)
  const totalScheduled = columns.scheduled.reduce((s, c) => s + c.amount, 0)
  // Reads the same clock the columns do. This used Date.now() while the buckets
  // used the frozen `now`, so the strip's overdue figure and the red text on
  // the cards could disagree.
  const overdueCount = columns.active.filter(c => c.completionDate && c.completionDate.getTime() < now.getTime()).length

  // Drag handlers
  function onDragStart(id: string) {
    draggingIdRef.current = id
    setDraggingId(id)
  }
  function onDragEnd() {
    draggingIdRef.current = null
    setDraggingId(null)
    setDragOverStage(null)
  }
  function onDragOverCol(e: React.DragEvent, stage: JobStage) {
    e.preventDefault()
    setDragOverStage(stage)
  }
  function onDragLeaveCol() {
    setDragOverStage(null)
  }
  // Drag-and-drop is mouse-only — the HTML5 DnD events this board relies on
  // never fire from a touch gesture, so this is also the tap-to-move path
  // used by JobCard's "⋯" menu on phones/tablets.
  async function moveCard(id: string, targetStage: JobStage) {
    const card = all.find(c => c.id === id)
    if (!card) return

    const fromStage = getStage(card, now)
    if (fromStage === targetStage) return

    if (targetStage === 'pending') {
      await applyJobStageChange(id, null, null)
      return
    }
    if (targetStage === 'complete' && card.startDate) {
      await applyJobStageChange(id, card.startDate, new Date())
      return
    }
    const { start, completion } = defaultDatesFor(targetStage, card.startDate, card.completionDate)
    setPendingSchedule({ id, targetStage, start, completion })
  }

  async function onDropCol(e: React.DragEvent, targetStage: JobStage) {
    e.preventDefault()
    setDragOverStage(null)
    const id = draggingIdRef.current
    if (!id) return
    await moveCard(id, targetStage)
  }

  return (
    <div className="px-4 py-6">
      <PipelineJobsTabs />

      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Jobs</h1>
          <p className="text-sm text-gray-400 mt-0.5">Active customer jobs by stage</p>
        </div>
        <Link to="/customers" className="btn-secondary text-sm px-3 py-1.5">
          View Customers
        </Link>
      </div>

      {/* Search */}
      <input
        type="search"
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="Search by name, salesman, city, or job…"
        className="input-field w-full text-sm py-2 mb-4"
      />

      {hitCap && (
        <div className="bg-yellow-900/20 border border-yellow-600/40 rounded-xl px-4 py-3 text-yellow-300 text-sm mb-4 flex items-start gap-2">
          <Icon d={ICONS.warning} className="w-4 h-4 shrink-0 mt-0.5" />
          Showing the first {REALTIME_LIMIT.toLocaleString()} records only. Some jobs may not appear on this board — contact support to raise this limit.
        </div>
      )}

      {/* Summary strip. It was gated on active/complete/overdue all being zero,
          so a shop that hadn't started anything yet — only Pending and
          Scheduled work — got no summary at all, and neither of those stages
          ever showed a total. Shows whenever there's a job on the board. */}
      {!loading && (columns.pending.length + columns.scheduled.length + columns.active.length + columns.complete.length) > 0 && (
        <div className="flex gap-3 mb-4 flex-wrap">
          {columns.pending.length > 0 && (
            <div className="bg-gray-800 border border-gray-700 rounded-xl px-4 py-2 flex items-center gap-3">
              <span className="text-xs text-gray-300 font-medium tabular-nums">{columns.pending.length} pending</span>
            </div>
          )}
          {columns.scheduled.length > 0 && (
            <div className="bg-blue-900/40 border border-blue-700/40 rounded-xl px-4 py-2 flex items-center gap-3">
              <span className="text-xs text-blue-400 font-medium tabular-nums">{columns.scheduled.length} scheduled</span>
              {totalScheduled > 0 && <span className="text-sm font-semibold text-blue-400 tabular-nums">{formatCurrency(totalScheduled)}</span>}
            </div>
          )}
          {columns.active.length > 0 && (
            <div className="bg-teal-900/30 border border-teal-700/40 rounded-xl px-4 py-2 flex items-center gap-3">
              <span className="text-xs text-teal-400 font-medium tabular-nums">{columns.active.length} in progress</span>
              {totalActive > 0 && <span className="text-sm font-semibold text-teal-400 tabular-nums">{formatCurrency(totalActive)}</span>}
            </div>
          )}
          {overdueCount > 0 && (
            <div className="bg-red-900/30 border border-red-700/40 rounded-xl px-4 py-2 flex items-center gap-3">
              <span className="text-xs text-red-400 font-medium tabular-nums">{overdueCount} overdue</span>
            </div>
          )}
          {columns.complete.length > 0 && (
            <div className="bg-green-900/30 border border-green-700/40 rounded-xl px-4 py-2 flex items-center gap-3">
              <span className="text-xs text-green-400 font-medium tabular-nums">{columns.complete.length} complete</span>
              {totalComplete > 0 && <span className="text-sm font-semibold text-green-400 tabular-nums">{formatCurrency(totalComplete)}</span>}
            </div>
          )}
        </div>
      )}

      {loading ? (
        <div className="flex gap-4 overflow-x-auto pb-4">
          {STAGE_CONFIG.map(s => (
            <div key={s.id} className="shrink-0 w-64 bg-gray-800/50 rounded-2xl p-4 animate-pulse">
              <div className="h-4 bg-gray-700 rounded w-24 mb-4" />
              {[1, 2, 3].map(i => <div key={i} className="h-24 bg-gray-700 rounded-xl mb-2" />)}
            </div>
          ))}
        </div>
      ) : (
        <>
          {/* ── Mobile: vertical grouped list (no drag-and-drop on touch) ── */}
          <div className="md:hidden space-y-6 pb-6">
            {STAGE_CONFIG.map(({ id, label, colorClass, barClass, badgeClass, emptyMsg }) => {
              const items = columns[id]
              return (
                <div key={id}>
                  <div className="flex items-center gap-2 mb-3">
                    <div className={`h-1 w-4 rounded-full ${barClass}`} />
                    <span className={`text-sm font-semibold ${colorClass}`}>{label}</span>
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full tabular-nums ${badgeClass}`}>
                      {items.length}
                    </span>
                  </div>
                  {items.length === 0 ? (
                    <p className="text-xs text-gray-400 pl-6">{emptyMsg}</p>
                  ) : (
                    <div className="space-y-2">
                      {(expanded[id] ? items : items.slice(0, MAX_PER_COL)).map(c => (
                        <JobCard key={c.id} customer={c} stage={id} now={now} coloredAvatars={coloredAvatars}
                          isDragging={false} onDragStart={() => {}} onDragEnd={() => {}} draggable={false}
                          onMove={targetStage => moveCard(c.id, targetStage)} />
                      ))}
                      {items.length > MAX_PER_COL && !expanded[id] && (
                        <button
                          type="button"
                          onClick={() => setExpanded(e => ({ ...e, [id]: true }))}
                          className="block w-full text-xs text-center text-indigo-400 hover:text-indigo-300 py-2"
                        >
                          Show {items.length - MAX_PER_COL} more
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* ── Desktop: horizontal kanban, drag between columns to reschedule ── */}
          <div className="hidden md:flex gap-3 overflow-x-auto pb-4 items-start">
            {STAGE_CONFIG.map(({ id, label, colorClass, barClass, badgeClass, emptyMsg }) => {
              const items = columns[id]
              const shown = expanded[id] ? items : items.slice(0, MAX_PER_COL)
              const overflow = items.length - shown.length
              const isOver = dragOverStage === id
              return (
                <div
                  key={id}
                  onDragOver={e => onDragOverCol(e, id)}
                  onDragLeave={onDragLeaveCol}
                  onDrop={e => onDropCol(e, id)}
                  className={[
                    'shrink-0 w-64 flex flex-col rounded-2xl border overflow-hidden transition-colors',
                    isOver ? 'border-white/20 bg-gray-800/80 ring-2 ring-white/10' : 'bg-gray-900 border-gray-800',
                  ].join(' ')}
                >
                  <div className={`h-1 ${barClass}`} />
                  <div className="flex items-center justify-between px-3 py-3">
                    <span className={`text-sm font-semibold ${colorClass}`}>{label}</span>
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full tabular-nums ${badgeClass}`}>
                      {items.length}
                    </span>
                  </div>
                  {isOver && draggingId && (
                    <div className="mx-2 mb-2 border-2 border-dashed border-white/20 rounded-xl py-2 text-center text-xs text-gray-400">
                      Drop to move to {label}
                    </div>
                  )}
                  <div className="flex flex-col gap-2 px-2 pb-3 overflow-y-auto" style={{ maxHeight: 'calc(100dvh - 240px)' }}>
                    {shown.length === 0 && !isOver ? (
                      <p className="text-xs text-gray-400 text-center py-8">{emptyMsg}</p>
                    ) : (
                      shown.map(c => (
                        <JobCard
                          key={c.id}
                          customer={c}
                          stage={id}
                          now={now}
                          coloredAvatars={coloredAvatars}
                          draggable
                          isDragging={draggingId === c.id}
                          onDragStart={() => onDragStart(c.id)}
                          onDragEnd={onDragEnd}
                          onMove={targetStage => moveCard(c.id, targetStage)}
                        />
                      ))
                    )}
                    {/* Expands the column instead of navigating to an
                        unfiltered customer list, which threw away the stage
                        context you were looking at. */}
                    {overflow > 0 && (
                      <button
                        type="button"
                        onClick={() => setExpanded(e => ({ ...e, [id]: true }))}
                        className="text-xs text-center text-indigo-400 hover:text-indigo-300 py-2 transition-colors
                                   focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded"
                      >
                        Show {overflow} more
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}

      {/* Date picker for transitions that need a start/completion date */}
      {pendingSchedule && (
        <JobScheduleModal
          targetStage={pendingSchedule.targetStage}
          initialStart={pendingSchedule.start}
          initialCompletion={pendingSchedule.completion}
          onConfirm={async (start, completion) => {
            await applyJobStageChange(pendingSchedule.id, start, completion)
            setPendingSchedule(null)
          }}
          onCancel={() => setPendingSchedule(null)}
        />
      )}
    </div>
  )
}

// ─── Date picker modal ──────────────────────────────────────────────────────

function JobScheduleModal({
  targetStage, initialStart, initialCompletion, onConfirm, onCancel,
}: {
  targetStage: JobStage
  initialStart: Date
  initialCompletion: Date
  onConfirm: (start: Date, completion: Date) => void
  onCancel: () => void
}) {
  const [startStr, setStartStr] = useState(toDateInputStr(initialStart))
  const [endStr, setEndStr] = useState(toDateInputStr(initialCompletion))

  const start = startStr ? new Date(`${startStr}T08:00:00`) : null
  const completion = endStr ? new Date(`${endStr}T17:00:00`) : null

  const resultStage = start && completion ? deriveStageFromDates(start, completion, new Date()) : null
  const matches = resultStage === targetStage
  const targetLabel = STAGE_CONFIG.find(s => s.id === targetStage)?.label ?? targetStage
  // The only genuine blocker: a completion on or before the start isn't a
  // schedule at all. Landing in a different column than the one you dropped on
  // is a fact to report, not an error to prevent.
  const canSave = !!start && !!completion && completion > start

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 w-full max-w-xs shadow-2xl">
        <h3 className="text-base font-semibold text-white mb-1">Set Job Dates</h3>
        <p className="text-xs text-gray-400 mb-4">Choose a start and completion date to move this job to {targetLabel}.</p>

        <label className="block text-xs text-gray-400 mb-1">Start date</label>
        <input
          type="date"
          value={startStr}
          onChange={e => setStartStr(e.target.value)}
          className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-white mb-3 focus:outline-none focus:border-orange-500"
        />
        <label className="block text-xs text-gray-400 mb-1">Completion date</label>
        <input
          type="date"
          value={endStr}
          onChange={e => setEndStr(e.target.value)}
          className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-white mb-2 focus:outline-none focus:border-orange-500"
        />

        {/* Says where the dates will file the job, and lets you save anyway.
            Confirm used to be disabled until the dates happened to imply the
            column you dropped on — so the modal took a deliberate action, then
            refused it and asked you to change your mind. The dates are the
            truth; the column follows from them. */}
        {!matches && start && completion && (
          <p className="flex items-start gap-1.5 text-xs text-amber-400 mb-3">
            <Icon d={ICONS.warning} className="w-3.5 h-3.5 shrink-0 mt-px" />
            These dates put this job in "{STAGE_CONFIG.find(s => s.id === resultStage)?.label ?? resultStage}", not {targetLabel}.
          </p>
        )}
        {completion && start && completion <= start && (
          <p className="flex items-start gap-1.5 text-xs text-red-400 mb-3">
            <Icon d={ICONS.warning} className="w-3.5 h-3.5 shrink-0 mt-px" />
            The completion date must be after the start date.
          </p>
        )}

        <div className="flex gap-2 justify-end mt-2">
          <button onClick={onCancel} className="btn-secondary text-sm px-4 py-2">Cancel</button>
          <button
            onClick={() => { if (canSave && start && completion) onConfirm(start, completion) }}
            disabled={!canSave}
            className="btn-primary text-sm px-4 py-2 disabled:opacity-50"
          >
            {matches ? 'Confirm' : `Save as ${STAGE_CONFIG.find(s => s.id === resultStage)?.label ?? resultStage}`}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Card ───────────────────────────────────────────────────────────────────

function JobCard({
  customer: c,
  stage,
  now,
  coloredAvatars,
  draggable,
  isDragging,
  onDragStart,
  onDragEnd,
  onMove,
}: {
  customer: CustomerItem
  stage: JobStage
  /** The page's clock, so the card and the column it sits in agree. It used to
   *  call its own new Date() while the buckets read a frozen one. */
  now: Date
  coloredAvatars: boolean
  draggable: boolean
  isDragging: boolean
  onDragStart: () => void
  onDragEnd: () => void
  onMove: (target: JobStage) => void
}) {
  const name    = fullName(c)
  const initials = [c.first[0], c.lastname[0]].filter(Boolean).join('').toUpperCase()
  const color   = coloredAvatars ? avatarColor(name) : avatarOriginal()

  const daysUntilComplete = stage === 'active' && c.completionDate
    ? Math.ceil((c.completionDate.getTime() - now.getTime()) / DAY_MS)
    : null
  const isOverdue = daysUntilComplete !== null && daysUntilComplete < 0

  // Drag-and-drop doesn't work on touch devices — this menu is how phones
  // and tablets move a card between columns.
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!menuOpen) return
    function onDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [menuOpen])

  return (
    <div
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={[
        'rounded-xl border transition-all flex items-start',
        draggable ? 'cursor-grab active:cursor-grabbing' : '',
        isDragging
          ? 'opacity-40 border-gray-600 bg-gray-800 scale-95'
          : 'bg-gray-800 border-transparent hover:bg-gray-700/80 hover:border-gray-700',
      ].join(' ')}
    >
      <Link
        to={`/records/${c.id}`}
        draggable={false}
        onClick={e => { if (isDragging) e.preventDefault() }}
        className="flex flex-col gap-2 p-3 flex-1 min-w-0"
      >
        {/* Name row */}
        <div className="flex items-center gap-2">
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 overflow-hidden"
            style={{ background: color.bg }}
          >
            {c.photo ? (
              <img src={c.photo} alt={name} className="w-full h-full object-cover" />
            ) : (
              <span className="text-xs font-semibold" style={{ color: color.text }}>{initials || '?'}</span>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-gray-100 truncate">{name || '—'}</p>
            {c.phone && <p className="text-xs text-gray-400 truncate">{c.phone}</p>}
          </div>
          {c.amount > 0 && (
            <span className="text-xs font-semibold text-green-400 shrink-0">{formatCurrency(c.amount)}</span>
          )}
        </div>

        {/* Job / contractor tags */}
        <div className="flex flex-wrap gap-1">
          {c.job && (
            <span className="text-xs bg-gray-700/80 text-gray-300 px-1.5 py-0.5 rounded-full truncate max-w-[120px]">
              {c.job}
            </span>
          )}
          {c.product && (
            <span className="text-xs bg-gray-700/60 text-gray-400 px-1.5 py-0.5 rounded-full truncate max-w-[100px]">
              {c.product}
            </span>
          )}
          {c.contractor && (
            <span className="text-xs bg-indigo-900/40 text-indigo-300 px-1.5 py-0.5 rounded-full truncate max-w-[100px]">
              {c.contractor}
            </span>
          )}
        </div>

        {/* Location only. The directions link moved out of this <Link> — an
            <a> cannot contain another <a>, so the browser was un-nesting them
            and the card's own navigation became unreliable. It now sits in the
            trailing action rail beside the stage menu, which is where the
            other routes put interactive content that can't live inside a link. */}
        {(c.city || c.street) && (
          <p className="text-xs text-gray-400 truncate">{[c.city, c.state].filter(Boolean).join(', ')}</p>
        )}

        {/* Dates */}
        {stage !== 'pending' && (
          <div className="text-xs text-gray-400 space-y-0.5">
            {stage === 'scheduled' && (
              <p>Starts {c.startDate ? fmtDate(c.startDate) : ''}</p>
            )}
            {stage === 'active' && (
              <p className={isOverdue ? 'text-red-400 font-semibold' : ''}>
                {isOverdue
                  ? `${Math.abs(daysUntilComplete!)}d overdue`
                  : `Due ${c.completionDate ? fmtDate(c.completionDate) : ''}`}
              </p>
            )}
            {stage === 'complete' && (
              <p className="text-green-400">Completed {c.completionDate ? fmtDate(c.completionDate) : ''}</p>
            )}
          </div>
        )}

        {/* Salesman */}
        {c.salesman && (
          <p className="text-xs text-gray-400 truncate">{c.salesman}</p>
        )}
      </Link>
      {/* Trailing action rail: the two controls that can't live inside the
          card's <Link>. */}
      <div className="relative shrink-0 flex flex-col items-center gap-1 pt-2 pr-1" ref={menuRef}>
        {(c.city || c.street) && (
          <a
            href={directionsUrl(c)}
            target="_blank"
            rel="noopener noreferrer"
            draggable={false}
            title="Get directions"
            aria-label={`Get directions to ${name || 'this job'}`}
            className="w-7 h-7 flex items-center justify-center rounded-full text-indigo-400 hover:text-indigo-300 hover:bg-gray-700/60 transition-colors
                       focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          >
            <Icon d={ICONS.mapPin} className="w-4 h-4" />
          </a>
        )}
        {/* This is the only way to move a card on a touch device — HTML5 drag
            events never fire from a touch gesture — so it's a real 28px icon
            button rather than a ⋯ text character at 1.94:1. */}
        <button
          type="button"
          onClick={() => setMenuOpen(v => !v)}
          title="Move to another stage"
          aria-label={`Move ${name || 'this job'} to another stage`}
          aria-expanded={menuOpen}
          className="w-7 h-7 flex items-center justify-center rounded-full text-gray-400 hover:text-gray-200 hover:bg-gray-700/60 transition-colors
                     focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        >
          <Icon d={ICONS.ellipsis} className="w-4 h-4" />
        </button>
        {menuOpen && (
          <div className="absolute right-0 top-full mt-1 w-40 bg-gray-900 border border-gray-700 rounded-xl shadow-2xl z-30 overflow-hidden">
            {STAGE_CONFIG.filter(s => s.id !== stage).map(s => (
              <button
                key={s.id}
                type="button"
                onClick={() => { onMove(s.id); setMenuOpen(false) }}
                className="w-full text-left px-3 py-2 text-xs text-gray-200 hover:bg-gray-700/50 transition-colors"
              >
                Move to {s.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
