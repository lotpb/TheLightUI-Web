import { describe, it, expect, afterEach, vi } from 'vitest'
import { readFileSync } from 'fs'
import {
  RENDER_CAP, STALE_DAYS, activeFollowUps, bucketFollowUps, emptyMessage,
  filteredFollowUps, queueChips, rowInitials, rowName,
} from './followUpQueue'
import { emptyCustomer, type CustomerItem } from './customer'

/** Follow-up dates are written at local noon by the record page's picker. */
const due = (daysFromToday: number): Date => {
  const d = new Date()
  d.setHours(12, 0, 0, 0)
  d.setDate(d.getDate() + daysFromToday)
  return d
}

function cust(over: Partial<CustomerItem> = {}): CustomerItem {
  return { ...emptyCustomer(), id: 'c1', first: 'Jane', lastname: 'Doe', ...over }
}

function onDay(date: string, fn: () => void) {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(`${date}T09:00:00`))
  try { fn() } finally { vi.useRealTimers() }
}

afterEach(() => { vi.useRealTimers() })

// ── Bucketing ─────────────────────────────────────────────────────────────────

/**
 * subscribeToFollowUps was widened from a one-day past window to a year, which
 * is correct — an unactioned follow-up is the most important row in the product
 * — but this page rendered one card per result with no cap and defaulted to
 * "All". So the fix turned a two-week queue into an unbounded list of history,
 * oldest first, with today's work below it.
 */
describe('bucketFollowUps', () => {
  it('separates a stale backlog from the working queue', () => {
    onDay('2026-09-22', () => {
      const b = bucketFollowUps([
        cust({ id: 'ancient', followUpDate: due(-200) }),
        cust({ id: 'stale',   followUpDate: due(-STALE_DAYS - 1) }),
        cust({ id: 'late',    followUpDate: due(-5) }),
        cust({ id: 'today',   followUpDate: due(0) }),
        cust({ id: 'soon',    followUpDate: due(3) }),
      ])
      expect(b.stale.map(c => c.id)).toEqual(['ancient', 'stale'])
      expect(b.overdue.map(c => c.id)).toEqual(['late'])
      expect(b.today.map(c => c.id)).toEqual(['today'])
      expect(b.upcoming.map(c => c.id)).toEqual(['soon'])
    })
  })

  it('puts the boundary day in overdue, not stale', () => {
    onDay('2026-09-22', () => {
      const b = bucketFollowUps([cust({ id: 'edge', followUpDate: due(-STALE_DAYS) })])
      expect(b.overdue.map(c => c.id)).toEqual(['edge'])
      expect(b.stale).toEqual([])
    })
  })

  it('treats today as due, never overdue', () => {
    onDay('2026-09-22', () => {
      const b = bucketFollowUps([cust({ followUpDate: due(0) })])
      expect(b.overdue).toEqual([])
      expect(b.today).toHaveLength(1)
    })
  })

  it('skips records with no follow-up date', () => {
    const b = bucketFollowUps([cust({ followUpDate: null })])
    expect(activeFollowUps(b)).toEqual([])
    expect(b.stale).toEqual([])
  })

  it('keeps every dated record somewhere', () => {
    onDay('2026-09-22', () => {
      const items = [-400, -31, -30, -1, 0, 1, 14].map((d, i) =>
        cust({ id: `c${i}`, followUpDate: due(d) }))
      const b = bucketFollowUps(items)
      const total = b.stale.length + b.overdue.length + b.today.length + b.upcoming.length
      expect(total).toBe(items.length)
    })
  })

  it('preserves the order the service sorted them in', () => {
    // subscribeToFollowUps sorts ascending by followUpDate, so overdue comes
    // out most-overdue-first and upcoming soonest-first. Nothing re-sorts.
    onDay('2026-09-22', () => {
      const b = bucketFollowUps([
        cust({ id: 'older', followUpDate: due(-10) }),
        cust({ id: 'newer', followUpDate: due(-2) }),
      ])
      expect(b.overdue.map(c => c.id)).toEqual(['older', 'newer'])
    })
  })
})

// ── The default view ──────────────────────────────────────────────────────────

