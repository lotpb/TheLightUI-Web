import { describe, it, expect } from 'vitest'
import type { EmailMessage } from './emailMessage'
import {
  filterMessages, inboxCounts, isInboxFilter, isUnmatched, matchesInboxFilter,
  quoteBody, relativeTime, replySubject, searchMessages, describeInboxFilter,
  INBOX_FILTERS,
} from './emailInbox'

const NOW = new Date(2026, 8, 16, 12, 0, 0)
const minsAgo = (n: number) => new Date(NOW.getTime() - n * 60_000)

function msg(over: Partial<EmailMessage> = {}): EmailMessage {
  return {
    id: 'm1',
    companyId: 'co1',
    customerId: 'c1',
    direction: 'inbound',
    fromAddress: 'bob@example.com',
    toAddress: 'replies+co1@thelightcrm.com',
    subject: 'Roof quote',
    body: 'Looks good, when can you start?',
    createdAt: minsAgo(5),
    read: false,
    attachmentNames: [],
    ...over,
  }
}

describe('isUnmatched', () => {
  it('flags a reply the webhook could not tie to a record', () => {
    // emailInboundWebhook matches on an exact email equality query, so a
    // customer replying from a different address lands with customerId ''.
    expect(isUnmatched(msg({ customerId: '' }))).toBe(true)
    expect(isUnmatched(msg({ customerId: '   ' }))).toBe(true)
  })

  it('is false for a matched reply', () => {
    expect(isUnmatched(msg({ customerId: 'c9' }))).toBe(false)
  })
})

describe('matchesInboxFilter', () => {
  it('passes everything for all', () => {
    expect(matchesInboxFilter(msg({ read: true }), 'all')).toBe(true)
  })

  it('finds unread', () => {
    expect(matchesInboxFilter(msg({ read: false }), 'unread')).toBe(true)
    expect(matchesInboxFilter(msg({ read: true }), 'unread')).toBe(false)
  })

  it('finds unmatched regardless of read state', () => {
    expect(matchesInboxFilter(msg({ customerId: '', read: true }), 'unmatched')).toBe(true)
    expect(matchesInboxFilter(msg({ customerId: 'c1', read: false }), 'unmatched')).toBe(false)
  })
})

describe('searchMessages', () => {
  const items = [
    msg({ id: 'a', fromAddress: 'ann@acme.com', subject: 'Gutters', body: 'need a quote' }),
    msg({ id: 'b', fromAddress: 'bob@example.com', subject: 'Roof', body: 'when can you start' }),
  ]

  it('matches sender, subject and body', () => {
    expect(searchMessages(items, 'acme').map(m => m.id)).toEqual(['a'])
    expect(searchMessages(items, 'roof').map(m => m.id)).toEqual(['b'])
    expect(searchMessages(items, 'quote').map(m => m.id)).toEqual(['a'])
  })

  it('is case- and whitespace-insensitive', () => {
    expect(searchMessages(items, '  ACME ').map(m => m.id)).toEqual(['a'])
  })

  it('returns everything for a blank query', () => {
    expect(searchMessages(items, '  ')).toHaveLength(2)
  })
})

describe('filterMessages', () => {
  it('applies the filter and the search together', () => {
    const items = [
      msg({ id: 'a', customerId: '', subject: 'Roof job', read: false }),
      msg({ id: 'b', customerId: '', subject: 'Gutter job', read: true }),
      msg({ id: 'c', customerId: 'c1', subject: 'Roof job', read: false }),
    ]
    expect(filterMessages(items, 'unmatched', 'roof').map(m => m.id)).toEqual(['a'])
    expect(filterMessages(items, 'unread', 'roof').map(m => m.id)).toEqual(['a', 'c'])
  })
})

