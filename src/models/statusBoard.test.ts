import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import {
  BADGE_AMBER, BADGE_BLUE, BADGE_GREEN, BADGE_NEUTRAL, BADGE_RED,
  COLUMN_CLASSES, COLUMN_DROP_CLASSES, INVOICE_COLUMNS, MAX_PER_COL, PROPOSAL_COLUMNS,
  bucketByStatus, canMoveTo, columnClasses, columnValue, fmtBoardDate,
  moveRefusal, moveTargets, searchBoard,
  type InvoiceColumnId,
} from './statusBoard'

const at = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12)

interface Row { id: string; status: InvoiceColumnId; updatedAt: Date; total: number; name: string; num: string }
const row = (over: Partial<Row> = {}): Row => ({
  id: 'r1', status: 'draft', updatedAt: at(2026, 9, 1), total: 100, name: 'Jane Doe', num: 'INV-1', ...over,
})

// ── Column config ─────────────────────────────────────────────────────────────

describe('column config', () => {
  it('marks exactly the computed columns as non-droppable', () => {
    expect(INVOICE_COLUMNS.filter(c => !c.droppable).map(c => c.id)).toEqual(['overdue'])
    expect(PROPOSAL_COLUMNS.filter(c => !c.droppable).map(c => c.id)).toEqual(['expired'])
  })

  it('explains every computed column and no others', () => {
    for (const cols of [INVOICE_COLUMNS, PROPOSAL_COLUMNS]) {
      for (const c of cols) {
        if (c.droppable) expect(c.note, `${c.id} should have no note`).toBeUndefined()
        else expect(c.note, `${c.id} needs a note`).toBeTruthy()
      }
    }
  })

  it('gives every column a unique id and a label', () => {
    for (const cols of [INVOICE_COLUMNS, PROPOSAL_COLUMNS]) {
      expect(new Set(cols.map(c => c.id)).size).toBe(cols.length)
      for (const c of cols) expect(c.label).toBeTruthy()
    }
  })
})

/**
 * The count badges were `text-white` on solid `bg-green-600` / `bg-amber-600`,
 * measuring 3.30:1 and 3.19:1 — and 12px bold doesn't reach the 18.66px the
 * 3:1 large-text exemption needs, so two of five failed AA in both themes.
 *
 * Worth pinning what this was *not*: a light-mode text-white bug. Every
 * saturated background involved is already covered by index.css's
 * text-white-on-solid override list.
 */
describe('badge contrast', () => {
  const css = readFileSync('src/index.css', 'utf8')

  it('uses the tinted-pill family, not a solid fill with white text', () => {
    for (const cols of [INVOICE_COLUMNS, PROPOSAL_COLUMNS]) {
      for (const c of cols) {
        expect(c.badgeClass, `${c.id} badge`).not.toContain('text-white')
        expect(c.badgeClass, `${c.id} badge`).not.toMatch(/bg-\w+-600\b/)
      }
    }
  })

  it('has a light-mode rule for every tinted badge it uses', () => {
    for (const badge of [BADGE_BLUE, BADGE_GREEN, BADGE_RED, BADGE_AMBER]) {
      const [bg, text] = badge.split(' ')
      const selector = `.${bg.replace('/', '\\/')}.${text}`
      expect(css, `${badge} has no light-mode rule`).toContain(selector)
    }
  })

  it('leaves the neutral badge var-backed, needing no override', () => {
    expect(BADGE_NEUTRAL).toBe('bg-gray-700 text-gray-200')
  })

  it('confirms the old solid fills were already covered for text-white', () => {
    // So the reported "badgeClass + text-white light-mode bug" was not the
    // defect — the fills were simply too light for white text in both themes.
    for (const bg of ['bg-blue-600', 'bg-green-600', 'bg-red-600', 'bg-amber-600']) {
      expect(css).toContain(`html.light-mode .${bg}`)
    }
  })
})

// ── Bucketing ─────────────────────────────────────────────────────────────────

describe('bucketByStatus', () => {
  const statusOf = (r: Row) => r.status
  const updatedAtOf = (r: Row) => r.updatedAt

  it('zero-fills every column so an empty stage still renders', () => {
    const b = bucketByStatus<InvoiceColumnId, Row>([], INVOICE_COLUMNS, statusOf, updatedAtOf)
    expect(Object.keys(b).sort()).toEqual(['draft', 'overdue', 'paid', 'sent'])
    for (const col of INVOICE_COLUMNS) expect(b[col.id]).toEqual([])
  })

  it('sorts each column most recently updated first', () => {
    const b = bucketByStatus(
      [
        row({ id: 'old', updatedAt: at(2026, 9, 1) }),
        row({ id: 'new', updatedAt: at(2026, 9, 20) }),
        row({ id: 'mid', updatedAt: at(2026, 9, 10) }),
      ],
      INVOICE_COLUMNS, statusOf, updatedAtOf,
    )
    expect(b.draft.map(r => r.id)).toEqual(['new', 'mid', 'old'])
  })

  it('keeps every item', () => {
    const items = [row({ id: 'a' }), row({ id: 'b', status: 'paid' }), row({ id: 'c', status: 'overdue' })]
    const b = bucketByStatus(items, INVOICE_COLUMNS, statusOf, updatedAtOf)
    expect(Object.values(b).flat()).toHaveLength(3)
  })

  it('drops a status with no column instead of throwing', () => {
    const odd = [row({ id: 'x', status: 'voided' as unknown as InvoiceColumnId })]
    expect(() => bucketByStatus(odd, INVOICE_COLUMNS, statusOf, updatedAtOf)).not.toThrow()
    const b = bucketByStatus(odd, INVOICE_COLUMNS, statusOf, updatedAtOf)
    expect(Object.values(b).flat()).toHaveLength(0)
  })
})

