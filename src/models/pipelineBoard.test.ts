import { describe, it, expect } from 'vitest'
import { emptyCustomer, type CustomerItem } from './customer'
import { DEFAULT_STAGES } from './pipelineStage'
import {
  bucketByStage, clampStaleDays, daysSince, filterStale, isStale,
  orphanedStageId, stageTotals, staleCount,
  DEFAULT_STALE_DAYS,
} from './pipelineBoard'

const NOW = new Date(2026, 8, 16, 12, 0, 0)
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000)

function cust(over: Partial<CustomerItem> = {}): CustomerItem {
  return {
    ...emptyCustomer(),
    id: 'c1',
    first: 'Jane',
    lastname: 'Doe',
    category: 'Lead',
    amount: 1000,
    creationDate: daysAgo(30),
    lastUpdateDate: daysAgo(1),
    pipelineStage: 'new',
    ...over,
  }
}

const OPEN = DEFAULT_STAGES.find(s => s.id === 'contacted')!
const WON  = DEFAULT_STAGES.find(s => s.kind === 'won')!
const LOST = DEFAULT_STAGES.find(s => s.kind === 'lost')!
const APPT = DEFAULT_STAGES.find(s => s.requiresDate)!

describe('clampStaleDays', () => {
  it('keeps a sane stored value', () => {
    expect(clampStaleDays(14)).toBe(14)
    expect(clampStaleDays('21')).toBe(21)
  })

  it('falls back on rubbish', () => {
    expect(clampStaleDays(undefined)).toBe(DEFAULT_STALE_DAYS)
    expect(clampStaleDays(null)).toBe(DEFAULT_STALE_DAYS)
    expect(clampStaleDays('soon')).toBe(DEFAULT_STALE_DAYS)
    expect(clampStaleDays(NaN)).toBe(DEFAULT_STALE_DAYS)
  })

  it('refuses a value that would mark everything or nothing stale', () => {
    expect(clampStaleDays(0)).toBe(1)
    expect(clampStaleDays(-5)).toBe(1)
    expect(clampStaleDays(10_000)).toBe(365)
  })
})

describe('daysSince', () => {
  it('counts whole days', () => {
    expect(daysSince(daysAgo(3), NOW)).toBe(3)
    expect(daysSince(NOW, NOW)).toBe(0)
  })
})

describe('isStale', () => {
  it('flags an open-stage card past the threshold', () => {
    expect(isStale(cust({ lastUpdateDate: daysAgo(8) }), OPEN, 7, NOW)).toBe(true)
  })

  it('leaves a recently touched card alone', () => {
    expect(isStale(cust({ lastUpdateDate: daysAgo(2) }), OPEN, 7, NOW)).toBe(false)
  })

  it('is not stale exactly on the threshold', () => {
    expect(isStale(cust({ lastUpdateDate: daysAgo(7) }), OPEN, 7, NOW)).toBe(false)
  })

  it('never flags a won or lost card, however old', () => {
    // Nobody is waiting on a closed record — this is also why the going-cold
    // filter empties those columns.
    const old = cust({ lastUpdateDate: daysAgo(400) })
    expect(isStale(old, WON, 7, NOW)).toBe(false)
    expect(isStale(old, LOST, 7, NOW)).toBe(false)
  })

  it('respects a company threshold other than seven days', () => {
    const c = cust({ lastUpdateDate: daysAgo(20) })
    expect(isStale(c, OPEN, 30, NOW)).toBe(false)
    expect(isStale(c, OPEN, 14, NOW)).toBe(true)
  })

  it('is not stale when the stage is unknown', () => {
    expect(isStale(cust({ lastUpdateDate: daysAgo(99) }), undefined, 7, NOW)).toBe(false)
  })
})

describe('orphanedStageId', () => {
  it('reports a stored stage that no longer exists in the config', () => {
    expect(orphanedStageId(cust({ pipelineStage: 'site-visit' }), DEFAULT_STAGES)).toBe('site-visit')
  })

  it('is null for a stage that does exist', () => {
    expect(orphanedStageId(cust({ pipelineStage: 'contacted' }), DEFAULT_STAGES)).toBeNull()
  })

  it('is null for a record that has never been dragged', () => {
    // No pipelineStage at all is the legacy case, not an orphan.
    expect(orphanedStageId(cust({ pipelineStage: '' }), DEFAULT_STAGES)).toBeNull()
    expect(orphanedStageId(cust({ pipelineStage: '   ' }), DEFAULT_STAGES)).toBeNull()
  })
})

