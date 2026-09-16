import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  subscribeToCampaigns, createCampaign, updateCampaign, deleteCampaign,
  queueCampaignRecipients, sendCampaign,
} from '../../services/campaignService'
import { subscribeToCustomers } from '../../services/customerService'
import {
  CAMPAIGN_MERGE_FIELDS, STATUS_COLORS, STATUS_LABELS,
  matchesSegment, interpolateCampaign,
  type Campaign, type CampaignSegment,
} from '../../models/campaign'
import { CATEGORIES } from '../../models/customer'
import { useToast } from '../../components/Toast'
import { usePageTitle } from '../../hooks/usePageTitle'
import ConfirmModal from '../../components/ConfirmModal'
import PartialDataBanner from '../../components/PartialDataBanner'
import { Icon, ICONS } from '../../components/Icon'
import type { CustomerItem } from '../../models/customer'
import TemplatePicker from '../../components/TemplatePicker'

type Draft = Pick<Campaign, 'name' | 'subject' | 'body' | 'segment'>

const DEFAULT_SEGMENT: CampaignSegment = { categories: [], salesmen: [] }

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
  /** Compose → review → send. The send had no confirmation at all. */
  const [step, setStep] = useState<'compose' | 'review'>('compose')
  const [hitCap, setHitCap] = useState(false)
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const subjectRef = useRef<HTMLInputElement>(null)
  const [tagTarget, setTagTarget] = useState<'subject' | 'body'>('body')

  useEffect(() => {
    const u1 = subscribeToCampaigns(c => { setCampaigns(c); setLoading(false) }, () => setLoading(false))
    // subscribeToCustomers calls back with (items, hitCap). Passing
    // setCustomers directly sent hitCap in as React's second setState
    // argument, where it was discarded — so on a company past the 5,000
    // record cap the audience count was quietly understated.
    const u2 = subscribeToCustomers((items, cap) => { setCustomers(items); setHitCap(!!cap) }, () => {})
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

  /** The first recipient, so the review step can show a real merged message. */
  const sample = previewMatches[0] ?? null

  function openNew() {
    setDraft({ ...EMPTY_DRAFT, segment: { ...DEFAULT_SEGMENT } })
    setStep('compose')
    setEditId('__new__')
  }

  function openEdit(c: Campaign) {
    setDraft({ name: c.name, subject: c.subject, body: c.body, segment: c.segment })
    setStep('compose')
    setEditId(c.id)
  }

  /** Start a new draft from a sent campaign — the obvious next action. */
  function duplicate(c: Campaign) {
    setDraft({ name: `${c.name} (copy)`, subject: c.subject, body: c.body, segment: c.segment })
    setStep('compose')
    setEditId('__new__')
  }

  function closeModal() { setEditId(null); setSaving(false); setStep('compose') }

  /** Inserts into whichever field was last focused, subject included. */
  function insertMergeField(token: string) {
    const el = tagTarget === 'subject' ? subjectRef.current : bodyRef.current
    if (!el) return
    const start = el.selectionStart ?? el.value.length
    const end   = el.selectionEnd   ?? el.value.length
    const next  = el.value.slice(0, start) + token + el.value.slice(end)
    setDraft(d => tagTarget === 'subject' ? { ...d, subject: next } : { ...d, body: next })
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(start + token.length, start + token.length)
    })
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

  /**
   * Saves the draft, queues the audience, then asks the server to send it.
   *
   * The old version wrote recipient rows marked 'sent' and stamped the
   * campaign sent, with no mail provider call anywhere behind it — the toast
   * claimed a delivery that never happened. Every count below now comes back
   * from what the provider actually accepted.
   */
  async function handleSend() {
    if (!draft.name.trim() || !draft.subject.trim() || !draft.body.trim()) return
    if (previewMatches.length === 0) {
      toast('No contacts match this audience — add emails to your records', 'error')
      return
    }
    setSending(true)
    // Kept out of the try, so a send failure doesn't report "failed" over a
    // draft that was created and left behind with no explanation.
    let campId: string
    try {
      campId = editId === '__new__' ? await createCampaign(draft) : editId!
      if (editId !== '__new__') await updateCampaign(editId!, draft)
    } catch {
      toast('Could not save the campaign — nothing was sent.', 'error')
      setSending(false)
      return
    }

    try {
      await queueCampaignRecipients(campId, previewMatches)
      const { sent, failed } = await sendCampaign(campId)
      toast(
        failed > 0
          ? `Sent ${sent}, ${failed} failed. Open the campaign for the per-recipient list.`
          : `Sent to ${sent} contact${sent !== 1 ? 's' : ''}.`,
        sent > 0 ? 'success' : 'error',
      )
      closeModal()
    } catch (err) {
      // The draft exists and the audience is queued; say so rather than
      // implying the whole thing evaporated.
      const msg = err instanceof Error && /not-found|internal|unavailable/i.test(err.message)
        ? 'Sending is not available yet — the campaign is saved as a draft with its audience queued.'
        : 'Send failed. The campaign is saved as a draft; open it to retry.'
      toast(msg, 'error')
      setEditId(campId)
      setStep('compose')
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

  const previewSubject = sample ? interpolateCampaign(draft.subject, sample) : draft.subject
  const previewBody    = sample ? interpolateCampaign(draft.body, sample) : draft.body
  const canSend = !!draft.name.trim() && !!draft.subject.trim() && !!draft.body.trim() && previewMatches.length > 0

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        {/* Cross-link to Bulk Contacts, which reads as the same feature from
            the nav but isn't: it exports a segment rather than sending one, and
            it's the only page that covers SMS. */}
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-white">Email campaigns</h1>
          {/* Was three stacked lines, two of them at 3.04:1. */}
          <p className="text-sm text-gray-400 mt-0.5">
            Tracked email sends. For SMS, or to export a list instead,{' '}
            <Link to="/blast" className="text-indigo-400 hover:text-indigo-300">Bulk Contacts</Link>.
          </p>
        </div>
        <button onClick={openNew} className="btn-primary text-sm px-4 py-2 shrink-0">+ New campaign</button>
      </div>

      {/* The audience is computed from the customer list, which caps at
          5,000 — and the hitCap flag was being dropped, so "Send to 4,213"
          could be an understatement with nothing saying so. */}
      {hitCap && <PartialDataBanner detail="Audience counts below are computed from this subset, so they may be understated." />}

      {/* Label above value, matching KpiCard on /chart and /forecast. */}
      {campaigns.length > 0 && (
        <div className="grid grid-cols-3 gap-3 mb-6">
          {[
            { label: 'Sent', value: totalSent.toLocaleString() },
            { label: 'Opened', value: totalOpened.toLocaleString() },
            { label: 'Open rate', value: totalSent > 0 ? `${avgOpenRate}%` : '—' },
          ].map(({ label, value }) => (
            <div key={label} className="card p-4 text-center">
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">{label}</p>
              <p className="text-2xl font-bold text-white mt-1 tabular-nums">{value}</p>
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
          {/* Was 📧 — emoji paint their own bitmap and ignore `color`. */}
          <Icon d={ICONS.envelope} className="w-9 h-9 mx-auto mb-3 text-gray-400" />
          <p className="text-gray-200 font-medium mb-1">No campaigns yet</p>
          <p className="text-sm text-gray-400 mb-4">Send a targeted email to a segment of your contacts</p>
          <button onClick={openNew} className="btn-primary text-sm px-4 py-2">Create first campaign</button>
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
                    /* Was text-gray-500 / gray-600 — 3.04:1 and 1.94:1. */
                    <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-gray-400">
                      <span>Sent <span className="text-gray-100 tabular-nums">{camp.sentCount.toLocaleString()}</span></span>
                      {camp.failedCount > 0 && (
                        <span>Failed <span className="text-red-300 tabular-nums">{camp.failedCount.toLocaleString()}</span></span>
                      )}
                      <span>Opened <span className="text-gray-100 tabular-nums">{camp.openCount.toLocaleString()}</span></span>
                      <span>Clicked <span className="text-gray-100 tabular-nums">{camp.clickCount.toLocaleString()}</span></span>
                      <span>Open rate <span className="text-gray-100 tabular-nums">{openRate(camp)}</span></span>
                      <span>{fmtDate(camp.sentAt)}</span>
                    </div>
                  )}
                  {camp.status === 'draft' && (
                    <p className="text-xs text-gray-400">Draft · created {fmtDate(camp.createdAt)}</p>
                  )}
                </div>
                <div className="flex gap-1.5 shrink-0 items-start">
                  <Link
                    to={`/campaigns/${camp.id}`}
                    className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors px-2 py-1 rounded hover:bg-gray-700"
                  >
                    Details
                  </Link>
                  {camp.status === 'draft' ? (
                    <button
                      onClick={() => openEdit(camp)}
                      className="text-xs text-gray-300 hover:text-white transition-colors px-2 py-1 rounded hover:bg-gray-700
                                 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                    >
                      Edit
                    </button>
                  ) : (
                    /* The obvious next action after a send, and there was no
                       way to do it. */
                    <button
                      onClick={() => duplicate(camp)}
                      className="text-xs text-gray-300 hover:text-white transition-colors px-2 py-1 rounded hover:bg-gray-700
                                 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                    >
                      Duplicate
                    </button>
                  )}
                  {/* Was text-gray-500 at 3.04:1 while the safe Details link
                      beside it was bright indigo. */}
                  <button
                    onClick={() => setConfirmDel(camp.id)}
                    className="text-xs text-red-400 hover:text-red-300 transition-colors px-2 py-1 rounded hover:bg-red-900/20
                               focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Compose → review → send. The send was one click of the most
          prominent button in the modal, with no confirmation and no preview
          of the merged message — the first time anyone saw {{firstName}}
          resolved was in an inbox. */}
      {editId && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-0 sm:px-4">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={closeModal} />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="campaign-modal-title"
            className="relative bg-gray-900 border border-gray-700 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-2xl shadow-2xl flex flex-col max-h-[94vh]"
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700 shrink-0">
              <p id="campaign-modal-title" className="font-semibold text-white">
                {step === 'review'
                  ? 'Review before sending'
                  : isNew ? 'New campaign' : `Edit: ${editingCampaign?.name ?? ''}`}
              </p>
              <button
                type="button"
                onClick={closeModal}
                aria-label="Close"
                className="p-1.5 -mr-1.5 rounded text-gray-400 hover:text-gray-200 hover:bg-gray-700/50
                           focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              >
                <Icon d={ICONS.close} className="w-5 h-5" />
              </button>
            </div>

            {step === 'compose' ? (
              <>
                <div className="flex-1 overflow-y-auto p-5 space-y-5">
                  <div>
                    {/* Every field label was text-gray-500 — 3.04:1. */}
                    <label htmlFor="camp-name" className="block text-xs text-gray-300 mb-1.5">Campaign name *</label>
                    <input
                      id="camp-name"
                      autoFocus
                      value={draft.name}
                      onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
                      placeholder="e.g. Summer promo 2026"
                      className="input-field w-full text-sm"
                    />
                  </div>

                  {/* Saved /templates entries, translated into the campaign
                      vocabulary on insert — {{name}} becomes {{fullName}},
                      and {{date}}/{{amount}} are flagged because the campaign
                      sender has no equivalent. */}
                  <TemplatePicker
                    dialect="campaign"
                    channel="email"
                    onInsert={({ subject: s, body: b }) =>
                      setDraft(d => ({ ...d, subject: s || d.subject, body: b }))
                    }
                  />

                  <div>
                    <label htmlFor="camp-subject" className="block text-xs text-gray-300 mb-1.5">Email subject *</label>
                    <input
                      id="camp-subject"
                      ref={subjectRef}
                      value={draft.subject}
                      onFocus={() => setTagTarget('subject')}
                      onChange={e => setDraft(d => ({ ...d, subject: e.target.value }))}
                      placeholder="e.g. Exclusive offer just for you, {{firstName}}!"
                      className="input-field w-full text-sm"
                    />
                  </div>

                  <div>
                    {/* Inserted into the body only; a merge field in the
                        subject had to be typed by hand. */}
                    <p className="text-xs text-gray-300 mb-1.5">
                      Insert into {tagTarget === 'subject' ? 'subject' : 'body'} at the cursor
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {CAMPAIGN_MERGE_FIELDS.map(f => (
                        <button
                          key={f.token}
                          type="button"
                          onMouseDown={e => e.preventDefault()}
                          onClick={() => insertMergeField(f.token)}
                          title={f.desc}
                          className="text-xs bg-gray-800 text-indigo-300 border border-gray-700 hover:border-indigo-500
                                     px-2 py-0.5 rounded-full font-mono transition-colors
                                     focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                        >
                          {f.token}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label htmlFor="camp-body" className="block text-xs text-gray-300 mb-1.5">Email body *</label>
                    {/* Not font-mono: this is customer-facing marketing copy
                        and it is sent as HTML paragraphs, so a monospace
                        composer misrepresented how it reads. */}
                    <textarea
                      id="camp-body"
                      ref={bodyRef}
                      value={draft.body}
                      onFocus={() => setTagTarget('body')}
                      onChange={e => setDraft(d => ({ ...d, body: e.target.value }))}
                      rows={10}
                      placeholder={"Hi {{firstName}},\n\nWe wanted to reach out with a special offer…\n\nBest regards,\nThe Team"}
                      className="input-field w-full text-sm resize-none leading-relaxed"
                    />
                  </div>

                  <div className="space-y-4">
                    <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Target audience</p>

                    <div>
                      <p className="text-xs text-gray-300 mb-2">Contact type <span className="text-gray-400">(leave blank for all)</span></p>
                      <div className="flex flex-wrap gap-2">
                        {CATEGORIES.map(cat => (
                          <button
                            key={cat}
                            type="button"
                            aria-pressed={draft.segment.categories.includes(cat)}
                            onClick={() => toggleCategory(cat)}
                            className={`text-xs px-3 py-1.5 rounded-lg border transition-colors
                                        focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                              draft.segment.categories.includes(cat)
                                ? 'bg-indigo-600/30 border-indigo-500 text-indigo-200'
                                : 'bg-gray-800 border-gray-700 text-gray-300 hover:border-gray-600'
                            }`}
                          >
                            {cat}
                          </button>
                        ))}
                      </div>
                    </div>

                    {allReps.length > 0 && (
                      <div>
                        <p className="text-xs text-gray-300 mb-2">Sales rep <span className="text-gray-400">(leave blank for all)</span></p>
                        <div className="flex flex-wrap gap-2">
                          {allReps.map(rep => (
                            <button
                              key={rep}
                              type="button"
                              aria-pressed={draft.segment.salesmen.includes(rep)}
                              onClick={() => toggleSalesman(rep)}
                              className={`text-xs px-3 py-1.5 rounded-lg border transition-colors
                                          focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                                draft.segment.salesmen.includes(rep)
                                  ? 'bg-teal-600/30 border-teal-500 text-teal-200'
                                  : 'bg-gray-800 border-gray-700 text-gray-300 hover:border-gray-600'
                              }`}
                            >
                              {rep}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Contacts without a usable address are excluded by
                        matchesSegment, which is worth stating rather than
                        implying through a segment field that had no control
                        and could never be false. */}
                    <div className={`rounded-xl p-3 border text-sm flex items-start gap-2 ${
                      previewMatches.length > 0
                        ? 'bg-green-500/10 border-green-700/30 text-green-200'
                        : 'bg-gray-800/50 border-gray-700 text-gray-300'
                    }`}>
                      <Icon
                        d={previewMatches.length > 0 ? ICONS.checkCircle : ICONS.warning}
                        className="w-4 h-4 shrink-0 mt-0.5"
                      />
                      <span>
                        {previewMatches.length > 0
                          ? `${previewMatches.length.toLocaleString()} contact${previewMatches.length !== 1 ? 's' : ''} match. Contacts without an email address are excluded.`
                          : 'No contacts match — broaden the filters, or add email addresses to your records.'}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="px-5 py-4 border-t border-gray-700 flex justify-between gap-3 shrink-0">
                  <button type="button" onClick={closeModal} className="btn-secondary text-sm px-4 py-2">Cancel</button>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={handleSaveDraft}
                      disabled={saving || sending || !draft.name.trim()}
                      className="btn-secondary text-sm px-4 py-2 disabled:opacity-40"
                    >
                      {saving ? 'Saving…' : 'Save draft'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setStep('review')}
                      disabled={saving || sending || !canSend}
                      className="btn-primary text-sm px-5 py-2 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      Review
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="flex-1 overflow-y-auto p-5 space-y-4">
                  <div className="px-3 py-2 rounded-lg text-sm bg-amber-900/25 border border-amber-600/40 text-amber-200 flex items-start gap-2">
                    <Icon d={ICONS.warning} className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>
                      This sends immediately to <strong className="tabular-nums">{previewMatches.length.toLocaleString()}</strong>{' '}
                      contact{previewMatches.length !== 1 ? 's' : ''} and cannot be recalled.
                    </span>
                  </div>

                  <div>
                    <p className="text-xs text-gray-300 mb-1.5">
                      {sample
                        ? `What ${[sample.first, sample.lastname].filter(Boolean).join(' ') || sample.email} receives`
                        : 'Preview'}
                    </p>
                    <div className="rounded-lg border border-gray-700 bg-gray-800 overflow-hidden">
                      <p className="px-3 py-2 text-sm font-semibold text-gray-100 border-b border-gray-700 break-words">
                        {previewSubject || <span className="text-gray-400 font-normal">(no subject)</span>}
                      </p>
                      <p className="px-3 py-2 text-sm text-gray-200 whitespace-pre-wrap max-h-56 overflow-y-auto break-words">
                        {previewBody}
                      </p>
                    </div>
                    {!sample && (
                      <p className="text-xs text-gray-400 mt-1">
                        No sample contact available, so merge fields are shown unresolved.
                      </p>
                    )}
                  </div>

                  <p className="text-xs text-gray-400">
                    Opens and clicks are tracked per recipient. Open the campaign afterwards for the
                    per-contact list, including anything the provider rejected.
                  </p>
                </div>

                <div className="px-5 py-4 border-t border-gray-700 flex justify-between gap-3 shrink-0">
                  <button
                    type="button"
                    onClick={() => setStep('compose')}
                    disabled={sending}
                    className="btn-secondary text-sm px-4 py-2 disabled:opacity-40"
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    autoFocus
                    onClick={handleSend}
                    disabled={sending || !canSend}
                    className="btn-primary text-sm px-5 py-2 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {sending ? 'Sending…' : `Send to ${previewMatches.length.toLocaleString()}`}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}


      {/* Delete was offered for sent campaigns with the same wording as a
          draft, and for a sent one "all its data" is the recipient list and
          the open history — the only record that the send happened. */}
      <ConfirmModal
        isOpen={!!confirmDel}
        message={(() => {
          const c = campaigns.find(x => x.id === confirmDel)
          if (!c) return ''
          return c.status === 'sent'
            ? `Delete "${c.name}"? This erases the record of the send to ${c.sentCount.toLocaleString()} contact${c.sentCount !== 1 ? 's' : ''}, including every open and click. It cannot be undone.`
            : `Delete the draft "${c.name}"? It has not been sent, so nothing else is affected.`
        })()}
        onConfirm={() => confirmDel && handleDelete(confirmDel)}
        onCancel={() => setConfirmDel(null)}
      />
    </div>
  )
}