describe('columnValue', () => {
  it('sums the column', () => {
    expect(columnValue([row({ total: 100 }), row({ total: 250 })], r => r.total)).toBe(350)
  })

  it('is zero for an empty column', () => {
    expect(columnValue<Row>([], r => r.total)).toBe(0)
  })
})

// ── The overdue no-op ─────────────────────────────────────────────────────────

/**
 * The bug this model exists to remove.
 *
 * Overdue is computed: it's a 'sent' invoice whose due date has passed. The
 * card's menu filtered its targets on the *displayed column*, so an overdue
 * card was offered "Move to Sent" — and `moveInvoice` then wrote
 * `status: 'sent'`, which the record already was. A tap, a Firestore write,
 * and the card sitting exactly where it started with no error and no
 * explanation. Same on /proposals/pipeline with Expired.
 */
describe('moveTargets keys on the stored status', () => {
  it('does not offer Sent to an overdue invoice, which is stored as sent', () => {
    const labels = moveTargets(INVOICE_COLUMNS, 'sent').map(c => c.id)
    expect(labels).not.toContain('sent')
    expect(labels).toEqual(['draft', 'paid'])
  })

  it('does not offer Sent to an expired proposal', () => {
    const ids = moveTargets(PROPOSAL_COLUMNS, 'sent').map(c => c.id)
    expect(ids).not.toContain('sent')
    expect(ids).toEqual(['draft', 'accepted', 'declined'])
  })

  it('never offers a computed column as a target', () => {
    for (const [cols, statuses] of [
      [INVOICE_COLUMNS, ['draft', 'sent', 'paid']],
      [PROPOSAL_COLUMNS, ['draft', 'sent', 'accepted', 'declined']],
    ] as const) {
      for (const s of statuses) {
        for (const t of moveTargets(cols as never, s as never)) {
          expect(t.droppable, `${t.id} offered from ${s}`).toBe(true)
        }
      }
    }
  })

  it('offers every other real status from a draft', () => {
    expect(moveTargets(INVOICE_COLUMNS, 'draft').map(c => c.id)).toEqual(['sent', 'paid'])
  })

  it('canMoveTo agrees with moveTargets', () => {
    expect(canMoveTo(INVOICE_COLUMNS, 'sent', 'sent')).toBe(false)
    expect(canMoveTo(INVOICE_COLUMNS, 'sent', 'paid')).toBe(true)
    expect(canMoveTo(INVOICE_COLUMNS, 'sent', 'overdue')).toBe(false)
    expect(canMoveTo(INVOICE_COLUMNS, 'draft', 'sent')).toBe(true)
  })
})

describe('moveRefusal explains the one confusing case', () => {
  it('says why an overdue invoice cannot be moved to Sent', () => {
    const why = moveRefusal(INVOICE_COLUMNS, 'sent', 'overdue', 'sent')
    expect(why).toContain('Already sent')
    expect(why).toContain('Overdue')
    expect(why).toContain('date')
  })

  it('says why an expired proposal cannot be moved to Sent', () => {
    expect(moveRefusal(PROPOSAL_COLUMNS, 'sent', 'expired', 'sent')).toContain('Expired')
  })

  it('is silent for a move that is simply allowed', () => {
    expect(moveRefusal(INVOICE_COLUMNS, 'sent', 'overdue', 'paid')).toBeNull()
    expect(moveRefusal(INVOICE_COLUMNS, 'draft', 'draft', 'sent')).toBeNull()
  })

  it('is silent when the card is already in the target for real', () => {
    // status sent, effective sent (not yet due) → nothing to explain.
    expect(moveRefusal(INVOICE_COLUMNS, 'sent', 'sent', 'sent')).toBeNull()
  })

  it('is silent for an unknown target', () => {
    expect(moveRefusal(INVOICE_COLUMNS, 'sent', 'overdue', 'nope' as InvoiceColumnId)).toBeNull()
  })
})

// ── Presentation ──────────────────────────────────────────────────────────────

/**
 * The drop target was `border-white/20 bg-gray-800/80 ring-2 ring-white/10`:
 * 1.74:1 dark and 1.52:1 light for the border, 1.26:1 and 1.08:1 for the
 * surface. `white/20` also resolves through --color-white, which is dark navy
 * in light mode, so the highlight rendered darker than its surroundings.
 */
