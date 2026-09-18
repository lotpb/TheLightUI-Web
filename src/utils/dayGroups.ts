/**
 * Day bucketing for time-ordered feeds.
 *
 * /audit-log and /activity both group a newest-first list by calendar day, and
 * both had their own version — /activity's collapsed everything older than a
 * week into month buckets ("September 2026"), so a quarter of history became
 * three useful headings followed by groups holding thousands of rows with no
 * day separation inside them.
 */

export interface DayGroup<T> {
  /** `yyyy-mm-dd` in the viewer's local calendar — stable as a React key. */
  key: string
  label: string
  items: T[]
}

export function localDayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * Today, Yesterday, or the date itself.
 *
 * Every day gets its own heading: a heading that spans a month can't answer
 * "what happened on the 12th", which is the question a dated feed exists for.
 */
export function dayHeading(d: Date, now: Date = new Date()): string {
  const key = localDayKey(d)
  if (key === localDayKey(now)) return 'Today'
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
  if (key === localDayKey(yesterday)) return 'Yesterday'
  return d.toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
    year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric',
  })
}

/**
 * Groups an already-sorted (newest first) list into contiguous day buckets.
 *
 * Contiguous rather than keyed-by-label: bucketing into a Map keyed on the
 * *label* silently merges two different days that happen to render the same
 * string, and reorders nothing if the input isn't sorted. A run-length pass
 * over sorted input can't do either.
 */
export function groupByDay<T>(
  items: T[],
  getDate: (item: T) => Date,
  now: Date = new Date(),
): DayGroup<T>[] {
  const groups: DayGroup<T>[] = []
  for (const item of items) {
    const date = getDate(item)
    const key = localDayKey(date)
    const last = groups[groups.length - 1]
    if (last && last.key === key) {
      last.items.push(item)
    } else {
      groups.push({ key, label: dayHeading(date, now), items: [item] })
    }
  }
  return groups
}
