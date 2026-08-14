import { useEffect, useMemo, useRef, useState } from 'react'
import { usePageTitle } from '../../hooks/usePageTitle'
import { subscribeToReferrals, addReferral, deleteReferral, type Referral } from '../../services/referralService'
import { subscribeToCustomers } from '../../services/customerService'
import { fullName, formatCurrency, type CustomerItem } from '../../models/customer'
import { useAuthStore } from '../../stores/authStore'
import { useToast } from '../../components/Toast'
import { avatarColor, AVATAR_ORIGINAL } from '../../utils/avatarColor'
import { usePrefStore } from '../../stores/prefStore'

// ── helpers ──────────────────────────────────────────────────────────────────

function fmtDate(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// ── Customer search dropdown ──────────────────────────────────────────────────

function CustomerPicker({
  label,
  placeholder,
  customers,
  selected,
  onSelect,
  exclude,
}: {
  label: string
  placeholder: string
  customers: CustomerItem[]
  selected: CustomerItem | null
  onSelect: (c: CustomerItem) => void
  exclude?: string
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen]   = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const filtered = useMemo(() => {
    const q = query.toLowerCase()
    return customers
      .filter(c => c.id !== exclude && (!q || fullName(c).toLowerCase().includes(q)))
      .slice(0, 10)
  }, [customers, query, exclude])

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div ref={ref} className="relative">
      <label className="text-xs text-gray-400 mb-1 block">{label} *</label>
      <input
        type="text"
        value={selected ? fullName(selected) : query}
        onChange={e => { setQuery(e.target.value); onSelect(null!); setOpen(true) }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        className="input-field w-full text-sm py-1.5"
        autoComplete="off"
      />
      {open && filtered.length > 0 && (
        <div className="absolute top-full left-0 right-0 z-20 mt-1 bg-gray-800 border border-gray-700 rounded-xl shadow-xl max-h-48 overflow-y-auto">
          {filtered.map(c => (
            <button
              key={c.id}
              type="button"
              className="w-full text-left px-3 py-2 text-sm text-gray-200 hover:bg-gray-700 transition-colors"
              onClick={() => { onSelect(c); setQuery(''); setOpen(false) }}
            >
              {fullName(c)}
              {c.amount > 0 && <span className="ml-2 text-xs text-green-400">{formatCurrency(c.amount)}</span>}
              {c.salesman && <span className="ml-2 text-xs text-gray-500">{c.salesman}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Log-referral form ─────────────────────────────────────────────────────────

function LogForm({
  customers,
  onSave,
  onCancel,
}: {
  customers: CustomerItem[]
  onSave: (r: { referrer: CustomerItem; referred: CustomerItem; amount: number; notes: string }) => Promise<void>
  onCancel: () => void
}) {
  const [referrer, setReferrer]   = useState<CustomerItem | null>(null)
  const [referred, setReferred]   = useState<CustomerItem | null>(null)
  const [amount, setAmount]       = useState('')
  const [notes, setNotes]         = useState('')
  const [saving, setSaving]       = useState(false)

  // Auto-fill amount when referred customer is selected
  useEffect(() => {
    if (referred && referred.amount > 0) setAmount(String(referred.amount))
  }, [referred])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!referrer || !referred) return
    setSaving(true)
    try {
      await onSave({ referrer, referred, amount: parseFloat(amount) || 0, notes })
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="card p-4 space-y-3 border border-indigo-500/30">
      <p className="text-sm font-semibold text-white">Log Referral</p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <CustomerPicker
          label="Referred By"
          placeholder="Who sent the referral…"
          customers={customers}
          selected={referrer}
          onSelect={setReferrer}
          exclude={referred?.id}
        />
        <CustomerPicker
          label="Referred Customer"
          placeholder="Who they referred…"
          customers={customers}
          selected={referred}
          onSelect={setReferred}
          exclude={referrer?.id}
        />
        <div>
          <label className="text-xs text-gray-400 mb-1 block">Deal Amount</label>
          <input
            type="number"
            min="0"
            step="0.01"
            value={amount}
            onChange={e => setAmount(e.target.value)}
            placeholder="0.00"
            className="input-field w-full text-sm py-1.5"
          />
        </div>
        <div>
          <label className="text-xs text-gray-400 mb-1 block">Notes</label>
          <input
            type="text"
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Optional"
            className="input-field w-full text-sm py-1.5"
          />
        </div>
      </div>

      <div className="flex gap-2 pt-1">
        <button type="button" onClick={onCancel} className="btn-secondary text-sm px-4 py-1.5">Cancel</button>
        <button
          type="submit"
          disabled={!referrer || !referred || saving}
          className="px-4 py-1.5 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-500 disabled:opacity-40 transition-colors"
        >
          {saving ? 'Saving…' : 'Log Referral'}
        </button>
      </div>
    </form>
  )
}

// ── Stat card ─────────────────────────────────────────────────────────────────

interface ReferrerStat {
  id: string
  name: string
  count: number
  revenue: number
  entries: Referral[]
}

function ReferrerCard({ stat, rank, coloredAvatars }: { stat: ReferrerStat; rank: number; coloredAvatars: boolean }) {
  const [open, setOpen] = useState(false)
  const color = coloredAvatars ? avatarColor(stat.name) : AVATAR_ORIGINAL
  const initials = stat.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
  const medals = ['🥇', '🥈', '🥉']

  return (
    <div className="card overflow-hidden">
      <button
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-800/30 transition-colors text-left"
        onClick={() => setOpen(o => !o)}
      >
        {/* Rank + Avatar */}
        <div className="relative shrink-0">
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold"
            style={{ background: color.bg, color: color.text }}
          >
            {initials || '?'}
          </div>
          {rank <= 3 && (
            <span className="absolute -top-1 -right-1 text-sm leading-none">{medals[rank - 1]}</span>
          )}
        </div>

        {/* Name + stats */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-100 truncate">{stat.name}</p>
          <p className="text-xs text-gray-400">
            {stat.count} referral{stat.count !== 1 ? 's' : ''}
            {stat.revenue > 0 && <span className="text-green-400 ml-2">{formatCurrency(stat.revenue)}</span>}
          </p>
        </div>

        <svg
          className={`w-4 h-4 text-gray-500 shrink-0 transition-transform ${open ? 'rotate-90' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
        </svg>
      </button>

      {open && (
        <div className="border-t border-gray-700/50 divide-y divide-gray-700/40">
          {stat.entries.map(e => (
            <div key={e.id} className="px-5 py-2.5 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-300 truncate">→ {e.referredName}</p>
                {e.notes && <p className="text-xs text-gray-600 truncate">{e.notes}</p>}
              </div>
              {e.referredAmount > 0 && (
                <span className="text-xs font-semibold text-green-400 shrink-0">{formatCurrency(e.referredAmount)}</span>
              )}
              <span className="text-xs text-gray-600 shrink-0">{fmtDate(e.createdAt)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ReferralsPage() {
  usePageTitle('Referrals')
  const companyId      = useAuthStore(s => s.companyId)
  const coloredAvatars = usePrefStore(s => s.coloredAvatars)
  const toast          = useToast()

  const [referrals, setReferrals] = useState<Referral[]>([])
  const [customers, setCustomers] = useState<CustomerItem[]>([])
  const [loading, setLoading]     = useState(true)
  const [showForm, setShowForm]   = useState(false)
  const [deleteId, setDeleteId]   = useState<string | null>(null)
  const [view, setView]           = useState<'leaderboard' | 'all'>('leaderboard')
  const [sortBy, setSortBy]       = useState<'count' | 'revenue'>('revenue')

  useEffect(() => {
    const unsub = subscribeToReferrals(
      r => { setReferrals(r); setLoading(false) },
      () => setLoading(false),
    )
    return unsub
  }, [companyId])

  useEffect(() => {
    const unsub = subscribeToCustomers(
      c => setCustomers(c),
      () => {},
    )
    return unsub
  }, [companyId])

  // Aggregate per referrer
  const leaderboard = useMemo((): ReferrerStat[] => {
    const map = new Map<string, ReferrerStat>()
    for (const r of referrals) {
      const existing = map.get(r.referrerId)
      if (existing) {
        existing.count++
        existing.revenue += r.referredAmount
        existing.entries.push(r)
      } else {
        map.set(r.referrerId, { id: r.referrerId, name: r.referrerName, count: 1, revenue: r.referredAmount, entries: [r] })
      }
    }
    return [...map.values()].sort((a, b) =>
      sortBy === 'revenue' ? b.revenue - a.revenue || b.count - a.count : b.count - a.count || b.revenue - a.revenue,
    )
  }, [referrals, sortBy])

  const totalRevenue = leaderboard.reduce((s, r) => s + r.revenue, 0)

  async function handleSave({ referrer, referred, amount, notes }: {
    referrer: CustomerItem; referred: CustomerItem; amount: number; notes: string
  }) {
    await addReferral({
      referrerId: referrer.id, referrerName: fullName(referrer),
      referredId: referred.id, referredName: fullName(referred),
      referredAmount: amount, notes,
    })
    setShowForm(false)
    toast('Referral logged', 'success')
  }

  async function handleDelete(id: string) {
    await deleteReferral(id)
    setDeleteId(null)
    toast('Referral removed', 'success')
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Referrals</h1>
          <p className="text-sm text-gray-400 mt-0.5">Track who's sending you business</p>
        </div>
        {!showForm && (
          <button
            onClick={() => setShowForm(true)}
            className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-500 transition-colors"
          >
            + Log Referral
          </button>
        )}
      </div>

      {/* Form */}
      {showForm && (
        <LogForm
          customers={customers}
          onSave={handleSave}
          onCancel={() => setShowForm(false)}
        />
      )}

      {/* Summary strip */}
      {!loading && referrals.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <div className="card p-4 text-center">
            <p className="text-2xl font-bold text-white">{referrals.length}</p>
            <p className="text-xs text-gray-400 mt-0.5">Total Referrals</p>
          </div>
          <div className="card p-4 text-center">
            <p className="text-2xl font-bold text-white">{leaderboard.length}</p>
            <p className="text-xs text-gray-400 mt-0.5">Referrers</p>
          </div>
          <div className="card p-4 text-center">
            <p className="text-2xl font-bold text-green-400">{totalRevenue > 0 ? formatCurrency(totalRevenue) : '—'}</p>
            <p className="text-xs text-gray-400 mt-0.5">Referral Revenue</p>
          </div>
        </div>
      )}

      {/* View toggle + sort */}
      {!loading && referrals.length > 0 && (
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex rounded-xl border border-gray-700 overflow-hidden text-xs font-medium">
            {(['leaderboard', 'all'] as const).map(v => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`px-3 py-1.5 transition-colors capitalize ${view === v ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-gray-200'}`}
              >
                {v === 'leaderboard' ? 'By Referrer' : 'All Referrals'}
              </button>
            ))}
          </div>
          {view === 'leaderboard' && (
            <div className="flex rounded-xl border border-gray-700 overflow-hidden text-xs font-medium">
              {(['revenue', 'count'] as const).map(s => (
                <button
                  key={s}
                  onClick={() => setSortBy(s)}
                  className={`px-3 py-1.5 transition-colors ${sortBy === s ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-gray-200'}`}
                >
                  {s === 'revenue' ? 'By Revenue' : 'By Count'}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="card animate-pulse h-48" />
      ) : referrals.length === 0 ? (
        <div className="card p-12 text-center">
          <p className="text-3xl mb-3">🤝</p>
          <p className="text-gray-400 text-sm">No referrals logged yet.</p>
          <p className="text-gray-600 text-xs mt-1">Track which customers are sending you new business.</p>
        </div>
      ) : view === 'leaderboard' ? (
        <div className="space-y-2">
          {leaderboard.map((stat, i) => (
            <ReferrerCard
              key={stat.id}
              stat={stat}
              rank={i + 1}
              coloredAvatars={coloredAvatars}
            />
          ))}
        </div>
      ) : (
        <div className="card divide-y divide-gray-700/40">
          {referrals.map(r => (
            <div key={r.id} className="flex items-center gap-3 px-4 py-3 group hover:bg-gray-800/30 transition-colors">
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-200">
                  <span className="font-medium">{r.referrerName}</span>
                  <span className="text-gray-500 mx-2">→</span>
                  <span>{r.referredName}</span>
                </p>
                {r.notes && <p className="text-xs text-gray-500 mt-0.5">{r.notes}</p>}
                <p className="text-xs text-gray-600 mt-0.5">{fmtDate(r.createdAt)}</p>
              </div>
              {r.referredAmount > 0 && (
                <span className="text-sm font-semibold text-green-400 shrink-0">{formatCurrency(r.referredAmount)}</span>
              )}
              <div className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                {deleteId === r.id ? (
                  <div className="flex items-center gap-1">
                    <button onClick={() => handleDelete(r.id)} className="text-xs text-red-400 hover:text-red-300 px-2 py-1 rounded">Delete</button>
                    <button onClick={() => setDeleteId(null)} className="text-xs text-gray-500 px-1 py-1">Cancel</button>
                  </div>
                ) : (
                  <button
                    onClick={() => setDeleteId(r.id)}
                    className="p-1.5 rounded-lg text-gray-600 hover:text-red-400 hover:bg-gray-700 transition-colors"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                    </svg>
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {referrals.length > 0 && (
        <p className="text-xs text-gray-600 text-center pb-2">
          {referrals.length} referral{referrals.length !== 1 ? 's' : ''} · {leaderboard.length} referrer{leaderboard.length !== 1 ? 's' : ''}
        </p>
      )}
    </div>
  )
}
