/**
 * "9m ago" for recent items, an absolute date once they're old.
 *
 * Shared by /email-inbox and /sms-inbox, which both showed a full calendar
 * timestamp on every row — an inbox wants to know how fresh a message is, not
 * its calendar coordinates.
 */
export function relativeTime(d: Date, now: Date = new Date()): string {
  const secs = Math.floor((now.getTime() - d.getTime()) / 1000)
  // Clock skew between the server stamp and the browser can put a message a
  // few seconds in the future; "just now" beats "-1m ago".
  if (secs < 60) return 'just now'
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

/** Full timestamp, for a reader where the exact time matters. */
export function fullTimestamp(d: Date): string {
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
    + ' · '
    + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}
