import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import {
  builtInTabs, clipboardText, composeHref, composeTabs, initialKey,
  pruneOptionalClauses, reconcileSelection, templatesForMode,
  type ComposeVars,
} from './composeTemplates'
import type { MessageTemplate } from './template'

const vars: ComposeVars = {
  firstName: 'Jane',
  name: 'Jane Doe',
  date: 'Wed, Mar 5',
  amount: '$4,200',
  phone: '555-0100',
  email: 'jane@example.com',
}

const noDate: ComposeVars = { ...vars, date: '' }

function tmpl(over: Partial<MessageTemplate> = {}): MessageTemplate {
  return {
    id: 't1', name: 'Spring Promo', type: 'both',
    subject: 'Hi {{firstName}}', body: 'You owe {{amount}}',
    createdAt: new Date(), updatedAt: new Date(),
    ...over,
  }
}

// ── Optional clauses ──────────────────────────────────────────────────────────

/**
 * The built-ins used to be template literals with a ternary per sentence:
 * `your appointment${apptDate ? ` on ${apptDate}` : ''}`. Expressing the same
 * thing as merge-tag source needs a way to say "drop this bit if the tag is
 * empty", or a record with no appointment reads "your appointment on ".
 */
describe('pruneOptionalClauses', () => {
  it('keeps a clause whose tags all have values', () => {
    expect(pruneOptionalClauses('appointment[ on {{date}}]', vars))
      .toBe('appointment on {{date}}')
  })

  it('drops a clause whose tag is empty', () => {
    expect(pruneOptionalClauses('appointment[ on {{date}}]', noDate))
      .toBe('appointment')
  })

  it('drops the clause when any one of several tags is empty', () => {
    expect(pruneOptionalClauses('[{{firstName}} on {{date}}]', noDate)).toBe('')
    expect(pruneOptionalClauses('[{{firstName}} on {{date}}]', vars))
      .toBe('{{firstName}} on {{date}}')
  })

  it('keeps a clause with no tags at all', () => {
    expect(pruneOptionalClauses('hello[ there]', noDate)).toBe('hello there')
  })

  it('decides each clause in a string independently', () => {
    // noDate still carries an amount, so only the first clause goes.
    expect(pruneOptionalClauses('a[ {{date}}] b[ {{amount}}]', noDate))
      .toBe('a b {{amount}}')
    expect(pruneOptionalClauses('a[ {{date}}] b[ {{amount}}]', { ...noDate, amount: '' }))
      .toBe('a b')
  })

  it('leaves text with no clauses alone', () => {
    expect(pruneOptionalClauses('Hi {{firstName}},', vars)).toBe('Hi {{firstName}},')
  })
})

// ── Built-ins ─────────────────────────────────────────────────────────────────

describe('builtInTabs', () => {
  it('resolves merge tags rather than concatenating strings', () => {
    const t = builtInTabs('email', vars).find(x => x.key === 'builtin:follow-up')!
    expect(t.body).toContain('Hi Jane,')
    expect(t.subject).toBe('Following up — Jane Doe')
    expect(t.body).not.toContain('{{')
  })

  it('reads correctly when the record has no appointment date', () => {
    const t = builtInTabs('email', noDate).find(x => x.key === 'builtin:appointment')!
    expect(t.subject).toBe('Your appointment — Jane Doe')
    expect(t.body).toContain('your upcoming appointment.')
    expect(t.body).not.toContain(' on .')
    expect(t.body).not.toContain('[')
  })

  it('includes the date when there is one', () => {
    const t = builtInTabs('email', vars).find(x => x.key === 'builtin:appointment')!
    expect(t.subject).toBe('Your appointment on Wed, Mar 5 — Jane Doe')
    expect(t.body).toContain('on Wed, Mar 5')
  })

  it('gives sms templates no subject', () => {
    for (const t of builtInTabs('sms', vars)) expect(t.subject).toBe('')
  })

  it('leaves the Custom template body empty', () => {
    expect(builtInTabs('sms', vars).find(t => t.key === 'builtin:custom')!.body).toBe('')
  })

  it('never emits a bracket or an unresolved tag', () => {
    for (const mode of ['email', 'sms'] as const) {
      for (const v of [vars, noDate]) {
        for (const t of builtInTabs(mode, v)) {
          expect(t.body + t.subject).not.toMatch(/[[\]]/)
          expect(t.body + t.subject).not.toContain('{{')
        }
      }
    }
  })

  it('keys every tab uniquely and stably', () => {
    const keys = builtInTabs('email', vars).map(t => t.key)
    expect(new Set(keys).size).toBe(keys.length)
    expect(keys).toEqual(builtInTabs('email', noDate).map(t => t.key))
  })
})

