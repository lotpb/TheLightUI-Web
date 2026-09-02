// Pure helpers for AI-drafted replies.
//
// The model is asked for plain text rather than JSON — a draft has no reason to
// be wrapped in a structure, and `scoreLeads` has already shown how brittle
// JSON.parse on model output is. For email we ask for a leading "Subject:"
// line and split it off here.
//
// Cloud Functions cannot import from src/, so functions/src/index.ts keeps a
// mirrored copy of these functions. Keep the two in sync when editing.

export type DraftChannel = 'sms' | 'email'

/** One turn of a conversation, normalised across SMS and email. */
export interface DraftThreadMessage {
    direction: 'inbound' | 'outbound'
    body: string
    subject?: string
    createdAt: Date
}

export interface ParsedDraft {
    subject: string
    body: string
}

/** Longest thread we send to the model, newest-biased. */
export const DRAFT_THREAD_LIMIT = 20

/**
 * Splits a leading "Subject: ..." line off a drafted email. Falls back to an
 * empty subject and the untouched text when the model omits it, so a missing
 * subject degrades to a blank field rather than swallowing the first line.
 */
export function parseDraft(raw: string, channel: DraftChannel): ParsedDraft {
    const text = stripCodeFence(raw).trim()
    if (channel === 'sms') return { subject: '', body: text }

    const match = /^subject\s*:\s*(.*)$/im.exec(text.split('\n')[0] ?? '')
    if (!match) return { subject: '', body: text }

    const subject = match[1].trim()
    const body = text.split('\n').slice(1).join('\n').trim()
    // A "Subject:" line with nothing after it isn't a usable draft — keep the
    // whole text as the body instead of returning an empty message.
    if (!body) return { subject: '', body: text }
    return { subject, body }
}

/**
 * Models sometimes wrap output in a markdown fence despite being told not to.
 * Strip it rather than pasting ``` into a customer's text message.
 */
export function stripCodeFence(raw: string): string {
    const trimmed = raw.trim()
    if (!trimmed.startsWith('```')) return trimmed
    const withoutOpen = trimmed.replace(/^```[a-zA-Z]*\n?/, '')
    return withoutOpen.replace(/\n?```$/, '')
}

/**
 * Renders a thread as labelled turns for the prompt. Keeps only the most recent
 * DRAFT_THREAD_LIMIT messages but preserves chronological order, so the model
 * reads the conversation forwards.
 */
export function renderTranscript(messages: DraftThreadMessage[]): string {
    if (!Array.isArray(messages)) return '(no previous messages)'

    const nonEmpty = messages.filter(m => (m?.body ?? '').trim().length > 0)
    if (nonEmpty.length === 0) return '(no previous messages)'

    return nonEmpty
        .slice(-DRAFT_THREAD_LIMIT)
        .map(m => {
            const who = m.direction === 'inbound' ? 'Customer' : 'Us'
            const subject = m.subject?.trim()
            const body = m.body.trim()
            return `${who}: ${subject ? `[${subject}] ${body}` : body}`
        })
        .join('\n')
}

/** Hard cap so a drafted text can't silently become a multi-segment SMS. */
export const SMS_DRAFT_MAX_CHARS = 320

export function exceedsSmsLimit(body: string): boolean {
    return body.length > SMS_DRAFT_MAX_CHARS
}
