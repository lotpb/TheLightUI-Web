/**
 * Follow-up cadences — /followups' reminder templates.
 *
 * Deliberately *not* models/sequence.ts, and deliberately a separate pair of
 * collections from `sequences` / `sequenceEnrollments`. Those drive
 * runSequences, which actually sends texts and emails on a schedule. A cadence
 * here only ever moves a customer's `followUpDate`, so the record surfaces in
 * the queue on the right day and a person decides what to do. Two concepts,
 * told apart by whether they send.
 *
 * What changes is where they live. The cadences and each customer's position in
 * one were held in `localStorage['thelight.sequences']` and
 * `['thelight.seqstate']`, so a cadence one rep built was invisible to the
 * rest, clearing site data destroyed them, and a customer another rep had
 * started through one read as "No sequence".
 */

export type CadenceAction = 'Call' | 'SMS' | 'Email' | 'Visit' | 'Note'

export const CADENCE_ACTIONS: CadenceAction[] = ['Call', 'SMS', 'Email', 'Visit', 'Note']

export interface CadenceStep {
  /** Days after the cadence was assigned. */
  day: number
  action: CadenceAction
  note: string
}

export interface FollowUpCadence {
  id: string
  companyId: string
  name: string
  steps: CadenceStep[]
  createdAt: Date
}

/** Where one customer has got to in one cadence. */
export interface CadencePosition {
  /** The document id is the customer id — one position per customer. */
  customerId: string
  companyId: string
  cadenceId: string
  startDate: Date
  stepIndex: number
  updatedAt: Date
}

// ── Defaults ──────────────────────────────────────────────────────────────────

/**
 * The three cadences the page shipped with, as local constants.
 *
 * Their ids are stable and meaningful ('new-lead', not a random string), which
 * is what lets the migration and the per-company seed both be idempotent: the
 * Firestore document id is derived from them, so running either twice writes
 * the same document rather than a duplicate.
 */
export const DEFAULT_CADENCES: { id: string; name: string; steps: CadenceStep[] }[] = [
  {
    id: 'new-lead',
    name: 'New Lead Nurture',
    steps: [
      { day: 0,  action: 'Call',  note: 'Initial contact — introduce yourself and understand their need' },
      { day: 3,  action: 'SMS',   note: 'Quick follow-up text — did they have any questions?' },
      { day: 7,  action: 'Call',  note: 'Second call — present a quote or solution' },
      { day: 14, action: 'Email', note: 'Follow-up email with any brochures or references' },
      { day: 30, action: 'Call',  note: 'Final check-in — still interested?' },
    ],
  },
  {
    id: 'post-job',
    name: 'Post-Job Follow-up',
    steps: [
      { day: 1,  action: 'Call',  note: 'Thank them for their business — confirm satisfaction' },
      { day: 7,  action: 'SMS',   note: 'Check in — any issues or concerns?' },
      { day: 30, action: 'Call',  note: 'Request a review or referral' },
      { day: 90, action: 'Email', note: 'Seasonal maintenance reminder' },
    ],
  },
  {
    id: 'cold-re-engage',
    name: 'Cold Re-engagement',
    steps: [
      { day: 0,  action: 'Call',  note: 'Re-introduce — check if their needs have changed' },
      { day: 5,  action: 'Email', note: 'Send a special offer or updated pricing' },
      { day: 15, action: 'Call',  note: 'Final outreach attempt' },
    ],
  },
]

/**
 * A company-scoped document id.
 *
 * The seeded cadences share ids across companies, so the id alone can't be the
 * document key without one company's edit landing in another's.
 */
export function cadenceDocId(companyId: string, cadenceId: string): string {
  return `${companyId}__${cadenceId}`
}

// ── Coercion ──────────────────────────────────────────────────────────────────

function isAction(v: unknown): v is CadenceAction {
  return typeof v === 'string' && (CADENCE_ACTIONS as string[]).includes(v)
}

/**
 * One step, from anything Firestore or an old localStorage blob hands back.
 *
 * The legacy value was whatever `JSON.parse` produced, never validated — so a
 * hand-edited or truncated blob could put `undefined` into `step.action` and
 * index ACTION_ICONS with it.
 */
export function coerceStep(raw: unknown): CadenceStep {
  const o = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const day = Number(o['day'])
  return {
    day: Number.isFinite(day) ? Math.max(0, Math.round(day)) : 0,
    action: isAction(o['action']) ? o['action'] : 'Call',
    note: typeof o['note'] === 'string' ? o['note'] : '',
  }
}

export function coerceSteps(raw: unknown): CadenceStep[] {
  return Array.isArray(raw) ? raw.map(coerceStep) : []
}

// ── Scheduling ────────────────────────────────────────────────────────────────

/** Local midnight, which is the granularity a follow-up date has. */
export function startOfDay(d: Date): Date {
  const out = new Date(d)
  out.setHours(0, 0, 0, 0)
  return out
}

