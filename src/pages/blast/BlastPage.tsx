import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { usePageTitle } from '../../hooks/usePageTitle'
import { subscribeToCustomers } from '../../services/customerService'
import { fullName, CATEGORIES, type CustomerItem } from '../../models/customer'
import { useAuthStore } from '../../stores/authStore'
import { useToast } from '../../components/Toast'
import { Icon, ICONS } from '../../components/Icon'

// ─── Helpers ─────────────────────────────────────────────────────────────────

type Channel = 'email' | 'sms'

/**
 * How many BCC addresses a mailto: link is allowed to carry.
 *
 * One constant because the limit used to be written out in four places — the
 * disabled test, a title tooltip, an inline "(limit 40)" and a paragraph — which
 * is four chances for them to disagree. The slice below is unreachable while the
 * button is disabled above the limit; it stays as the belt to that braces.
 */
const MAIL_BCC_LIMIT = 40

/** How many recipients the inline list renders before it stops. */
const LIST_PREVIEW = 50

function applyTemplate(tpl: string, c: CustomerItem): string {
  return tpl
    .replace(/\{first\}/g, c.first || 'there')
    .replace(/\{lastname\}/g, c.lastname)
    .replace(/\{city\}/g, c.city)
    .replace(/\{salesman\}/g, c.salesman)
}

/**
 * Quote-escaped, and defused for spreadsheets.
 *
 * A cell starting with = + - or @ is a formula to Excel and Sheets, so a city
 * or a name beginning with one executes on open. Prefixing a tab keeps the
 * value readable while making it inert.
 */
function csvEscape(s: string) {
  const v = /^[=+\-@]/.test(s) ? `\t${s}` : s
  return `"${v.replace(/"/g, '""')}"`
}

/**
 * The page promises "only contacts with a valid email"; the filter used to be
 * `!c.email`, which is presence, not validity. A record reading "n/a" counted
 * as a recipient and went into the copied list and the CSV. Same `includes('@')`
 * test the bulk-email modal on /customers already applies.
 */
function hasEmail(c: CustomerItem): boolean {
  return c.email.trim().includes('@')
}

/** At least a few digits — enough to reject "none" and "n/a". */
function hasPhone(c: CustomerItem): boolean {
  return c.phone.replace(/\D/g, '').length >= 7
}

const BLAST_EXAMPLES: Array<{ name: string; channel: Channel | 'both'; subject: string; body: string }> = [
  {
    name: 'Follow-up after visit',
    channel: 'both',
    subject: 'Great meeting you, {first}!',
    body: 'Hi {first}, thanks for taking the time to meet with us. Let us know if you have any questions — happy to help however we can!',
  },
  {
    name: 'Current promotion',
    channel: 'email',
    subject: 'A little something for you, {first}',
    body: 'Hi {first},\n\nWe wanted to let you know about our current promotion — reach out and mention this email to take advantage.',
  },
  {
    name: 'Missed call',
    channel: 'sms',
    subject: '',
    body: 'Hi {first}, sorry we missed you! Give us a call back when you get a chance.',
  },
  {
    name: 'We miss you',
    channel: 'both',
    subject: 'We miss you, {first}!',
    body: "Hi {first}, it's been a while since we've connected. Let us know if there's anything we can help with!",
  },
]

