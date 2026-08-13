import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { subscribeToFollowUps, setFollowUpDate, updateCustomer } from '../../services/customerService'
import { usePageTitle } from '../../hooks/usePageTitle'
import { useToast } from '../../components/Toast'
import type { CustomerItem } from '../../models/customer'

// ─── Types ────────────────────────────────────────────────────────────────────

interface SequenceStep {
  day: number       // days after sequence start
  action: 'Call' | 'SMS' | 'Email' | 'Visit' | 'Note'
  note: string
}

interface Sequence {
  id: string
  name: string
  steps: SequenceStep[]
}

interface CustomerSequenceState {
  sequenceId: string
  startDate: string   // ISO date when sequence was assigned
  stepIndex: number   // which step we're currently on
}

// ─── Local storage helpers ────────────────────────────────────────────────────

const SEQ_KEY   = 'thelight.sequences'
const STATE_KEY = 'thelight.seqstate'

function loadSequences(): Sequence[] {
  try {
    const raw = localStorage.getItem(SEQ_KEY)
    if (raw) return JSON.parse(raw)
  } catch { /* ignore */ }
  return DEFAULT_SEQUENCES
}

function saveSequences(seqs: Sequence[]) {
  localStorage.setItem(SEQ_KEY, JSON.stringify(seqs))
}

function loadStates(): Record<string, CustomerSequenceState> {
  try {
    const raw = localStorage.getItem(STATE_KEY)
    if (raw) return JSON.parse(raw)
  } catch { /* ignore */ }
  return {}
}

function saveStates(states: Record<string, CustomerSequenceState>) {
  localStorage.setItem(STATE_KEY, JSON.stringify(states))
}

// ─── Defaults ────────────────────────────────────────────────────────────────

const DEFAULT_SEQUENCES: Sequence[] = [
  {
    id: 'new-lead',
    name: 'New Lead Nurture',
    steps: [
      { day: 0,  action: 'Call',  note: 'Initial contact — introduce yourself and understand their need' },
      { day: 3,  action: 'SMS',   note: 'Quick follow-up text — did they have any questions?' },
      { day: 7,  action: 'Call',  note: 'Second call — present a quote or solution' },
      { day: 14, action: 'Email', note: 'Follow-up email with any brochures or references' },
      { day: 30, action: 'Call',  note: 'Final check-in — still interested?' },
    ],
  },
  {
    id: 'post-job',
    name: 'Post-Job Follow-up',
    steps: [
      { day: 1,  action: 'Call',  note: 'Thank them for their business — confirm satisfaction' },
      { day: 7,  action: 'SMS',   note: 'Check in — any issues or concerns?' },
      { day: 30, action: 'Call',  note: 'Request a review or referral' },
      { day: 90, action: 'Email', note: 'Seasonal maintenance reminder' },
    ],
  },
  {
    id: 'cold-re-engage',
    name: 'Cold Re-engagement',
    steps: [
      { day: 0,  action: 'Call',  note: 'Re-introduce — check if their needs have changed' },
      { day: 5,  action: 'Email', note: 'Send a special offer or updated pricing' },
      { day: 15, action: 'Call',  note: 'Final outreach attempt' },
    ],
  },
]

// ─── Helpers ─────────────────────────────────────────────────────────────────

function addDays(base: Date, days: number): Date {
  const d = new Date(base)
  d.setDate(d.getDate() + days)
  d.setHours(0, 0, 0, 0)
  return d
}

function today0() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

