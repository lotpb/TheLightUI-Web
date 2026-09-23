import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import {
  CADENCE_ACTIONS, DEFAULT_CADENCES, LEGACY_CADENCE_KEY, LEGACY_POSITION_KEY,
  addDays, advanceCadence, cadenceDocId, coerceStep, coerceSteps, firstStepDate,
  isAssignable, isUntouchedDefault, readLegacy, startOfDay, stepDate,
  type CadenceStep,
} from './followUpCadence'

const at = (y: number, m: number, d: number, h = 9) => new Date(y, m - 1, d, h)
const step = (over: Partial<CadenceStep> = {}): CadenceStep =>
  ({ day: 0, action: 'Call', note: '', ...over })

// ── Identity ──────────────────────────────────────────────────────────────────

/**
 * The three seeded cadences share stable ids across every company, so the id
 * alone can't be the Firestore document key without one company's edit landing
 * in another's.
 */
describe('cadenceDocId', () => {
  it('scopes a shared id to a company', () => {
    expect(cadenceDocId('co-1', 'new-lead')).toBe('co-1__new-lead')
    expect(cadenceDocId('co-2', 'new-lead')).not.toBe(cadenceDocId('co-1', 'new-lead'))
  })

  it('is stable, so seeding twice writes the same document', () => {
    expect(cadenceDocId('co-1', 'new-lead')).toBe(cadenceDocId('co-1', 'new-lead'))
  })
})

describe('DEFAULT_CADENCES', () => {
  it('has meaningful stable ids, not random ones', () => {
    expect(DEFAULT_CADENCES.map(c => c.id)).toEqual(['new-lead', 'post-job', 'cold-re-engage'])
  })

  it('is assignable — every one has steps', () => {
    for (const c of DEFAULT_CADENCES) expect(isAssignable(c)).toBe(true)
  })

  it('uses only known actions', () => {
    for (const c of DEFAULT_CADENCES) {
      for (const s of c.steps) expect(CADENCE_ACTIONS).toContain(s.action)
    }
  })

  it('orders steps by day, so advancing always moves forward', () => {
    for (const c of DEFAULT_CADENCES) {
      const days = c.steps.map(s => s.day)
      expect(days).toEqual([...days].sort((a, b) => a - b))
    }
  })
})

// ── Coercion ──────────────────────────────────────────────────────────────────

/**
 * The legacy value was whatever JSON.parse produced, never validated — so a
 * hand-edited or truncated blob could put undefined into step.action and index
 * ACTION_ICONS with it.
 */
describe('coerceStep', () => {
  it('keeps a valid step', () => {
    expect(coerceStep({ day: 3, action: 'SMS', note: 'hi' })).toEqual({ day: 3, action: 'SMS', note: 'hi' })
  })

  it('falls back to Call for an unknown action rather than undefined', () => {
    expect(coerceStep({ day: 0, action: 'Telegram', note: '' }).action).toBe('Call')
    expect(coerceStep({}).action).toBe('Call')
  })

  it('never yields a negative or fractional day', () => {
    expect(coerceStep({ day: -5 }).day).toBe(0)
    expect(coerceStep({ day: 2.6 }).day).toBe(3)
    expect(coerceStep({ day: 'nonsense' }).day).toBe(0)
  })

  it('survives a non-object', () => {
    expect(() => coerceStep(null)).not.toThrow()
    expect(() => coerceStep('x')).not.toThrow()
    expect(coerceSteps('not an array')).toEqual([])
  })
})

// ── Scheduling ────────────────────────────────────────────────────────────────

describe('stepDate', () => {
  it('counts days from the start, at local midnight', () => {
    const d = stepDate(at(2026, 9, 1, 15), step({ day: 3 }))
    expect(d).toEqual(new Date(2026, 8, 4, 0, 0, 0, 0))
  })

  it('treats day 0 as the start date itself', () => {
    expect(stepDate(at(2026, 9, 1, 15), step({ day: 0 }))).toEqual(new Date(2026, 8, 1))
  })

  it('crosses a month boundary', () => {
    expect(stepDate(at(2026, 9, 28), step({ day: 7 }))).toEqual(new Date(2026, 9, 5))
  })

  it('survives a spring-forward, because it adds calendar days', () => {
    // US DST begins 2026-03-08; adding 1 day must land on the 8th, not 7th 23:00.
    expect(addDays(at(2026, 3, 7), 1)).toEqual(new Date(2026, 2, 8))
  })

  it('startOfDay does not mutate its argument', () => {
    const src = at(2026, 9, 1, 15)
    startOfDay(src)
    expect(src.getHours()).toBe(15)
  })
})

