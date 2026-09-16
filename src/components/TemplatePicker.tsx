import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { subscribeToTemplates } from '../services/templateService'
import type { MessageTemplate } from '../models/template'
import {
  translateTokens, FIELD_LABELS,
  type TemplateDialect, type MergeField,
} from '../models/templateTokens'
import { useDismissOnOutside } from '../hooks/useDismissOnOutside'
import { Icon, ICONS } from './Icon'

/**
 * Inserts a saved /templates entry into a composer, translated.
 *
 * The template library had exactly one consumer — the Email/Text modal on a
 * customer record, which builds a mailto: link — so every path that actually
 * sends (/blast, /campaigns, and both inbox replies) had its own compose box
 * and could not see a saved template at all.
 *
 * Pasting one across by hand doesn't work either: the three systems use
 * different tokens (`{{firstName}}` here, `{first}` for bulkSendEmail,
 * `{{firstName}}` but a different field set for campaigns), so a template
 * body dropped into /blast would deliver `Hi {{firstName}},` verbatim.
 * translateTokens rewrites on insert and reports what the destination can't
 * express, which is surfaced below rather than discovered by a customer.
 */
export default function TemplatePicker({
  dialect,
  channel,
  onInsert,
  disabled,
  className = '',
}: {
  /** The composer's own vocabulary — what tokens get rewritten into. */
  dialect: TemplateDialect
  /** Narrows the list the way the record modal does. */
  channel: 'email' | 'sms'
  onInsert: (result: { subject: string; body: string }) => void
  disabled?: boolean
  className?: string
}) {
  const [templates, setTemplates] = useState<MessageTemplate[]>([])
  const [open, setOpen] = useState(false)
  const [warning, setWarning] = useState<{ unresolved: MergeField[]; unknown: string[] } | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useDismissOnOutside(ref, () => setOpen(false), open)

  useEffect(() => subscribeToTemplates(
    ts => setTemplates(ts),
    err => console.error('[TemplatePicker] templates subscription failed:', err),
  ), [])

  const usable = useMemo(
    () => templates.filter(t => t.type === channel || t.type === 'both'),
    [templates, channel],
  )

  function choose(t: MessageTemplate) {
    const body = translateTokens(t.body, 'template', dialect)
    const subject = translateTokens(t.subject, 'template', dialect)
    onInsert({ subject: subject.text, body: body.text })
    setOpen(false)

    const unresolved = [...new Set([...body.unresolved, ...subject.unresolved])]
    const unknown = [...new Set([...body.unknown, ...subject.unknown])]
    setWarning(unresolved.length > 0 || unknown.length > 0 ? { unresolved, unknown } : null)
  }

  if (templates.length === 0) return null

  return (
    <div className={className}>
      <div className="relative inline-block" ref={ref}>
        <button
          type="button"
          onClick={() => setOpen(v => !v)}
          disabled={disabled}
          aria-haspopup="menu"
          aria-expanded={open}
          className="btn-secondary text-sm px-3 py-1.5 inline-flex items-center gap-1.5 disabled:opacity-40"
        >
          <Icon d={ICONS.documentText} className="w-4 h-4" />
          Use template
          <Icon d={ICONS.chevronDown} className="w-3 h-3" />
        </button>
        {open && (
          <div
            role="menu"
            className="absolute left-0 top-full mt-1 w-72 max-h-72 overflow-y-auto bg-gray-900 border border-gray-600 rounded-xl shadow-2xl z-40"
          >
            {usable.length === 0 ? (
              <p className="px-3 py-3 text-xs text-gray-400">
                No {channel === 'email' ? 'email' : 'SMS'} templates yet.{' '}
                <Link to="/templates" className="text-indigo-400 hover:text-indigo-300">Create one</Link>
              </p>
            ) : (
              usable.map(t => (
                <button
                  key={t.id}
                  type="button"
                  role="menuitem"
                  onClick={() => choose(t)}
                  className="w-full text-left px-3 py-2.5 hover:bg-gray-700/60 transition-colors border-b border-gray-700/60 last:border-0"
                >
                  <span className="block text-sm text-gray-100 truncate">{t.name}</span>
                  <span className="block text-xs text-gray-400 truncate">{t.body}</span>
                </button>
              ))
            )}
          </div>
        )}
      </div>

      {/* Said before the send, not discovered by a recipient. */}
      {warning && (
        <div className="mt-2 bg-amber-900/20 border border-amber-600/40 rounded-lg px-3 py-2 space-y-1">
          {warning.unresolved.length > 0 && (
            <p className="text-xs text-amber-300">
              This composer can't fill in{' '}
              {warning.unresolved.map(f => FIELD_LABELS[f].toLowerCase()).join(', ')} — those
              placeholders were left as written and will send as literal text. Replace or remove them.
            </p>
          )}
          {warning.unknown.length > 0 && (
            <p className="text-xs text-amber-300">
              Unrecognised placeholder{warning.unknown.length === 1 ? '' : 's'}:{' '}
              <span className="font-mono">{warning.unknown.join(' ')}</span> — check the spelling, or they
              will arrive exactly like that.
            </p>
          )}
          <button
            type="button"
            onClick={() => setWarning(null)}
            className="text-xs text-amber-200 underline hover:text-amber-100"
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  )
}
