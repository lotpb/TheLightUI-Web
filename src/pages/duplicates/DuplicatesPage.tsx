import { useEffect, useMemo, useState } from 'react'
import PartialDataBanner from '../../components/PartialDataBanner'
import { Link } from 'react-router-dom'
import { usePageTitle } from '../../hooks/usePageTitle'
import { subscribeToCustomers, mergeCustomers } from '../../services/customerService'
import { fullName, formatCurrency, type CustomerItem } from '../../models/customer'
import { useAuthStore } from '../../stores/authStore'
import { useToast } from '../../components/Toast'

// ─── Deduplication logic ─────────────────────────────────────────────────────

function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, '')
}

function normalizeName(c: CustomerItem): string {
  return `${c.first.trim()} ${c.lastname.trim()}`.toLowerCase().replace(/\s+/g, ' ').trim()
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

// Classic single-row Levenshtein edit distance.
function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const row = [i]
    for (let j = 1; j <= b.length; j++) {
      row[j] = a[i - 1] === b[j - 1]
        ? prev[j - 1]
        : 1 + Math.min(prev[j - 1], prev[j], row[j - 1])
    }
    prev = row
  }
  return prev[b.length]
}

type DupeReason = 'phone' | 'email' | 'name' | 'fuzzy-name'

const REASON_LABEL: Record<DupeReason, string> = {
  phone: 'Same Phone',
  email: 'Same Email',
  name: 'Same Name',
  'fuzzy-name': 'Similar Name',
}

const REASON_BADGE: Record<DupeReason, string> = {
  phone: 'bg-orange-900/40 text-orange-400',
  email: 'bg-sky-900/40 text-sky-400',
  name: 'bg-yellow-900/40 text-yellow-400',
  'fuzzy-name': 'bg-violet-900/40 text-violet-400',
}

interface DupePair {
  key: string          // stable sorted ID pair
  reason: DupeReason
  matchValue: string   // the shared phone / email / name
  similarity?: number  // 0-1, only set for fuzzy-name
  a: CustomerItem
  b: CustomerItem
}

function findDuplicates(items: CustomerItem[]): DupePair[] {
  const pairs = new Map<string, DupePair>()

  function addPair(a: CustomerItem, b: CustomerItem, reason: DupeReason, matchValue: string, similarity?: number) {
    const [id1, id2] = [a.id, b.id].sort()
    const key = `${id1}|${id2}`
    // Exact matches (phone/email/name) take priority over a fuzzy-name guess for the same pair.
    if (!pairs.has(key) || (pairs.get(key)!.reason === 'fuzzy-name' && reason !== 'fuzzy-name')) {
      pairs.set(key, { key, reason, matchValue, similarity, a, b })
    }
  }

  // Phone-based: group by digits-only phone (≥7 digits to avoid bad data)
  const byPhone = new Map<string, CustomerItem[]>()
  for (const c of items) {
    const p = normalizePhone(c.phone)
    if (p.length < 7) continue
    const group = byPhone.get(p) ?? []
    group.push(c)
    byPhone.set(p, group)
  }
  for (const [phone, group] of byPhone) {
    if (group.length < 2) continue
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        addPair(group[i], group[j], 'phone', phone)
      }
    }
  }

  // Email-based: group by lowercased email
  const byEmail = new Map<string, CustomerItem[]>()
  for (const c of items) {
    const e = normalizeEmail(c.email)
    if (!e.includes('@')) continue
    const group = byEmail.get(e) ?? []
    group.push(c)
    byEmail.set(e, group)
  }
  for (const [email, group] of byEmail) {
    if (group.length < 2) continue
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        addPair(group[i], group[j], 'email', email)
      }
    }
  }

  // Name-based: group by normalised first+last (both parts must be non-empty)
  const byName = new Map<string, CustomerItem[]>()
  for (const c of items) {
    if (!c.first.trim() || !c.lastname.trim()) continue
    const n = normalizeName(c)
    const group = byName.get(n) ?? []
    group.push(c)
    byName.set(n, group)
  }
  for (const [name, group] of byName) {
    if (group.length < 2) continue
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        addPair(group[i], group[j], 'name', name)
      }
    }
  }

  // Fuzzy name matching — catches typos ("Jonh"/"John") and nicknames that
  // exact matching misses. Blocked by first letter of last name to keep the
  // pairwise comparison count manageable on larger customer lists.
  const blocks = new Map<string, CustomerItem[]>()
  for (const c of items) {
    const last = c.lastname.trim()
    if (last.length < 2) continue
    const key = last[0].toLowerCase()
    const group = blocks.get(key) ?? []
    group.push(c)
    blocks.set(key, group)
  }
  for (const group of blocks.values()) {
    if (group.length < 2) continue
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i], b = group[j]
        const nameA = normalizeName(a), nameB = normalizeName(b)
        if (!nameA || !nameB || nameA === nameB) continue
        const maxLen = Math.max(nameA.length, nameB.length)
        if (maxLen < 5) continue // too short to fuzzy-match reliably
        const dist = levenshtein(nameA, nameB)
        const similarity = 1 - dist / maxLen
        if (dist > 0 && dist <= 3 && similarity >= 0.75) {
          addPair(a, b, 'fuzzy-name', `${nameA} ≈ ${nameB}`, similarity)
        }
      }
    }
  }

  const REASON_ORDER: Record<DupeReason, number> = { phone: 0, email: 1, name: 2, 'fuzzy-name': 3 }
  return [...pairs.values()].sort((a, b) => {
    if (a.reason !== b.reason) return REASON_ORDER[a.reason] - REASON_ORDER[b.reason]
    return a.matchValue.localeCompare(b.matchValue)
  })
}

