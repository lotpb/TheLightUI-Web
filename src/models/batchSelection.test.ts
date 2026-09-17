import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import {
  describeBatchFilters, EMPTY_BATCH_FILTERS, filterBatchRecords, filtersActive,
  matchesBatchFilters, rangeIds, selectionScope, type BatchFilters,
} from './batchSelection'
import { CATEGORIES, emptyCustomer, type CustomerItem } from './customer'

function cust(over: Partial<CustomerItem> = {}): CustomerItem {
  return { ...emptyCustomer(), id: 'c1', first: 'Jane', lastname: 'Doe', category: 'Customer', ...over }
}

const F = (over: Partial<BatchFilters> = {}): BatchFilters => ({ ...EMPTY_BATCH_FILTERS, ...over })

describe('matchesBatchFilters', () => {
  it('passes everything with no filters set', () => {
    expect(matchesBatchFilters(cust(), F())).toBe(true)
  })

  it('matches category case-insensitively', () => {
    expect(matchesBatchFilters(cust({ category: 'customer' }), F({ category: 'Customer' }))).toBe(true)
    expect(matchesBatchFilters(cust({ category: 'Lead' }), F({ category: 'Customer' }))).toBe(false)
  })

  it('matches salesman exactly', () => {
    expect(matchesBatchFilters(cust({ salesman: 'Ann' }), F({ salesman: 'Ann' }))).toBe(true)
    expect(matchesBatchFilters(cust({ salesman: 'ann' }), F({ salesman: 'Ann' }))).toBe(false)
  })

  it('splits callback yes/no, treating anything not yes as no', () => {
    expect(matchesBatchFilters(cust({ callback: 'Yes' }), F({ callback: 'yes' }))).toBe(true)
    expect(matchesBatchFilters(cust({ callback: '' }),    F({ callback: 'yes' }))).toBe(false)
    expect(matchesBatchFilters(cust({ callback: '' }),    F({ callback: 'no' }))).toBe(true)
    expect(matchesBatchFilters(cust({ callback: 'No' }),  F({ callback: 'no' }))).toBe(true)
  })

  it('searches name, phone, email, city and ad number', () => {
    const c = cust({ first: 'Ann', lastname: 'Brown', phone: '555-0100', email: 'a@acme.com', city: 'Delray', adNo: 'AD-42' })
    for (const q of ['brown', '555-0100', 'acme', 'delray', 'ad-42']) {
      expect(matchesBatchFilters(c, F({ search: q }))).toBe(true)
    }
    expect(matchesBatchFilters(c, F({ search: 'zzz' }))).toBe(false)
  })

  it('requires every active filter at once', () => {
    const f = F({ category: 'Customer', salesman: 'Ann', callback: 'yes' })
    expect(matchesBatchFilters(cust({ salesman: 'Ann', callback: 'yes' }), f)).toBe(true)
    expect(matchesBatchFilters(cust({ salesman: 'Bob', callback: 'yes' }), f)).toBe(false)
  })
})

describe('filterBatchRecords', () => {
  it('keeps the input order', () => {
    const items = [cust({ id: 'a' }), cust({ id: 'b' }), cust({ id: 'c' })]
    expect(filterBatchRecords(items, F()).map(c => c.id)).toEqual(['a', 'b', 'c'])
  })

  it('does not mutate the input', () => {
    const items = [cust({ id: 'a', category: 'Lead' }), cust({ id: 'b' })]
    filterBatchRecords(items, F({ category: 'Lead' }))
    expect(items).toHaveLength(2)
  })
})

describe('filtersActive and describeBatchFilters', () => {
  it('is false only for a pristine filter set', () => {
    expect(filtersActive(F())).toBe(false)
    expect(filtersActive(F({ search: '  ' }))).toBe(false)
    expect(filtersActive(F({ category: 'Lead' }))).toBe(true)
    expect(filtersActive(F({ search: 'x' }))).toBe(true)
  })

  it('names what is narrowing the view', () => {
    expect(describeBatchFilters(F())).toBe('')
    expect(describeBatchFilters(F({ category: 'Lead', salesman: 'Ann' }))).toBe('Lead · Ann')
    expect(describeBatchFilters(F({ callback: 'yes', search: 'roof' }))).toBe('callback yes · matching “roof”')
  })
})

