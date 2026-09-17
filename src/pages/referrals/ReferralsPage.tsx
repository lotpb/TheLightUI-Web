import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { usePageTitle } from '../../hooks/usePageTitle'
import { useCustomerDeepLink } from '../../hooks/useCustomerDeepLink'
import CustomerScopeBanner from '../../components/CustomerScopeBanner'
import PartialDataBanner from '../../components/PartialDataBanner'
import ConfirmModal from '../../components/ConfirmModal'
import { Icon, ICONS } from '../../components/Icon'
import { subscribeToReferrals, addReferral, deleteReferral } from '../../services/referralService'
import { subscribeToCustomers } from '../../services/customerService'
import { fullName, formatCurrency, type CustomerItem } from '../../models/customer'
import {
  buildLeaderboard, customersById, findDuplicateReferrals, referralAmountDrift,
  referralFormError, referralTotals, referredIsMissing, resolveReferralName,
  searchReferralCandidates,
  REFERRAL_SORTS,
  type Referral, type ReferralSort, type ReferrerStat,
} from '../../models/referral'
import { useAuthStore } from '../../stores/authStore'
import { useToast } from '../../components/Toast'
import { avatarColor, avatarOriginal } from '../../utils/avatarColor'
import { usePrefStore } from '../../stores/prefStore'

// ── helpers ──────────────────────────────────────────────────────────────────

/** createdAt is a real serverTimestamp, so local formatting is correct here. */
function fmtDate(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

const SUGGESTION_LIMIT = 10

// ── Customer search dropdown ──────────────────────────────────────────────────

function CustomerPicker({
  id, label, placeholder, customers, selected, onSelect, exclude,
}: {
  id: string
  label: string
  placeholder: string
  customers: CustomerItem[]
  selected: CustomerItem | null
  onSelect: (c: CustomerItem | null) => void
  exclude?: string
}) {
  const [query, setQuery]     = useState('')
  const [open, setOpen]       = useState(false)
  const [activeIdx, setActive] = useState(-1)
  const ref = useRef<HTMLDivElement>(null)
  const listId = `${id}-list`

  // Searches email, city and phone as well — it matched fullName alone, so two
  // people with the same name were indistinguishable on a form whose whole
  // job is picking the right two.
  const { matches, total } = useMemo(
    () => searchReferralCandidates(customers, query, exclude, SUGGESTION_LIMIT),
    [customers, query, exclude],
  )

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) { setOpen(false); setActive(-1) }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  function choose(c: CustomerItem) {
    onSelect(c)
    setQuery('')
    setOpen(false)
    setActive(-1)
  }

  /**
   * The dropdown was a stack of buttons with no roles and no key handling,
   * and submit is gated on both pickers being set — so the form could not be
   * completed without a mouse.
   */
  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!open) { setOpen(true); setActive(0); return }
      const last = matches.length - 1
      if (last < 0) return
      setActive(i => (e.key === 'ArrowDown' ? (i >= last ? 0 : i + 1) : (i <= 0 ? last : i - 1)))
      return
    }
    if (e.key === 'Enter' && open && matches[activeIdx]) {
      e.preventDefault()   // don't submit the form on the same keystroke
      choose(matches[activeIdx])
      return
    }
    if (e.key === 'Escape' && open) {
      e.preventDefault()
      setOpen(false)
      setActive(-1)
    }
  }

  return (
    <div ref={ref} className="relative">
      <label htmlFor={id} className="text-xs text-gray-300 mb-1 block">{label} *</label>
      <input
        id={id}
        type="text"
        role="combobox"
        aria-expanded={open && matches.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeIdx >= 0 ? `${id}-opt-${activeIdx}` : undefined}
        value={selected ? fullName(selected) : query}
        onChange={e => { setQuery(e.target.value); onSelect(null); setOpen(true); setActive(-1) }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        className="input-field w-full text-sm py-1.5"
        autoComplete="off"
      />
      {open && matches.length > 0 && (
        <div
          id={listId}
          role="listbox"
          aria-label={label}
          className="absolute top-full left-0 right-0 z-20 mt-1 bg-gray-800 border border-gray-700 rounded-xl shadow-xl max-h-56 overflow-y-auto"
        >
          {matches.map((c, i) => (
            <button
              key={c.id}
              type="button"
              id={`${id}-opt-${i}`}
              role="option"
              aria-selected={i === activeIdx}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(c)}
              className={`w-full text-left px-3 py-2 text-sm text-gray-100 transition-colors ${
                i === activeIdx ? 'bg-indigo-500/30' : 'hover:bg-gray-700'
              }`}
            >
              {fullName(c)}
              {c.amount > 0 && <span className="ml-2 text-xs text-green-400">{formatCurrency(c.amount)}</span>}
              {c.salesman && <span className="ml-2 text-xs text-gray-300">{c.salesman}</span>}
            </button>
          ))}
          {total > matches.length && (
            <p className="px-3 py-2 text-xs text-gray-300 bg-gray-700/50 border-t border-gray-700">
              Showing {matches.length} of {total.toLocaleString()} — keep typing to narrow it down.
            </p>
          )}
        </div>
      )}
      {open && query.trim() && total === 0 && (
        <p className="text-xs text-gray-300 mt-1">No customer matches “{query.trim()}”.</p>
      )}
    </div>
  )
}

