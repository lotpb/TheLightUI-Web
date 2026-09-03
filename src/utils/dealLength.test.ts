import { describe, it, expect } from 'vitest'
import { dealAgeDays, dealAgeClasses } from './dealLength'
import { emptyCustomer, type CustomerItem } from '../models/customer'

const DAY = 24 * 60 * 60 * 1000

function lead(createdDaysAgo: number): CustomerItem {
    return { ...emptyCustomer(), creationDate: new Date(Date.now() - createdDaysAgo * DAY) }
}

const WEIGHT_ORDER = ['font-normal', 'font-medium', 'font-semibold']

function weightOf(classes: string): number {
    return WEIGHT_ORDER.findIndex(w => classes.includes(w))
}

describe('dealAgeDays', () => {
    it('counts whole days since creation', () => {
        expect(dealAgeDays(lead(0))).toBe(0)
        expect(dealAgeDays(lead(1))).toBe(1)
        expect(dealAgeDays(lead(45))).toBe(45)
    })

    it('never returns a negative age for a future creation date', () => {
        expect(dealAgeDays(lead(-5))).toBe(0)
    })
})

describe('dealAgeClasses', () => {
    it('escalates hue at the 14 and 30 day thresholds', () => {
        expect(dealAgeClasses(0)).toContain('text-gray-400')
        expect(dealAgeClasses(13)).toContain('text-gray-400')
        expect(dealAgeClasses(14)).toContain('text-amber-400')
        expect(dealAgeClasses(29)).toContain('text-amber-400')
        expect(dealAgeClasses(30)).toContain('text-red-400')
        expect(dealAgeClasses(400)).toContain('text-red-400')
    })

    it('never renders a fresh deal in white, which outshouted stale ones', () => {
        // text-white measured 14.68:1 on the card while red-400 (30d+) was
        // only 5.31:1, so the healthiest lead was the loudest thing in the row.
        for (const days of [0, 1, 7, 13, 14, 30, 100]) {
            expect(dealAgeClasses(days)).not.toContain('text-white')
        }
    })

    it('raises font weight monotonically with age', () => {
        // Hue alone can't carry escalation: amber-400 (8.79:1) always beats
        // red-400 (5.31:1) on contrast, so weight provides the ordered channel.
        const weights = [0, 13, 14, 29, 30, 90].map(d => weightOf(dealAgeClasses(d)))
        expect(weights).toEqual([0, 0, 1, 1, 2, 2])
        expect([...weights].sort((a, b) => a - b)).toEqual(weights)
    })

    it('always specifies exactly one font weight', () => {
        for (const days of [0, 14, 30]) {
            const matches = WEIGHT_ORDER.filter(w => dealAgeClasses(days).includes(w))
            expect(matches).toHaveLength(1)
        }
    })
})
