import { describe, it, expect } from 'vitest'
import {
    mapFacebookLeadFields,
    splitFullName,
    humanizeFieldName,
    type FacebookFieldDatum,
} from './facebookLead'

function fd(name: string, ...values: string[]): FacebookFieldDatum {
    return { name, values }
}

describe('splitFullName', () => {
    it('splits a simple two-part name', () => {
        expect(splitFullName('Jane Doe')).toEqual({ first: 'Jane', lastname: 'Doe' })
    })

    it('treats the last token as the surname', () => {
        expect(splitFullName('Mary Jo Van Buren')).toEqual({ first: 'Mary Jo Van', lastname: 'Buren' })
    })

    it('leaves lastname empty for a single token', () => {
        expect(splitFullName('Cher')).toEqual({ first: 'Cher', lastname: '' })
    })

    it('collapses irregular whitespace', () => {
        expect(splitFullName('  Jane   Doe  ')).toEqual({ first: 'Jane', lastname: 'Doe' })
    })

    it('handles an empty string', () => {
        expect(splitFullName('')).toEqual({ first: '', lastname: '' })
    })
})

describe('humanizeFieldName', () => {
    it('converts snake_case to a sentence-cased label', () => {
        expect(humanizeFieldName('how_soon')).toBe('How soon')
    })

    it('handles hyphens', () => {
        expect(humanizeFieldName('roof-age')).toBe('Roof age')
    })
})

describe('mapFacebookLeadFields — built-in fields', () => {
    it('maps Meta standard questions onto customer fields', () => {
        const lead = mapFacebookLeadFields([
            fd('full_name', 'Jane Doe'),
            fd('email', 'jane@example.com'),
            fd('phone_number', '+15551234567'),
            fd('street_address', '12 Oak St'),
            fd('city', 'Trenton'),
            fd('state', 'NJ'),
            fd('zip_code', '08608'),
            fd('company_name', 'Doe Roofing'),
        ])

        expect(lead.first).toBe('Jane')
        expect(lead.lastname).toBe('Doe')
        expect(lead.email).toBe('jane@example.com')
        expect(lead.phone).toBe('+15551234567')
        expect(lead.street).toBe('12 Oak St')
        expect(lead.city).toBe('Trenton')
        expect(lead.state).toBe('NJ')
        expect(lead.zip).toBe('08608')
        expect(lead.companyName).toBe('Doe Roofing')
        expect(lead.comments).toBe('')
        expect(lead.customFields).toEqual({})
    })

    it('prefers explicit first_name/last_name over full_name', () => {
        const lead = mapFacebookLeadFields([
            fd('full_name', 'Wrong Name'),
            fd('first_name', 'Jane'),
            fd('last_name', 'Doe'),
        ])
        expect(lead.first).toBe('Jane')
        expect(lead.lastname).toBe('Doe')
    })

    it('falls back to full_name for whichever part is missing', () => {
        const lead = mapFacebookLeadFields([
            fd('full_name', 'Jane Doe'),
            fd('first_name', 'Janet'),
        ])
        expect(lead.first).toBe('Janet')
        expect(lead.lastname).toBe('Doe')
    })

    it('accepts province and post_code as state/zip aliases', () => {
        const lead = mapFacebookLeadFields([fd('province', 'ON'), fd('post_code', 'M5V 2T6')])
        expect(lead.state).toBe('ON')
        expect(lead.zip).toBe('M5V 2T6')
    })

    it('does not let a duplicate alias blank an already-filled field', () => {
        const lead = mapFacebookLeadFields([fd('zip_code', '08608'), fd('post_code', '')])
        expect(lead.zip).toBe('08608')
    })
})

describe('mapFacebookLeadFields — custom questions', () => {
    it('preserves unknown questions in customFields and comments', () => {
        const lead = mapFacebookLeadFields([
            fd('full_name', 'Jane Doe'),
            fd('how_soon', 'Within a week'),
            fd('roof_age', '20 years'),
        ])

        expect(lead.customFields).toEqual({ how_soon: 'Within a week', roof_age: '20 years' })
        expect(lead.comments).toBe('How soon: Within a week\nRoof age: 20 years')
    })

    it('joins multi-select answers with commas', () => {
        const lead = mapFacebookLeadFields([fd('services', 'Roof', 'Gutters', 'Siding')])
        expect(lead.customFields['services']).toBe('Roof, Gutters, Siding')
    })

    it('keys customFields by the original casing, not the lowercased lookup name', () => {
        const lead = mapFacebookLeadFields([fd('How_Soon', 'ASAP')])
        expect(lead.customFields).toEqual({ How_Soon: 'ASAP' })
    })
})

describe('mapFacebookLeadFields — defensive handling', () => {
    it('returns empty defaults for an empty payload', () => {
        const lead = mapFacebookLeadFields([])
        expect(lead.first).toBe('')
        expect(lead.email).toBe('')
        expect(lead.comments).toBe('')
        expect(lead.customFields).toEqual({})
    })

    it('survives a non-array payload', () => {
        // Graph API shape drift shouldn't take the webhook down.
        const lead = mapFacebookLeadFields(undefined as unknown as FacebookFieldDatum[])
        expect(lead.first).toBe('')
    })

    it('skips entries with no name, blank values, or missing values array', () => {
        const lead = mapFacebookLeadFields([
            fd('', 'orphan'),
            fd('email', '   '),
            { name: 'phone_number' } as FacebookFieldDatum,
            fd('city', 'Trenton'),
        ])
        expect(lead.email).toBe('')
        expect(lead.phone).toBe('')
        expect(lead.city).toBe('Trenton')
        expect(lead.customFields).toEqual({})
    })
})
