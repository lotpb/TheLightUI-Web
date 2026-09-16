import { useEffect, useMemo, useRef, useState } from 'react'
import { subscribeToTemplates, createTemplate, updateTemplate, deleteTemplate } from '../../services/templateService'
import { PLACEHOLDERS, STARTER_TEMPLATES, type MessageTemplate, type TemplateType } from '../../models/template'
import { previewText, smsLength, unknownTokens } from '../../models/templateTokens'
import { useToast } from '../../components/Toast'
import { usePageTitle } from '../../hooks/usePageTitle'
import ConfirmModal from '../../components/ConfirmModal'
import CollapsibleSection from '../../components/CollapsibleSection'
import { Icon, ICONS } from '../../components/Icon'

const TYPE_LABELS: Record<TemplateType, string> = { email: 'Email', sms: 'SMS', both: 'Email & SMS' }
const TYPE_COLORS: Record<TemplateType, string> = {
  email: 'bg-blue-500/15 text-blue-300 border border-blue-500/25',
  sms:   'bg-green-500/15 text-green-300 border border-green-500/25',
  both:  'bg-indigo-500/15 text-indigo-300 border border-indigo-500/25',
}

const EMPTY: Omit<MessageTemplate, 'id' | 'createdAt' | 'updatedAt'> = {
  name: '', type: 'both', subject: '', body: '',
}

