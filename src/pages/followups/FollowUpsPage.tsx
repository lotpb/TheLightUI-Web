import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { subscribeToFollowUps, setFollowUpDate, appendCustomerComment } from '../../services/customerService'
import { usePageTitle } from '../../hooks/usePageTitle'
import { useToast } from '../../components/Toast'
import { Icon, ICONS } from '../../components/Icon'
import { dueMetaCompact, fmtDue } from '../../utils/dueDate'
import {
  RENDER_CAP, STALE_DAYS, bucketFollowUps, emptyMessage, filteredFollowUps,
  queueChips, rowInitials, rowName,
  type QueueFilter,
} from '../../models/followUpQueue'
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

/*
 * fmtDue and dueMetaCompact come from utils/dueDate.
 *
 * This page had its own of each: a hand-rolled `['Jan','Feb',…]` lookup
 * printing "Sep 5 2026" with no comma — the same fifth date format just removed
 * from the record page — and `urgencyLabel`, computing lateness from
 * `Math.round((date - localMidnight) / 86_400_000)`. That made it the third
 * implementation of "is this late?" in the app, alongside /todo and the record
 * page, both of which now go through the shared helper.
 */

/**
 * Icons per sequence action, drawn rather than 📞 💬 ✉️ 🚗 📝.
 *
 * Emoji render from Apple Color Emoji and ignore `color`, so the glyph on a
 * blue Call pill was the same shade as the one on a green SMS pill, and none of
 * them followed light mode. Paths shared from components/Icon.
 */
const ACTION_ICONS: Record<SequenceStep['action'], string | readonly string[]> = {
  Call: ICONS.phone, SMS: ICONS.chat, Email: ICONS.envelope,
  Visit: ICONS.home, Note: ICONS.pencil,
}

/**
 * Note used `bg-gray-800`, which is what `.card` already is — a 1.000:1 fill,
 * so one pill of the five had no surface at all. All five use the tinted
 * family now, each with an explicit light-mode rule in index.css.
 */
