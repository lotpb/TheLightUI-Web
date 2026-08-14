import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { usePageTitle } from '../../hooks/usePageTitle'
import { subscribeToCustomers } from '../../services/customerService'
import { fullName, CATEGORIES, type CustomerItem } from '../../models/customer'
import { useAuthStore } from '../../stores/authStore'
import { useToast } from '../../components/Toast'

// ─── Helpers ─────────────────────────────────────────────────────────────────

type Channel = 'email' | 'sms'

function applyTemplate(tpl: string, c: CustomerItem): string {
  return tpl
    .replace(/\{first\}/g, c.first || 'there')
    .replace(/\{lastname\}/g, c.lastname)
    .replace(/\{city\}/g, c.city)
    .replace(/\{salesman\}/g, c.salesman)
}

function csvEscape(s: string) { return `"${s.replace(/"/g, '""')}"` }

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

  const [copied, setCopied] = useState<'contacts' | 'msg' | null>(null)
  const [showList, setShowList] = useState(false)

  useEffect(() => {
    const unsub = subscribeToCustomers(
      items => { setCustomers(items); setLoading(false) },
      ()    => setLoading(false),
    )
    return unsub
  }, [companyId])

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
      if (channel === 'email' && !c.email) return false
      if (channel === 'sms'   && !c.phone) return false
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
    await navigator.clipboard.writeText(list)
    setCopied('contacts')
    toast(`${matched.length} ${channel === 'email' ? 'emails' : 'numbers'} copied to clipboard`, 'success')
    setTimeout(() => setCopied(null), 2500)
  }

  function openMailApp() {
    if (matched.length === 0) return
    const bcc = matched.slice(0, 40).map(c => c.email).join(',')
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

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-5">

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Broadcast</h1>
          <p className="text-sm text-gray-400 mt-0.5">Send a message to a filtered segment</p>
        </div>
        {!loading && (
          <div className="text-right shrink-0">
            <p className="text-2xl font-bold text-white">{matched.length}</p>
            <p className="text-xs text-gray-500">recipients matched</p>
          </div>
        )}
      </div>

      {/* Channel toggle */}
      <div className="flex gap-2">
        {(['email', 'sms'] as Channel[]).map(ch => (
          <button
            key={ch}
            onClick={() => setChannel(ch)}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
              channel === ch
                ? 'bg-indigo-600 text-white'
                : 'bg-gray-800 text-gray-400 hover:text-gray-200'
            }`}
          >
            <span>{ch === 'email' ? '✉️' : '💬'}</span>
            {ch === 'email' ? 'Email' : 'SMS'}
          </button>
        ))}
        <span className="ml-auto text-xs text-gray-600 self-center">
          Only contacts with a {channel === 'email' ? 'valid email' : 'phone number'} are shown
        </span>
      </div>

      {/* Segment Filters */}
      <div className="card overflow-hidden">
        <div className="px-4 py-2 border-b border-gray-700/50 bg-gray-800/50 flex items-center justify-between">
          <p className="text-sm font-semibold uppercase tracking-wider text-gray-400">Segment Filters</p>
          {(category || salesman || cbFilter || city) && (
            <button
              onClick={() => { setCategory(''); setSalesman(''); setCbFilter(''); setCity('') }}
              className="text-xs text-gray-500 hover:text-red-400 transition-colors"
            >
              Clear all
            </button>
          )}
        </div>

        <div className="p-4 space-y-4">
          {/* Category */}
          <div>
            <p className="text-xs text-gray-500 mb-2 font-medium">Category</p>
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
            {/* Salesman */}
            <div>
              <p className="text-xs text-gray-500 mb-1.5 font-medium">Salesman</p>
              <select
                value={salesman}
                onChange={e => setSalesman(e.target.value)}
                className="input-field text-sm py-1.5 w-full"
              >
                <option value="">All</option>
                {salesmen.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>

            {/* Callback status */}
            <div>
              <p className="text-xs text-gray-500 mb-1.5 font-medium">Callback Status</p>
              <select
                value={cbFilter}
                onChange={e => setCbFilter(e.target.value)}
                className="input-field text-sm py-1.5 w-full"
              >
                <option value="">All</option>
                <option value="yes">Called</option>
                <option value="no">Not called</option>
              </select>
            </div>

            {/* City */}
            <div>
              <p className="text-xs text-gray-500 mb-1.5 font-medium">City</p>
              <input
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
        <div className="px-4 py-2 border-b border-gray-700/50 bg-gray-800/50">
          <p className="text-sm font-semibold uppercase tracking-wider text-gray-400">Message</p>
        </div>

        <div className="p-4 space-y-3">
          {/* Merge tag chips */}
          <div className="flex gap-1.5 flex-wrap items-center">
            <span className="text-xs text-gray-600">Merge tags:</span>
            {['{first}', '{lastname}', '{city}', '{salesman}'].map(tag => (
              <button
                key={tag}
                onClick={async () => {
                  const ta = document.getElementById('blast-body') as HTMLTextAreaElement | null
                  if (ta) {
                    const start = ta.selectionStart
                    const end   = ta.selectionEnd
                    const next  = body.slice(0, start) + tag + body.slice(end)
                    setBody(next)
                    setTimeout(() => {
                      ta.focus()
                      ta.setSelectionRange(start + tag.length, start + tag.length)
                    }, 0)
                  } else {
                    setBody(b => b + tag)
                  }
                }}
                className="px-2 py-0.5 rounded text-xs font-mono bg-indigo-600/20 text-indigo-300 hover:bg-indigo-600/40 transition-colors"
              >
                {tag}
              </button>
            ))}
          </div>

          {/* Subject (email only) */}
          {channel === 'email' && (
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Subject</label>
              <input
                type="text"
                value={subject}
                onChange={e => setSubject(e.target.value)}
                placeholder="Subject line…"
                className="input-field w-full text-sm py-2"
              />
            </div>
          )}

          {/* Body */}
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Message body</label>
            <textarea
              id="blast-body"
              value={body}
              onChange={e => setBody(e.target.value)}
              rows={channel === 'email' ? 7 : 4}
              placeholder={
                channel === 'email'
                  ? 'Hi {first},\n\nWrite your message here…'
                  : 'Hi {first}, write your SMS here…'
              }
              className="input-field w-full resize-none text-sm"
            />
          </div>

          {/* Live preview */}
          {body && matched[0] && (
            <div className="rounded-xl bg-gray-800/60 border border-gray-700/40 p-3 space-y-1.5">
              <p className="text-xs font-medium text-gray-500">Preview — {fullName(matched[0])}</p>
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
        <div className="px-4 py-2 border-b border-gray-700/50 bg-gray-800/50 flex items-center justify-between">
          <p className="text-sm font-semibold uppercase tracking-wider text-gray-400">
            Recipients
            <span className="ml-2 text-gray-600 normal-case font-normal">
              ({loading ? '…' : matched.length})
            </span>
          </p>
          {matched.length > 0 && (
            <button
              onClick={() => setShowList(v => !v)}
              className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
            >
              {showList ? 'Hide list' : 'Show list'}
            </button>
          )}
        </div>

        {/* Action buttons */}
        <div className="p-4 space-y-3">
          {matched.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-4">
              {loading ? 'Loading contacts…' : 'No contacts match these filters.'}
            </p>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {/* Copy contacts */}
                <button
                  onClick={copyContacts}
                  className={`flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                    copied === 'contacts'
                      ? 'bg-green-600/20 text-green-400 border border-green-700/40'
                      : 'bg-gray-700 text-gray-200 hover:bg-gray-600'
                  }`}
                >
                  <span>{copied === 'contacts' ? '✓' : channel === 'email' ? '📋' : '📋'}</span>
                  {copied === 'contacts'
                    ? 'Copied!'
                    : channel === 'email'
                      ? `Copy ${matched.length} Emails`
                      : `Copy ${matched.length} Numbers`}
                </button>

                {/* Email-specific: Open in Mail App */}
                {channel === 'email' && (
                  <button
                    onClick={openMailApp}
                    disabled={matched.length > 40}
                    title={matched.length > 40 ? 'Too many recipients for Mail App — use Copy instead' : undefined}
                    className="flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium bg-indigo-600/20 text-indigo-300 hover:bg-indigo-600/30 transition-colors border border-indigo-700/30 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <span>✉️</span>
                    Open in Mail App
                    {matched.length > 40 && <span className="text-xs text-gray-500">(limit 40)</span>}
                  </button>
                )}

                {/* SMS-specific: Show send list */}
                {channel === 'sms' && (
                  <button
                    onClick={() => setShowList(true)}
                    className="flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium bg-green-600/20 text-green-400 hover:bg-green-600/30 transition-colors border border-green-700/30"
                  >
                    <span>💬</span>
                    Send One by One
                  </button>
                )}
              </div>

              {/* Export CSV */}
              <button
                onClick={exportCSV}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium bg-gray-800 text-gray-400 hover:text-gray-200 transition-colors border border-gray-700/50"
              >
                <span>⬇️</span>
                Export CSV with personalized messages
              </button>

              {matched.length > 40 && channel === 'email' && (
                <p className="text-xs text-amber-500/80 text-center">
                  Mail App is limited to 40 BCC recipients. Use Copy Emails or Export CSV for larger lists.
                </p>
              )}
            </>
          )}
        </div>

        {/* Recipient list */}
        {showList && matched.length > 0 && (
          <div className="border-t border-gray-700/50">
            <div className="max-h-72 overflow-y-auto divide-y divide-gray-700/30">
              {matched.map(c => (
                <div key={c.id} className="flex items-center gap-3 px-4 py-2.5 group hover:bg-gray-700/20">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2">
                      <Link
                        to={`/records/${c.id}`}
                        className="text-sm font-medium text-gray-200 hover:text-indigo-300 transition-colors truncate"
                      >
                        {fullName(c)}
                      </Link>
                      {c.city && (
                        <span className="text-xs text-gray-600 shrink-0">{c.city}</span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 truncate">
                      {channel === 'email' ? c.email : c.phone}
                    </p>
                  </div>
                  {channel === 'sms' ? (
                    <a
                      href={`sms:${c.phone}${body ? `?&body=${encodeURIComponent(applyTemplate(body, c))}` : ''}`}
                      className="shrink-0 text-xs text-green-400 hover:text-green-300 transition-colors px-2 py-1 rounded-lg bg-green-500/10"
                    >
                      Send ↗
                    </a>
                  ) : (
                    <a
                      href={`mailto:${c.email}${subject || body ? `?${new URLSearchParams({ ...(subject ? { subject: applyTemplate(subject, c) } : {}), ...(body ? { body: applyTemplate(body, c) } : {}) }).toString()}` : ''}`}
                      className="shrink-0 text-xs text-indigo-400 hover:text-indigo-300 transition-colors px-2 py-1 rounded-lg bg-indigo-500/10"
                    >
                      Send ↗
                    </a>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
