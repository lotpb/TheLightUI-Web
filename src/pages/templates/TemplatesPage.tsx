import { useEffect, useRef, useState } from 'react'
import { subscribeToTemplates, createTemplate, updateTemplate, deleteTemplate } from '../../services/templateService'
import { PLACEHOLDERS, STARTER_TEMPLATES, type MessageTemplate, type TemplateType } from '../../models/template'
import { useToast } from '../../components/Toast'
import { usePageTitle } from '../../hooks/usePageTitle'
import ConfirmModal from '../../components/ConfirmModal'

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
  const [editId, setEditId]   = useState<string | null>(null)
  const [draft, setDraft]     = useState({ ...EMPTY })
  const [saving, setSaving]   = useState(false)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const bodyRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    return subscribeToTemplates(
      ts => { setTemplates(ts); setLoading(false) },
      () => setLoading(false),
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

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Templates</h1>
          <p className="text-sm text-gray-500 mt-0.5">Reusable email & SMS message templates</p>
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
          <p className="text-4xl mb-3">✉️</p>
          <p className="text-gray-300 font-medium mb-1">No templates yet</p>
          <p className="text-sm text-gray-500 mb-4">
            Save reusable messages with placeholders like {'{{firstName}}'} and {'{{date}}'}
          </p>
          <button onClick={openNew} className="btn-primary text-sm px-4 py-2">Create your first template</button>

          <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 mt-8 mb-3">Or start from an example</p>
          <div className="grid sm:grid-cols-2 gap-3 text-left">
            {STARTER_TEMPLATES.map(ex => (
              <button
                key={ex.name}
                onClick={() => openFromExample(ex)}
                className="card p-3 hover:border-indigo-500 transition-colors text-left"
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-medium text-white text-sm">{ex.name}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${TYPE_COLORS[ex.type]}`}>
                    {TYPE_LABELS[ex.type]}
                  </span>
                </div>
                <p className="text-xs text-gray-500 line-clamp-2 whitespace-pre-wrap">{ex.body}</p>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {templates.map(t => (
            <div key={t.id} className="card p-4 group">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="font-medium text-white">{t.name}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${TYPE_COLORS[t.type]}`}>
                      {TYPE_LABELS[t.type]}
                    </span>
                  </div>
                  {t.subject && (
                    <p className="text-xs text-gray-500 mb-1">Subject: {t.subject}</p>
                  )}
                  <p className="text-sm text-gray-400 line-clamp-2 whitespace-pre-wrap">{t.body}</p>
                </div>
                <div className="flex gap-2 shrink-0">
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

      {/* Placeholder reference card */}
      {templates.length > 0 && (
        <div className="mt-6 card p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-3">Available Placeholders</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {PLACEHOLDERS.map(p => (
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
            className="relative bg-gray-900 border border-gray-700 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg shadow-2xl flex flex-col max-h-[92vh]"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700 shrink-0">
              <p className="font-semibold text-white">{isNew ? 'New Template' : `Edit: ${editingTemplate?.name ?? ''}`}</p>
              <button type="button" onClick={closeModal} className="text-gray-400 hover:text-gray-200">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="block text-xs text-gray-500 mb-1.5">Template Name *</label>
                  <input
                    type="text"
                    required
                    value={draft.name}
                    onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
                    placeholder="e.g. Follow-up after visit"
                    className="input-field w-full text-sm"
                    autoFocus
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1.5">Type</label>
                  <select
                    value={draft.type}
                    onChange={e => setDraft(d => ({ ...d, type: e.target.value as TemplateType }))}
                    className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-sm text-white outline-none focus:border-indigo-500"
                  >
                    <option value="both">Email & SMS</option>
                    <option value="email">Email only</option>
                    <option value="sms">SMS only</option>
                  </select>
                </div>
                {(draft.type === 'email' || draft.type === 'both') && (
                  <div>
                    <label className="block text-xs text-gray-500 mb-1.5">Subject (email)</label>
                    <input
                      type="text"
                      value={draft.subject}
                      onChange={e => setDraft(d => ({ ...d, subject: e.target.value }))}
                      placeholder="Subject line…"
                      className="input-field w-full text-sm"
                    />
                  </div>
                )}
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs text-gray-500">Message Body *</label>
                </div>
                {/* Placeholder chips */}
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {PLACEHOLDERS.map(p => (
                    <button
                      key={p.token}
                      type="button"
                      onClick={() => insertPlaceholder(p.token)}
                      className="text-xs bg-gray-800 text-indigo-300 border border-gray-700 hover:border-indigo-500 px-2 py-0.5 rounded-full font-mono transition-colors"
                      title={`Insert ${p.desc}`}
                    >
                      {p.token}
                    </button>
                  ))}
                </div>
                <textarea
                  ref={bodyRef}
                  required
                  value={draft.body}
                  onChange={e => setDraft(d => ({ ...d, body: e.target.value }))}
                  rows={7}
                  placeholder="Hi {{firstName}}, just following up…"
                  className="input-field w-full text-sm resize-none"
                />
                <p className="text-xs text-gray-600 mt-1">Click a placeholder chip above to insert it at the cursor</p>
              </div>
            </div>

            {/* Footer */}
            <div className="px-5 py-4 border-t border-gray-700 flex justify-end gap-3 shrink-0">
              <button type="button" onClick={closeModal} className="btn-secondary text-sm px-4 py-2">
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
      )}

      <ConfirmModal
        isOpen={!!confirmId}
        message="Delete this template? This cannot be undone."
        onConfirm={() => confirmId && handleDelete(confirmId)}
        onCancel={() => setConfirmId(null)}
      />
    </div>
  )
}
