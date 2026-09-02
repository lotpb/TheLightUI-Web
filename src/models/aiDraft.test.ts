import { describe, it, expect } from 'vitest'
import {
    parseDraft,
    stripCodeFence,
    renderTranscript,
    exceedsSmsLimit,
    DRAFT_THREAD_LIMIT,
    SMS_DRAFT_MAX_CHARS,
    type DraftThreadMessage,
} from './aiDraft'

function msg(
    direction: 'inbound' | 'outbound',
    body: string,
    opts: { subject?: string; minutesAgo?: number } = {},
): DraftThreadMessage {
    return {
        direction,
        body,
        subject: opts.subject,
        createdAt: new Date(Date.now() - (opts.minutesAgo ?? 0) * 60_000),
    }
}

describe('stripCodeFence', () => {
    it('leaves plain text alone', () => {
        expect(stripCodeFence('Hello there')).toBe('Hello there')
    })

    it('strips a bare fence', () => {
        expect(stripCodeFence('```\nHello there\n```')).toBe('Hello there')
    })

    it('strips a language-tagged fence', () => {
        expect(stripCodeFence('```text\nHello there\n```')).toBe('Hello there')
    })

    it('trims surrounding whitespace', () => {
        expect(stripCodeFence('   Hello   ')).toBe('Hello')
    })
})

describe('parseDraft — sms', () => {
    it('returns the whole text as the body with no subject', () => {
        expect(parseDraft('Can you send a photo of the panel?', 'sms')).toEqual({
            subject: '',
            body: 'Can you send a photo of the panel?',
        })
    })

    it('does not treat a Subject: line as a subject for sms', () => {
        const out = parseDraft('Subject: hi\nbody', 'sms')
        expect(out.subject).toBe('')
        expect(out.body).toBe('Subject: hi\nbody')
    })

    it('strips a code fence', () => {
        expect(parseDraft('```\nHi Jane\n```', 'sms').body).toBe('Hi Jane')
    })
})

describe('parseDraft — email', () => {
    it('splits a leading Subject: line off the body', () => {
        expect(parseDraft('Subject: Your roof estimate\n\nHi Jane,\nThanks for reaching out.', 'email')).toEqual({
            subject: 'Your roof estimate',
            body: 'Hi Jane,\nThanks for reaching out.',
        })
    })

    it('is case-insensitive about the Subject label', () => {
        expect(parseDraft('SUBJECT: Follow up\n\nHello', 'email').subject).toBe('Follow up')
    })

    it('tolerates no space after the colon', () => {
        expect(parseDraft('Subject:Follow up\n\nHello', 'email').subject).toBe('Follow up')
    })

    it('falls back to an empty subject when the model omits one', () => {
        const out = parseDraft('Hi Jane,\nThanks for reaching out.', 'email')
        expect(out.subject).toBe('')
        expect(out.body).toBe('Hi Jane,\nThanks for reaching out.')
    })

    it('keeps the full text as the body when Subject: has nothing after it', () => {
        // Otherwise a stray "Subject:" line would yield an empty email.
        const out = parseDraft('Subject:', 'email')
        expect(out.subject).toBe('')
        expect(out.body).toBe('Subject:')
    })

    it('only treats Subject: as a header on the first line', () => {
        const out = parseDraft('Hi Jane\nSubject: not a header', 'email')
        expect(out.subject).toBe('')
        expect(out.body).toBe('Hi Jane\nSubject: not a header')
    })
})

describe('renderTranscript', () => {
    it('labels inbound as Customer and outbound as Us', () => {
        expect(renderTranscript([
            msg('inbound', 'Is next Tuesday open?'),
            msg('outbound', 'Yes, morning works.'),
        ])).toBe('Customer: Is next Tuesday open?\nUs: Yes, morning works.')
    })

    it('preserves chronological order', () => {
        const out = renderTranscript([
            msg('inbound', 'first'),
            msg('outbound', 'second'),
            msg('inbound', 'third'),
        ])
        expect(out.indexOf('first')).toBeLessThan(out.indexOf('second'))
        expect(out.indexOf('second')).toBeLessThan(out.indexOf('third'))
    })

    it('keeps only the most recent messages but stays in order', () => {
        const many = Array.from({ length: DRAFT_THREAD_LIMIT + 5 }, (_, i) =>
            msg('inbound', `message-${i}`))
        const out = renderTranscript(many)
        const lines = out.split('\n')
        expect(lines).toHaveLength(DRAFT_THREAD_LIMIT)
        expect(lines[0]).toContain('message-5')
        expect(lines[lines.length - 1]).toContain(`message-${DRAFT_THREAD_LIMIT + 4}`)
    })

    it('includes an email subject inline', () => {
        expect(renderTranscript([msg('inbound', 'See attached', { subject: 'Quote question' })]))
            .toBe('Customer: [Quote question] See attached')
    })

    it('drops turns with an empty body', () => {
        expect(renderTranscript([
            msg('inbound', '   '),
            msg('outbound', 'Real content here'),
        ])).toBe('Us: Real content here')
    })

    it('returns a placeholder for an empty thread', () => {
        expect(renderTranscript([])).toBe('(no previous messages)')
    })

    it('survives a non-array', () => {
        expect(renderTranscript(undefined as unknown as DraftThreadMessage[])).toBe('(no previous messages)')
    })
})

describe('exceedsSmsLimit', () => {
    it('passes a short message', () => {
        expect(exceedsSmsLimit('Short and sweet')).toBe(false)
    })

    it('flags an over-long message', () => {
        expect(exceedsSmsLimit('x'.repeat(SMS_DRAFT_MAX_CHARS + 1))).toBe(true)
    })

    it('treats exactly the limit as acceptable', () => {
        expect(exceedsSmsLimit('x'.repeat(SMS_DRAFT_MAX_CHARS))).toBe(false)
    })
})
