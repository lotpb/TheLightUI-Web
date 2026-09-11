import { describe, it, expect } from 'vitest'
import { donutArcs, type DonutSlice } from './DonutChart'

const C = 1000   // a round circumference, so the arithmetic reads plainly

function slice(key: string, value: number, tone = 0): DonutSlice {
  return { key, label: key, value, tone }
}

describe('donutArcs', () => {
    it('gives each slice its share of the ring', () => {
        const arcs = donutArcs([slice('a', 1), slice('b', 1), slice('c', 2)], C)
        expect(arcs.map(a => a.len)).toEqual([250, 250, 500])
    })

    it('stacks offsets so slices meet end to end', () => {
        const arcs = donutArcs([slice('a', 1), slice('b', 1), slice('c', 2)], C)
        expect(arcs.map(a => a.offset)).toEqual([0, 250, 500])
    })

    it('closes the ring exactly — no gap, no overlap', () => {
        const arcs = donutArcs([slice('a', 3), slice('b', 5), slice('c', 7), slice('d', 11)], C)
        const last = arcs[arcs.length - 1]
        expect(last.offset + last.len).toBeCloseTo(C, 9)
    })

    it('draws a single slice as the whole ring', () => {
        const arcs = donutArcs([slice('only', 4)], C)
        expect(arcs).toHaveLength(1)
        expect(arcs[0]).toMatchObject({ len: C, offset: 0 })
    })

    it('drops zero-value slices rather than emitting empty arcs', () => {
        const arcs = donutArcs([slice('a', 0), slice('b', 2), slice('c', 0), slice('d', 2)], C)
        expect(arcs.map(a => a.key)).toEqual(['b', 'd'])
        expect(arcs.map(a => a.offset)).toEqual([0, 500])
    })

    it('returns nothing when there is nothing to show, so the track stands alone', () => {
        expect(donutArcs([], C)).toEqual([])
        expect(donutArcs([slice('a', 0), slice('b', 0)], C)).toEqual([])
    })

    it('ignores a negative value rather than winding backwards', () => {
        const arcs = donutArcs([slice('bad', -5), slice('good', 10)], C)
        expect(arcs.map(a => a.key)).toEqual(['good'])
        expect(arcs[0].len).toBe(C)
    })

    it('keeps the slice order it was given, so colours stay put', () => {
        // Fixed order is what makes Overdue always red: the counts move, the
        // tone index doesn't.
        const arcs = donutArcs([slice('overdue', 1, 0), slice('today', 9, 1)], C)
        expect(arcs.map(a => [a.key, a.tone])).toEqual([['overdue', 0], ['today', 1]])
    })

    it('handles a lopsided split without losing the small slice', () => {
        const arcs = donutArcs([slice('tiny', 1), slice('huge', 999)], C)
        expect(arcs[0].len).toBeCloseTo(1, 6)
        expect(arcs[0].len).toBeGreaterThan(0)
        expect(arcs[1].offset).toBeCloseTo(1, 6)
    })

    it('scales to the real circumference the component uses', () => {
        // size 108, thickness 14 → r = 47
        const real = 2 * Math.PI * 47
        const arcs = donutArcs([slice('a', 1), slice('b', 3)], real)
        expect(arcs[0].len).toBeCloseTo(real / 4, 9)
        expect(arcs[1].offset).toBeCloseTo(real / 4, 9)
        expect(arcs[1].offset + arcs[1].len).toBeCloseTo(real, 9)
    })
})
