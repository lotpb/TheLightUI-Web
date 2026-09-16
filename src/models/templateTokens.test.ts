import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import {
  dialectTokens, previewText, smsLength, translateTokens, unknownTokens,
  FIELD_LABELS, PREVIEW_VALUES,
  type MergeField,
} from './templateTokens'
import { PLACEHOLDERS } from './template'
import { CAMPAIGN_MERGE_FIELDS } from './campaign'
import { MERGE_TAGS } from '../utils/mergeTags'

/**
 * The three vocabularies are real and separate. If any of them changes, the
 * translation table has to change with it or a template will deliver literal
 * tokens to a customer.
 */
describe('dialect tables match the systems they describe', () => {
  it('covers every /templates placeholder', () => {
    const tokens = dialectTokens('template').map(t => t.token)
    for (const p of PLACEHOLDERS) expect(tokens).toContain(p.token)
  })

  it('covers every /campaigns merge field', () => {
    const tokens = dialectTokens('campaign').map(t => t.token)
    for (const f of CAMPAIGN_MERGE_FIELDS) expect(tokens).toContain(f.token)
  })

  it('covers every tag the blast server understands', () => {
    // MERGE_TAGS mirrors merge() inside bulkSendEmail.
    const tokens = dialectTokens('blast').map(t => t.token).join(' ')
    for (const tag of MERGE_TAGS) expect(tokens).toContain(`{${tag}}`)
  })

  it('claims no blast tag the server does not implement', () => {
    const src = readFileSync('functions/src/outreach.ts', 'utf8')
    for (const { token } of dialectTokens('blast')) {
      // fullName expands to two real tags rather than being one.
      for (const part of token.match(/\{(\w+)\}/g) ?? []) {
        expect(src.toLowerCase()).toContain(part.toLowerCase())
      }
    }
  })

  it('has a label for every field any dialect uses', () => {
    for (const d of ['template', 'blast', 'campaign', 'record'] as const) {
      for (const { field } of dialectTokens(d)) {
        expect(FIELD_LABELS[field]).toBeTruthy()
        expect(PREVIEW_VALUES[field]).toBeTruthy()
      }
    }
  })
})

describe('translateTokens', () => {
  it('rewrites a template into the blast dialect', () => {
    // The whole point: {{firstName}} would otherwise reach the inbox verbatim.
    const r = translateTokens('Hi {{firstName}}, thanks!', 'template', 'blast')
    expect(r.text).toBe('Hi {first}, thanks!')
    expect(r.unresolved).toEqual([])
    expect(r.unknown).toEqual([])
  })

  it('rewrites a template into the campaign dialect', () => {
    const r = translateTokens('Hi {{firstName}} ({{name}})', 'template', 'campaign')
    expect(r.text).toBe('Hi {{firstName}} ({{fullName}})')
    expect(r.unresolved).toEqual([])
  })

  it('expands full name into both halves for blast, which has no full-name tag', () => {
    const r = translateTokens('Dear {{name}},', 'template', 'blast')
    expect(r.text).toBe('Dear {first} {lastname},')
    expect(r.unresolved).toEqual([])
  })

  it('reports fields the destination cannot express, and leaves them intact', () => {
    // /blast's merge() has no amount or date. Deleting them silently would be
    // worse — the copy would change under the user.
    const r = translateTokens('Quote for {{amount}} on {{date}}', 'template', 'blast')
    expect(r.text).toBe('Quote for {{amount}} on {{date}}')
    expect(r.unresolved).toEqual(['date', 'amount'].sort((a, b) =>
      r.unresolved.indexOf(a as MergeField) - r.unresolved.indexOf(b as MergeField)))
    expect(r.unresolved).toContain('amount')
    expect(r.unresolved).toContain('date')
  })

  it('reports each unresolved field once however many times it appears', () => {
    const r = translateTokens('{{amount}} and {{amount}} again', 'template', 'blast')
    expect(r.unresolved).toEqual(['amount'])
  })

  it('flags a typo as unknown rather than translating it', () => {
    const r = translateTokens('Hi {{firstname}},', 'template', 'blast')
    expect(r.text).toBe('Hi {{firstname}},')
    expect(r.unknown).toEqual(['{{firstname}}'])
  })

  it('leaves a token already in the destination dialect alone', () => {
    // Someone hand-wrote {city} into a template; blast understands it.
    const r = translateTokens('In {city} today', 'template', 'blast')
    expect(r.text).toBe('In {city} today')
    expect(r.unknown).toEqual([])
  })

  it('does not read a double-braced token as a single-braced one', () => {
    const r = translateTokens('{{firstName}}', 'template', 'campaign')
    expect(r.text).toBe('{{firstName}}')
    expect(r.unknown).toEqual([])
  })

  it('respects each dialect\'s own case rules', () => {
    // blast's server does /gi, so {FIRST} is a real tag there…
    expect(translateTokens('Hi {FIRST}', 'blast', 'campaign').text).toBe('Hi {{firstName}}')
    // …while campaign and template match literally, so a case slip is a typo
    // that would reach the customer verbatim.
    expect(translateTokens('Hi {{FIRSTNAME}}', 'template', 'blast').unknown).toEqual(['{{FIRSTNAME}}'])
  })

  it('round-trips template → campaign → template without loss', () => {
    const original = 'Hi {{firstName}}, this is {{name}} at {{email}} / {{phone}}'
    const there = translateTokens(original, 'template', 'campaign')
    const back = translateTokens(there.text, 'campaign', 'template')
    expect(back.text).toBe(original)
  })

  it('handles text with no tokens, and empty text', () => {
    expect(translateTokens('plain words', 'template', 'blast')).toEqual({
      text: 'plain words', unresolved: [], unknown: [],
    })
    expect(translateTokens('', 'template', 'blast').text).toBe('')
  })

  it('translating to the same dialect is a no-op', () => {
    const t = 'Hi {{firstName}}, {{amount}}'
    expect(translateTokens(t, 'template', 'template').text).toBe(t)
  })
})

