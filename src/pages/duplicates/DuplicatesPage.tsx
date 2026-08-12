import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { usePageTitle } from '../../hooks/usePageTitle'
import { subscribeToCustomers } from '../../services/customerService'
import { fullName, formatCurrency, type CustomerItem } from '../../models/customer'
import { useAuthStore } from '../../stores/authStore'

// ─── Deduplication logic ─────────────────────────────────────────────────────

function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, '')
}

function normalizeName(c: CustomerItem): string {
  return `${c.first.trim()} ${c.lastname.trim()}`.toLowerCase().replace(/\s+/g, ' ').trim()
}

interface DupePair {
  key: string          // stable sorted ID pair
  reason: 'phone' | 'name'
  matchValue: string   // the shared phone / name
  a: CustomerItem
  b: CustomerItem
}

function findDuplicates(items: CustomerItem[]): DupePair[] {
  const pairs = new Map<string, DupePair>()

  function addPair(a: CustomerItem, b: CustomerItem, reason: 'phone' | 'name', matchValue: string) {
    const [id1, id2] = [a.id, b.id].sort()
    const key = `${id1}|${id2}`
    if (!pairs.has(key)) {
      pairs.set(key, { key, reason, matchValue, a, b })
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

  return [...pairs.values()].sort((a, b) => {
    if (a.reason !== b.reason) return a.reason === 'phone' ? -1 : 1
    return a.matchValue.localeCompare(b.matchValue)
  })
}

// ─── Field row ───────────────────────────────────────────────────────────────

function RecordCard({ customer: c, highlight }: { customer: CustomerItem; highlight: 'phone' | 'name' }) {
  const name     = fullName(c)
  const initials = [c.first[0], c.lastname[0]].filter(Boolean).join('').toUpperCase()

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
          <p className={`text-sm font-semibold truncate ${highlight === 'name' ? 'text-yellow-300' : 'text-gray-100'}`}>
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
        {c.email && <p className="text-gray-400 truncate">✉ {c.email}</p>}
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

type FilterMode = 'all' | 'phone' | 'name'

export default function DuplicatesPage() {
  usePageTitle('Duplicates')
  const companyId = useAuthStore(s => s.companyId)
  const [all, setAll]         = useState<CustomerItem[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter]   = useState<FilterMode>('all')

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
      items => { setAll(items); setLoading(false) },
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

  const phoneCount = allPairs.filter(d => !dismissed.has(d.key) && d.reason === 'phone').length
  const nameCount  = allPairs.filter(d => !dismissed.has(d.key) && d.reason === 'name').length

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

  const dismissedCount = allPairs.filter(d => dismissed.has(d.key)).length

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Duplicate Detector</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            Records sharing the same phone number or name
          </p>
        </div>
        {dismissedCount > 0 && (
          <button onClick={undismissAll} className="text-xs text-gray-500 hover:text-gray-300 transition-colors">
            Restore {dismissedCount} dismissed
          </button>
        )}
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2">
        {([
          { id: 'all',   label: `All (${phoneCount + nameCount})` },
          { id: 'phone', label: `Same Phone (${phoneCount})` },
          { id: 'name',  label: `Same Name (${nameCount})` },
        ] as { id: FilterMode; label: string }[]).map(f => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors whitespace-nowrap ${
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
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                    pair.reason === 'phone'
                      ? 'bg-orange-900/40 text-orange-400'
                      : 'bg-yellow-900/40 text-yellow-400'
                  }`}>
                    {pair.reason === 'phone' ? 'Same Phone' : 'Same Name'}
                  </span>
                  <span className="text-xs text-gray-500 truncate max-w-[180px]">
                    {pair.reason === 'phone' ? pair.matchValue : pair.matchValue}
                  </span>
                </div>
                <button
                  onClick={() => dismiss(pair.key)}
                  className="text-xs text-gray-600 hover:text-gray-300 px-2 py-1 rounded-lg hover:bg-gray-700/50 transition-colors"
                >
                  Dismiss
                </button>
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
          Click "Dismiss" on pairs that are not duplicates — they won't appear again.
        </p>
      )}
    </div>
  )
}
