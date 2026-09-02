import { getFunctions, httpsCallable } from 'firebase/functions'
import type { DraftChannel } from '../models/aiDraft'

export interface DraftReplyResult {
    draft: string
    subject: string
    threadLength: number
}

/**
 * Drafts a suggested reply from the customer's recent thread. Never sends —
 * the caller is responsible for putting the result in front of a human before
 * anything goes out.
 */
export async function draftReply(
    customerId: string,
    channel: DraftChannel,
    instruction?: string,
): Promise<DraftReplyResult> {
    const fn = httpsCallable<
        { customerId: string; channel: DraftChannel; instruction?: string },
        DraftReplyResult
    >(getFunctions(), 'draftReply')
    const result = await fn({ customerId, channel, instruction: instruction?.trim() || undefined })
    return result.data
}
