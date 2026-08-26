import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { usePageTitle } from '../../hooks/usePageTitle'
import { useToast } from '../../components/Toast'
import { subscribeToInvoices, updateInvoice } from '../../services/invoiceService'
import {
  effectiveStatus, fmtCurrency, invoiceTotal,
  type Invoice, type InvoiceStatus,
} from '../../models/invoice'
import PipelineJobsTabs from '../../components/PipelineJobsTabs'

// Draft/Sent/Paid are real, draggable statuses. Overdue is a computed
// overlay (a 'sent' invoice past its dueDate) — shown for visibility but
// not a drop target; you can't drag your way out of being overdue.
const COLUMNS: { id: InvoiceStatus; label: string; barClass: string; textClass: string; badgeClass: string; droppable: boolean }[] = [
  { id: 'draft',   label: 'Draft',   barClass: 'bg-gray-600',  textClass: 'text-gray-400',  badgeClass: 'bg-gray-700',  droppable: true },
  { id: 'sent',    label: 'Sent',    barClass: 'bg-blue-500',  textClass: 'text-blue-400',  badgeClass: 'bg-blue-600',  droppable: true },
  { id: 'paid',    label: 'Paid',    barClass: 'bg-green-500', textClass: 'text-green-400', badgeClass: 'bg-green-600', droppable: true },
  { id: 'overdue', label: 'Overdue', barClass: 'bg-red-500',   textClass: 'text-red-400',   badgeClass: 'bg-red-600',   droppable: false },
]

const MAX_PER_COL = 30

