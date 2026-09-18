import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import {
  actorOf, dayLabel, displayValue, fieldLabel, fmtAuditTime, groupByDay,
  isAuditEntityType, isTruncated, matchesAuditQuery, recordPath, searchAuditEntries,
  ACTION_COLORS, ACTION_LABELS, AUDIT_FILTERS, TRUNCATION_MARKER, UNKNOWN_ACTOR,
  type AuditLogEntry, type AuditEntityType,
} from './auditLog'

const at = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m - 1, d, h, min)

function entry(over: Partial<AuditLogEntry> = {}): AuditLogEntry {
  return {
    id: 'e1', companyId: 'co1',
    entityType: 'customer', entityId: 'c1', entityLabel: 'Jane Doe',
    action: 'updated', changedBy: 'Ann Admin',
    changes: [{ field: 'phone', from: '555-0100', to: '555-0200' }],
    createdAt: at(2026, 9, 18, 10, 30),
    ...over,
  }
}

/**
 * The page's version was two ifs and then a bare
 * `return \`/invoices/${entityId}\``, so any unrecognised entity type produced
 * a confident link to an invoice that doesn't exist.
 */
describe('recordPath', () => {
  it('routes each known type to its own page', () => {
    expect(recordPath(entry({ entityType: 'customer', entityId: 'c9' }))).toBe('/records/c9')
    expect(recordPath(entry({ entityType: 'invoice', entityId: 'i9' }))).toBe('/invoices/i9')
    expect(recordPath(entry({ entityType: 'proposal', entityId: 'p9' }))).toBe('/proposals/p9')
  })

  it('gives a deleted record nowhere to go', () => {
    expect(recordPath(entry({ action: 'deleted' }))).toBeNull()
  })

  it('refuses to guess for an unknown entity type', () => {
    const rogue = entry({ entityType: 'servicePlan' as unknown as AuditEntityType })
    expect(recordPath(rogue)).toBeNull()
  })

  it('refuses to link without an id', () => {
    expect(recordPath(entry({ entityId: '' }))).toBeNull()
  })

  it('validates entity types', () => {
    expect(isAuditEntityType('customer')).toBe(true)
    expect(isAuditEntityType('servicePlan')).toBe(false)
    expect(isAuditEntityType(null)).toBe(false)
  })
})

/**
 * The trigger reads lastEditedByName off the document, so a write path that
 * doesn't set it lands here as the literal string "Unknown" — which the page
 * rendered as though it were a person's name.
 */
describe('actorOf', () => {
  it('names a person', () => {
    expect(actorOf('Ann Admin')).toEqual({ label: 'Ann Admin', unattributed: false, automated: false })
  })

  it('distinguishes "nobody recorded this" from a name', () => {
    for (const raw of [UNKNOWN_ACTOR, '', '   ']) {
      const a = actorOf(raw)
      expect(a.unattributed).toBe(true)
      expect(a.label).toBe('Not recorded')
      expect(a.label).not.toBe('Unknown')
    }
  })

  it('marks an automation as automated, not as a person', () => {
    const a = actorOf('Automation: Welcome email')
    expect(a.automated).toBe(true)
    expect(a.unattributed).toBe(false)
    expect(a.label).toBe('Automation: Welcome email')
  })

  it('treats a sequence the same way, since it stamps the same prefix', () => {
    // runSequences now writes `Sequence: {name}`; runAutomationsFor writes
    // `Automation: {rule}`. Only the latter is flagged as automated here.
    expect(actorOf('Sequence: Onboarding').automated).toBe(false)
    expect(actorOf('Sequence: Onboarding').unattributed).toBe(false)
  })
})

/**
 * Values were sliced to 80/120 characters with no marker, so a Line Items diff
 * rendered as a JSON fragment that stopped mid-structure and read as whole.
 */
