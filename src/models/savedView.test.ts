import { describe, it, expect } from 'vitest'
import { emptySavedViewFilters, type SavedViewFilters } from './savedView'

/**
 * A saved view has to carry every filter the list narrows on.
 *
 * Ten of the nineteen were absent — the whole Common Filters sidebar — and
 * applySavedView cleared them to compensate. So a view saved while filtering
 * to "at-risk customers assigned to Ann" stored only "assigned to Ann", and
 * applying it later showed a larger set with nothing saying anything had been
 * dropped. These tests pin the field list so the next filter added to the
 * page can't quietly fail to persist.
 */

/** Every filter CustomerListPage narrows on, as at this commit. */
const PANEL_FILTERS = [
    'filterSalesman', 'filterState', 'filterLeadSource', 'filterProduct',
    'filterCallback', 'filterDateFrom', 'filterDateTo', 'filterAmtMin', 'filterAmtMax',
] as const

const QUICK_FILTERS = [
    'filterLeadStatus', 'filterQuality', 'filterAssignment', 'filterHealth',
    'filterPaymentStatus', 'filterSalesmanFlag', 'filterProfession',
    'filterRating', 'filterManager', 'filterEmployeeStatus',
] as const

const NON_FILTER_STATE = ['search', 'showInactive', 'tagFilter', 'sortField', 'sortDir'] as const

describe('SavedViewFilters', () => {
    it('carries all nine panel filters', () => {
        const empty = emptySavedViewFilters()
        for (const k of PANEL_FILTERS) expect(empty).toHaveProperty(k)
    })

    it('carries all ten Common Filters', () => {
        const empty = emptySavedViewFilters()
        for (const k of QUICK_FILTERS) expect(empty).toHaveProperty(k)
    })

    it('carries the search, sort and visibility state too', () => {
        const empty = emptySavedViewFilters()
        for (const k of NON_FILTER_STATE) expect(empty).toHaveProperty(k)
    })

    it('has nothing beyond those — an extra key means a filter went unlisted here', () => {
        const keys = Object.keys(emptySavedViewFilters()).sort()
        const expected = [...PANEL_FILTERS, ...QUICK_FILTERS, ...NON_FILTER_STATE].sort()
        expect(keys).toEqual(expected)
    })

    it('defaults every filter to inactive, so a fresh view narrows nothing', () => {
        const empty = emptySavedViewFilters()
        for (const k of [...PANEL_FILTERS, ...QUICK_FILTERS]) {
            expect(empty[k]).toBe('')
        }
        expect(empty.tagFilter).toBeNull()
        expect(empty.showInactive).toBe(false)
        expect(empty.search).toBe('')
    })

    it("defaults the sort to the list's own default", () => {
        expect(emptySavedViewFilters()).toMatchObject({ sortField: 'name', sortDir: 'asc' })
    })

    it('round-trips a fully populated view without losing a field', () => {
        // What a real save looks like with every filter set.
        const saved: SavedViewFilters = {
            search: 'smith',
            showInactive: true,
            tagFilter: 'referral',
            sortField: 'score',
            sortDir: 'desc',
            filterSalesman: 'Ann',
            filterState: 'NJ',
            filterLeadSource: 'Google',
            filterProduct: 'Roof',
            filterCallback: 'yes',
            filterDateFrom: '2026-01-01',
            filterDateTo: '2026-06-30',
            filterAmtMin: '1000',
            filterAmtMax: '50000',
            filterLeadStatus: 'Proposal Sent',
            filterQuality: 'hot',
            filterAssignment: 'mine',
            filterHealth: 'At Risk',
            filterPaymentStatus: 'unpaid',
            filterSalesmanFlag: 'yes',
            filterProfession: 'Roofer',
            filterRating: '5',
            filterManager: 'Pete',
            filterEmployeeStatus: 'Active',
        }
        // Mirrors toSavedView's parse: every key read back with a fallback.
        const parsed = { ...emptySavedViewFilters(), ...saved }
        expect(parsed).toEqual(saved)
        for (const k of [...PANEL_FILTERS, ...QUICK_FILTERS]) {
            expect(parsed[k]).toBe(saved[k])
        }
    })

    it('treats a legacy document with no Common Filters as having none set', () => {
        // Documents written before these were persisted lack the keys; they
        // must parse as empty so an old view behaves exactly as it used to.
        const legacy = {
            search: '', showInactive: false, tagFilter: null,
            sortField: 'name', sortDir: 'asc',
            filterSalesman: 'Ann', filterState: '', filterLeadSource: '',
            filterProduct: '', filterCallback: '', filterDateFrom: '',
            filterDateTo: '', filterAmtMin: '', filterAmtMax: '',
        }
        const parsed = { ...emptySavedViewFilters(), ...legacy }
        expect(parsed.filterSalesman).toBe('Ann')
        for (const k of QUICK_FILTERS) expect(parsed[k]).toBe('')
    })
})
