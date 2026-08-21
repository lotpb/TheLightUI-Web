import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { getCampaign, subscribeToRecipients, deleteCampaign } from '../../services/campaignService'
import { RECIPIENT_STATUS_COLORS, STATUS_COLORS, STATUS_LABELS } from '../../models/campaign'
import type { Campaign, CampaignRecipient } from '../../models/campaign'
import { useToast } from '../../components/Toast'
import { usePageTitle } from '../../hooks/usePageTitle'
import ConfirmModal from '../../components/ConfirmModal'

function fmtDate(d: Date | null): string {
  if (!d) return '—'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function pct(num: number, den: number): string {
  if (!den) return '—'
  return `${Math.round((num / den) * 100)}%`
}

const RCPT_STATUS_LABELS: Record<CampaignRecipient['status'], string> = {
  sent:    'Sent',
  opened:  'Opened',
  clicked: 'Clicked',
  bounced: 'Bounced',
}

export default function CampaignDetailPage() {
  usePageTitle('Campaign Details')
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const toast = useToast()

  const [campaign,    setCampaign]    = useState<Campaign | null>(null)
  const [recipients,  setRecipients]  = useState<CampaignRecipient[]>([])
  const [loading,     setLoading]     = useState(true)
  const [bodyOpen,    setBodyOpen]    = useState(false)
  const [confirmDel,  setConfirmDel]  = useState(false)
  const [search,      setSearch]      = useState('')
  const [filterStatus, setFilterStatus] = useState<CampaignRecipient['status'] | 'all'>('all')

  useEffect(() => {
    if (!id) return
    getCampaign(id).then(c => { setCampaign(c); setLoading(false) }).catch(() => setLoading(false))
    const unsub = subscribeToRecipients(id, setRecipients, () => {})
    return unsub
  }, [id])

  async function handleDelete() {
    if (!id) return
    try {
      await deleteCampaign(id)
      toast('Campaign deleted', 'success')
      navigate('/campaigns')
    } catch {
      toast('Failed to delete campaign', 'error')
    }
  }

  const filtered = recipients.filter(r => {
    const q = search.toLowerCase()
    const matchSearch = !q || r.customerName.toLowerCase().includes(q) || r.customerEmail.toLowerCase().includes(q)
    const matchStatus = filterStatus === 'all' || r.status === filterStatus
    return matchSearch && matchStatus
  })

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-6 animate-pulse space-y-4">
        <div className="h-6 bg-gray-700 rounded w-48" />
        <div className="h-32 bg-gray-800 rounded-xl" />
      </div>
    )
  }

  if (!campaign) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-6 text-center text-gray-500">
        Campaign not found.
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">

      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <button onClick={() => navigate('/campaigns')} className="text-xs text-gray-500 hover:text-gray-300 mb-2 flex items-center gap-1 transition-colors">
            ← Campaigns
          </button>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl font-bold text-white truncate">{campaign.name}</h1>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[campaign.status]}`}>
              {STATUS_LABELS[campaign.status]}
            </span>
          </div>
          <p className="text-sm text-gray-400 mt-0.5 truncate">{campaign.subject}</p>
        </div>
        <button
          onClick={() => setConfirmDel(true)}
          className="text-xs text-gray-500 hover:text-red-400 transition-colors px-3 py-1.5 rounded-lg hover:bg-gray-800 border border-transparent hover:border-gray-700 shrink-0"
        >
          Delete
        </button>
      </div>

      {/* Stats (only if sent) */}
      {campaign.status === 'sent' && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Sent',       value: campaign.sentCount.toLocaleString() },
            { label: 'Opened',     value: campaign.openCount.toLocaleString(),  sub: pct(campaign.openCount,  campaign.sentCount) },
            { label: 'Clicked',    value: campaign.clickCount.toLocaleString(), sub: pct(campaign.clickCount, campaign.sentCount) },
            { label: 'Bounced',    value: recipients.filter(r => r.status === 'bounced').length.toLocaleString() },
          ].map(({ label, value, sub }) => (
            <div key={label} className="card p-4 text-center">
              <p className="text-xl font-bold text-white">{value}</p>
              {sub && <p className="text-xs text-gray-500">{sub}</p>}
              <p className="text-xs text-gray-500 mt-0.5">{label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Info */}
      <div className="card p-4 space-y-2 text-sm">
        <div className="flex justify-between gap-2">
          <span className="text-gray-500">Sent at</span>
          <span className="text-gray-300">{fmtDate(campaign.sentAt)}</span>
        </div>
        <div className="flex justify-between gap-2">
          <span className="text-gray-500">Audience</span>
          <span className="text-gray-300 text-right">
            {campaign.segment.categories.length > 0
              ? campaign.segment.categories.join(', ')
              : 'All contacts'}
            {campaign.segment.salesmen.length > 0 && ` · ${campaign.segment.salesmen.join(', ')}`}
          </span>
        </div>
        <div>
          <button
            onClick={() => setBodyOpen(v => !v)}
            className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
          >
            {bodyOpen ? 'Hide email body ↑' : 'Show email body ↓'}
          </button>
          {bodyOpen && (
            <pre className="mt-2 text-xs text-gray-400 bg-gray-800/60 rounded-lg p-3 whitespace-pre-wrap overflow-x-auto border border-gray-700">
              {campaign.body}
            </pre>
          )}
        </div>
      </div>

      {/* Recipients */}
      {recipients.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-gray-400 mb-3">
            Recipients ({recipients.length})
          </h2>

          {/* Filters */}
          <div className="flex gap-2 mb-3 flex-wrap">
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search name or email…"
              className="input-field text-sm py-1.5 flex-1 min-w-0"
            />
            <select
              value={filterStatus}
              onChange={e => setFilterStatus(e.target.value as CampaignRecipient['status'] | 'all')}
              className="input-field text-sm py-1.5 pr-8"
            >
              <option value="all">All statuses</option>
              {(['sent', 'opened', 'clicked', 'bounced'] as const).map(s => (
                <option key={s} value={s}>{RCPT_STATUS_LABELS[s]}</option>
              ))}
            </select>
          </div>

          {/* Table */}
          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-700 text-xs text-gray-500">
                    <th className="text-left px-4 py-2.5 font-medium">Contact</th>
                    <th className="text-left px-4 py-2.5 font-medium">Email</th>
                    <th className="text-left px-4 py-2.5 font-medium">Status</th>
                    <th className="text-left px-4 py-2.5 font-medium">Opened</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="text-center text-gray-500 py-8 text-xs">No recipients match filters</td>
                    </tr>
                  ) : (
                    filtered.map((r, i) => (
                      <tr
                        key={r.id}
                        className={`border-b border-gray-800/50 last:border-0 hover:bg-gray-800/30 transition-colors ${i % 2 === 0 ? '' : 'bg-gray-800/10'}`}
                      >
                        <td className="px-4 py-2.5 font-medium text-gray-200 truncate max-w-[140px]">{r.customerName || '—'}</td>
                        <td className="px-4 py-2.5 text-gray-400 truncate max-w-[160px]">{r.customerEmail}</td>
                        <td className="px-4 py-2.5">
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${RECIPIENT_STATUS_COLORS[r.status]}`}>
                            {RCPT_STATUS_LABELS[r.status]}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-gray-500 text-xs whitespace-nowrap">
                          {r.openedAt ? fmtDate(r.openedAt) : '—'}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      <ConfirmModal
        isOpen={confirmDel}
        message="Delete this campaign and all recipient records? This cannot be undone."
        onConfirm={handleDelete}
        onCancel={() => setConfirmDel(false)}
      />
    </div>
  )
}
