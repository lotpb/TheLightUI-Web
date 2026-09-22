import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { usePageTitle } from '../../hooks/usePageTitle'
import { useToast } from '../../components/Toast'
import { Icon, ICONS } from '../../components/Icon'
import { subscribeToProposals, updateProposal, convertProposalToInvoice, PROPOSAL_REALTIME_LIMIT } from '../../services/proposalService'
import {
  effectiveStatus, fmtCurrency, proposalTotal,
  type Proposal, type ProposalStatus,
} from '../../models/proposal'
import {
  PROPOSAL_COLUMNS, MAX_PER_COL, bucketByStatus, columnValue,
  canMoveTo, fmtBoardDate, moveRefusal, moveTargets, searchBoard,
  type BoardColumn,
} from '../../models/statusBoard'
import PipelineJobsTabs from '../../components/PipelineJobsTabs'
import StatusBoardColumn from '../../components/StatusBoardColumn'

export default function ProposalPipelinePage() {
  usePageTitle('Proposal Pipeline')
  const toast = useToast()

  const [proposals, setProposals] = useState<Proposal[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [hitCap, setHitCap] = useState(false)
  const [converting, setConverting] = useState<string | null>(null)

  useEffect(() => subscribeToProposals(
    (items, cap) => { setProposals(items); setHitCap(cap); setLoading(false) },
    ()           => setLoading(false),
  ), [])

  const filtered = useMemo(
    () => searchBoard(proposals, search, p => [p.customerName, p.proposalNumber]),
    [proposals, search],
  )

  const columns = useMemo(
    () => bucketByStatus(filtered, PROPOSAL_COLUMNS, effectiveStatus, p => p.updatedAt),
    [filtered],
  )

  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dragOverCol, setDragOverCol] = useState<ProposalStatus | null>(null)
  const draggingIdRef = useRef<string | null>(null)

  function onDragStart(id: string) {
    draggingIdRef.current = id
    setDraggingId(id)
  }
  function onDragEnd() {
    draggingIdRef.current = null
    setDraggingId(null)
    setDragOverCol(null)
  }

  /**
   * Whether this column will accept the card being dragged.
   *
   * Not just `col.droppable` — an expired proposal is *stored* as 'sent', so
   * highlighting Sent as a valid target and then doing nothing on drop was the
   * board lying twice.
   */
  function acceptsDrag(col: BoardColumn<ProposalStatus>): boolean {
    const id = draggingIdRef.current
    if (!id) return col.droppable
    const card = proposals.find(p => p.id === id)
    if (!card) return col.droppable
    return canMoveTo(PROPOSAL_COLUMNS, card.status, col.id)
  }

  function onDragOverCol(e: React.DragEvent, col: BoardColumn<ProposalStatus>) {
    if (!acceptsDrag(col)) return
    e.preventDefault()
    setDragOverCol(col.id)
  }

  // Drag-and-drop is mouse-only — the HTML5 DnD events this board relies on
  // never fire from a touch gesture, so this is also the tap-to-move path used
  // by each card's menu on phones and tablets.
  async function moveProposal(id: string, target: ProposalStatus) {
    const card = proposals.find(p => p.id === id)
    if (!card) return

    // Compared against the stored status, not the effective one. The old guard
    // was `effectiveStatus(card) === target`, which let an expired proposal
    // through to a write of `status: 'sent'` it already had.
    if (!canMoveTo(PROPOSAL_COLUMNS, card.status, target)) {
      const why = moveRefusal(PROPOSAL_COLUMNS, card.status, effectiveStatus(card), target)
      if (why) toast(why, 'error')
      return
    }
    try {
      await updateProposal(id, { status: target })
    } catch {
      toast('Could not update status', 'error')
    }
  }

  async function onDropCol(e: React.DragEvent, target: BoardColumn<ProposalStatus>) {
    e.preventDefault()
    setDragOverCol(null)
    const id = draggingIdRef.current
    if (!id) return
    await moveProposal(id, target.id)
  }

  async function handleConvert(p: Proposal) {
    setConverting(p.id)
    try {
      await convertProposalToInvoice(p)
      toast('Converted to invoice', 'success')
    } catch {
      toast('Could not convert to invoice', 'error')
    } finally {
      setConverting(null)
    }
  }

  return (
    <div className="px-4 py-6 flex flex-col h-full">
      <PipelineJobsTabs />

      <div className="flex items-start justify-between mb-4 shrink-0 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Proposal Pipeline</h1>
          <p className="text-sm text-gray-400 mt-0.5">Drag a card, or use its menu, to change status</p>
        </div>
        <Link to="/proposals" className="btn-secondary text-sm px-3 py-1.5">List View</Link>
      </div>

      <input
        type="search"
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="Search by customer or proposal number…"
        aria-label="Search proposals"
        className="input-field w-full text-sm py-2 mb-3 shrink-0"
      />

      {hitCap && (
        <div className="bg-yellow-900/20 border border-yellow-600/40 rounded-xl px-4 py-3 text-yellow-300 text-sm mb-3 shrink-0">
          <span className="flex items-start gap-2">
            <Icon d={ICONS.warning} className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              Showing the first {PROPOSAL_REALTIME_LIMIT.toLocaleString()} proposals only. Some records
              may not appear on this board — contact support to raise this limit.
            </span>
          </span>
        </div>
      )}

      {/* min-h-0 + flex-1 lets the columns size to whatever is left after the
          header, search box and cap banner, rather than the
          `calc(100vh - 260px)` each column used to hardcode. */}
      <div className="flex gap-3 overflow-x-auto pb-4 flex-1 items-stretch min-h-0">
        {PROPOSAL_COLUMNS.map(col => (
          <StatusBoardColumn
            key={col.id}
            column={col}
            count={columns[col.id].length}
            value={fmtCurrency(columnValue(columns[col.id], proposalTotal))}
            loading={loading}
            isDropTarget={dragOverCol === col.id}
            isDragActive={draggingId !== null}
            emptyLabel="No proposals"
            overflowTo="/proposals"
            overflowCount={Math.max(0, columns[col.id].length - MAX_PER_COL)}
            onDragOver={e => onDragOverCol(e, col)}
            onDragLeave={() => setDragOverCol(null)}
            onDrop={e => onDropCol(e, col)}
          >
            {columns[col.id].slice(0, MAX_PER_COL).map(p => (
              <ProposalCard
                key={p.id}
                proposal={p}
                showConvert={col.id === 'accepted'}
                isDragging={draggingId === p.id}
                onDragStart={() => onDragStart(p.id)}
                onDragEnd={onDragEnd}
                onMove={target => moveProposal(p.id, target)}
                onConvert={() => handleConvert(p)}
                converting={converting === p.id}
              />
            ))}
          </StatusBoardColumn>
        ))}
      </div>
    </div>
  )
}

