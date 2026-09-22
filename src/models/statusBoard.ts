/**
 * The shared shape of the /invoices/pipeline and /proposals/pipeline boards.
 *
 * Those two pages were ~90% the same file: the same column-config triple, the
 * same drag state machine, the same per-card move menu, the same skeleton, the
 * same MAX_PER_COL and the same hand-rolled date formatter. That duplication is
 * exactly why a defect in one was assumed to be in both — so what can be
 * shared lives here, and the next fix lands once.
 *
 * Distinct from models/pipelineBoard.ts, which serves /pipeline: that board
 * buckets customers by a company-configurable stage, this one buckets documents
 * by a fixed status where two of the statuses are computed from a date.
 */

export interface BoardColumn<S extends string> {
  id: S
  label: string
  /** The identity stripe across the top of the column. */
  barClass: string
  /** The column heading's colour. */
  textClass: string
  /** The count badge. */
  badgeClass: string
  /**
   * False for a *computed* column. Overdue and Expired aren't stored statuses
   * — they're a 'sent' record whose date has passed — so you can drag out of
   * one but not into it.
   */
  droppable: boolean
  /** Shown under the heading of a computed column. */
  note?: string
}

/**
 * Count badges use the app's tinted-pill family rather than a solid fill.
 *
 * They were `text-white` on `bg-green-600` / `bg-amber-600`, which measures
 * 3.30:1 and 3.19:1 — and 12px bold doesn't reach the 18.66px that the 3:1
 * large-text exemption requires, so two of the five counts failed AA in *both*
 * themes.
 *
 * Worth recording what this was *not*: a light-mode `text-white` bug. Every
 * saturated background here is already in index.css's text-white-on-solid
 * override list, and the neutral one measures 10.31:1 dark / 12.87:1 light.
 * The fills were simply too light for white text to begin with, in both
 * themes equally.
 *
 * Each pairing below has an explicit light-mode rule in index.css keyed on the
 * exact two classes, which is what keeps it legible on a white column;
 * statusBoard.test.ts checks those rules still exist.
 */
export const BADGE_NEUTRAL = 'bg-gray-700 text-gray-200'
export const BADGE_BLUE    = 'bg-blue-500/20 text-blue-300'
export const BADGE_GREEN   = 'bg-green-500/20 text-green-300'
export const BADGE_RED     = 'bg-red-500/20 text-red-300'
export const BADGE_AMBER   = 'bg-amber-500/20 text-amber-300'

export type InvoiceColumnId  = 'draft' | 'sent' | 'paid' | 'overdue'
export type ProposalColumnId = 'draft' | 'sent' | 'accepted' | 'declined' | 'expired'

const COMPUTED_NOTE = 'Not a status — a sent record past its date'

export const INVOICE_COLUMNS: BoardColumn<InvoiceColumnId>[] = [
  { id: 'draft',   label: 'Draft',   barClass: 'bg-gray-500',  textClass: 'text-gray-300',  badgeClass: BADGE_NEUTRAL, droppable: true },
  { id: 'sent',    label: 'Sent',    barClass: 'bg-blue-500',  textClass: 'text-blue-300',  badgeClass: BADGE_BLUE,    droppable: true },
  { id: 'paid',    label: 'Paid',    barClass: 'bg-green-500', textClass: 'text-green-300', badgeClass: BADGE_GREEN,   droppable: true },
  { id: 'overdue', label: 'Overdue', barClass: 'bg-red-500',   textClass: 'text-red-300',   badgeClass: BADGE_RED,     droppable: false, note: COMPUTED_NOTE },
]

export const PROPOSAL_COLUMNS: BoardColumn<ProposalColumnId>[] = [
  { id: 'draft',    label: 'Draft',    barClass: 'bg-gray-500',  textClass: 'text-gray-300',  badgeClass: BADGE_NEUTRAL, droppable: true },
  { id: 'sent',     label: 'Sent',     barClass: 'bg-blue-500',  textClass: 'text-blue-300',  badgeClass: BADGE_BLUE,    droppable: true },
  { id: 'accepted', label: 'Accepted', barClass: 'bg-green-500', textClass: 'text-green-300', badgeClass: BADGE_GREEN,   droppable: true },
  { id: 'declined', label: 'Declined', barClass: 'bg-red-500',   textClass: 'text-red-300',   badgeClass: BADGE_RED,     droppable: true },
  { id: 'expired',  label: 'Expired',  barClass: 'bg-amber-500', textClass: 'text-amber-300', badgeClass: BADGE_AMBER,   droppable: false, note: COMPUTED_NOTE },
]

/** How many cards a column renders before deferring to the list view. */
export const MAX_PER_COL = 30

// ── Bucketing ─────────────────────────────────────────────────────────────────

