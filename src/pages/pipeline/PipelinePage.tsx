import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { doc, updateDoc, Timestamp } from 'firebase/firestore'
import { db } from '../../firebase/config'
import { requestLeadScoring, type LeadScore } from '../../services/leadScoreService'
import { fullName, formatCurrency, categoryMatches, type CustomerItem } from '../../models/customer'
import { REALTIME_LIMIT } from '../../services/customerService'
import { subscribeToPipelineStages } from '../../services/pipelineStageService'
import {
  DEFAULT_STAGES, STAGE_COLOR_CLASSES, effectiveStageId, type PipelineStageConfig,
} from '../../models/pipelineStage'
import { usePageTitle } from '../../hooks/usePageTitle'
import { useSharedCustomers } from '../../hooks/useSharedCustomers'
import { useSharedLeadScores } from '../../hooks/useSharedLeadScores'
import { avatarColor, avatarOriginal } from '../../utils/avatarColor'
import { usePrefStore } from '../../stores/prefStore'
import PipelineJobsTabs from '../../components/PipelineJobsTabs'

// ─── Config ──────────────────────────────────────────────────────────────────

const MAX_PER_COL = 30
const COLLECTION  = 'Customers'
const DAY_MS = 86_400_000
const STALE_DAYS = 7

function directionsUrl(c: CustomerItem): string {
  const address = [c.street, c.city, c.state].filter(Boolean).join(', ')
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`
}

// Open (non-won/lost) stages with no update in a while are going cold — flag
// them so they don't just quietly sit in the board unnoticed.
function isStale(c: CustomerItem, stage: PipelineStageConfig | undefined): boolean {
  if (!stage || stage.kind !== 'open') return false
  return Date.now() - c.lastUpdateDate.getTime() > STALE_DAYS * DAY_MS
}
function daysSince(d: Date): number {
  return Math.floor((Date.now() - d.getTime()) / DAY_MS)
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
  const today = new Date().toISOString().slice(0, 10)
  const [val, setVal] = useState('')
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 w-full max-w-xs shadow-2xl">
        <h3 className="text-base font-semibold text-white mb-1">Set Date for "{stageLabel}"</h3>
        <p className="text-xs text-gray-400 mb-4">Pick a date for this stage.</p>
        <input
          type="date"
          min={today}
          value={val}
          onChange={e => setVal(e.target.value)}
          className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-white mb-4 focus:outline-none focus:border-orange-500"
          autoFocus
        />
        <div className="flex gap-2 justify-end">
          <button onClick={onCancel} className="btn-secondary text-sm px-4 py-2">Cancel</button>
          <button
            onClick={() => { if (val) onConfirm(new Date(val + 'T08:00:00')) }}
            disabled={!val}
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
  useEffect(() => subscribeToPipelineStages(setStages, () => {}), [])

  const [search, setSearch] = useState('')
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return all
    return all.filter(c =>
      fullName(c).toLowerCase().includes(q) ||
      c.salesman.toLowerCase().includes(q) ||
      c.city.toLowerCase().includes(q)
    )
  }, [all, search])

  // Lead scores
  const [scoring,  setScoring]  = useState(false)
  const [scoreErr, setScoreErr] = useState<string | null>(null)
  const leadScoreDoc = useSharedLeadScores()
  const scores   = leadScoreDoc?.scores ?? {}
  const scoredAt = leadScoreDoc?.scoredAt ?? null

  // Drag state
  const [draggingId,    setDraggingId]    = useState<string | null>(null)
  const [dragOverStage, setDragOverStage] = useState<string | null>(null)
  const draggingIdRef = useRef<string | null>(null)

  // Date-prompt modal (for stages with requiresDate)
  const [pendingDate, setPendingDate] = useState<{ id: string; stage: PipelineStageConfig } | null>(null)

  async function handleScoreLeads() {
    setScoring(true)
    setScoreErr(null)
    try {
      await requestLeadScoring()
    } catch (e) {
      setScoreErr(e instanceof Error ? e.message : 'Scoring failed')
    } finally {
      setScoring(false)
    }
  }

  const columns = useMemo(() => {
    const buckets: Record<string, CustomerItem[]> = {}
    for (const s of stages) buckets[s.id] = []
    for (const c of filtered) {
      const stageId = effectiveStageId(c, stages)
      ;(buckets[stageId] ??= []).push(c)
    }
    for (const s of stages) {
      if (s.requiresDate) {
        buckets[s.id].sort((a, b) => (a.startDate?.getTime() ?? 0) - (b.startDate?.getTime() ?? 0))
      } else {
        buckets[s.id].sort((a, b) => b.creationDate.getTime() - a.creationDate.getTime())
      }
    }
    return buckets
  }, [filtered, stages])

  const wonStage = useMemo(() => stages.find(s => s.kind === 'won'), [stages])
  const wonAmount = useMemo(
    () => wonStage ? (columns[wonStage.id] ?? []).reduce((s, c) => s + c.amount, 0) : 0,
    [columns, wonStage],
  )
  const staleCount = useMemo(() => {
    let n = 0
    for (const s of stages) {
      if (s.kind !== 'open') continue
      n += (columns[s.id] ?? []).filter(c => isStale(c, s)).length
    }
    return n
  }, [columns, stages])

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
  // used by PipelineCard's "⋯" menu on phones/tablets.
  async function moveCard(id: string, targetStage: PipelineStageConfig) {
    const card = all.find(c => c.id === id)
    if (!card) return

    const fromStage = effectiveStageId(card, stages)
    if (fromStage === targetStage.id) return

    if (targetStage.requiresDate) {
      setPendingDate({ id, stage: targetStage })
    } else {
      await applyStageChange(id, targetStage)
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
          <p className="text-sm text-gray-400 mt-0.5">Drag cards between stages to update</p>
          {scoredAt && scoredAt.getTime() > 86_400_000 && (
            <p className="text-xs text-gray-600 mt-0.5">
              AI scores from {scoredAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {scoreErr && (
            <span className="text-xs text-red-400">{scoreErr}</span>
          )}
          <button
            onClick={handleScoreLeads}
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
                <span className="text-violet-400">✦</span>
                AI Score
              </>
            )}
          </button>
          <Link to="/pipeline/stages" className="btn-secondary text-sm px-3 py-1.5">⚙️ Stages</Link>
          <Link to="/leads" className="btn-secondary text-sm px-3 py-1.5">View List</Link>
        </div>
      </div>

      {/* Search */}
      <input
        type="search"
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="Search by name, salesman, or city…"
        className="input-field w-full text-sm py-2 mb-3 shrink-0"
      />

      {hitCap && (
        <div className="bg-yellow-900/20 border border-yellow-600/40 rounded-xl px-4 py-3 text-yellow-300 text-sm mb-3 shrink-0">
          ⚠ Showing the first {REALTIME_LIMIT.toLocaleString()} records only. Some leads may not appear on this board — contact support to raise this limit.
        </div>
      )}

      {/* Summary strip */}
      {!loading && staleCount > 0 && (
        <div className="flex gap-3 mb-4 flex-wrap shrink-0">
          <div className="bg-amber-900/30 border border-amber-700/40 rounded-xl px-4 py-2 flex items-center gap-3">
            <span className="text-xs text-amber-400 font-medium">{staleCount} going cold (7d+ no update)</span>
          </div>
        </div>
      )}

      {/* Board */}
      {loading ? (
        <div className="flex gap-4 overflow-x-auto pb-4">
          {stages.map(s => (
            <div key={s.id} className="shrink-0 w-64 bg-gray-800/50 rounded-2xl p-4 animate-pulse">
              <div className="h-4 bg-gray-700 rounded w-24 mb-4" />
              {[1, 2, 3].map(i => <div key={i} className="h-20 bg-gray-700 rounded-xl mb-2" />)}
            </div>
          ))}
        </div>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-4 flex-1 items-start min-h-0">
          {stages.map(stage => {
            const { id, label, kind } = stage
            const colors = STAGE_COLOR_CLASSES[stage.colorKey]
            const items    = columns[id] ?? []
            const shown    = items.slice(0, MAX_PER_COL)
            const overflow = items.length - shown.length
            const isOver   = dragOverStage === id

            return (
              <div
                key={id}
                onDragOver={e => onDragOverCol(e, id)}
                onDragLeave={onDragLeaveCol}
                onDrop={e => onDropCol(e, stage)}
                className={[
                  'shrink-0 w-64 flex flex-col rounded-2xl border overflow-hidden transition-colors',
                  isOver
                    ? 'border-white/20 bg-gray-800/80 ring-2 ring-white/10'
                    : 'bg-gray-900 border-gray-800',
                ].join(' ')}
              >
                <div className={`h-1 ${colors.bar}`} />

                <div className="flex items-center justify-between px-3 py-3">
                  <span className={`text-sm font-semibold ${colors.text}`}>{label}</span>
                  <span className={`text-xs font-bold text-white px-2 py-0.5 rounded-full ${colors.badge}`}>
                    {items.length}
                  </span>
                </div>

                {kind === 'won' && wonAmount > 0 && id === wonStage?.id && (
                  <p className="px-3 -mt-2 pb-2 text-xs text-green-400 font-medium">
                    {formatCurrency(wonAmount)} total
                  </p>
                )}

                {/* Drop target hint */}
                {isOver && draggingId && (
                  <div className="mx-2 mb-2 border-2 border-dashed border-white/20 rounded-xl py-2 text-center text-xs text-gray-400">
                    {kind === 'won' ? 'Convert to Customer' : kind === 'lost' ? 'Mark Inactive' : `Move to ${label}`}
                  </div>
                )}

                <div className="flex flex-col gap-2 px-2 pb-3 overflow-y-auto" style={{ maxHeight: 'calc(100vh - 230px)' }}>
                  {shown.length === 0 && !isOver ? (
                    <p className="text-xs text-gray-500 text-center py-8">No records</p>
                  ) : (
                    shown.map(c => (
                      <PipelineCard
                        key={c.id}
                        customer={c}
                        coloredAvatars={coloredAvatars}
                        stage={stage}
                        allStages={stages}
                        score={scores[c.id] ?? null}
                        isDragging={draggingId === c.id}
                        onDragStart={() => onDragStart(c.id)}
                        onDragEnd={onDragEnd}
                        onMove={targetStage => moveCard(c.id, targetStage)}
                      />
                    ))
                  )}
                  {overflow > 0 && (
                    <Link
                      to={kind === 'won' ? '/customers' : '/leads'}
                      className="text-xs text-center text-indigo-400 hover:text-indigo-300 py-2 transition-colors"
                    >
                      +{overflow} more →
                    </Link>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

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
    <div className={`flex items-center gap-1 px-1.5 py-0.5 rounded-md ${bg} shrink-0`} title={score.reason}>
      <span className="text-[10px]">✦</span>
      <span className={`text-[11px] font-bold ${color}`}>{s}</span>
    </div>
  )
}

function PipelineCard({
  customer: c,
  coloredAvatars,
  stage,
  allStages,
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
  score: LeadScore | null
  isDragging: boolean
  onDragStart: () => void
  onDragEnd: () => void
  onMove: (target: PipelineStageConfig) => void
}) {
  const name    = fullName(c)
  const initials = [c.first[0], c.lastname[0]].filter(Boolean).join('').toUpperCase()
  const color   = coloredAvatars ? avatarColor(name) : avatarOriginal()
  const apptLabel = stage.requiresDate && c.startDate
    ? c.startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : null
  const stale = isStale(c, stage)

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
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={[
        'rounded-xl border transition-all cursor-grab active:cursor-grabbing flex items-start',
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
            {c.phone && <p className="text-xs text-gray-400 truncate">{c.phone}</p>}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {c.amount > 0 && (
              <span className="text-xs font-semibold text-green-400">{formatCurrency(c.amount)}</span>
            )}
            {score && <ScoreBadge score={score} />}
          </div>
        </div>

        {(c.salesman || apptLabel || stale) && (
          <div className="flex flex-wrap gap-1">
            {c.salesman && (
              <span className="text-xs bg-gray-700/80 text-gray-300 px-1.5 py-0.5 rounded-full">{c.salesman}</span>
            )}
            {apptLabel && (
              <span className="text-xs bg-orange-900/40 text-orange-300 px-1.5 py-0.5 rounded-full">📅 {apptLabel}</span>
            )}
            {stale && (
              <span className="text-xs bg-amber-900/40 text-amber-300 px-1.5 py-0.5 rounded-full">
                🕓 {daysSince(c.lastUpdateDate)}d cold
              </span>
            )}
          </div>
        )}

        {(c.city || c.street) && stage.kind !== 'won' && (
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-gray-500 truncate">{[c.city, c.state].filter(Boolean).join(', ')}</p>
            <a
              href={directionsUrl(c)}
              target="_blank"
              rel="noopener noreferrer"
              onClick={e => e.stopPropagation()}
              title="Get directions"
              className="text-indigo-400 hover:text-indigo-300 shrink-0"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 20l-5.447-2.724A1 1 0 0 1 3 16.382V5.618a1 1 0 0 1 1.447-.894L9 7m0 13l6-3m-6-10l6 3m0 0l5.447-2.724A1 1 0 0 1 21 5.618v10.764a1 1 0 0 1-.553.894L15 20m0-13v13" />
              </svg>
            </a>
          </div>
        )}
      </Link>
      <div className="relative shrink-0 pt-2 pr-1" ref={menuRef}>
        <button
          type="button"
          onClick={() => setMenuOpen(v => !v)}
          className="w-6 h-6 flex items-center justify-center rounded-full text-gray-500 hover:text-gray-200 hover:bg-gray-700/60 transition-colors"
          aria-label="Move to another stage"
        >
          ⋯
        </button>
        {menuOpen && (
          <div className="absolute right-0 top-full mt-1 w-40 bg-gray-900 border border-gray-700 rounded-xl shadow-2xl z-30 overflow-hidden">
            {allStages.filter(s => s.id !== stage.id).map(s => (
              <button
                key={s.id}
                type="button"
                onClick={() => { onMove(s); setMenuOpen(false) }}
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
