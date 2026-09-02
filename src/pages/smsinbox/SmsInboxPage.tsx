import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { usePageTitle } from '../../hooks/usePageTitle'
import { useToast } from '../../components/Toast'
import { subscribeToInboundSmsInbox, markSmsRead } from '../../services/smsMessageService'
import { subscribeToCompanyProfile, saveCompanyProfile, EMPTY_PROFILE, type CompanyProfile } from '../../services/companyProfileService'
import type { SmsMessage } from '../../models/smsMessage'

function fmtDate(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) + ' · ' +
    d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

export default function SmsInboxPage() {
  usePageTitle('Text Inbox')
  const toast = useToast()

  const [messages, setMessages] = useState<SmsMessage[]>([])
  const [loading, setLoading]   = useState(true)
  const [filter, setFilter]     = useState<'all' | 'unread'>('all')

  const [profile, setProfile]   = useState<CompanyProfile>(EMPTY_PROFILE)
  const [smsNumber, setSmsNumber] = useState('')
  const [saving, setSaving]     = useState(false)

  useEffect(() => subscribeToInboundSmsInbox(
    items => { setMessages(items); setLoading(false) },
    () => setLoading(false),
  ), [])

  useEffect(() => subscribeToCompanyProfile(
    p => { setProfile(p); setSmsNumber(p.smsNumber ?? '') },
    () => {},
  ), [])

  const filtered = useMemo(
    () => filter === 'unread' ? messages.filter(m => !m.read) : messages,
    [messages, filter],
  )
  const unreadCount = useMemo(() => messages.filter(m => !m.read).length, [messages])

  async function handleSaveNumber() {
    setSaving(true)
    try {
      await saveCompanyProfile({ ...profile, smsNumber: smsNumber.trim() })
      toast('SMS number saved', 'success')
    } catch {
      toast('Could not save SMS number', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">

      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Text Inbox</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Two-way SMS with customers, sent from the "Message" action on a customer record
        </p>
      </div>

      <div className="card p-4 mb-6 space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Twilio setup</p>
        <p className="text-xs text-gray-500">
          Enter the Twilio phone number this company sends/receives texts from (E.164 format, e.g. +15551234567).
          Requires <code className="mx-1 px-1 py-0.5 rounded bg-gray-800 text-gray-300">TWILIO_ACCOUNT_SID</code> and
          <code className="mx-1 px-1 py-0.5 rounded bg-gray-800 text-gray-300">TWILIO_AUTH_TOKEN</code> configured as
          Firebase secrets, and the Twilio number's webhooks pointed at the
          <code className="mx-1 px-1 py-0.5 rounded bg-gray-800 text-gray-300">smsInboundWebhook</code> /
          <code className="mx-1 px-1 py-0.5 rounded bg-gray-800 text-gray-300">smsStatusWebhook</code> Cloud Functions.
        </p>
        <div className="flex gap-2">
          <input
            type="text"
            value={smsNumber}
            onChange={e => setSmsNumber(e.target.value)}
            placeholder="+15551234567"
            className="input-field text-sm flex-1"
          />
          <button onClick={handleSaveNumber} disabled={saving} className="btn-primary text-sm px-4">
            {saving ? '…' : 'Save'}
          </button>
        </div>
      </div>

      <div className="flex gap-1 mb-6 bg-gray-800/60 p-1 rounded-xl w-fit">
        {(['all', 'unread'] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`text-sm px-4 py-1.5 rounded-lg font-medium transition-colors ${
              filter === f ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            {f === 'all' ? 'All' : `Unread${unreadCount > 0 ? ` (${unreadCount})` : ''}`}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : filtered.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="text-gray-400 font-medium">No texts yet</p>
          <p className="text-sm text-gray-600 mt-1">Inbound replies will appear here once Twilio is configured.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(m => (
            <div
              key={m.id}
              onClick={() => !m.read && markSmsRead(m.id)}
              className={`card p-4 cursor-pointer transition-colors ${!m.read ? 'border-indigo-600/50' : ''}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    {!m.read && <span className="w-2 h-2 rounded-full bg-indigo-400 shrink-0" />}
                    <p className="font-semibold text-white truncate">{m.fromNumber}</p>
                  </div>
                  <p className="text-sm text-gray-500 mt-0.5 line-clamp-2 whitespace-pre-wrap">{m.body}</p>
                  {m.customerId && (
                    <Link
                      to={`/records/${m.customerId}`}
                      onClick={e => e.stopPropagation()}
                      className="text-xs text-indigo-400 hover:text-indigo-300 mt-1.5 inline-block"
                    >
                      View customer →
                    </Link>
                  )}
                </div>
                <span className="text-xs text-gray-600 shrink-0">{fmtDate(m.createdAt)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
