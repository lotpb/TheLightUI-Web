import { useEffect, useRef, useState } from 'react'
import { subscribeToSequences, createSequence, updateSequence, deleteSequence } from '../../services/sequenceService'
import { ACTION_LABELS, STARTER_SEQUENCES, type Sequence, type SequenceAction, type SequenceStep } from '../../models/sequence'
import { useToast } from '../../components/Toast'
import { usePageTitle } from '../../hooks/usePageTitle'
import ConfirmModal from '../../components/ConfirmModal'

const EMPTY_STEP: SequenceStep = { delayDays: 3, action: 'note', message: '' }

const EMPTY_SEQ = { name: '', description: '', steps: [{ ...EMPTY_STEP }] }

function plural(n: number, word: string) { return `${n} ${word}${n !== 1 ? 's' : ''}` }

export default function SequencesPage() {
  usePageTitle('Sequences')
  const toast = useToast()

  const [sequences, setSequences] = useState<Sequence[]>([])
  const [loading, setLoading]     = useState(true)
  const [editId, setEditId]       = useState<string | null>(null)
  const [draft, setDraft]         = useState({ ...EMPTY_SEQ, steps: [{ ...EMPTY_STEP }] })
  const [saving, setSaving]       = useState(false)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [showExamples, setShowExamples] = useState(false)

  useEffect(() => {
    return subscribeToSequences(
      ss => { setSequences(ss); setLoading(false) },
      () => setLoading(false),
    )
  }, [])

  function openNew() {
    setDraft({ name: '', description: '', steps: [{ ...EMPTY_STEP }] })
    setEditId('__new__')
  }

  function openFromExample(example: typeof STARTER_SEQUENCES[number]) {
    setDraft({ name: example.name, description: example.description, steps: example.steps.map(st => ({ ...st })) })
    setEditId('__new__')
    setShowExamples(false)
  }

  function openEdit(s: Sequence) {
    setDraft({ name: s.name, description: s.description, steps: s.steps.map(st => ({ ...st })) })
    setEditId(s.id)
  }

  function closeModal() { setEditId(null); setSaving(false) }

  // Step helpers
  function addStep() {
    const last = draft.steps[draft.steps.length - 1]
    const nextDay = last ? last.delayDays + 3 : 3
    setDraft(d => ({ ...d, steps: [...d.steps, { delayDays: nextDay, action: 'note', message: '' }] }))
  }

  function removeStep(i: number) {
    setDraft(d => ({ ...d, steps: d.steps.filter((_, idx) => idx !== i) }))
  }

  function updateStep(i: number, patch: Partial<SequenceStep>) {
    setDraft(d => ({
      ...d,
      steps: d.steps.map((s, idx) => idx === i ? { ...s, ...patch } : s),
    }))
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!draft.name.trim() || draft.steps.length === 0) return
    setSaving(true)
    try {
      if (editId === '__new__') {
        await createSequence(draft)
        toast('Sequence created', 'success')
      } else if (editId) {
        await updateSequence(editId, draft)
        toast('Sequence updated', 'success')
      }
      closeModal()
    } catch {
      toast('Failed to save sequence', 'error')
      setSaving(false)
    }
  }

  async function handleDelete(id: string) {
    setConfirmId(null)
    try {
      await deleteSequence(id)
      toast('Sequence deleted', 'success')
    } catch {
      toast('Failed to delete', 'error')
    }
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Sequences</h1>
          <p className="text-sm text-gray-500 mt-0.5">Automated follow-up drip campaigns for leads & customers</p>
        </div>
        <div className="flex gap-2 shrink-0">
          <button onClick={() => setShowExamples(v => !v)} className="btn-secondary text-sm px-4 py-2">
            {showExamples ? 'Hide Examples' : 'Examples'}
          </button>
          <button onClick={openNew} className="btn-primary text-sm px-4 py-2">+ New Sequence</button>
        </div>
      </div>

      {showExamples && (
        <div className="card p-4 mb-6">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-3">Start from an example</p>
          <div className="grid sm:grid-cols-2 gap-3">
            {STARTER_SEQUENCES.map(ex => (
              <button
                key={ex.name}
                onClick={() => openFromExample(ex)}
                className="card p-3 hover:border-indigo-500 transition-colors text-left"
              >
                <p className="font-medium text-white text-sm mb-0.5">{ex.name}</p>
                <p className="text-xs text-gray-500 mb-2">{ex.description}</p>
                <p className="text-xs text-gray-600">
                  {plural(ex.steps.length, 'step')} · ends day {Math.max(...ex.steps.map(st => st.delayDays))}
                </p>
              </button>
            ))}
          </div>
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          {[1, 2].map(i => <div key={i} className="card p-4 h-24 animate-pulse bg-gray-800" />)}
        </div>
      ) : sequences.length === 0 ? (
        <div className="card p-12 text-center">
          <p className="text-4xl mb-3">🔁</p>
          <p className="text-gray-300 font-medium mb-1">No sequences yet</p>
          <p className="text-sm text-gray-500 mb-4">
            Build a drip: define steps with delays, then enroll leads and customers from their record page
          </p>
          <button onClick={openNew} className="btn-primary text-sm px-4 py-2">Create first sequence</button>
        </div>
      ) : (
        <div className="space-y-3">
          {sequences.map(s => (
            <div key={s.id} className="card p-4">
              <div className="flex items-start justify-between gap-3 mb-3">
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-white">{s.name}</p>
                  {s.description && <p className="text-sm text-gray-500 mt-0.5">{s.description}</p>}
                </div>
                <div className="flex gap-2 shrink-0">
                  <button onClick={() => openEdit(s)} className="text-xs text-indigo-400 hover:text-indigo-300 px-2 py-1 rounded hover:bg-gray-700">Edit</button>
                  <button onClick={() => setConfirmId(s.id)} className="text-xs text-gray-500 hover:text-red-400 px-2 py-1 rounded hover:bg-gray-700">Delete</button>
                </div>
              </div>
              <div className="flex items-center gap-2 overflow-x-auto pb-1">
                {s.steps.map((step, i) => (
                  <div key={i} className="flex items-center gap-2 shrink-0">
                    {i > 0 && (
                      <svg className="w-4 h-4 text-gray-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
                      </svg>
                    )}
                    <div className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-xs whitespace-nowrap">
                      <span className="text-indigo-400 font-medium">Day {step.delayDays}</span>
                      <span className="text-gray-500 mx-1">·</span>
                      <span className="text-gray-300">{ACTION_LABELS[step.action]}</span>
                    </div>
                  </div>
                ))}
                <span className="text-xs text-gray-600 shrink-0 ml-1">
                  {plural(s.steps.length, 'step')} · ends day {Math.max(...s.steps.map(st => st.delayDays))}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* How it works card */}
      {sequences.length > 0 && (
        <div className="mt-6 card p-4 border border-indigo-900/40 bg-indigo-950/20">
          <p className="text-xs font-semibold uppercase tracking-wider text-indigo-400 mb-2">How to use</p>
          <ol className="text-sm text-gray-400 space-y-1 list-decimal list-inside">
            <li>Open any Lead or Customer record</li>
            <li>Scroll to the <strong className="text-gray-300">Sequences</strong> section and click <strong className="text-gray-300">Enroll</strong></li>
            <li>Pick a sequence — it starts immediately. Steps execute automatically each day at 9 AM ET</li>
            <li>Pause or cancel any enrollment from the record page</li>
          </ol>
        </div>
      )}

      {/* Edit modal */}
      {editId && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-0 sm:px-4">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={closeModal} />
          <form
            onSubmit={handleSave}
            className="relative bg-gray-900 border border-gray-700 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-2xl shadow-2xl flex flex-col max-h-[92vh]"
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700 shrink-0">
              <p className="font-semibold text-white">{editId === '__new__' ? 'New Sequence' : 'Edit Sequence'}</p>
              <button type="button" onClick={closeModal} className="text-gray-400 hover:text-gray-200">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              {/* Name + description */}
              <div className="grid gap-4">
                <div>
                  <label className="block text-xs text-gray-500 mb-1.5">Sequence Name *</label>
                  <input
                    required autoFocus
                    value={draft.name}
                    onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
                    placeholder="e.g. New Lead Follow-up"
                    className="input-field w-full text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1.5">Description (optional)</label>
                  <input
                    value={draft.description}
                    onChange={e => setDraft(d => ({ ...d, description: e.target.value }))}
                    placeholder="What is this sequence for?"
                    className="input-field w-full text-sm"
                  />
                </div>
              </div>

              {/* Steps */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <label className="text-xs text-gray-500 uppercase tracking-wider font-semibold">Steps</label>
                  <button
                    type="button"
                    onClick={addStep}
                    className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
                  >
                    + Add Step
                  </button>
                </div>
                <div className="space-y-3">
                  {draft.steps.map((step, i) => (
                    <StepRow
                      key={i}
                      step={step}
                      index={i}
                      canRemove={draft.steps.length > 1}
                      onChange={patch => updateStep(i, patch)}
                      onRemove={() => removeStep(i)}
                    />
                  ))}
                </div>
                <p className="text-xs text-gray-600 mt-2">
                  Day numbers are relative to enrollment date. Steps run once per day at 9 AM ET.
                </p>
              </div>
            </div>

            <div className="px-5 py-4 border-t border-gray-700 flex justify-end gap-3 shrink-0">
              <button type="button" onClick={closeModal} className="btn-secondary text-sm px-4 py-2">Cancel</button>
              <button
                type="submit"
                disabled={saving || !draft.name.trim() || draft.steps.length === 0}
                className="btn-primary text-sm px-5 py-2 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {saving ? 'Saving…' : editId === '__new__' ? 'Create' : 'Save Changes'}
              </button>
            </div>
          </form>
        </div>
      )}

      <ConfirmModal
        isOpen={!!confirmId}
        message="Delete this sequence? Active enrollments will still run until cancelled."
        onConfirm={() => confirmId && handleDelete(confirmId)}
        onCancel={() => setConfirmId(null)}
      />
    </div>
  )
}

function StepRow({
  step, index, canRemove, onChange, onRemove,
}: {
  step: SequenceStep
  index: number
  canRemove: boolean
  onChange: (patch: Partial<SequenceStep>) => void
  onRemove: () => void
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  return (
    <div className="bg-gray-800/60 border border-gray-700/60 rounded-xl p-4">
      <div className="flex items-center gap-3 mb-3">
        <span className="w-6 h-6 rounded-full bg-indigo-600/30 text-indigo-300 text-xs font-bold flex items-center justify-center shrink-0">
          {index + 1}
        </span>
        <div className="flex items-center gap-2 flex-wrap flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-gray-500">Day</span>
            <input
              type="number"
              min={1}
              max={365}
              value={step.delayDays}
              onChange={e => onChange({ delayDays: Math.max(1, Number(e.target.value)) })}
              className="w-14 bg-gray-900 border border-gray-700 rounded-lg px-2 py-1 text-sm text-white outline-none focus:border-indigo-500 text-center"
            />
          </div>
          <select
            value={step.action}
            onChange={e => onChange({ action: e.target.value as SequenceAction })}
            className="bg-gray-900 border border-gray-700 rounded-lg px-2 py-1 text-sm text-white outline-none focus:border-indigo-500"
          >
            {(Object.keys(ACTION_LABELS) as SequenceAction[]).map(a => (
              <option key={a} value={a}>{ACTION_LABELS[a]}</option>
            ))}
          </select>
        </div>
        {canRemove && (
          <button type="button" onClick={onRemove} className="text-gray-600 hover:text-red-400 transition-colors shrink-0" title="Remove step">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>
      <textarea
        ref={textareaRef}
        required
        value={step.message}
        onChange={e => onChange({ message: e.target.value })}
        rows={2}
        placeholder={
          step.action === 'note'
            ? 'Note text to add to the record… e.g. "Checked in — no answer"'
            : 'Label for the follow-up date… e.g. "Call back this week"'
        }
        className="input-field w-full text-sm resize-none"
      />
    </div>
  )
}
