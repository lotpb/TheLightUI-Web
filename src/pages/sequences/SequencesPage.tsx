import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  subscribeToSequences, subscribeToCompanyEnrollments, createSequence, updateSequence,
  deleteSequence, pauseEnrollment, resumeEnrollment, cancelEnrollment, ENROLLMENT_LIMIT,
} from '../../services/sequenceService'
import {
  ACTION_LABELS, STARTER_SEQUENCES, duplicateStepDays, enrollmentStatusMeta, lastStepDay,
  sortStepsByDay, stepsOutOfOrder, usageBySequence, EMPTY_USAGE,
  type Sequence, type SequenceAction, type SequenceEnrollment, type SequenceStep,
} from '../../models/sequence'
import { relativeTime } from '../../utils/relativeTime'
import { useToast } from '../../components/Toast'
import { usePageTitle } from '../../hooks/usePageTitle'
import ConfirmModal from '../../components/ConfirmModal'
import CollapsibleSection from '../../components/CollapsibleSection'
import { Icon, ICONS } from '../../components/Icon'

const EMPTY_STEP: SequenceStep = { delayDays: 3, action: 'note', message: '' }

const EMPTY_SEQ = { name: '', description: '', steps: [{ ...EMPTY_STEP }] }

function plural(n: number, word: string) { return `${n} ${word}${n !== 1 ? 's' : ''}` }

