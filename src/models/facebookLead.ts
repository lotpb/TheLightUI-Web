// Facebook Lead Ads → CRM lead field mapping.
//
// Meta's webhook carries only a leadgen_id; the actual answers come from a
// follow-up Graph API call that returns `field_data: [{ name, values }]`.
// Field names for Meta's built-in questions are stable and documented, but
// advertisers can add arbitrary custom questions — those are preserved in
// customFields and mirrored into comments so nothing submitted is silently
// dropped.
//
// This module is the single source of truth for that mapping and is unit
// tested. Cloud Functions cannot import from src/, so functions/src/index.ts
// keeps a mirrored copy — keep the two in sync when editing.

export interface FacebookFieldDatum {
    name: string
    values: string[]
}

export interface MappedFacebookLead {
    first: string
    lastname: string
    email: string
    phone: string
    street: string
    city: string
    state: string
    zip: string
    companyName: string
    /** Custom question answers, rendered as "Question: answer" lines. */
    comments: string
    /** Every custom question, keyed by its raw Meta field name. */
    customFields: Record<string, string>
}

/** Meta built-in question names → CustomerItem fields. */
const DIRECT_FIELDS: Record<string, keyof MappedFacebookLead> = {
    email:          'email',
    phone_number:   'phone',
    street_address: 'street',
    city:           'city',
    state:          'state',
    province:       'state',
    zip_code:       'zip',
    post_code:      'zip',
    company_name:   'companyName',
}

/** Handled separately because they interact (explicit parts beat full_name). */
const NAME_FIELDS = new Set(['full_name', 'first_name', 'last_name'])

function emptyLead(): MappedFacebookLead {
    return {
        first: '', lastname: '', email: '', phone: '', street: '',
        city: '', state: '', zip: '', companyName: '',
        comments: '', customFields: {},
    }
}

/**
 * Splits a single-field name into first/last. Meta's `full_name` is free text,
 * so the last whitespace-separated token is treated as the surname and
 * everything before it as the given name(s) — "Mary Jo Van Buren" yields
 * first "Mary Jo Van", last "Buren". Imperfect for compound surnames, but it
 * beats dumping the whole string into `first`.
 */
export function splitFullName(full: string): { first: string; lastname: string } {
    const parts = full.trim().split(/\s+/).filter(Boolean)
    if (parts.length === 0) return { first: '', lastname: '' }
    if (parts.length === 1) return { first: parts[0], lastname: '' }
    return { first: parts.slice(0, -1).join(' '), lastname: parts[parts.length - 1] }
}

/** Turns a Meta field name into a human label: "how_soon" → "How soon". */
export function humanizeFieldName(name: string): string {
    const spaced = name.replace(/[_-]+/g, ' ').trim()
    if (!spaced) return name
    return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

export function mapFacebookLeadFields(fieldData: FacebookFieldDatum[]): MappedFacebookLead {
    const lead = emptyLead()
    if (!Array.isArray(fieldData)) return lead

    let fullName = ''
    let explicitFirst = ''
    let explicitLast = ''
    const commentLines: string[] = []

    for (const datum of fieldData) {
        const name = typeof datum?.name === 'string' ? datum.name.trim().toLowerCase() : ''
        if (!name) continue

        const value = Array.isArray(datum.values)
            ? datum.values.map(v => String(v ?? '').trim()).filter(Boolean).join(', ')
            : ''
        if (!value) continue

        if (NAME_FIELDS.has(name)) {
            if (name === 'full_name')  fullName = value
            if (name === 'first_name') explicitFirst = value
            if (name === 'last_name')  explicitLast = value
            continue
        }

        const target = DIRECT_FIELDS[name]
        if (target) {
            // First non-empty value wins, so a duplicated question can't blank
            // an already-populated field (e.g. zip_code then post_code).
            if (!lead[target]) (lead[target] as string) = value
            continue
        }

        lead.customFields[datum.name] = value
        commentLines.push(`${humanizeFieldName(datum.name)}: ${value}`)
    }

    // Explicit first_name/last_name are more reliable than splitting free text.
    const fromFull = splitFullName(fullName)
    lead.first    = explicitFirst || fromFull.first
    lead.lastname = explicitLast  || fromFull.lastname
    lead.comments = commentLines.join('\n')

    return lead
}