describe('inboxCounts', () => {
  const items = [
    msg({ id: 'a', read: false, customerId: 'c1' }),
    msg({ id: 'b', read: true,  customerId: 'c2' }),
    msg({ id: 'c', read: false, customerId: '' }),
    msg({ id: 'd', read: true,  customerId: '' }),
  ]

  it('counts each tab', () => {
    expect(inboxCounts(items)).toEqual({ all: 4, unread: 2, unmatched: 2 })
  })

  it('counts unread and unmatched independently, since they overlap', () => {
    // One message is both, and must appear in each count exactly once.
    const both = inboxCounts([msg({ read: false, customerId: '' })])
    expect(both).toEqual({ all: 1, unread: 1, unmatched: 1 })
  })

  it('is all zeroes for an empty inbox', () => {
    expect(inboxCounts([])).toEqual({ all: 0, unread: 0, unmatched: 0 })
  })

  it('covers every filter the tab strip offers', () => {
    const c = inboxCounts(items)
    for (const f of INBOX_FILTERS) expect(typeof c[f.key]).toBe('number')
  })
})

describe('relativeTime', () => {
  it('reads as fresh for recent mail', () => {
    // Every row showed an absolute date even for something nine minutes old.
    expect(relativeTime(minsAgo(0), NOW)).toBe('just now')
    expect(relativeTime(minsAgo(9), NOW)).toBe('9m ago')
    expect(relativeTime(minsAgo(59), NOW)).toBe('59m ago')
  })

  it('steps up through hours and days', () => {
    expect(relativeTime(minsAgo(60), NOW)).toBe('1h ago')
    expect(relativeTime(minsAgo(60 * 23), NOW)).toBe('23h ago')
    expect(relativeTime(minsAgo(60 * 24), NOW)).toBe('1d ago')
    expect(relativeTime(minsAgo(60 * 24 * 6), NOW)).toBe('6d ago')
  })

  it('falls back to a date once it is a week old', () => {
    expect(relativeTime(minsAgo(60 * 24 * 7), NOW)).toMatch(/Sep 9, 2026/)
  })

  it('does not render a negative age from clock skew', () => {
    expect(relativeTime(new Date(NOW.getTime() + 60_000), NOW)).toBe('just now')
  })
})

describe('replySubject', () => {
  it('prefixes once', () => {
    expect(replySubject('Roof quote')).toBe('Re: Roof quote')
  })

  it('does not stack prefixes however many round trips', () => {
    expect(replySubject('Re: Roof quote')).toBe('Re: Roof quote')
    expect(replySubject('RE: Roof quote')).toBe('RE: Roof quote')
    expect(replySubject('re: Roof quote')).toBe('re: Roof quote')
  })

  it('still produces a subject when the original had none', () => {
    expect(replySubject('')).toBe('Re: (no subject)')
    expect(replySubject('   ')).toBe('Re: (no subject)')
  })
})

describe('quoteBody', () => {
  it('quotes every line with a marker', () => {
    const q = quoteBody(msg({ body: 'line one\nline two' }), NOW)
    expect(q).toContain('> line one')
    expect(q).toContain('> line two')
  })

  it('attributes the quote to the sender and the time', () => {
    const q = quoteBody(msg({ fromAddress: 'ann@acme.com' }), NOW)
    expect(q).toContain('ann@acme.com wrote:')
  })

  it('leaves room above for the reply to be typed', () => {
    expect(quoteBody(msg(), NOW).startsWith('\n\n')).toBe(true)
  })

  it('handles an empty body without producing a bare marker line', () => {
    expect(quoteBody(msg({ body: '' }), NOW)).toContain('> ')
  })
})

describe('describeInboxFilter', () => {
  it('names the filter and the search', () => {
    expect(describeInboxFilter('unmatched', '')).toBe('Unmatched')
    expect(describeInboxFilter('unread', 'roof')).toBe('Unread · matching “roof”')
  })

  it('ignores a blank search', () => {
    expect(describeInboxFilter('all', '  ')).toBe('All')
  })
})

describe('isInboxFilter', () => {
  it('accepts the three real filters', () => {
    for (const f of INBOX_FILTERS) expect(isInboxFilter(f.key)).toBe(true)
  })

  it('rejects anything else, so a hand-edited URL falls back', () => {
    expect(isInboxFilter('spam')).toBe(false)
    expect(isInboxFilter(null)).toBe(false)
  })
})
