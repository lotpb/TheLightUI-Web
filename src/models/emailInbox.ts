import type { EmailMessage } from './emailMessage'
// Both inboxes need these; /sms-inbox showed the same absolute timestamp on
// every row for the same reason.
import { relativeTime, fullTimestamp } from '../utils/relativeTime'

export { relativeTime, fullTimestamp }

/**
 * Filtering, counting and relative time for /email-inbox.
 *
 * The page offered an All/Unread toggle and nothing else — no search on a
 * 100-message listener, and no way to see the replies the webhook could not
 * attach to a customer, which are precisely the ones needing a human.
 */

export type InboxFilter = 'all' | 'unread' | 'unmatched'

export const INBOX_FILTERS: { key: InboxFilter; label: string }[] = [
  { key: 'all',       label: 'All' },
  { key: 'unread',    label: 'Unread' },
  { key: 'unmatched', label: 'Unmatched' },
]

export function isInboxFilter(v: string | null): v is InboxFilter {
  return v === 'all' || v === 'unread' || v === 'unmatched'
}

/**
 * True when the inbound webhook could not tie this reply to a record.
 *
 * emailInboundWebhook matches on an exact `email` equality query, so a
 * customer replying from a different address than the one on file lands here
 * with `customerId: ''` — and the row simply rendered without its link, while
 * the page's own subtitle claimed replies were "matched to customer records".
 */
export function isUnmatched(m: EmailMessage): boolean {
  return m.customerId.trim() === ''
}

export function matchesInboxFilter(m: EmailMessage, filter: InboxFilter): boolean {
  switch (filter) {
    case 'all':       return true
    case 'unread':    return !m.read
    case 'unmatched': return isUnmatched(m)
  }
}

export function searchMessages(messages: EmailMessage[], search: string): EmailMessage[] {
  const q = search.trim().toLowerCase()
  if (!q) return messages
  return messages.filter(m =>
    m.fromAddress.toLowerCase().includes(q) ||
    m.subject.toLowerCase().includes(q) ||
    m.body.toLowerCase().includes(q),
  )
}

export function filterMessages(
  messages: EmailMessage[],
  filter: InboxFilter,
  search: string,
): EmailMessage[] {
  return searchMessages(messages.filter(m => matchesInboxFilter(m, filter)), search)
}

export type InboxCounts = Record<InboxFilter, number>

export function inboxCounts(messages: EmailMessage[]): InboxCounts {
  const counts: InboxCounts = { all: messages.length, unread: 0, unmatched: 0 }
  for (const m of messages) {
    if (!m.read) counts.unread++
    if (isUnmatched(m)) counts.unmatched++
  }
  return counts
}

/**
 * The subject to reply with.
 *
 * Only one "Re:" however many round trips, and a blank subject still gets one
 * rather than sending an empty header.
 */
export function replySubject(subject: string): string {
  const s = subject.trim()
  if (!s) return 'Re: (no subject)'
  return /^re:/i.test(s) ? s : `Re: ${s}`
}

/**
 * The original message, quoted under the reply.
 *
 * Plain-text quoting with "> " because bulkSendEmail escapes the body and
 * wraps it in paragraphs — anything HTML would arrive as visible markup.
 */
export function quoteBody(m: EmailMessage, now: Date = new Date()): string {
  const header = `On ${fullTimestamp(m.createdAt)}, ${m.fromAddress} wrote:`
  const quoted = m.body.split('\n').map(line => `> ${line}`).join('\n')
  void now
  return `\n\n${header}\n${quoted}`
}

/** Names the active filter, for the empty state. */
export function describeInboxFilter(filter: InboxFilter, search: string): string {
  const label = INBOX_FILTERS.find(f => f.key === filter)?.label ?? 'All'
  const q = search.trim()
  return q ? `${label} · matching “${q}”` : label
}