/**
 * advanceCadence decides both what gets written to the customer and what the
 * toast says. The page computed those separately from the same three values.
 */
describe('advanceCadence', () => {
  const cadence = { steps: [step({ day: 0 }), step({ day: 3, action: 'SMS' as const }), step({ day: 7 })] }

  it('moves to the next step and gives its date', () => {
    const r = advanceCadence(cadence, { startDate: at(2026, 9, 1), stepIndex: 0 })
    expect(r.complete).toBe(false)
    expect(r.nextStepIndex).toBe(1)
    expect(r.nextStep?.action).toBe('SMS')
    expect(r.followUpDate).toEqual(new Date(2026, 8, 4))
  })

  it('dates every step from the original start, not from today', () => {
    // Completing step 1 late must still schedule step 2 for start+7, otherwise
    // a cadence stretches every time someone is slow to action it.
    const r = advanceCadence(cadence, { startDate: at(2026, 9, 1), stepIndex: 1 })
    expect(r.followUpDate).toEqual(new Date(2026, 8, 8))
  })

  it('completes on the last step and clears the follow-up date', () => {
    const r = advanceCadence(cadence, { startDate: at(2026, 9, 1), stepIndex: 2 })
    expect(r.complete).toBe(true)
    expect(r.followUpDate).toBeNull()
    expect(r.nextStepIndex).toBeNull()
  })

  it('completes rather than throwing when the index is past the end', () => {
    const r = advanceCadence(cadence, { startDate: at(2026, 9, 1), stepIndex: 99 })
    expect(r.complete).toBe(true)
  })

  it('completes immediately for a cadence with no steps', () => {
    expect(advanceCadence({ steps: [] }, { startDate: at(2026, 9, 1), stepIndex: 0 }).complete).toBe(true)
  })
})

describe('firstStepDate', () => {
  it('is the first step, relative to now', () => {
    expect(firstStepDate({ steps: [step({ day: 2 })] }, at(2026, 9, 1, 18))).toEqual(new Date(2026, 8, 3))
  })

  it('is null for an empty cadence, which is also not assignable', () => {
    expect(firstStepDate({ steps: [] })).toBeNull()
    expect(isAssignable({ steps: [] })).toBe(false)
  })
})

// ── Migration ─────────────────────────────────────────────────────────────────

/**
 * The migration runs on every page load, because the data is in localStorage
 * and only a browser holding it can move it. So it has to be idempotent, and
 * it must not turn three built-in templates into three duplicates for every
 * rep who never edited them.
 */
describe('isUntouchedDefault', () => {
  it('recognises a shipped cadence nobody edited', () => {
    expect(isUntouchedDefault(DEFAULT_CADENCES[0])).toBe(true)
  })

  it('does not match one whose name changed', () => {
    expect(isUntouchedDefault({ ...DEFAULT_CADENCES[0], name: 'My Nurture' })).toBe(false)
  })

  it('does not match one whose steps changed', () => {
    const edited = { ...DEFAULT_CADENCES[0], steps: DEFAULT_CADENCES[0].steps.slice(0, 2) }
    expect(isUntouchedDefault(edited)).toBe(false)
  })

  it('does not match one whose step note changed', () => {
    const steps = DEFAULT_CADENCES[0].steps.map((s, i) => i === 0 ? { ...s, note: 'changed' } : s)
    expect(isUntouchedDefault({ ...DEFAULT_CADENCES[0], steps })).toBe(false)
  })

  it('does not match a cadence someone created', () => {
    expect(isUntouchedDefault({ id: 'abc123', name: 'Mine', steps: [step()] })).toBe(false)
  })
})