const ACTION_COLORS: Record<SequenceStep['action'], string> = {
  Call:  'bg-blue-500/20 text-blue-300 border-blue-600/40',
  SMS:   'bg-green-500/20 text-green-300 border-green-600/40',
  Email: 'bg-indigo-500/20 text-indigo-300 border-indigo-600/40',
  Visit: 'bg-orange-500/20 text-orange-300 border-orange-600/40',
  Note:  'bg-gray-700 text-gray-200 border-gray-500',
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

  /**
   * Defaults to 'active', not 'all'.
   *
   * subscribeToFollowUps now reaches back a year rather than one day, so "all"
   * means "up to a year of history, oldest first" — which opened this page on
   * the least actionable row it has and buried today's work below it. 'active'
   * is overdue-within-a-month plus today plus upcoming; the older backlog is one
   * chip away with a count.
   */
  const [filter, setFilter] = useState<QueueFilter>('active')

  /** How many rows are rendered. Raised by the button at the end of the list. */
  const [shown, setShown] = useState(RENDER_CAP)

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

  const buckets = useMemo(() => bucketFollowUps(customers), [customers])
  const chips = useMemo(() => queueChips(buckets), [buckets])

  const matching = useMemo(() => filteredFollowUps(buckets, filter), [buckets, filter])
  const visibleCustomers = useMemo(() => matching.slice(0, shown), [matching, shown])
  const hiddenCount = matching.length - visibleCustomers.length

  // Switching filters starts the new list from the top of the cap, so changing
  // chip doesn't inherit a scroll position or a raised limit from the last one.
  useEffect(() => { setShown(RENDER_CAP); setExpandedId(null) }, [filter])

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
    toast(`Step ${nextIdx + 1}/${seq.steps.length} — next: ${nextStep.action} on ${fmtDue(nextDate)}`, 'success')
  }

  async function snooze(c: CustomerItem, days: number) {
    const d = addDays(today0(), days)
    await setFollowUpDate(c.id, d)
    toast(`Snoozed to ${fmtDue(d)}`, 'success')
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

  /**
   * Appends to the record's comments and nothing else.
   *
   * This was `updateCustomer(c.id, { ...c, comments: next })` — a full-document
   * write of all forty fields, built from the copy this page loaded. Saving a
   * one-line note therefore reverted anything another rep had changed since,
   * and it read the existing comments from that same stale copy, so two notes
   * from two tabs would lose one. appendCustomerComment does it in a
   * transaction, touching only `comments`.
   */
  async function addNote(c: CustomerItem, text: string) {
    try {
      await appendCustomerComment(c.id, text)
      toast('Note saved', 'success')
    } catch {
      toast('Could not save that note', 'error')
    }
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
      <div className="flex rounded-xl overflow-hidden border border-gray-500 text-sm w-fit" role="tablist">
        {(['queue', 'sequences'] as Tab[]).map(t => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`px-5 py-2 font-medium capitalize transition-colors ${tab === t ? 'bg-indigo-600 text-white' : 'bg-gray-700 text-gray-300 hover:text-gray-100'}`}
          >
            {/* The count is the working queue, not every row the query
                returned — with a year-long window those differ by however much
                history the company has. */}
            {t === 'queue' ? `Queue (${chips[0].count})` : 'Sequences'}
          </button>
        ))}
      </div>

      {/* ── QUEUE TAB ── */}
      {tab === 'queue' && (
        <div className="space-y-4">

          {/* Filter chips. Neutral by default with red reserved for overdue —
              the four used to carry four different border hues encoding
              nothing, at 1.59–2.66:1 against the page. */}
          <div className="flex flex-wrap gap-2">
            {chips.map(chip => (
              <button
                key={chip.key}
                onClick={() => setFilter(chip.key)}
                aria-pressed={filter === chip.key}
                className={`px-3 py-1.5 rounded-full text-sm border transition-colors font-medium ${
                  filter === chip.key
                    ? 'bg-indigo-600 border-indigo-500 text-white'
                    : chip.alert && chip.count > 0
                      ? 'bg-red-500/15 border-red-500/50 text-red-300 hover:text-red-200'
                      : 'bg-gray-700 border-gray-500 text-gray-300 hover:text-gray-100'
                }`}
              >
                {chip.label} ({chip.count})
              </button>
            ))}
          </div>

          {/* Says so when the backlog the widened window exposed is large, and
              offers the one action that shrinks it. */}
          {!loading && filter === 'active' && buckets.stale.length > 0 && (
            <div className="bg-yellow-900/20 border border-yellow-600/40 rounded-xl px-4 py-3 text-yellow-300 text-sm">
              <span className="flex items-start gap-2">
                <Icon d={ICONS.warning} className="w-4 h-4 shrink-0 mt-0.5" />
                <span>
                  {buckets.stale.length} follow-up{buckets.stale.length === 1 ? '' : 's'} more than {STALE_DAYS} days
                  late {buckets.stale.length === 1 ? 'is' : 'are'} hidden from this view.{' '}
                  <button onClick={() => setFilter('stale')} className="underline font-medium hover:text-yellow-200">
                    Review them
                  </button>{' '}
                  to clear or reschedule.
                </span>
              </span>
            </div>
          )}

          {loading && (
            <div className="flex items-center justify-center py-12">
              <div role="status" aria-label="Loading follow-ups" className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
            </div>
          )}

          {!loading && visibleCustomers.length === 0 && (
            <div className="card p-10 text-center">
              <Icon d={ICONS.checkCircle} className="w-9 h-9 mx-auto mb-3 text-green-400" />
              <p className="text-gray-100 font-semibold">All caught up</p>
              <p className="text-gray-400 text-sm mt-1">{emptyMessage(filter, buckets)}</p>
            </div>
          )}

          {visibleCustomers.map(c => {
            const state = seqStates[c.id]
            const seq   = state ? sequences.find(s => s.id === state.sequenceId) : null
            const step  = seq ? seq.steps[state!.stepIndex] : null
            const isExpanded = expandedId === c.id
            const due = c.followUpDate ? dueMetaCompact(c.followUpDate, false) : null
            const name = rowName(c)

            return (
              <div key={c.id} className="card overflow-hidden">
                {/* The disclosure is a real button, so the row can be expanded
                    from the keyboard. It was a div with onClick and a
                    cursor-pointer: no role, no tabIndex, no key handler. The
                    record link sits outside it, since a link inside a button is
                    invalid and was only working via stopPropagation. */}
                <div className="px-4 py-3 flex items-center gap-3 hover:bg-gray-700/40 transition-colors">
                  <div className="w-9 h-9 rounded-full bg-indigo-500/25 flex items-center justify-center text-sm font-bold text-indigo-300 shrink-0">
                    {rowInitials(c)}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      {/* displayName, so a company record is titled by its
                          company like everywhere else in the app — this printed
                          `{first} {lastname}`, which for a company record is
                          blank or a stray contact name. */}
                      <Link
                        to={`/records/${c.id}`}
                        className="font-semibold text-white hover:text-indigo-300 transition-colors truncate"
                      >
                        {name.title}
                      </Link>
                      {seq && step && (
                        <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border font-medium ${ACTION_COLORS[step.action]}`}>
                          <Icon d={ACTION_ICONS[step.action]} className="w-3 h-3 shrink-0" />
                          {step.action} — Step {(state!.stepIndex + 1)}/{seq.steps.length}
                        </span>
                      )}
                      {!seq && (
                        <span className="text-xs px-2 py-0.5 rounded-full border border-gray-500 text-gray-300">
                          No sequence
                        </span>
                      )}
                    </div>
                    {/* gray-400, not gray-500 (3.04:1 on this card). */}
                    <div className="flex items-center gap-3 mt-0.5 text-xs text-gray-400 flex-wrap">
                      {due && <span className={due.cls}>{due.label}</span>}
                      {c.followUpDate && <span className="tabular-nums">{fmtDue(c.followUpDate)}</span>}
                      {name.sub && <span className="truncate">{name.sub}</span>}
                      {c.city && <span>{c.city}{c.state ? `, ${c.state}` : ''}</span>}
                      {c.salesman && <span>Rep: {c.salesman}</span>}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => setExpandedId(isExpanded ? null : c.id)}
                    aria-expanded={isExpanded}
                    aria-label={`${isExpanded ? 'Hide' : 'Show'} actions for ${name.title}`}
                    className="p-1.5 -m-1.5 rounded text-gray-400 hover:text-gray-100 shrink-0 transition-colors
                               focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                  >
                    <Icon d={ICONS.chevronDown} className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                  </button>
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

          {/* The cap. Every matching row used to render, which was fine when
              the query returned at most yesterday-to-two-weeks; with a
              year-long window a company with a real backlog got a page tens of
              thousands of pixels tall, with no pagination and nothing to
              scroll to. */}
          {hiddenCount > 0 && (
            <button
              onClick={() => setShown(n => n + RENDER_CAP)}
              className="w-full card px-4 py-3 text-sm text-indigo-400 hover:text-indigo-300 hover:bg-gray-700/40 transition-colors
                         focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            >
              Show {Math.min(hiddenCount, RENDER_CAP)} more
              <span className="text-gray-400"> · {hiddenCount} not shown</span>
            </button>
          )}
        </div>
      )}

      {/* ── SEQUENCES TAB ── */}
      {tab === 'sequences' && (
        <div className="space-y-3">
          {/* Says where these live, because it isn't where anyone would assume.
              loadSequences/loadStates read localStorage — so these cadences and
              the per-customer step positions exist only in this browser. A
              sequence one rep builds is invisible to everyone else, clearing
              site data destroys them, and a customer another rep enrolled shows
              here as "No sequence".

              The app also has a real Firestore-backed sequence engine
              (services/sequenceService, used by /sequences and the record page's
              Sequences tab) which does run server-side and is shared. Two
              sequence systems is the actual problem; consolidating them is a
              migration with enrolment state to move, not a change to make
              inside a review pass. Until then this at least stops the page
              implying company-wide behaviour it doesn't have. */}
          <div className="bg-yellow-900/20 border border-yellow-600/40 rounded-xl px-4 py-3 text-yellow-300 text-sm">
            <span className="flex items-start gap-2">
              <Icon d={ICONS.warning} className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                These sequences are saved in this browser only — they aren&rsquo;t shared with your team and
                nothing sends automatically. For shared, automated outreach use{' '}
                <Link to="/sequences" className="underline font-medium hover:text-yellow-200">Outreach → Sequences</Link>.
              </span>
            </span>
          </div>
          {sequences.map(seq => (
            <div key={seq.id} className="card p-4">
              <div className="flex items-start justify-between gap-3 mb-3">
                <div>
                  <p className="font-semibold text-white">{seq.name}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{seq.steps.length} steps · {seq.steps[seq.steps.length - 1]?.day ?? 0} days total</p>
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
                      {step.note && <p className="text-xs text-gray-400 mt-0.5">{step.note}</p>}
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
                      <span className="font-mono w-10 text-right text-gray-400">Day {step.day}</span>
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
                    <span className="text-xs text-gray-400 font-semibold w-5">{i + 1}</span>
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
                      className="text-gray-400 hover:text-red-300 transition-colors ml-1 p-1 -m-1 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
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
  const [saving, setSaving] = useState(false)
  // Snooze is a click-toggle, not a hover reveal — see the button below.
  const [snoozeOpen, setSnoozeOpen] = useState(false)
  const snoozeRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!snoozeOpen) return
    function onDown(e: MouseEvent) {
      if (snoozeRef.current && !snoozeRef.current.contains(e.target as Node)) setSnoozeOpen(false)
    }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setSnoozeOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [snoozeOpen])

  async function handleNote() {
    if (!noteText.trim() || saving) return
    setSaving(true)
    try {
      await onNote(noteText)
      setNoteText('')
    } finally {
      setSaving(false)
    }
  }

  const stepLabel = sequence && state
    ? `Step ${state.stepIndex + 1}/${sequence.steps.length}: ${step?.action}`
    : null

  // bg-gray-700/40, not bg-gray-800/20 — the latter is a tint of the card's own
  // colour over that same colour, i.e. 1.000:1, so the expanded panel had no
  // surface distinguishing it from the row above it.
  return (
    <div className="border-t border-gray-700/50 bg-gray-700/40 px-4 py-4 space-y-4">

      {/* Current step info */}
      {sequence && step ? (
        <div className="rounded-xl border border-gray-500 p-3 bg-gray-800">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border font-medium ${ACTION_COLORS[step.action]}`}>
              <Icon d={ACTION_ICONS[step.action]} className="w-3 h-3 shrink-0" />
              {stepLabel}
            </span>
            <span className="text-xs text-gray-400">from sequence &ldquo;{sequence.name}&rdquo;</span>
          </div>
          {step.note && <p className="text-sm text-gray-200 mt-1">{step.note}</p>}
        </div>
      ) : (
        <p className="text-sm text-gray-400 italic">
          {sequences.length > 0 ? 'No sequence assigned — manual follow-up.' : 'No sequences defined.'}
        </p>
      )}

      {/* Contact quick-actions. Tinted family with drawn icons, replacing
          bg-X-900/30 fills carrying emoji. */}
      <div className="flex flex-wrap gap-2">
        {customer.phone && (
          <a href={`tel:${customer.phone}`} className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl bg-blue-500/20 text-blue-300 border border-blue-600/40 hover:bg-blue-500/30 transition-colors">
            <Icon d={ICONS.phone} className="w-3.5 h-3.5 shrink-0" />
            Call
          </a>
        )}
        {customer.phone && (
          <a href={`sms:${customer.phone}`} className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl bg-green-500/20 text-green-300 border border-green-600/40 hover:bg-green-500/30 transition-colors">
            <Icon d={ICONS.chat} className="w-3.5 h-3.5 shrink-0" />
            SMS
          </a>
        )}
        {customer.email && (
          <a href={`mailto:${customer.email}`} className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl bg-indigo-500/20 text-indigo-300 border border-indigo-600/40 hover:bg-indigo-500/30 transition-colors">
            <Icon d={ICONS.envelope} className="w-3.5 h-3.5 shrink-0" />
            Email
          </a>
        )}
        <Link to={`/records/${customer.id}`} className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl bg-gray-700 text-gray-200 border border-gray-500 hover:bg-gray-600 transition-colors">
          View Record
          <Icon d={ICONS.arrowRight} className="w-3 h-3 shrink-0" />
        </Link>
      </div>

      {/* Action buttons */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={onComplete}
          className="inline-flex items-center gap-1.5 text-sm px-4 py-1.5 rounded-xl bg-green-500/20 text-green-300 border border-green-600/40 hover:bg-green-500/30 transition-colors font-medium
                     focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        >
          <Icon d={ICONS.check} className="w-3.5 h-3.5 shrink-0" />
          {sequence ? 'Complete Step' : 'Mark Done'}
        </button>
        <button
          onClick={onAssign}
          className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-xl bg-indigo-500/20 text-indigo-300 border border-indigo-600/40 hover:bg-indigo-500/30 transition-colors
                     focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        >
          <Icon d={sequence ? ICONS.refresh : ICONS.plus} className="w-3.5 h-3.5 shrink-0" />
          {sequence ? 'Change Sequence' : 'Assign Sequence'}
        </button>

        {/* Snooze opens on click. It was `hidden group-hover:flex`, and there is
            no hover on a touch device — so on a phone or tablet, which is where
            a rep works a follow-up queue, Snooze could not be opened at all.
            Same defect as the record page's activity delete button. */}
        <div className="relative" ref={snoozeRef}>
          <button
            onClick={() => setSnoozeOpen(o => !o)}
            aria-expanded={snoozeOpen}
            className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-xl bg-gray-700 text-gray-200 border border-gray-500 hover:bg-gray-600 transition-colors
                       focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          >
            <Icon d={ICONS.clock} className="w-3.5 h-3.5 shrink-0" />
            Snooze
          </button>
          {snoozeOpen && (
            <div className="absolute bottom-full left-0 mb-1 flex flex-col bg-gray-900 border border-gray-500 rounded-xl overflow-hidden shadow-xl z-10 min-w-[110px]">
              {[1, 3, 7, 14].map(d => (
                <button
                  key={d}
                  onClick={() => { setSnoozeOpen(false); onSnooze(d) }}
                  className="px-4 py-2 text-xs text-gray-200 hover:bg-gray-700 text-left transition-colors
                             focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500"
                >
                  {d} day{d > 1 ? 's' : ''}
                </button>
              ))}
            </div>
          )}
        </div>

        <button
          onClick={onClear}
          className="text-sm px-3 py-1.5 rounded-xl bg-gray-700 text-gray-300 border border-gray-500 hover:text-red-300 hover:border-red-500/50 transition-colors
                     focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        >
          Clear
        </button>
      </div>

      {/* Quick note */}
      <div className="flex gap-2">
        <label htmlFor={`note-${customer.id}`} className="sr-only">Quick note for {customer.first} {customer.lastname}</label>
        <input
          id={`note-${customer.id}`}
          type="text"
          value={noteText}
          onChange={e => setNoteText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleNote() }}
          placeholder="Add a quick note to this record…"
          disabled={saving}
          className="input-field text-sm py-1.5 flex-1"
        />
        <button
          onClick={handleNote}
          disabled={!noteText.trim() || saving}
          className="btn-secondary inline-flex items-center gap-1.5 text-sm px-3 disabled:opacity-40"
        >
          {saving && <span className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin shrink-0" />}
          Save
        </button>
      </div>
    </div>
  )
}
