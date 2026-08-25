import { useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { doc, updateDoc, Timestamp } from 'firebase/firestore'
import { db } from '../../firebase/config'
import { requestLeadScoring, type LeadScore } from '../../services/leadScoreService'
import { fullName, formatCurrency, type CustomerItem } from '../../models/customer'
import { type Stage, STAGE_CONFIG, endOfToday, getStage } from '../../models/pipeline'
import { usePageTitle } from '../../hooks/usePageTitle'
import { useSharedCustomers } from '../../hooks/useSharedCustomers'
import { useSharedLeadScores } from '../../hooks/useSharedLeadScores'
import { avatarColor, avatarOriginal } from '../../utils/avatarColor'
import { usePrefStore } from '../../stores/prefStore'
import PipelineJobsTabs from '../../components/PipelineJobsTabs'

// ─── Types & config ──────────────────────────────────────────────────────────

const MAX_PER_COL = 30
const COLLECTION  = 'Customers'
const DAY_MS = 86_400_000
const STALE_DAYS = 7

function directionsUrl(c: CustomerItem): string {
  const address = [c.street, c.city, c.state].filter(Boolean).join(', ')
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`
}

// "New" and "contacted" leads with no update in a while are going cold —
// flag them so they don't just quietly sit in the board unnoticed.
function isStale(c: CustomerItem, stage: Stage): boolean {
  if (stage !== 'new' && stage !== 'contacted') return false
  return Date.now() - c.lastUpdateDate.getTime() > STALE_DAYS * DAY_MS
}
function daysSince(d: Date): number {
  return Math.floor((Date.now() - d.getTime()) / DAY_MS)
}

// ─── Firestore patches ───────────────────────────────────────────────────────

async function applyStageChange(id: string, targetStage: Stage, apptDate?: Date) {
  const ref = doc(db, COLLECTION, id)
  switch (targetStage) {
    case 'new':
      await updateDoc(ref, { active: '1', category: 'Lead', callback: '', start: Timestamp.fromDate(new Date(0)) })
      break
    case 'contacted':
      await updateDoc(ref, { active: '1', category: 'Lead', callback: 'Yes' })
      break
    case 'appointment':
      if (!apptDate) throw new Error('No date provided')
      await updateDoc(ref, { active: '1', category: 'Lead', start: Timestamp.fromDate(apptDate) })
      break
    case 'won':
      await updateDoc(ref, { active: '1', category: 'Customer' })
      break
    case 'lost':
      await updateDoc(ref, { active: '0' })
      break
  }
}

// ─── Date picker modal ───────────────────────────────────────────────────────

function ApptModal({ onConfirm, onCancel }: { onConfirm: (d: Date) => void; onCancel: () => void }) {
  const today = new Date().toISOString().slice(0, 10)
  const [val, setVal] = useState('')
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 w-full max-w-xs shadow-2xl">
        <h3 className="text-base font-semibold text-white mb-1">Set Appointment Date</h3>
        <p className="text-xs text-gray-400 mb-4">Pick a date for this appointment.</p>
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

  const { items: all, loading } = useSharedCustomers()

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
  const [dragOverStage, setDragOverStage] = useState<Stage | null>(null)
  const draggingIdRef = useRef<string | null>(null)

  // Appointment date modal
  const [pendingAppt, setPendingAppt] = useState<{ id: string } | null>(null)

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
    const buckets: Record<Stage, CustomerItem[]> = { new: [], contacted: [], appointment: [], won: [], lost: [] }
    for (const c of filtered) {
      const stage = getStage(c)
      if (stage) buckets[stage].push(c)
    }
    buckets.appointment.sort((a, b) => (a.startDate?.getTime() ?? 0) - (b.startDate?.getTime() ?? 0))
    for (const stage of ['new', 'contacted', 'won', 'lost'] as const) {
      buckets[stage].sort((a, b) => b.creationDate.getTime() - a.creationDate.getTime())
    }
    return buckets
  }, [filtered])

  const wonAmount = useMemo(() => columns.won.reduce((s, c) => s + c.amount, 0), [columns.won])
  const staleCount = useMemo(
    () => columns.new.filter(c => isStale(c, 'new')).length + columns.contacted.filter(c => isStale(c, 'contacted')).length,
    [columns],
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
  function onDragOverCol(e: React.DragEvent, stage: Stage) {
    e.preventDefault()
    setDragOverStage(stage)
  }
  function onDragLeaveCol() {
    setDragOverStage(null)
  }
  async function onDropCol(e: React.DragEvent, targetStage: Stage) {
    e.preventDefault()
    setDragOverStage(null)
    const id = draggingIdRef.current
    if (!id) return

    const card = all.find(c => c.id === id)
    if (!card) return

    const fromStage = getStage(card)
    if (fromStage === targetStage) return

    if (targetStage === 'appointment') {
      setPendingAppt({ id })
    } else {
      await applyStageChange(id, targetStage)
    }
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
          {STAGE_CONFIG.map(s => (
            <div key={s.id} className="shrink-0 w-64 bg-gray-800/50 rounded-2xl p-4 animate-pulse">
              <div className="h-4 bg-gray-700 rounded w-24 mb-4" />
              {[1, 2, 3].map(i => <div key={i} className="h-20 bg-gray-700 rounded-xl mb-2" />)}
            </div>
          ))}
        </div>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-4 flex-1 items-start min-h-0">
          {STAGE_CONFIG.map(({ id, label, colorClass, barClass, badgeClass, dropHint }) => {
            const items    = columns[id]
            const shown    = items.slice(0, MAX_PER_COL)
            const overflow = items.length - shown.length
            const isOver   = dragOverStage === id

            return (
              <div
                key={id}
                onDragOver={e => onDragOverCol(e, id)}
                onDragLeave={onDragLeaveCol}
                onDrop={e => onDropCol(e, id)}
                className={[
                  'shrink-0 w-64 flex flex-col rounded-2xl border overflow-hidden transition-colors',
                  isOver
                    ? 'border-white/20 bg-gray-800/80 ring-2 ring-white/10'
                    : 'bg-gray-900 border-gray-800',
                ].join(' ')}
              >
                <div className={`h-1 ${barClass}`} />

                <div className="flex items-center justify-between px-3 py-3">
                  <span className={`text-sm font-semibold ${colorClass}`}>{label}</span>
                  <span className={`text-xs font-bold text-white px-2 py-0.5 rounded-full ${badgeClass}`}>
                    {items.length}
                  </span>
                </div>

                {id === 'won' && wonAmount > 0 && (
                  <p className="px-3 -mt-2 pb-2 text-xs text-green-400 font-medium">
                    {formatCurrency(wonAmount)} total
                  </p>
                )}

                {/* Drop target hint */}
                {isOver && draggingId && (
                  <div className="mx-2 mb-2 border-2 border-dashed border-white/20 rounded-xl py-2 text-center text-xs text-gray-400">
                    {dropHint}
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
                        stage={id}
                        score={scores[c.id] ?? null}
                        isDragging={draggingId === c.id}
                        onDragStart={() => onDragStart(c.id)}
                        onDragEnd={onDragEnd}
                      />
                    ))
                  )}
                  {overflow > 0 && (
                    <Link
                      to={id === 'won' ? '/customers' : '/leads'}
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

      {/* Appointment date modal */}
      {pendingAppt && (
        <ApptModal
          onConfirm={async (date) => {
            await applyStageChange(pendingAppt.id, 'appointment', date)
            setPendingAppt(null)
          }}
          onCancel={() => setPendingAppt(null)}
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
  score,
  isDragging,
  onDragStart,
  onDragEnd,
}: {
  customer: CustomerItem
  coloredAvatars: boolean
  stage: Stage
  score: LeadScore | null
  isDragging: boolean
  onDragStart: () => void
  onDragEnd: () => void
}) {
  const name    = fullName(c)
  const initials = [c.first[0], c.lastname[0]].filter(Boolean).join('').toUpperCase()
  const color   = coloredAvatars ? avatarColor(name) : avatarOriginal()
  const eot     = endOfToday()
  const apptLabel = c.startDate && c.startDate > eot
    ? c.startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : null
  const stale = isStale(c, stage)

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={[
        'rounded-xl border transition-all cursor-grab active:cursor-grabbing',
        isDragging
          ? 'opacity-40 border-gray-600 bg-gray-800 scale-95'
          : 'bg-gray-800 border-transparent hover:bg-gray-700/80 hover:border-gray-700',
      ].join(' ')}
    >
      <Link
        to={`/records/${c.id}`}
        draggable={false}
        onClick={e => { if (isDragging) e.preventDefault() }}
        className="flex flex-col gap-2 p-3 block"
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

        {(c.city || c.street) && stage !== 'won' && (
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
    </div>
  )
}
