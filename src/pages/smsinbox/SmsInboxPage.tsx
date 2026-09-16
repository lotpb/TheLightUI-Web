import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { usePageTitle } from '../../hooks/usePageTitle'
import { useToast } from '../../components/Toast'
import {
  subscribeToInboundSmsInbox, subscribeToFailedSms, setSmsRead, markAllSmsRead,
  attachSmsToCustomer, deleteSmsMessage, sendSms, SMS_INBOX_LIMIT,
} from '../../services/smsMessageService'
import { subscribeToCompanyProfile, saveCompanyProfile, EMPTY_PROFILE, type CompanyProfile } from '../../services/companyProfileService'
import type { SmsMessage } from '../../models/smsMessage'
import {
  describeSmsFilter, filterSmsMessages, formatPhone, fullTimestamp, isE164, isSmsFilter,
  isUnmatched, lastTenDigits, normalizeToE164, relativeTime, smsCounts, smsIntent,
  smsStatusMeta, SMS_FILTERS, type SmsFilter,
} from '../../models/smsInbox'
import { useSharedCustomers } from '../../hooks/useSharedCustomers'
import { displayName, type CustomerItem } from '../../models/customer'
import { usePermissions } from '../../hooks/usePermissions'
import ConfirmModal from '../../components/ConfirmModal'
import CollapsibleSection from '../../components/CollapsibleSection'
import { Icon, ICONS } from '../../components/Icon'

