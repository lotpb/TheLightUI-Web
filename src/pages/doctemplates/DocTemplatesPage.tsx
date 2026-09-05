import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  subscribeToDocTemplates, createDocTemplate,
  updateDocTemplate, deleteDocTemplate,
} from '../../services/docTemplateService'
import {
  DOC_PLACEHOLDERS, KIND_COLORS, KIND_LABELS,
  type DocTemplate, type DocTemplateKind, type DocSection,
} from '../../models/docTemplate'
import { useToast } from '../../components/Toast'
import { usePageTitle } from '../../hooks/usePageTitle'
import ConfirmModal from '../../components/ConfirmModal'
import { Icon, ICONS } from '../../components/Icon'

type Draft = Pick<DocTemplate, 'name' | 'kind' | 'intro' | 'sections' | 'closing'>

/** Which text area a merge field gets inserted into. */
type FieldTarget =
  | { kind: 'intro' }
  | { kind: 'closing' }
  | { kind: 'section'; idx: number }

/** The target plus the caret position within it, so a chip can splice at it. */
interface FocusState {
  target: FieldTarget
  start:  number
  end:    number
}

function targetLabel(t: FieldTarget): string {
  if (t.kind === 'intro')   return 'Introduction'
  if (t.kind === 'closing') return 'Closing'
  return `Section ${t.idx + 1}`
}

function splice(value: string, start: number, end: number, token: string): string {
  const s = Math.min(start, value.length)
  const e = Math.min(Math.max(end, s), value.length)
  return value.slice(0, s) + token + value.slice(e)
}

const EMPTY: Draft = {
  name:     '',
  kind:     'proposal',
  intro:    '',
  sections: [{ heading: '', body: '' }],
  closing:  '',
}