// ─── Merge helpers ───────────────────────────────────────────────────────────

interface MergeChange {
  label: string
  from: string
  action: 'fill' | 'combine'
  firestoreKey: string
  value: unknown
}

function computeMergeChanges(primary: CustomerItem, secondary: CustomerItem): {
  updates: Record<string, unknown>
  changes: MergeChange[]
} {
  const updates: Record<string, unknown> = {}
  const changes: MergeChange[] = []

  const stringFields: { key: keyof CustomerItem; label: string; fsKey: string }[] = [
    { key: 'phone',         label: 'Phone',          fsKey: 'phone' },
    { key: 'email',         label: 'Email',          fsKey: 'email' },
    { key: 'street',        label: 'Street',         fsKey: 'address' },
    { key: 'city',          label: 'City',           fsKey: 'city' },
    { key: 'state',         label: 'State',          fsKey: 'state' },
    { key: 'zip',           label: 'ZIP',            fsKey: 'zip' },
    { key: 'salesman',      label: 'Salesman',       fsKey: 'salesman' },
    { key: 'adNo',          label: 'Ad Source',      fsKey: 'adNo' },
    { key: 'product',       label: 'Product',        fsKey: 'product' },
    { key: 'contractor',    label: 'Contractor',     fsKey: 'contractor' },
    { key: 'job',           label: 'Job',            fsKey: 'job' },
    { key: 'spouse',        label: 'Spouse',         fsKey: 'spouse' },
    { key: 'birthDate',     label: 'Birth Date',     fsKey: 'birthDate' },
    { key: 'driverLicense', label: "Driver's Lic",   fsKey: 'driverLicense' },
  ]

  for (const { key, label, fsKey } of stringFields) {
    const pVal = (primary[key] as string | undefined)?.trim() ?? ''
    const sVal = (secondary[key] as string | undefined)?.trim() ?? ''
    if (!pVal && sVal) {
      updates[fsKey] = sVal
      changes.push({ label, from: sVal, action: 'fill', firestoreKey: fsKey, value: sVal })
    }
  }

  // Amount: take non-zero, prefer higher
  if (!primary.amount && secondary.amount) {
    updates['amount'] = secondary.amount
    changes.push({ label: 'Amount', from: formatCurrency(secondary.amount), action: 'fill', firestoreKey: 'amount', value: secondary.amount })
  }

  // Photo
  if (!primary.photo && secondary.photo) {
    updates['photo'] = secondary.photo
    changes.push({ label: 'Photo', from: 'from secondary', action: 'fill', firestoreKey: 'photo', value: secondary.photo })
  }

  // Comments: concatenate if both exist
  if (primary.comments?.trim() && secondary.comments?.trim()) {
    const merged = `${primary.comments.trim()}\n\n--- (merged) ---\n${secondary.comments.trim()}`
    updates['comments'] = merged
    changes.push({ label: 'Comments', from: 'combined from both', action: 'combine', firestoreKey: 'comments', value: merged })
  } else if (!primary.comments?.trim() && secondary.comments?.trim()) {
    updates['comments'] = secondary.comments
    changes.push({ label: 'Comments', from: secondary.comments.slice(0, 60) + (secondary.comments.length > 60 ? '…' : ''), action: 'fill', firestoreKey: 'comments', value: secondary.comments })
  }

  // Tags: union
  const pTags = primary.tags ?? []
  const sTags = secondary.tags ?? []
  const newTags = sTags.filter(t => !pTags.includes(t))
  if (newTags.length > 0) {
    const merged = [...pTags, ...newTags]
    updates['tags'] = merged
    changes.push({ label: 'Tags', from: newTags.join(', '), action: 'combine', firestoreKey: 'tags', value: merged })
  }

  return { updates, changes }
}