// ── Log-referral form ─────────────────────────────────────────────────────────

function LogForm({
  customers, referrals, initialReferrer = null, onSave, onCancel,
}: {
  customers: CustomerItem[]
  referrals: Referral[]
  /**
   * Preselects who sent the referral. Opened from a customer's Related Records
   * panel that's the customer you were just looking at — "this customer
   * referred someone" is the direction worth a click; who they referred still
   * has to be picked.
   */
  initialReferrer?: CustomerItem | null
  onSave: (r: { referrer: CustomerItem; referred: CustomerItem; amount: number; notes: string }) => Promise<void>
  onCancel: () => void
}) {
  const [referrer, setReferrer] = useState<CustomerItem | null>(initialReferrer)
  const [referred, setReferred] = useState<CustomerItem | null>(null)
  const [amount, setAmount]     = useState('')
  const [notes, setNotes]       = useState('')
  const [saving, setSaving]     = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [dupeAcknowledged, setDupeAcknowledged] = useState(false)

  // Auto-fill the amount from the referred customer's current deal value.
  useEffect(() => {
    if (referred && referred.amount > 0) setAmount(String(referred.amount))
  }, [referred])

  const error = referralFormError(referrer?.id ?? '', referred?.id ?? '', amount)

  /**
   * The same pair could be logged any number of times, each one adding the
   * full auto-filled deal value again to that referrer's leaderboard revenue,
   * with nothing on screen to notice it.
   */
  const duplicates = useMemo(
    () => findDuplicateReferrals(referrals, referrer?.id ?? '', referred?.id ?? ''),
    [referrals, referrer?.id, referred?.id],
  )
  useEffect(() => { setDupeAcknowledged(false) }, [referrer?.id, referred?.id])

  const blockedByDupe = duplicates.length > 0 && !dupeAcknowledged

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitted(true)
    if (error || blockedByDupe || !referrer || !referred) return
    setSaving(true)
    try {
      await onSave({ referrer, referred, amount: Number(amount) || 0, notes })
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} noValidate className="card p-4 space-y-3 border border-indigo-500/30">
      <p className="text-sm font-semibold text-white">Log referral</p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <CustomerPicker
          id="referral-referrer"
          label="Referred by"
          placeholder="Who sent the referral…"
          customers={customers}
          selected={referrer}
          onSelect={setReferrer}
          exclude={referred?.id}
        />
        <CustomerPicker
          id="referral-referred"
          label="Referred customer"
          placeholder="Who they referred…"
          customers={customers}
          selected={referred}
          onSelect={setReferred}
          exclude={referrer?.id}
        />
        <div>
          <label htmlFor="referral-amount" className="text-xs text-gray-300 mb-1 block">Deal amount</label>
          <input
            id="referral-amount"
            type="number"
            min="0"
            step="0.01"
            value={amount}
            onChange={e => setAmount(e.target.value)}
            placeholder="0.00"
            className="input-field w-full text-sm py-1.5"
          />
          {referred && (
            <p className="text-xs text-gray-400 mt-1">
              Recorded against this referral — it won’t follow later changes to the deal.
            </p>
          )}
        </div>
        <div>
          <label htmlFor="referral-notes" className="text-xs text-gray-300 mb-1 block">Notes</label>
          <input
            id="referral-notes"
            type="text"
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Optional"
            className="input-field w-full text-sm py-1.5"
          />
        </div>
      </div>

      {duplicates.length > 0 && (
        <div className="flex items-start gap-2 text-sm bg-amber-900/25 border border-amber-600/40 rounded-lg px-3 py-2 text-amber-200">
          <Icon d={ICONS.warning} className="w-4 h-4 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p>
              {fullName(referrer!)} already referred {fullName(referred!)}
              {duplicates.length > 1 ? ` ${duplicates.length} times, most recently ` : ' on '}
              {fmtDate(duplicates[0].createdAt)}. Logging it again counts twice on the leaderboard.
            </p>
            <label className="flex items-center gap-2 mt-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={dupeAcknowledged}
                onChange={e => setDupeAcknowledged(e.target.checked)}
                className="w-3.5 h-3.5 rounded accent-amber-500"
              />
              <span className="text-xs">This is a separate referral — log it anyway</span>
            </label>
          </div>
        </div>
      )}

      {submitted && error && (
        <p role="alert" className="flex items-start gap-2 text-sm text-red-300 bg-red-900/25 border border-red-700/50 rounded-lg px-3 py-2">
          <Icon d={ICONS.warning} className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </p>
      )}

      <div className="flex gap-2 pt-1">
        <button type="button" onClick={onCancel} className="btn-secondary text-sm px-4 py-1.5">Cancel</button>
        <button
          type="submit"
          disabled={saving || blockedByDupe}
          className="px-4 py-1.5 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-500
                     disabled:opacity-40 disabled:cursor-not-allowed transition-colors
                     focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
        >
          {saving ? 'Saving…' : 'Log referral'}
        </button>
      </div>
    </form>
  )
}

