import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { columnClasses, type BoardColumn } from '../models/statusBoard'

/**
 * One column of /invoices/pipeline or /proposals/pipeline.
 *
 * Both boards had this written out inline, identically — the stripe, the
 * heading row, the computed-column note, the drop placeholder, the scroll
 * container and the overflow link. Sharing it also settles two things those
 * copies each got wrong:
 *
 *   - The scroll container hardcoded `maxHeight: calc(100vh - 260px)` in both
 *     files. 260px is the header plus the search box, so whenever the
 *     record-cap banner was showing the columns ran about 60px past the bottom
 *     of the viewport instead of scrolling inside themselves. The column is a
 *     flex child of a `min-h-0 flex-1` row now, so it takes whatever is
 *     actually left.
 *   - The loading skeleton was a `bg-gray-800/50 rounded-2xl p-4` block, which
 *     is neither the colour nor the shape of a real column, so the board
 *     changed surface and layout the moment it loaded. The skeleton is this
 *     same component now, with placeholder cards inside it.
 */
export default function StatusBoardColumn<S extends string>({
  column,
  count,
  value,
  loading,
  isDropTarget,
  isDragActive,
  emptyLabel,
  overflowTo,
  overflowCount,
  onDragOver,
  onDragLeave,
  onDrop,
  children,
}: {
  column: BoardColumn<S>
  count: number
  /** Pre-formatted money for this column, or null to omit it. */
  value: string | null
  loading: boolean
  isDropTarget: boolean
  isDragActive: boolean
  emptyLabel: string
  overflowTo: string
  overflowCount: number
  onDragOver: (e: React.DragEvent) => void
  onDragLeave: () => void
  onDrop: (e: React.DragEvent) => void
  children: ReactNode
}) {
  const isEmpty = count === 0

  return (
    <div
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={columnClasses(isDropTarget)}
      aria-label={`${column.label}, ${count} ${count === 1 ? 'record' : 'records'}`}
    >
      <div className={`h-1 shrink-0 ${column.barClass}`} />

      <div className="px-3 py-3 shrink-0">
        <div className="flex items-center justify-between gap-2">
          <span className={`text-sm font-semibold ${column.textClass}`}>{column.label}</span>
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full tabular-nums shrink-0 ${column.badgeClass}`}>
            {count}
          </span>
        </div>
        {/* The money in this column. The board carried one total in its header
            — paid, or accepted — and a bare count per column, so "how much is
            waiting in Sent" wasn't anywhere on a board that exists to answer
            it. /pipeline's own board already had per-stage value. */}
        {value && !isEmpty && (
          <p className="text-xs text-gray-400 mt-1 tabular-nums">{value}</p>
        )}
        {column.note && (
          // gray-400 (6.99:1), not gray-600 (2.35:1 on this surface).
          <p className="text-xs text-gray-400 mt-1">{column.note}</p>
        )}
      </div>

      {isDropTarget && isDragActive && (
        <div className="mx-2 mb-2 shrink-0 border-2 border-dashed border-indigo-500 rounded-xl py-2 text-center text-xs text-indigo-300">
          Move to {column.label}
        </div>
      )}

      <div className="flex flex-col gap-2 px-2 pb-3 overflow-y-auto min-h-0">
        {loading ? (
          [0, 1].map(i => (
            <div key={i} className="h-[68px] rounded-xl bg-gray-800 animate-pulse" />
          ))
        ) : isEmpty && !isDropTarget ? (
          <p className="text-xs text-gray-400 text-center py-8">{emptyLabel}</p>
        ) : (
          children
        )}
        {overflowCount > 0 && (
          <Link
            to={overflowTo}
            className="text-xs text-center text-indigo-400 hover:text-indigo-300 py-2 transition-colors"
          >
            +{overflowCount} more in the list view
          </Link>
        )}
      </div>
    </div>
  )
}