function fmtDate(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export default function InvoicePipelinePage() {
  usePageTitle('Invoice Pipeline')
  const toast = useToast()

  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  useEffect(() => subscribeToInvoices(
    items => { setInvoices(items); setLoading(false) },
    ()    => setLoading(false),
  ), [])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return invoices
    return invoices.filter(inv =>
      inv.customerName.toLowerCase().includes(q) || inv.invoiceNumber.toLowerCase().includes(q),
    )
  }, [invoices, search])

  const columns = useMemo(() => {
    const buckets: Record<InvoiceStatus, Invoice[]> = { draft: [], sent: [], paid: [], overdue: [] }
    for (const inv of filtered) buckets[effectiveStatus(inv)].push(inv)
    for (const k of Object.keys(buckets) as InvoiceStatus[]) {
      buckets[k].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
    }
    return buckets
  }, [filtered])

  const paidValue = useMemo(() => columns.paid.reduce((s, inv) => s + invoiceTotal(inv), 0), [columns])

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
  function onDragOverCol(e: React.DragEvent, col: InvoiceStatus, droppable: boolean) {
    if (!droppable) return
    e.preventDefault()
    setDragOverCol(col)
  }
  function onDragLeaveCol() {
    setDragOverCol(null)
  }
  // Drag-and-drop is mouse-only — the HTML5 DnD events this board relies on
  // never fire from a touch gesture, so this is also the tap-to-move path
  // used by each card's "⋯" menu on phones/tablets.
  async function moveInvoice(id: string, target: InvoiceStatus) {
    const card = invoices.find(inv => inv.id === id)
    if (!card || effectiveStatus(card) === target) return
    try {
      await updateInvoice(id, { status: target })
    } catch {
      toast('Could not update status', 'error')
    }
  }

  async function onDropCol(e: React.DragEvent, target: InvoiceStatus, droppable: boolean) {
    e.preventDefault()
    setDragOverCol(null)
    if (!droppable) return
    const id = draggingIdRef.current
    if (!id) return
    await moveInvoice(id, target)
  }

  return (
    <div className="px-4 py-6 flex flex-col h-full">
      <PipelineJobsTabs />

      <div className="flex items-start justify-between mb-4 shrink-0 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Invoice Pipeline</h1>
          <p className="text-sm text-gray-400 mt-0.5">Drag cards to update status</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {paidValue > 0 && (
            <span className="text-xs text-green-400 font-medium bg-green-900/30 border border-green-700/40 rounded-full px-3 py-1.5">
              {fmtCurrency(paidValue)} paid
            </span>
          )}
          <Link to="/invoices" className="btn-secondary text-sm px-3 py-1.5">List View</Link>
        </div>
      </div>

      <input
        type="search"
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="Search by customer or invoice number…"
        className="input-field w-full text-sm py-2 mb-3 shrink-0"
      />

      {loading ? (
        <div className="flex gap-4 overflow-x-auto pb-4">
          {COLUMNS.map(col => (
            <div key={col.id} className="shrink-0 w-64 bg-gray-800/50 rounded-2xl p-4 animate-pulse">
              <div className="h-4 bg-gray-700 rounded w-24 mb-4" />
              {[1, 2].map(i => <div key={i} className="h-20 bg-gray-700 rounded-xl mb-2" />)}
            </div>
          ))}
        </div>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-4 flex-1 items-start min-h-0">
          {COLUMNS.map(col => {
            const items = columns[col.id]
            const shown = items.slice(0, MAX_PER_COL)
            const overflow = items.length - shown.length
            const isOver = dragOverCol === col.id

            return (
              <div
                key={col.id}
                onDragOver={e => onDragOverCol(e, col.id, col.droppable)}
                onDragLeave={onDragLeaveCol}
                onDrop={e => onDropCol(e, col.id, col.droppable)}
                className={[
                  'shrink-0 w-64 flex flex-col rounded-2xl border overflow-hidden transition-colors',
                  isOver ? 'border-white/20 bg-gray-800/80 ring-2 ring-white/10' : 'bg-gray-900 border-gray-800',
                ].join(' ')}
              >
                <div className={`h-1 ${col.barClass}`} />
                <div className="flex items-center justify-between px-3 py-3">
                  <span className={`text-sm font-semibold ${col.textClass}`}>{col.label}</span>
                  <span className={`text-xs font-bold text-white px-2 py-0.5 rounded-full ${col.badgeClass}`}>
                    {items.length}
                  </span>
                </div>
                {!col.droppable && (
                  <p className="px-3 -mt-1 pb-2 text-xs text-gray-600">Computed — drag out to reassign</p>
                )}
                {isOver && draggingId && (
                  <div className="mx-2 mb-2 border-2 border-dashed border-white/20 rounded-xl py-2 text-center text-xs text-gray-400">
                    Move to {col.label}
                  </div>
                )}
                <div className="flex flex-col gap-2 px-2 pb-3 overflow-y-auto" style={{ maxHeight: 'calc(100vh - 260px)' }}>
                  {shown.length === 0 && !isOver ? (
                    <p className="text-xs text-gray-500 text-center py-8">No invoices</p>
                  ) : (
                    shown.map(inv => (
                      <InvoiceCard
                        key={inv.id}
                        invoice={inv}
                        col={col}
                        isDragging={draggingId === inv.id}
                        onDragStart={() => onDragStart(inv.id)}
                        onDragEnd={onDragEnd}
                        onMove={target => moveInvoice(inv.id, target)}
                      />
                    ))
                  )}
                  {overflow > 0 && (
                    <Link to="/invoices" className="text-xs text-center text-indigo-400 hover:text-indigo-300 py-2 transition-colors">
                      +{overflow} more →
                    </Link>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

type ColumnConfig = typeof COLUMNS[number]

function InvoiceCard({
  invoice: inv, col, isDragging, onDragStart, onDragEnd, onMove,
}: {
  invoice: Invoice
  col: ColumnConfig
  isDragging: boolean
  onDragStart: () => void
  onDragEnd: () => void
  onMove: (target: InvoiceStatus) => void
}) {
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
        'flex items-start rounded-xl border transition-all cursor-grab active:cursor-grabbing',
        isDragging
          ? 'opacity-40 border-gray-600 bg-gray-800 scale-95'
          : 'bg-gray-800 border-transparent hover:bg-gray-700/80 hover:border-gray-700',
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
          <p className="text-sm font-semibold text-white shrink-0">{fmtCurrency(invoiceTotal(inv))}</p>
        </div>
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-gray-500 truncate">{inv.invoiceNumber}</p>
          <p className="text-xs text-gray-500 shrink-0">Due {fmtDate(inv.dueDate)}</p>
        </div>
      </Link>
      <div className="relative shrink-0 pt-2 pr-1" ref={menuRef}>
        <button
          type="button"
          onClick={() => setMenuOpen(v => !v)}
          className="w-6 h-6 flex items-center justify-center rounded-full text-gray-500 hover:text-gray-200 hover:bg-gray-700/60 transition-colors"
          aria-label="Move to another status"
        >
          ⋯
        </button>
        {menuOpen && (
          <div className="absolute right-0 top-full mt-1 w-36 bg-gray-900 border border-gray-700 rounded-xl shadow-2xl z-30 overflow-hidden">
            {COLUMNS.filter(c => c.droppable && c.id !== col.id).map(c => (
              <button
                key={c.id}
                type="button"
                onClick={() => { onMove(c.id); setMenuOpen(false) }}
                className="w-full text-left px-3 py-2 text-xs text-gray-200 hover:bg-gray-700/50 transition-colors"
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