/**
 * The bug this whole module exists for: every count on the page came from
 * `selected.size` while every action ran on the visible subset.
 */
describe('selectionScope', () => {
  const visible = ['a', 'b', 'c']

  it('reports only the visible ticked rows as in scope', () => {
    const s = selectionScope(new Set(['a', 'c']), visible)
    expect(s.inScope).toEqual(['a', 'c'])
    expect(s.hiddenCount).toBe(0)
    expect(s.totalSelected).toBe(2)
  })

  it('counts ticked rows the filter has hidden', () => {
    const s = selectionScope(new Set(['a', 'x', 'y']), visible)
    expect(s.inScope).toEqual(['a'])
    expect(s.hiddenCount).toBe(2)
    expect(s.totalSelected).toBe(3)
  })

  it('is empty in scope when the filter hides the whole selection', () => {
    // This was the silent no-op: the dialog said 50, the action ran on none.
    const s = selectionScope(new Set(['x', 'y']), visible)
    expect(s.inScope).toEqual([])
    expect(s.hiddenCount).toBe(2)
    expect(s.totalSelected).toBe(2)
  })

  it('returns ids in on-screen order, not selection order', () => {
    // So an exported CSV matches the table the user is looking at.
    expect(selectionScope(new Set(['c', 'a']), visible).inScope).toEqual(['a', 'c'])
  })

  it('is all zeroes for an empty selection', () => {
    expect(selectionScope(new Set(), visible)).toEqual({ inScope: [], hiddenCount: 0, totalSelected: 0 })
  })

  it('never reports a negative hidden count', () => {
    expect(selectionScope(new Set(['a']), ['a', 'a']).hiddenCount).toBeGreaterThanOrEqual(0)
  })
})

describe('rangeIds', () => {
  const visible = ['a', 'b', 'c', 'd', 'e']

  it('includes both ends', () => {
    expect(rangeIds(visible, 'b', 'd')).toEqual(['b', 'c', 'd'])
  })

  it('selects the same range shift-clicking upwards', () => {
    expect(rangeIds(visible, 'd', 'b')).toEqual(['b', 'c', 'd'])
  })

  it('is a single row when anchor and target match', () => {
    expect(rangeIds(visible, 'c', 'c')).toEqual(['c'])
  })

  it('falls back to the clicked row when the anchor has scrolled out of the filter', () => {
    // Otherwise a shift-click after changing filters would look like a no-op.
    expect(rangeIds(visible, 'gone', 'c')).toEqual(['c'])
  })

  it('is empty when the target itself is not in view', () => {
    expect(rangeIds(visible, 'a', 'gone')).toEqual([])
  })
})

/**
 * The page had its own five-entry CATEGORIES array including 'Inactive',
 * which is not a CustomerCategory. bulkSetCategory takes a bare string, so
 * "Change Category → Inactive" wrote a value no category filter in the app
 * matches, quietly removing those records from every category-scoped view —
 * and duplicated the Deactivate action two buttons away.
 */
describe('category source', () => {
  // Comments are stripped first: the page explains the old 'Inactive' bug in
  // prose, and an assertion over raw file text flags that explanation as the
  // defect it documents.
  const src = readFileSync('src/pages/batch/BatchPage.tsx', 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')

  it('does not define a local category list', () => {
    expect(src).not.toMatch(/const CATEGORIES\s*[:=]/)
  })

  it('offers no category outside the canonical four', () => {
    expect(CATEGORIES).toEqual(['Lead', 'Customer', 'Vendor', 'Employee'])
    expect(src).not.toContain('Inactive')
    // The dropdown's options come from the shared export, not a literal list.
    expect(src).toMatch(/CATEGORIES\.map\(/)
  })
})
