import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { doc, updateDoc, Timestamp } from 'firebase/firestore'
import { db } from '../../firebase/config'
import { requestLeadScoring, type LeadScore } from '../../services/leadScoreService'
import { fullName, displayName, formatCurrency, categoryMatches, type CustomerItem } from '../../models/customer'
import { REALTIME_LIMIT } from '../../services/customerService'
import { subscribeToPipelineStages } from '../../services/pipelineStageService'
import {
  DEFAULT_STAGES, STAGE_COLOR_CLASSES, effectiveStageId, type PipelineStageConfig,
} from '../../models/pipelineStage'
import {
  bucketByStage, daysSince, filterStale, isStale, orphanedStageId,
  stageTotals, staleCount as countStale, DEFAULT_STALE_DAYS,
} from '../../models/pipelineBoard'
import { usePageTitle } from '../../hooks/usePageTitle'
import { useSharedCustomers } from '../../hooks/useSharedCustomers'
import { useSharedLeadScores } from '../../hooks/useSharedLeadScores'
import { avatarColor, avatarOriginal } from '../../utils/avatarColor'
import { usePrefStore } from '../../stores/prefStore'
import PipelineJobsTabs from '../../components/PipelineJobsTabs'
import ConfirmModal from '../../components/ConfirmModal'
import { Icon, ICONS } from '../../components/Icon'
import { useDismissOnOutside } from '../../hooks/useDismissOnOutside'

// ─── Config ──────────────────────────────────────────────────────────────────

// Cards rendered per column before the "Show more" step. A cap is needed —
// useSharedCustomers allows up to 5,000 records, and an uncapped column would
// mount thousands of nodes — but it's a paging step now, not a dead end.
const PER_COL_PAGE = 30
const COLLECTION  = 'Customers'

function directionsUrl(c: CustomerItem): string {
  const address = [c.street, c.city, c.state].filter(Boolean).join(', ')
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`
}

/**
 * A move writes more than `pipelineStage` — see applyStageChange below. Some of
 * those side effects are irreversible, and the board used to apply them on a
 * single drag with no confirmation and no undo:
 *
 *   - a `lost` stage deactivates the record
 *   - the `new` stage clears `callback` and resets `start` to the epoch, so a
 *     recorded callback flag or appointment date is gone for good — dragging
 *     the card back does not restore it
 *
 * Returns the warning to confirm, or null when the move is safe. A `won` move
 * changes category to Customer but loses nothing and is reversible, and its
 * drop hint already announces it, so it isn't gated.
 */
function destructiveWarning(c: CustomerItem, target: PipelineStageConfig): string | null {
  const who = displayName(c) || 'this record'

  if (target.kind === 'lost') {
    return `Move ${who} to "${target.label}"? This marks the record inactive, so it drops out of the active lists.`
  }

  if (target.id === 'new') {
    const losing: string[] = []
    if (c.callback.trim()) losing.push('the callback flag')
    // A record already reset by this transition carries `start` as the epoch,
    // which parses to a truthy 1970 Date — so check the value, not just null.
    if (c.startDate && c.startDate.getTime() > 0) losing.push('the appointment date')
    if (losing.length === 0) return null
    return `Move ${who} to "${target.label}"? This clears ${losing.join(' and ')}. That can't be undone by moving the card back.`
  }

  return null
}

// ─── Firestore patches ───────────────────────────────────────────────────────

async function applyStageChange(id: string, stage: PipelineStageConfig, apptDate?: Date) {
  const ref = doc(db, COLLECTION, id)
  const updates: Record<string, unknown> = { pipelineStage: stage.id }

  if (stage.kind === 'won') {
    updates.active = '1'
    updates.category = 'Customer'
  } else if (stage.kind === 'lost') {
    updates.active = '0'
  } else {
    updates.active = '1'
    // Preserve the legacy field side-effects for the two default "open"
    // stage ids so the Callback Queue / Funnel pages (which read `callback`
    // directly, not `pipelineStage`) stay in sync for companies that never
    // customized their board.
    if (stage.id === 'new') { updates.category = 'Lead'; updates.callback = ''; updates.start = Timestamp.fromDate(new Date(0)) }
    if (stage.id === 'contacted') { updates.category = 'Lead'; updates.callback = 'Yes' }
  }

  if (stage.requiresDate) {
    if (!apptDate) throw new Error('No date provided')
    updates.start = Timestamp.fromDate(apptDate)
  }

  await updateDoc(ref, updates)
}