const MERGE_TAGS = ['{first}', '{lastname}', '{city}', '{salesman}'] as const

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function BlastPage() {
  usePageTitle('Broadcast')
  const companyId = useAuthStore(s => s.companyId)
  const toast = useToast()

  const [customers, setCustomers] = useState<CustomerItem[]>([])
  const [loading, setLoading]     = useState(true)

  // Filters
  const [channel,  setChannel]  = useState<Channel>('email')
  const [category, setCategory] = useState('')
  const [salesman, setSalesman] = useState('')
  const [cbFilter, setCbFilter] = useState('')   // '' | 'yes' | 'no'
  const [city,     setCity]     = useState('')

  // Message
  const [subject, setSubject] = useState('Hi {first}, a message for you')
  const [body,    setBody]    = useState('')

  const [copied, setCopied] = useState<'contacts' | null>(null)
  const [showList, setShowList] = useState(false)

  /**
   * Which field a merge tag should land in.
   *
   * The chips used to reach the textarea through
   * document.getElementById('blast-body') and nothing else — so with the cursor
   * in Subject, which also runs through applyTemplate and therefore accepts
   * tags, clicking {first} silently appended it to the body instead.
   */
  const subjectRef = useRef<HTMLInputElement>(null)
  const bodyRef    = useRef<HTMLTextAreaElement>(null)
  const [tagTarget, setTagTarget] = useState<'subject' | 'body'>('body')
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const unsub = subscribeToCustomers(
      items => { setCustomers(items); setLoading(false) },
      ()    => setLoading(false),
    )
    return unsub
  }, [companyId])

  // Subject only exists on the email channel, so a stale target would send tags
  // into a field that isn't on screen.
  useEffect(() => { if (channel === 'sms') setTagTarget('body') }, [channel])

  const salesmen = useMemo(() => {
    const s = new Set<string>()
    for (const c of customers) if (c.salesman) s.add(c.salesman)
    return [...s].sort()
  }, [customers])

  const cities = useMemo(() => {
    const s = new Set<string>()
    for (const c of customers) if (c.city) s.add(c.city)
    return [...s].sort()
  }, [customers])

  const matched = useMemo(() => {
    return customers.filter(c => {
      if (channel === 'email' && !hasEmail(c)) return false
      if (channel === 'sms'   && !hasPhone(c)) return false
      if (category && c.category.toLowerCase() !== category.toLowerCase()) return false
      if (salesman && c.salesman !== salesman) return false
      if (cbFilter === 'yes' && c.callback.toLowerCase() !== 'yes') return false
      if (cbFilter === 'no'  && c.callback.toLowerCase() === 'yes') return false
      if (city && !c.city.toLowerCase().includes(city.toLowerCase())) return false
      return true
    })
  }, [customers, channel, category, salesman, cbFilter, city])

  async function copyContacts() {
    const list = channel === 'email'
      ? matched.map(c => c.email).join(', ')
      : matched.map(c => c.phone).join(', ')
    try {
      await navigator.clipboard.writeText(list)
      setCopied('contacts')
      toast(`${matched.length} ${channel === 'email' ? 'emails' : 'numbers'} copied to clipboard`, 'success')
      setTimeout(() => setCopied(null), 2500)
    } catch {
      toast('Could not copy to the clipboard.', 'error')
    }
  }

  function openMailApp() {
    if (matched.length === 0) return
    const bcc = matched.slice(0, MAIL_BCC_LIMIT).map(c => c.email).join(',')
    const params = new URLSearchParams()
    if (subject) params.set('subject', subject)
    if (body)    params.set('body', body)
    window.location.href = `mailto:?bcc=${encodeURIComponent(bcc)}&${params.toString()}`
  }

  function exportCSV() {
    const headers = [
      'Name',
      channel === 'email' ? 'Email' : 'Phone',
      'City',
      'Salesman',
      channel === 'email' ? 'Subject' : '',
      'Message',
    ].filter(Boolean)

    const rows = matched.map(c => [
      fullName(c),
      channel === 'email' ? c.email : c.phone,
      c.city,
      c.salesman,
      ...(channel === 'email' ? [applyTemplate(subject, c)] : []),
      applyTemplate(body, c),
    ])

    const csv = [headers, ...rows]
      .map(r => r.map(csvEscape).join(','))
      .join('\n')

    const blob = new Blob([csv], { type: 'text/csv' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href = url
    a.download = `blast_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const preview = matched[0] ? applyTemplate(body, matched[0]) : body

  const examples = useMemo(
    () => BLAST_EXAMPLES.filter(ex => ex.channel === 'both' || ex.channel === channel),
    [channel],
  )

  function applyExample(ex: typeof BLAST_EXAMPLES[number]) {
    if (channel === 'email') setSubject(ex.subject)
    setBody(ex.body)
  }

  /** Inserts at the caret of whichever field was last focused. */
  function insertTag(tag: string) {
    const el = tagTarget === 'subject' ? subjectRef.current : bodyRef.current
    const value = tagTarget === 'subject' ? subject : body
    const setValue = tagTarget === 'subject' ? setSubject : setBody
    if (!el) { setValue(value + tag); return }
    const start = el.selectionStart ?? value.length
    const end   = el.selectionEnd ?? value.length
    setValue(value.slice(0, start) + tag + value.slice(end))
    setTimeout(() => {
      el.focus()
      el.setSelectionRange(start + tag.length, start + tag.length)
    }, 0)
  }

  /** Reveals the list and takes you to it — otherwise this button did exactly
   *  what the small "Show list" toggle above it did, and nothing at all when
   *  the list was already open. */
  function revealList() {
    setShowList(true)
    setTimeout(() => listRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50)
  }

  const overMailLimit = channel === 'email' && matched.length > MAIL_BCC_LIMIT

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-5">

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        {/* This page and Email Campaigns both used to say "send a message to a
            filtered segment", which made them look like the same feature filed
            twice. They aren't: this one writes nothing and hands you the list —
            clipboard, CSV or your own mail app — and it's the only one that
            covers SMS, city and callback. Campaigns is the tracked email
            sender. The headings and the cross-link say which is which. */}
        <div>
          <h1 className="text-2xl font-bold text-white">Bulk Contacts</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            Filter a segment, then copy it, export it, or open it in your mail app
          </p>
          <p className="text-xs text-gray-400 mt-1">
            Nothing is sent or logged from here.{' '}
            <Link to="/campaigns" className="text-indigo-400 hover:text-indigo-300">
              Email Campaigns
            </Link>{' '}
            sends and tracks opens.
          </p>
        </div>
        {!loading && (
          <div className="text-right shrink-0">
            <p className="text-2xl font-bold text-white tabular-nums">{matched.length}</p>
            <p className="text-xs text-gray-400">recipients matched</p>
          </div>
        )}
      </div>

      {/* Channel toggle. Drawn icons, not ✉️/💬 — emoji paint their own bitmap
          and ignore `color`, so the glyph looked identical whether the tab was
          active or not while its label went white. */}
      <div className="flex gap-2 flex-wrap items-center">
        {(['email', 'sms'] as Channel[]).map(ch => (
          <button
            key={ch}
            onClick={() => setChannel(ch)}
            aria-pressed={channel === ch}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
              channel === ch
                ? 'bg-indigo-600 text-white'
                : 'bg-gray-800 text-gray-400 hover:text-gray-200'
            }`}
          >
            <Icon d={ch === 'email' ? ICONS.envelope : ICONS.chat} className="w-4 h-4 shrink-0" />
            {ch === 'email' ? 'Email' : 'SMS'}
          </button>
        ))}
        <span className="ml-auto text-xs text-gray-400">
          Only contacts with {channel === 'email' ? 'an email address' : 'a phone number'} are shown
        </span>
      </div>

      {/* Segment Filters */}
      <div className="card overflow-hidden">
        {/* bg-gray-900, not bg-gray-800/50: the card is bg-gray-800, and fifty
            percent of a colour over itself is that colour — all three strips on
            this page measured 1.000:1 and rendered as nothing but a border. */}
        <div className="px-4 py-2 border-b border-gray-700/50 bg-gray-900 flex items-center justify-between">
          <p className="card-section-title">Segment Filters</p>
          {(category || salesman || cbFilter || city) && (
            <button
              onClick={() => { setCategory(''); setSalesman(''); setCbFilter(''); setCity('') }}
              className="text-xs text-gray-400 hover:text-red-400 transition-colors"
            >
              Clear all
            </button>
          )}
        </div>

        <div className="p-4 space-y-4">
          <div>
            <p className="text-xs text-gray-400 mb-2 font-medium">Category</p>
            <div className="flex gap-1.5 flex-wrap">
              <button
                onClick={() => setCategory('')}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                  !category ? 'bg-indigo-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-gray-200'
                }`}
              >
                All
              </button>
              {CATEGORIES.map(cat => (
                <button
                  key={cat}
                  onClick={() => setCategory(category === cat ? '' : cat)}
                  className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                    category === cat
                      ? 'bg-indigo-600 text-white'
                      : 'bg-gray-800 text-gray-400 hover:text-gray-200'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label htmlFor="blast-salesman" className="text-xs text-gray-400 mb-1.5 font-medium block">Salesman</label>
              <select
                id="blast-salesman"
                value={salesman}
                onChange={e => setSalesman(e.target.value)}
                className="input-field text-sm py-1.5 w-full"
              >
                <option value="">All</option>
                {salesmen.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>

            <div>
              <label htmlFor="blast-callback" className="text-xs text-gray-400 mb-1.5 font-medium block">Callback Status</label>
              <select
                id="blast-callback"
                value={cbFilter}
                onChange={e => setCbFilter(e.target.value)}
                className="input-field text-sm py-1.5 w-full"
              >
                <option value="">All</option>
                <option value="yes">Called</option>
                <option value="no">Not called</option>
              </select>
            </div>

            <div>
              <label htmlFor="blast-city" className="text-xs text-gray-400 mb-1.5 font-medium block">City</label>
              <input
                id="blast-city"
                type="text"
                list="city-list"
                value={city}
                onChange={e => setCity(e.target.value)}
                placeholder="Any city…"
                className="input-field text-sm py-1.5 w-full"
              />
              <datalist id="city-list">
                {cities.map(c => <option key={c} value={c} />)}
              </datalist>
            </div>
          </div>
        </div>
      </div>

      {/* Message Composer */}
      <div className="card overflow-hidden">
        <div className="px-4 py-2 border-b border-gray-700/50 bg-gray-900">
          <p className="card-section-title">Message</p>
        </div>

        <div className="p-4 space-y-3">
          {!body && (
            <div className="flex flex-wrap gap-1.5 items-center">
              <span className="text-xs text-gray-400">Start from an example:</span>
              {examples.map(ex => (
                <button
                  key={ex.name}
                  onClick={() => applyExample(ex)}
                  className="px-2 py-1 rounded-full text-xs font-medium bg-gray-800 text-gray-300 border border-gray-700 hover:border-indigo-500 hover:text-indigo-300 transition-colors"
                >
                  {ex.name}
                </button>
              ))}
            </div>
          )}

          {/* Merge tags. py-1 rather than py-0.5 — these were 20px against the
              24px floor of WCAG 2.5.8. */}
          <div className="flex gap-1.5 flex-wrap items-center">
            <span className="text-xs text-gray-400">
              Merge tags{channel === 'email' ? ` → ${tagTarget === 'subject' ? 'Subject' : 'Message'}` : ''}:
            </span>
            {MERGE_TAGS.map(tag => (
              <button
                key={tag}
                onClick={() => insertTag(tag)}
                className="px-2 py-1 rounded text-xs font-mono bg-indigo-600/20 text-indigo-300 hover:bg-indigo-600/40 transition-colors"
              >
                {tag}
              </button>
            ))}
          </div>

          {channel === 'email' && (
            <div>
              <label htmlFor="blast-subject" className="text-xs text-gray-400 mb-1 block">Subject</label>
              <input
                id="blast-subject"
                ref={subjectRef}
                type="text"
                value={subject}
                onChange={e => setSubject(e.target.value)}
                onFocus={() => setTagTarget('subject')}
                placeholder="Subject line…"
                className="input-field w-full text-sm py-2"
              />
            </div>
          )}

          <div>
            <label htmlFor="blast-body" className="text-xs text-gray-400 mb-1 block">Message body</label>
            <textarea
              id="blast-body"
              ref={bodyRef}
              value={body}
              onChange={e => setBody(e.target.value)}
              onFocus={() => setTagTarget('body')}
              rows={channel === 'email' ? 7 : 4}
              placeholder={
                channel === 'email'
                  ? 'Hi {first},\n\nWrite your message here…'
                  : 'Hi {first}, write your SMS here…'
              }
              className="input-field w-full resize-none text-sm"
            />
          </div>

          {body && matched[0] && (
            <div className="rounded-xl bg-gray-900 border border-gray-700/40 p-3 space-y-1.5">
              <p className="text-xs font-medium text-gray-400">Preview — {fullName(matched[0])}</p>
              {channel === 'email' && subject && (
                <p className="text-xs font-semibold text-gray-300">
                  Subject: {applyTemplate(subject, matched[0])}
                </p>
              )}
              <p className="text-sm text-gray-200 whitespace-pre-wrap">{preview}</p>
            </div>
          )}
        </div>
      </div>

      {/* Actions + Recipients */}
      <div className="card overflow-hidden">
        {/* The count that used to sit here duplicated the headline figure at the
            top of the page, at gray-600. The list below states its own range. */}
        <div className="px-4 py-2 border-b border-gray-700/50 bg-gray-900 flex items-center justify-between">
          <p className="card-section-title">Recipients</p>
          {matched.length > 0 && (
            <button
              onClick={() => setShowList(v => !v)}
              className="text-xs text-gray-400 hover:text-gray-200 transition-colors"
            >
              {showList ? 'Hide list' : 'Show list'}
            </button>
          )}
        </div>

        <div className="p-4 space-y-3">
          {matched.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-4">
              {loading ? 'Loading contacts…' : 'No contacts match these filters.'}
            </p>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <button
                  onClick={copyContacts}
                  className={`flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                    copied === 'contacts'
                      ? 'bg-green-600/20 text-green-400 border border-green-700/40'
                      : 'bg-gray-700 text-gray-200 hover:bg-gray-600'
                  }`}
                >
                  <Icon d={copied === 'contacts' ? ICONS.check : ICONS.clipboard} className="w-4 h-4 shrink-0" />
                  {copied === 'contacts'
                    ? 'Copied!'
                    : channel === 'email'
                      ? `Copy ${matched.length} Emails`
                      : `Copy ${matched.length} Numbers`}
                </button>

                {channel === 'email' && (
                  <button
                    onClick={openMailApp}
                    disabled={overMailLimit}
                    className="flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium bg-indigo-600/20 text-indigo-300 hover:bg-indigo-600/30 transition-colors border border-indigo-700/30 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Icon d={ICONS.envelope} className="w-4 h-4 shrink-0" />
                    Open in Mail App
                  </button>
                )}

                {channel === 'sms' && (
                  <button
                    onClick={revealList}
                    className="flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium bg-green-600/20 text-green-400 hover:bg-green-600/30 transition-colors border border-green-700/30"
                  >
                    <Icon d={ICONS.chat} className="w-4 h-4 shrink-0" />
                    Send One by One
                  </button>
                )}
              </div>

              <button
                onClick={exportCSV}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium bg-gray-800 text-gray-300 hover:text-white transition-colors border border-gray-700/50"
              >
                <Icon d={ICONS.downloadTray} className="w-4 h-4 shrink-0" />
                Export CSV with personalized messages
              </button>

              {/* The one place the mail limit is explained, and the only one
                  that says what to do instead. */}
              {overMailLimit && (
                <p className="text-xs text-amber-400 text-center">
                  Mail App is limited to {MAIL_BCC_LIMIT} BCC recipients. Use Copy Emails or Export CSV for larger lists.
                </p>
              )}
            </>
          )}
        </div>

        {/* Recipient list */}
        {showList && matched.length > 0 && (
          <div ref={listRef} className="border-t border-gray-700/50">
            <div className="max-h-72 overflow-y-auto divide-y divide-gray-700/30">
              {/* Capped. This rendered every match — a 5,000-contact segment
                  mounted 5,000 rows, each carrying a mailto:/sms: href with the
                  whole interpolated body, to show about four at a time. */}
              {matched.slice(0, LIST_PREVIEW).map(c => (
                <div key={c.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-700/30">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2">
                      <Link
                        to={`/records/${c.id}`}
                        className="text-sm font-medium text-gray-200 hover:text-indigo-300 transition-colors truncate"
                      >
                        {fullName(c)}
                      </Link>
                      {c.city && (
                        <span className="text-xs text-gray-400 shrink-0">{c.city}</span>
                      )}
                    </div>
                    <p className="text-xs text-gray-400 truncate">
                      {channel === 'email' ? c.email : c.phone}
                    </p>
                  </div>
                  <a
                    href={channel === 'sms'
                      ? `sms:${c.phone}${body ? `?&body=${encodeURIComponent(applyTemplate(body, c))}` : ''}`
                      : `mailto:${c.email}${subject || body ? `?${new URLSearchParams({ ...(subject ? { subject: applyTemplate(subject, c) } : {}), ...(body ? { body: applyTemplate(body, c) } : {}) }).toString()}` : ''}`}
                    className={`shrink-0 inline-flex items-center gap-1 text-xs px-2 py-1 rounded-lg transition-colors ${
                      channel === 'sms'
                        ? 'text-green-400 hover:text-green-300 bg-green-500/10'
                        : 'text-indigo-400 hover:text-indigo-300 bg-indigo-500/10'
                    }`}
                  >
                    Send
                    <Icon d={ICONS.arrowRight} className="w-3 h-3 shrink-0" />
                  </a>
                </div>
              ))}
            </div>
            {/* Says what it's showing, rather than letting the scrollbar imply
                the list is complete. */}
            <p className="px-4 py-2 text-xs text-gray-400 border-t border-gray-700/30 text-center">
              {matched.length > LIST_PREVIEW
                ? `Showing the first ${LIST_PREVIEW} of ${matched.length} — Copy or Export covers all of them`
                : `${matched.length} recipient${matched.length === 1 ? '' : 's'}`}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