describe('activeFollowUps excludes the stale backlog', () => {
  it('is the working queue in urgency order', () => {
    onDay('2026-09-22', () => {
      const b = bucketFollowUps([
        cust({ id: 'stale', followUpDate: due(-90) }),
        cust({ id: 'late',  followUpDate: due(-2) }),
        cust({ id: 'today', followUpDate: due(0) }),
        cust({ id: 'soon',  followUpDate: due(5) }),
      ])
      expect(activeFollowUps(b).map(c => c.id)).toEqual(['late', 'today', 'soon'])
    })
  })

  it('is what the default filter returns', () => {
    onDay('2026-09-22', () => {
      const b = bucketFollowUps([
        cust({ id: 'stale', followUpDate: due(-90) }),
        cust({ id: 'late',  followUpDate: due(-2) }),
      ])
      expect(filteredFollowUps(b, 'active').map(c => c.id)).toEqual(['late'])
      expect(filteredFollowUps(b, 'stale').map(c => c.id)).toEqual(['stale'])
    })
  })

  it('routes every filter to its own bucket', () => {
    onDay('2026-09-22', () => {
      const b = bucketFollowUps([
        cust({ id: 's', followUpDate: due(-90) }),
        cust({ id: 'o', followUpDate: due(-2) }),
        cust({ id: 't', followUpDate: due(0) }),
        cust({ id: 'u', followUpDate: due(5) }),
      ])
      expect(filteredFollowUps(b, 'overdue').map(c => c.id)).toEqual(['o'])
      expect(filteredFollowUps(b, 'today').map(c => c.id)).toEqual(['t'])
      expect(filteredFollowUps(b, 'upcoming').map(c => c.id)).toEqual(['u'])
      expect(filteredFollowUps(b, 'stale').map(c => c.id)).toEqual(['s'])
    })
  })
})

describe('queueChips', () => {
  it('leads with Active and ends with Stale', () => {
    const chips = queueChips(bucketFollowUps([]))
    expect(chips.map(c => c.key)).toEqual(['active', 'overdue', 'today', 'upcoming', 'stale'])
  })

  it('marks only Overdue as the attention chip', () => {
    expect(queueChips(bucketFollowUps([])).filter(c => c.alert).map(c => c.key)).toEqual(['overdue'])
  })

  it('counts each bucket, and Active as the sum of three', () => {
    onDay('2026-09-22', () => {
      const b = bucketFollowUps([
        cust({ id: 's', followUpDate: due(-90) }),
        cust({ id: 'o', followUpDate: due(-2) }),
        cust({ id: 't', followUpDate: due(0) }),
      ])
      const by = Object.fromEntries(queueChips(b).map(c => [c.key, c.count]))
      expect(by).toEqual({ active: 2, overdue: 1, today: 1, upcoming: 0, stale: 1 })
    })
  })
})

describe('emptyMessage', () => {
  it('points at the stale backlog when the working queue is clear', () => {
    onDay('2026-09-22', () => {
      const b = bucketFollowUps([cust({ followUpDate: due(-90) })])
      const msg = emptyMessage('active', b)
      expect(msg).toContain('1 follow-up')
      expect(msg).toContain('Stale')
    })
  })

  it('is unqualified when there is genuinely nothing', () => {
    expect(emptyMessage('active', bucketFollowUps([]))).toBe('No follow-ups due.')
  })

  it('says what stale means when that filter is empty', () => {
    expect(emptyMessage('stale', bucketFollowUps([]))).toContain(String(STALE_DAYS))
  })

  it('pluralises the backlog correctly', () => {
    onDay('2026-09-22', () => {
      const two = bucketFollowUps([
        cust({ id: 'a', followUpDate: due(-90) }),
        cust({ id: 'b', followUpDate: due(-91) }),
      ])
      expect(emptyMessage('active', two)).toContain('2 follow-ups are')
    })
  })
})

// ── Row identity ──────────────────────────────────────────────────────────────

/**
 * The page rendered `{c.first} {c.lastname}`, so a company record — which the
 * rest of the app titles by companyName — showed blank or as a stray contact.
 */
describe('rowName', () => {
  it('titles a company record by its company, with the person beneath', () => {
    const r = rowName(cust({ companyName: 'Acme Roofing', first: 'Jane', lastname: 'Doe' }))
    expect(r.title).toBe('Acme Roofing')
    expect(r.sub).toBe('Jane Doe')
  })

  it('titles a person record by their name, with no subtitle', () => {
    const r = rowName(cust({ companyName: '', first: 'Jane', lastname: 'Doe' }))
    expect(r.title).toBe('Jane Doe')
    expect(r.sub).toBe('')
  })

  it('never renders an empty title', () => {
    expect(rowName(cust({ companyName: '', first: '', lastname: '' })).title).toBe('Unnamed record')
  })

  it('omits the subtitle for a company with no contact name', () => {
    expect(rowName(cust({ companyName: 'Acme', first: '', lastname: '' })).sub).toBe('')
  })
})

