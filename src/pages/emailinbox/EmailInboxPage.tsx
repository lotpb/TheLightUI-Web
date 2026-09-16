import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { usePageTitle } from '../../hooks/usePageTitle'
import {
  subscribeToInboundInbox, setEmailRead, markAllEmailsRead,
  attachEmailToCustomer, deleteEmailMessage, sendEmail, INBOX_LIMIT,
} from '../../services/emailMessageService'
import type { EmailMessage } from '../../models/emailMessage'
import {
  describeInboxFilter, filterMessages, fullTimestamp, inboxCounts, isInboxFilter,
  isUnmatched, quoteBody, relativeTime, replySubject,
  INBOX_FILTERS, type InboxFilter,
} from '../../models/emailInbox'
import { useSharedCustomers } from '../../hooks/useSharedCustomers'
import { displayName, type CustomerItem } from '../../models/customer'
import { useToast } from '../../components/Toast'
import { usePermissions } from '../../hooks/usePermissions'
import ConfirmModal from '../../components/ConfirmModal'
import DraftReplyButton from '../../components/DraftReplyButton'
import TemplatePicker from '../../components/TemplatePicker'
import { Icon, ICONS } from '../../components/Icon'

export default function EmailInboxPage() {
  usePageTitle('Email Inbox')
  const toast = useToast()
  const { canEdit } = usePermissions()

  const [messages, setMessages] = useState<EmailMessage[]>([])
  const [loading, setLoading]   = useState(true)
  const [hitCap, setHitCap]     = useState(false)
  const [open, setOpen]         = useState<EmailMessage | null>(null)
  const [pendingDelete, setPendingDelete] = useState<EmailMessage | null>(null)
  const [markingAll, setMarkingAll] = useState(false)

  // Filter and search live in the URL, so "the unmatched replies" is a link.
  const [params, setParams] = useSearchParams()
  const filterParam = params.get('filter')
  const filter: InboxFilter = isInboxFilter(filterParam) ? filterParam : 'all'
  const search = params.get('q') ?? ''

  function setParam(key: string, value: string, fallback: string) {
    const next = new URLSearchParams(params)
    if (value === fallback) next.delete(key)
    else next.set(key, value)
    setParams(next, { replace: true })
  }

  useEffect(() => subscribeToInboundInbox(
    (items, cap) => { setMessages(items); setHitCap(cap); setLoading(false) },
    () => setLoading(false),
  ), [])

  const counts   = useMemo(() => inboxCounts(messages), [messages])
  const filtered = useMemo(() => filterMessages(messages, filter, search), [messages, filter, search])

  // Keep the open reader in step with the live snapshot, so attaching a
  // customer or toggling read updates the panel rather than stranding a stale
  // copy of the message.
  const openMessage = useMemo(
    () => (open ? messages.find(m => m.id === open.id) ?? null : null),
    [open, messages],
  )

  function openReader(m: EmailMessage) {
    setOpen(m)
    if (!m.read) setEmailRead(m.id, true).catch(() => {})
  }

  async function handleMarkAllRead() {
    setMarkingAll(true)
    try {
      await markAllEmailsRead(messages.filter(m => !m.read).map(m => m.id))
    } catch {
      toast('Could not mark all as read', 'error')
    } finally {
      setMarkingAll(false)
    }
  }

  async function handleDelete() {
    if (!pendingDelete) return
    const target = pendingDelete
    setPendingDelete(null)
    if (open?.id === target.id) setOpen(null)
    try {
      await deleteEmailMessage(target.id)
    } catch {
      toast('Could not delete the message', 'error')
    }
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">

      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Email Inbox</h1>
        {/* The old copy claimed replies were "matched to customer records",
            which is untrue for any reply from an address not on file. */}
        <p className="text-sm text-gray-400 mt-0.5">
          Replies to campaign &amp; automation emails. Ones we can tie to a record link to it;
          the rest land under Unmatched.
        </p>
      </div>

      {/* Setup notice. Was bg-yellow-950/20 — 1.01:1 against the card in dark
          mode and with no light-mode rule in index.css, leaving its text at
          3.31:1. The covered bg-yellow-900/20 is what /stripe-connect uses. */}
      <div className="card p-4 mb-6 border-yellow-600/40 bg-yellow-900/20">
        {/* The spaces around <code> are explicit {' '}, not the mx-1 margin
            this used to lean on. JSX drops the newline-and-indent between
            text and an adjacent element, so the sentence was really
            "pointed at theemailInboundWebhookCloud Function" — a margin made
            it look spaced while the text itself had no gap, which shows up
            the moment anyone copies it. /financing and /stripe-connect both
            use {' '} for this. */}
        <p className="text-xs text-yellow-300">
          <strong>Setup required:</strong> receiving replies here requires a custom domain verified in Resend
          with inbound email routing configured (MX records + an inbound webhook pointed at the{' '}
          {/* text-gray-100, not text-yellow-200: bg-gray-800 resolves to white
              in light mode, so pale yellow on it measured 1.16:1 — the one
              string a developer needs out of this banner was invisible. */}
          <code className="px-1 py-0.5 rounded bg-gray-800 text-gray-100">emailInboundWebhook</code>{' '}
          Cloud Function). Until that's set up, this inbox will stay empty even though outbound emails
          already carry the reply-to address needed to route replies back.
        </p>
      </div>

      {hitCap && (
        <div className="bg-yellow-900/20 border border-yellow-600/40 rounded-xl px-4 py-3 text-yellow-300 text-sm mb-4">
          <span className="flex items-start gap-2">
            <Icon d={ICONS.warning} className="w-4 h-4 shrink-0 mt-0.5" />
            <span>Showing the most recent {INBOX_LIMIT} replies only — older ones aren't listed here.</span>
          </span>
        </div>
      )}

      {/* Search and filters */}
      <div className="flex gap-2 mb-3">
        <div className="relative flex-1 min-w-0">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
            <Icon d={ICONS.search} className="w-4 h-4" />
          </span>
          <input
            type="search"
            value={search}
            onChange={e => setParam('q', e.target.value, '')}
            placeholder="Search sender, subject, or message…"
            aria-label="Search replies by sender, subject or message body"
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
        {counts.unread > 0 && (
          <button
            onClick={handleMarkAllRead}
            disabled={markingAll}
            className="btn-secondary text-sm px-3 py-2 shrink-0 whitespace-nowrap disabled:opacity-40"
          >
            {markingAll ? 'Marking…' : `Mark all read`}
          </button>
        )}
      </div>

      {/* Was a segmented control at 1.40:1 between its container and its
          active pill — "which tab am I on" carried almost entirely by text
          colour. Plain pills, the pattern every other list page uses. */}
      <div className="flex flex-wrap gap-2 mb-6">
        {INBOX_FILTERS.map(f => {
          const active = filter === f.key
          const count = counts[f.key]
          // Unmatched earns colour when it isn't empty: those are the replies
          // that need a person.
          const urgent = f.key === 'unmatched' && count > 0
          return (
            <button
              key={f.key}
              onClick={() => setParam('filter', f.key, 'all')}
              aria-pressed={active}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                active
                  ? 'bg-indigo-600 text-white'
                  : urgent
                    ? 'bg-amber-500/20 text-amber-300 hover:bg-amber-500/30'
                    : 'bg-gray-800 text-gray-400 hover:text-gray-200'
              }`}
            >
              {f.label}{loading ? '' : ` (${count})`}
            </button>
          )
        })}
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="card p-4 animate-pulse space-y-2">
              <div className="h-4 bg-gray-700 rounded w-1/3" />
              <div className="h-3 bg-gray-700/60 rounded w-1/2" />
              <div className="h-3 bg-gray-700/60 rounded w-2/3" />
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="card p-8 text-center">
          <Icon d={ICONS.envelope} className="w-8 h-8 mx-auto text-gray-400 mb-3" />
          <p className="text-gray-100 font-medium">
            {search.trim() ? `No replies match “${search.trim()}”` : 'No replies yet'}
          </p>
          <p className="text-sm text-gray-400 mt-1">
            {search.trim()
              ? `${counts[filter]} in ${describeInboxFilter(filter, '')}.`
              : 'Inbound replies will appear here once inbound routing is configured.'}
          </p>
          {search.trim() && (
            <button onClick={() => setParam('q', '', '')} className="btn-secondary text-sm px-4 py-2 mt-4">
              Clear search
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(m => (
            <MessageRow
              key={m.id}
              message={m}
              onOpen={() => openReader(m)}
              onDelete={() => setPendingDelete(m)}
              canEdit={canEdit}
            />
          ))}
        </div>
      )}

      {openMessage && (
        <MessageReader
          message={openMessage}
          canEdit={canEdit}
          onClose={() => setOpen(null)}
          onDelete={() => setPendingDelete(openMessage)}
        />
      )}

      <ConfirmModal
        isOpen={pendingDelete !== null}
        message={pendingDelete
          ? `Delete this reply from ${pendingDelete.fromAddress}? This cannot be undone, and it stays deleted from the customer's thread too.`
          : ''}
        onConfirm={handleDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  )
}

/**
 * A row is a button, not a div with onClick.
 *
 * It had no role, no tabIndex and no key handler, so marking a message read
 * was mouse-only — and the only focusable thing inside the clickable region
 * was the link that navigated away from it.
 */
function MessageRow({ message: m, onOpen, onDelete, canEdit }: {
  message: EmailMessage
  onOpen: () => void
  onDelete: () => void
  canEdit: boolean
}) {
  const unmatched = isUnmatched(m)

  return (
    <div className={`card flex items-stretch overflow-hidden transition-colors ${
      // border-indigo-600/50 was 1.47:1 against the card. indigo-500 at full
      // strength is the only version of this marker you can actually see.
      !m.read ? 'border-indigo-500' : ''
    }`}>
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Read reply from ${m.fromAddress}`}
        className="flex-1 min-w-0 text-left p-4 transition-colors hover:bg-gray-700/40
                   focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              {!m.read && <span className="w-2 h-2 rounded-full bg-indigo-500 shrink-0" />}
              <p className="font-semibold text-white truncate">{m.fromAddress}</p>
              {unmatched && (
                <span className="text-xs bg-amber-500/20 text-amber-300 px-2 py-0.5 rounded-full shrink-0">
                  Unmatched
                </span>
              )}
              {m.attachmentNames.length > 0 && (
                <span
                  title={m.attachmentNames.join(', ')}
                  className="text-xs text-gray-400 shrink-0 inline-flex items-center gap-1"
                >
                  <Icon d={ICONS.paperclip} className="w-3 h-3" />
                  {m.attachmentNames.length}
                </span>
              )}
            </div>
            <p className="text-sm text-gray-300 mt-1 truncate">{m.subject || '(no subject)'}</p>
            {/* Was text-gray-500 at 3.04:1 — the message itself, at the
                bottom of the contrast order. */}
            <p className="text-sm text-gray-400 mt-0.5 line-clamp-2 whitespace-pre-wrap">{m.body}</p>
          </div>
          {/* Was text-gray-600 at 1.94:1, and always an absolute date even
              for something nine minutes old. */}
          <span className="text-xs text-gray-400 shrink-0" title={fullTimestamp(m.createdAt)}>
            {relativeTime(m.createdAt)}
          </span>
        </div>
      </button>
      {canEdit && (
        <div className="shrink-0 flex items-center pr-2 pl-1">
          <button
            type="button"
            onClick={onDelete}
            aria-label={`Delete reply from ${m.fromAddress}`}
            className="w-9 h-9 flex items-center justify-center rounded-lg text-gray-400 hover:text-red-400 hover:bg-gray-700 transition-colors
                       focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
          >
            <Icon d={ICONS.trash} className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  )
}

/**
 * The reader.
 *
 * The page showed a 2-line clamp of every message and had no expand, no detail
 * view and no reply — so the only way to read a customer's answer past the
 * second line was to leave for the record page, and the only way to respond
 * was to find the thread there. Both `sendEmail` and DraftReplyButton already
 * existed; neither was wired up here.
 */
function MessageReader({ message: m, canEdit, onClose, onDelete }: {
  message: EmailMessage
  canEdit: boolean
  onClose: () => void
  onDelete: () => void
}) {
  const toast = useToast()
  const { items: customers } = useSharedCustomers()

  const [replying, setReplying] = useState(false)
  const [subject, setSubject]   = useState(replySubject(m.subject))
  const [body, setBody]         = useState('')
  const [sending, setSending]   = useState(false)
  const [attaching, setAttaching] = useState(false)
  const [customerQuery, setCustomerQuery] = useState('')

  const unmatched = isUnmatched(m)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  // Re-seed the reply subject when a different message is opened.
  useEffect(() => {
    setSubject(replySubject(m.subject))
    setBody('')
    setReplying(false)
  }, [m.id, m.subject])

  const matches = useMemo(() => {
    const q = customerQuery.trim().toLowerCase()
    if (!q) return [] as CustomerItem[]
    return customers
      .filter(c =>
        displayName(c).toLowerCase().includes(q) ||
        c.email.toLowerCase().includes(q),
      )
      .slice(0, 8)
  }, [customers, customerQuery])

  async function handleAttach(c: CustomerItem) {
    setAttaching(true)
    try {
      await attachEmailToCustomer(m.id, c.id)
      toast(`Attached to ${displayName(c)}`, 'success')
      setCustomerQuery('')
    } catch {
      toast('Could not attach this reply', 'error')
    } finally {
      setAttaching(false)
    }
  }

  async function handleSend() {
    if (!body.trim()) return
    setSending(true)
    try {
      await sendEmail(m.customerId, subject.trim() || replySubject(m.subject), body.trim())
      toast('Reply sent', 'success')
      setReplying(false)
      setBody('')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not send the reply', 'error')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Reply from ${m.fromAddress}`}
        className="relative bg-gray-800 border border-gray-600 rounded-2xl shadow-2xl w-full max-w-2xl max-h-full flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-gray-700 shrink-0">
          <div className="min-w-0">
            <p className="text-base font-semibold text-white truncate">{m.subject || '(no subject)'}</p>
            <p className="text-sm text-gray-400 mt-0.5 truncate">
              From {m.fromAddress} · {fullTimestamp(m.createdAt)}
            </p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => { setEmailRead(m.id, !m.read).catch(() => {}) }}
              title={m.read ? 'Mark as unread' : 'Mark as read'}
              aria-label={m.read ? 'Mark as unread' : 'Mark as read'}
              className="w-9 h-9 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-100 hover:bg-gray-700 transition-colors"
            >
              <Icon d={m.read ? ICONS.envelope : ICONS.check} className="w-4 h-4" />
            </button>
            {canEdit && (
              <button
                type="button"
                onClick={onDelete}
                title="Delete"
                aria-label="Delete this reply"
                className="w-9 h-9 flex items-center justify-center rounded-lg text-gray-400 hover:text-red-400 hover:bg-gray-700 transition-colors"
              >
                <Icon d={ICONS.trash} className="w-4 h-4" />
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="w-9 h-9 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-100 hover:bg-gray-700 transition-colors"
            >
              <Icon d={ICONS.close} className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body — the whole message, which is the point */}
        <div className="px-5 py-4 overflow-y-auto flex-1 min-h-0">
          <p className="text-sm text-gray-200 whitespace-pre-wrap break-words">{m.body || '(empty message)'}</p>

          {m.attachmentNames.length > 0 && (
            <div className="mt-4 border-t border-gray-700 pt-3">
              <p className="text-xs text-gray-400 mb-1.5">
                {m.attachmentNames.length} attachment{m.attachmentNames.length === 1 ? '' : 's'} — names only;
                the files aren't stored, so open them from your mail client.
              </p>
              <ul className="space-y-1">
                {m.attachmentNames.map(name => (
                  <li key={name} className="text-xs text-gray-300 inline-flex items-center gap-1.5">
                    <Icon d={ICONS.paperclip} className="w-3 h-3 shrink-0" />
                    {name}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Footer: attach, or reply */}
        <div className="px-5 py-4 border-t border-gray-700 shrink-0 space-y-3">
          {unmatched ? (
            <>
              <p className="text-xs text-amber-300">
                This address isn't on any record, so there's nobody to thread a reply to. Attach it to a
                customer to answer from here.
              </p>
              {canEdit && (
                <div>
                  <label htmlFor="attach-customer" className="sr-only">Find a customer</label>
                  <input
                    id="attach-customer"
                    type="search"
                    value={customerQuery}
                    onChange={e => setCustomerQuery(e.target.value)}
                    placeholder="Find a customer by name or email…"
                    className="input-field w-full text-sm py-2"
                  />
                  {matches.length > 0 && (
                    <ul className="mt-2 border border-gray-600 rounded-xl overflow-hidden divide-y divide-gray-700">
                      {matches.map(c => (
                        <li key={c.id}>
                          <button
                            type="button"
                            onClick={() => handleAttach(c)}
                            disabled={attaching}
                            className="w-full text-left px-3 py-2 text-sm text-gray-200 hover:bg-gray-700/60 transition-colors disabled:opacity-40"
                          >
                            {displayName(c)}
                            {c.email && <span className="text-gray-400"> · {c.email}</span>}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </>
          ) : replying ? (
            <>
              <div>
                <label htmlFor="reply-subject" className="text-xs text-gray-400 block mb-1">Subject</label>
                <input
                  id="reply-subject"
                  type="text"
                  value={subject}
                  onChange={e => setSubject(e.target.value)}
                  className="input-field w-full text-sm py-2"
                />
              </div>
              <div>
                <label htmlFor="reply-body" className="text-xs text-gray-400 block mb-1">Message</label>
                <textarea
                  id="reply-body"
                  rows={5}
                  value={body}
                  onChange={e => setBody(e.target.value)}
                  placeholder="Write your reply…"
                  className="input-field w-full text-sm resize-y"
                />
              </div>
              {/* The reply composer couldn't reach a saved template either. */}
              <TemplatePicker
                dialect="record"
                channel="email"
                onInsert={({ subject: s, body: b }) => { if (s) setSubject(s); setBody(b) }}
                disabled={sending}
              />
              <div className="flex items-center gap-2 flex-wrap">
                <DraftReplyButton
                  customerId={m.customerId}
                  channel="email"
                  currentValue={body}
                  onDraft={({ body: draft, subject: draftSubject }) => {
                    setBody(draft)
                    if (draftSubject) setSubject(draftSubject)
                  }}
                  disabled={sending}
                />
                <button
                  type="button"
                  onClick={() => setBody(prev => prev + quoteBody(m))}
                  className="btn-secondary text-sm px-3 py-1.5"
                >
                  Quote original
                </button>
                <div className="flex-1" />
                <button type="button" onClick={() => setReplying(false)} className="btn-secondary text-sm px-3 py-1.5">
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSend}
                  disabled={sending || !body.trim()}
                  className="btn-primary text-sm px-4 py-1.5 disabled:opacity-40"
                >
                  {sending ? 'Sending…' : 'Send reply'}
                </button>
              </div>
            </>
          ) : (
            <div className="flex items-center gap-2 flex-wrap">
              {canEdit && (
                <button
                  type="button"
                  onClick={() => setReplying(true)}
                  className="btn-primary text-sm px-4 py-1.5 inline-flex items-center gap-1.5"
                >
                  <Icon d={ICONS.envelope} className="w-4 h-4" />
                  Reply
                </button>
              )}
              <Link to={`/records/${m.customerId}`} className="btn-secondary text-sm px-3 py-1.5">
                View customer
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