// ── Tab list ──────────────────────────────────────────────────────────────────

describe('composeTabs', () => {
  it('puts saved templates first and marks them', () => {
    const tabs = composeTabs('email', [tmpl()], vars)
    expect(tabs[0].key).toBe('saved:t1')
    expect(tabs[0].saved).toBe(true)
    expect(tabs[1].saved).toBe(false)
  })

  it('resolves merge tags in saved templates too', () => {
    const tabs = composeTabs('email', [tmpl()], vars)
    expect(tabs[0].subject).toBe('Hi Jane')
    expect(tabs[0].body).toBe('You owe $4,200')
  })

  it('keys saved tabs by document id, not position', () => {
    const tabs = composeTabs('email', [tmpl({ id: 'a' }), tmpl({ id: 'b' })], vars)
    expect(tabs.map(t => t.key).slice(0, 2)).toEqual(['saved:a', 'saved:b'])
  })

  it('filters templates to the mode', () => {
    const all = [
      tmpl({ id: 'e', type: 'email' }),
      tmpl({ id: 's', type: 'sms' }),
      tmpl({ id: 'b', type: 'both' }),
    ]
    expect(templatesForMode(all, 'email').map(t => t.id)).toEqual(['e', 'b'])
    expect(templatesForMode(all, 'sms').map(t => t.id)).toEqual(['s', 'b'])
  })
})

// ── The draft-wipe ────────────────────────────────────────────────────────────

/**
 * The bug this model exists to remove.
 *
 * The modal tracked an index into `[...saved, ...builtIn]`, and saved templates
 * arrive from Firestore a few hundred milliseconds after it opens. Index 0
 * therefore stopped meaning "Follow-Up" and started meaning "the first saved
 * template", while an effect keyed on the array length re-read the selected tab
 * and overwrote subject and body — destroying anything typed in that window.
 */
describe('reconcileSelection', () => {
  const before = composeTabs('email', [], vars)
  const after  = composeTabs('email', [tmpl()], vars)

  it('keeps pointing at the same template when the list grows', () => {
    const key = initialKey(before)
    expect(key).toBe('builtin:follow-up')
    const out = reconcileSelection(after, { key, dirty: false })
    expect(out.key).toBe('builtin:follow-up')
    expect(out.tab?.label).toBe('Follow-Up')
  })

  it('does NOT overwrite a draft the user has typed', () => {
    const out = reconcileSelection(after, { key: 'builtin:follow-up', dirty: true })
    expect(out.refresh).toBe(false)
  })

  it('refreshes the text when there is nothing to lose', () => {
    const out = reconcileSelection(after, { key: 'builtin:follow-up', dirty: false })
    expect(out.refresh).toBe(true)
    expect(out.tab?.body).toContain('Hi Jane,')
  })

  it('falls back to the first tab when the selected template is deleted', () => {
    const out = reconcileSelection(before, { key: 'saved:gone', dirty: false })
    expect(out.key).toBe('builtin:follow-up')
    expect(out.refresh).toBe(true)
  })

  it('falls back without clobbering a draft', () => {
    const out = reconcileSelection(before, { key: 'saved:gone', dirty: true })
    expect(out.key).toBe('builtin:follow-up')
    expect(out.refresh).toBe(false)
  })

  it('survives an empty tab list', () => {
    const out = reconcileSelection([], { key: 'builtin:follow-up', dirty: false })
    expect(out.tab).toBeNull()
    expect(out.key).toBe('')
    expect(out.refresh).toBe(false)
  })

  it('an index-based selection would have changed meaning; a keyed one does not', () => {
    // The old behaviour, reproduced: same index, different template.
    expect(before[0].label).toBe('Follow-Up')
    expect(after[0].label).toBe('Spring Promo')
    // The new behaviour: same key, same template.
    expect(reconcileSelection(after, { key: before[0].key, dirty: false }).tab?.label)
      .toBe('Follow-Up')
  })
})

// ── Handoff ───────────────────────────────────────────────────────────────────

