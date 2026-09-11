import { describe, it, expect } from 'vitest'
import { mergeTags, unknownTags, MERGE_TAGS } from './mergeTags'

// These pin the behaviour of merge() in functions/src/outreach.ts. The preview
// is only worth showing if it matches what actually goes out.
const FIELDS = { first: 'Jane', lastname: 'Doe', city: 'Boca Raton', salesman: 'Pete' }

describe('mergeTags', () => {
    it('substitutes every tag the server knows', () => {
        expect(mergeTags('{first} {lastname} of {city}, rep {salesman}', FIELDS))
            .toBe('Jane Doe of Boca Raton, rep Pete')
    })

    it('is case-insensitive, like the server regexes', () => {
        expect(mergeTags('{First} {LASTNAME} {City}', FIELDS)).toBe('Jane Doe Boca Raton')
    })

    it('replaces every occurrence, not just the first', () => {
        expect(mergeTags('{first}, {first}, {first}', FIELDS)).toBe('Jane, Jane, Jane')
    })

    it('substitutes an empty string for a missing field', () => {
        // The server reads `(cust['city'] as string) || ''`, so a blank city
        // leaves a gap — it does not leave the tag visible.
        expect(mergeTags('Hi {first} from {city}!', { first: 'Jane' })).toBe('Hi Jane from !')
    })

    it('leaves unknown tags exactly as typed', () => {
        expect(mergeTags('Hi {firstname}', FIELDS)).toBe('Hi {firstname}')
    })

    it('leaves a template with no tags untouched', () => {
        expect(mergeTags('Plain text', FIELDS)).toBe('Plain text')
    })

    it('handles an empty template', () => {
        expect(mergeTags('', FIELDS)).toBe('')
    })
})

describe('unknownTags', () => {
    it('finds a misspelled tag before it reaches an inbox', () => {
        expect(unknownTags('Hi {firstname}, from {city}')).toEqual(['{firstname}'])
    })

    it('returns nothing when every tag is known', () => {
        expect(unknownTags('{first} {lastname} {city} {salesman}')).toEqual([])
    })

    it('is case-insensitive about what counts as known', () => {
        expect(unknownTags('{FIRST} {Salesman}')).toEqual([])
    })

    it('de-duplicates', () => {
        expect(unknownTags('{nope} and {nope} again')).toEqual(['{nope}'])
    })

    it('ignores braces that are not tag-shaped', () => {
        expect(unknownTags('costs {} or { 5 } or {a-b}')).toEqual([])
    })

    it('covers every advertised tag', () => {
        for (const t of MERGE_TAGS) expect(unknownTags(`{${t}}`)).toEqual([])
    })
})