/**
 * Groups records into columns by effective status, most recently updated first.
 *
 * Zero-fills every column so an empty stage still renders with its heading and
 * a 0 — a board that hides its empty stages can't show the shape of the
 * pipeline, which is the only reason to look at it as a board.
 */
export function bucketByStatus<S extends string, T>(
  items: T[],
  columns: BoardColumn<S>[],
  statusOf: (item: T) => S,
  updatedAtOf: (item: T) => Date,
): Record<S, T[]> {
  const buckets = {} as Record<S, T[]>
  for (const col of columns) buckets[col.id] = []
  for (const item of items) {
    // A status with no column would otherwise throw on .push of undefined.
    buckets[statusOf(item)]?.push(item)
  }
  for (const col of columns) {
    buckets[col.id].sort((a, b) => updatedAtOf(b).getTime() - updatedAtOf(a).getTime())
  }
  return buckets
}

/**
 * The money sitting in a column.
 *
 * The header carried one figure — paid, or accepted — and each column carried
 * a bare count, so "how much is waiting in Sent" wasn't anywhere on a board
 * whose purpose is to answer it. /pipeline's own board already learned this
 * (see stageTotals in models/pipelineBoard.ts); these two hadn't.
 */
export function columnValue<T>(items: T[], totalOf: (item: T) => number): number {
  return items.reduce((sum, item) => sum + totalOf(item), 0)
}

// ── Moving a card ─────────────────────────────────────────────────────────────

/**
 * The statuses a card can actually be moved to.
 *
 * Keyed on the record's **stored** status, not the column it appears in —
 * which is the bug. An overdue invoice sits in the Overdue column while its
 * stored status is 'sent', because Overdue is computed from the due date. The
 * menu filtered on the displayed column, so it offered "Move to Sent"; the
 * handler then wrote `status: 'sent'`, which the record already was, and the
 * card stayed exactly where it was. A tap, a Firestore write, and no visible
 * change or explanation. Same on /proposals/pipeline with Expired.
 *
 * Filtering on the stored status means that option isn't offered at all, and
 * everything still offered does something.
 */
export function moveTargets<S extends string>(
  columns: BoardColumn<S>[], storedStatus: S,
): BoardColumn<S>[] {
  return columns.filter(c => c.droppable && c.id !== storedStatus)
}

/** Whether a move would change anything. Same rule as moveTargets. */
export function canMoveTo<S extends string>(
  columns: BoardColumn<S>[], storedStatus: S, target: S,
): boolean {
  return moveTargets(columns, storedStatus).some(c => c.id === target)
}

/**
 * Why a drop was refused, or null when it wasn't.
 *
 * Dropping an overdue invoice back onto Sent is the case worth explaining: it
 * *is* sent, and what's keeping it in Overdue is a due date the board can't
 * edit. A sentence beats a silent no-op.
 */
export function moveRefusal<S extends string>(
  columns: BoardColumn<S>[],
  storedStatus: S,
  effective: S,
  target: S,
): string | null {
  if (canMoveTo(columns, storedStatus, target)) return null
  const targetCol = columns.find(c => c.id === target)
  if (!targetCol) return null
  if (storedStatus === target && effective !== target) {
    const shown = columns.find(c => c.id === effective)?.label ?? effective
    return `Already ${targetCol.label.toLowerCase()} — it shows as ${shown} because of its date. Change the date to clear it.`
  }
  return null
}

// ── Presentation ──────────────────────────────────────────────────────────────

const COLUMN_BASE = 'shrink-0 w-64 flex flex-col rounded-2xl border overflow-hidden transition-colors'

export const COLUMN_CLASSES = `${COLUMN_BASE} bg-gray-900 border-gray-700`

/**
 * The active drop target.
 *
 * Was `border-white/20 bg-gray-800/80 ring-2 ring-white/10`: 1.74:1 dark and
 * 1.52:1 light for the border, 1.26:1 and **1.08:1** for the surface — so the
 * one piece of feedback a drag board exists to give was imperceptible. `white/20`
 * also resolves through --color-white, which is dark navy in light mode, so the
 * "highlight" rendered *darker* than its surroundings. Indigo is the app's
 * active colour and measures 4.51:1 dark / 4.08:1 light against the page.
 */
export const COLUMN_DROP_CLASSES = `${COLUMN_BASE} bg-indigo-500/10 border-indigo-500 ring-2 ring-indigo-500/40`

export function columnClasses(isDropTarget: boolean): string {
  return isDropTarget ? COLUMN_DROP_CLASSES : COLUMN_CLASSES
}

/** `Mar 5` — the card's date line. */
export function fmtBoardDate(d: Date | null | undefined): string {
  if (!d || isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/** Filters cards by customer name or document number. */
export function searchBoard<T>(
  items: T[], query: string, fields: (item: T) => string[],
): T[] {
  const q = query.trim().toLowerCase()
  if (!q) return items
  return items.filter(item => fields(item).some(f => (f ?? '').toLowerCase().includes(q)))
}