export default function TemplatesPage() {
  usePageTitle('Templates')
  const toast = useToast()
  const [templates, setTemplates] = useState<MessageTemplate[]>([])
  const [loading, setLoading] = useState(true)
  // A failed subscription used to clear the loading flag and nothing else, so
  // a missing index rendered "No templates yet" — and because the starter
  // examples lived inside that empty state, a broken page looked like a
  // brand-new, fully working one.
  const [error, setError]     = useState<string | null>(null)
  const [editId, setEditId]   = useState<string | null>(null)
  const [draft, setDraft]     = useState({ ...EMPTY })
  const [saving, setSaving]   = useState(false)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [search, setSearch]   = useState('')
  const [showPreview, setShowPreview] = useState(true)
  const bodyRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    return subscribeToTemplates(
      ts => { setTemplates(ts); setError(null); setLoading(false) },
      err => {
        console.error('[TemplatesPage] templates subscription failed:', err)
        setError(err.message || 'Could not load templates.')
        setLoading(false)
      },
    )
  }, [])

  function openNew() {
    setDraft({ ...EMPTY })
    setEditId('__new__')
  }

  function openFromExample(example: typeof STARTER_TEMPLATES[number]) {
    setDraft({ ...example })
    setEditId('__new__')
  }

  function openEdit(t: MessageTemplate) {
    setDraft({ name: t.name, type: t.type, subject: t.subject, body: t.body })
    setEditId(t.id)
  }

  /** The most common operation after edit, and there was no way to do it. */
  function openDuplicate(t: MessageTemplate) {
    setDraft({ name: `${t.name} (copy)`, type: t.type, subject: t.subject, body: t.body })
    setEditId('__new__')
  }

  function closeModal() {
    setEditId(null)
    setSaving(false)
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!draft.name.trim() || !draft.body.trim()) return
    setSaving(true)
    try {
      if (editId === '__new__') {
        await createTemplate(draft)
        toast('Template created', 'success')
      } else if (editId) {
        await updateTemplate(editId, draft)
        toast('Template updated', 'success')
      }
      closeModal()
    } catch {
      toast('Failed to save template', 'error')
      setSaving(false)
    }
  }

  async function handleDelete(id: string) {
    setConfirmId(null)
    try {
      await deleteTemplate(id)
      toast('Template deleted', 'success')
    } catch {
      toast('Failed to delete template', 'error')
    }
  }

  function insertPlaceholder(token: string) {
    const el = bodyRef.current
    if (!el) { setDraft(d => ({ ...d, body: d.body + token })); return }
    const start = el.selectionStart ?? el.value.length
    const end   = el.selectionEnd   ?? el.value.length
    const next  = el.value.slice(0, start) + token + el.value.slice(end)
    setDraft(d => ({ ...d, body: next }))
    setTimeout(() => {
      el.focus()
      el.setSelectionRange(start + token.length, start + token.length)
    }, 0)
  }

  const isNew = editId === '__new__'
  const editingTemplate = templates.find(t => t.id === editId)
  const deleteTarget = templates.find(t => t.id === confirmId) ?? null

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return templates
    return templates.filter(t =>
      t.name.toLowerCase().includes(q) ||
      t.subject.toLowerCase().includes(q) ||
      t.body.toLowerCase().includes(q),
    )
  }, [templates, search])

  /**
   * Tokens the record composer's interpolate() can't resolve.
   *
   * It leaves an unknown token exactly as written — reasonable as a library
   * default, invisible as a product: `{{firstname}}` saved cleanly and
   * arrived in the customer's message verbatim. utils/mergeTags.ts already
   * had unknownTags() for /blast with a note saying it was worth saying
   * before the send; this page had no equivalent.
   */
  const badTokens = useMemo(
    () => [...new Set([...unknownTokens(draft.body, 'template'), ...unknownTokens(draft.subject, 'template')])],
    [draft.body, draft.subject],
  )
  const isSms = draft.type === 'sms' || draft.type === 'both'
  const sms = useMemo(() => smsLength(draft.body), [draft.body])

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-white">Templates</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            Reusable email &amp; SMS messages — insert one from a customer record, a blast, a campaign,
            or an inbox reply
          </p>
        </div>
        <button onClick={openNew} className="btn-primary text-sm px-4 py-2">+ New Template</button>
      </div>

      {error && (
        <div className="bg-red-900/30 border border-red-700/50 rounded-xl px-4 py-3 mb-6">
          <p className="text-sm text-red-300 font-medium">Could not load templates</p>
          <p className="text-xs text-red-300/90 mt-1">{error}</p>
          <p className="text-xs text-red-300/90 mt-1">
            This query needs a <span className="font-mono">companyId + createdAt</span> composite index on{' '}
            <span className="font-mono">messageTemplates</span>. Nothing has been lost.
          </p>
        </div>
      )}

      {/* The starters used to live inside the empty state, so creating one
          template hid the other three forever. They're a persistent
          disclosure now, the way /sequences does it. */}
      {!loading && !error && (
        <div className="mb-6">
          <CollapsibleSection
            title="Start from an example"
            count={STARTER_TEMPLATES.length}
            defaultOpen={templates.length === 0}
          >
            <div className="grid sm:grid-cols-2 gap-3">
              {STARTER_TEMPLATES.map(ex => (
                <button
                  key={ex.name}
                  onClick={() => openFromExample(ex)}
                  className="card p-3 border-gray-600 hover:border-indigo-500 transition-colors text-left"
                >
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="font-medium text-white text-sm">{ex.name}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${TYPE_COLORS[ex.type]}`}>
                      {TYPE_LABELS[ex.type]}
                    </span>
                  </div>
                  <p className="text-xs text-gray-400 line-clamp-2 whitespace-pre-wrap">{ex.body}</p>
                </button>
              ))}
            </div>
          </CollapsibleSection>
        </div>
      )}

      {templates.length > 3 && !loading && !error && (
        <div className="relative mb-4">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
            <Icon d={ICONS.search} className="w-4 h-4" />
          </span>
          <input
            type="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search templates…"
            aria-label="Search templates by name, subject or body"
            className="input-field w-full pl-9 text-sm py-2"
          />
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="card p-4 animate-pulse">
              <div className="h-4 bg-gray-700 rounded w-40 mb-2" />
              <div className="h-3 bg-gray-700/60 rounded w-64" />
            </div>
          ))}
        </div>
      ) : error ? null : templates.length === 0 ? (
        <div className="card p-12 text-center">
          <Icon d={ICONS.envelope} className="w-10 h-10 mx-auto text-gray-400 mb-3" />
          <p className="text-gray-100 font-medium mb-1">No templates yet</p>
          <p className="text-sm text-gray-400 mb-4">
            Save reusable messages with placeholders like {'{{firstName}}'} and {'{{date}}'}
          </p>
          <button onClick={openNew} className="btn-primary text-sm px-4 py-2">Create your first template</button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="text-gray-100 font-medium">No templates match “{search.trim()}”</p>
          <button onClick={() => setSearch('')} className="btn-secondary text-sm px-4 py-2 mt-3">
            Clear search
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(t => {
            const bad = unknownTokens(t.body, 'template').concat(unknownTokens(t.subject, 'template'))
            return (
              <div key={t.id} className="card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="font-medium text-white">{t.name}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${TYPE_COLORS[t.type]}`}>
                        {TYPE_LABELS[t.type]}
                      </span>
                      {/* Already-saved templates can carry a typo too. */}
                      {bad.length > 0 && (
                        <span
                          title={`${bad.join(' ')} will send as literal text`}
                          className="text-xs bg-amber-500/20 text-amber-300 px-2 py-0.5 rounded-full cursor-help"
                        >
                          Unknown placeholder
                        </span>
                      )}
                    </div>
                    {/* Was text-gray-500 at 3.04:1 — half the content of an
                        email template. */}
                    {t.subject && (
                      <p className="text-xs text-gray-400 mb-1">Subject: {t.subject}</p>
                    )}
                    <p className="text-sm text-gray-400 line-clamp-2 whitespace-pre-wrap">{t.body}</p>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <button
                      onClick={() => openEdit(t)}
                      className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors px-2 py-1 rounded hover:bg-gray-700"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => openDuplicate(t)}
                      aria-label={`Duplicate ${t.name}`}
                      className="text-xs text-gray-400 hover:text-gray-100 transition-colors px-2 py-1 rounded hover:bg-gray-700"
                    >
                      Duplicate
                    </button>
                    <button
                      onClick={() => setConfirmId(t.id)}
                      aria-label={`Delete ${t.name}`}
                      className="text-xs text-gray-400 hover:text-red-400 transition-colors px-2 py-1 rounded hover:bg-gray-700"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Placeholder reference card */}
      {templates.length > 0 && !error && (
        <div className="mt-6 card p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">Available Placeholders</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {PLACEHOLDERS.map(p => (
              <div key={p.token} className="flex items-center gap-2">
                {/* Was bg-gray-800 on a bg-gray-800 card — 1.000:1, the chip
                    carried entirely by a 1.42:1 border. Legible inside the
                    modal and invisible here, from the same classes. */}
                <code className="text-xs bg-gray-900 border border-gray-500 text-indigo-300 px-2 py-0.5 rounded font-mono">
                  {p.token}
                </code>
                <span className="text-xs text-gray-400">{p.desc}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Edit / Create modal */}
      {editId && (
        <TemplateEditor
          isNew={isNew}
          name={editingTemplate?.name ?? ''}
          draft={draft}
          saving={saving}
          badTokens={badTokens}
          isSms={isSms}
          sms={sms}
          showPreview={showPreview}
          bodyRef={bodyRef}
          onTogglePreview={() => setShowPreview(v => !v)}
          onClose={closeModal}
          onSubmit={handleSave}
          onPatch={patch => setDraft(d => ({ ...d, ...patch }))}
          onInsertPlaceholder={insertPlaceholder}
        />
      )}

      <ConfirmModal
        isOpen={!!confirmId}
        message={
          deleteTarget
            ? `Delete "${deleteTarget.name}"? This cannot be undone. Messages already sent from it are unaffected.`
            : ''
        }
        confirmLabel="Delete template"
        onConfirm={() => confirmId && handleDelete(confirmId)}
        onCancel={() => setConfirmId(null)}
      />
    </div>
  )
}

function TemplateEditor({
  isNew, name, draft, saving, badTokens, isSms, sms, showPreview, bodyRef,
  onTogglePreview, onClose, onSubmit, onPatch, onInsertPlaceholder,
}: {
  isNew: boolean
  name: string
  draft: Omit<MessageTemplate, 'id' | 'createdAt' | 'updatedAt'>
  saving: boolean
  badTokens: string[]
  isSms: boolean
  sms: { characters: number; segments: number }
  showPreview: boolean
  bodyRef: React.RefObject<HTMLTextAreaElement>
  onTogglePreview: () => void
  onClose: () => void
  onSubmit: (e: React.FormEvent) => void
  onPatch: (patch: Partial<Omit<MessageTemplate, 'id' | 'createdAt' | 'updatedAt'>>) => void
  onInsertPlaceholder: (token: string) => void
}) {
  // Escape closes it, the way ConfirmModal does. The backdrop was clickable
  // and the keyboard had no exit at all.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const wantsSubject = draft.type === 'email' || draft.type === 'both'

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-0 sm:px-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <form
        onSubmit={onSubmit}
        className="relative bg-gray-900 border border-gray-600 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg shadow-2xl flex flex-col max-h-[92vh]"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700 shrink-0">
          <p className="font-semibold text-white">{isNew ? 'New Template' : `Edit: ${name}`}</p>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close editor"
            className="w-9 h-9 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-100 hover:bg-gray-700 transition-colors"
          >
            <Icon d={ICONS.close} className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              {/* The four labels had no htmlFor and the inputs no id. */}
              <label htmlFor="tmpl-name" className="block text-xs text-gray-400 mb-1.5">Template Name *</label>
              <input
                id="tmpl-name"
                type="text"
                required
                value={draft.name}
                onChange={e => onPatch({ name: e.target.value })}
                placeholder="e.g. Follow-up after visit"
                className="input-field w-full text-sm"
                autoFocus
              />
            </div>
            <div>
              <label htmlFor="tmpl-type" className="block text-xs text-gray-400 mb-1.5">Type</label>
              <select
                id="tmpl-type"
                value={draft.type}
                onChange={e => onPatch({ type: e.target.value as TemplateType })}
                className="w-full bg-gray-800 border border-gray-600 rounded-xl px-3 py-2 text-sm text-white outline-none focus:border-indigo-500"
              >
                <option value="both">Email &amp; SMS</option>
                <option value="email">Email only</option>
                <option value="sms">SMS only</option>
              </select>
            </div>
            {wantsSubject && (
              <div>
                <label htmlFor="tmpl-subject" className="block text-xs text-gray-400 mb-1.5">Subject (email)</label>
                <input
                  id="tmpl-subject"
                  type="text"
                  value={draft.subject}
                  onChange={e => onPatch({ subject: e.target.value })}
                  placeholder="Subject line…"
                  className="input-field w-full text-sm"
                />
              </div>
            )}
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5 gap-2">
              <label htmlFor="tmpl-body" className="text-xs text-gray-400">Message Body *</label>
              {/* 160 characters is one billable segment, and placeholders
                  expand — a body that looks short here can go out longer. */}
              {isSms && draft.body && (
                <span className={`text-xs tabular-nums ${sms.segments > 1 ? 'text-amber-300' : 'text-gray-400'}`}>
                  {sms.characters} chars once filled · {sms.segments} segment{sms.segments === 1 ? '' : 's'}
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {PLACEHOLDERS.map(p => (
                <button
                  key={p.token}
                  type="button"
                  onMouseDown={e => e.preventDefault()}
                  onClick={() => onInsertPlaceholder(p.token)}
                  className="text-xs bg-gray-800 text-indigo-300 border border-gray-600 hover:border-indigo-500 px-2 py-0.5 rounded-full font-mono transition-colors"
                  title={`Insert ${p.desc}`}
                >
                  {p.token}
                </button>
              ))}
            </div>
            <textarea
              id="tmpl-body"
              ref={bodyRef}
              required
              value={draft.body}
              onChange={e => onPatch({ body: e.target.value })}
              rows={7}
              placeholder="Hi {{firstName}}, just following up…"
              className="input-field w-full text-sm resize-none"
            />
            <p className="text-xs text-gray-400 mt-1">Click a placeholder chip above to insert it at the cursor</p>

            {/* interpolate() leaves an unknown token exactly as written, so a
                typo shipped silently to the customer. */}
            {badTokens.length > 0 && (
              <div className="mt-2 bg-amber-900/20 border border-amber-600/40 rounded-lg px-3 py-2">
                <p className="text-xs text-amber-300">
                  <span className="font-mono">{badTokens.join(' ')}</span> {badTokens.length === 1 ? "isn't" : "aren't"}{' '}
                  a placeholder this app knows, so {badTokens.length === 1 ? 'it' : 'they'} will arrive in the
                  message exactly like that. Check the spelling against the chips above.
                </p>
              </div>
            )}
          </div>

          {/* The whole artefact is text with holes in it, and the editor
              never filled them — resolution happened on a different page,
              against a customer you had to go and pick. */}
          <div>
            <button
              type="button"
              onClick={onTogglePreview}
              aria-expanded={showPreview}
              className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
            >
              {showPreview ? 'Hide preview' : 'Show preview'}
            </button>
            {showPreview && (
              <div className="mt-2 bg-gray-800 border border-gray-600 rounded-xl p-3">
                <p className="text-xs text-gray-400 mb-1.5">As it would read for a sample customer</p>
                {wantsSubject && draft.subject && (
                  <p className="text-sm text-gray-100 font-medium mb-1.5">{previewText(draft.subject)}</p>
                )}
                <p className="text-sm text-gray-200 whitespace-pre-wrap break-words">
                  {draft.body ? previewText(draft.body) : 'Nothing to preview yet.'}
                </p>
              </div>
            )}
          </div>
        </div>

        <div className="px-5 py-4 border-t border-gray-700 flex justify-end gap-3 shrink-0">
          <button type="button" onClick={onClose} className="btn-secondary text-sm px-4 py-2">
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving || !draft.name.trim() || !draft.body.trim()}
            className="btn-primary text-sm px-5 py-2 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {saving ? 'Saving…' : isNew ? 'Create' : 'Save Changes'}
          </button>
        </div>
      </form>
    </div>
  )
}