describe('truncation', () => {
  it('detects the marker the trigger appends', () => {
    expect(isTruncated(`{"a":1${TRUNCATION_MARKER}`)).toBe(true)
    expect(isTruncated('{"a":1}')).toBe(false)
  })

  it('is the same marker the server writes', () => {
    const src = readFileSync('functions/src/audit.ts', 'utf8')
    expect(src).toContain('TRUNCATION_MARKER')
    // … is the escape the server uses for the same character.
    expect(src).toContain('\\u2026')
    expect(TRUNCATION_MARKER).toBe('…')
  })

  it('the server clips rather than slicing unconditionally', () => {
    const src = readFileSync('functions/src/audit.ts', 'utf8')
    expect(src).toContain('clip(JSON.stringify(v), 80)')
    expect(src).toContain('clip(String(v), 120)')
    expect(src).not.toContain('.slice(0, 80)')
    expect(src).not.toContain('.slice(0, 120)')
  })

  it('says when a value is empty rather than rendering nothing', () => {
    expect(displayValue('')).toBe('(empty)')
    expect(displayValue('   ')).toBe('(empty)')
    expect(displayValue('actual')).toBe('actual')
  })
})

describe('fieldLabel', () => {
  it('uses the friendly name where there is one', () => {
    expect(fieldLabel('lastname')).toBe('Last Name')
    expect(fieldLabel('adNo')).toBe('Ad #')
  })

  it('humanises a camelCase field it has never seen', () => {
    expect(fieldLabel('someNewField')).toBe('Some New Field')
  })
})

/** The only control was a four-way entity toggle. */
describe('search', () => {
  const entries = [
    entry({ id: '1', entityLabel: 'Jane Doe', changedBy: 'Ann Admin' }),
    entry({ id: '2', entityLabel: 'Acme Roofing', changedBy: 'Bob Boss', entityType: 'invoice', action: 'created', changes: [] }),
    entry({ id: '3', entityLabel: 'Zed Ltd', changedBy: UNKNOWN_ACTOR, changes: [{ field: 'leadStatus', from: 'New', to: 'Won' }] }),
  ]
  const ids = (q: string) => searchAuditEntries(entries, q).map(e => e.id)

  it('matches the record name', () => {
    expect(ids('acme')).toEqual(['2'])
  })

  it('matches the person who made the change', () => {
    expect(ids('bob')).toEqual(['2'])
  })

  it('matches the resolved actor label, so "not recorded" is findable', () => {
    expect(ids('not recorded')).toEqual(['3'])
  })

  it('matches the action and the entity type', () => {
    expect(ids('created')).toEqual(['2'])
    expect(ids('invoice')).toEqual(['2'])
  })

  it('matches a changed field label and its values', () => {
    expect(ids('lead status')).toEqual(['3'])
    expect(ids('won')).toEqual(['3'])
  })

  it('returns everything for a blank query', () => {
    expect(searchAuditEntries(entries, '   ')).toHaveLength(3)
  })

  it('matches nothing for an unrelated query', () => {
    expect(ids('zzzz')).toEqual([])
  })

  it('is case-insensitive', () => {
    expect(matchesAuditQuery(entries[0], 'JANE')).toBe(true)
  })
})

/** 200 rows each carried a full absolute datestamp. */
describe('day grouping', () => {
  const now = at(2026, 9, 18, 15)

  it('labels today and yesterday by name', () => {
    expect(dayLabel(at(2026, 9, 18, 9), now)).toBe('Today')
    expect(dayLabel(at(2026, 9, 17, 9), now)).toBe('Yesterday')
  })

  it('dates anything older', () => {
    expect(dayLabel(at(2026, 9, 10), now)).toMatch(/Sep 10/)
  })

  it('includes the year only when it differs', () => {
    expect(dayLabel(at(2026, 1, 5), now)).not.toMatch(/2026/)
    expect(dayLabel(at(2025, 1, 5), now)).toMatch(/2025/)
  })

  it('buckets a newest-first feed into contiguous days', () => {
    const feed = [
      entry({ id: 'a', createdAt: at(2026, 9, 18, 14) }),
      entry({ id: 'b', createdAt: at(2026, 9, 18, 9) }),
      entry({ id: 'c', createdAt: at(2026, 9, 17, 16) }),
    ]
    const groups = groupByDay(feed, now)
    expect(groups.map(g => g.label)).toEqual(['Today', 'Yesterday'])
    expect(groups[0].entries.map(e => e.id)).toEqual(['a', 'b'])
    expect(groups[1].entries.map(e => e.id)).toEqual(['c'])
  })

  it('keeps every entry', () => {
    const feed = Array.from({ length: 7 }, (_, i) =>
      entry({ id: `e${i}`, createdAt: at(2026, 9, 18 - i, 10) }))
    expect(groupByDay(feed, now).reduce((n, g) => n + g.entries.length, 0)).toBe(7)
  })

  it('is empty for an empty feed', () => {
    expect(groupByDay([], now)).toEqual([])
  })

  it('shows time only, since the day is in the heading', () => {
    expect(fmtAuditTime(at(2026, 9, 18, 14, 5))).toMatch(/2:05/)
    expect(fmtAuditTime(at(2026, 9, 18, 14, 5))).not.toMatch(/Sep/)
  })
})

