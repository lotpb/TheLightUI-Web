import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { subscribeToCustomers } from '../services/customerService'
import { fullName, type CustomerItem, type CustomerCategory, CATEGORY_LABELS } from '../models/customer'
import { useAuthStore } from '../stores/authStore'
import { useDebounce } from '../hooks/useDebounce'
import { avatarColor, AVATAR_ORIGINAL } from '../utils/avatarColor'
import { usePrefStore } from '../stores/prefStore'
import { useFocusTrap } from '../hooks/useFocusTrap'

const CATEGORY_ORDER: CustomerCategory[] = ['Lead', 'Customer', 'Vendor', 'Employee']
const MAX_PER_GROUP = 5

interface Props {
  onClose: () => void
}

export default function GlobalSearch({ onClose }: Props) {
  const navigate      = useNavigate()
  const companyId     = useAuthStore(s => s.companyId)
  const coloredAvatars = usePrefStore(s => s.coloredAvatars)
  const inputRef      = useRef<HTMLInputElement>(null)
  const panelRef      = useRef<HTMLDivElement>(null)
  useFocusTrap(panelRef)

  const [all, setAll]     = useState<CustomerItem[]>([])
  const [query, setQuery] = useState('')
  const debouncedQuery    = useDebounce(query, 150)

  // Subscribe to all customers while modal is open
  useEffect(() => {
    const unsub = subscribeToCustomers(setAll, () => {})
    return unsub
  }, [companyId])

  // Focus input on mount
  useEffect(() => { inputRef.current?.focus() }, [])

  // Escape closes
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const results = useMemo(() => {
    const q = debouncedQuery.trim().toLowerCase()
    if (!q) return []
    return all.filter(c =>
      fullName(c).toLowerCase().includes(q) ||
      c.phone.includes(q) ||
      c.email.toLowerCase().includes(q) ||
      c.city.toLowerCase().includes(q) ||
      c.salesman.toLowerCase().includes(q) ||
      c.adNo.toLowerCase().includes(q) ||
      c.contractor.toLowerCase().includes(q),
    )
  }, [all, debouncedQuery])

  // Group by category, preserving defined order
  const grouped = useMemo(() => {
    const map = new Map<CustomerCategory, CustomerItem[]>()
    for (const cat of CATEGORY_ORDER) map.set(cat, [])
    for (const c of results) {
      const cat = (c.category as CustomerCategory) ?? 'Lead'
      if (map.has(cat)) map.get(cat)!.push(c)
    }
    return CATEGORY_ORDER.map(cat => ({ cat, items: map.get(cat)! })).filter(g => g.items.length > 0)
  }, [results])

  function go(id: string) {
    navigate(`/records/${id}`)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-12 sm:pt-20 px-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />

      {/* Panel */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Search records"
        className="relative bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-xl shadow-2xl overflow-hidden flex flex-col max-h-[80vh]"
      >

        {/* Search input row */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-700 shrink-0">
          <svg className="w-5 h-5 text-gray-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
          </svg>
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search all records…"
            className="flex-1 bg-transparent text-white placeholder-gray-500 outline-none text-sm"
          />
          <kbd className="hidden sm:inline text-xs text-gray-500 bg-gray-800 border border-gray-700 px-1.5 py-0.5 rounded font-mono">
            Esc
          </kbd>
        </div>

        {/* Results */}
        <div className="overflow-y-auto flex-1">
          {!debouncedQuery.trim() ? (
            <div className="px-4 py-8 text-center">
              <p className="text-sm text-gray-500">Type to search leads, customers, vendors, and employees</p>
            </div>
          ) : results.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <p className="text-sm text-gray-400">No results for <span className="text-white">"{debouncedQuery}"</span></p>
            </div>
          ) : (
            <>
              <p className="px-4 pt-3 pb-1 text-xs text-gray-500">
                {results.length} result{results.length !== 1 ? 's' : ''}
              </p>
              {grouped.map(({ cat, items }) => {
                const shown    = items.slice(0, MAX_PER_GROUP)
                const overflow = items.length - shown.length
                return (
                  <div key={cat}>
                    {/* Category header */}
                    <div className="px-4 py-1.5 bg-gray-800/60 border-y border-gray-800">
                      <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">
                        {CATEGORY_LABELS[cat]}
                      </span>
                    </div>

                    {/* Result rows */}
                    {shown.map(c => {
                      const name     = fullName(c)
                      const initials = [c.first[0], c.lastname[0]].filter(Boolean).join('').toUpperCase()
                      const color    = coloredAvatars ? avatarColor(name) : AVATAR_ORIGINAL
                      const sub      = [c.city, c.state].filter(Boolean).join(', ') || c.phone || ''
                      return (
                        <button
                          key={c.id}
                          onClick={() => go(c.id)}
                          className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-800 transition-colors text-left"
                        >
                          <div
                            className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 overflow-hidden"
                            style={{ background: color.bg }}
                          >
                            {c.photo ? (
                              <img src={c.photo} alt={name} className="w-full h-full object-cover" />
                            ) : (
                              <span className="text-xs font-semibold" style={{ color: color.text }}>
                                {initials || '?'}
                              </span>
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-100 truncate">{name || '—'}</p>
                            {sub && <p className="text-xs text-gray-400 truncate">{sub}</p>}
                          </div>
                          {!c.isActive && (
                            <span className="text-xs text-gray-500 shrink-0">inactive</span>
                          )}
                        </button>
                      )
                    })}

                    {/* Overflow link */}
                    {overflow > 0 && (
                      <button
                        onClick={() => { navigate(`/${cat.toLowerCase()}s`); onClose() }}
                        className="w-full text-left px-4 py-2 text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
                      >
                        +{overflow} more in {CATEGORY_LABELS[cat]} →
                      </button>
                    )}
                  </div>
                )
              })}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