function fmtDate(d: Date) {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function daysDiff(a: Date, b: Date) {
  return Math.round((a.getTime() - b.getTime()) / 86_400_000)
}

function urgencyLabel(date: Date): { label: string; cls: string } {
  const diff = daysDiff(date, today0())
  if (diff < 0)  return { label: `${Math.abs(diff)}d overdue`, cls: 'text-red-400 font-semibold' }
  if (diff === 0) return { label: 'Due today',               cls: 'text-orange-400 font-semibold' }
  if (diff === 1) return { label: 'Tomorrow',                cls: 'text-yellow-400' }
  return { label: `In ${diff} days`,                         cls: 'text-gray-400' }
}

const ACTION_ICONS: Record<SequenceStep['action'], string> = {
  Call: '📞', SMS: '💬', Email: '✉️', Visit: '🚗', Note: '📝',
}

const ACTION_COLORS: Record<SequenceStep['action'], string> = {
  Call:  'bg-blue-900/40 text-blue-300 border-blue-700/30',
  SMS:   'bg-green-900/40 text-green-300 border-green-700/30',
  Email: 'bg-indigo-900/40 text-indigo-300 border-indigo-700/30',
  Visit: 'bg-orange-900/40 text-orange-300 border-orange-700/30',
  Note:  'bg-gray-800 text-gray-300 border-gray-700',
}

function genId() { return Math.random().toString(36).slice(2, 10) }

// ─── Main page ────────────────────────────────────────────────────────────────

type Tab = 'queue' | 'sequences'

export default function FollowUpsPage() {
  usePageTitle('Follow-up Sequences')
  const toast = useToast()

  const [tab, setTab] = useState<Tab>('queue')
  const [customers, setCustomers] = useState<CustomerItem[]>([])
  const [loading, setLoading]     = useState(true)
  const [sequences, setSequences] = useState<Sequence[]>(() => loadSequences())
  const [seqStates, setSeqStates] = useState<Record<string, CustomerSequenceState>>(() => loadStates())

  // Sequence editor state
  const [editingSeq, setEditingSeq] = useState<Sequence | null>(null)
  const [editName, setEditName]     = useState('')
  const [editSteps, setEditSteps]   = useState<SequenceStep[]>([])

  // Assign sequence modal
  const [assignTarget, setAssignTarget] = useState<CustomerItem | null>(null)
  const [assignSeqId, setAssignSeqId]   = useState('')

  // Expanded customer card
  const [expandedId, setExpandedId] = useState<string | null>(null)

  // Filter
  const [filter, setFilter] = useState<'all' | 'overdue' | 'today' | 'upcoming'>('all')

  useEffect(() => {
    const unsub = subscribeToFollowUps(
      list => { setCustomers(list); setLoading(false) },
      ()   => setLoading(false),
    )
    return unsub
  }, [])

  // Persist sequences
  useEffect(() => { saveSequences(sequences) }, [sequences])
  useEffect(() => { saveStates(seqStates) }, [seqStates])

  // Segment customers by urgency
  const { overdue, dueToday, upcoming } = useMemo(() => {
    const t = today0()
    const overdue:  CustomerItem[] = []
    const dueToday: CustomerItem[] = []
    const upcoming: CustomerItem[] = []
    customers.forEach(c => {
      if (!c.followUpDate) return
      const diff = daysDiff(c.followUpDate, t)
      if (diff < 0)      overdue.push(c)
      else if (diff === 0) dueToday.push(c)
      else               upcoming.push(c)
    })
    return { overdue, dueToday, upcoming }
  }, [customers])

  const visibleCustomers = useMemo(() => {
    if (filter === 'overdue')  return overdue
    if (filter === 'today')    return dueToday
    if (filter === 'upcoming') return upcoming
    return [...overdue, ...dueToday, ...upcoming]
  }, [filter, overdue, dueToday, upcoming])

  // ── Sequence assignment ───────────────────────────────────────────────────

  function openAssign(c: CustomerItem) {
    setAssignTarget(c)
    setAssignSeqId(sequences[0]?.id ?? '')
  }

  async function confirmAssign() {
    if (!assignTarget || !assignSeqId) return
    const seq = sequences.find(s => s.id === assignSeqId)
    if (!seq || seq.steps.length === 0) return

    const start = today0()
    const firstStep = seq.steps[0]
    const firstDate = addDays(start, firstStep.day)

    const newState: CustomerSequenceState = {
      sequenceId: assignSeqId,
      startDate: start.toISOString(),
      stepIndex: 0,
    }

    setSeqStates(prev => ({ ...prev, [assignTarget.id]: newState }))

    try {
      await setFollowUpDate(assignTarget.id, firstDate)
      toast(`Sequence "${seq.name}" assigned to ${assignTarget.first} ${assignTarget.lastname}`, 'success')
    } catch {
      toast('Could not set follow-up date', 'error')
    }
    setAssignTarget(null)
  }

  // ── Step completion ───────────────────────────────────────────────────────

  async function completeStep(c: CustomerItem) {
    const state = seqStates[c.id]
    const seq   = state ? sequences.find(s => s.id === state.sequenceId) : null

    if (!seq || !state) {
      // No sequence — just clear the follow-up date
      await setFollowUpDate(c.id, null)
      toast('Follow-up marked done', 'success')
      return
    }

    const nextIdx = state.stepIndex + 1
    if (nextIdx >= seq.steps.length) {
      // Sequence complete
      setSeqStates(prev => {
        const n = { ...prev }
        delete n[c.id]
        return n
      })
      await setFollowUpDate(c.id, null)
      toast(`Sequence "${seq.name}" completed for ${c.first} ${c.lastname}!`, 'success')
      return
    }

    // Advance to next step
    const nextStep = seq.steps[nextIdx]
    const base = new Date(state.startDate)
    const nextDate = addDays(base, nextStep.day)

    setSeqStates(prev => ({
      ...prev,
      [c.id]: { ...state, stepIndex: nextIdx },
    }))
    await setFollowUpDate(c.id, nextDate)
    toast(`Step ${nextIdx + 1}/${seq.steps.length} — next: ${nextStep.action} on ${fmtDate(nextDate)}`, 'success')
  }

  async function snooze(c: CustomerItem, days: number) {
    const d = addDays(today0(), days)
    await setFollowUpDate(c.id, d)
    toast(`Snoozed to ${fmtDate(d)}`, 'success')
  }

  async function clearFollowUp(c: CustomerItem) {
    setSeqStates(prev => {
      const n = { ...prev }
      delete n[c.id]
      return n
    })
    await setFollowUpDate(c.id, null)
    toast('Follow-up cleared', 'success')
  }

  async function addNote(c: CustomerItem, text: string) {
    if (!text.trim()) return
    const header = `--- [${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}] ---`
    const existing = c.comments?.trim() ?? ''
    const newComments = existing ? `${header}\n${text}\n\n${existing}` : `${header}\n${text}`
    await updateCustomer(c.id, { ...c, comments: newComments })
    toast('Note saved', 'success')
  }

  // ── Sequence editor ───────────────────────────────────────────────────────

  function openNewSeq() {
    setEditingSeq({ id: genId(), name: '', steps: [{ day: 0, action: 'Call', note: '' }] })
    setEditName('')
    setEditSteps([{ day: 0, action: 'Call', note: '' }])
  }

  function openEditSeq(seq: Sequence) {
    setEditingSeq(seq)
    setEditName(seq.name)
    setEditSteps(seq.steps.map(s => ({ ...s })))
  }

  function saveSeq() {
    if (!editingSeq || !editName.trim()) return
    const updated: Sequence = { ...editingSeq, name: editName.trim(), steps: editSteps }
    setSequences(prev => {
      const idx = prev.findIndex(s => s.id === editingSeq.id)
      if (idx >= 0) { const n = [...prev]; n[idx] = updated; return n }
      return [...prev, updated]
    })
    setEditingSeq(null)
  }

  function deleteSeq(id: string) {
    setSequences(prev => prev.filter(s => s.id !== id))
  }

  function addStep() {
    const last = editSteps[editSteps.length - 1]
    setEditSteps(prev => [...prev, { day: (last?.day ?? 0) + 7, action: 'Call', note: '' }])
  }

  function removeStep(i: number) {
    setEditSteps(prev => prev.filter((_, idx) => idx !== i))
  }

  function updateStep(i: number, patch: Partial<SequenceStep>) {
    setEditSteps(prev => prev.map((s, idx) => idx === i ? { ...s, ...patch } : s))
  }

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-white">Follow-up Sequences</h1>
          <p className="text-sm text-gray-400 mt-0.5">Automate your outreach cadence</p>
        </div>
        {tab === 'sequences' && (
          <button onClick={openNewSeq} className="btn-primary text-sm px-4 py-2">
            + New Sequence
          </button>
        )}
      </div>

      {/* Tab bar */}
      <div className="flex rounded-xl overflow-hidden border border-gray-700 text-sm w-fit">
        {(['queue', 'sequences'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-5 py-2 font-medium capitalize transition-colors ${tab === t ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-gray-100'}`}
          >
            {t === 'queue' ? `Queue (${customers.length})` : 'Sequences'}
          </button>
        ))}
      </div>

      {/* ── QUEUE TAB ── */}
      {tab === 'queue' && (
        <div className="space-y-4">

          {/* KPI + filter chips */}
          <div className="flex flex-wrap gap-2">
            {([
              { key: 'all',      label: `All (${customers.length})`,      cls: 'border-gray-600' },
              { key: 'overdue',  label: `Overdue (${overdue.length})`,    cls: 'border-red-700/60' },
              { key: 'today',    label: `Today (${dueToday.length})`,     cls: 'border-orange-700/60' },
              { key: 'upcoming', label: `Upcoming (${upcoming.length})`,  cls: 'border-indigo-700/60' },
            ] as const).map(({ key, label, cls }) => (
              <button
                key={key}
                onClick={() => setFilter(key)}
                className={`px-3 py-1.5 rounded-full text-sm border transition-colors font-medium ${
                  filter === key
                    ? 'bg-indigo-600 border-indigo-500 text-white'
                    : `${cls} text-gray-300 hover:text-white`
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {loading && (
            <div className="flex items-center justify-center py-12">
              <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
            </div>
          )}

          {!loading && visibleCustomers.length === 0 && (
            <div className="card p-10 text-center">
              <p className="text-4xl mb-3">🎉</p>
              <p className="text-gray-300 font-semibold">All caught up!</p>
              <p className="text-gray-500 text-sm mt-1">No follow-ups in this category.</p>
            </div>
          )}

          {visibleCustomers.map(c => {
            const state = seqStates[c.id]
            const seq   = state ? sequences.find(s => s.id === state.sequenceId) : null
            const step  = seq ? seq.steps[state!.stepIndex] : null
            const isExpanded = expandedId === c.id
            const urg = c.followUpDate ? urgencyLabel(c.followUpDate) : null

            return (
              <div key={c.id} className="card overflow-hidden">
                {/* Row */}
                <div
                  className="px-4 py-3 flex items-center gap-3 cursor-pointer hover:bg-gray-800/40 transition-colors"
                  onClick={() => setExpandedId(isExpanded ? null : c.id)}
                >
                  {/* Avatar */}
                  <div className="w-9 h-9 rounded-full bg-indigo-700/40 flex items-center justify-center text-sm font-bold text-indigo-300 shrink-0">
                    {(c.first[0] ?? c.lastname[0] ?? '?').toUpperCase()}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Link
                        to={`/records/${c.id}`}
                        onClick={e => e.stopPropagation()}
                        className="font-semibold text-white hover:text-indigo-300 transition-colors"
                      >
                        {c.first} {c.lastname}
                      </Link>
                      {seq && step && (
                        <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${ACTION_COLORS[step.action]}`}>
                          {ACTION_ICONS[step.action]} {step.action} — Step {(state!.stepIndex + 1)}/{seq.steps.length}
                        </span>
                      )}
                      {!seq && (
                        <span className="text-xs px-2 py-0.5 rounded-full border border-gray-700 text-gray-400">
                          No sequence
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-0.5 text-xs text-gray-500 flex-wrap">
                      {c.followUpDate && <span className={urg?.cls}>{urg?.label}</span>}
                      {c.followUpDate && <span>{fmtDate(c.followUpDate)}</span>}
                      {c.city && <span>{c.city}{c.state ? `, ${c.state}` : ''}</span>}
                      {c.salesman && <span>Rep: {c.salesman}</span>}
                    </div>
                  </div>

                  <svg
                    className={`w-4 h-4 text-gray-500 shrink-0 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                    fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="m19 9-7 7-7-7" />
                  </svg>
                </div>

                {/* Expanded panel */}
                {isExpanded && (
                  <ExpandedPanel
                    customer={c}
                    sequence={seq ?? null}
                    state={state ?? null}
                    step={step ?? null}
                    sequences={sequences}
                    onAssign={() => openAssign(c)}
                    onComplete={() => completeStep(c)}
                    onSnooze={(d) => snooze(c, d)}
                    onClear={() => clearFollowUp(c)}
                    onNote={(t) => addNote(c, t)}
                  />
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* ── SEQUENCES TAB ── */}
      {tab === 'sequences' && (
        <div className="space-y-3">
          {sequences.map(seq => (
            <div key={seq.id} className="card p-4">
              <div className="flex items-start justify-between gap-3 mb-3">
                <div>
                  <p className="font-semibold text-white">{seq.name}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{seq.steps.length} steps · {seq.steps[seq.steps.length - 1]?.day ?? 0} days total</p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button onClick={() => openEditSeq(seq)} className="text-xs text-indigo-400 hover:text-indigo-300">Edit</button>
                  <button onClick={() => deleteSeq(seq.id)} className="text-xs text-red-400 hover:text-red-300">Delete</button>
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                {seq.steps.map((step, i) => (
                  <div key={i} className="flex items-start gap-2.5">
                    <div className="flex flex-col items-center">
                      <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs border ${ACTION_COLORS[step.action]}`}>
                        {ACTION_ICONS[step.action]}
                      </div>
                      {i < seq.steps.length - 1 && <div className="w-px h-4 bg-gray-700 mt-0.5" />}
                    </div>
                    <div className="pb-1">
                      <p className="text-sm font-medium text-gray-200">
                        Day {step.day} — {step.action}
                      </p>
                      {step.note && <p className="text-xs text-gray-500 mt-0.5">{step.note}</p>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
          {sequences.length === 0 && (
            <div className="card p-10 text-center">
              <p className="text-gray-400">No sequences yet. Click "New Sequence" to create one.</p>
            </div>
          )}
        </div>
      )}

      {/* ── Assign sequence modal ── */}
      {assignTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60" onClick={() => setAssignTarget(null)} />
          <div className="relative bg-gray-900 border border-gray-700 rounded-2xl p-6 w-full max-w-sm shadow-xl mx-4">
            <p className="font-semibold text-white mb-4">
              Assign sequence to {assignTarget.first} {assignTarget.lastname}
            </p>
            <select
              value={assignSeqId}
              onChange={e => setAssignSeqId(e.target.value)}
              className="input-field text-sm w-full mb-4"
            >
              {sequences.map(s => (
                <option key={s.id} value={s.id}>{s.name} ({s.steps.length} steps)</option>
              ))}
            </select>
            {assignSeqId && (() => {
              const seq = sequences.find(s => s.id === assignSeqId)
              return seq ? (
                <div className="mb-4 space-y-1">
                  {seq.steps.map((step, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs text-gray-400">
                      <span className="font-mono w-10 text-right text-gray-500">Day {step.day}</span>
                      <span className={`px-1.5 py-0.5 rounded border ${ACTION_COLORS[step.action]}`}>{ACTION_ICONS[step.action]} {step.action}</span>
                      <span className="truncate">{step.note}</span>
                    </div>
                  ))}
                </div>
              ) : null
            })()}
            <div className="flex gap-2">
              <button onClick={() => setAssignTarget(null)} className="btn-secondary flex-1 text-sm">Cancel</button>
              <button onClick={confirmAssign} className="btn-primary flex-1 text-sm">Assign</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Sequence editor modal ── */}
      {editingSeq && (
        <div className="fixed inset-0 z-50 overflow-y-auto flex items-start justify-center py-8 px-4">
          <div className="absolute inset-0 bg-black/70" onClick={() => setEditingSeq(null)} />
          <div className="relative bg-gray-900 border border-gray-700 rounded-2xl p-6 w-full max-w-lg shadow-2xl">
            <p className="text-lg font-semibold text-white mb-4">
              {sequences.find(s => s.id === editingSeq.id) ? 'Edit' : 'New'} Sequence
            </p>

            <label className="block text-xs font-semibold text-gray-400 mb-1">Sequence Name</label>
            <input
              type="text"
              value={editName}
              onChange={e => setEditName(e.target.value)}
              placeholder="e.g. New Lead Nurture"
              className="input-field text-sm w-full mb-4"
            />

            <label className="block text-xs font-semibold text-gray-400 mb-2">Steps</label>
            <div className="space-y-3 mb-3">
              {editSteps.map((step, i) => (
                <div key={i} className="border border-gray-700 rounded-xl p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500 font-semibold w-5">{i + 1}</span>
                    <div className="flex gap-2 flex-1">
                      <div className="flex items-center gap-1">
                        <label className="text-xs text-gray-400">Day</label>
                        <input
                          type="number"
                          min={0}
                          value={step.day}
                          onChange={e => updateStep(i, { day: parseInt(e.target.value) || 0 })}
                          className="input-field text-sm py-1 w-16"
                        />
                      </div>
                      <select
                        value={step.action}
                        onChange={e => updateStep(i, { action: e.target.value as SequenceStep['action'] })}
                        className="input-field text-sm py-1 flex-1"
                      >
                        {(['Call', 'SMS', 'Email', 'Visit', 'Note'] as const).map(a => (
                          <option key={a} value={a}>{ACTION_ICONS[a]} {a}</option>
                        ))}
                      </select>
                    </div>
                    <button
                      onClick={() => removeStep(i)}
                      className="text-gray-500 hover:text-red-400 transition-colors ml-1"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                  <input
                    type="text"
                    value={step.note}
                    onChange={e => updateStep(i, { note: e.target.value })}
                    placeholder="Step note / instructions..."
                    className="input-field text-xs py-1.5 w-full"
                  />
                </div>
              ))}
            </div>

            <button onClick={addStep} className="text-sm text-indigo-400 hover:text-indigo-300 mb-5">
              + Add Step
            </button>

            <div className="flex gap-2">
              <button onClick={() => setEditingSeq(null)} className="btn-secondary flex-1 text-sm">Cancel</button>
              <button onClick={saveSeq} disabled={!editName.trim() || editSteps.length === 0} className="btn-primary flex-1 text-sm">Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Expanded customer panel ──────────────────────────────────────────────────

function ExpandedPanel({
  customer, sequence, state, step, sequences,
  onAssign, onComplete, onSnooze, onClear, onNote,
}: {
  customer: CustomerItem
  sequence: Sequence | null
  state: CustomerSequenceState | null
  step: SequenceStep | null
  sequences: Sequence[]
  onAssign: () => void
  onComplete: () => void
  onSnooze: (days: number) => void
  onClear: () => void
  onNote: (text: string) => void
}) {
  const [noteText, setNoteText] = useState('')

  async function handleNote() {
    if (!noteText.trim()) return
    await onNote(noteText)
    setNoteText('')
  }

  const stepLabel = sequence && state
    ? `Step ${state.stepIndex + 1}/${sequence.steps.length}: ${step?.action}`
    : null

  return (
    <div className="border-t border-gray-700/50 bg-gray-800/20 px-4 py-4 space-y-4">

      {/* Current step info */}
      {sequence && step ? (
        <div className="rounded-xl border border-gray-700 p-3 bg-gray-800/40">
          <div className="flex items-center gap-2 mb-1">
            <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${ACTION_COLORS[step.action]}`}>
              {ACTION_ICONS[step.action]} {stepLabel}
            </span>
            <span className="text-xs text-gray-500">from sequence "{sequence.name}"</span>
          </div>
          {step.note && <p className="text-sm text-gray-300 mt-1">{step.note}</p>}
        </div>
      ) : (
        <p className="text-sm text-gray-500 italic">
          {sequences.length > 0 ? 'No sequence assigned — manual follow-up.' : 'No sequences defined.'}
        </p>
      )}

      {/* Contact quick-actions */}
      <div className="flex flex-wrap gap-2">
        {customer.phone && (
          <a href={`tel:${customer.phone}`} className="text-xs px-3 py-1.5 rounded-xl bg-blue-900/30 text-blue-300 border border-blue-700/30 hover:bg-blue-900/50 transition-colors">
            📞 Call
          </a>
        )}
        {customer.phone && (
          <a href={`sms:${customer.phone}`} className="text-xs px-3 py-1.5 rounded-xl bg-green-900/30 text-green-300 border border-green-700/30 hover:bg-green-900/50 transition-colors">
            💬 SMS
          </a>
        )}
        {customer.email && (
          <a href={`mailto:${customer.email}`} className="text-xs px-3 py-1.5 rounded-xl bg-indigo-900/30 text-indigo-300 border border-indigo-700/30 hover:bg-indigo-900/50 transition-colors">
            ✉️ Email
          </a>
        )}
        <Link to={`/records/${customer.id}`} className="text-xs px-3 py-1.5 rounded-xl bg-gray-800 text-gray-300 border border-gray-700 hover:bg-gray-700 transition-colors">
          View Record →
        </Link>
      </div>

      {/* Action buttons */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={onComplete}
          className="text-sm px-4 py-1.5 rounded-xl bg-green-600/20 text-green-400 border border-green-700/30 hover:bg-green-600/30 transition-colors font-medium"
        >
          ✓ {sequence ? 'Complete Step' : 'Mark Done'}
        </button>
        <button
          onClick={onAssign}
          className="text-sm px-3 py-1.5 rounded-xl bg-indigo-600/20 text-indigo-300 border border-indigo-700/30 hover:bg-indigo-600/30 transition-colors"
        >
          {sequence ? '↺ Change Sequence' : '+ Assign Sequence'}
        </button>
        <div className="relative group">
          <button className="text-sm px-3 py-1.5 rounded-xl bg-gray-800 text-gray-300 border border-gray-700 hover:bg-gray-700 transition-colors">
            ⏰ Snooze
          </button>
          <div className="absolute bottom-full left-0 mb-1 hidden group-hover:flex flex-col bg-gray-800 border border-gray-700 rounded-xl overflow-hidden shadow-xl z-10 min-w-[110px]">
            {[1, 3, 7, 14].map(d => (
              <button
                key={d}
                onClick={() => onSnooze(d)}
                className="px-4 py-2 text-xs text-gray-300 hover:bg-gray-700 text-left"
              >
                {d} day{d > 1 ? 's' : ''}
              </button>
            ))}
          </div>
        </div>
        <button
          onClick={onClear}
          className="text-sm px-3 py-1.5 rounded-xl bg-gray-800 text-gray-400 border border-gray-700 hover:text-red-400 hover:border-red-700/40 transition-colors"
        >
          Clear
        </button>
      </div>

      {/* Quick note */}
      <div className="flex gap-2">
        <input
          type="text"
          value={noteText}
          onChange={e => setNoteText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleNote() }}
          placeholder="Add a quick note to this record..."
          className="input-field text-sm py-1.5 flex-1"
        />
        <button
          onClick={handleNote}
          disabled={!noteText.trim()}
          className="btn-secondary text-sm px-3 disabled:opacity-40"
        >
          Save
        </button>
      </div>
    </div>
  )
}