// ── Referrer card ─────────────────────────────────────────────────────────────

function ReferrerCard({
  stat, rank, coloredAvatars, byId, onDelete,
}: {
  stat: ReferrerStat
  rank: number
  coloredAvatars: boolean
  byId: Map<string, CustomerItem>
  onDelete: (r: Referral) => void
}) {
  const [open, setOpen] = useState(false)
  const color = coloredAvatars ? avatarColor(stat.name) : avatarOriginal()
  const initials = stat.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
  const stillACustomer = byId.has(stat.id)

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="relative shrink-0">
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold"
            style={{ background: color.bg, color: color.text }}
          >
            {initials || '?'}
          </div>
          {/* Was 🥇🥈🥉 — platform bitmaps that ignore `color` and sit off the
              text baseline. A numeric rank for everyone, with a trophy on the
              leader; amber-400 is the only medal-ish hue with a light-mode
              override, so the other two are plain. */}
          <span
            className={`absolute -top-1 -right-1 min-w-4 h-4 px-1 rounded-full text-[10px] font-bold
                        flex items-center justify-center tabular-nums ${
              rank === 1 ? 'bg-amber-500 text-gray-950' : 'bg-gray-700 text-gray-100'
            }`}
            aria-hidden="true"
          >
            {rank}
          </span>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            {rank === 1 && <Icon d={ICONS.trophy} className="w-3.5 h-3.5 text-amber-400 shrink-0" />}
            {/* The page had no Link and no router import at all, so there was
                no way to reach either customer from a referral. */}
            {stillACustomer ? (
              <Link
                to={`/records/${stat.id}`}
                className="text-sm font-semibold text-gray-100 truncate hover:text-indigo-300 transition-colors
                           focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 rounded"
              >
                {stat.name}
              </Link>
            ) : (
              <span className="text-sm font-semibold text-gray-100 truncate" title="This customer record no longer exists">
                {stat.name}
              </span>
            )}
          </div>
          <p className="text-xs text-gray-300">
            {stat.count} referral{stat.count !== 1 ? 's' : ''}
            {stat.revenue > 0 && <span className="text-green-400 ml-2">{formatCurrency(stat.revenue)}</span>}
            <span className="text-gray-400 ml-2">last {fmtDate(stat.lastAt)}</span>
          </p>
        </div>

        <button
          onClick={() => setOpen(o => !o)}
          aria-expanded={open}
          aria-label={open ? `Hide ${stat.name}'s referrals` : `Show ${stat.name}'s referrals`}
          className="shrink-0 p-1.5 rounded-lg text-gray-300 hover:text-white hover:bg-gray-700/60 transition-colors
                     focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
        >
          {/* Was a hand-rolled inline chevron path. */}
          <Icon d={open ? ICONS.chevronDown : ICONS.chevronRight} className="w-4 h-4" />
        </button>
      </div>

      {open && (
        <div className="border-t border-gray-700 divide-y divide-gray-700 bg-gray-700/40">
          {stat.entries.map(e => (
            <ReferralRow key={e.id} r={e} byId={byId} onDelete={onDelete} compact />
          ))}
        </div>
      )}
    </div>
  )
}