describe('unknownTokens', () => {
  it('finds a misspelling the dialect cannot resolve', () => {
    expect(unknownTokens('Hi {{firstname}} and {{frstName}}', 'template'))
      .toEqual(['{{firstname}}', '{{frstName}}'])
  })

  it('is empty when every token is valid', () => {
    expect(unknownTokens('Hi {{firstName}}, on {{date}} for {{amount}}', 'template')).toEqual([])
  })

  it('reports each bad token once', () => {
    expect(unknownTokens('{{nope}} {{nope}}', 'template')).toEqual(['{{nope}}'])
  })

  it('flags a foreign-dialect token in a template', () => {
    // {city} is a blast tag; /templates' interpolate() leaves it literal.
    expect(unknownTokens('In {city}', 'template')).toEqual(['{city}'])
  })

  it('is empty for text with no tokens', () => {
    expect(unknownTokens('just words', 'template')).toEqual([])
  })
})

describe('previewText', () => {
  it('fills every placeholder with sample data', () => {
    const out = previewText('Hi {{firstName}}, your {{amount}} quote for {{date}}')
    expect(out).toBe('Hi Jane, your $12,400.00 quote for Fri, Sep 25')
    expect(out).not.toContain('{{')
  })

  it('leaves an unknown token visible so a typo stands out', () => {
    expect(previewText('Hi {{firstname}}')).toBe('Hi {{firstname}}')
  })

  it('replaces every occurrence', () => {
    expect(previewText('{{firstName}} {{firstName}}')).toBe('Jane Jane')
  })

  it('works in the blast dialect too', () => {
    expect(previewText('Hi {first} from {city}', 'blast')).toBe('Hi Jane from Boca Raton')
  })
})

/**
 * 160 characters is one billable segment, and placeholders expand — so a body
 * that looks short in the editor can go out longer. The editor had no count.
 */
describe('smsLength', () => {
  it('counts the filled-in length, not the authored length', () => {
    // "Hi {{firstName}}" is 16 characters; "Hi Jane" is 7.
    expect(smsLength('Hi {{firstName}}').characters).toBe(7)
  })

  it('is one segment up to 160 characters', () => {
    expect(smsLength('x'.repeat(160))).toEqual({ characters: 160, segments: 1 })
  })

  it('splits at 153 per part once concatenated', () => {
    expect(smsLength('x'.repeat(161)).segments).toBe(2)
    expect(smsLength('x'.repeat(306)).segments).toBe(2)
    expect(smsLength('x'.repeat(307)).segments).toBe(3)
  })

  it('is zero segments for an empty body', () => {
    expect(smsLength('')).toEqual({ characters: 0, segments: 0 })
  })

  it('catches a template that looks short and sends long', () => {
    // Not every token expands: {{firstName}} is 13 characters and "Jane" is
    // 4, so name tokens make a body *shorter*. Email (+7), phone (+5) and
    // date (+3) are the ones that grow it — which is exactly why eyeballing
    // the textarea doesn't tell you what will be billed.
    const body = 'Reaching you at {{email}} or {{phone}} about {{date}}. ' + 'x'.repeat(100)
    expect(body.length).toBe(155)          // one segment, by eye
    expect(smsLength(body).characters).toBe(170)
    expect(smsLength(body).segments).toBe(2)
  })

  it('reports fewer characters when the tokens are names', () => {
    // The opposite direction, so the count is trusted in both.
    const body = 'Hi {{firstName}}, it is {{name}}'
    expect(smsLength(body).characters).toBeLessThan(body.length)
  })
})
