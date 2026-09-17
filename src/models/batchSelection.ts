import type { CustomerItem } from './customer'

/**
 * Filtering and selection scope for /batch.
 *
 * The page kept two different notions of "selected" and used them
 * interchangeably: `selected`, a Set of every id ever ticked, and the subset
 * of that Set still visible under the current filters — which is what the
 * bulk actions actually operated on. Every label, every Apply button and both
 * confirmation dialogs printed `selected.size`, so narrowing a filter after
 * ticking rows produced a dialog reading "Permanently delete 50 records" that
 * deleted 10, followed by a toast reading "Deleted 10 records". Narrow it to
 * zero matches and the action returned before its own toast, so confirming a
 * permanent deletion did nothing at all and said nothing.
 *
 * `selectionScope` is now the single answer to "what will this action touch",
 * and it reports what it is leaving out so the page can say so.
 */

export interface BatchFilters {
  search: string
  /** 'all', or a category name matched case-insensitively. */
  category: string
  /** 'all', or an exact salesman name. */
  salesman: string
  /** 'all' | 'yes' | 'no' */
  callback: string
}

export const EMPTY_BATCH_FILTERS: BatchFilters = {
  search: '', category: 'all', salesman: 'all', callback: 'all',
}

export function filtersActive(f: BatchFilters): boolean {
  return f.search.trim() !== '' || f.category !== 'all' || f.salesman !== 'all' || f.callback !== 'all'
}

/** Names the active filters, so a dialog can say what the selection is scoped to. */
export function describeBatchFilters(f: BatchFilters): string {
  const parts: string[] = []
  if (f.category !== 'all') parts.push(f.category)
  if (f.salesman !== 'all') parts.push(f.salesman)
  if (f.callback === 'yes') parts.push('callback yes')
  if (f.callback === 'no')  parts.push('callback no')
  const q = f.search.trim()
  if (q) parts.push(`matching “${q}”`)
  return parts.join(' · ')
}

export function matchesBatchFilters(c: CustomerItem, f: BatchFilters): boolean {
  if (f.category !== 'all' && c.category.toLowerCase() !== f.category.toLowerCase()) return false
  if (f.salesman !== 'all' && c.salesman !== f.salesman) return false
  if (f.callback === 'yes' && c.callback.toLowerCase() !== 'yes') return false
  if (f.callback === 'no'  && c.callback.toLowerCase() === 'yes') return false
  const q = f.search.toLowerCase().trim()
  if (!q) return true
  return `${c.first} ${c.lastname} ${c.phone} ${c.email} ${c.city} ${c.adNo}`.toLowerCase().includes(q)
}

export function filterBatchRecords(items: CustomerItem[], f: BatchFilters): CustomerItem[] {
  return items.filter(c => matchesBatchFilters(c, f))
}

export interface SelectionScope {
  /**
   * The ids an action will actually touch: selected *and* currently visible,
   * in the order they appear on screen so a CSV export matches the table.
   */
  inScope: string[]
  /** Ticked, but filtered out of the current view — actions skip these. */
  hiddenCount: number
  /** Everything ticked, across every filter state. */
  totalSelected: number
}

export function selectionScope(
  selected: ReadonlySet<string>,
  visibleIds: readonly string[],
): SelectionScope {
  // hiddenCount is derived from set membership rather than
  // `selected.size - inScope.length`: subtraction goes negative if visibleIds
  // ever repeats an id, which would render as "-1 hidden by filters".
  const visible = new Set(visibleIds)
  const seen = new Set<string>()
  const inScope: string[] = []
  for (const id of visibleIds) {
    if (selected.has(id) && !seen.has(id)) { seen.add(id); inScope.push(id) }
  }
  let hiddenCount = 0
  for (const id of selected) if (!visible.has(id)) hiddenCount++
  return { inScope, hiddenCount, totalSelected: selected.size }
}

/**
 * The ids between two rows inclusive, for shift-click range selection.
 *
 * Order-independent: shift-clicking upwards selects the same range as
 * downwards. An id that isn't in the current view yields just the anchor,
 * rather than an empty range that would look like the click did nothing.
 */
export function rangeIds(
  visibleIds: readonly string[],
  anchorId: string,
  targetId: string,
): string[] {
  const a = visibleIds.indexOf(anchorId)
  const b = visibleIds.indexOf(targetId)
  if (a === -1 || b === -1) return b === -1 ? [] : [targetId]
  const [lo, hi] = a <= b ? [a, b] : [b, a]
  return visibleIds.slice(lo, hi + 1)
}