describe('metadata', () => {
  it('has a label and a badge for every action', () => {
    for (const a of ['created', 'updated', 'deleted'] as const) {
      expect(ACTION_LABELS[a]).toBeTruthy()
      expect(ACTION_COLORS[a]).toBeTruthy()
    }
  })

  it('uses only badge combinations index.css covers in light mode', () => {
    const css = readFileSync('src/index.css', 'utf8')
    for (const cls of Object.values(ACTION_COLORS)) {
      const sel = cls.split(' ').map(c => c.replace(/\//g, '\\/')).join('.')
      expect(css, cls).toContain(`.${sel}`)
    }
  })

  it('offers a filter for every entity type, plus all', () => {
    expect(AUDIT_FILTERS.map(f => f.key)).toEqual(['all', 'customer', 'invoice', 'proposal'])
    for (const f of AUDIT_FILTERS) expect(f.label).toBeTruthy()
  })
})

/**
 * The page filtered client-side over a 200-entry company-wide window, so a
 * tab could be empty while that history existed. The narrowing has to happen
 * in the query, which needs a composite index.
 */
describe('entity filtering happens in Firestore', () => {
  const service = readFileSync('src/services/auditLogService.ts', 'utf8')

  it('puts entityType into the query', () => {
    expect(service).toContain("where('entityType', '==', filter)")
  })

  it('pages rather than capping at a fixed ceiling', () => {
    expect(service).toContain('startAfter')
    expect(service).toContain('loadOlderAuditEntries')
  })

  it('has the composite index the filtered query needs', () => {
    const indexes = JSON.parse(readFileSync('firestore.indexes.json', 'utf8'))
    const match = indexes.indexes.find((i: { collectionGroup: string; fields: { fieldPath: string }[] }) =>
      i.collectionGroup === 'auditLog' &&
      i.fields.map(f => f.fieldPath).join(',') === 'companyId,entityType,createdAt')
    expect(match, 'auditLog (companyId, entityType, createdAt) index is missing').toBeTruthy()
  })
})

/**
 * changedBy comes from lastEditedByName on the document, so every write path
 * has to set it or the entry reads "Not recorded".
 */
describe('bulk operations attribute themselves', () => {
  const src = readFileSync('src/services/customerService.ts', 'utf8')

  it.each([
    'bulkDeactivate', 'bulkAssignSalesman', 'bulkSetCategory',
    'bulkSetCallback', 'bulkSetFollowUpDate', 'bulkDelete',
  ])('%s stamps the actor', (fn) => {
    const start = src.indexOf(`export async function ${fn}`)
    expect(start, `${fn} not found`).toBeGreaterThan(-1)
    const body = src.slice(start, src.indexOf('\nexport ', start + 1))
    expect(body, `${fn} does not set lastEditedByName`).toContain('lastEditedByName')
  })

  it('bulkDelete stamps before deleting, in a separate commit', () => {
    // Firestore rejects two writes to the same document in one batch, and the
    // trigger can only read the "before" snapshot.
    const start = src.indexOf('export async function bulkDelete')
    const body = src.slice(start, src.indexOf('\nexport ', start + 1))
    expect(body.indexOf('lastEditedByName')).toBeLessThan(body.indexOf('.delete('))
  })
})
