import { describe, it, expect, afterEach, vi } from 'vitest'
import { daysUntilDue, dueMeta, dueMetaCompact, isOverdue } from './dueDate'

/** A date input writes UTC midnight, which is how due dates reach us. */
const utc = (s: string) => new Date(s)

function onDay(localDate: string, fn: () => void) {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(`${localDate}T09:00:00`))
  try { fn() } finally { vi.useRealTimers() }
}

afterEach(() => { vi.useRealTimers() })

describe('dueMetaCompact', () => {
  it('shortens an overdue label to fit a narrow column', () => {
    onDay('2026-09-21', () => {
      const full    = dueMeta(utc('2026-09-12'), false)
      const compact = dueMetaCompact(utc('2026-09-12'), false)
      expect(full.label).toBe('Due Sep 12, 2026 · 9 days overdue')
      expect(compact.label).toBe('9d overdue')
      expect(compact.label.length).toBeLessThan(full.label.length)
    })
  })

  it('agrees with dueMeta on status and colour for every case', () => {
    onDay('2026-09-21', () => {
      for (const d of ['2026-09-12', '2026-09-21', '2026-09-22', '2026-10-30']) {
        for (const done of [true, false]) {
          const full    = dueMeta(utc(d), done)
          const compact = dueMetaCompact(utc(d), done)
          expect(compact.status, `${d} done=${done}`).toBe(full.status)
          expect(compact.cls,    `${d} done=${done}`).toBe(full.cls)
        }
      }
    })
  })

  it('names today and tomorrow', () => {
    onDay('2026-09-21', () => {
      expect(dueMetaCompact(utc('2026-09-21'), false).label).toBe('Today')
      expect(dueMetaCompact(utc('2026-09-22'), false).label).toBe('Tomorrow')
    })
  })

  it('falls back to a month/day date further out', () => {
    onDay('2026-09-21', () => {
      expect(dueMetaCompact(utc('2026-10-30'), false).label).toBe('Oct 30')
    })
  })

  it('reads the day in UTC, so it does not show the day before west of UTC', () => {
    onDay('2026-09-21', () => {
      // 2026-09-30T00:00:00Z is Sep 29 in local time for any US timezone.
      expect(dueMetaCompact(utc('2026-09-30'), false).label).toBe('Sep 30')
    })
  })

  it('says one day, not 1 days', () => {
    onDay('2026-09-21', () => {
      expect(dueMetaCompact(utc('2026-09-20'), false).label).toBe('1d overdue')
    })
  })
})

/**
 * The Follow-Ups card's own copy computed
 * `Math.round((due - localMidnight) / 86400000)`.
 *
 * The *count* that produced was in fact fine: a DST boundary shifts the
 * quotient by an hour in twenty-four and the rounding absorbs it, as the first
 * test here records. What was actually broken was the label it fell back to —
 * a bare toLocaleDateString() on a UTC-midnight value, which renders the
 * previous day anywhere west of UTC. These tests pin the count as unremarkable
 * and the rendering as the thing that had to change.
 */
describe('day counting across a DST boundary', () => {
  it('matches the rounded elapsed-time count, which DST does not break', () => {
    onDay('2026-03-01', () => {
      expect(daysUntilDue(utc('2026-04-01'))).toBe(31)
      const naive = Math.round(
        (utc('2026-04-01').getTime() - new Date(2026, 2, 1).getTime()) / 86_400_000,
      )
      expect(naive).toBe(31)
    })
  })

  it('still calls the day after a spring-forward "Tomorrow"', () => {
    // US DST begins 2026-03-08.
    onDay('2026-03-07', () => {
      expect(dueMetaCompact(utc('2026-03-08'), false).label).toBe('Tomorrow')
      expect(daysUntilDue(utc('2026-03-08'))).toBe(1)
    })
  })

  it('still calls the day after a fall-back "Tomorrow"', () => {
    // US DST ends 2026-11-01.
    onDay('2026-10-31', () => {
      expect(dueMetaCompact(utc('2026-11-01'), false).label).toBe('Tomorrow')
      expect(daysUntilDue(utc('2026-11-01'))).toBe(1)
    })
  })

  it('does not treat today as overdue', () => {
    onDay('2026-09-21', () => {
      expect(isOverdue(utc('2026-09-21'))).toBe(false)
      expect(isOverdue(utc('2026-09-20'))).toBe(true)
    })
  })
})
