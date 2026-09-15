/**
 * Running an operation over a selection, and reporting what actually happened.
 *
 * The bulk handlers on /invoices used `Promise.all`, which rejects on the
 * first failure and discards the rest of the results. Mark forty invoices
 * paid, have one write fail, and the page reported "Bulk status update failed"
 * while thirty-nine had in fact been updated. The `clearSelection()` sat
 * inside the `try`, so the selection survived too and the obvious retry
 * re-ran all forty — which, for the delete handler, meant deleting records
 * that were already gone.
 *
 * `runBulk` settles every operation, keeps the association between each item
 * and its outcome, and lets the caller narrow the selection to just the
 * failures so a retry touches only those.
 */

export interface BulkOutcome<T> {
  succeeded: T[]
  failed: T[]
  /** The first rejection, for the console — the toast reports counts. */
  firstError: Error | null
}

export async function runBulk<T>(
  items: readonly T[],
  op: (item: T) => Promise<unknown>,
): Promise<BulkOutcome<T>> {
  const settled = await Promise.allSettled(items.map(item => op(item)))
  const succeeded: T[] = []
  const failed: T[] = []
  let firstError: Error | null = null

  for (let i = 0; i < settled.length; i++) {
    const r = settled[i]
    if (r.status === 'fulfilled') {
      succeeded.push(items[i])
      continue
    }
    failed.push(items[i])
    if (!firstError) {
      firstError = r.reason instanceof Error ? r.reason : new Error(String(r.reason))
    }
  }

  return { succeeded, failed, firstError }
}

export interface BulkMessage {
  text: string
  variant: 'success' | 'error'
}

/**
 * The toast for a settled bulk run.
 *
 * `action` is a past-tense clause — "deleted", "marked as Paid" — so the
 * three outcomes read the same way whatever the operation was, and a partial
 * run says both halves of the truth: what went through, and what didn't.
 */
export function bulkResultMessage(o: {
  done: number
  total: number
  /** Singular; pluralised with an "s". */
  noun: string
  action: string
}): BulkMessage {
  const { done, total, noun, action } = o
  const plural = (n: number) => (n === 1 ? noun : `${noun}s`)

  if (total === 0) return { text: `Nothing selected`, variant: 'error' }

  if (done === 0) {
    return {
      text: `No ${plural(total)} were ${action} — all ${total} failed. They are still selected.`,
      variant: 'error',
    }
  }

  if (done === total) {
    return { text: `${total} ${plural(total)} ${action}`, variant: 'success' }
  }

  const failed = total - done
  return {
    text: `${done} of ${total} ${plural(total)} ${action} — ${failed} failed and ${failed === 1 ? 'is' : 'are'} still selected.`,
    variant: 'error',
  }
}