function fmtDate(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function SequencesPage() {
  usePageTitle('Sequences')
  const toast = useToast()

  const [sequences, setSequences] = useState<Sequence[]>([])
  const [enrollments, setEnrollments] = useState<SequenceEnrollment[]>([])
  const [enrollmentsCapped, setEnrollmentsCapped] = useState(false)
  const [loading, setLoading]     = useState(true)
  // A failed subscription used to clear the loading flag and nothing else, so
  // a missing index or a rules change rendered "No sequences yet" with a
  // Create button — indistinguishable from a fresh account. The page's own
  // comment described exactly this and left it in place.
  const [error, setError]         = useState<string | null>(null)
  const [editId, setEditId]       = useState<string | null>(null)
  const [draft, setDraft]         = useState({ ...EMPTY_SEQ, steps: [{ ...EMPTY_STEP }] })
  const [saving, setSaving]       = useState(false)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [showExamples, setShowExamples] = useState(false)

  useEffect(() => {
    return subscribeToSequences(
      ss => { setSequences(ss); setError(null); setLoading(false) },
      err => {
        console.error('[SequencesPage] sequences subscription failed:', err)
        setError(err.message || 'Could not load sequences.')
        setLoading(false)
      },
    )
  }, [])

  useEffect(() => subscribeToCompanyEnrollments(
    (items, capped) => { setEnrollments(items); setEnrollmentsCapped(capped) },
    err => console.error('[SequencesPage] enrollments subscription failed:', err),
  ), [])

  const usage = useMemo(() => usageBySequence(enrollments), [enrollments])
  const liveEnrollments = useMemo(
    () => enrollments.filter(e => e.status === 'active' || e.status === 'paused'),
    [enrollments],
  )
  const doneEnrollments = useMemo(
    () => enrollments.filter(e => e.status === 'completed' || e.status === 'cancelled'),
    [enrollments],
  )

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

  /** Swaps a step with its neighbour, so fixing the order doesn't mean
   *  retyping every day value. */
  function moveStep(i: number, dir: -1 | 1) {
    setDraft(d => {
      const j = i + dir
      if (j < 0 || j >= d.steps.length) return d
      const steps = [...d.steps]
      ;[steps[i], steps[j]] = [steps[j], steps[i]]
      return { ...d, steps }
    })
  }

  function sortDraftSteps() {
    setDraft(d => ({ ...d, steps: sortStepsByDay(d.steps) }))
  }

  const outOfOrder = stepsOutOfOrder(draft.steps)
  const duplicateDays = duplicateStepDays(draft.steps)

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

  const deleteTarget = sequences.find(s => s.id === confirmId) ?? null
  const deleteLive = deleteTarget ? (usage[deleteTarget.id] ?? EMPTY_USAGE).live : 0

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-white">Sequences</h1>
          {/* Was "Automated follow-up drip campaigns for leads & customers".
              The only two actions are Add Note and Set Follow-Up — nothing is
              sent to anyone — and "drip campaign" means outbound messaging to
              everyone who has heard the phrase. */}
          <p className="text-sm text-gray-400 mt-0.5">
            Scheduled internal follow-up steps — notes and follow-up dates on the record, not messages to the customer
          </p>
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
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">Start from an example</p>
          <div className="grid sm:grid-cols-2 gap-3">
            {STARTER_SEQUENCES.map(ex => (
              <button
                key={ex.name}
                onClick={() => openFromExample(ex)}
                className="card p-3 border-gray-600 hover:border-indigo-500 transition-colors text-left"
              >
                <p className="font-medium text-white text-sm mb-0.5">{ex.name}</p>
                <p className="text-xs text-gray-400 mb-2">{ex.description}</p>
                <p className="text-xs text-gray-400">
                  {plural(ex.steps.length, 'step')} · ends day {lastStepDay(ex.steps)}
                </p>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* A load failure is a load failure, not an empty account. */}
      {error && (
        <div className="bg-red-900/30 border border-red-700/50 rounded-xl px-4 py-3 mb-6">
          <p className="text-sm text-red-300 font-medium">Could not load sequences</p>
          <p className="text-xs text-red-300/90 mt-1">{error}</p>
          <p className="text-xs text-red-300/90 mt-1">
            This query needs a <span className="font-mono">companyId + createdAt</span> composite index on{' '}
            <span className="font-mono">sequences</span>. Existing sequences are not lost.
          </p>
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          {[1, 2].map(i => <div key={i} className="card p-4 h-24 animate-pulse bg-gray-800" />)}
        </div>
      ) : error ? null : sequences.length === 0 ? (
        <div className="card p-12 text-center">
          <Icon d={ICONS.refresh} className="w-10 h-10 mx-auto text-gray-400 mb-3" />
          <p className="text-gray-100 font-medium mb-1">No sequences yet</p>
          <p className="text-sm text-gray-400 mb-4">
            Define steps with day offsets, then enrol leads and customers from their record page
          </p>
          <button onClick={openNew} className="btn-primary text-sm px-4 py-2">Create first sequence</button>
        </div>
      ) : (
        <div className="space-y-3">
          {sequences.map(s => {
            const u = usage[s.id] ?? EMPTY_USAGE
            const unordered = stepsOutOfOrder(s.steps)
            return (
              <div key={s.id} className="card p-4">
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-white">{s.name}</p>
                    {s.description && <p className="text-sm text-gray-400 mt-0.5">{s.description}</p>}
                    {/* How many people are actually in this. */}
                    <div className="flex items-center gap-2 flex-wrap mt-1.5">
                      {u.active > 0 && (
                        <span className="text-xs bg-green-500/20 text-green-300 px-2 py-0.5 rounded-full">
                          {u.active} active
                        </span>
                      )}
                      {u.paused > 0 && (
                        <span className="text-xs bg-amber-500/20 text-amber-300 px-2 py-0.5 rounded-full">
                          {u.paused} paused
                        </span>
                      )}
                      {u.completed > 0 && (
                        <span className="text-xs text-gray-400">{u.completed} completed</span>
                      )}
                      {u.live === 0 && u.completed === 0 && (
                        <span className="text-xs text-gray-400">Nobody enrolled</span>
                      )}
                      {/* The editor now blocks this, but a sequence saved
                          before it could still be out of order. */}
                      {unordered && (
                        <span
                          title="Day numbers are absolute offsets from enrollment, and steps run in list order — so a step whose day has passed fires on the next run."
                          className="text-xs bg-amber-500/20 text-amber-300 px-2 py-0.5 rounded-full cursor-help"
                        >
                          Steps out of order
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <button
                      onClick={() => openEdit(s)}
                      className="text-xs text-indigo-400 hover:text-indigo-300 px-2 py-1 rounded hover:bg-gray-700 transition-colors"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => setConfirmId(s.id)}
                      aria-label={`Delete ${s.name}`}
                      className="text-xs text-gray-400 hover:text-red-400 px-2 py-1 rounded hover:bg-gray-700 transition-colors"
                    >
                      Delete
                    </button>
                  </div>
                </div>
                <div className="flex items-center gap-2 overflow-x-auto pb-1">
                  {s.steps.map((step, i) => (
                    <div key={i} className="flex items-center gap-2 shrink-0">
                      {/* Was text-gray-600 at 1.94:1. */}
                      {i > 0 && (
                        <Icon d={ICONS.arrowRight} className="w-4 h-4 text-gray-400 shrink-0" />
                      )}
                      {/* Was bg-gray-800 on a bg-gray-800 card — 1.000:1, the
                          whole timeline resting on a 1.42:1 border. */}
                      <div className="bg-gray-900 border border-gray-500 rounded-lg px-3 py-1.5 text-xs whitespace-nowrap">
                        <span className="text-indigo-400 font-medium">Day {step.delayDays}</span>
                        <span className="text-gray-400 mx-1">·</span>
                        <span className="text-gray-200">{ACTION_LABELS[step.action]}</span>
                      </div>
                    </div>
                  ))}
                  <span className="text-xs text-gray-400 shrink-0 ml-1">
                    {plural(s.steps.length, 'step')} · ends day {lastStepDay(s.steps)}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Enrollments. SequenceEnrollment was fully modelled — status,
          nextStepIdx, nextRunAt, customerName — and only a per-customer query
          existed, so this page could show templates and nothing else. */}
      {!loading && !error && enrollments.length > 0 && (
        <section className="mt-6 space-y-3">
          {enrollmentsCapped && (
            <div className="bg-yellow-900/20 border border-yellow-600/40 rounded-xl px-4 py-3 text-yellow-300 text-sm">
              <span className="flex items-start gap-2">
                <Icon d={ICONS.warning} className="w-4 h-4 shrink-0 mt-0.5" />
                <span>Showing the most recent {ENROLLMENT_LIMIT} enrollments only — the counts above are understated.</span>
              </span>
            </div>
          )}

          {liveEnrollments.length > 0 && (
            <CollapsibleSection title="In progress" count={liveEnrollments.length} defaultOpen>
              <div className="card divide-y divide-gray-700/50">
                {liveEnrollments.map(e => (
                  <EnrollmentRow
                    key={e.id}
                    enrollment={e}
                    sequence={sequences.find(s => s.id === e.sequenceId) ?? null}
                    onPause={async () => {
                      try { await pauseEnrollment(e.id) } catch { toast('Could not pause', 'error') }
                    }}
                    onResume={async () => {
                      const seq = sequences.find(s => s.id === e.sequenceId)
                      try { await resumeEnrollment(e.id, seq?.steps ?? [], e.nextStepIdx, e.startedAt) }
                      catch { toast('Could not resume', 'error') }
                    }}
                    onCancel={async () => {
                      try { await cancelEnrollment(e.id) } catch { toast('Could not cancel', 'error') }
                    }}
                  />
                ))}
              </div>
            </CollapsibleSection>
          )}

          {doneEnrollments.length > 0 && (
            <CollapsibleSection title="Finished" count={doneEnrollments.length}>
              <div className="card divide-y divide-gray-700/50">
                {doneEnrollments.map(e => (
                  <EnrollmentRow
                    key={e.id}
                    enrollment={e}
                    sequence={sequences.find(s => s.id === e.sequenceId) ?? null}
                  />
                ))}
              </div>
            </CollapsibleSection>
          )}
        </section>
      )}

      {/* How it works card. Was bg-indigo-950/20, which measures 1.02:1
          against the card and has no light-mode rule in index.css — the third
          page to reach for an uncovered *-950/20 token. bg-indigo-900/20 is
          covered (index.css:391), and since neither surface can carry the
          boundary in dark mode the border does it. */}
      {!loading && !error && sequences.length > 0 && (
        <div className="mt-6 card p-4 border border-indigo-500/60 bg-indigo-900/20">
          <p className="text-xs font-semibold uppercase tracking-wider text-indigo-300 mb-2">How to use</p>
          <ol className="text-sm text-gray-300 space-y-1 list-decimal list-inside">
            <li>Open any Lead or Customer record</li>
            <li>Scroll to the <strong className="text-white">Sequences</strong> section and click <strong className="text-white">Enroll</strong></li>
            <li>Steps run once a day at 9 AM ET, on the day number counted from the enrollment date</li>
            <li>Pause, resume or cancel from the list above, or from the record page</li>
          </ol>
        </div>
      )}

      {/* Edit modal */}
      {editId && (
        <SequenceEditor
          isNew={editId === '__new__'}
          draft={draft}
          saving={saving}
          outOfOrder={outOfOrder}
          duplicateDays={duplicateDays}
          onClose={closeModal}
          onSubmit={handleSave}
          onName={name => setDraft(d => ({ ...d, name }))}
          onDescription={description => setDraft(d => ({ ...d, description }))}
          onAddStep={addStep}
          onRemoveStep={removeStep}
          onUpdateStep={updateStep}
          onMoveStep={moveStep}
          onSortSteps={sortDraftSteps}
        />
      )}

      {/* The old copy said "Active enrollments will still run until
          cancelled." runSequences cancels any enrollment whose template is
          gone — `if (!seqSnap.exists) { update({ status: 'cancelled' }) }` —
          so the dialog reassured you of the opposite of what happens. */}
      <ConfirmModal
        isOpen={!!confirmId}
        message={
          deleteLive > 0
            ? `Delete "${deleteTarget?.name}"? ${plural(deleteLive, 'enrollment')} still in progress will be cancelled automatically at the next daily run — the remaining steps won't happen.`
            : `Delete "${deleteTarget?.name}"? Nobody is currently enrolled, so nothing in progress is affected.`
        }
        confirmLabel="Delete sequence"
        onConfirm={() => confirmId && handleDelete(confirmId)}
        onCancel={() => setConfirmId(null)}
      />
    </div>
  )
}

function EnrollmentRow({ enrollment: e, sequence, onPause, onResume, onCancel }: {
  enrollment: SequenceEnrollment
  sequence: Sequence | null
  onPause?: () => void
  onResume?: () => void
  onCancel?: () => void
}) {
  const meta = enrollmentStatusMeta(e.status)
  const total = sequence?.steps.length ?? 0
  const nextStep = sequence?.steps[e.nextStepIdx] ?? null
  const done = e.completedStepIndices.length

  return (
    <div className="px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <Link
              to={`/records/${e.customerId}`}
              className="text-sm font-medium text-gray-100 hover:text-indigo-300 transition-colors truncate"
            >
              {e.customerName || 'Unnamed record'}
            </Link>
            <span className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${meta.classes}`}>{meta.label}</span>
          </div>
          <p className="text-xs text-gray-400 mt-0.5 truncate">{e.sequenceName}</p>
          <p className="text-xs text-gray-400 mt-0.5">
            {total > 0 ? `Step ${Math.min(done + 1, total)} of ${total}` : `${done} steps done`}
            {/* The template is gone, which is why the runner will cancel it. */}
            {!sequence && ' · sequence deleted'}
            {e.status === 'active' && nextStep && (
              <> · next: {ACTION_LABELS[nextStep.action]} on day {nextStep.delayDays} ({relativeTime(e.nextRunAt)})</>
            )}
            {e.status === 'paused' && ' · paused, resuming fires any overdue step at the next 9 AM run'}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <span className="text-xs text-gray-400">Started {fmtDate(e.startedAt)}</span>
          <div className="flex gap-1">
            {e.status === 'active' && onPause && (
              <button onClick={onPause} className="text-xs text-gray-400 hover:text-amber-300 px-2 py-1 rounded hover:bg-gray-700 transition-colors">
                Pause
              </button>
            )}
            {e.status === 'paused' && onResume && (
              <button onClick={onResume} className="text-xs text-gray-400 hover:text-green-300 px-2 py-1 rounded hover:bg-gray-700 transition-colors">
                Resume
              </button>
            )}
            {(e.status === 'active' || e.status === 'paused') && onCancel && (
              <button onClick={onCancel} className="text-xs text-gray-400 hover:text-red-400 px-2 py-1 rounded hover:bg-gray-700 transition-colors">
                Cancel
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function SequenceEditor({
  isNew, draft, saving, outOfOrder, duplicateDays,
  onClose, onSubmit, onName, onDescription,
  onAddStep, onRemoveStep, onUpdateStep, onMoveStep, onSortSteps,
}: {
  isNew: boolean
  draft: { name: string; description: string; steps: SequenceStep[] }
  saving: boolean
  outOfOrder: boolean
  duplicateDays: number[]
  onClose: () => void
  onSubmit: (e: React.FormEvent) => void
  onName: (v: string) => void
  onDescription: (v: string) => void
  onAddStep: () => void
  onRemoveStep: (i: number) => void
  onUpdateStep: (i: number, patch: Partial<SequenceStep>) => void
  onMoveStep: (i: number, dir: -1 | 1) => void
  onSortSteps: () => void
}) {
  // Escape closes it, the way ConfirmModal and every reader in the app do.
  // The backdrop was clickable and the keyboard had no exit at all.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-0 sm:px-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <form
        onSubmit={onSubmit}
        className="relative bg-gray-900 border border-gray-600 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-2xl shadow-2xl flex flex-col max-h-[92vh]"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700 shrink-0">
          <p className="font-semibold text-white">{isNew ? 'New Sequence' : 'Edit Sequence'}</p>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close editor"
            className="w-9 h-9 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-100 hover:bg-gray-700 transition-colors"
          >
            <Icon d={ICONS.close} className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          <div className="grid gap-4">
            <div>
              {/* The labels had no htmlFor and the inputs no id, so clicking a
                  label did nothing and a screen reader announced an
                  unlabelled field. */}
              <label htmlFor="seq-name" className="block text-xs text-gray-400 mb-1.5">Sequence Name *</label>
              <input
                id="seq-name"
                required autoFocus
                value={draft.name}
                onChange={e => onName(e.target.value)}
                placeholder="e.g. New Lead Follow-up"
                className="input-field w-full text-sm"
              />
            </div>
            <div>
              <label htmlFor="seq-description" className="block text-xs text-gray-400 mb-1.5">Description (optional)</label>
              <input
                id="seq-description"
                value={draft.description}
                onChange={e => onDescription(e.target.value)}
                placeholder="What is this sequence for?"
                className="input-field w-full text-sm"
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-3 gap-2">
              <p className="text-xs text-gray-400 uppercase tracking-wider font-semibold">Steps</p>
              <button
                type="button"
                onClick={onAddStep}
                className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
              >
                + Add Step
              </button>
            </div>

            {/* Out-of-order days silently collapse the sequence: the runner
                goes in list order and a day already past fires at the next
                9 AM run. It used to save without comment. */}
            {outOfOrder && (
              <div className="bg-amber-900/20 border border-amber-600/40 rounded-xl px-3 py-2.5 mb-3">
                <p className="text-xs text-amber-300">
                  Day numbers aren't in order. They're offsets from the enrollment date and steps run in list
                  order, so a step whose day has already passed fires on the next daily run — several steps
                  would land on consecutive mornings.
                </p>
                <button
                  type="button"
                  onClick={onSortSteps}
                  className="text-xs text-amber-200 underline hover:text-amber-100 mt-1.5"
                >
                  Sort steps by day
                </button>
              </div>
            )}
            {duplicateDays.length > 0 && (
              <p className="text-xs text-gray-400 mb-3">
                Two or more steps share day {duplicateDays.join(', ')} — they'll all fire that morning.
              </p>
            )}

            <div className="space-y-3">
              {draft.steps.map((step, i) => (
                <StepRow
                  key={i}
                  step={step}
                  index={i}
                  isFirst={i === 0}
                  isLast={i === draft.steps.length - 1}
                  canRemove={draft.steps.length > 1}
                  onChange={patch => onUpdateStep(i, patch)}
                  onRemove={() => onRemoveStep(i)}
                  onMove={dir => onMoveStep(i, dir)}
                />
              ))}
            </div>
            <p className="text-xs text-gray-400 mt-2">
              Day numbers are counted from the enrollment date. Steps run once per day at 9 AM ET.
            </p>
          </div>
        </div>

        <div className="px-5 py-4 border-t border-gray-700 flex justify-end gap-3 shrink-0">
          <button type="button" onClick={onClose} className="btn-secondary text-sm px-4 py-2">Cancel</button>
          <button
            type="submit"
            disabled={saving || !draft.name.trim() || draft.steps.length === 0}
            className="btn-primary text-sm px-5 py-2 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {saving ? 'Saving…' : isNew ? 'Create' : 'Save Changes'}
          </button>
        </div>
      </form>
    </div>
  )
}

function StepRow({
  step, index, isFirst, isLast, canRemove, onChange, onRemove, onMove,
}: {
  step: SequenceStep
  index: number
  isFirst: boolean
  isLast: boolean
  canRemove: boolean
  onChange: (patch: Partial<SequenceStep>) => void
  onRemove: () => void
  onMove: (dir: -1 | 1) => void
}) {
  return (
    <div className="bg-gray-800/60 border border-gray-600 rounded-xl p-4">
      <div className="flex items-center gap-3 mb-3">
        <span className="w-6 h-6 rounded-full bg-indigo-600/30 text-indigo-300 text-xs font-bold flex items-center justify-center shrink-0">
          {index + 1}
        </span>
        <div className="flex items-center gap-2 flex-wrap flex-1">
          <div className="flex items-center gap-1.5">
            <label htmlFor={`step-day-${index}`} className="text-xs text-gray-400">Day</label>
            <input
              id={`step-day-${index}`}
              type="number"
              min={1}
              max={365}
              value={step.delayDays}
              onChange={e => onChange({ delayDays: Math.max(1, Number(e.target.value)) })}
              className="w-14 bg-gray-900 border border-gray-600 rounded-lg px-2 py-1 text-sm text-white outline-none focus:border-indigo-500 text-center"
            />
          </div>
          <label htmlFor={`step-action-${index}`} className="sr-only">Action for step {index + 1}</label>
          <select
            id={`step-action-${index}`}
            value={step.action}
            onChange={e => onChange({ action: e.target.value as SequenceAction })}
            className="bg-gray-900 border border-gray-600 rounded-lg px-2 py-1 text-sm text-white outline-none focus:border-indigo-500"
          >
            {(Object.keys(ACTION_LABELS) as SequenceAction[]).map(a => (
              <option key={a} value={a}>{ACTION_LABELS[a]}</option>
            ))}
          </select>
        </div>
        {/* Reordering was impossible — the only way to fix the order was to
            retype every day value. And the remove control was a bare 1.94:1
            glyph with no surface. */}
        <div className="flex items-center gap-0.5 shrink-0">
          <button
            type="button"
            onClick={() => onMove(-1)}
            disabled={isFirst}
            aria-label={`Move step ${index + 1} earlier`}
            className="w-7 h-7 flex items-center justify-center rounded text-gray-400 hover:text-gray-100 hover:bg-gray-700 disabled:opacity-25 disabled:cursor-not-allowed transition-colors"
          >
            <Icon d={ICONS.arrowUp} className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onMove(1)}
            disabled={isLast}
            aria-label={`Move step ${index + 1} later`}
            className="w-7 h-7 flex items-center justify-center rounded text-gray-400 hover:text-gray-100 hover:bg-gray-700 disabled:opacity-25 disabled:cursor-not-allowed transition-colors"
          >
            <Icon d={ICONS.arrowDown} className="w-3.5 h-3.5" />
          </button>
          {canRemove && (
            <button
              type="button"
              onClick={onRemove}
              aria-label={`Remove step ${index + 1}`}
              title="Remove step"
              className="w-7 h-7 flex items-center justify-center rounded text-gray-400 hover:text-red-400 hover:bg-gray-700 transition-colors"
            >
              <Icon d={ICONS.close} className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
      <label htmlFor={`step-message-${index}`} className="sr-only">
        {step.action === 'note' ? 'Note text' : 'Follow-up label'} for step {index + 1}
      </label>
      <textarea
        id={`step-message-${index}`}
        required
        value={step.message}
        onChange={e => onChange({ message: e.target.value })}
        rows={2}
        placeholder={
          step.action === 'note'
            ? 'Note text to add to the record… e.g. "Checked in — no answer"'
            : 'Why to follow up… e.g. "Call back this week" — added to the record as a note'
        }
        className="input-field w-full text-sm resize-none"
      />
    </div>
  )
}