export default function SmsInboxPage() {
  usePageTitle('Text Inbox')
  const toast = useToast()
  const { canEdit } = usePermissions()
  const { items: customers } = useSharedCustomers()

  const [messages, setMessages] = useState<SmsMessage[]>([])
  const [failed, setFailed]     = useState<SmsMessage[]>([])
  const [loading, setLoading]   = useState(true)
  const [hitCap, setHitCap]     = useState(false)
  const [open, setOpen]         = useState<SmsMessage | null>(null)
  const [pendingDelete, setPendingDelete] = useState<SmsMessage | null>(null)
  const [markingAll, setMarkingAll] = useState(false)

  const [profile, setProfile]   = useState<CompanyProfile>(EMPTY_PROFILE)
  const [smsNumber, setSmsNumber] = useState('')
  const [saving, setSaving]     = useState(false)

  const [params, setParams] = useSearchParams()
  const filterParam = params.get('filter')
  const filter: SmsFilter = isSmsFilter(filterParam) ? filterParam : 'all'
  const search = params.get('q') ?? ''

  function setParam(key: string, value: string, fallback: string) {
    const next = new URLSearchParams(params)
    if (value === fallback) next.delete(key)
    else next.set(key, value)
    setParams(next, { replace: true })
  }

  useEffect(() => subscribeToInboundSmsInbox(
    (items, cap) => { setMessages(items); setHitCap(cap); setLoading(false) },
    () => setLoading(false),
  ), [])

  useEffect(() => subscribeToFailedSms(setFailed, () => {}), [])

  useEffect(() => subscribeToCompanyProfile(
    p => { setProfile(p); setSmsNumber(p.smsNumber ?? '') },
    () => {},
  ), [])

  const counts   = useMemo(() => smsCounts(messages), [messages])
  const filtered = useMemo(() => filterSmsMessages(messages, filter, search), [messages, filter, search])

  /** Customer lookup by id, so a matched text can show a name. */
  const byId = useMemo(() => {
    const m = new Map<string, CustomerItem>()
    for (const c of customers) m.set(c.id, c)
    return m
  }, [customers])

  /**
   * Who has unsubscribed.
   *
   * smsOptOuts is locked to Cloud Functions in firestore.rules (read, write:
   * if false), deliberately — it's keyed by phone and includes numbers that
   * aren't customers. Customers.smsOptOut is the client-readable mirror the
   * webhook maintains, and it was being parsed into CustomerItem and rendered
   * on no page at all.
   */
  const optedOut = useMemo(
    () => customers.filter(c => c.smsOptOut).sort((a, b) => displayName(a).localeCompare(displayName(b))),
    [customers],
  )

  const openMessage = useMemo(
    () => (open ? messages.find(m => m.id === open.id) ?? null : null),
    [open, messages],
  )

  function openReader(m: SmsMessage) {
    setOpen(m)
    if (!m.read) setSmsRead(m.id, true).catch(() => {})
  }

  /**
   * The number has to be E.164 or the whole feature silently dies.
   *
   * audit.ts keys smsNumberIndex on the raw stored string while Twilio's
   * inbound `To` is always E.164 — so a friendly-looking number created an
   * index entry that could never match, and the inbox stayed permanently
   * empty behind a green "saved" toast.
   */
  const normalized  = normalizeToE164(smsNumber)
  const numberValid = smsNumber.trim() === '' || isE164(smsNumber)
  const canFix      = !numberValid && normalized !== null

  async function handleSaveNumber() {
    const value = smsNumber.trim()
    if (value !== '' && !isE164(value)) {
      toast(
        normalized
          ? `Use E.164 format — did you mean ${normalized}?`
          : 'Use E.164 format, e.g. +15551234567. Twilio only routes to an exact match.',
        'error',
      )
      return
    }
    setSaving(true)
    try {
      await saveCompanyProfile({ ...profile, smsNumber: value })
      toast(value ? `Texts to ${formatPhone(value)} will arrive here` : 'SMS number cleared', 'success')
    } catch {
      toast('Could not save SMS number', 'error')
    } finally {
      setSaving(false)
    }
  }

  async function handleMarkAllRead() {
    setMarkingAll(true)
    try {
      await markAllSmsRead(messages.filter(m => !m.read).map(m => m.id))
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
      await deleteSmsMessage(target.id)
    } catch {
      toast('Could not delete the text', 'error')
    }
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">

      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Text Inbox</h1>
        <p className="text-sm text-gray-400 mt-0.5">
          Two-way SMS with customers. Reply from here, or from the "Message" action on a record.
        </p>
      </div>

      <div className="card p-4 mb-6 space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Twilio setup</p>
        <p className="text-xs text-gray-400">
          Enter the Twilio phone number this company sends/receives texts from (E.164 format, e.g. +15551234567).
          {/* Explicit {' '} at every text/element boundary. JSX drops the
              newline-and-indent between prose and an adjacent element, so this
              read "and TWILIO_AUTH_TOKEN" only because of the mx-1 margin —
              the string itself was "andTWILIO_AUTH_TOKEN", which is what you
              get if you copy it. Same defect as the /email-inbox banner. */}
          Requires <code className="px-1 py-0.5 rounded bg-gray-800 text-gray-300">TWILIO_ACCOUNT_SID</code>{' '}
          and{' '}
          <code className="px-1 py-0.5 rounded bg-gray-800 text-gray-300">TWILIO_AUTH_TOKEN</code>{' '}
          configured as Firebase secrets, and the Twilio number's webhooks pointed at the{' '}
          <code className="px-1 py-0.5 rounded bg-gray-800 text-gray-300">smsInboundWebhook</code>{' '}
          /{' '}
          <code className="px-1 py-0.5 rounded bg-gray-800 text-gray-300">smsStatusWebhook</code>{' '}
          Cloud Functions.
        </p>
        <div>
          <label htmlFor="sms-number" className="sr-only">Twilio phone number</label>
          <div className="flex gap-2">
            <input
              id="sms-number"
              type="tel"
              inputMode="tel"
              value={smsNumber}
              onChange={e => setSmsNumber(e.target.value)}
              placeholder="+15551234567"
              aria-invalid={!numberValid}
              aria-describedby="sms-number-hint"
              className={`input-field text-sm flex-1 ${!numberValid ? 'border-red-500' : ''}`}
            />
            <button
              onClick={handleSaveNumber}
              disabled={saving || !numberValid}
              className="btn-primary text-sm px-4 py-2 disabled:opacity-40"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
          {/* The field stated a format in prose and enforced nothing, and
              getting it wrong disabled the feature with a success toast. */}
          <p id="sms-number-hint" className="text-xs mt-1.5">
            {numberValid
              ? smsNumber.trim()
                ? <span className="text-gray-400">Routing texts for {formatPhone(smsNumber)}.</span>
                : <span className="text-gray-400">Must match your Twilio number exactly — Twilio routes on E.164.</span>
              : (
                <span className="text-red-400">
                  Not E.164 — Twilio sends the number as e.g. +15551234567 and only an exact match routes.
                  {canFix && (
                    <>
                      {' '}
                      <button
                        type="button"
                        onClick={() => setSmsNumber(normalized!)}
                        className="underline hover:text-red-300"
                      >
                        Use {normalized}
                      </button>
                    </>
                  )}
                </span>
              )}
          </p>
        </div>
      </div>

      {/* Failed outbound texts. smsStatusWebhook has always written status and
          errorMessage; nothing read them, so an undelivered text was findable
          only by opening that one record. */}
      {failed.length > 0 && (
        <div className="mb-6">
          <CollapsibleSection title="Failed to deliver" count={failed.length}>
            <div className="card divide-y divide-gray-700/50">
              {failed.map(m => {
                const c = byId.get(m.customerId)
                return (
                  <div key={m.id} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-100 truncate">
                          {c ? displayName(c) : formatPhone(m.toNumber)}
                        </p>
                        <p className="text-sm text-gray-400 mt-0.5 line-clamp-2 whitespace-pre-wrap">{m.body}</p>
                        <p className="text-xs text-red-400 mt-1">
                          {m.errorMessage || 'Twilio reported this as failed with no reason given.'}
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        <span className="text-xs text-gray-400" title={fullTimestamp(m.createdAt)}>
                          {relativeTime(m.createdAt)}
                        </span>
                        {m.customerId && (
                          <Link to={`/records/${m.customerId}`} className="text-xs text-indigo-400 hover:text-indigo-300">
                            Open record
                          </Link>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </CollapsibleSection>
        </div>
      )}

      {/* Who has unsubscribed. The webhook writes this and no page showed it,
          which for SMS is the one list you must not text against. */}
      {optedOut.length > 0 && (
        <div className="mb-6">
          <CollapsibleSection title="Opted out of texts" count={optedOut.length}>
            <div className="card p-4">
              <p className="text-xs text-gray-400 mb-3">
                These customers texted STOP. Automations and bulk sends already skip them; don't text them
                manually either. They can text START to resubscribe.
              </p>
              <ul className="flex flex-wrap gap-2">
                {optedOut.map(c => (
                  <li key={c.id}>
                    <Link
                      to={`/records/${c.id}`}
                      className="inline-flex items-center gap-1.5 text-xs bg-red-500/20 text-red-300 px-2 py-1 rounded-full hover:bg-red-500/30 transition-colors"
                    >
                      {displayName(c)}
                      {c.phone && <span className="text-red-300/80">{formatPhone(c.phone)}</span>}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </CollapsibleSection>
        </div>
      )}

      {hitCap && (
        <div className="bg-yellow-900/20 border border-yellow-600/40 rounded-xl px-4 py-3 text-yellow-300 text-sm mb-4">
          <span className="flex items-start gap-2">
            <Icon d={ICONS.warning} className="w-4 h-4 shrink-0 mt-0.5" />
            <span>Showing the most recent {SMS_INBOX_LIMIT} texts only — older ones aren't listed here.</span>
          </span>
        </div>
      )}

      {/* Search */}
      <div className="flex gap-2 mb-3">
        <div className="relative flex-1 min-w-0">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
            <Icon d={ICONS.search} className="w-4 h-4" />
          </span>
          <input
            type="search"
            value={search}
            onChange={e => setParam('q', e.target.value, '')}
            placeholder="Search texts or phone number…"
            aria-label="Search texts by message body or phone number"
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
            {markingAll ? 'Marking…' : 'Mark all read'}
          </button>
        )}
      </div>

      {/* Was a segmented control whose container and active pill differed by
          1.40:1 — the selected tab carried by text colour alone. */}
      <div className="flex flex-wrap gap-2 mb-6">
        {SMS_FILTERS.map(f => {
          const active = filter === f.key
          const count = counts[f.key]
          const urgent = (f.key === 'optout' || f.key === 'unmatched') && count > 0
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
              <div className="h-3 bg-gray-700/60 rounded w-2/3" />
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="card p-8 text-center">
          <Icon d={ICONS.chat} className="w-8 h-8 mx-auto text-gray-400 mb-3" />
          <p className="text-gray-100 font-medium">
            {search.trim() ? `No texts match “${search.trim()}”` : 'No texts yet'}
          </p>
          <p className="text-sm text-gray-400 mt-1">
            {search.trim()
              ? `${counts[filter]} in ${describeSmsFilter(filter, '')}.`
              : 'Inbound replies will appear here once Twilio is configured.'}
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
            <SmsRow
              key={m.id}
              message={m}
              customer={byId.get(m.customerId) ?? null}
              onOpen={() => openReader(m)}
              onDelete={() => setPendingDelete(m)}
              canEdit={canEdit}
            />
          ))}
        </div>
      )}

      {openMessage && (
        <SmsReader
          message={openMessage}
          customer={byId.get(openMessage.customerId) ?? null}
          canEdit={canEdit}
          onClose={() => setOpen(null)}
          onDelete={() => setPendingDelete(openMessage)}
        />
      )}

      <ConfirmModal
        isOpen={pendingDelete !== null}
        message={pendingDelete
          ? `Delete this text from ${formatPhone(pendingDelete.fromNumber)}? This cannot be undone, and it stays deleted from the customer's thread too.`
          : ''}
        onConfirm={handleDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  )
}

/** A row is a button, not a div with onClick — marking read was mouse-only. */
function SmsRow({ message: m, customer, onOpen, onDelete, canEdit }: {
  message: SmsMessage
  customer: CustomerItem | null
  onOpen: () => void
  onDelete: () => void
  canEdit: boolean
}) {
  const intent = smsIntent(m)
  const unmatched = isUnmatched(m)

  return (
    <div className={`card flex items-stretch overflow-hidden transition-colors ${
      // border-indigo-600/50 was 1.47:1 against the card.
      !m.read ? 'border-indigo-500' : ''
    }`}>
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Read text from ${customer ? displayName(customer) : formatPhone(m.fromNumber)}`}
        className="flex-1 min-w-0 text-left p-4 transition-colors hover:bg-gray-700/40
                   focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              {!m.read && <span className="w-2 h-2 rounded-full bg-indigo-500 shrink-0" />}
              {/* The row used to title itself with the raw E.164 string even
                  when the webhook had matched it to a record. */}
              <p className="font-semibold text-white truncate">
                {customer ? displayName(customer) : formatPhone(m.fromNumber)}
              </p>
              {customer && (
                <span className="text-xs text-gray-400 shrink-0">{formatPhone(m.fromNumber)}</span>
              )}
              {intent === 'stop' && (
                <span className="text-xs bg-red-500/20 text-red-300 px-2 py-0.5 rounded-full shrink-0">
                  Opted out
                </span>
              )}
              {intent === 'start' && (
                <span className="text-xs bg-green-500/20 text-green-300 px-2 py-0.5 rounded-full shrink-0">
                  Opted back in
                </span>
              )}
              {unmatched && (
                <span className="text-xs bg-amber-500/20 text-amber-300 px-2 py-0.5 rounded-full shrink-0">
                  Unmatched
                </span>
              )}
              {customer?.smsOptOut && intent === 'normal' && (
                <span className="text-xs bg-red-500/20 text-red-300 px-2 py-0.5 rounded-full shrink-0">
                  Unsubscribed
                </span>
              )}
            </div>
            {/* Was text-gray-500 at 3.04:1 — the text they actually sent. */}
            <p className="text-sm text-gray-400 mt-1 line-clamp-2 whitespace-pre-wrap">{m.body}</p>
          </div>
          {/* Was text-gray-600 at 1.94:1, and an absolute date for something
              that arrived four minutes ago. */}
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
            aria-label={`Delete text from ${formatPhone(m.fromNumber)}`}
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
 * The page clamped every text to two lines with no expand and no reply, while
 * sendSms sat unused in the same service and the subtitle told you to go to
 * the record page instead.
 */
function SmsReader({ message: m, customer, canEdit, onClose, onDelete }: {
  message: SmsMessage
  customer: CustomerItem | null
  canEdit: boolean
  onClose: () => void
  onDelete: () => void
}) {
  const toast = useToast()
  const { items: customers } = useSharedCustomers()

  const [replying, setReplying] = useState(false)
  const [body, setBody]         = useState('')
  const [sending, setSending]   = useState(false)
  const [attaching, setAttaching] = useState(false)
  const [customerQuery, setCustomerQuery] = useState('')

  const unmatched = isUnmatched(m)
  const intent = smsIntent(m)
  const optedOut = customer?.smsOptOut === true || intent === 'stop'
  const status = smsStatusMeta(m.status)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => { setBody(''); setReplying(false) }, [m.id])

  const matches = useMemo(() => {
    const q = customerQuery.trim().toLowerCase()
    if (!q) return [] as CustomerItem[]
    const digits = q.replace(/\D/g, '')
    return customers
      .filter(c =>
        displayName(c).toLowerCase().includes(q) ||
        (digits.length >= 3 && lastTenDigits(c.phone).includes(digits)),
      )
      .slice(0, 8)
  }, [customers, customerQuery])

  /** Suggests the record whose number matches, if the scan missed it. */
  const suggestion = useMemo(() => {
    if (!unmatched) return null
    const target = lastTenDigits(m.fromNumber)
    if (target.length !== 10) return null
    return customers.find(c => lastTenDigits(c.phone) === target) ?? null
  }, [unmatched, customers, m.fromNumber])

  async function handleAttach(c: CustomerItem) {
    setAttaching(true)
    try {
      await attachSmsToCustomer(m.id, c.id)
      toast(`Attached to ${displayName(c)}`, 'success')
      setCustomerQuery('')
    } catch {
      toast('Could not attach this text', 'error')
    } finally {
      setAttaching(false)
    }
  }

  async function handleSend() {
    if (!body.trim()) return
    setSending(true)
    try {
      await sendSms(m.customerId, body.trim())
      toast('Text sent', 'success')
      setReplying(false)
      setBody('')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not send the text', 'error')
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
        aria-label={`Text from ${customer ? displayName(customer) : formatPhone(m.fromNumber)}`}
        className="relative bg-gray-800 border border-gray-600 rounded-2xl shadow-2xl w-full max-w-lg max-h-full flex flex-col overflow-hidden"
      >
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-gray-700 shrink-0">
          <div className="min-w-0">
            <p className="text-base font-semibold text-white truncate">
              {customer ? displayName(customer) : formatPhone(m.fromNumber)}
            </p>
            <p className="text-sm text-gray-400 mt-0.5 truncate">
              {formatPhone(m.fromNumber)} · {fullTimestamp(m.createdAt)}
            </p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => { setSmsRead(m.id, !m.read).catch(() => {}) }}
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
                aria-label="Delete this text"
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

        <div className="px-5 py-4 overflow-y-auto flex-1 min-h-0 space-y-3">
          <p className="text-sm text-gray-200 whitespace-pre-wrap break-words">{m.body || '(empty text)'}</p>
          {m.status !== 'received' && (
            <span className={`inline-block text-xs px-2 py-0.5 rounded-full ${status.classes}`}>
              {status.label}
            </span>
          )}
          {m.errorMessage && <p className="text-xs text-red-400">{m.errorMessage}</p>}
        </div>

        <div className="px-5 py-4 border-t border-gray-700 shrink-0 space-y-3">
          {optedOut ? (
            /* The consequence of a STOP, said out loud where someone might
               otherwise reply to it. */
            <p className="text-xs text-red-300">
              This number has unsubscribed from texts. Don't text it again unless they send START —
              replying here would be a compliance problem, so the composer is off.
            </p>
          ) : unmatched ? (
            <>
              <p className="text-xs text-amber-300">
                This number isn't on any record, so there's nobody to thread a reply to. Attach it to a
                customer to answer from here.
              </p>
              {canEdit && (
                <div>
                  {suggestion && (
                    <button
                      type="button"
                      onClick={() => handleAttach(suggestion)}
                      disabled={attaching}
                      className="btn-secondary text-sm px-3 py-1.5 mb-2 disabled:opacity-40"
                    >
                      Attach to {displayName(suggestion)}
                    </button>
                  )}
                  <label htmlFor="attach-sms-customer" className="sr-only">Find a customer</label>
                  <input
                    id="attach-sms-customer"
                    type="search"
                    value={customerQuery}
                    onChange={e => setCustomerQuery(e.target.value)}
                    placeholder="Find a customer by name or phone…"
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
                            {c.phone && <span className="text-gray-400"> · {formatPhone(c.phone)}</span>}
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
                <label htmlFor="sms-reply" className="text-xs text-gray-400 block mb-1">
                  Reply · {body.length} characters{body.length > 160 ? ` · ${Math.ceil(body.length / 153)} segments` : ''}
                </label>
                <textarea
                  id="sms-reply"
                  rows={4}
                  value={body}
                  onChange={e => setBody(e.target.value)}
                  placeholder="Write your reply…"
                  className="input-field w-full text-sm resize-y"
                />
              </div>
              <div className="flex items-center gap-2">
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
                  {sending ? 'Sending…' : 'Send text'}
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
                  <Icon d={ICONS.chat} className="w-4 h-4" />
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