// ─── Date picker modal ───────────────────────────────────────────────────────

function ApptModal({ stageLabel, onConfirm, onCancel }: { stageLabel: string; onConfirm: (d: Date) => void; onCancel: () => void }) {
  const [date, setDate] = useState('')
  // Was hardcoded to 08:00 with no way to say otherwise.
  const [time, setTime] = useState('08:00')

  // Escape and a backdrop click, the way the shared ConfirmModal behaves.
  // This modal had neither, and it opens automatically on any drop into a
  // date-driven stage — so a mis-drop trapped you until you found Cancel.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onCancel])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/60" onClick={onCancel} />
      <div className="relative bg-gray-900 border border-gray-700 rounded-2xl p-6 w-full max-w-xs shadow-2xl">
        <h3 className="text-base font-semibold text-white mb-1">Set Date for "{stageLabel}"</h3>
        {/* No `min`: recording an appointment that already happened is a
            normal thing to do, and the field used to forbid it. */}
        <p className="text-xs text-gray-400 mb-4">Past dates are allowed, for logging a visit after the fact.</p>
        <label htmlFor="appt-date" className="text-xs text-gray-400 block mb-1">Date</label>
        <input
          id="appt-date"
          type="date"
          value={date}
          onChange={e => setDate(e.target.value)}
          className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-white mb-3 focus:outline-none focus:border-orange-500"
          autoFocus
        />
        <label htmlFor="appt-time" className="text-xs text-gray-400 block mb-1">Time</label>
        <input
          id="appt-time"
          type="time"
          value={time}
          onChange={e => setTime(e.target.value)}
          className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-white mb-4 focus:outline-none focus:border-orange-500"
        />
        <div className="flex gap-2 justify-end">
          <button onClick={onCancel} className="btn-secondary text-sm px-4 py-2">Cancel</button>
          <button
            onClick={() => { if (date) onConfirm(new Date(`${date}T${time || '08:00'}:00`)) }}
            disabled={!date}
            className="btn-primary text-sm px-4 py-2 disabled:opacity-50"
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function PipelinePage() {
  usePageTitle('Pipeline')
  const coloredAvatars = usePrefStore(s => s.coloredAvatars)

  const { items: allCustomers, loading, hitCap } = useSharedCustomers()
  const all = useMemo(
    () => allCustomers.filter(c => categoryMatches(c.category, 'Lead') || categoryMatches(c.category, 'Customer')),
    [allCustomers],
  )

  const [stages, setStages] = useState<PipelineStageConfig[]>(DEFAULT_STAGES)
  // The going-cold threshold is a company setting now, not a hardcoded 7.
  const [staleDays, setStaleDays] = useState(DEFAULT_STALE_DAYS)
  useEffect(() => subscribeToPipelineStages(
    (s, days) => { setStages(s); setStaleDays(days) },
    () => {},
  ), [])

  const [search, setSearch] = useState('')
  // The going-cold strip was the only filter on a board whose sibling list
  // page has nineteen. A rep's own column view is the one people ask for.
  const [salesmanFilter, setSalesmanFilter] = useState('')
  // The going-cold strip used to be a passive number. It's a filter now, so
  // the count and the per-card pills have distinct jobs rather than both just
  // announcing staleness.
  const [staleOnly, setStaleOnly] = useState(false)
  const salesmen = useMemo(
    () => [...new Set(all.map(c => c.salesman.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [all],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    let items = all
    if (salesmanFilter) items = items.filter(c => c.salesman === salesmanFilter)
    if (!q) return items
    return items.filter(c =>
      fullName(c).toLowerCase().includes(q) ||
      c.companyName.toLowerCase().includes(q) ||
      c.salesman.toLowerCase().includes(q) ||
      c.city.toLowerCase().includes(q)
    )
  }, [all, search, salesmanFilter])

  // Lead scores
  const [scoring,  setScoring]  = useState(false)
  const [scoreErr, setScoreErr] = useState<string | null>(null)
  const [scoreNote, setScoreNote] = useState<string | null>(null)
  const [confirmScore, setConfirmScore] = useState(false)
  const leadScoreDoc = useSharedLeadScores()
  const scores   = leadScoreDoc?.scores ?? {}
  const scoredAt = leadScoreDoc?.scoredAt ?? null

  // Drag state
  const [draggingId,    setDraggingId]    = useState<string | null>(null)
  const [dragOverStage, setDragOverStage] = useState<string | null>(null)
  const draggingIdRef = useRef<string | null>(null)

  // Date-prompt modal (for stages with requiresDate)
  const [pendingDate, setPendingDate] = useState<{ id: string; stage: PipelineStageConfig } | null>(null)
  // Confirmation for moves that write irreversible side effects (see
  // destructiveWarning).
  // How many cards each column currently shows. Keyed by stage id so
  // expanding one column doesn't disturb the others.
  const [colLimits, setColLimits] = useState<Record<string, number>>({})

  const [pendingConfirm, setPendingConfirm] = useState<
    { id: string; stage: PipelineStageConfig; message: string } | null
  >(null)

  /**
   * Scores a sample, and now says so.
   *
   * The callable reads the first 200 company documents and scores at most 60,
   * so on a 300-lead board roughly 60 cards got a badge and nothing
   * distinguished "not scored" from "scored and unremarkable". It's also a
   * paid API call on a one-click button, which is why it confirms first.
   */
  async function handleScoreLeads() {
    setConfirmScore(false)
    setScoring(true)
    setScoreErr(null)
    setScoreNote(null)
    try {
      const { scored, eligible, readCapped } = await requestLeadScoring()
      if (scored === 0) {
        setScoreNote('No active leads to score.')
      } else if (scored < eligible || readCapped) {
        setScoreNote(`Scored the ${scored} newest of ${readCapped ? '200+' : eligible} leads.`)
      } else {
        setScoreNote(`Scored all ${scored} leads.`)
      }
    } catch (e) {
      setScoreErr(e instanceof Error ? e.message : 'Scoring failed')
    } finally {
      setScoring(false)
    }
  }

  // Bucketed by stage, before the going-cold filter. staleCount is derived from
  // this so the filter's own label doesn't change when you switch it on.
  const columnsAll = useMemo(() => bucketByStage(filtered, stages), [filtered, stages])

  // Staleness depends on the stage kind, so it can only be applied after
  // bucketing — not in the search-level `filtered` memo.
  const columns = useMemo(
    () => staleOnly ? filterStale(columnsAll, stages, staleDays) : columnsAll,
    [columnsAll, stages, staleOnly, staleDays],
  )

  /**
   * Count and money per stage, from the buckets actually on screen.
   *
   * Only the Won column had a total, and it was computed from the unfiltered
   * buckets — so with the going-cold filter on (which empties Won entirely,
   * since a won record can't be stale) the column read "0" and "$45,000
   * total" at the same time. Deriving both from `columns` makes that
   * impossible.
   */
  const totals = useMemo(() => stageTotals(columns, stages), [columns, stages])
  const staleCount = useMemo(
    () => countStale(columnsAll, stages, staleDays),
    [columnsAll, stages, staleDays],
  )

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
  function onDragOverCol(e: React.DragEvent, stageId: string) {
    e.preventDefault()
    setDragOverStage(stageId)
  }
  function onDragLeaveCol() {
    setDragOverStage(null)
  }
  // Drag-and-drop is mouse-only — the HTML5 DnD events this board relies on
  // never fire from a touch gesture, so this is also the tap-to-move path
  // used by PipelineCard's stage menu on phones/tablets.
  async function moveCard(id: string, targetStage: PipelineStageConfig) {
    const card = all.find(c => c.id === id)
    if (!card) return

    const fromStage = effectiveStageId(card, stages)
    if (fromStage === targetStage.id) return

    const warning = destructiveWarning(card, targetStage)
    if (warning) {
      // Gate before writing, not after. The card stays where it is until the
      // move is confirmed, so a mis-drop costs nothing.
      setPendingConfirm({ id, stage: targetStage, message: warning })
      return
    }

    if (targetStage.requiresDate) {
      setPendingDate({ id, stage: targetStage })
    } else {
      await applyStageChange(id, targetStage)
    }
  }

  // Runs after the user confirms a destructive move; picks up the date prompt
  // if the target stage also needs one.
  async function commitPendingConfirm() {
    if (!pendingConfirm) return
    const { id, stage } = pendingConfirm
    setPendingConfirm(null)
    if (stage.requiresDate) {
      setPendingDate({ id, stage })
    } else {
      await applyStageChange(id, stage)
    }
  }

  async function onDropCol(e: React.DragEvent, targetStage: PipelineStageConfig) {
    e.preventDefault()
    setDragOverStage(null)
    const id = draggingIdRef.current
    if (!id) return
    await moveCard(id, targetStage)
  }

  return (
    <div className="px-4 py-6 flex flex-col h-full">
      <PipelineJobsTabs />

      {/* Header */}
      <div className="flex items-start justify-between mb-4 shrink-0 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Pipeline</h1>
          {/* The old copy — "Drag cards between stages to update" — is simply
              untrue on touch, where HTML5 drag events never fire. */}
          <p className="text-sm text-gray-400 mt-0.5">Drag a card to change its stage, or use the card menu</p>
          {/* This read `scoredAt.getTime() > 86_400_000`, which asks whether
              the timestamp falls after 2 Jan 1970 — true for every real date,
              so the caption rendered permanently. The 86_400_000 constant only
              makes sense as an age threshold, so the intent was clearly "only
              mention the date once the scores are more than a day old". Now it
              appears when the scores are actually stale, which is the one time
              it's worth saying. */}
          {scoredAt && Date.now() - scoredAt.getTime() > 86_400_000 && (
            <p className="text-xs text-gray-400 mt-0.5">
              AI scores from {scoredAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {scoreErr && (
            <span className="text-xs text-red-400">{scoreErr}</span>
          )}
          {!scoreErr && scoreNote && (
            <span className="text-xs text-gray-400">{scoreNote}</span>
          )}
          <button
            onClick={() => setConfirmScore(true)}
            disabled={scoring}
            title="Score all leads with AI to see which are most likely to convert"
            className="flex items-center gap-1.5 btn-secondary text-sm px-3 py-1.5 disabled:opacity-60"
          >
            {scoring ? (
              <>
                <span className="w-3.5 h-3.5 border-2 border-violet-400 border-t-transparent rounded-full animate-spin" />
                Scoring…
              </>
            ) : (
              <>
                <Icon d={ICONS.sparkle} className="w-3.5 h-3.5 text-violet-400" />
                AI Score
              </>
            )}
          </button>
          <Link to="/pipeline/stages" className="btn-secondary text-sm px-3 py-1.5 inline-flex items-center gap-1.5">
            <Icon d={[ICONS.cog, ICONS.cogInner]} className="w-4 h-4" />
            Stages
          </Link>
          <Link to="/leads" className="btn-secondary text-sm px-3 py-1.5">View List</Link>
        </div>
      </div>

      {/* Search. The placeholder omitted company name, which the filter has
          always searched — so matching a business looked like luck. */}
      <div className="flex gap-2 mb-3 shrink-0">
        <input
          type="search"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by name, company, salesman, or city…"
          aria-label="Search the pipeline by name, company, salesman or city"
          className="input-field flex-1 min-w-0 text-sm py-2"
        />
        {salesmen.length > 0 && (
          <select
            value={salesmanFilter}
            onChange={e => setSalesmanFilter(e.target.value)}
            aria-label="Filter by salesman"
            className="input-field text-sm py-2 shrink-0 w-36 sm:w-44 cursor-pointer"
          >
            <option value="">All salesmen</option>
            {salesmen.map(name => <option key={name} value={name}>{name}</option>)}
          </select>
        )}
      </div>

      {hitCap && (
        <div className="bg-yellow-900/20 border border-yellow-600/40 rounded-xl px-4 py-3 text-yellow-300 text-sm mb-3 shrink-0">
          <span className="flex items-start gap-2">
            <Icon d={ICONS.warning} className="w-4 h-4 shrink-0 mt-0.5" />
            <span>Showing the first {REALTIME_LIMIT.toLocaleString()} records only. Some leads may not appear on this board — contact support to raise this limit.</span>
          </span>
        </div>
      )}

      {/* A filter, not a read-out. It used to be a static amber box stating a
          number you couldn't act on, while every affected card already carried
          its own amber "Nd cold" pill — two elements announcing the same thing,
          neither of which did anything. Now the strip narrows the board and the
          pills mark the individual cards. */}
      {!loading && staleCount > 0 && (
        <div className="flex gap-3 mb-4 flex-wrap shrink-0">
          <button
            type="button"
            onClick={() => setStaleOnly(v => !v)}
            aria-pressed={staleOnly}
            className={`rounded-xl px-4 py-2 flex items-center gap-2 border text-xs font-medium transition-colors ${
              staleOnly
                ? 'bg-amber-500/20 border-amber-500/60 text-amber-200'
                : 'bg-amber-900/30 border-amber-700/40 text-amber-400 hover:bg-amber-900/50'
            }`}
          >
            <Icon d={ICONS.clock} className="w-3.5 h-3.5" />
            <span className="tabular-nums">{staleCount}</span>
            going cold ({staleDays}d+ no update)
            {staleOnly && <span className="text-amber-300/80">· showing only these</span>}
          </button>
        </div>
      )}

      {/* When the filter empties a board that isn't actually empty, say why. */}
      {!loading && staleOnly && staleCount === 0 && (
        <p className="text-xs text-gray-400 mb-4 shrink-0">No cards are going cold.</p>
      )}

      {/* Board */}
      {loading ? (
        <div className="flex gap-3 overflow-x-auto pb-4 flex-1 min-h-0">
          {stages.map(s => (
            <div key={s.id} className="shrink-0 w-64 bg-gray-800/50 rounded-2xl p-4 animate-pulse">
              <div className="h-4 bg-gray-700 rounded w-24 mb-4" />
              {[1, 2, 3].map(i => <div key={i} className="h-20 bg-gray-700 rounded-xl mb-2" />)}
            </div>
          ))}
        </div>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-4 flex-1 min-h-0">
          {stages.map(stage => {
            const { id, label, kind } = stage
            const colors = STAGE_COLOR_CLASSES[stage.colorKey]
            const items    = columns[id] ?? []
            const total    = totals[id] ?? { count: 0, value: 0 }
            const limit    = colLimits[id] ?? PER_COL_PAGE
            const shown    = items.slice(0, limit)
            const overflow = items.length - shown.length
            const isOver   = dragOverStage === id

            return (
              <div
                key={id}
                onDragOver={e => onDragOverCol(e, id)}
                onDragLeave={onDragLeaveCol}
                onDrop={e => onDropCol(e, stage)}
                className={[
                  // Fills can't carry this: the whole 950/900/800 range spans
                  // 1.37:1, so the column read as page background with text on
                  // it. border-gray-500 is 4.16:1 against the page and 3.67:1
                  // against its own fill — a boundary you can actually see.
                  // overflow-hidden is gone: it clipped the card menu, which is
                  // the only way to move a card on touch.
                  'shrink-0 w-64 max-h-full flex flex-col rounded-2xl border-2 transition-colors',
                  isOver
                    // Was bg-gray-800/80 + ring-white/10: 1.11:1 against the
                    // normal column, i.e. no drop feedback at all on a
                    // drag-and-drop board. indigo-500 is 4.51:1 on the page.
                    ? 'border-indigo-500 bg-indigo-500/10 ring-2 ring-indigo-500/60'
                    : 'bg-gray-900 border-gray-500',
                ].join(' ')}
              >
                <div className={`h-1 rounded-t-xl ${colors.bar}`} />

                <div className="flex items-center justify-between px-3 py-3">
                  <span className={`stage-label text-sm font-semibold ${colors.text}`}>{label}</span>
                  {/* Neutral, not the stage hue. White-on-badge failed AA in
                      dark mode for 5 of the 14 palette colours (amber 3.19,
                      green 3.30, orange 3.56, teal 3.74, emerald 3.77), and
                      `text-white` resolves to the themed --color-white, which
                      index.css has no override for on blue/emerald/pink/
                      purple/rose-600 — so those rendered dark navy on a
                      saturated fill in light mode. The stage's hue is already
                      carried by the top bar and the label, both of which pass
                      everywhere; a count doesn't need to re-encode it. */}
                  <span className="text-xs font-bold text-gray-200 bg-gray-700 px-2 py-0.5 rounded-full tabular-nums">
                    {total.count}
                  </span>
                </div>

                {/* Every stage, not just Won. "How much is sitting in
                    Contacted" is the question a board exists to answer, and
                    only one column answered it. Both numbers come from the
                    same buckets, so they can't disagree. */}
                {total.value > 0 && (
                  <p className={`px-3 -mt-2 pb-2 text-xs font-medium tabular-nums ${
                    kind === 'won' ? 'text-green-400' : 'text-gray-300'
                  }`}>
                    {formatCurrency(total.value)}
                  </p>
                )}

                {/* Drop target hint */}
                {isOver && draggingId && (
                  <div className="mx-2 mb-2 border-2 border-dashed border-indigo-400 rounded-xl py-2 text-center text-xs text-indigo-300">
                    {kind === 'won' ? 'Convert to Customer' : kind === 'lost' ? 'Mark Inactive' : `Move to ${label}`}
                  </div>
                )}

                {/* Height comes from the flex chain now, not a magic number.
                    calc(100vh - 230px) had to manually track the tabs, header,
                    search field and two conditional banners above it, so the
                    offset was already wrong whenever the record-cap or
                    going-cold strip rendered. */}
                {/* overflow-y-auto stays here, but the card menu is portalled to
                    the body so this container can't clip it. */}
                <div className="flex flex-col gap-2 px-2 pb-3 overflow-y-auto flex-1 min-h-0">
                  {shown.length === 0 && !isOver ? (
                    <p className="text-xs text-gray-400 text-center py-8">No records</p>
                  ) : (
                    shown.map(c => (
                      <PipelineCard
                        key={c.id}
                        customer={c}
                        coloredAvatars={coloredAvatars}
                        stage={stage}
                        allStages={stages}
                        staleDays={staleDays}
                        score={scores[c.id] ?? null}
                        isDragging={draggingId === c.id}
                        onDragStart={() => onDragStart(c.id)}
                        onDragEnd={onDragEnd}
                        onMove={targetStage => moveCard(c.id, targetStage)}
                      />
                    ))
                  )}
                  {/* Expands in place. This used to be a link out to /leads or
                      /customers, so seeing the rest of a stage meant leaving
                      the board and losing the stage context entirely — and the
                      board silently wasn't showing the whole pipeline. */}
                  {overflow > 0 && (
                    <button
                      type="button"
                      onClick={() => setColLimits(prev => ({ ...prev, [id]: limit + PER_COL_PAGE }))}
                      className="text-xs text-center text-indigo-400 hover:text-indigo-300 hover:bg-gray-800/60 rounded-lg py-2 transition-colors"
                    >
                      Show {Math.min(overflow, PER_COL_PAGE)} more
                      <span className="text-gray-400"> · {overflow} hidden</span>
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      <ConfirmModal
        isOpen={pendingConfirm !== null}
        message={pendingConfirm?.message ?? ''}
        confirmLabel="Move card"
        onConfirm={commitPendingConfirm}
        onCancel={() => setPendingConfirm(null)}
      />

      {/* A paid API call behind a one-click button, with no rate limiting on
          the callable until this pass. It also only covers a sample, so the
          dialog says what it will actually do. */}
      <ConfirmModal
        isOpen={confirmScore}
        message={
          'Score leads with AI? This sends the newest leads on this board to the AI service and overwrites the existing scores. ' +
          'It covers the 60 newest leads per run, not the whole board, and is limited to 40 runs a day.'
        }
        confirmLabel="Score leads"
        tone="primary"
        onConfirm={handleScoreLeads}
        onCancel={() => setConfirmScore(false)}
      />

      {/* Date-prompt modal */}
      {pendingDate && (
        <ApptModal
          stageLabel={pendingDate.stage.label}
          onConfirm={async (date) => {
            await applyStageChange(pendingDate.id, pendingDate.stage, date)
            setPendingDate(null)
          }}
          onCancel={() => setPendingDate(null)}
        />
      )}
    </div>
  )
}

// ─── Card ─────────────────────────────────────────────────────────────────────

function ScoreBadge({ score }: { score: LeadScore }) {
  const s = score.score
  const [color, bg] = s >= 8 ? ['text-green-400', 'bg-green-900/40']
    : s >= 5 ? ['text-amber-400', 'bg-amber-900/40']
    : ['text-red-400', 'bg-red-900/40']
  return (
    // rounded-full to match the sibling pills, and "/10" so the scale reads
    // without hovering — a bare "8" gave no clue what it was out of.
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full ${bg} shrink-0 cursor-help`}
      title={score.reason}
    >
      <Icon d={ICONS.sparkle} className={`w-3 h-3 ${color}`} />
      <span className={`text-xs font-bold tabular-nums ${color}`}>{s}/10</span>
    </span>
  )
}

function PipelineCard({
  customer: c,
  coloredAvatars,
  stage,
  allStages,
  staleDays,
  score,
  isDragging,
  onDragStart,
  onDragEnd,
  onMove,
}: {
  customer: CustomerItem
  coloredAvatars: boolean
  stage: PipelineStageConfig
  allStages: PipelineStageConfig[]
  staleDays: number
  score: LeadScore | null
  isDragging: boolean
  onDragStart: () => void
  onDragEnd: () => void
  onMove: (target: PipelineStageConfig) => void
}) {
  // A company name titles the card; the person's name moves to the subtitle.
  const hasCompany = c.companyName.trim() !== ''
  const name    = displayName(c)
  const initials = hasCompany
    ? name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase()
    : [c.first[0], c.lastname[0]].filter(Boolean).join('').toUpperCase()
  const subtitle = [hasCompany ? fullName(c) : '', c.phone].filter(Boolean).join(' · ')
  const color   = coloredAvatars ? avatarColor(name) : avatarOriginal()
  const apptLabel = stage.requiresDate && c.startDate
    ? c.startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : null
  const stale = isStale(c, stage, staleDays)
  // Its stored stage no longer exists in the config, so effectiveStageId put
  // it in the first column — where it looks like new business.
  const orphaned = orphanedStageId(c, allStages)

  /**
   * Drag-and-drop doesn't work on touch devices — this menu is how phones and
   * tablets move a card between columns, which is why it can't be allowed to
   * clip.
   *
   * It was absolutely positioned inside the column's own `overflow-y-auto`
   * body, under a column with `overflow-hidden`. Both ancestors clipped it, so
   * for any card in the lower part of a column the menu was cut off — and with
   * four or five stages that's most of the column. Portalled to the body with
   * a fixed position measured off the button, it can't be clipped by anything.
   */
  const [menuOpen, setMenuOpen] = useState(false)
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)

  const closeMenu = useCallback(() => setMenuOpen(false), [])
  useDismissOnOutside(menuRef, closeMenu, menuOpen)

  const MENU_W = 176
  const openMenu = useCallback(() => {
    const r = btnRef.current?.getBoundingClientRect()
    if (!r) return
    const itemCount = allStages.length - 1
    const height = Math.max(itemCount, 1) * 38 + 8
    // Flip above the button when there isn't room below, and keep the panel
    // inside the viewport horizontally.
    const below = window.innerHeight - r.bottom
    const top = below < height + 8 ? Math.max(8, r.top - height - 4) : r.bottom + 4
    const left = Math.min(Math.max(8, r.right - MENU_W), window.innerWidth - MENU_W - 8)
    setMenuPos({ top, left })
    setMenuOpen(true)
  }, [allStages.length])

  // A scroll or resize invalidates a fixed position measured from the button.
  useEffect(() => {
    if (!menuOpen) return
    function reposition() { setMenuOpen(false) }
    window.addEventListener('scroll', reposition, true)
    window.addEventListener('resize', reposition)
    return () => {
      window.removeEventListener('scroll', reposition, true)
      window.removeEventListener('resize', reposition)
    }
  }, [menuOpen])

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={[
        'rounded-xl border transition-all cursor-grab active:cursor-grabbing flex items-start',
        isDragging
          ? 'opacity-40 border-gray-500 bg-gray-800 scale-95'
          // border-transparent meant the card had no edge at all until hover,
          // on a fill only 1.21:1 from the column behind it. gray-600 is
          // 1.94:1 against the card — reinforced by the fill step and the gap,
          // and deliberately a tier below the column's gray-500 so the
          // hierarchy still reads.
          : 'bg-gray-800 border-gray-600 hover:bg-gray-700/80 hover:border-gray-500',
      ].join(' ')}
    >
      <Link
        to={`/records/${c.id}`}
        draggable={false}
        onClick={e => { if (isDragging) e.preventDefault() }}
        className="flex flex-col gap-2 p-3 flex-1 min-w-0"
      >
        <div className="flex items-center gap-2">
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 overflow-hidden"
            style={{ background: color.bg }}
          >
            {c.photo
              ? <img src={c.photo} alt={name} className="w-full h-full object-cover" />
              : <span className="text-xs font-semibold" style={{ color: color.text }}>{initials || '?'}</span>}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-gray-100 truncate">{name || '—'}</p>
            {subtitle && <p className="text-xs text-gray-400 truncate">{subtitle}</p>}
          </div>
          {/* Money only. The AI score used to share this corner, so a card
              with both had a currency figure and a 0-10 score competing for
              one slot. The score is a qualifier, so it moved to the pill row
              below with the other qualifiers. */}
          {c.amount > 0 && (
            <span className="text-xs font-semibold text-green-400 shrink-0 tabular-nums">{formatCurrency(c.amount)}</span>
          )}
        </div>

        {(c.salesman || apptLabel || stale || score || orphaned) && (
          <div className="flex flex-wrap gap-1">
            {/* Rename or delete a stage and an arbitrary set of records
                silently reappears at the top of the funnel. Say so. */}
            {orphaned && (
              <span
                title={`This record's stage "${orphaned}" no longer exists, so it's shown in the first column. Move it to set a current stage.`}
                className="text-xs bg-red-500/20 text-red-300 px-1.5 py-0.5 rounded-full inline-flex items-center gap-1 cursor-help"
              >
                <Icon d={ICONS.warning} className="w-3 h-3" />
                Stage removed
              </span>
            )}
            {score && <ScoreBadge score={score} />}
            {c.salesman && (
              <span className="text-xs bg-gray-700/80 text-gray-300 px-1.5 py-0.5 rounded-full">{c.salesman}</span>
            )}
            {apptLabel && (
              <span className="text-xs bg-orange-900/40 text-orange-300 px-1.5 py-0.5 rounded-full inline-flex items-center gap-1">
                <Icon d={ICONS.calendar} className="w-3 h-3" />
                {apptLabel}
              </span>
            )}
            {stale && (
              <span className="text-xs bg-amber-900/40 text-amber-300 px-1.5 py-0.5 rounded-full inline-flex items-center gap-1">
                <Icon d={ICONS.clock} className="w-3 h-3" />
                {daysSince(c.lastUpdateDate)}d cold
              </span>
            )}
          </div>
        )}

        {(c.city || c.street) && stage.kind !== 'won' && (
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-gray-400 truncate">{[c.city, c.state].filter(Boolean).join(', ')}</p>
            <a
              href={directionsUrl(c)}
              target="_blank"
              rel="noopener noreferrer"
              onClick={e => e.stopPropagation()}
              title="Get directions"
              className="text-indigo-400 hover:text-indigo-300 shrink-0"
            >
              <Icon d={ICONS.mapPin} className="w-3.5 h-3.5" />
              <span className="sr-only">Directions to {name || 'this record'}</span>
            </a>
          </div>
        )}
      </Link>
      <div className="shrink-0 pt-2 pr-1">
        {/* Drag-and-drop never fires from a touch gesture, so on phones and
            tablets this is the only way to move a card. It was a 24px "⋯"
            character at text-gray-500 (3.04:1) — the primary interaction on
            half the devices, rendered as the least visible thing on the card.
            Now a 32px SVG button at 5.78:1 with a persistent surface. */}
        <button
          ref={btnRef}
          type="button"
          onClick={() => (menuOpen ? setMenuOpen(false) : openMenu())}
          aria-label={`Move ${name || 'record'} to another stage`}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          className={`w-8 h-8 flex items-center justify-center rounded-lg border transition-colors ${
            menuOpen
              ? 'bg-gray-700 border-gray-600 text-gray-100'
              : 'bg-gray-800/60 border-gray-700 text-gray-400 hover:text-gray-100 hover:bg-gray-700'
          }`}
        >
          <Icon d={ICONS.ellipsis} className="w-4 h-4" />
        </button>
        {menuOpen && menuPos && createPortal(
          <div
            ref={menuRef}
            role="menu"
            style={{ position: 'fixed', top: menuPos.top, left: menuPos.left, width: MENU_W }}
            className="bg-gray-900 border border-gray-600 rounded-xl shadow-2xl z-[60] overflow-hidden"
          >
            {allStages.filter(s => s.id !== stage.id).map(s => (
              <button
                key={s.id}
                type="button"
                role="menuitem"
                onClick={() => { onMove(s); setMenuOpen(false) }}
                className="w-full text-left px-3 py-2.5 text-xs text-gray-200 hover:bg-gray-700/50 transition-colors"
              >
                Move to {s.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
      </div>
    </div>
  )
}
