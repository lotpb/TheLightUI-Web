import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  getLeadFormSettings, saveLeadFormSettings,
  subscribeToLeadSubmissions, updateSubmissionStatus, deleteSubmission,
} from '../../services/leadFormService'
import { createCustomer } from '../../services/customerService'
import { emptyCustomer } from '../../models/customer'
import {
  DEFAULT_FORM_SETTINGS, STATUS_COLORS, STATUS_LABELS,
  type LeadFormSettings, type LeadSubmission,
} from '../../models/leadForm'
import { useAuthStore } from '../../stores/authStore'
import { useToast } from '../../components/Toast'
import { usePageTitle } from '../../hooks/usePageTitle'
import ConfirmModal from '../../components/ConfirmModal'

type Tab = 'setup' | 'submissions'

export default function LeadFormsPage() {
  usePageTitle('Lead Capture Form')
  const toast      = useToast()
  const navigate   = useNavigate()
  const companyId  = useAuthStore(s => s.companyId) ?? ''

  const [tab,          setTab]          = useState<Tab>('setup')
  const [settings,     setSettings]     = useState<Omit<LeadFormSettings, 'companyId' | 'updatedAt'>>(DEFAULT_FORM_SETTINGS)
  const [saving,       setSaving]       = useState(false)
  const [copied,       setCopied]       = useState(false)
  const [submissions,  setSubmissions]  = useState<LeadSubmission[]>([])
  const [subsLoading,  setSubsLoading]  = useState(true)
  const [confirmId,    setConfirmId]    = useState<string | null>(null)
  const [converting,   setConverting]   = useState<string | null>(null)

  const formUrl = `${window.location.origin}/f/${companyId}`

  useEffect(() => {
    if (!companyId) return
    getLeadFormSettings(companyId).then(s => {
      if (s) setSettings({ title: s.title, subtitle: s.subtitle, thankYouMessage: s.thankYouMessage, showPhone: s.showPhone, showAddress: s.showAddress, showMessage: s.showMessage, enabled: s.enabled })
    })
  }, [companyId])

  useEffect(() => {
    return subscribeToLeadSubmissions(
      subs => { setSubmissions(subs); setSubsLoading(false) },
      ()   => setSubsLoading(false),
    )
  }, [])

  async function handleSave() {
    if (!companyId) return
    setSaving(true)
    try {
      await saveLeadFormSettings({ companyId, ...settings })
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

  async function handleConvert(sub: LeadSubmission) {
    setConverting(sub.id)
    try {
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
    } catch {
      toast('Failed to convert lead', 'error')
    } finally {
      setConverting(null)
    }
  }

  async function handleMarkContacted(sub: LeadSubmission) {
    try {
      await updateSubmissionStatus(sub.id, 'contacted')
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

  const newCount = submissions.filter(s => s.status === 'new').length

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Lead Capture Form</h1>
          <p className="text-sm text-gray-500 mt-0.5">A public form anyone can fill out to become a lead</p>
        </div>
        <a
          href={formUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-secondary text-sm px-3 py-2 flex items-center gap-1.5"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
          </svg>
          Preview
        </a>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-gray-800">
        {([['setup', 'Form Setup'], ['submissions', `Submissions${newCount > 0 ? ` (${newCount})` : ''}`]] as [Tab, string][]).map(([t, label]) => (
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
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-3">Your Shareable Link</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 bg-gray-800 text-indigo-300 text-sm px-3 py-2 rounded-lg truncate font-mono">
                {formUrl}
              </code>
              <button
                onClick={copyLink}
                className={`shrink-0 text-sm px-3 py-2 rounded-lg transition-colors border ${
                  copied
                    ? 'bg-green-500/20 border-green-500/40 text-green-300'
                    : 'bg-gray-800 border-gray-700 text-gray-300 hover:border-indigo-500 hover:text-indigo-300'
                }`}
              >
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
            <p className="text-xs text-gray-600 mt-2">Share this link on your website, social media, or via email.</p>
          </div>

          {/* Enable toggle */}
          <div className="card p-4 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-white">Form Active</p>
              <p className="text-xs text-gray-500 mt-0.5">When off, visitors see a "not accepting submissions" message</p>
            </div>
            <button
              onClick={() => setSettings(s => ({ ...s, enabled: !s.enabled }))}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${settings.enabled ? 'bg-indigo-600' : 'bg-gray-600'}`}
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${settings.enabled ? 'translate-x-6' : 'translate-x-1'}`} />
            </button>
          </div>

          {/* Text customization */}
          <div className="card p-4 space-y-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Form Text</p>

            <div>
              <label className="block text-xs text-gray-500 mb-1.5">Heading</label>
              <input
                value={settings.title}
                onChange={e => setSettings(s => ({ ...s, title: e.target.value }))}
                className="input-field w-full text-sm"
                placeholder="Contact Us"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1.5">Subheading</label>
              <input
                value={settings.subtitle}
                onChange={e => setSettings(s => ({ ...s, subtitle: e.target.value }))}
                className="input-field w-full text-sm"
                placeholder="Fill out the form and we'll get back to you…"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1.5">Thank You Message</label>
              <input
                value={settings.thankYouMessage}
                onChange={e => setSettings(s => ({ ...s, thankYouMessage: e.target.value }))}
                className="input-field w-full text-sm"
                placeholder="Thank you! We'll be in touch soon."
              />
            </div>
          </div>

          {/* Field toggles */}
          <div className="card p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-3">Optional Fields</p>
            <p className="text-xs text-gray-600 mb-4">First name, last name, and email are always shown.</p>
            <div className="space-y-3">
              {([
                ['showPhone',   'Phone Number'],
                ['showAddress', 'Address (Street, City, State, Zip)'],
                ['showMessage', 'Message / Notes'],
              ] as [keyof typeof settings, string][]).map(([key, label]) => (
                <label key={key} className="flex items-center justify-between cursor-pointer">
                  <span className="text-sm text-gray-300">{label}</span>
                  <button
                    type="button"
                    onClick={() => setSettings(s => ({ ...s, [key]: !s[key] }))}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${settings[key] ? 'bg-indigo-600' : 'bg-gray-600'}`}
                  >
                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${settings[key] ? 'translate-x-6' : 'translate-x-1'}`} />
                  </button>
                </label>
              ))}
            </div>
          </div>

          <div className="flex justify-end">
            <button
              onClick={handleSave}
              disabled={saving}
              className="btn-primary text-sm px-6 py-2 disabled:opacity-40"
            >
              {saving ? 'Saving…' : 'Save Settings'}
            </button>
          </div>
        </div>
      )}

      {tab === 'submissions' && (
        <div>
          {subsLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map(i => (
                <div key={i} className="card p-4 animate-pulse">
                  <div className="h-4 bg-gray-700 rounded w-40 mb-2" />
                  <div className="h-3 bg-gray-700/60 rounded w-64" />
                </div>
              ))}
            </div>
          ) : submissions.length === 0 ? (
            <div className="card p-12 text-center">
              <p className="text-4xl mb-3">📬</p>
              <p className="text-gray-300 font-medium mb-1">No submissions yet</p>
              <p className="text-sm text-gray-500 mb-4">Share your form link and leads will appear here</p>
              <button
                onClick={() => { setTab('setup'); copyLink() }}
                className="btn-secondary text-sm px-4 py-2"
              >
                Copy Form Link
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {submissions.map(sub => (
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
                      {sub.message && (
                        <p className="text-xs text-gray-500 mt-1.5 line-clamp-2 italic">"{sub.message}"</p>
                      )}
                      <p className="text-xs text-gray-600 mt-1.5">
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
                          onClick={() => handleMarkContacted(sub)}
                          className="text-xs text-yellow-400 hover:text-yellow-300 transition-colors px-2 py-1 rounded hover:bg-gray-700 whitespace-nowrap"
                        >
                          Mark Contacted
                        </button>
                      )}
                      <button
                        onClick={() => setConfirmId(sub.id)}
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
        </div>
      )}

      <ConfirmModal
        isOpen={!!confirmId}
        message="Delete this submission? This cannot be undone."
        onConfirm={() => confirmId && handleDelete(confirmId)}
        onCancel={() => setConfirmId(null)}
      />
    </div>
  )
}
