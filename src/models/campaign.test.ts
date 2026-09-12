import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { transformSync } from 'esbuild'
import {
    interpolateCampaign, matchesSegment, hasSendableEmail,
    CAMPAIGN_MERGE_FIELDS, type CampaignSegment,
} from './campaign'
import { emptyCustomer, type CustomerItem } from './customer'

function customer(over: Partial<CustomerItem> = {}): CustomerItem {
    return { ...emptyCustomer(), id: 'c1', email: 'a@example.com', category: 'Customer', ...over }
}

const SEG = (over: Partial<CampaignSegment> = {}): CampaignSegment =>
    ({ categories: [], salesmen: [], ...over })

describe('hasSendableEmail', () => {
    // `if (!c.email)` passed "n/a" and "none", which the provider then
    // rejected and the page counted as bounced.
    it('requires an @', () => {
        expect(hasSendableEmail({ email: 'a@b.com' })).toBe(true)
        expect(hasSendableEmail({ email: 'n/a' })).toBe(false)
        expect(hasSendableEmail({ email: 'none' })).toBe(false)
        expect(hasSendableEmail({ email: '' })).toBe(false)
        expect(hasSendableEmail({ email: '   ' })).toBe(false)
    })
})

describe('matchesSegment', () => {
    it('excludes contacts with no usable address', () => {
        expect(matchesSegment(customer({ email: 'n/a' }), SEG())).toBe(false)
    })

    it('treats an empty filter as all', () => {
        expect(matchesSegment(customer({ category: 'Vendor' }), SEG())).toBe(true)
    })

    it('filters by category, case-insensitively', () => {
        expect(matchesSegment(customer({ category: 'customer' }), SEG({ categories: ['Customer'] }))).toBe(true)
        expect(matchesSegment(customer({ category: 'Lead' }), SEG({ categories: ['Customer'] }))).toBe(false)
    })

    it('filters by rep', () => {
        expect(matchesSegment(customer({ salesman: 'Ann' }), SEG({ salesmen: ['Ann'] }))).toBe(true)
        expect(matchesSegment(customer({ salesman: 'Bob' }), SEG({ salesmen: ['Ann'] }))).toBe(false)
    })

    it('requires both filters when both are set', () => {
        const seg = SEG({ categories: ['Customer'], salesmen: ['Ann'] })
        expect(matchesSegment(customer({ category: 'Customer', salesman: 'Ann' }), seg)).toBe(true)
        expect(matchesSegment(customer({ category: 'Lead', salesman: 'Ann' }), seg)).toBe(false)
    })
})

describe('interpolateCampaign', () => {
    const c = customer({
        first: 'Jane', lastname: 'Doe', email: 'jane@x.com',
        phone: '555-0100', city: 'Boca Raton', salesman: 'Pete',
    })

    it('substitutes every advertised field', () => {
        for (const f of CAMPAIGN_MERGE_FIELDS) {
            expect(interpolateCampaign(f.token, c)).not.toContain('{{')
        }
    })

    it('replaces every occurrence', () => {
        expect(interpolateCampaign('{{firstName}} {{firstName}}', c)).toBe('Jane Jane')
    })

    it('leaves an unknown token alone', () => {
        expect(interpolateCampaign('Hi {{nickname}}', c)).toBe('Hi {{nickname}}')
    })

    it('substitutes empty for a blank field rather than leaving the token', () => {
        expect(interpolateCampaign('City: {{city}}.', customer({ city: '' }))).toBe('City: .')
    })
})

/**
 * The server does its own substitution, because the send happens there and
 * the recipient row carries denormalised fields rather than a CustomerItem.
 * Two implementations of the same merge language drift silently — and the
 * failure mode is a customer receiving a literal "{{firstName}}" — so this
 * lifts the server's function out of functions/src/campaigns.ts and runs it
 * beside the client's on the same inputs.
 */
describe('server/client merge parity', () => {
    const src = readFileSync('functions/src/campaigns.ts', 'utf8')

    // esbuild strips the types properly. Hand-rolled regexes got the order
    // wrong and mangled `Record<string, unknown>` into `Record<, unknown>`.
    const js = transformSync(src, { loader: 'ts' }).code

    function extract(name: string): string {
        const start = js.indexOf(`function ${name}(`)
        expect(start).toBeGreaterThan(-1)
        let depth = 0
        const open = js.indexOf('{', start)
        for (let i = open; i < js.length; i++) {
            if (js[i] === '{') depth++
            else if (js[i] === '}') { depth--; if (!depth) return js.slice(start, i + 1) }
        }
        throw new Error(`unbalanced braces in ${name}`)
    }

    const serverInterpolate = new Function(
        `${extract('interpolate')}; return interpolate`,
    )() as (t: string, r: Record<string, string>) => string

    const cust = customer({
        first: 'Jane', lastname: 'Doe', email: 'jane@x.com',
        phone: '555-0100', city: 'Boca Raton', salesman: 'Pete',
    })
    /** What queueCampaignRecipients writes onto the row. */
    const row = {
        customerFirst: cust.first,
        customerLast: cust.lastname,
        customerEmail: cust.email,
        customerPhone: cust.phone,
        customerCity: cust.city,
        customerSalesman: cust.salesman,
    }

    const templates = [
        'Hi {{firstName}},',
        '{{fullName}} — {{city}}',
        '{{firstName}} {{lastName}} {{email}} {{phone}} {{city}} {{salesman}}',
        'Repeated {{firstName}} {{firstName}} {{firstName}}',
        'Unknown {{nickname}} stays',
        'No tokens at all',
        '',
    ]

    it('agrees with the client on every advertised token', () => {
        for (const t of templates) {
            expect(serverInterpolate(t, row)).toBe(interpolateCampaign(t, cust))
        }
    })

    it('agrees when a field is blank', () => {
        const blank = { ...row, customerCity: '' }
        expect(serverInterpolate('City: {{city}}.', blank))
            .toBe(interpolateCampaign('City: {{city}}.', customer({ ...cust, city: '' })))
    })

    it('covers every token the UI offers', () => {
        for (const f of CAMPAIGN_MERGE_FIELDS) {
            expect(serverInterpolate(f.token, row)).toBe(interpolateCampaign(f.token, cust))
            expect(serverInterpolate(f.token, row)).not.toContain('{{')
        }
    })
})
