import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import {
  stepsOutOfOrder, duplicateStepDays, sortStepsByDay, lastStepDay,
  enrollmentStatusMeta, usageBySequence, EMPTY_USAGE,
  ACTION_LABELS, STARTER_SEQUENCES,
  type SequenceEnrollment, type SequenceStep,
} from './sequence'

const step = (delayDays: number, over: Partial<SequenceStep> = {}): SequenceStep =>
  ({ delayDays, action: 'note', message: 'x', ...over })

function enrollment(over: Partial<SequenceEnrollment> = {}): SequenceEnrollment {
  return {
    id: 'e1',
    companyId: 'co1',
    sequenceId: 's1',
    sequenceName: 'New Lead Follow-up',
    customerId: 'c1',
    customerName: 'Jane Doe',
    startedAt: new Date(2026, 8, 1),
    status: 'active',
    completedStepIndices: [],
    nextStepIdx: 0,
    nextRunAt: new Date(2026, 8, 2),
    createdAt: new Date(2026, 8, 1),
    ...over,
  }
}

/**
 * delayDays is an absolute offset from enrollment, and the runner executes
 * steps in list order — so a step whose day has already passed fires at the
 * next 9 AM run, collapsing the sequence. The editor allowed it silently.
 */
describe('stepsOutOfOrder', () => {
  it('accepts an ascending sequence', () => {
    expect(stepsOutOfOrder([step(1), step(3), step(7)])).toBe(false)
  })

  it('flags a step whose day is earlier than the one before it', () => {
    expect(stepsOutOfOrder([step(30), step(2)])).toBe(true)
    expect(stepsOutOfOrder([step(1), step(14), step(7)])).toBe(true)
  })

  it('allows two steps on the same day', () => {
    // Both fire on that morning, which is legal and sometimes intended.
    expect(stepsOutOfOrder([step(3), step(3)])).toBe(false)
  })

  it('is false for zero or one step', () => {
    expect(stepsOutOfOrder([])).toBe(false)
    expect(stepsOutOfOrder([step(9)])).toBe(false)
  })

  it('passes every starter sequence', () => {
    for (const ex of STARTER_SEQUENCES) expect(stepsOutOfOrder(ex.steps)).toBe(false)
  })
})

describe('duplicateStepDays', () => {
  it('reports each doubled-up day once, in order', () => {
    expect(duplicateStepDays([step(3), step(3), step(7), step(1), step(7)])).toEqual([3, 7])
  })

  it('is empty when every day is distinct', () => {
    expect(duplicateStepDays([step(1), step(3), step(7)])).toEqual([])
    expect(duplicateStepDays([])).toEqual([])
  })
})

describe('sortStepsByDay', () => {
  it('orders ascending by day', () => {
    expect(sortStepsByDay([step(30), step(2), step(9)]).map(s => s.delayDays)).toEqual([2, 9, 30])
  })

  it('keeps same-day steps in the order they were written', () => {
    const a = step(3, { message: 'first' })
    const b = step(3, { message: 'second' })
    expect(sortStepsByDay([a, b]).map(s => s.message)).toEqual(['first', 'second'])
    // And is stable when the input is already sorted.
    expect(sortStepsByDay([b, a]).map(s => s.message)).toEqual(['second', 'first'])
  })

  it('does not reorder the array it was given', () => {
    const input = [step(30), step(2)]
    sortStepsByDay(input)
    expect(input.map(s => s.delayDays)).toEqual([30, 2])
  })
})

describe('lastStepDay', () => {
  it('is the largest day', () => {
    expect(lastStepDay([step(1), step(14), step(7)])).toBe(14)
  })

  it('is 0 for no steps rather than -Infinity', () => {
    // Math.max(...[]) rendered as "ends day -Infinity".
    expect(lastStepDay([])).toBe(0)
  })
})

describe('enrollmentStatusMeta', () => {
  it('labels every status the model defines', () => {
    for (const s of ['active', 'paused', 'completed', 'cancelled'] as const) {
      expect(enrollmentStatusMeta(s).label).not.toBe('')
      expect(enrollmentStatusMeta(s).classes).not.toBe('')
    }
  })

  it('keeps an unrecognised status visible', () => {
    expect(enrollmentStatusMeta('stalled').label).toBe('stalled')
    expect(enrollmentStatusMeta('').label).toBe('Unknown')
  })
})

describe('usageBySequence', () => {
  const enrollments = [
    enrollment({ id: 'a', sequenceId: 's1', status: 'active' }),
    enrollment({ id: 'b', sequenceId: 's1', status: 'paused' }),
    enrollment({ id: 'c', sequenceId: 's1', status: 'completed' }),
    enrollment({ id: 'd', sequenceId: 's2', status: 'cancelled' }),
  ]

  it('counts each status per sequence', () => {
    const u = usageBySequence(enrollments)
    expect(u['s1']).toEqual({ active: 1, paused: 1, completed: 1, cancelled: 0, live: 2 })
    expect(u['s2']).toEqual({ active: 0, paused: 0, completed: 0, cancelled: 1, live: 0 })
  })

  it('counts paused as live, because deleting the sequence still breaks it', () => {
    // runSequences cancels any enrollment whose template is gone, and a
    // paused enrollment is one someone intends to resume.
    const u = usageBySequence([enrollment({ status: 'paused' })])
    expect(u['s1'].live).toBe(1)
  })

  it('does not count finished or abandoned enrollments as live', () => {
    const u = usageBySequence([
      enrollment({ id: 'x', status: 'completed' }),
      enrollment({ id: 'y', status: 'cancelled' }),
    ])
    expect(u['s1'].live).toBe(0)
  })

  it('omits a sequence nobody is enrolled in, and EMPTY_USAGE covers it', () => {
    expect(usageBySequence([])['s1']).toBeUndefined()
    expect(EMPTY_USAGE).toEqual({ active: 0, paused: 0, completed: 0, cancelled: 0, live: 0 })
  })
})

/**
 * The editor offers exactly the actions the runner implements. An action in
 * the dropdown that runSequences doesn't handle would silently do nothing on
 * the customer's record.
 */
describe('action parity with the runner', () => {
  const src = readFileSync('functions/src/automations.ts', 'utf8')

  it('every offered action is handled by runSequences', () => {
    for (const action of Object.keys(ACTION_LABELS)) {
      expect(src).toContain(`step.action === '${action}'`)
    }
  })

  it('has a label for every action the runner branches on', () => {
    const handled = [...src.matchAll(/step\.action === '(\w+)'/g)].map(m => m[1])
    expect(handled.length).toBeGreaterThan(0)
    for (const a of handled) {
      expect(Object.keys(ACTION_LABELS)).toContain(a)
    }
  })

  it('writes the step message for every action, so no required field is discarded', () => {
    // The followup branch set followUpDate and never read step.message, while
    // the editor made that textarea `required`.
    const followup = src.slice(src.indexOf("step.action === 'followup'"))
    expect(followup.slice(0, 900)).toContain('step.message')
  })
})
