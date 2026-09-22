import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { usePageTitle } from '../../hooks/usePageTitle'
import { useToast } from '../../components/Toast'
import { Icon, ICONS } from '../../components/Icon'
import { subscribeToInvoices, updateInvoice, INVOICE_REALTIME_LIMIT } from '../../services/invoiceService'
import {
  effectiveStatus, fmtCurrency, invoiceTotal,
  type Invoice, type InvoiceStatus,
} from '../../models/invoice'
import {
  INVOICE_COLUMNS, MAX_PER_COL, bucketByStatus, columnValue,
  canMoveTo, fmtBoardDate, moveRefusal, moveTargets, searchBoard,
  type BoardColumn,
} from '../../models/statusBoard'
import PipelineJobsTabs from '../../components/PipelineJobsTabs'
import StatusBoardColumn from '../../components/StatusBoardColumn'

export default function InvoicePipelinePage() {
  usePageTitle('Invoice Pipeline')
  const toast = useToast()

  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [hitCap, setHitCap] = useState(false)

  useEffect(() => subscribeToInvoices(
    (items, cap) => { setInvoices(items); setHitCap(cap); setLoading(false) },
    ()           => setLoading(false),
  ), [])

  const filtered = useMemo(
    () => searchBoard(invoices, search, inv => [inv.customerName, inv.invoiceNumber]),
    [invoices, search],
  )

  const columns = useMemo(
    () => bucketByStatus(filtered, INVOICE_COLUMNS, effectiveStatus, inv => inv.updatedAt),
    [filtered],
  )

  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dragOverCol, setDragOverCol] = useState<InvoiceStatus | null>(null)
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
   * Whether this column will accept the card currently being dragged.
   *
   * Not just `col.droppable` — a card's *stored* status matters too. An overdue
   * invoice is stored as 'sent', so highlighting Sent as a valid target and
   * then doing nothing on drop was the board's way of lying twice.
   */
  function acceptsDrag(col: BoardColumn<InvoiceStatus>): boolean {
    const id = draggingIdRef.current
    if (!id) return col.droppable
    const card = invoices.find(inv => inv.id === id)
    if (!card) return col.droppable
    return canMoveTo(INVOICE_COLUMNS, card.status, col.id)
  }

  function onDragOverCol(e: React.DragEvent, col: BoardColumn<InvoiceStatus>) {
    if (!acceptsDrag(col)) return
    e.preventDefault()
    setDragOverCol(col.id)
  }

  // Drag-and-drop is mouse-only — the HTML5 DnD events this board relies on
  // never fire from a touch gesture, so this is also the tap-to-move path used
  // by each card's menu on phones and tablets.
  async function moveInvoice(id: string, target: InvoiceStatus) {
    const card = invoices.find(inv => inv.id === id)
    if (!card) return

    // Compared against the stored status, not the effective one. The old guard
    // was `effectiveStatus(card) === target`, which let an overdue invoice
    // through to a write of `status: 'sent'` it already had.
    if (!canMoveTo(INVOICE_COLUMNS, card.status, target)) {
      const why = moveRefusal(INVOICE_COLUMNS, card.status, effectiveStatus(card), target)
      if (why) toast(why, 'error')
      return
    }
    try {
      await updateInvoice(id, { status: target })
    } catch {
      toast('Could not update status', 'error')
    }
  }

  async function onDropCol(e: React.DragEvent, target: BoardColumn<InvoiceStatus>) {
    e.preventDefault()
    setDragOverCol(null)
    const id = draggingIdRef.current
    if (!id) return
    await moveInvoice(id, target.id)
  }

  return (
    <div className="px-4 py-6 flex flex-col h-full">
      <PipelineJobsTabs />

      <div className="flex items-start justify-between mb-4 shrink-0 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Invoice Pipeline</h1>
          <p className="text-sm text-gray-400 mt-0.5">Drag a card, or use its menu, to change status</p>
        </div>
        <Link to="/invoices" className="btn-secondary text-sm px-3 py-1.5">List View</Link>
      </div>

      <input
        type="search"
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="Search by customer or invoice number…"
        aria-label="Search invoices"
        className="input-field w-full text-sm py-2 mb-3 shrink-0"
      />

      {hitCap && (
        <div className="bg-yellow-900/20 border border-yellow-600/40 rounded-xl px-4 py-3 text-yellow-300 text-sm mb-3 shrink-0">
          <span className="flex items-start gap-2">
            <Icon d={ICONS.warning} className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              Showing the first {INVOICE_REALTIME_LIMIT.toLocaleString()} invoices only. Some records
              may not appear on this board — contact support to raise this limit.
            </span>
          </span>
        </div>
      )}

      {/* min-h-0 + flex-1 lets the columns size themselves to whatever is left
          after the header, search box and cap banner, instead of the
          `calc(100vh - 260px)` each column used to hardcode — a figure that was
          wrong by the banner's height whenever the banner was showing. */}
      <div className="flex gap-3 overflow-x-auto pb-4 flex-1 items-stretch min-h-0">
        {INVOICE_COLUMNS.map(col => (
          <StatusBoardColumn
            key={col.id}
            column={col}
            count={columns[col.id].length}
            value={fmtCurrency(columnValue(columns[col.id], invoiceTotal))}
            loading={loading}
            isDropTarget={dragOverCol === col.id}
            isDragActive={draggingId !== null}
            emptyLabel="No invoices"
            overflowTo="/invoices"
            overflowCount={Math.max(0, columns[col.id].length - MAX_PER_COL)}
            onDragOver={e => onDragOverCol(e, col)}
            onDragLeave={() => setDragOverCol(null)}
            onDrop={e => onDropCol(e, col)}
          >
            {columns[col.id].slice(0, MAX_PER_COL).map(inv => (
              <InvoiceCard
                key={inv.id}
                invoice={inv}
                isDragging={draggingId === inv.id}
                onDragStart={() => onDragStart(inv.id)}
                onDragEnd={onDragEnd}
                onMove={target => moveInvoice(inv.id, target)}
              />
            ))}
          </StatusBoardColumn>
        ))}
      </div>
    </div>
  )
}

