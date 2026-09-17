import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  getLeadFormSettings, saveLeadFormSettings,
  subscribeToLeadSubmissions, updateSubmissionStatus, deleteSubmission,
  SUBMISSION_REALTIME_LIMIT,
} from '../../services/leadFormService'
import { createCustomer } from '../../services/customerService'
import { emptyCustomer, displayName, type CustomerItem } from '../../models/customer'
import {
  DEFAULT_FORM_SETTINGS, STATUS_COLORS, STATUS_LABELS,
  type LeadSubmission,
} from '../../models/leadForm'
import {
  describeSubmissionFilter, filterSubmissions, findExistingMatch, isSubmissionFilter,
  settingsDirty, submissionCounts,
  SUBMISSION_FILTERS, SUBMISSION_SORTS,
  type FormSettingsDraft, type SubmissionFilter, type SubmissionSort,
} from '../../models/leadSubmission'
import { useSharedCustomers } from '../../hooks/useSharedCustomers'
import { useAuthStore } from '../../stores/authStore'
import { useToast } from '../../components/Toast'
import { usePageTitle } from '../../hooks/usePageTitle'
import ConfirmModal from '../../components/ConfirmModal'
import { Icon, ICONS } from '../../components/Icon'

type Tab = 'setup' | 'submissions'