describe('readLegacy', () => {
  const store = (cadences: unknown, positions: unknown) => (k: string) =>
    k === LEGACY_CADENCE_KEY ? JSON.stringify(cadences)
    : k === LEGACY_POSITION_KEY ? JSON.stringify(positions)
    : null

  it('migrates a customised cadence but not the untouched defaults', () => {
    const mine = { id: 'abc', name: 'Mine', steps: [{ day: 1, action: 'SMS', note: 'x' }] }
    const r = readLegacy(store([...DEFAULT_CADENCES, mine], {}))
    expect(r.cadences.map(c => c.id)).toEqual(['abc'])
  })

  it('migrates an edited default', () => {
    const edited = { ...DEFAULT_CADENCES[0], name: 'Renamed' }
    const r = readLegacy(store([edited], {}))
    expect(r.cadences.map(c => c.id)).toEqual(['new-lead'])
    expect(r.cadences[0].name).toBe('Renamed')
  })

  it('always migrates positions — that is real work someone did', () => {
    const r = readLegacy(store(DEFAULT_CADENCES, {
      'cust-1': { sequenceId: 'new-lead', startDate: '2026-09-01T00:00:00.000Z', stepIndex: 2 },
    }))
    expect(r.cadences).toEqual([])
    expect(r.positions).toHaveLength(1)
    expect(r.positions[0]).toMatchObject({ customerId: 'cust-1', cadenceId: 'new-lead', stepIndex: 2 })
  })

  it('skips a position with no cadence id rather than writing a dangling one', () => {
    const r = readLegacy(store([], { 'cust-1': { startDate: '2026-09-01', stepIndex: 0 } }))
    expect(r.positions).toEqual([])
  })

  it('falls back to today for an unreadable start date', () => {
    const r = readLegacy(store([], { 'c': { sequenceId: 'new-lead', startDate: 'nope', stepIndex: 0 } }))
    expect(isNaN(r.positions[0].startDate.getTime())).toBe(false)
  })

  it('migrates nothing from a corrupt blob rather than throwing', () => {
    const bad = (k: string) => k === LEGACY_CADENCE_KEY ? '{not json' : '{also not'
    expect(() => readLegacy(bad)).not.toThrow()
    expect(readLegacy(bad)).toEqual({ cadences: [], positions: [] })
  })

  it('migrates nothing when there is nothing stored', () => {
    expect(readLegacy(() => null)).toEqual({ cadences: [], positions: [] })
  })

  it('skips a cadence with no id or name', () => {
    const r = readLegacy(store([{ name: 'no id' }, { id: 'no-name' }], {}))
    expect(r.cadences).toEqual([])
  })
})

// ── Wiring ────────────────────────────────────────────────────────────────────

describe('the page and the service', () => {
  const strip = (f: string) => readFileSync(f, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n')

  const page = strip('src/pages/followups/FollowUpsPage.tsx')
  const service = readFileSync('src/services/followUpCadenceService.ts', 'utf8')
  const rules = readFileSync('firestore.rules', 'utf8')

  it('the page no longer touches localStorage', () => {
    expect(page).not.toContain('localStorage')
    expect(page).not.toContain('thelight.sequences')
    expect(page).not.toContain('thelight.seqstate')
  })

  it('the page reads both collections live', () => {
    expect(page).toContain('subscribeToCadences')
    expect(page).toContain('subscribeToCadencePositions')
  })

  it('cadences are kept apart from the engine that sends', () => {
    expect(service).toContain("'followUpCadences'")
    expect(service).toContain("'followUpCadencePositions'")
    // Not the sender's collections.
    expect(service).not.toContain("'sequenceEnrollments'")
    expect(service).not.toMatch(/collection\(db, 'sequences'\)/)
  })

  it('the page still only schedules — it never enrols into the sender', () => {
    expect(page).not.toContain('enrollCustomer')
    expect(page).not.toContain('sequenceService')
    expect(page).toContain('setFollowUpDate')
  })

  it('both collections are company-scoped in the rules', () => {
    for (const c of ['followUpCadences', 'followUpCadencePositions']) {
      const i = rules.indexOf(`match /${c}/`)
      expect(i, `${c} has no rule`).toBeGreaterThan(-1)
      const block = rules.slice(i, rules.indexOf('}', rules.indexOf('allow delete', i)))
      expect(block).toContain('claimedCompanyId()')
      expect(block).toContain('!isViewer()')
    }
  })

  it('deleting a cadence asks first, now that it affects everyone', () => {
    expect(page).toContain('confirmDeleteSeq')
    expect(page).toContain('for everyone at your company')
  })

  it('the banner no longer claims the data is browser-local', () => {
    expect(page).not.toContain('saved in this browser only')
    expect(page).toContain('shared with your team')
    expect(page).toContain('nothing is sent automatically')
  })

  it('the migration removes the legacy keys only after the write commits', () => {
    // `storage.removeItem`, not `removeItem` — the bare name also appears in
    // the Pick<Storage, …> annotation on the signature, which is earlier in the
    // file and made this assertion fail against correct code.
    const commit = service.indexOf('batch.commit()')
    const remove = service.indexOf('storage.removeItem')
    expect(commit).toBeGreaterThan(-1)
    expect(remove).toBeGreaterThan(commit)
  })

  it('seeds only when the company has none, so a deleted default stays deleted', () => {
    expect(service).toContain('existing.empty')
  })
})