describe('rowInitials', () => {
  it('uses two company words', () => {
    expect(rowInitials(cust({ companyName: 'Acme Roofing' }))).toBe('AR')
  })

  it('uses first and last initials for a person', () => {
    expect(rowInitials(cust({ companyName: '', first: 'Jane', lastname: 'Doe' }))).toBe('JD')
  })

  it('falls back rather than rendering nothing', () => {
    expect(rowInitials(cust({ companyName: '', first: '', lastname: '' }))).toBe('?')
  })

  it('handles a single-word company and a first name only', () => {
    expect(rowInitials(cust({ companyName: 'Acme' }))).toBe('A')
    expect(rowInitials(cust({ companyName: '', first: 'Jane', lastname: '' }))).toBe('J')
  })
})

// ── The page uses it ──────────────────────────────────────────────────────────

describe('FollowUpsPage wiring', () => {
  const raw = readFileSync('src/pages/followups/FollowUpsPage.tsx', 'utf8')
  const page = raw
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n')

  it('defaults to the working queue, not everything', () => {
    expect(page).toContain("useState<QueueFilter>('active')")
    expect(page).not.toContain("useState<'all' | 'overdue'")
  })

  it('caps how many rows it renders', () => {
    expect(page).toContain('RENDER_CAP')
    expect(page).toContain('.slice(0, shown)')
    expect(page).toContain('Show {Math.min(hiddenCount, RENDER_CAP)} more')
  })

  it('has no second implementation of the overdue verdict', () => {
    expect(page).not.toContain('function urgencyLabel')
    expect(page).not.toContain('function daysDiff')
    expect(page).toContain('dueMetaCompact')
  })

  it('has no second date format', () => {
    expect(page).not.toContain("'Jan','Feb'")
    expect(page).not.toContain('function fmtDate')
    expect(page).toContain('fmtDue')
  })

  it('appends a note instead of rewriting the whole record', () => {
    expect(page).toContain('appendCustomerComment')
    expect(page).not.toContain('updateCustomer(c.id, { ...c, comments')
  })

  it('opens Snooze on click, so it exists on a touch device', () => {
    expect(page).not.toContain('group-hover:flex')
    expect(page).toContain('snoozeOpen')
  })

  it('expands a row from a real button', () => {
    expect(page).toContain('aria-expanded={isExpanded}')
    expect(page).not.toContain('cursor-pointer hover:bg-gray-800/40')
  })

  it('has no bg-gray-800 sitting invisibly on a card', () => {
    expect(page).not.toContain('bg-gray-800/40')
    expect(page).not.toContain('bg-gray-800/20')
  })

  it('has no text-gray-500 left on a card surface', () => {
    expect(page).not.toContain('text-gray-500')
  })

  it('has no emoji left', () => {
    for (const g of ['📞', '💬', '✉️', '🚗', '📝', '🎉', '↺', '⏰']) {
      expect(page, `${g} still present`).not.toContain(g)
    }
  })

  it('says the sequences here are browser-local, and points at the real engine', () => {
    expect(page).toContain('saved in this browser only')
    expect(page).toContain('to="/sequences"')
  })

  it('surfaces the backlog the widened window exposed', () => {
    expect(page).toContain('STALE_DAYS')
    expect(page).toContain('Review them')
  })
})

describe('the note write is targeted and transactional', () => {
  const service = readFileSync('src/services/customerService.ts', 'utf8')
  const fn = service.slice(service.indexOf('export async function appendCustomerComment'))

  it('uses a transaction so a concurrent note is not lost', () => {
    expect(fn).toContain('runTransaction')
    expect(fn).toContain('tx.get(ref)')
  })

  it('writes only comments and the actor', () => {
    const update = fn.slice(fn.indexOf('tx.update'), fn.indexOf('})', fn.indexOf('tx.update')))
    expect(update).toContain('comments:')
    expect(update).toContain('lastEditedByName')
    expect(update).not.toContain('phone')
    expect(update).not.toContain('category')
  })

  it('reads the existing value from the server, not from a caller copy', () => {
    expect(fn).toContain("snap.data()['comments']")
  })

  it('ignores a blank note rather than writing an empty header', () => {
    expect(fn).toContain('if (!body) return')
  })
})

describe('the widened window is what this page now has to absorb', () => {
  const service = readFileSync('src/services/customerService.ts', 'utf8')

  it('still reaches back a year', () => {
    const m = service.match(/FOLLOWUP_PAST_DAYS = (\d+)/)
    expect(Number(m?.[1])).toBe(365)
  })

  it('and the page groups anything older than a month apart from the queue', () => {
    expect(STALE_DAYS).toBe(30)
    expect(RENDER_CAP).toBe(50)
  })
})