// ── One referral row ──────────────────────────────────────────────────────────

function ReferralRow({
  r, byId, onDelete, compact = false,
}: {
  r: Referral
  byId: Map<string, CustomerItem>
  onDelete: (r: Referral) => void
  compact?: boolean
}) {
  const referredName = resolveReferralName(r.referredId, r.referredName, byId)
  const referrerName = resolveReferralName(r.referrerId, r.referrerName, byId)
  const drift = referralAmountDrift(r, byId)
  const gone  = referredIsMissing(r, byId)

  return (
    <div className={`flex items-center gap-3 px-4 py-3 hover:bg-gray-700/50 transition-colors ${compact ? 'px-5 py-2.5' : ''}`}>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-gray-100">
          {!compact && (
            <>
              <NameLink id={r.referrerId} name={referrerName} byId={byId} bold />
              {/* Was text-gray-500 at 3.04:1. */}
              <span className="text-gray-300 mx-2" aria-label="referred">→</span>
            </>
          )}
          {compact && <span className="text-gray-300 mr-1" aria-hidden="true">→</span>}
          <NameLink id={r.referredId} name={referredName} byId={byId} />
          {gone && <span className="text-xs text-gray-400 ml-2">(record deleted)</span>}
        </p>
        {r.notes && <p className="text-xs text-gray-300 mt-0.5 truncate">{r.notes}</p>}
        {/* Dates were text-gray-600 — 1.94:1 — and they're the only temporal
            context a referral has. */}
        <p className="text-xs text-gray-400 mt-0.5">{fmtDate(r.createdAt)}</p>
      </div>

      {r.referredAmount > 0 && (
        <div className="shrink-0 text-right">
          <span className="text-sm font-semibold text-green-400">{formatCurrency(r.referredAmount)}</span>
          {/* The recorded amount is a snapshot; /customers shows the live
              value, so the two silently disagreed once a deal changed. */}
          {drift && (
            <p className="text-xs text-gray-400" title="Recorded when the referral was logged">
              now {formatCurrency(drift.current)}
            </p>
          )}
        </div>
      )}

      {/* Was opacity-0 group-hover:opacity-100 — invisible until hover, so
          unreachable on touch entirely, and still in the tab order. */}
      <button
        onClick={() => onDelete(r)}
        aria-label={`Remove referral: ${referrerName} referred ${referredName}`}
        className="shrink-0 p-1.5 rounded-lg text-gray-300 hover:text-red-400 hover:bg-gray-700 transition-colors
                   focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
      >
        <Icon d={ICONS.trash} className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}

function NameLink({ id, name, byId, bold }: {
  id: string; name: string; byId: Map<string, CustomerItem>; bold?: boolean
}) {
  if (!byId.has(id)) return <span className={bold ? 'font-medium' : undefined}>{name}</span>
  return (
    <Link
      to={`/records/${id}`}
      className={`hover:text-indigo-300 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 rounded ${bold ? 'font-medium' : ''}`}
    >
      {name}
    </Link>
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
  const [hitCap, setHitCap]       = useState(false)
  const [custCap, setCustCap]     = useState(false)
  const [showForm, setShowForm]   = useState(false)
  const [confirmDel, setConfirmDel] = useState<Referral | null>(null)
  const [view, setView]           = useState<'leaderboard' | 'all'>('leaderboard')
  const [sortBy, setSortBy]       = useState<ReferralSort>('revenue')

  // Both listeners report a hitCap flag and both callers dropped it, so past
  // 5,000 records the leaderboard and all three summary figures were computed
  // from a truncated set with nothing saying so.
  useEffect(() => {
    const unsub = subscribeToReferrals(
      (r, cap) => { setReferrals(r); setHitCap(!!cap); setLoading(false) },
      ()        => setLoading(false),
    )
    return unsub
  }, [companyId])

  useEffect(() => {
    const unsub = subscribeToCustomers(
      (c, cap) => { setCustomers(c); setCustCap(!!cap) },
      () => {},
    )
    return unsub
  }, [companyId])

  const byId = useMemo(() => customersById(customers), [customers])

  // Arriving from a customer's Related Records panel: scope to the referrals
  // they're on either side of, and on `&new=1` open the form with them set as
  // the referrer.
  const { customerId: scopeId, customerName: scopeName, isScoped, clearScope } =
    useCustomerDeepLink(customers, openLogFor)

  const [logReferrer, setLogReferrer] = useState<CustomerItem | null>(null)

  function openLogFor(c: CustomerItem) {
    setLogReferrer(c)
    setShowForm(true)
  }

  function closeForm() {
    setShowForm(false)
    setLogReferrer(null)
  }

  const scopedReferrals = useMemo(
    () => (isScoped
      ? referrals.filter(r => r.referrerId === scopeId || r.referredId === scopeId)
      : referrals),
    [referrals, isScoped, scopeId],
  )

  // One customer's referrals don't need a leaderboard ranking them against
  // themselves, so a scoped view always uses the flat list.
  const effectiveView = isScoped ? 'all' : view

  const leaderboard = useMemo(
    () => buildLeaderboard(scopedReferrals, sortBy, byId),
    [scopedReferrals, sortBy, byId],
  )
  const totals = useMemo(() => referralTotals(scopedReferrals), [scopedReferrals])

  async function handleSave({ referrer, referred, amount, notes }: {
    referrer: CustomerItem; referred: CustomerItem; amount: number; notes: string
  }) {
    try {
      await addReferral({
        referrerId: referrer.id, referrerName: fullName(referrer),
        referredId: referred.id, referredName: fullName(referred),
        referredAmount: amount, notes,
      })
      closeForm()
      toast('Referral logged', 'success')
    } catch {
      // Was uncaught: a rejected write left the form open with no message,
      // indistinguishable from a save that simply didn't close it.
      toast('Could not log the referral — nothing was saved. Try again.', 'error')
    }
  }

  async function handleDelete(r: Referral) {
    setConfirmDel(null)
    try {
      await deleteReferral(r.id)
      toast('Referral removed', 'success')
    } catch {
      toast('Could not remove the referral. Try again.', 'error')
    }
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-white">Referrals</h1>
          <p className="text-sm text-gray-300 mt-0.5">Track who’s sending you business</p>
        </div>
        {!showForm && (
          <button
            onClick={() => setShowForm(true)}
            className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-500
                       transition-colors shrink-0 inline-flex items-center gap-1.5
                       focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
          >
            <Icon d={ICONS.plus} className="w-4 h-4" />
            Log referral
          </button>
        )}
      </div>

      {isScoped && (
        <CustomerScopeBanner customerId={scopeId} customerName={scopeName} onClear={clearScope} />
      )}

      {hitCap && <PartialDataBanner totals />}
      {custCap && !hitCap && (
        <PartialDataBanner detail="The customer list is capped, so someone past the cap won’t appear in the pickers below." />
      )}

      {/* Form */}
      {showForm && (
        <LogForm
          customers={customers}
          referrals={referrals}
          initialReferrer={logReferrer}
          onSave={handleSave}
          onCancel={closeForm}
        />
      )}

      {/* Summary strip */}
      {!isScoped && !loading && referrals.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <div className="card p-4 text-center">
            <p className="text-2xl font-bold text-white tabular-nums">{totals.referrals}</p>
            <p className="text-xs text-gray-300 mt-0.5">Total referrals</p>
          </div>
          <div className="card p-4 text-center">
            <p className="text-2xl font-bold text-white tabular-nums">{totals.referrers}</p>
            <p className="text-xs text-gray-300 mt-0.5">Referrers</p>
          </div>
          <div className="card p-4 text-center">
            <p className="text-2xl font-bold text-green-400 tabular-nums">
              {totals.revenue > 0 ? formatCurrency(totals.revenue) : '—'}
            </p>
            <p className="text-xs text-gray-300 mt-0.5">
              Referral revenue
              {totals.withoutAmount > 0 && (
                <span className="text-gray-400"> · {totals.withoutAmount} without an amount</span>
              )}
            </p>
          </div>
        </div>
      )}

      {/* View toggle + sort */}
      {!isScoped && !loading && referrals.length > 0 && (
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex rounded-xl border border-gray-600 overflow-hidden text-xs font-medium" role="group" aria-label="View">
            {(['leaderboard', 'all'] as const).map(v => (
              <button
                key={v}
                onClick={() => setView(v)}
                aria-pressed={view === v}
                className={`px-3 py-1.5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-400 ${
                  view === v ? 'bg-indigo-600 text-white' : 'text-gray-300 hover:text-white hover:bg-gray-700'
                }`}
              >
                {v === 'leaderboard' ? 'By referrer' : 'All referrals'}
              </button>
            ))}
          </div>
          {view === 'leaderboard' && (
            <div className="flex rounded-xl border border-gray-600 overflow-hidden text-xs font-medium" role="group" aria-label="Sort">
              {REFERRAL_SORTS.map(s => (
                <button
                  key={s.key}
                  onClick={() => setSortBy(s.key)}
                  aria-pressed={sortBy === s.key}
                  className={`px-3 py-1.5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-400 ${
                    sortBy === s.key ? 'bg-indigo-600 text-white' : 'text-gray-300 hover:text-white hover:bg-gray-700'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="space-y-2 animate-pulse">
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="card h-16" />)}
        </div>
      ) : scopedReferrals.length === 0 ? (
        <div className="card p-12 text-center">
          {/* Was 🤝 — an emoji that paints its own bitmap. */}
          <Icon d={ICONS.user} className="w-9 h-9 mx-auto mb-3 text-gray-400" />
          <p className="text-gray-200 text-sm font-medium">
            {isScoped ? 'No referrals for this customer yet.' : 'No referrals logged yet.'}
          </p>
          <p className="text-gray-300 text-xs mt-1">Track which customers are sending you new business.</p>
        </div>
      ) : effectiveView === 'leaderboard' ? (
        <div className="space-y-2">
          {leaderboard.map((stat, i) => (
            <ReferrerCard
              key={stat.id}
              stat={stat}
              rank={i + 1}
              coloredAvatars={coloredAvatars}
              byId={byId}
              onDelete={setConfirmDel}
            />
          ))}
        </div>
      ) : (
        <div className="card divide-y divide-gray-700">
          {scopedReferrals.map(r => (
            <ReferralRow key={r.id} r={r} byId={byId} onDelete={setConfirmDel} />
          ))}
        </div>
      )}

      {scopedReferrals.length > 0 && (
        <p className="text-xs text-gray-300 text-center pb-2">
          {totals.referrals} referral{totals.referrals !== 1 ? 's' : ''} · {totals.referrers} referrer{totals.referrers !== 1 ? 's' : ''}
        </p>
      )}

      {/* Was an inline two-click that only existed on hover, so it couldn't be
          reached on touch and was absent from the leaderboard entirely. */}
      <ConfirmModal
        isOpen={!!confirmDel}
        confirmLabel="Remove referral"
        message={confirmDel
          ? `Remove the referral from ${resolveReferralName(confirmDel.referrerId, confirmDel.referrerName, byId)} to ${resolveReferralName(confirmDel.referredId, confirmDel.referredName, byId)}? It will stop counting toward their leaderboard total. This cannot be undone.`
          : ''}
        onConfirm={() => confirmDel && handleDelete(confirmDel)}
        onCancel={() => setConfirmDel(null)}
      />
    </div>
  )
}