export default function DocTemplatesPage() {
  usePageTitle('Document Templates')
  const toast    = useToast()
  const navigate = useNavigate()

  const [templates,  setTemplates]  = useState<DocTemplate[]>([])
  const [loading,    setLoading]    = useState(true)
  const [editId,     setEditId]     = useState<string | null>(null)
  const [draft,      setDraft]      = useState<Draft>({ ...EMPTY })
  const [saving,     setSaving]     = useState(false)
  const [confirmId,  setConfirmId]  = useState<string | null>(null)
  // Which field the caret is in, in React state rather than read off the DOM.
  const [focus, setFocus] = useState<FocusState | null>(null)
  const activeTextareaRef = useRef<HTMLTextAreaElement | null>(null)
  const dialogRef = useRef<HTMLFormElement>(null)

  useEffect(() => {
    return subscribeToDocTemplates(
      ts => { setTemplates(ts); setLoading(false) },
      ()  => setLoading(false),
    )
  }, [])

  function openNew() {
    setDraft({ ...EMPTY, sections: [{ heading: '', body: '' }] })
    setEditId('__new__')
  }

  function openEdit(t: DocTemplate) {
    setDraft({ name: t.name, kind: t.kind, intro: t.intro, sections: t.sections.length ? t.sections : [{ heading: '', body: '' }], closing: t.closing })
    setEditId(t.id)
  }

  function closeModal() { setEditId(null); setSaving(false); setFocus(null) }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!draft.name.trim()) return
    setSaving(true)
    try {
      if (editId === '__new__') {
        await createDocTemplate(draft)
        toast('Template created', 'success')
      } else if (editId) {
        await updateDocTemplate(editId, draft)
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
    try { await deleteDocTemplate(id); toast('Template deleted', 'success') }
    catch { toast('Failed to delete', 'error') }
  }

  function setSection(idx: number, field: keyof DocSection, val: string) {
    setDraft(d => {
      const secs = [...d.sections]
      secs[idx] = { ...secs[idx], [field]: val }
      return { ...d, sections: secs }
    })
  }

  function addSection() {
    setDraft(d => ({ ...d, sections: [...d.sections, { heading: '', body: '' }] }))
  }

  function removeSection(idx: number) {
    setDraft(d => ({ ...d, sections: d.sections.filter((_, i) => i !== idx) }))
    // Removing a section renumbers the ones after it, so a remembered
    // section target would now point at different text. Drop it.
    setFocus(f => (f?.target.kind === 'section' ? null : f))
  }

  /** Records the caret whenever the user focuses, clicks, types or selects. */
  function rememberFocus(target: FieldTarget, el: HTMLTextAreaElement) {
    activeTextareaRef.current = el
    setFocus({ target, start: el.selectionStart ?? 0, end: el.selectionEnd ?? 0 })
  }

  /**
   * Splices a token into the *state* value for the focused field.
   *
   * The old version read `el.value` straight off the DOM, wrote that back to
   * state, and identified the field by parsing an index out of a
   * `data-field="section-body-3"` attribute — so it was bound to array position
   * and could write a stale DOM string over newer state. It also bailed
   * silently when no textarea had ever been focused, which meant all fifteen
   * chips looked enabled and did nothing on a freshly opened modal.
   */
  function insertPlaceholder(token: string) {
    if (!focus) return
    const { target, start, end } = focus

    setDraft(d => {
      if (target.kind === 'intro')   return { ...d, intro:   splice(d.intro,   start, end, token) }
      if (target.kind === 'closing') return { ...d, closing: splice(d.closing, start, end, token) }
      const secs = [...d.sections]
      const sec  = secs[target.idx]
      if (!sec) return d
      secs[target.idx] = { ...sec, body: splice(sec.body, start, end, token) }
      return { ...d, sections: secs }
    })

    const caret = start + token.length
    setFocus({ target, start: caret, end: caret })
    // After the re-render, not on a 0ms timer racing it.
    requestAnimationFrame(() => {
      const el = activeTextareaRef.current
      if (!el) return
      el.focus()
      el.setSelectionRange(caret, caret)
    })
  }

  const isNew = editId === '__new__'
  const editingTemplate = templates.find(t => t.id === editId)
  const deletingTemplate = templates.find(t => t.id === confirmId)

  // Escape closes, Tab cycles inside. The modal was a bare div with an onClick
  // backdrop: no role, no aria-modal, no key handling, no focus containment —
  // so Tab walked into the page behind a form with a name field, a select,
  // sixteen chips and two fields per section.
  useEffect(() => {
    if (!editId) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { closeModal(); return }
      if (e.key !== 'Tab') return
      const root = dialogRef.current
      if (!root) return
      const f = root.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])',
      )
      if (f.length === 0) return
      const first = f[0], last = f[f.length - 1]
      if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
      else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [editId])

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Document Templates</h1>
          <p className="text-sm text-gray-400 mt-0.5">Proposals, contracts, reports and letters with merge fields</p>
        </div>
        <button onClick={openNew} className="btn-primary text-sm px-4 py-2">+ New Template</button>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="card p-4 animate-pulse">
              <div className="h-4 bg-gray-700 rounded w-40 mb-2" />
              <div className="h-3 bg-gray-700/60 rounded w-64" />
            </div>
          ))}
        </div>
      ) : templates.length === 0 ? (
        <div className="card p-12 text-center">
          <Icon d={ICONS.documentText} className="w-10 h-10 mx-auto mb-3 text-gray-400" />
          <p className="text-gray-300 font-medium mb-1">No document templates yet</p>
          <p className="text-sm text-gray-400 mb-4">
            Create reusable proposals, contracts and reports with merge fields like {'{{name}}'} and {'{{amount}}'}
          </p>
          <button onClick={openNew} className="btn-primary text-sm px-4 py-2">Create your first template</button>
        </div>
      ) : (
        <div className="space-y-3">
          {templates.map(t => (
            <div key={t.id} className="card p-4 group">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="font-medium text-white">{t.name}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${KIND_COLORS[t.kind]}`}>
                      {KIND_LABELS[t.kind]}
                    </span>
                    {t.sections.length > 0 && (
                      <span className="text-xs text-gray-400">{t.sections.length} section{t.sections.length !== 1 ? 's' : ''}</span>
                    )}
                  </div>
                  {t.intro && (
                    <p className="text-sm text-gray-400 line-clamp-2 whitespace-pre-wrap">{t.intro}</p>
                  )}
                </div>
                {/* Generate is the point of the page, so it's a filled button;
                    Edit and Delete are icon buttons. All three used to be
                    text-xs text links of identical weight, distinguished only
                    by colour — and colour was exactly what failed, since
                    text-teal-400 had no light-mode rule and sat at 1.86:1 right
                    next to an Edit link at 7.90:1. */}
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    onClick={() => navigate(`/doc-templates/${t.id}/generate`)}
                    className="btn-primary inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5"
                  >
                    <Icon d={ICONS.sparkle} className="w-3.5 h-3.5 shrink-0" />
                    Generate
                  </button>
                  <button
                    onClick={() => openEdit(t)}
                    aria-label={`Edit template "${t.name}"`}
                    title="Edit"
                    className="p-1.5 rounded-lg text-gray-400 hover:text-gray-200 hover:bg-gray-700/50 transition-colors
                               focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                  >
                    <Icon d={ICONS.pencil} className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setConfirmId(t.id)}
                    aria-label={`Delete template "${t.name}"`}
                    title="Delete"
                    className="p-1.5 rounded-lg text-gray-400 hover:text-red-400 hover:bg-gray-700/50 transition-colors
                               focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                  >
                    <Icon d={ICONS.trash} className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Reference, always available. It used to be gated on
          templates.length > 0, so a first-time user building their first
          template — exactly the person who needs to know what tokens exist —
          saw no field list at all, only two examples in the empty-state prose.
          bg-gray-700, not bg-gray-800: --gray-800 is 255 255 255 in light mode,
          so these chips were white on a white card. */}
      <div className="mt-6 card p-4">
        <p className="card-section-title block mb-3">Available Merge Fields</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {DOC_PLACEHOLDERS.map(p => (
            <div key={p.token} className="flex items-center gap-2 min-w-0">
              <code className="text-xs bg-gray-700 text-indigo-300 px-2 py-0.5 rounded font-mono shrink-0">{p.token}</code>
              <span className="text-xs text-gray-400 truncate">{p.desc}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Edit / Create modal */}
      {editId && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-0 sm:px-4">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={closeModal} aria-hidden="true" />
          <form
            ref={dialogRef}
            onSubmit={handleSave}
            role="dialog"
            aria-modal="true"
            aria-labelledby="tpl-dialog-title"
            className="relative bg-gray-900 border border-gray-700 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-2xl shadow-2xl flex flex-col max-h-[94vh]"
          >
            {/* Modal header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700 shrink-0">
              <p id="tpl-dialog-title" className="font-semibold text-white">
                {isNew ? 'New Document Template' : `Edit: ${editingTemplate?.name ?? ''}`}
              </p>
              <button
                type="button"
                onClick={closeModal}
                aria-label="Close"
                className="p-1.5 -mr-1.5 rounded text-gray-400 hover:text-gray-200 hover:bg-gray-700/50 transition-colors
                           focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              >
                <Icon d={ICONS.close} className="w-5 h-5" />
              </button>
            </div>

            {/* Modal body */}
            <div className="flex-1 overflow-y-auto p-5 space-y-5">

              {/* Name + Kind */}
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2 sm:col-span-1">
                  <label className="form-label">Template Name *</label>
                  <input
                    type="text"
                    required
                    value={draft.name}
                    onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
                    placeholder="e.g. Standard Proposal"
                    className="input-field w-full text-sm"
                    autoFocus
                  />
                </div>
                <div>
                  <label className="form-label">Document Type</label>
                  <select
                    value={draft.kind}
                    onChange={e => setDraft(d => ({ ...d, kind: e.target.value as DocTemplateKind }))}
                    className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-sm text-white outline-none focus:border-indigo-500"
                  >
                    <option value="proposal">Proposal</option>
                    <option value="contract">Contract</option>
                    <option value="report">Report</option>
                    <option value="letter">Letter</option>
                  </select>
                </div>
              </div>

              {/* Placeholder chips. They now say where they'll insert, and go
                  disabled when there's nowhere to insert — previously all
                  sixteen looked enabled, responded to hover and did nothing
                  until you'd clicked into a text area, with no hint that you
                  had to. */}
              <div>
                <p className="text-xs text-gray-400 mb-1.5">
                  {focus
                    ? <>Insert merge field into <span className="text-gray-200 font-medium">{targetLabel(focus.target)}</span></>
                    : 'Click into Introduction, a Section or Closing first, then pick a merge field'}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {DOC_PLACEHOLDERS.map(p => (
                    <button
                      key={p.token}
                      type="button"
                      disabled={!focus}
                      onClick={() => insertPlaceholder(p.token)}
                      className="text-xs bg-gray-700 text-indigo-300 border border-gray-600 hover:border-indigo-500
                                 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-gray-600
                                 px-2 py-0.5 rounded-full font-mono transition-colors
                                 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                      title={p.desc}
                    >
                      {p.token}
                    </button>
                  ))}
                </div>
              </div>

              {/* Intro */}
              <div>
                <label className="form-label">Introduction / Opening Paragraph</label>
                <textarea
                  value={draft.intro}
                  onFocus={e => rememberFocus({ kind: 'intro' }, e.currentTarget)}
                  onClick={e => rememberFocus({ kind: 'intro' }, e.currentTarget)}
                  onKeyUp={e => rememberFocus({ kind: 'intro' }, e.currentTarget)}
                  onSelect={e => rememberFocus({ kind: 'intro' }, e.currentTarget)}
                  onChange={e => setDraft(d => ({ ...d, intro: e.target.value }))}
                  rows={4}
                  placeholder="Dear {{firstName}}, thank you for the opportunity to present this {{kind}}…"
                  className="input-field w-full text-sm resize-none"
                />
              </div>

              {/* Sections */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <p className="card-section-title">Sections</p>
                  <button
                    type="button"
                    onClick={addSection}
                    className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
                  >
                    + Add Section
                  </button>
                </div>

                {/* Labelled fields, and the last section can be removed.
                    Heading and body were two identical input-field boxes whose
                    only distinction was a placeholder that disappeared as soon
                    as you typed — so a filled-in section gave no clue which was
                    which. Removal was also gated on length > 1, so a single
                    unwanted section could be emptied but never deleted. */}
                {draft.sections.map((sec, idx) => (
                  <div key={idx} className="bg-gray-800/50 rounded-xl p-4 space-y-3 border border-gray-700/50">
                    <div className="flex items-end justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <label className="form-label" htmlFor={`sec-head-${idx}`}>
                          Section {idx + 1} heading
                        </label>
                        <input
                          id={`sec-head-${idx}`}
                          type="text"
                          value={sec.heading}
                          onChange={e => setSection(idx, 'heading', e.target.value)}
                          placeholder="e.g. Scope of Work"
                          className="input-field w-full text-sm py-1.5 font-medium"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => removeSection(idx)}
                        aria-label={`Remove section ${idx + 1}`}
                        title="Remove section"
                        className="shrink-0 p-1.5 rounded text-gray-400 hover:text-red-400 hover:bg-gray-700/50 transition-colors
                                   focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                      >
                        <Icon d={ICONS.close} className="w-4 h-4" />
                      </button>
                    </div>
                    <div>
                      <label className="form-label" htmlFor={`sec-body-${idx}`}>Section {idx + 1} body</label>
                      <textarea
                        id={`sec-body-${idx}`}
                        value={sec.body}
                        onFocus={e => rememberFocus({ kind: 'section', idx }, e.currentTarget)}
                        onClick={e => rememberFocus({ kind: 'section', idx }, e.currentTarget)}
                        onKeyUp={e => rememberFocus({ kind: 'section', idx }, e.currentTarget)}
                        onSelect={e => rememberFocus({ kind: 'section', idx }, e.currentTarget)}
                        onChange={e => setSection(idx, 'body', e.target.value)}
                        rows={4}
                        placeholder="Describe this section…"
                        className="input-field w-full text-sm resize-none"
                      />
                    </div>
                  </div>
                ))}

                {draft.sections.length === 0 && (
                  <p className="text-xs text-gray-400">
                    No sections. The document will use just the introduction and closing.
                  </p>
                )}
              </div>

              {/* Closing */}
              <div>
                <label className="form-label">Closing / Terms</label>
                <textarea
                  value={draft.closing}
                  onFocus={e => rememberFocus({ kind: 'closing' }, e.currentTarget)}
                  onClick={e => rememberFocus({ kind: 'closing' }, e.currentTarget)}
                  onKeyUp={e => rememberFocus({ kind: 'closing' }, e.currentTarget)}
                  onSelect={e => rememberFocus({ kind: 'closing' }, e.currentTarget)}
                  onChange={e => setDraft(d => ({ ...d, closing: e.target.value }))}
                  rows={3}
                  placeholder="We look forward to working with you. Please sign below to accept…"
                  className="input-field w-full text-sm resize-none"
                />
              </div>
            </div>

            {/* Modal footer */}
            <div className="px-5 py-4 border-t border-gray-700 flex justify-end gap-3 shrink-0">
              <button type="button" onClick={closeModal} className="btn-secondary text-sm px-4 py-2">Cancel</button>
              <button
                type="submit"
                disabled={saving || !draft.name.trim()}
                className="btn-primary text-sm px-5 py-2 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {saving ? 'Saving…' : isNew ? 'Create' : 'Save Changes'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Names the template. "Delete this document template?" said nothing
          about which one, with the id already in hand. */}
      <ConfirmModal
        isOpen={!!confirmId}
        message={deletingTemplate
          ? `Delete "${deletingTemplate.name}"? This cannot be undone.`
          : 'Delete this document template? This cannot be undone.'}
        onConfirm={() => confirmId && handleDelete(confirmId)}
        onCancel={() => setConfirmId(null)}
      />
    </div>
  )
}