describe('composeHref', () => {
  it('builds a mailto with subject and body', () => {
    const href = composeHref('email', 'jane@example.com', 'Hi', 'Body text')
    expect(href).toMatch(/^mailto:jane@example\.com\?/)
    expect(href).toContain('subject=Hi')
    expect(href).toContain('body=Body+text')
  })

  it('omits the query entirely when there is nothing to carry', () => {
    expect(composeHref('email', 'jane@example.com', '', '')).toBe('mailto:jane@example.com')
  })

  it('builds an sms href', () => {
    expect(composeHref('sms', '555-0100', '', 'yo')).toBe('sms:555-0100?&body=yo')
    expect(composeHref('sms', '555-0100', '', '')).toBe('sms:555-0100')
  })

  it('encodes a body with newlines and ampersands', () => {
    const href = composeHref('sms', '555', '', 'a & b\nc')
    expect(href).toContain('%26')
    expect(href).toContain('%0A')
  })
})

describe('clipboardText', () => {
  it('prefixes the subject for email', () => {
    expect(clipboardText('email', 'Hi', 'Body')).toBe('Subject: Hi\n\nBody')
  })

  it('is the body alone for sms', () => {
    expect(clipboardText('sms', '', 'Body')).toBe('Body')
  })
})

// ── The page uses it ──────────────────────────────────────────────────────────

describe('CustomerDetailPage wiring', () => {
  const raw = readFileSync('src/pages/customers/CustomerDetailPage.tsx', 'utf8')
  // Comments quote the code being removed, so they have to be stripped before
  // asserting — four assertions in an earlier pass passed on their own
  // explanatory comment.
  const page = raw
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .split('\n').filter(l => !l.trim().startsWith('//')).join('\n')

  it('selects templates by key, not index', () => {
    expect(page).not.toContain('tmplIdx')
    expect(page).toContain('selectedKey')
    expect(page).toContain('reconcileSelection')
  })

  it('has no second copy of the built-in templates', () => {
    expect(page).not.toContain('function buildTemplates')
    expect(page).not.toContain('Best regards,')
  })

  it('no longer writes to the record on mount', () => {
    expect(page).not.toContain('reconciledId')
  })

  it('drops the magic-index activity label', () => {
    expect(page).not.toContain('ACTIVITY_TYPES[4]')
    expect(page).toContain('activityTypeLabel')
  })

  it('has no bg-gray-800 left to sit invisibly on a card', () => {
    expect(page).not.toContain('bg-gray-800')
  })

  it('uses the shared due-date helper for the follow-up verdict', () => {
    expect(page).toContain('dueMetaCompact')
    expect(page).not.toContain("'Jan','Feb'")
    expect(page).not.toContain('toDateString()')
  })

  it('caps the three lists that used to render every row', () => {
    expect(page.match(/max-h-\[420px\] overflow-y-auto/g)?.length).toBeGreaterThanOrEqual(3)
  })

  it('counts both sections in the Activity and Email tabs', () => {
    expect(page).toContain('onCount={setAuditCount}')
    expect(page).toContain('onCount={setCampaignCount}')
    expect(page).toContain('displayCounts')
  })

  it('closes the compose modal on Escape', () => {
    expect(page).toContain("e.key === 'Escape'")
    expect(page).toContain('aria-modal="true"')
  })
})

describe('the inline sidebar writes record their author', () => {
  const service = readFileSync('src/services/customerService.ts', 'utf8')

  it('stamps lastEditedByName on all three', () => {
    for (const fn of ['setCalledFlag', 'setFollowUpDate', 'setContactAttempts']) {
      const start = service.indexOf(`export async function ${fn}`)
      expect(start, `${fn} not found`).toBeGreaterThan(-1)
      const body = service.slice(start, start + 400)
      expect(body, `${fn} does not stamp the actor`).toContain('lastEditedByName')
    }
  })

  it('is what the audit trigger reads for attribution', () => {
    const audit = readFileSync('functions/src/audit.ts', 'utf8')
    expect(audit).toContain('lastEditedByName')
    // And contactAttempts is not ignored, which is why a phantom mount-time
    // write showed up in the record's own history.
    const ignore = audit.slice(audit.indexOf('AUDIT_IGNORE_FIELDS'), audit.indexOf('AUDIT_IGNORE_FIELDS') + 400)
    expect(ignore).not.toContain('contactAttempts')
  })
})
