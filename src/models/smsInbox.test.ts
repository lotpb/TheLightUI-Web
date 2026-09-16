import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import type { SmsMessage } from './smsMessage'
import {
  filterSmsMessages, formatPhone, isE164, isSmsFilter, isUnmatched, lastTenDigits,
  matchesSmsFilter, normalizeToE164, searchSmsMessages, smsCounts, smsIntent,
  smsStatusMeta, describeSmsFilter,
  SMS_FILTERS, SMS_START_KEYWORDS, SMS_STOP_KEYWORDS,
} from './smsInbox'

const NOW = new Date(2026, 8, 16, 12, 0, 0)

function msg(over: Partial<SmsMessage> = {}): SmsMessage {
  return {
    id: 'm1',
    companyId: 'co1',
    customerId: 'c1',
    direction: 'inbound',
    fromNumber: '+15551234567',
    toNumber: '+15557654321',
    body: 'Sounds good, see you Tuesday',
    status: 'received',
    errorMessage: '',
    createdAt: NOW,
    read: false,
    ...over,
  }
}

/**
 * The webhook acts on these keywords — writes smsOptOuts, flips
 * Customers.smsOptOut, sends an auto-reply — so the page's copy of the list
 * has to match or the inbox will badge the wrong messages.
 */
describe('opt-out keyword parity with the Cloud Function', () => {
  const src = readFileSync('functions/src/outreach.ts', 'utf8')

  function serverList(name: string): string[] {
    const m = src.match(new RegExp(`const ${name}\\s*=\\s*\\[([^\\]]*)\\]`))
    expect(m).not.toBeNull()
    return m![1].split(',').map(s => s.trim().replace(/^'|'$/g, '')).filter(Boolean)
  }

  it('has the same STOP keywords the server acts on', () => {
    expect([...SMS_STOP_KEYWORDS].sort()).toEqual(serverList('SMS_STOP_KEYWORDS').sort())
  })

  it('has the same START keywords', () => {
    expect([...SMS_START_KEYWORDS].sort()).toEqual(serverList('SMS_START_KEYWORDS').sort())
  })
})

describe('smsIntent', () => {
  it('recognises every STOP keyword, case- and space-insensitively', () => {
    for (const k of SMS_STOP_KEYWORDS) {
      expect(smsIntent(msg({ body: k }))).toBe('stop')
      expect(smsIntent(msg({ body: `  ${k.toUpperCase()} ` }))).toBe('stop')
    }
  })

  it('recognises START', () => {
    for (const k of SMS_START_KEYWORDS) {
      expect(smsIntent(msg({ body: k }))).toBe('start')
    }
  })

  it('leaves an ordinary reply alone', () => {
    expect(smsIntent(msg({ body: 'Sounds good' }))).toBe('normal')
  })

  it('does not fire on a keyword inside a sentence, matching the server', () => {
    // The webhook compares the whole trimmed body, so "please stop by" is not
    // an opt-out — badging it as one would be worse than not badging it.
    expect(smsIntent(msg({ body: 'please stop by tomorrow' }))).toBe('normal')
    expect(smsIntent(msg({ body: 'cancel my appointment' }))).toBe('normal')
  })
})

describe('isUnmatched', () => {
  it('flags a text from a number on no record', () => {
    expect(isUnmatched(msg({ customerId: '' }))).toBe(true)
    expect(isUnmatched(msg({ customerId: '  ' }))).toBe(true)
  })

  it('is false once matched', () => {
    expect(isUnmatched(msg({ customerId: 'c7' }))).toBe(false)
  })
})

describe('matchesSmsFilter', () => {
  it('finds unread, unmatched and opt-out traffic', () => {
    expect(matchesSmsFilter(msg({ read: false }), 'unread')).toBe(true)
    expect(matchesSmsFilter(msg({ customerId: '' }), 'unmatched')).toBe(true)
    expect(matchesSmsFilter(msg({ body: 'STOP' }), 'optout')).toBe(true)
    expect(matchesSmsFilter(msg({ body: 'START' }), 'optout')).toBe(true)
  })

  it('keeps an ordinary read text out of every narrow filter', () => {
    const m = msg({ read: true, customerId: 'c1', body: 'thanks' })
    expect(matchesSmsFilter(m, 'all')).toBe(true)
    expect(matchesSmsFilter(m, 'unread')).toBe(false)
    expect(matchesSmsFilter(m, 'unmatched')).toBe(false)
    expect(matchesSmsFilter(m, 'optout')).toBe(false)
  })
})

describe('searchSmsMessages', () => {
  const items = [
    msg({ id: 'a', fromNumber: '+15551234567', body: 'Need a quote for gutters' }),
    msg({ id: 'b', fromNumber: '+15559998888', body: 'Running late' }),
  ]

  it('matches the message body', () => {
    expect(searchSmsMessages(items, 'gutters').map(m => m.id)).toEqual(['a'])
  })

  it('matches a number however the searcher punctuates it', () => {
    // Nobody types +15551234567 to find a text.
    for (const q of ['5551234567', '555 123', '(555) 123-4567', '123-4567']) {
      expect(searchSmsMessages(items, q).map(m => m.id)).toEqual(['a'])
    }
  })

  it('ignores a one- or two-digit query rather than matching everything', () => {
    expect(searchSmsMessages(items, '5')).toHaveLength(0)
  })

  it('returns everything for a blank query', () => {
    expect(searchSmsMessages(items, '  ')).toHaveLength(2)
  })
})

