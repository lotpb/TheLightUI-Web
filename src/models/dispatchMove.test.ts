import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { moveIsNoOp } from './dispatchMove'

const weekStart = new Date(2026, 8, 21)            // Mon 21 Sep 2026, local
const visit = { assignedToUid: 'tech1', startAt: new Date(2026, 8, 23, 8) } // Wed, day 2

describe('moveIsNoOp', () => {
  it('same tech, same day is a no-op', () => {
    expect(moveIsNoOp(visit, 'tech1', 2, weekStart)).toBe(true)
  })
  it('another day or another tech is a real move', () => {
    expect(moveIsNoOp(visit, 'tech1', 3, weekStart)).toBe(false)
    expect(moveIsNoOp(visit, 'tech2', 2, weekStart)).toBe(false)
  })
  it('moving to or from Unassigned counts', () => {
    expect(moveIsNoOp(visit, '', 2, weekStart)).toBe(false)
    expect(moveIsNoOp({ ...visit, assignedToUid: '' }, '', 2, weekStart)).toBe(true)
  })
  it('a visit outside the week shown is never a no-op', () => {
    expect(moveIsNoOp({ ...visit, startAt: new Date(2026, 8, 30, 8) }, 'tech1', 2, weekStart)).toBe(false)
  })
})

describe('dispatch board wiring', () => {
  const src = readFileSync('src/pages/dispatch/DispatchBoardPage.tsx', 'utf8')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const fn = (name: string, next: string) => src.slice(src.indexOf(name), src.indexOf(next))

  it('a drop back onto its own cell returns before any write', () => {
    const body = fn('async function handleDropOnCell', 'async function handleMoveExisting')
    expect(body.indexOf('moveIsNoOp(')).toBeGreaterThan(-1)
    expect(body.indexOf('moveIsNoOp(')).toBeLessThan(body.indexOf('await moveAssignment('))
  })

  it('the menu move path guards too, and its dialog disables Move on the current slot', () => {
    expect(fn('async function handleMoveExisting', '/**')).toMatch(/if \(moveIsNoOp\(a, uid, dayIndex, weekStart\)\) return/)
    expect(src).toMatch(/isUnchanged=\{\(uid, dayIndex\) => moveIsNoOp\(movingAssignment, uid, dayIndex, weekStart\)\}/)
    expect(src).toMatch(/disabled=\{unchanged\}/)
  })

  it('an abandoned drag clears its payload', () => {
    expect(src).toMatch(/onDragEnd=\{\(\) => \{ dragRef\.current = null; setDragOverCell\(null\) \}\}/)
  })

  it('the highlight only clears when the pointer leaves the cell itself', () => {
    expect(src).toMatch(/if \(!e\.currentTarget\.contains\(e\.relatedTarget as Node \| null\)\) setDragOverCell\(null\)/)
  })
})
