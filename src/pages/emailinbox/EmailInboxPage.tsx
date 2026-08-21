import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { usePageTitle } from '../../hooks/usePageTitle'
import { subscribeToInboundInbox, markEmailRead } from '../../services/emailMessageService'
import type { EmailMessage } from '../../models/emailMessage'

function fmtDate(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) + ' · ' +
    d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

export default function EmailInboxPage() {
  usePageTitle('Email Inbox')

  const [messages, setMessages] = useState<EmailMessage[]>([])
  const [loading, setLoading]   = useState(true)
  const [filter, setFilter]     = useState<'all' | 'unread'>('all')

  useEffect(() => subscribeToInboundInbox(
    items => { setMessages(items); setLoading(false) },
    () => setLoading(false),
  ), [])

  const filtered = useMemo(
    () => filter === 'unread' ? messages.filter(m => !m.read) : messages,
    [messages, filter],
  )
  const unreadCount = useMemo(() => messages.filter(m => !m.read).length, [messages])

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">

      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Email Inbox</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Replies to campaign &amp; automation emails, matched to customer records
        </p>
      </div>

      {/* Setup notice */}
      <div className="card p-4 mb-6 border-yellow-700/40 bg-yellow-950/20">
        <p className="text-xs text-yellow-300">
          <strong>Setup required:</strong> receiving replies here requires a custom domain verified in Resend
          with inbound email routing configured (MX records + an inbound webhook pointed at the
          <code className="mx-1 px-1 py-0.5 rounded bg-gray-800 text-yellow-200">emailInboundWebhook</code>
          Cloud Function). Until that's set up, this inbox will stay empty even though outbound emails
          already carry the reply-to address needed to route replies back.
        </p>
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
          <p className="text-gray-400 font-medium">No replies yet</p>
          <p className="text-sm text-gray-600 mt-1">Inbound replies will appear here once inbound routing is configured.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(m => (
            <div
              key={m.id}
              onClick={() => !m.read && markEmailRead(m.id)}
              className={`card p-4 cursor-pointer transition-colors ${!m.read ? 'border-indigo-600/50' : ''}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    {!m.read && <span className="w-2 h-2 rounded-full bg-indigo-400 shrink-0" />}
                    <p className="font-semibold text-white truncate">{m.fromAddress}</p>
                  </div>
                  <p className="text-sm text-gray-300 mt-1 truncate">{m.subject || '(no subject)'}</p>
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