export default function LeadFormsPage() {
  usePageTitle('Lead Capture Form')
  const toast      = useToast()
  const navigate   = useNavigate()
  const companyId  = useAuthStore(s => s.companyId) ?? ''
  const { items: customers } = useSharedCustomers()

  const [tab,          setTab]          = useState<Tab>('setup')
  const [settings,     setSettings]     = useState<FormSettingsDraft>(DEFAULT_FORM_SETTINGS)
  /** What's actually in Firestore, for dirty-checking. */
  const [savedSettings, setSavedSettings] = useState<FormSettingsDraft | null>(null)
  const [saving,       setSaving]       = useState(false)
  const [copied,       setCopied]       = useState(false)
  const [submissions,  setSubmissions]  = useState<LeadSubmission[]>([])
  const [subsLoading,  setSubsLoading]  = useState(true)
  const [subsError,    setSubsError]    = useState<string | null>(null)
  const [hitCap,       setHitCap]       = useState(false)
  const [confirmId,    setConfirmId]    = useState<string | null>(null)
  const [converting,   setConverting]   = useState<string | null>(null)
  const [pendingMerge, setPendingMerge] = useState<{ sub: LeadSubmission; match: CustomerItem } | null>(null)

  const [params, setParams] = useSearchParams()
  const filterParam = params.get('filter')
  const filter: SubmissionFilter = isSubmissionFilter(filterParam) ? filterParam : 'all'
  const search = params.get('q') ?? ''
  const sortParam = params.get('sort')
  const sort: SubmissionSort = SUBMISSION_SORTS.some(s => s.key === sortParam)
    ? sortParam as SubmissionSort
    : 'newest'

  function setParam(key: string, value: string, fallback: string) {
    const next = new URLSearchParams(params)
    if (value === fallback) next.delete(key)
    else next.set(key, value)
    setParams(next, { replace: true })
  }

  const formUrl = `${window.location.origin}/f/${companyId}`

  useEffect(() => {
    if (!companyId) return
    getLeadFormSettings(companyId).then(s => {
      if (!s) return
      const loaded: FormSettingsDraft = {
        businessName: s.businessName, title: s.title, subtitle: s.subtitle,
        thankYouMessage: s.thankYouMessage, showPhone: s.showPhone,
        showAddress: s.showAddress, showMessage: s.showMessage, enabled: s.enabled,
      }
      setSettings(loaded)
      setSavedSettings(loaded)
    })
  }, [companyId])

  useEffect(() => {
    return subscribeToLeadSubmissions(
      (subs, cap) => { setSubmissions(subs); setHitCap(cap); setSubsError(null); setSubsLoading(false) },
      err => {
        // Was `() => setSubsLoading(false)`, so a failure rendered "No
        // submissions yet" with a Copy Form Link button.
        console.error('[LeadFormsPage] submissions subscription failed:', err)
        setSubsError(err.message || 'Could not load submissions.')
        setSubsLoading(false)
      },
    )
  }, [])

  const dirty  = settingsDirty(settings, savedSettings)
  const counts = useMemo(() => submissionCounts(submissions), [submissions])
  const filtered = useMemo(
    () => filterSubmissions(submissions, filter, search, sort),
    [submissions, filter, search, sort],
  )

  // Leaving with unsaved settings loses them silently otherwise.
  useEffect(() => {
    if (!dirty) return
    function onBeforeUnload(e: BeforeUnloadEvent) { e.preventDefault() }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty])

  async function handleSave() {
    if (!companyId) return
    setSaving(true)
    try {
      await saveLeadFormSettings({ companyId, ...settings })
      setSavedSettings({ ...settings })
      toast('Form settings saved', 'success')
    } catch {
      toast('Failed to save settings', 'error')
    } finally {
      setSaving(false)
    }
  }

  function copyLink() {
    navigator.clipboard.writeText(formUrl).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  /** The submission's data, mapped onto a new Lead. */
  async function createFrom(sub: LeadSubmission) {
    const newCustomer = {
      ...emptyCustomer(),
      first:       sub.first,
      lastname:    sub.lastname,
      phone:       sub.phone,
      email:       sub.email,
      street:      sub.street,
      city:        sub.city,
      state:       sub.state,
      zip:         sub.zip,
      comments:    sub.message,
      category:    'Lead',
      leadSource:  'Web Form',
      creationDate: new Date(),
    }
    const id = await createCustomer(newCustomer)
    await updateSubmissionStatus(sub.id, 'converted')
    toast('Lead created — opening record', 'success')
    navigate(`/records/${id}`)
  }

  /**
   * Checks for an existing record first.
   *
   * This used to call createCustomer unconditionally, so the same person
   * submitting the form twice produced two leads — in an app that has a whole
   * /duplicates page for cleaning that up afterwards.
   */
  async function handleConvert(sub: LeadSubmission) {
    const match = findExistingMatch(sub, customers)
    if (match) { setPendingMerge({ sub, match }); return }

    setConverting(sub.id)
    try {
      await createFrom(sub)
    } catch {
      toast('Failed to convert lead', 'error')
    } finally {
      setConverting(null)
    }
  }

  async function handleConvertAnyway() {
    const pending = pendingMerge
    setPendingMerge(null)
    if (!pending) return
    setConverting(pending.sub.id)
    try {
      await createFrom(pending.sub)
    } catch {
      toast('Failed to convert lead', 'error')
    } finally {
      setConverting(null)
    }
  }

  async function handleSetStatus(sub: LeadSubmission, status: LeadSubmission['status']) {
    try {
      await updateSubmissionStatus(sub.id, status)
    } catch {
      toast('Failed to update status', 'error')
    }
  }

  async function handleDelete(id: string) {
    setConfirmId(null)
    try {
      await deleteSubmission(id)
      toast('Submission deleted', 'success')
    } catch {
      toast('Failed to delete', 'error')
    }
  }

  const deleteTarget = submissions.find(s => s.id === confirmId) ?? null

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">

      {/* Header */}
      <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-white">Lead Capture Form</h1>
          <p className="text-sm text-gray-400 mt-0.5">A public form anyone can fill out to become a lead</p>
        </div>
        <a
          href={formUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-secondary text-sm px-3 py-2 flex items-center gap-1.5"
        >
          <Icon d={ICONS.externalLink} className="w-4 h-4" />
          Preview
        </a>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-gray-800">
        {([['setup', `Form Setup${dirty ? ' •' : ''}`], ['submissions', `Submissions${counts.new > 0 ? ` (${counts.new})` : ''}`]] as [Tab, string][]).map(([t, label]) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
              tab === t
                ? 'border-indigo-500 text-indigo-400'
                : 'border-transparent text-gray-400 hover:text-gray-200'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'setup' && (
        <div className="space-y-5">

          {/* Shareable link */}
          <div className="card p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">Your Shareable Link</p>
            <div className="flex items-center gap-2">
              {/* Was bg-gray-800 inside a bg-gray-800 card — 1.000:1, so the
                  most important element on the tab had no container at all. */}
              <code className="flex-1 bg-gray-900 border border-gray-500 text-indigo-300 text-sm px-3 py-2 rounded-lg truncate font-mono">
                {formUrl}
              </code>
              <button
                onClick={copyLink}
                className={`shrink-0 text-sm px-3 py-2 rounded-lg transition-colors border ${
                  copied
                    ? 'bg-green-500/20 border-green-500/40 text-green-300'
                    : 'bg-gray-800 border-gray-600 text-gray-300 hover:border-indigo-500 hover:text-indigo-300'
                }`}
              >
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
            <p className="text-xs text-gray-400 mt-2">Share this link on your website, social media, or via email.</p>
          </div>

          {/* Enable toggle */}
          <div className="card p-4 flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-white">Form Active</p>
              <p className="text-xs text-gray-400 mt-0.5">
                When off, visitors see a "not accepting submissions" message — and the database rejects
                submissions too, so an old open tab can't keep posting.
              </p>
            </div>
            <button
              onClick={() => setSettings(s => ({ ...s, enabled: !s.enabled }))}
              role="switch"
              aria-checked={settings.enabled}
              aria-label="Form Active"
              className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${settings.enabled ? 'bg-indigo-600' : 'bg-gray-600'}`}
            >
              {/* toggle-knob, not bg-white: bg-white resolves to
                  --color-white, which is dark navy in light mode, so the knob
                  turned near-black at 2.36:1 against its own track. */}
              <span className={`toggle-knob inline-block h-4 w-4 transform rounded-full transition-transform ${settings.enabled ? 'translate-x-6' : 'translate-x-1'}`} />
            </button>
          </div>

          {/* Text customization */}
          <div className="card p-4 space-y-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Form Text</p>

            <div>
              <label htmlFor="lf-business" className="block text-xs text-gray-400 mb-1.5">Business Name</label>
              <input
                id="lf-business"
                value={settings.businessName}
                onChange={e => setSettings(s => ({ ...s, businessName: e.target.value }))}
                className="input-field w-full text-sm"
                placeholder="Acme Roofing Co."
              />
              <p className="text-xs text-gray-400 mt-1">Shown at the top of the form so visitors know whose form it is.</p>
            </div>
            <div>
              <label htmlFor="lf-title" className="block text-xs text-gray-400 mb-1.5">Heading</label>
              <input
                id="lf-title"
                value={settings.title}
                onChange={e => setSettings(s => ({ ...s, title: e.target.value }))}
                className="input-field w-full text-sm"
                placeholder="Contact Us"
              />
            </div>
            <div>
              <label htmlFor="lf-subtitle" className="block text-xs text-gray-400 mb-1.5">Subheading</label>
              <input
                id="lf-subtitle"
                value={settings.subtitle}
                onChange={e => setSettings(s => ({ ...s, subtitle: e.target.value }))}
                className="input-field w-full text-sm"
                placeholder="Fill out the form and we'll get back to you…"
              />
            </div>
            <div>
              <label htmlFor="lf-thanks" className="block text-xs text-gray-400 mb-1.5">Thank You Message</label>
              <input
                id="lf-thanks"
                value={settings.thankYouMessage}
                onChange={e => setSettings(s => ({ ...s, thankYouMessage: e.target.value }))}
                className="input-field w-full text-sm"
                placeholder="Thank you! We'll be in touch soon."
              />
            </div>
          </div>

          {/* Field toggles */}
          <div className="card p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">Optional Fields</p>
            <p className="text-xs text-gray-400 mb-4">First name, last name, and email are always shown.</p>
            <div className="space-y-3">
              {([
                ['showPhone',   'Phone Number'],
                ['showAddress', 'Address (Street, City, State, Zip)'],
                ['showMessage', 'Message / Notes'],
              ] as [keyof FormSettingsDraft, string][]).map(([key, label]) => (
                <div key={key} className="flex items-center justify-between gap-3">
                  <span className="text-sm text-gray-300">{label}</span>
                  <button
                    type="button"
                    onClick={() => setSettings(s => ({ ...s, [key]: !s[key] }))}
                    role="switch"
                    aria-checked={Boolean(settings[key])}
                    aria-label={label}
                    className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${settings[key] ? 'bg-indigo-600' : 'bg-gray-600'}`}
                  >
                    <span className={`toggle-knob inline-block h-4 w-4 transform rounded-full transition-transform ${settings[key] ? 'translate-x-6' : 'translate-x-1'}`} />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* The button was always enabled whether or not anything had
              changed, and navigating away lost the edits with no prompt. */}
          <div className="flex items-center justify-end gap-3">
            {dirty && <span className="text-xs text-amber-300">Unsaved changes</span>}
            {!dirty && savedSettings && <span className="text-xs text-gray-400">All changes saved</span>}
            <button
              onClick={handleSave}
              disabled={saving || !dirty}
              className="btn-primary text-sm px-6 py-2 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {saving ? 'Saving…' : 'Save Settings'}
            </button>
          </div>
        </div>
      )}

      {tab === 'submissions' && (
        <div>
          {subsError && (
            <div className="bg-red-900/30 border border-red-700/50 rounded-xl px-4 py-3 mb-4">
              <p className="text-sm text-red-300 font-medium">Could not load submissions</p>
              <p className="text-xs text-red-300/90 mt-1">{subsError}</p>
              <p className="text-xs text-red-300/90 mt-1">
                This query needs a <span className="font-mono">companyId + submittedAt</span> composite index
                on <span className="font-mono">leadSubmissions</span>. Nothing has been lost.
              </p>
            </div>
          )}

          {hitCap && (
            <div className="bg-yellow-900/20 border border-yellow-600/40 rounded-xl px-4 py-3 text-yellow-300 text-sm mb-4">
              <span className="flex items-start gap-2">
                <Icon d={ICONS.warning} className="w-4 h-4 shrink-0 mt-0.5" />
                <span>
                  Showing the most recent {SUBMISSION_REALTIME_LIMIT.toLocaleString()} submissions only —
                  older ones aren't listed, and the counts below are understated. Delete what you don't need.
                </span>
              </span>
            </div>
          )}

          {!subsError && submissions.length > 0 && (
            <>
              <div className="flex gap-2 mb-3">
                <div className="relative flex-1 min-w-0">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
                    <Icon d={ICONS.search} className="w-4 h-4" />
                  </span>
                  <input
                    type="search"
                    value={search}
                    onChange={e => setParam('q', e.target.value, '')}
                    placeholder="Search name, email, phone, or message…"
                    aria-label="Search submissions"
                    className="input-field w-full pl-9 pr-9 text-sm py-2"
                  />
                  {search && (
                    <button
                      type="button"
                      onClick={() => setParam('q', '', '')}
                      aria-label="Clear search"
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded text-gray-400 hover:text-gray-200 hover:bg-gray-700/50 transition-colors"
                    >
                      <Icon d={ICONS.close} className="w-4 h-4" />
                    </button>
                  )}
                </div>
                <select
                  value={sort}
                  onChange={e => setParam('sort', e.target.value, 'newest')}
                  aria-label="Sort submissions"
                  className="input-field text-sm py-2 shrink-0 w-32 sm:w-40 cursor-pointer"
                >
                  {SUBMISSION_SORTS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                </select>
              </div>

              <div className="flex flex-wrap gap-2 mb-4">
                {SUBMISSION_FILTERS.map(f => {
                  const active = filter === f.key
                  const count = counts[f.key]
                  // Flagged earns colour when it isn't empty: that's the one
                  // that means something went wrong.
                  const urgent = f.key === 'spam' && count > 0
                  return (
                    <button
                      key={f.key}
                      onClick={() => setParam('filter', f.key, 'all')}
                      aria-pressed={active}
                      className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                        active
                          ? 'bg-indigo-600 text-white'
                          : urgent
                            ? 'bg-red-500/20 text-red-300 hover:bg-red-500/30'
                            : 'bg-gray-800 text-gray-400 hover:text-gray-200'
                      }`}
                    >
                      {f.label} ({count})
                    </button>
                  )
                })}
              </div>
            </>
          )}

          {subsLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map(i => (
                <div key={i} className="card p-4 animate-pulse">
                  <div className="h-4 bg-gray-700 rounded w-40 mb-2" />
                  <div className="h-3 bg-gray-700/60 rounded w-64" />
                </div>
              ))}
            </div>
          ) : subsError ? null : submissions.length === 0 ? (
            <div className="card p-12 text-center">
              <Icon d={ICONS.envelope} className="w-10 h-10 mx-auto text-gray-400 mb-3" />
              <p className="text-gray-100 font-medium mb-1">No submissions yet</p>
              <p className="text-sm text-gray-400 mb-4">Share your form link and leads will appear here</p>
              <button
                onClick={() => { setTab('setup'); copyLink() }}
                className="btn-secondary text-sm px-4 py-2"
              >
                Copy Form Link
              </button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="card p-8 text-center">
              <p className="text-gray-100 font-medium">
                {search.trim() ? `Nothing matches “${search.trim()}”` : `No ${describeSubmissionFilter(filter, '').toLowerCase()} submissions`}
              </p>
              <button
                onClick={() => { setParam('q', '', ''); setParam('filter', 'all', 'all') }}
                className="btn-secondary text-sm px-4 py-2 mt-3"
              >
                Clear filters
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {filtered.map(sub => (
                <div key={sub.id} className="card p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className="font-medium text-white">{sub.first} {sub.lastname}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[sub.status]}`}>
                          {STATUS_LABELS[sub.status]}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-gray-400">
                        {sub.email && <span>{sub.email}</span>}
                        {sub.phone && <span>{sub.phone}</span>}
                        {sub.city  && <span>{[sub.city, sub.state].filter(Boolean).join(', ')}</span>}
                      </div>
                      {/* Was text-gray-500 at 3.04:1 — the message the
                          customer actually wrote. */}
                      {sub.message && (
                        <p className="text-xs text-gray-300 mt-1.5 line-clamp-2 italic">"{sub.message}"</p>
                      )}
                      {/* Was text-gray-600 at 1.94:1. */}
                      <p className="text-xs text-gray-400 mt-1.5">
                        {sub.submittedAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}
                      </p>
                    </div>
                    <div className="flex flex-col gap-1.5 shrink-0 items-end">
                      {sub.status !== 'converted' && (
                        <button
                          onClick={() => handleConvert(sub)}
                          disabled={converting === sub.id}
                          className="text-xs text-teal-400 hover:text-teal-300 transition-colors px-2 py-1 rounded hover:bg-gray-700 disabled:opacity-40 whitespace-nowrap"
                        >
                          {converting === sub.id ? 'Converting…' : 'Convert to Lead →'}
                        </button>
                      )}
                      {sub.status === 'new' && (
                        <button
                          onClick={() => handleSetStatus(sub, 'contacted')}
                          className="text-xs text-yellow-400 hover:text-yellow-300 transition-colors px-2 py-1 rounded hover:bg-gray-700 whitespace-nowrap"
                        >
                          Mark Contacted
                        </button>
                      )}
                      {/* A real lead flagged by the burst check needs a way
                          back; the trigger can only guess. */}
                      {sub.status === 'spam' && (
                        <button
                          onClick={() => handleSetStatus(sub, 'new')}
                          className="text-xs text-blue-400 hover:text-blue-300 transition-colors px-2 py-1 rounded hover:bg-gray-700 whitespace-nowrap"
                        >
                          Not spam
                        </button>
                      )}
                      <button
                        onClick={() => setConfirmId(sub.id)}
                        aria-label={`Delete submission from ${sub.first} ${sub.lastname}`}
                        className="text-xs text-gray-400 hover:text-red-400 transition-colors px-2 py-1 rounded hover:bg-gray-700"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <ConfirmModal
        isOpen={!!confirmId}
        message={
          deleteTarget
            ? `Delete the submission from ${deleteTarget.first} ${deleteTarget.lastname}? This cannot be undone.`
            : ''
        }
        confirmLabel="Delete submission"
        onConfirm={() => confirmId && handleDelete(confirmId)}
        onCancel={() => setConfirmId(null)}
      />

      {/* Not a ConfirmModal: this is a three-way choice, and ConfirmModal
          routes Escape and the backdrop to onCancel — so wiring "Create
          anyway" there would mean pressing Escape silently created the
          duplicate lead. Dismissing has to do nothing. */}
      {pendingMerge && (
        <DuplicateLeadDialog
          match={pendingMerge.match}
          sameEmail={
            pendingMerge.match.email.trim().toLowerCase() ===
            pendingMerge.sub.email.trim().toLowerCase() &&
            pendingMerge.sub.email.trim() !== ''
          }
          onOpenExisting={() => {
            const match = pendingMerge.match
            setPendingMerge(null)
            navigate(`/records/${match.id}`)
          }}
          onCreateAnyway={handleConvertAnyway}
          onDismiss={() => setPendingMerge(null)}
        />
      )}
    </div>
  )
}

/**
 * Offered when a submission matches a record that already exists.
 *
 * Three real options, so it can't be a ConfirmModal: open the existing
 * record, create a second one anyway, or back out. Escape and the backdrop
 * both back out — the one branch that must never be the destructive default.
 */
function DuplicateLeadDialog({
  match, sameEmail, onOpenExisting, onCreateAnyway, onDismiss,
}: {
  match: CustomerItem
  sameEmail: boolean
  onOpenExisting: () => void
  onCreateAnyway: () => void
  onDismiss: () => void
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onDismiss()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onDismiss])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/60" onClick={onDismiss} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Possible duplicate"
        className="relative bg-gray-800 border border-gray-600 rounded-2xl shadow-2xl p-6 w-full max-w-sm animate-slide-up"
      >
        <p className="text-sm font-semibold text-white mb-1">This looks like an existing record</p>
        <p className="text-sm text-gray-300 leading-relaxed">
          <span className="text-white">{displayName(match)}</span> already exists with the same{' '}
          {sameEmail ? 'email address' : 'phone number'}. Converting would create a second record for
          the same person.
        </p>
        <div className="mt-5 space-y-2">
          <button
            onClick={onOpenExisting}
            className="w-full py-2 text-sm font-medium rounded-xl bg-indigo-600 text-white hover:bg-indigo-500 transition-colors"
          >
            Open the existing record
          </button>
          <button
            onClick={onCreateAnyway}
            className="w-full py-2 text-sm font-medium rounded-xl bg-gray-700 text-gray-200 hover:bg-gray-600 transition-colors"
          >
            Create a second record anyway
          </button>
          <button
            onClick={onDismiss}
            className="w-full py-2 text-sm font-medium rounded-xl text-gray-400 hover:text-gray-200 transition-colors"
          >
            Leave it for now
          </button>
        </div>
      </div>
    </div>
  )
}
