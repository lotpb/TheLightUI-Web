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

type Draft = Pick<DocTemplate, 'name' | 'kind' | 'intro' | 'sections' | 'closing'>

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
  const activeTextareaRef = useRef<HTMLTextAreaElement | null>(null)

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

  function closeModal() { setEditId(null); setSaving(false) }

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
  }

  function insertPlaceholder(token: string) {
    const el = activeTextareaRef.current
    if (!el) return
    const start = el.selectionStart ?? el.value.length
    const end   = el.selectionEnd   ?? el.value.length
    const next  = el.value.slice(0, start) + token + el.value.slice(end)
    // Identify which textarea is focused to update the right field
    const name = el.getAttribute('data-field')
    if (name === 'intro') {
      setDraft(d => ({ ...d, intro: next }))
    } else if (name === 'closing') {
      setDraft(d => ({ ...d, closing: next }))
    } else if (name?.startsWith('section-body-')) {
      const idx = parseInt(name.replace('section-body-', ''), 10)
      setSection(idx, 'body', next)
    }
    setTimeout(() => {
      el.focus()
      el.setSelectionRange(start + token.length, start + token.length)
    }, 0)
  }

  const isNew = editId === '__new__'
  const editingTemplate = templates.find(t => t.id === editId)

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Document Templates</h1>
          <p className="text-sm text-gray-500 mt-0.5">Proposals, contracts, reports and letters with merge fields</p>
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
          <p className="text-4xl mb-3">📄</p>
          <p className="text-gray-300 font-medium mb-1">No document templates yet</p>
          <p className="text-sm text-gray-500 mb-4">
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
                      <span className="text-xs text-gray-600">{t.sections.length} section{t.sections.length !== 1 ? 's' : ''}</span>
                    )}
                  </div>
                  {t.intro && (
                    <p className="text-sm text-gray-400 line-clamp-2 whitespace-pre-wrap">{t.intro}</p>
                  )}
                </div>
                <div className="flex gap-2 shrink-0">
                  <button
                    onClick={() => navigate(`/doc-templates/${t.id}/generate`)}
                    className="text-xs text-teal-400 hover:text-teal-300 transition-colors px-2 py-1 rounded hover:bg-gray-700"
                  >
                    Generate
                  </button>
                  <button
                    onClick={() => openEdit(t)}
                    className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors px-2 py-1 rounded hover:bg-gray-700"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => setConfirmId(t.id)}
                    className="text-xs text-gray-500 hover:text-red-400 transition-colors px-2 py-1 rounded hover:bg-gray-700"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Placeholder reference */}
      {templates.length > 0 && (
        <div className="mt-6 card p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-3">Available Merge Fields</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {DOC_PLACEHOLDERS.map(p => (
              <div key={p.token} className="flex items-center gap-2">
                <code className="text-xs bg-gray-800 text-indigo-300 px-2 py-0.5 rounded font-mono">{p.token}</code>
                <span className="text-xs text-gray-500">{p.desc}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Edit / Create modal */}
      {editId && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-0 sm:px-4">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={closeModal} />
          <form
            onSubmit={handleSave}
            className="relative bg-gray-900 border border-gray-700 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-2xl shadow-2xl flex flex-col max-h-[94vh]"
          >
            {/* Modal header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700 shrink-0">
              <p className="font-semibold text-white">
                {isNew ? 'New Document Template' : `Edit: ${editingTemplate?.name ?? ''}`}
              </p>
              <button type="button" onClick={closeModal} className="text-gray-400 hover:text-gray-200">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Modal body */}
            <div className="flex-1 overflow-y-auto p-5 space-y-5">

              {/* Name + Kind */}
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2 sm:col-span-1">
                  <label className="block text-xs text-gray-500 mb-1.5">Template Name *</label>
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
                  <label className="block text-xs text-gray-500 mb-1.5">Document Type</label>
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

              {/* Placeholder chips */}
              <div>
                <p className="text-xs text-gray-500 mb-1.5">Insert merge field at cursor</p>
                <div className="flex flex-wrap gap-1.5">
                  {DOC_PLACEHOLDERS.map(p => (
                    <button
                      key={p.token}
                      type="button"
                      onClick={() => insertPlaceholder(p.token)}
                      className="text-xs bg-gray-800 text-indigo-300 border border-gray-700 hover:border-indigo-500 px-2 py-0.5 rounded-full font-mono transition-colors"
                      title={p.desc}
                    >
                      {p.token}
                    </button>
                  ))}
                </div>
              </div>

              {/* Intro */}
              <div>
                <label className="block text-xs text-gray-500 mb-1.5">Introduction / Opening Paragraph</label>
                <textarea
                  value={draft.intro}
                  data-field="intro"
                  onFocus={e => { activeTextareaRef.current = e.currentTarget }}
                  onChange={e => setDraft(d => ({ ...d, intro: e.target.value }))}
                  rows={4}
                  placeholder="Dear {{firstName}}, thank you for the opportunity to present this {{kind}}…"
                  className="input-field w-full text-sm resize-none"
                />
              </div>

              {/* Sections */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Sections</p>
                  <button
                    type="button"
                    onClick={addSection}
                    className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
                  >
                    + Add Section
                  </button>
                </div>

                {draft.sections.map((sec, idx) => (
                  <div key={idx} className="bg-gray-800/50 rounded-xl p-4 space-y-3 border border-gray-700/50">
                    <div className="flex items-center justify-between gap-2">
                      <input
                        type="text"
                        value={sec.heading}
                        onChange={e => setSection(idx, 'heading', e.target.value)}
                        placeholder={`Section ${idx + 1} heading…`}
                        className="input-field flex-1 text-sm py-1.5 font-medium"
                      />
                      {draft.sections.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeSection(idx)}
                          className="text-gray-600 hover:text-red-400 transition-colors shrink-0 p-1"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                          </svg>
                        </button>
                      )}
                    </div>
                    <textarea
                      value={sec.body}
                      data-field={`section-body-${idx}`}
                      onFocus={e => { activeTextareaRef.current = e.currentTarget }}
                      onChange={e => setSection(idx, 'body', e.target.value)}
                      rows={4}
                      placeholder="Describe this section…"
                      className="input-field w-full text-sm resize-none"
                    />
                  </div>
                ))}
              </div>

              {/* Closing */}
              <div>
                <label className="block text-xs text-gray-500 mb-1.5">Closing / Terms</label>
                <textarea
                  value={draft.closing}
                  data-field="closing"
                  onFocus={e => { activeTextareaRef.current = e.currentTarget }}
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

      <ConfirmModal
        isOpen={!!confirmId}
        message="Delete this document template? This cannot be undone."
        onConfirm={() => confirmId && handleDelete(confirmId)}
        onCancel={() => setConfirmId(null)}
      />
    </div>
  )
}