describe('filterSmsMessages', () => {
  it('applies the filter and the search together', () => {
    const items = [
      msg({ id: 'a', customerId: '', body: 'quote please' }),
      msg({ id: 'b', customerId: 'c1', body: 'quote please' }),
    ]
    expect(filterSmsMessages(items, 'unmatched', 'quote').map(m => m.id)).toEqual(['a'])
  })
})

describe('smsCounts', () => {
  const items = [
    msg({ id: 'a', read: false, customerId: 'c1', body: 'hello' }),
    msg({ id: 'b', read: true,  customerId: '',   body: 'hi' }),
    msg({ id: 'c', read: false, customerId: 'c2', body: 'STOP' }),
    msg({ id: 'd', read: true,  customerId: 'c3', body: 'start' }),
  ]

  it('counts each tab', () => {
    expect(smsCounts(items)).toEqual({ all: 4, unread: 2, unmatched: 1, optout: 2 })
  })

  it('counts a message in every tab it belongs to', () => {
    // An unread STOP from an unknown number is all three at once.
    expect(smsCounts([msg({ read: false, customerId: '', body: 'STOP' })]))
      .toEqual({ all: 1, unread: 1, unmatched: 1, optout: 1 })
  })

  it('is all zeroes for an empty inbox', () => {
    expect(smsCounts([])).toEqual({ all: 0, unread: 0, unmatched: 0, optout: 0 })
  })

  it('covers every filter the tab strip offers', () => {
    const c = smsCounts(items)
    for (const f of SMS_FILTERS) expect(typeof c[f.key]).toBe('number')
  })
})

describe('formatPhone', () => {
  it('formats a US E.164 number for reading', () => {
    expect(formatPhone('+15551234567')).toBe('(555) 123-4567')
  })

  it('keeps a non-US country code visible', () => {
    expect(formatPhone('+445551234567')).toBe('+44 (555) 123-4567')
  })

  it('handles a bare ten-digit number', () => {
    expect(formatPhone('5551234567')).toBe('(555) 123-4567')
  })

  it('returns anything it cannot parse unchanged, rather than mangling it', () => {
    expect(formatPhone('')).toBe('')
    expect(formatPhone('short')).toBe('short')
    expect(formatPhone('+1555')).toBe('+1555')
  })
})

describe('lastTenDigits', () => {
  it('matches the server helper of the same name', () => {
    expect(lastTenDigits('+1 (555) 123-4567')).toBe('5551234567')
    expect(lastTenDigits('555.123.4567')).toBe('5551234567')
  })
})

/**
 * The number field stated "E.164 format" in prose and enforced nothing, while
 * audit.ts keys smsNumberIndex on the raw string — so a friendly-looking
 * number created an index entry Twilio's E.164 `To` could never match, and
 * the inbox stayed empty behind a green "saved" toast.
 */
describe('isE164', () => {
  it('accepts a real E.164 number', () => {
    expect(isE164('+15551234567')).toBe(true)
    expect(isE164('+442071234567')).toBe(true)
    expect(isE164('  +15551234567 ')).toBe(true)
  })

  it('rejects everything Twilio would never send as `To`', () => {
    for (const bad of ['5551234567', '(555) 123-4567', '+1 555 123 4567', '+0555123456', '15551234567', '', '+1555']) {
      expect(isE164(bad)).toBe(false)
    }
  })
})

describe('normalizeToE164', () => {
  it('passes a valid number through', () => {
    expect(normalizeToE164('+15551234567')).toBe('+15551234567')
  })

  it('fixes the two formats people actually type', () => {
    expect(normalizeToE164('(555) 123-4567')).toBe('+15551234567')
    expect(normalizeToE164('555-123-4567')).toBe('+15551234567')
    expect(normalizeToE164('1 555 123 4567')).toBe('+15551234567')
  })

  it('refuses to guess a country code onto something ambiguous', () => {
    // Better to make the user fix it than to silently create an index entry
    // for the wrong country.
    expect(normalizeToE164('+44 555 123 4567')).toBeNull()
    expect(normalizeToE164('12345')).toBeNull()
    expect(normalizeToE164('')).toBeNull()
    expect(normalizeToE164('   ')).toBeNull()
  })
})

describe('smsStatusMeta', () => {
  it('marks a failed send as needing attention', () => {
    expect(smsStatusMeta('failed').bad).toBe(true)
    expect(smsStatusMeta('failed').label).toBe('Failed')
  })

  it('does not flag a healthy state', () => {
    for (const s of ['queued', 'sent', 'delivered', 'received']) {
      expect(smsStatusMeta(s).bad).toBe(false)
    }
  })

  it('keeps an unknown status visible rather than blanking the pill', () => {
    // Twilio adds statuses; an unmapped one must not render empty.
    expect(smsStatusMeta('undelivered').label).toBe('undelivered')
    expect(smsStatusMeta('undelivered').classes).not.toBe('')
    expect(smsStatusMeta('').label).toBe('Unknown')
  })
})

describe('describeSmsFilter and isSmsFilter', () => {
  it('names the filter and the search', () => {
    expect(describeSmsFilter('optout', '')).toBe('Opt-outs')
    expect(describeSmsFilter('unread', '555')).toBe('Unread · matching “555”')
  })

  it('rejects a hand-edited URL value', () => {
    for (const f of SMS_FILTERS) expect(isSmsFilter(f.key)).toBe(true)
    expect(isSmsFilter('archived')).toBe(false)
    expect(isSmsFilter(null)).toBe(false)
  })
})