describe('drop-target styling', () => {
  it('no longer signals the active target with white at low alpha', () => {
    expect(COLUMN_DROP_CLASSES).not.toContain('white/')
    expect(COLUMN_DROP_CLASSES).not.toContain('bg-gray-800/80')
  })

  it('uses indigo, the app active colour, for border and ring', () => {
    expect(COLUMN_DROP_CLASSES).toContain('border-indigo-500')
    expect(COLUMN_DROP_CLASSES).toContain('ring-indigo-500/40')
  })

  it('keeps the two column states the same box, so nothing reflows on hover', () => {
    const box = (s: string) => s.split(' ').filter(c => !c.includes('indigo') && !c.startsWith('bg-') && !c.startsWith('border-') && c !== 'ring-2').sort()
    expect(box(COLUMN_DROP_CLASSES)).toEqual(box(COLUMN_CLASSES))
  })

  it('columnClasses picks between them', () => {
    expect(columnClasses(true)).toBe(COLUMN_DROP_CLASSES)
    expect(columnClasses(false)).toBe(COLUMN_CLASSES)
  })
})

describe('fmtBoardDate', () => {
  it('formats a short date', () => {
    expect(fmtBoardDate(at(2026, 3, 5))).toBe('Mar 5')
  })

  it('does not print "Invalid Date" for a missing or bad date', () => {
    expect(fmtBoardDate(null)).toBe('—')
    expect(fmtBoardDate(undefined)).toBe('—')
    expect(fmtBoardDate(new Date('nope'))).toBe('—')
  })
})

describe('searchBoard', () => {
  const rows = [
    row({ id: 'a', name: 'Acme Roofing', num: 'INV-100' }),
    row({ id: 'b', name: 'Jane Doe', num: 'INV-200' }),
  ]
  const fields = (r: Row) => [r.name, r.num]

  it('matches either field, case-insensitively', () => {
    expect(searchBoard(rows, 'acme', fields).map(r => r.id)).toEqual(['a'])
    expect(searchBoard(rows, 'inv-200', fields).map(r => r.id)).toEqual(['b'])
    expect(searchBoard(rows, 'INV-', fields)).toHaveLength(2)
  })

  it('returns everything for a blank query', () => {
    expect(searchBoard(rows, '   ', fields)).toHaveLength(2)
  })

  it('tolerates a missing field value', () => {
    const odd = [row({ id: 'c', name: undefined as unknown as string, num: 'INV-3' })]
    expect(() => searchBoard(odd, 'inv', fields)).not.toThrow()
    expect(searchBoard(odd, 'inv', fields)).toHaveLength(1)
  })
})

// ── Both pages use it ─────────────────────────────────────────────────────────

describe('both boards are built from the shared model', () => {
  const strip = (s: string) => s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .split('\n').filter(l => !l.trim().startsWith('//')).join('\n')

  const inv = strip(readFileSync('src/pages/invoices/InvoicePipelinePage.tsx', 'utf8'))
  const prop = strip(readFileSync('src/pages/proposals/ProposalPipelinePage.tsx', 'utf8'))

  it('neither declares its own COLUMNS array any more', () => {
    for (const [name, src] of [['invoices', inv], ['proposals', prop]] as const) {
      expect(src, name).not.toContain('const COLUMNS')
      expect(src, name).not.toContain('badgeClass:')
    }
  })

  it('neither hardcodes a viewport-relative column height', () => {
    for (const [name, src] of [['invoices', inv], ['proposals', prop]] as const) {
      expect(src, name).not.toContain('calc(100vh')
    }
  })

  it('neither guards a move on the effective status', () => {
    for (const [name, src] of [['invoices', inv], ['proposals', prop]] as const) {
      expect(src, name).not.toContain('effectiveStatus(card) === target')
      expect(src, name).toContain('canMoveTo')
    }
  })

  it('both use drawn icons rather than text glyphs', () => {
    for (const [name, src] of [['invoices', inv], ['proposals', prop]] as const) {
      expect(src, name).not.toContain('⋯')
      expect(src, name).not.toContain('⚠')
      expect(src, name).toContain('ICONS.ellipsis')
      expect(src, name).toContain('ICONS.warning')
    }
    expect(prop).not.toContain('🧾')
    expect(prop).toContain('ICONS.receipt')
  })

  it('both share one column component', () => {
    for (const [name, src] of [['invoices', inv], ['proposals', prop]] as const) {
      expect(src, name).toContain('StatusBoardColumn')
    }
  })

  it('both show the money in each column, not just a count', () => {
    for (const [name, src] of [['invoices', inv], ['proposals', prop]] as const) {
      expect(src, name).toContain('columnValue')
    }
  })

  it('has no text-gray-500 left on either board', () => {
    // 3.04:1 on the card surface, 3.67:1 on the column surface.
    for (const [name, src] of [['invoices', inv], ['proposals', prop]] as const) {
      expect(src, name).not.toContain('text-gray-500')
      expect(src, name).not.toContain('text-gray-600')
    }
  })

  it('caps both at the shared MAX_PER_COL', () => {
    expect(MAX_PER_COL).toBe(30)
    for (const [name, src] of [['invoices', inv], ['proposals', prop]] as const) {
      expect(src, name).toContain('MAX_PER_COL')
    }
  })
})
