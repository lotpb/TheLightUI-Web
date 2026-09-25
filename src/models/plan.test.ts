import { describe, it, expect } from 'vitest'
import {
  parsePlan, effectivePlan, planIncludes, requiredPlanFor, canAccessPath, recordCapError,
} from './plan'
import { ALL_ITEMS } from '../config/navigation'

describe('parsePlan', () => {
  it('accepts the three plans', () => {
    expect(parsePlan('starter')).toBe('starter')
    expect(parsePlan('professional')).toBe('professional')
    expect(parsePlan('enterprise')).toBe('enterprise')
  })

  it('treats the legacy free value, missing and junk as unassigned', () => {
    expect(parsePlan('free')).toBeNull()
    expect(parsePlan(undefined)).toBeNull()
    expect(parsePlan('')).toBeNull()
    expect(parsePlan(3)).toBeNull()
    expect(parsePlan('Enterprise')).toBeNull()
  })
})

describe('effectivePlan', () => {
  it('gives unassigned companies full access', () => {
    expect(effectivePlan(null)).toBe('enterprise')
    expect(effectivePlan('starter')).toBe('starter')
  })
})

describe('planIncludes', () => {
  it('ranks plans', () => {
    expect(planIncludes('enterprise', 'starter')).toBe(true)
    expect(planIncludes('professional', 'professional')).toBe(true)
    expect(planIncludes('starter', 'professional')).toBe(false)
    expect(planIncludes('professional', 'enterprise')).toBe(false)
  })
})

describe('requiredPlanFor', () => {
  it('defaults unlisted routes to starter', () => {
    expect(requiredPlanFor('/records/abc')).toBe('starter')
    expect(requiredPlanFor('/maps')).toBe('starter')
    expect(requiredPlanFor('/team')).toBe('starter')
    expect(requiredPlanFor('/')).toBe('starter')
  })

  it('inherits from the parent route', () => {
    expect(requiredPlanFor('/chat/u123')).toBe('professional')
    expect(requiredPlanFor('/campaigns/xyz')).toBe('professional')
  })

  it('prefers the longest matching prefix', () => {
    expect(requiredPlanFor('/invoices')).toBe('starter')
    expect(requiredPlanFor('/invoices/abc')).toBe('starter')
    expect(requiredPlanFor('/invoices/recurring')).toBe('professional')
  })

  it('does not match a prefix that is only a partial segment', () => {
    // '/chart' must not pull '/chat' along with it, nor vice versa
    expect(requiredPlanFor('/chatter')).toBe('starter')
  })

  it('ignores query strings, hashes and trailing slashes', () => {
    expect(requiredPlanFor('/api-keys/')).toBe('enterprise')
    expect(requiredPlanFor('/dashboard?range=30d')).toBe('professional')
    expect(requiredPlanFor('/reports#top')).toBe('professional')
  })
})

describe('canAccessPath', () => {
  it('matches the pricing page promises', () => {
    expect(canAccessPath('starter', '/maps')).toBe(true)
    expect(canAccessPath('starter', '/chat')).toBe(false)
    expect(canAccessPath('starter', '/dashboard')).toBe(false)
    expect(canAccessPath('professional', '/chat')).toBe(true)
    expect(canAccessPath('professional', '/dashboard')).toBe(true)
    expect(canAccessPath('professional', '/api-keys')).toBe(false)
    expect(canAccessPath('enterprise', '/api-keys')).toBe(true)
  })

  it('leaves Starter with the core CRM in the menu', () => {
    const starter = ALL_ITEMS.filter(i => canAccessPath('starter', i.to)).map(i => i.to)
    for (const to of ['/leads', '/customers', '/pipeline', '/maps', '/calendar', '/todo', '/invoices', '/settings', '/team']) {
      expect(starter).toContain(to)
    }
  })
})

describe('recordCapError', () => {
  it('lets Starter fill up to exactly 500', () => {
    expect(recordCapError('starter', 499, 1)).toBeNull()
    expect(recordCapError('starter', 0, 500)).toBeNull()
  })

  it('refuses the record that would cross the cap', () => {
    expect(recordCapError('starter', 500, 1)).toMatch(/500-record limit/)
  })

  it('says how many still fit when an import is too big', () => {
    expect(recordCapError('starter', 480, 50)).toMatch(/only 20 more/)
  })

  it('never caps Professional or Enterprise', () => {
    expect(recordCapError('professional', 100_000, 5_000)).toBeNull()
    expect(recordCapError('enterprise', 100_000, 5_000)).toBeNull()
  })
})