export function addDays(base: Date, days: number): Date {
  const out = new Date(base)
  out.setDate(out.getDate() + days)
  out.setHours(0, 0, 0, 0)
  return out
}

/** When a given step of a cadence falls, counted from its start date. */
export function stepDate(start: Date, step: CadenceStep): Date {
  return addDays(startOfDay(start), step.day)
}

export interface CadenceAdvance {
  /** True when there are no steps left. */
  complete: boolean
  /** The next step index, when there is one. */
  nextStepIndex: number | null
  /** The follow-up date to write — null clears it. */
  followUpDate: Date | null
  nextStep: CadenceStep | null
}

/**
 * What completing the current step should do.
 *
 * Kept out of the page because it decides both what gets written to the
 * customer and what the toast says, and those were computed separately from
 * the same three variables.
 */
export function advanceCadence(
  cadence: Pick<FollowUpCadence, 'steps'>,
  position: Pick<CadencePosition, 'startDate' | 'stepIndex'>,
): CadenceAdvance {
  const next = position.stepIndex + 1
  if (next >= cadence.steps.length) {
    return { complete: true, nextStepIndex: null, followUpDate: null, nextStep: null }
  }
  const step = cadence.steps[next]
  return {
    complete: false,
    nextStepIndex: next,
    followUpDate: stepDate(position.startDate, step),
    nextStep: step,
  }
}

/** The date a freshly-assigned cadence should set. */
export function firstStepDate(
  cadence: Pick<FollowUpCadence, 'steps'>, now: Date = new Date(),
): Date | null {
  const first = cadence.steps[0]
  return first ? stepDate(now, first) : null
}

/** A cadence with no steps can't be assigned to anyone. */
export function isAssignable(cadence: Pick<FollowUpCadence, 'steps'>): boolean {
  return cadence.steps.length > 0
}

// ── Migration ─────────────────────────────────────────────────────────────────

export const LEGACY_CADENCE_KEY = 'thelight.sequences'
export const LEGACY_POSITION_KEY = 'thelight.seqstate'

export interface LegacyImport {
  /** Cadences worth keeping: the ones this browser actually customised. */
  cadences: { id: string; name: string; steps: CadenceStep[] }[]
  positions: { customerId: string; cadenceId: string; startDate: Date; stepIndex: number }[]
}

function sameSteps(a: CadenceStep[], b: CadenceStep[]): boolean {
  return a.length === b.length && a.every((s, i) =>
    s.day === b[i].day && s.action === b[i].action && s.note === b[i].note)
}

/**
 * Whether a local cadence is just one of the shipped defaults, untouched.
 *
 * This is what stops the migration turning three built-in templates into three
 * duplicates for every rep who never edited them.
 */
export function isUntouchedDefault(c: { id: string; name: string; steps: CadenceStep[] }): boolean {
  const def = DEFAULT_CADENCES.find(d => d.id === c.id)
  return !!def && def.name === c.name && sameSteps(def.steps, c.steps)
}

/**
 * Reads the two legacy localStorage blobs into something writable.
 *
 * Positions always migrate — a customer's place in a cadence is real work
 * someone did. Cadences migrate only when they differ from the default they
 * were seeded from, or are new.
 */
export function readLegacy(
  getItem: (k: string) => string | null,
): LegacyImport {
  const out: LegacyImport = { cadences: [], positions: [] }

  try {
    const raw = getItem(LEGACY_CADENCE_KEY)
    if (raw) {
      const parsed: unknown = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          const o = (typeof item === 'object' && item !== null ? item : {}) as Record<string, unknown>
          const id = typeof o['id'] === 'string' ? o['id'] : ''
          const name = typeof o['name'] === 'string' ? o['name'] : ''
          if (!id || !name) continue
          const cadence = { id, name, steps: coerceSteps(o['steps']) }
          if (!isUntouchedDefault(cadence)) out.cadences.push(cadence)
        }
      }
    }
  } catch { /* a corrupt blob migrates nothing rather than throwing */ }

  try {
    const raw = getItem(LEGACY_POSITION_KEY)
    if (raw) {
      const parsed: unknown = JSON.parse(raw)
      if (typeof parsed === 'object' && parsed !== null) {
        for (const [customerId, v] of Object.entries(parsed as Record<string, unknown>)) {
          const o = (typeof v === 'object' && v !== null ? v : {}) as Record<string, unknown>
          const cadenceId = typeof o['sequenceId'] === 'string' ? o['sequenceId'] : ''
          if (!customerId || !cadenceId) continue
          const started = new Date(String(o['startDate'] ?? ''))
          const idx = Number(o['stepIndex'])
          out.positions.push({
            customerId,
            cadenceId,
            startDate: isNaN(started.getTime()) ? startOfDay(new Date()) : started,
            stepIndex: Number.isFinite(idx) ? Math.max(0, Math.round(idx)) : 0,
          })
        }
      }
    }
  } catch { /* same */ }

  return out
}