function InvoiceCard({
  invoice: inv, isDragging, onDragStart, onDragEnd, onMove,
}: {
  invoice: Invoice
  isDragging: boolean
  onDragStart: () => void
  onDragEnd: () => void
  onMove: (target: InvoiceStatus) => void
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
  // overdue invoice — it's already sent, and the due date is what's keeping it
  // in that column.
  const targets = moveTargets(INVOICE_COLUMNS, inv.status)

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={[
        'flex items-start rounded-xl border transition-all cursor-grab active:cursor-grabbing',
        isDragging
          ? 'opacity-40 border-gray-500 bg-gray-800 scale-95'
          : 'bg-gray-800 border-transparent hover:bg-gray-700/80 hover:border-gray-600',
      ].join(' ')}
    >
      <Link
        to={`/invoices/${inv.id}`}
        draggable={false}
        onClick={e => { if (isDragging) e.preventDefault() }}
        className="flex flex-col gap-1.5 p-3 flex-1 min-w-0"
      >
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-sm font-medium text-gray-100 truncate">{inv.customerName || '—'}</p>
          <p className="text-sm font-semibold text-gray-100 shrink-0 tabular-nums">{fmtCurrency(invoiceTotal(inv))}</p>
        </div>
        {/* gray-400, not gray-500: the invoice number and due date are the two
            details that identify a card, and at gray-500 they measured 3.04:1
            on this bg-gray-800 surface. */}
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-gray-400 truncate">{inv.invoiceNumber}</p>
          <p className="text-xs text-gray-400 shrink-0 tabular-nums">Due {fmtBoardDate(inv.dueDate)}</p>
        </div>
      </Link>
      <div className="relative shrink-0 pt-2 pr-1" ref={menuRef}>
        <button
          type="button"
          onClick={() => setMenuOpen(v => !v)}
          aria-label={`Move ${inv.invoiceNumber || 'invoice'} to another status`}
          aria-expanded={menuOpen}
          className="w-6 h-6 flex items-center justify-center rounded-full text-gray-400 hover:text-gray-100 hover:bg-gray-600 transition-colors
                     focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        >
          {/* A drawn glyph. This was a ⋯ character, which is typeset text and
              so doesn't follow the button's colour or size like the rest of the
              app's icons do. */}
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
  )
}