describe('bucketByStage', () => {
  it('creates a bucket for every configured stage, even an empty one', () => {
    const buckets = bucketByStage([], DEFAULT_STAGES)
    for (const s of DEFAULT_STAGES) expect(buckets[s.id]).toEqual([])
  })

  it('puts a card in its own stage', () => {
    const buckets = bucketByStage([cust({ id: 'a', pipelineStage: 'contacted' })], DEFAULT_STAGES)
    expect(buckets['contacted'].map(c => c.id)).toEqual(['a'])
  })

  it('falls back to the first stage when the stored stage is gone', () => {
    const buckets = bucketByStage([cust({ id: 'a', pipelineStage: 'deleted-stage' })], DEFAULT_STAGES)
    expect(buckets[DEFAULT_STAGES[0].id].map(c => c.id)).toEqual(['a'])
  })

  it('sorts a date-driven stage by soonest appointment', () => {
    const buckets = bucketByStage([
      cust({ id: 'late',  pipelineStage: APPT.id, startDate: new Date(2026, 9, 20) }),
      cust({ id: 'soon',  pipelineStage: APPT.id, startDate: new Date(2026, 8, 18) }),
      cust({ id: 'mid',   pipelineStage: APPT.id, startDate: new Date(2026, 9, 1) }),
    ], DEFAULT_STAGES)
    expect(buckets[APPT.id].map(c => c.id)).toEqual(['soon', 'mid', 'late'])
  })

  it('sorts every other stage newest-created first', () => {
    const buckets = bucketByStage([
      cust({ id: 'old', pipelineStage: 'contacted', creationDate: daysAgo(60) }),
      cust({ id: 'new', pipelineStage: 'contacted', creationDate: daysAgo(1) }),
    ], DEFAULT_STAGES)
    expect(buckets['contacted'].map(c => c.id)).toEqual(['new', 'old'])
  })
})

describe('stageTotals', () => {
  const buckets = {
    new:       [cust({ id: 'a', amount: 1500 }), cust({ id: 'b', amount: 500 })],
    contacted: [cust({ id: 'c', amount: 3000 })],
    appointment: [],
    won:       [cust({ id: 'd', amount: 12000 })],
    lost:      [cust({ id: 'e', amount: 9999 })],
  }

  it('reports count and money for every stage', () => {
    const t = stageTotals(buckets, DEFAULT_STAGES)
    expect(t['new']).toEqual({ count: 2, value: 2000 })
    expect(t['contacted']).toEqual({ count: 1, value: 3000 })
    expect(t['won']).toEqual({ count: 1, value: 12000 })
  })

  it('reports zeroes for an empty stage rather than omitting it', () => {
    expect(stageTotals(buckets, DEFAULT_STAGES)['appointment']).toEqual({ count: 0, value: 0 })
  })

  it('derives from the buckets it was handed, so money and count agree', () => {
    // The defect: the Won column's count came from the filtered buckets and
    // its money from the unfiltered ones, so it read "0 records · $12,000".
    const filtered = { ...buckets, won: [] }
    const t = stageTotals(filtered, DEFAULT_STAGES)
    expect(t['won']).toEqual({ count: 0, value: 0 })
  })

  it('handles a stage with no bucket at all', () => {
    expect(stageTotals({}, DEFAULT_STAGES)['new']).toEqual({ count: 0, value: 0 })
  })
})

describe('staleCount and filterStale', () => {
  const buckets = {
    new:       [cust({ id: 'a', lastUpdateDate: daysAgo(10) }), cust({ id: 'b', lastUpdateDate: daysAgo(1) })],
    contacted: [cust({ id: 'c', lastUpdateDate: daysAgo(30) })],
    appointment: [],
    won:       [cust({ id: 'd', lastUpdateDate: daysAgo(90) })],
    lost:      [cust({ id: 'e', lastUpdateDate: daysAgo(90) })],
  }

  it('counts only open-stage cards past the threshold', () => {
    expect(staleCount(buckets, DEFAULT_STAGES, 7, NOW)).toBe(2)
  })

  it('moves with the threshold', () => {
    expect(staleCount(buckets, DEFAULT_STAGES, 14, NOW)).toBe(1)
    expect(staleCount(buckets, DEFAULT_STAGES, 60, NOW)).toBe(0)
  })

  it('narrows every bucket to the cold cards', () => {
    const out = filterStale(buckets, DEFAULT_STAGES, 7, NOW)
    expect(out['new'].map(c => c.id)).toEqual(['a'])
    expect(out['contacted'].map(c => c.id)).toEqual(['c'])
  })

  it('empties the won and lost columns, which is why their totals must follow', () => {
    const out = filterStale(buckets, DEFAULT_STAGES, 7, NOW)
    expect(out['won']).toEqual([])
    expect(out['lost']).toEqual([])
    expect(stageTotals(out, DEFAULT_STAGES)['won']).toEqual({ count: 0, value: 0 })
  })

  it('keeps a bucket for every stage so the board still renders', () => {
    const out = filterStale(buckets, DEFAULT_STAGES, 7, NOW)
    for (const s of DEFAULT_STAGES) expect(Array.isArray(out[s.id])).toBe(true)
  })
})
