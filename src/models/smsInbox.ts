import type { SmsMessage, SmsStatus } from './smsMessage'

export { relativeTime, fullTimestamp } from '../utils/relativeTime'

/**
 * Filtering, counting, phone formatting and number validation for /sms-inbox.
 *
 * The page had an All/Unread toggle and nothing else. Meanwhile the backend
 * was tracking three things it never showed: opt-outs (STOP), delivery
 * failures, and replies it couldn't attach to a record.
 */

export type SmsFilter = 'all' | 'unread' | 'unmatched' | 'optout'

export const SMS_FILTERS: { key: SmsFilter; label: string }[] = [
  { key: 'all',       label: 'All' },
  { key: 'unread',    label: 'Unread' },
  { key: 'unmatched', label: 'Unmatched' },
  { key: 'optout',    label: 'Opt-outs' },
]

export function isSmsFilter(v: string | null): v is SmsFilter {
  return v === 'all' || v === 'unread' || v === 'unmatched' || v === 'optout'
}

/**
 * The inbound webhook couldn't tie this text to a record.
 *
 * It tries an exact `phone` equality match, then a bounded 2,000-doc scan
 * comparing last-ten-digits — so an unmatched text means the number appears
 * on no record at all.
 */
export function isUnmatched(m: SmsMessage): boolean {
  return m.customerId.trim() === ''
}

// Mirrors SMS_STOP_KEYWORDS / SMS_START_KEYWORDS in functions/src/outreach.ts.
// The webhook acts on these — writes smsOptOuts, flips Customers.smsOptOut,
// and auto-replies — and the inbox rendered the result as an ordinary unread
// message reading "STOP", with nothing saying the customer had just
// unsubscribed. Kept in step by smsInbox.test.ts, which reads the function
// source and compares.
export const SMS_STOP_KEYWORDS  = ['stop', 'stopall', 'unsubscribe', 'cancel', 'end', 'quit'] as const
export const SMS_START_KEYWORDS = ['start', 'unstop'] as const

export type SmsIntent = 'stop' | 'start' | 'normal'

/** What the customer's text did, beyond arriving. */
export function smsIntent(m: SmsMessage): SmsIntent {
  const b = m.body.trim().toLowerCase()
  if ((SMS_STOP_KEYWORDS as readonly string[]).includes(b)) return 'stop'
  if ((SMS_START_KEYWORDS as readonly string[]).includes(b)) return 'start'
  return 'normal'
}

export function matchesSmsFilter(m: SmsMessage, filter: SmsFilter): boolean {
  switch (filter) {
    case 'all':       return true
    case 'unread':    return !m.read
    case 'unmatched': return isUnmatched(m)
    case 'optout':    return smsIntent(m) !== 'normal'
  }
}

export function searchSmsMessages(messages: SmsMessage[], search: string): SmsMessage[] {
  const q = search.trim().toLowerCase()
  if (!q) return messages
  const digits = q.replace(/\D/g, '')
  return messages.filter(m =>
    m.body.toLowerCase().includes(q) ||
    // Digits only, so "555 123", "(555) 123-4567" and "+1555" all find
    // +15551234567. There's deliberately no raw substring check on the
    // number: it made a one-character query like "5" match every message
    // whose number contains a 5, which is every message.
    (digits.length >= 3 && m.fromNumber.replace(/\D/g, '').includes(digits)),
  )
}

export function filterSmsMessages(
  messages: SmsMessage[],
  filter: SmsFilter,
  search: string,
): SmsMessage[] {
  return searchSmsMessages(messages.filter(m => matchesSmsFilter(m, filter)), search)
}

export type SmsCounts = Record<SmsFilter, number>

export function smsCounts(messages: SmsMessage[]): SmsCounts {
  const counts: SmsCounts = { all: messages.length, unread: 0, unmatched: 0, optout: 0 }
  for (const m of messages) {
    if (!m.read) counts.unread++
    if (isUnmatched(m)) counts.unmatched++
    if (smsIntent(m) !== 'normal') counts.optout++
  }
  return counts
}

// ── Phone numbers ─────────────────────────────────────────────────────────────

export function lastTenDigits(v: string): string {
  return v.replace(/\D/g, '').slice(-10)
}

/**
 * "+15551234567" → "(555) 123-4567".
 *
 * The row titled itself with the raw E.164 string even when the message was
 * matched to a customer.
 */
export function formatPhone(v: string): string {
  const digits = v.replace(/\D/g, '')
  const ten = digits.slice(-10)
  if (ten.length !== 10) return v
  const country = digits.slice(0, -10)
  const local = `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`
  return country && country !== '1' ? `+${country} ${local}` : local
}

/**
 * Twilio's inbound `To` is always E.164, and audit.ts keys smsNumberIndex on
 * the raw stored string — so anything other than E.164 creates an index entry
 * that can never match, and the inbox stays permanently empty while the save
 * reports success.
 */
export function isE164(v: string): boolean {
  return /^\+[1-9]\d{7,14}$/.test(v.trim())
}

/**
 * Best-effort E.164 for what someone actually typed.
 *
 * Returns null when it can't be sure, rather than guessing a country code
 * onto a number that might not be North American.
 */
export function normalizeToE164(v: string): string | null {
  const t = v.trim()
  if (t === '') return null
  if (isE164(t)) return t
  const digits = t.replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return null
}

// ── Delivery status ───────────────────────────────────────────────────────────

interface StatusMeta {
  label: string
  classes: string
  /** Whether this is a state that needs someone to look at it. */
  bad: boolean
}

const STATUS_META: Record<SmsStatus, StatusMeta> = {
  queued:    { label: 'Queued',    classes: 'bg-gray-500/20 text-gray-300',   bad: false },
  sent:      { label: 'Sent',      classes: 'bg-blue-500/20 text-blue-300',   bad: false },
  delivered: { label: 'Delivered', classes: 'bg-green-500/20 text-green-300', bad: false },
  failed:    { label: 'Failed',    classes: 'bg-red-500/20 text-red-300',     bad: true  },
  received:  { label: 'Received',  classes: 'bg-gray-500/20 text-gray-300',   bad: false },
}

/**
 * smsStatusWebhook writes `status` and `errorMessage` onto outbound messages
 * and the page rendered neither, so a text that never reached the customer
 * was knowable only by opening that one record.
 */
export function smsStatusMeta(status: string): StatusMeta {
  return STATUS_META[status as SmsStatus] ?? {
    label: status.trim() === '' ? 'Unknown' : status,
    classes: 'bg-gray-500/20 text-gray-300',
    bad: false,
  }
}

/** Names the active filter, for the empty state. */
export function describeSmsFilter(filter: SmsFilter, search: string): string {
  const label = SMS_FILTERS.find(f => f.key === filter)?.label ?? 'All'
  const q = search.trim()
  return q ? `${label} · matching “${q}”` : label
}
