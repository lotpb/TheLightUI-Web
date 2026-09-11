/**
 * Short money, for axis ticks, tiles and dense table cells.
 *
 * Several pages grew their own version of this, and they disagreed: a hand-
 * rolled `fmtK` renders 999 as "$999" and 1000 as "$1.0K", so a column could
 * step from "$999" straight to "$1.0K" with no thousands separator anywhere,
 * and 1_500_000 came out "$1.5M" while another page showed "$1.5m". Intl also
 * gets the locale's grouping and rounding right for free.
 */
const COMPACT = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  notation: 'compact',
  maximumFractionDigits: 1,
})

const FULL = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
})

/** "$1.2K", "$3.4M". Below 1000 it stays exact, because "$0.9K" helps nobody. */
export function compactCurrency(n: number): string {
  if (!Number.isFinite(n)) return '$0'
  return Math.abs(n) < 1000 ? FULL.format(n) : COMPACT.format(n)
}

/** "$1,234". For tooltips and anywhere the exact figure is the point. */
export function fullCurrency(n: number): string {
  return Number.isFinite(n) ? FULL.format(n) : '$0'
}
