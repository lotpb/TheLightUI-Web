import { useState } from 'react'
import { useToast } from './Toast'
import { usePermissions } from '../hooks/usePermissions'
import { draftReply } from '../services/aiService'
import type { DraftChannel } from '../models/aiDraft'

interface DraftReplyButtonProps {
    customerId: string
    channel: DraftChannel
    /** Current compose box contents, so a draft doesn't silently clobber a typed reply. */
    currentValue: string
    onDraft: (result: { body: string; subject: string }) => void
    disabled?: boolean
}

// "Ask for photos", "push for a decision" etc. — optional steer for the model,
// kept short since it's appended straight into the prompt.
const INSTRUCTION_MAX_LENGTH = 120

export default function DraftReplyButton({
    customerId, channel, currentValue, onDraft, disabled,
}: DraftReplyButtonProps) {
    const toast = useToast()
    const { canEdit } = usePermissions()
    const [instruction, setInstruction] = useState('')
    const [loading, setLoading] = useState(false)

    if (!canEdit) return null

    async function handleClick() {
        if (currentValue.trim() && !window.confirm('Replace what you\'ve typed with an AI draft?')) {
            return
        }
        setLoading(true)
        try {
            const result = await draftReply(customerId, channel, instruction)
            onDraft({ body: result.draft, subject: result.subject })
        } catch (err) {
            const message = err instanceof Error && err.message ? err.message : 'Could not generate a draft'
            toast(message, 'error')
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="flex items-center gap-2">
            <input
                type="text"
                value={instruction}
                onChange={e => setInstruction(e.target.value.slice(0, INSTRUCTION_MAX_LENGTH))}
                placeholder="Optional: ask for photos, push for a decision…"
                className="input-field flex-1 text-xs py-1.5"
                disabled={loading || disabled}
            />
            <button
                type="button"
                onClick={handleClick}
                disabled={loading || disabled}
                className="btn-secondary text-xs px-3 py-1.5 whitespace-nowrap shrink-0"
                title="Draft a reply from this conversation with AI. Review before sending — nothing is sent automatically."
            >
                {loading ? 'Drafting…' : '✨ Draft reply'}
            </button>
        </div>
    )
}
