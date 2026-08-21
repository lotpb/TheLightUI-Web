import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  subscribeToCampaigns, createCampaign, updateCampaign, deleteCampaign, sendCampaign,
} from '../../services/campaignService'
import { subscribeToCustomers } from '../../services/customerService'
import {
  CAMPAIGN_MERGE_FIELDS, STATUS_COLORS, STATUS_LABELS,
  matchesSegment,
  type Campaign, type CampaignSegment,
} from '../../models/campaign'
import { CATEGORIES } from '../../models/customer'
import { useToast } from '../../components/Toast'
import { usePageTitle } from '../../hooks/usePageTitle'
import ConfirmModal from '../../components/ConfirmModal'
import type { CustomerItem } from '../../models/customer'

type Draft = Pick<Campaign, 'name' | 'subject' | 'body' | 'segment'>

const DEFAULT_SEGMENT: CampaignSegment = { categories: [], salesmen: [], requireEmail: true }

const EMPTY_DRAFT: Draft = {
  name: '', subject: '', body: '', segment: DEFAULT_SEGMENT,
}

function fmtDate(d: Date | null): string {
  if (!d) return '—'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function openRate(c: Campaign): string {
  if (!c.sentCount) return '—'
  return `${Math.round((c.openCount / c.sentCount) * 100)}%`
}

export default function CampaignsPage() {
  usePageTitle('Email Campaigns')
  const toast = useToast()

  const [campaigns,  setCampaigns]  = useState<Campaign[]>([])
  const [customers,  setCustomers]  = useState<CustomerItem[]>([])
  const [loading,    setLoading]    = useState(true)
  const [editId,     setEditId]     = useState<string | null>(null)
  const [draft,      setDraft]      = useState<Draft>({ ...EMPTY_DRAFT })
  const [saving,     setSaving]     = useState(false)
  const [sending,    setSending]    = useState(false)
  const [confirmDel, setConfirmDel] = useState<string | null>(null)
  const bodyRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const u1 = subscribeToCampaigns(c => { setCampaigns(c); setLoading(false) }, () => setLoading(false))
    const u2 = subscribeToCustomers(setCustomers, () => {})
    return () => { u1(); u2() }
  }, [])

  // All sales reps for the salesman filter
  const allReps = useMemo(() => {
    const s = new Set<string>()
    customers.forEach(c => { if (c.salesman) s.add(c.salesman) })
    return Array.from(s).sort()
  }, [customers])

  // Live preview: customers matching current segment draft
  const previewMatches = useMemo(
    () => customers.filter(c => matchesSegment(c, draft.segment)),
    [customers, draft.segment],
  )

  function openNew() {
    setDraft({ ...EMPTY_DRAFT, segment: { ...DEFAULT_SEGMENT } })
    setEditId('__new__')
  }

  function openEdit(c: Campaign) {
    setDraft({ name: c.name, subject: c.subject, body: c.body, segment: c.segment })
    setEditId(c.id)
  }

  function closeModal() { setEditId(null); setSaving(false) }

  function insertMergeField(token: string) {
    const el = bodyRef.current
    if (!el) return
    const start = el.selectionStart ?? el.value.length
    const end   = el.selectionEnd   ?? el.value.length
    const next  = el.value.slice(0, start) + token + el.value.slice(end)
    setDraft(d => ({ ...d, body: next }))
    setTimeout(() => {
      el.focus()
      el.setSelectionRange(start + token.length, start + token.length)
    }, 0)
  }

  function toggleCategory(cat: string) {
    setDraft(d => {
      const cats = d.segment.categories.includes(cat)
        ? d.segment.categories.filter(c => c !== cat)
        : [...d.segment.categories, cat]
      return { ...d, segment: { ...d.segment, categories: cats } }
    })
  }

  function toggleSalesman(rep: string) {
    setDraft(d => {
      const reps = d.segment.salesmen.includes(rep)
        ? d.segment.salesmen.filter(r => r !== rep)
        : [...d.segment.salesmen, rep]
      return { ...d, segment: { ...d.segment, salesmen: reps } }
    })
  }

  async function handleSaveDraft() {
    if (!draft.name.trim()) return
    setSaving(true)
    try {
      if (editId === '__new__') {
        await createCampaign(draft)
        toast('Campaign saved as draft', 'success')
      } else if (editId) {
        await updateCampaign(editId, draft)
        toast('Campaign updated', 'success')
      }
      closeModal()
    } catch {
      toast('Failed to save campaign', 'error')
      setSaving(false)
    }
  }

  async function handleSend() {
    if (!draft.name.trim() || !draft.subject.trim()) return
    if (previewMatches.length === 0) {
      toast('No contacts match this audience — add emails to your records', 'error')
      return
    }
    setSending(true)
    try {
      let campId = editId
      if (editId === '__new__') {
        campId = await createCampaign(draft)
      } else if (editId) {
        await updateCampaign(editId, draft)
      }
      const count = await sendCampaign(campId!, previewMatches)
      toast(`Campaign sent to ${count} contact${count !== 1 ? 's' : ''}`, 'success')
      closeModal()
    } catch {
      toast('Failed to send campaign', 'error')
    } finally {
      setSending(false)
    }
  }

  async function handleDelete(id: string) {
    setConfirmDel(null)
    try {
      await deleteCampaign(id)
      toast('Campaign deleted', 'success')
    } catch {
      toast('Failed to delete', 'error')
    }
  }

  const isNew = editId === '__new__'
  const editingCampaign = campaigns.find(c => c.id === editId)

  const totalSent   = campaigns.reduce((s, c) => s + c.sentCount, 0)
  const totalOpened = campaigns.reduce((s, c) => s + c.openCount, 0)
  const avgOpenRate = totalSent > 0 ? Math.round((totalOpened / totalSent) * 100) : 0

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Email Campaigns</h1>
          <p className="text-sm text-gray-500 mt-0.5">Send targeted emails to segments of your contacts</p>
        </div>
        <button onClick={openNew} className="btn-primary text-sm px-4 py-2">+ New Campaign</button>
      </div>

      {/* Summary stats */}
      {campaigns.length > 0 && (
        <div className="grid grid-cols-3 gap-3 mb-6">
          {[
            { label: 'Total Sent', value: totalSent.toLocaleString() },
            { label: 'Total Opened', value: totalOpened.toLocaleString() },
            { label: 'Avg Open Rate', value: totalSent > 0 ? `${avgOpenRate}%` : '—' },
          ].map(({ label, value }) => (
            <div key={label} className="card p-4 text-center">
              <p className="text-2xl font-bold text-white">{value}</p>
              <p className="text-xs text-gray-500 mt-0.5">{label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Campaign list */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => <div key={i} className="card p-4 animate-pulse"><div className="h-4 bg-gray-700 rounded w-40 mb-2" /><div className="h-3 bg-gray-700/60 rounded w-64" /></div>)}
        </div>
      ) : campaigns.length === 0 ? (
        <div className="card p-12 text-center">
          <p className="text-4xl mb-3">📧</p>
          <p className="text-gray-300 font-medium mb-1">No campaigns yet</p>
          <p className="text-sm text-gray-500 mb-4">Create a targeted email campaign to reach a segment of your contacts</p>
          <button onClick={openNew} className="btn-primary text-sm px-4 py-2">Create First Campaign</button>
        </div>
      ) : (
        <div className="space-y-3">
          {campaigns.map(camp => (
            <div key={camp.id} className="card p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="font-medium text-white">{camp.name}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[camp.status]}`}>
                      {STATUS_LABELS[camp.status]}
                    </span>
                  </div>
                  <p className="text-sm text-gray-400 truncate mb-2">{camp.subject}</p>
                  {camp.status === 'sent' && (
                    <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-gray-500">
                      <span>Sent <span className="text-gray-300">{camp.sentCount.toLocaleString()}</span></span>
                      <span>Opened <span className="text-gray-300">{camp.openCount.toLocaleString()}</span></span>
                      <span>Clicked <span className="text-gray-300">{camp.clickCount.toLocaleString()}</span></span>
                      <span>Open rate <span className="text-gray-300">{openRate(camp)}</span></span>
                      <span className="text-gray-600">{fmtDate(camp.sentAt)}</span>
                    </div>
                  )}
                  {camp.status === 'draft' && (
                    <p className="text-xs text-gray-600">Draft · Created {fmtDate(camp.createdAt)}</p>
                  )}
                </div>
                <div className="flex gap-1.5 shrink-0 items-start">
                  <Link
                    to={`/campaigns/${camp.id}`}
                    className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors px-2 py-1 rounded hover:bg-gray-700"
                  >
                    Details
                  </Link>
                  {camp.status === 'draft' && (
                    <button
                      onClick={() => openEdit(camp)}
                      className="text-xs text-gray-400 hover:text-gray-200 transition-colors px-2 py-1 rounded hover:bg-gray-700"
                    >
                      Edit
                    </button>
                  )}
                  <button
                    onClick={() => setConfirmDel(camp.id)}
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

      {/* Create / Edit modal */}
      {editId && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-0 sm:px-4">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={closeModal} />
          <div className="relative bg-gray-900 border border-gray-700 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-2xl shadow-2xl flex flex-col max-h-[94vh]">

            {/* Modal header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700 shrink-0">
              <p className="font-semibold text-white">
                {isNew ? 'New Campaign' : `Edit: ${editingCampaign?.name ?? ''}`}
              </p>
              <button type="button" onClick={closeModal} className="text-gray-400 hover:text-gray-200">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Modal body */}
            <div className="flex-1 overflow-y-auto p-5 space-y-5">

              {/* Name */}
              <div>
                <label className="block text-xs text-gray-500 mb-1.5">Campaign Name *</label>
                <input
                  autoFocus
                  value={draft.name}
                  onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
                  placeholder="e.g. Summer Promo 2026"
                  className="input-field w-full text-sm"
                />
              </div>

              {/* Subject */}
              <div>
                <label className="block text-xs text-gray-500 mb-1.5">Email Subject *</label>
                <input
                  value={draft.subject}
                  onChange={e => setDraft(d => ({ ...d, subject: e.target.value }))}
                  placeholder="e.g. Exclusive offer just for you, {{firstName}}!"
                  className="input-field w-full text-sm"
                />
              </div>

              {/* Merge field chips */}
              <div>
                <p className="text-xs text-gray-500 mb-1.5">Insert merge field at cursor</p>
                <div className="flex flex-wrap gap-1.5">
                  {CAMPAIGN_MERGE_FIELDS.map(f => (
                    <button
                      key={f.token}
                      type="button"
                      onClick={() => insertMergeField(f.token)}
                      title={f.desc}
                      className="text-xs bg-gray-800 text-indigo-300 border border-gray-700 hover:border-indigo-500 px-2 py-0.5 rounded-full font-mono transition-colors"
                    >
                      {f.token}
                    </button>
                  ))}
                </div>
              </div>

              {/* Body */}
              <div>
                <label className="block text-xs text-gray-500 mb-1.5">Email Body *</label>
                <textarea
                  ref={bodyRef}
                  value={draft.body}
                  onChange={e => setDraft(d => ({ ...d, body: e.target.value }))}
                  rows={10}
                  placeholder={"Hi {{firstName}},\n\nWe wanted to reach out with a special offer…\n\nBest regards,\nThe Team"}
                  className="input-field w-full text-sm resize-none font-mono text-xs leading-relaxed"
                />
              </div>

              {/* Segment */}
              <div className="space-y-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Target Audience</p>

                {/* Categories */}
                <div>
                  <p className="text-xs text-gray-500 mb-2">Contact Type <span className="text-gray-600">(leave blank for all)</span></p>
                  <div className="flex flex-wrap gap-2">
                    {CATEGORIES.map(cat => (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => toggleCategory(cat)}
                        className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                          draft.segment.categories.includes(cat)
                            ? 'bg-indigo-600/30 border-indigo-500 text-indigo-300'
                            : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-600'
                        }`}
                      >
                        {cat}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Salesmen */}
                {allReps.length > 0 && (
                  <div>
                    <p className="text-xs text-gray-500 mb-2">Sales Rep <span className="text-gray-600">(leave blank for all)</span></p>
                    <div className="flex flex-wrap gap-2">
                      {allReps.map(rep => (
                        <button
                          key={rep}
                          type="button"
                          onClick={() => toggleSalesman(rep)}
                          className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                            draft.segment.salesmen.includes(rep)
                              ? 'bg-teal-600/30 border-teal-500 text-teal-300'
                              : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-600'
                          }`}
                        >
                          {rep}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Preview */}
                <div className={`rounded-xl p-3 border text-sm ${
                  previewMatches.length > 0
                    ? 'bg-green-500/10 border-green-700/30 text-green-300'
                    : 'bg-gray-800/50 border-gray-700 text-gray-500'
                }`}>
                  {previewMatches.length > 0
                    ? `✓ ${previewMatches.length} contact${previewMatches.length !== 1 ? 's' : ''} match this audience and have email addresses`
                    : 'No contacts match — try broadening the filters, or add email addresses to your records'}
                </div>
              </div>
            </div>

            {/* Modal footer */}
            <div className="px-5 py-4 border-t border-gray-700 flex justify-between gap-3 shrink-0">
              <button type="button" onClick={closeModal} className="btn-secondary text-sm px-4 py-2">Cancel</button>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleSaveDraft}
                  disabled={saving || sending || !draft.name.trim()}
                  className="btn-secondary text-sm px-4 py-2 disabled:opacity-40"
                >
                  {saving ? 'Saving…' : 'Save Draft'}
                </button>
                <button
                  type="button"
                  onClick={handleSend}
                  disabled={saving || sending || !draft.name.trim() || !draft.subject.trim() || !draft.body.trim() || previewMatches.length === 0}
                  className="btn-primary text-sm px-5 py-2 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {sending ? 'Sending…' : `Send to ${previewMatches.length}`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <ConfirmModal
        isOpen={!!confirmDel}
        message="Delete this campaign and all its data? This cannot be undone."
        onConfirm={() => confirmDel && handleDelete(confirmDel)}
        onCancel={() => setConfirmDel(null)}
      />
    </div>
  )
}
