import { describe, it, expect } from 'vitest'
import { calcCommission, type CommissionStructure } from './commission'

const flat: CommissionStructure = {
  mode: 'flat',
  defaultRate: 10,
  tiers: [],
  overrides: {},
}

const tiered: CommissionStructure = {
  mode: 'tiered',
  defaultRate: 5, // fallback only, shouldn't be hit while tiers exist
  tiers: [
    { upTo: 10_000, rate: 5 },
    { upTo: 50_000, rate: 8 },
    { upTo: null,   rate: 12 }, // uncapped top tier
  ],
  overrides: { Alice: 20 },
}

describe('calcCommission — flat mode', () => {
  it('applies the flat default rate', () => {
    const { commission, rate, isOverride } = calcCommission(1000, flat, 'Bob')
    expect(rate).toBe(10)
    expect(commission).toBe(100)
    expect(isOverride).toBe(false)
  })

  it('is zero commission on zero revenue', () => {
    expect(calcCommission(0, flat, 'Bob').commission).toBe(0)
  })
})

describe('calcCommission — per-salesman override', () => {
  it('takes priority over the structure entirely, even in tiered mode', () => {
    const { commission, rate, isOverride } = calcCommission(100_000, tiered, 'Alice')
    expect(rate).toBe(20)
    expect(commission).toBe(20_000)
    expect(isOverride).toBe(true)
  })

  it('does not apply to a salesman not listed in overrides', () => {
    expect(calcCommission(1000, tiered, 'Bob').isOverride).toBe(false)
  })
})

describe('calcCommission — tiered mode', () => {
  it('rates the whole revenue at the first tier whose cap it falls within', () => {
    const { commission, rate } = calcCommission(5_000, tiered, 'Bob')
    expect(rate).toBe(5)
    expect(commission).toBe(250)
  })

  it('uses the middle tier once revenue exceeds the first cap', () => {
    const { commission, rate } = calcCommission(30_000, tiered, 'Bob')
    expect(rate).toBe(8)
    expect(commission).toBe(2_400)
  })

  it('falls through to the uncapped top tier for revenue above every cap', () => {
    const { commission, rate } = calcCommission(1_000_000, tiered, 'Bob')
    expect(rate).toBe(12)
    expect(commission).toBe(120_000)
  })

  it('rates revenue exactly at a tier boundary using that tier (inclusive upper bound)', () => {
    const { rate } = calcCommission(10_000, tiered, 'Bob')
    expect(rate).toBe(5)
  })

  it('is unaffected by the order tiers are defined in', () => {
    const shuffled: CommissionStructure = {
      ...tiered,
      tiers: [tiered.tiers[2], tiered.tiers[0], tiered.tiers[1]],
      overrides: {},
    }
    expect(calcCommission(30_000, shuffled, 'Bob').rate).toBe(8)
  })

  it('falls back to the flat default rate when tiered mode has no tiers configured', () => {
    const emptyTiers: CommissionStructure = { mode: 'tiered', defaultRate: 7, tiers: [], overrides: {} }
    const { rate } = calcCommission(1000, emptyTiers, 'Bob')
    expect(rate).toBe(7)
  })
})