// ─── Field row ───────────────────────────────────────────────────────────────

function RecordCard({ customer: c, highlight }: { customer: CustomerItem; highlight: DupeReason }) {
  const name     = fullName(c)
  const initials = [c.first[0], c.lastname[0]].filter(Boolean).join('').toUpperCase()
  const nameHighlighted = highlight === 'name' || highlight === 'fuzzy-name'

  return (
    <div className="flex-1 min-w-0 bg-gray-800/50 rounded-xl p-3 space-y-2">
      <div className="flex items-center gap-2">
        <div className="w-9 h-9 rounded-full bg-gray-700 flex items-center justify-center shrink-0">
          {c.photo ? (
            <img src={c.photo} alt={name} className="w-full h-full object-cover rounded-full" />
          ) : (
            <span className="text-xs font-semibold text-gray-300">{initials || '?'}</span>
          )}
        </div>
        <div className="min-w-0">
          <p className={`text-sm font-semibold truncate ${nameHighlighted ? 'text-yellow-300' : 'text-gray-100'}`}>
            {name || '—'}
          </p>
          <p className="text-xs text-gray-500 capitalize">{c.category}</p>
        </div>
      </div>

      <div className="space-y-1 text-xs">
        {c.phone && (
          <p className={`truncate ${highlight === 'phone' ? 'text-yellow-300 font-medium' : 'text-gray-400'}`}>
            📞 {c.phone}
          </p>
        )}
        {c.email && (
          <p className={`truncate ${highlight === 'email' ? 'text-yellow-300 font-medium' : 'text-gray-400'}`}>
            ✉ {c.email}
          </p>
        )}
        {c.salesman && <p className="text-gray-500 truncate">👤 {c.salesman}</p>}
        {c.amount > 0 && <p className="text-green-400">{formatCurrency(c.amount)}</p>}
        <p className="text-gray-600">
          Added {c.creationDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
        </p>
      </div>

      <Link
        to={`/records/${c.id}`}
        className="block text-center text-xs text-indigo-400 hover:text-indigo-300 bg-gray-700/50 hover:bg-gray-700 rounded-lg py-1.5 transition-colors"
      >
        Open Record →
      </Link>
    </div>
  )
}

// ─── Page ────────────────────────────────────────────────────────────────────

type FilterMode = 'all' | DupeReason

export default function DuplicatesPage() {
  usePageTitle('Duplicates')
  const companyId = useAuthStore(s => s.companyId)
  const toast = useToast()
  const [all, setAll]         = useState<CustomerItem[]>([])
  const [loading, setLoading] = useState(true)
  const [hitCap, setHitCap] = useState(false)
  const [filter, setFilter]   = useState<FilterMode>('all')
  const [mergeTarget, setMergeTarget] = useState<DupePair | null>(null)
  const [merging, setMerging] = useState(false)

  const dismissedKey = `duplicates_dismissed_${companyId}`
  const [dismissed, setDismissed] = useState<Set<string>>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(`duplicates_dismissed_${companyId ?? ''}`) ?? '[]')
      return new Set<string>(Array.isArray(stored) ? stored : [])
    } catch { return new Set() }
  })

  // Reload dismissed when companyId resolves
  useEffect(() => {
    if (!companyId) return
    try {
      const stored = JSON.parse(localStorage.getItem(`duplicates_dismissed_${companyId}`) ?? '[]')
      setDismissed(new Set<string>(Array.isArray(stored) ? stored : []))
    } catch { setDismissed(new Set()) }
  }, [companyId])

  useEffect(() => {
    setLoading(true)
    const unsub = subscribeToCustomers(
      (items, cap) => { setAll(items); setHitCap(!!cap); setLoading(false) },
      ()    => setLoading(false),
    )
    return unsub
  }, [companyId])

  const allPairs = useMemo(() => findDuplicates(all), [all])

  const pairs = useMemo(() => {
    let p = allPairs.filter(d => !dismissed.has(d.key))
    if (filter !== 'all') p = p.filter(d => d.reason === filter)
    return p
  }, [allPairs, dismissed, filter])

  const phoneCount     = allPairs.filter(d => !dismissed.has(d.key) && d.reason === 'phone').length
  const emailCount     = allPairs.filter(d => !dismissed.has(d.key) && d.reason === 'email').length
  const nameCount      = allPairs.filter(d => !dismissed.has(d.key) && d.reason === 'name').length
  const fuzzyNameCount = allPairs.filter(d => !dismissed.has(d.key) && d.reason === 'fuzzy-name').length
  const totalCount = phoneCount + emailCount + nameCount + fuzzyNameCount

  function dismiss(key: string) {
    const next = new Set(dismissed)
    next.add(key)
    setDismissed(next)
    if (companyId) localStorage.setItem(dismissedKey, JSON.stringify([...next]))
  }

  function undismissAll() {
    setDismissed(new Set())
    if (companyId) localStorage.removeItem(dismissedKey)
  }

  async function handleMerge(primaryId: string, secondaryId: string, updates: Record<string, unknown>, pairKey: string) {
    setMerging(true)
    try {
      await mergeCustomers(primaryId, secondaryId, updates)
      dismiss(pairKey)
      setMergeTarget(null)
      toast('Records merged. Secondary record deactivated.', 'success')
    } catch (err) {
      toast(`Merge failed: ${err instanceof Error ? err.message : 'Unknown error'}`, 'error')
    } finally {
      setMerging(false)
    }
  }

  const dismissedCount = allPairs.filter(d => dismissed.has(d.key)).length

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-5">
      {hitCap && <PartialDataBanner totals />}
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Duplicate Detector</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            Exact phone/email/name matches, plus fuzzy name matches that catch typos
          </p>
        </div>
        {dismissedCount > 0 && (
          <button onClick={undismissAll} className="text-xs text-gray-500 hover:text-gray-300 transition-colors">
            Restore {dismissedCount} dismissed
          </button>
        )}
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 overflow-x-auto scrollbar-none">
        {([
          { id: 'all',        label: `All (${totalCount})` },
          { id: 'phone',      label: `Same Phone (${phoneCount})` },
          { id: 'email',      label: `Same Email (${emailCount})` },
          { id: 'name',       label: `Same Name (${nameCount})` },
          { id: 'fuzzy-name', label: `Similar Name (${fuzzyNameCount})` },
        ] as { id: FilterMode; label: string }[]).map(f => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={`shrink-0 px-3 py-1 rounded-full text-xs font-medium transition-colors whitespace-nowrap ${
              filter === f.id
                ? 'bg-indigo-600 text-white'
                : 'bg-gray-800 text-gray-400 hover:text-gray-200'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Content */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => <div key={i} className="card h-40 animate-pulse" />)}
        </div>
      ) : pairs.length === 0 ? (
        <div className="card p-12 text-center space-y-2">
          <svg className="w-12 h-12 text-gray-700 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
          </svg>
          <p className="text-gray-400 text-sm font-medium">No duplicates found</p>
          <p className="text-gray-600 text-xs">
            {dismissedCount > 0 ? `${dismissedCount} pair${dismissedCount !== 1 ? 's' : ''} dismissed.` : 'All records look clean.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {pairs.map(pair => (
            <div key={pair.key} className="card overflow-hidden">
              {/* Pair header */}
              <div className="flex items-center justify-between px-4 py-2.5 bg-gray-800/60 border-b border-gray-700/50">
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${REASON_BADGE[pair.reason]}`}>
                    {REASON_LABEL[pair.reason]}
                  </span>
                  <span className="text-xs text-gray-500 truncate max-w-[180px]">
                    {pair.reason === 'fuzzy-name' && pair.similarity !== undefined
                      ? `${Math.round(pair.similarity * 100)}% similar`
                      : pair.matchValue}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setMergeTarget(pair)}
                    className="text-xs text-indigo-400 hover:text-indigo-300 px-2 py-1 rounded-lg hover:bg-gray-700/50 transition-colors font-medium"
                  >
                    Merge
                  </button>
                  <button
                    onClick={() => dismiss(pair.key)}
                    className="text-xs text-gray-600 hover:text-gray-300 px-2 py-1 rounded-lg hover:bg-gray-700/50 transition-colors"
                  >
                    Dismiss
                  </button>
                </div>
              </div>

              {/* Two record panels */}
              <div className="flex gap-2 p-3">
                <RecordCard customer={pair.a} highlight={pair.reason} />
                <div className="flex items-center justify-center shrink-0">
                  <div className="w-6 h-6 rounded-full bg-gray-700 flex items-center justify-center">
                    <svg className="w-3 h-3 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21 3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
                    </svg>
                  </div>
                </div>
                <RecordCard customer={pair.b} highlight={pair.reason} />
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && pairs.length > 0 && (
        <p className="text-xs text-gray-600 text-center pb-2">
          Click "Merge" to combine two records, or "Dismiss" if they are not duplicates.
        </p>
      )}

      {mergeTarget && (
        <MergeModal
          pair={mergeTarget}
          working={merging}
          onMerge={handleMerge}
          onClose={() => setMergeTarget(null)}
        />
      )}
    </div>
  )
}