function ProposalCard({
  proposal: p, showConvert, isDragging, onDragStart, onDragEnd, onMove, onConvert, converting,
}: {
  proposal: Proposal
  showConvert: boolean
  isDragging: boolean
  onDragStart: () => void
  onDragEnd: () => void
  onMove: (target: ProposalStatus) => void
  onConvert: () => void
  converting: boolean
}) {
  // Drag-and-drop doesn't fire on touch devices — this menu is how phones and
  // tablets move a card between columns.
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!menuOpen) return
    function onDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setMenuOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  // Targets come from the stored status, so "Move to Sent" is not offered on an
  // expired proposal — it's already sent, and the expiry date is what's keeping
  // it in that column.
  const targets = moveTargets(PROPOSAL_COLUMNS, p.status)

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={[
        'rounded-xl border transition-all cursor-grab active:cursor-grabbing',
        isDragging
          ? 'opacity-40 border-gray-500 bg-gray-800 scale-95'
          : 'bg-gray-800 border-transparent hover:bg-gray-700/80 hover:border-gray-600',
      ].join(' ')}
    >
      <div className="flex items-start">
        <Link
          to={`/proposals/${p.id}`}
          draggable={false}
          onClick={e => { if (isDragging) e.preventDefault() }}
          className="flex flex-col gap-1.5 p-3 flex-1 min-w-0"
        >
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-sm font-medium text-gray-100 truncate">{p.customerName || '—'}</p>
            <p className="text-sm font-semibold text-gray-100 shrink-0 tabular-nums">{fmtCurrency(proposalTotal(p))}</p>
          </div>
          {/* gray-400, not gray-500: these two details identify the card, and
              at gray-500 they measured 3.04:1 on this bg-gray-800 surface. */}
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-gray-400 truncate">{p.proposalNumber}</p>
            <p className="text-xs text-gray-400 shrink-0 tabular-nums">Exp {fmtBoardDate(p.expiresDate)}</p>
          </div>
        </Link>
        <div className="relative shrink-0 pt-2 pr-1" ref={menuRef}>
          <button
            type="button"
            onClick={() => setMenuOpen(v => !v)}
            aria-label={`Move ${p.proposalNumber || 'proposal'} to another status`}
            aria-expanded={menuOpen}
            className="w-6 h-6 flex items-center justify-center rounded-full text-gray-400 hover:text-gray-100 hover:bg-gray-600 transition-colors
                       focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          >
            {/* A drawn glyph, not a ⋯ character — typeset text doesn't follow
                the button's colour or size the way the app's icons do. */}
            <Icon d={ICONS.ellipsis} className="w-4 h-4" />
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-full mt-1 w-40 bg-gray-900 border border-gray-500 rounded-xl shadow-2xl z-30 overflow-hidden">
              {targets.map(c => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => { onMove(c.id); setMenuOpen(false) }}
                  className="w-full text-left px-3 py-2 text-xs text-gray-200 hover:bg-gray-700 transition-colors
                             focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500"
                >
                  Move to {c.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      {showConvert && !p.convertedInvoiceId && (
        <button
          onClick={onConvert}
          disabled={converting}
          className="w-full inline-flex items-center justify-center gap-1.5 text-xs px-3 py-1.5 bg-indigo-600/25 text-indigo-200 border-t border-indigo-500/40 hover:bg-indigo-600/35 transition-colors disabled:opacity-40
                     focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500"
        >
          {/* A drawn receipt, not 🧾 — emoji render from Apple Color Emoji and
              ignore `color`, so that glyph stayed the same shade whatever the
              button did, and didn't follow light mode. */}
          {converting
            ? <span className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin shrink-0" />
            : <Icon d={ICONS.receipt} className="w-3.5 h-3.5 shrink-0" />}
          {converting ? 'Converting…' : 'Convert to Invoice'}
        </button>
      )}
      {p.convertedInvoiceId && showConvert && (
        <Link
          to={`/invoices/${p.convertedInvoiceId}`}
          className="flex w-full items-center justify-center gap-1.5 text-xs px-3 py-1.5 bg-emerald-600/25 text-emerald-200 border-t border-emerald-500/40 hover:bg-emerald-600/35 transition-colors"
        >
          View Invoice
          <Icon d={ICONS.arrowRight} className="w-3 h-3 shrink-0" />
        </Link>
      )}
    </div>
  )
}