// ─── Merge modal ─────────────────────────────────────────────────────────────

function MergeModal({
  pair,
  working,
  onMerge,
  onClose,
}: {
  pair: DupePair
  working: boolean
  onMerge: (primaryId: string, secondaryId: string, updates: Record<string, unknown>, key: string) => void
  onClose: () => void
}) {
  const [primaryIsA, setPrimaryIsA] = useState(true)
  const primary   = primaryIsA ? pair.a : pair.b
  const secondary = primaryIsA ? pair.b : pair.a

  const { updates, changes } = computeMergeChanges(primary, secondary)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-lg bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-700/60 shrink-0">
          <h2 className="text-base font-semibold text-white">Merge Records</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="overflow-y-auto p-6 space-y-5">
          {/* Primary selector */}
          <div>
            <p className="text-xs text-gray-500 mb-2 font-medium uppercase tracking-wider">Keep as primary (will be updated)</p>
            <div className="flex gap-2">
              {([{ isA: true, c: pair.a }, { isA: false, c: pair.b }] as { isA: boolean; c: CustomerItem }[]).map(({ isA, c }) => {
                const selected = primaryIsA === isA
                return (
                  <button
                    key={c.id}
                    onClick={() => setPrimaryIsA(isA)}
                    className={`flex-1 text-left p-3 rounded-xl border transition-colors ${
                      selected
                        ? 'border-indigo-500 bg-indigo-600/15'
                        : 'border-gray-700 bg-gray-800/50 hover:border-gray-600'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <div className={`w-3 h-3 rounded-full border-2 shrink-0 flex items-center justify-center ${selected ? 'border-indigo-500' : 'border-gray-600'}`}>
                        {selected && <div className="w-1.5 h-1.5 rounded-full bg-indigo-400" />}
                      </div>
                      <span className="text-sm font-semibold text-gray-100 truncate">{fullName(c) || '—'}</span>
                    </div>
                    {c.phone && <p className="text-xs text-gray-400 ml-5">📞 {c.phone}</p>}
                    {c.email && <p className="text-xs text-gray-400 ml-5 truncate">✉ {c.email}</p>}
                    <p className="text-xs text-gray-600 ml-5 mt-0.5">
                      Added {c.creationDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </p>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Changes preview */}
          <div>
            <p className="text-xs text-gray-500 mb-2 font-medium uppercase tracking-wider">
              {changes.length === 0 ? 'No fields to merge' : `${changes.length} field${changes.length !== 1 ? 's' : ''} will be updated`}
            </p>
            {changes.length === 0 ? (
              <p className="text-sm text-gray-400 bg-gray-800/50 rounded-xl p-3">
                The primary already has values for all fields the secondary provides. Only the secondary will be deactivated.
              </p>
            ) : (
              <div className="bg-gray-800/50 rounded-xl divide-y divide-gray-700/50">
                {changes.map(c => (
                  <div key={c.firestoreKey} className="flex items-start gap-3 px-3 py-2.5">
                    <span className={`text-xs font-semibold px-1.5 py-0.5 rounded shrink-0 mt-0.5 ${
                      c.action === 'combine' ? 'bg-violet-900/50 text-violet-400' : 'bg-sky-900/50 text-sky-400'
                    }`}>
                      {c.action === 'combine' ? 'combine' : 'fill'}
                    </span>
                    <div className="min-w-0">
                      <span className="text-sm text-gray-300 font-medium">{c.label}</span>
                      <p className="text-xs text-gray-500 truncate mt-0.5">{c.from}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Warning */}
          <div className="flex gap-2 bg-amber-900/20 border border-amber-700/40 rounded-xl px-3 py-2.5 text-xs text-amber-300">
            <svg className="w-4 h-4 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
            </svg>
            The secondary record ({fullName(secondary) || 'unnamed'}) will be <strong className="text-amber-200 mx-0.5">deactivated</strong> and hidden from active lists. This cannot be undone automatically.
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-3 px-6 py-4 border-t border-gray-700/60 shrink-0">
          <button
            onClick={onClose}
            className="flex-1 py-2 rounded-xl border border-gray-700 text-sm text-gray-400 hover:text-gray-200 hover:border-gray-600 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => onMerge(primary.id, secondary.id, updates, pair.key)}
            disabled={working}
            className="flex-1 py-2 rounded-xl bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-500 transition-colors disabled:opacity-40"
          >
            {working ? 'Merging…' : 'Confirm Merge'}
          </button>
        </div>
      </div>
    </div>
  )
}
