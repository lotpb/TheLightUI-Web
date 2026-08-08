import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { useLocation, Link } from 'react-router-dom'
import { subscribeToCustomers, importCustomersFromJSON } from '../../services/customerService'
import { categoryMatches, fullName, formatCurrency, type CustomerItem, CATEGORY_LABELS, type CustomerCategory } from '../../models/customer'
import { exportCustomersJSON, esc } from '../../utils/exportUtils'
import { useAuthStore } from '../../stores/authStore'

type SortField = 'name' | 'date' | 'location' | 'active'
type SortDir   = 'asc' | 'desc'

const SORT_LABELS: Record<SortField, string> = {
  name:     'Name',
  date:     'Date',
  location: 'Location',
  active:   'Active',
}

const CATEGORY_ORDER: CustomerCategory[] = ['Lead', 'Customer', 'Vendor', 'Employee']

const PATH_TO_CATEGORY: Record<string, CustomerCategory> = {
  '/leads': 'Lead',
  '/customers': 'Customer',
  '/vendors': 'Vendor',
  '/employees': 'Employee',
}

function useClickOutside(
  ref: React.RefObject<HTMLElement>,
  onClose: () => void,
  active: boolean,
) {
  useEffect(() => {
    if (!active) return
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [active, ref, onClose])
}

export default function CustomerListPage() {
  const { pathname } = useLocation()
  const cat: CustomerCategory = PATH_TO_CATEGORY[pathname] ?? 'Lead'
  const companyId = useAuthStore(s => s.companyId)

  const [all, setAll] = useState<CustomerItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [showInactive, setShowInactive] = useState(
    () => localStorage.getItem('thelight.showInactive') === 'true'
  )
  const [importing, setImporting] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [sortOpen, setSortOpen] = useState(false)
  const [sortField, setSortField] = useState<SortField>('name')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const sortRef = useRef<HTMLDivElement>(null)

  const closeMenu = useCallback(() => setMenuOpen(false), [])
  const closeSortOpen = useCallback(() => setSortOpen(false), [])
  useClickOutside(menuRef, closeMenu, menuOpen)
  useClickOutside(sortRef, closeSortOpen, sortOpen)

  function handleSortSelect(field: SortField) {
    if (field === sortField) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDir('asc')
    }
    setSortOpen(false)
  }

  useEffect(() => {
    setLoading(true)
    const unsub = subscribeToCustomers(
      items => { setAll(items); setLoading(false) },
      err => { setError(err.message); setLoading(false) },
    )
    return unsub
  }, [companyId])

  const filtered = useMemo(() => {
    let items = all.filter(c => categoryMatches(c.category, cat))
    if (!showInactive) items = items.filter(c => c.isActive)
    if (search.trim()) {
      const q = search.toLowerCase()
      items = items.filter(c =>
        fullName(c).toLowerCase().includes(q) ||
        c.phone.includes(q) ||
        c.city.toLowerCase().includes(q) ||
        c.email.toLowerCase().includes(q) ||
        c.salesman.toLowerCase().includes(q),
      )
    }
    const dir = sortDir === 'asc' ? 1 : -1
    items = [...items].sort((a, b) => {
      switch (sortField) {
        case 'name':     return dir * fullName(a).localeCompare(fullName(b))
        case 'date':     return dir * (a.creationDate.getTime() - b.creationDate.getTime())
        case 'location': return dir * (a.city || '').localeCompare(b.city || '')
        case 'active':   return dir * (Number(b.isActive) - Number(a.isActive))
        default:         return 0
      }
    })
    return items
  }, [all, cat, search, showInactive, sortField, sortDir])

  function handlePrint() {
    const dateStr = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    const label = CATEGORY_LABELS[cat]

    const rows = filtered.map(c => {
      const name = fullName(c)
      const location = [c.city, c.state].filter(Boolean).join(', ')
      const amt = c.amount > 0 ? formatCurrency(c.amount) : ''
      return `
        <tr style="border-bottom:1px solid #e5e7eb;">
          <td style="padding:10px 8px;font-size:14px;font-weight:500;color:#111;vertical-align:top;">${esc(name) || '—'}${!c.isActive ? ' <span style="font-size:11px;color:#9ca3af;">(inactive)</span>' : ''}</td>
          <td style="padding:10px 8px;font-size:12px;color:#6b7280;white-space:nowrap;vertical-align:top;">${esc(c.phone || '')}</td>
          <td style="padding:10px 8px;font-size:12px;color:#6b7280;white-space:nowrap;vertical-align:top;">${esc(location)}</td>
          <td style="padding:10px 8px;font-size:12px;color:#6b7280;vertical-align:top;">${esc(c.email || '')}</td>
          <td style="padding:10px 8px;font-size:12px;color:#6b7280;white-space:nowrap;vertical-align:top;">${esc(c.salesman || '')}</td>
          <td style="padding:10px 8px;font-size:13px;font-weight:600;color:#059669;text-align:right;white-space:nowrap;vertical-align:top;">${amt}</td>
        </tr>`
    }).join('')

    const totalAmt = filtered.reduce((s, c) => s + c.amount, 0)

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>${label} List</title>
  <style>
    body { font-family: -apple-system, Helvetica, sans-serif; color: #111; margin: 32px; }
    h1 { font-size: 22px; margin: 0 0 4px; }
    p.sub { font-size: 12px; color: #888; margin: 0 0 20px; }
    table { width: 100%; border-collapse: collapse; }
    th { text-align: left; font-size: 11px; color: #888; text-transform: uppercase; letter-spacing: .05em; border-bottom: 2px solid #e5e7eb; padding: 6px 8px; }
    tfoot td { font-size: 13px; font-weight: 600; padding: 10px 8px; border-top: 2px solid #e5e7eb; }
    @media print { body { margin: 16px; } }
  </style>
  <script>window.onload = function() { window.print(); }</script>
</head>
<body>
  <h1>${label} List</h1>
  <p class="sub">Printed ${dateStr} · ${filtered.length} record${filtered.length !== 1 ? 's' : ''}${!showInactive ? ' · active only' : ''}</p>
  <table>
    <thead>
      <tr>
        <th>Name</th>
        <th>Phone</th>
        <th>Location</th>
        <th>Email</th>
        <th>Salesman</th>
        <th style="text-align:right;">Amount</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
    ${totalAmt > 0 ? `<tfoot><tr><td colspan="5">Total</td><td style="text-align:right;">${formatCurrency(totalAmt)}</td></tr></tfoot>` : ''}
  </table>
</body>
</html>`

    const w = window.open('', '_blank', 'width=1000,height=700')
    if (!w) return
    w.document.write(html)
    w.document.close()
  }

  // Export all records for current category (not just filtered)
  function handleExport() {
    const toExport = all.filter(c => categoryMatches(c.category, cat))
    exportCustomersJSON(toExport)
  }

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setImporting(true)
    try {
      const jsonText = await file.text()
      const { count } = await importCustomersFromJSON(jsonText, '', cat)
      alert(`Imported ${count} record${count !== 1 ? 's' : ''}.`)
    } catch (err) {
      alert(`Import failed: ${err instanceof Error ? err.message : 'Unknown error'}`)
    } finally {
      setImporting(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-4">
        <h1 className="text-2xl font-bold text-white">{CATEGORY_LABELS[cat]}</h1>
        <div className="flex gap-2 flex-wrap justify-end">
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            className="hidden"
            onChange={handleImport}
          />
          {/* Sort dropdown */}
          <div ref={sortRef} className="relative">
            <button
              onClick={() => setSortOpen(v => !v)}
              className="btn-secondary text-sm px-3 py-1.5 flex items-center gap-1.5"
            >
              Sort By
              <svg className={`w-3.5 h-3.5 transition-transform ${sortOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {sortOpen && (
              <div className="absolute right-0 mt-1 w-40 bg-gray-800 border border-gray-700 rounded-xl shadow-xl z-50 overflow-hidden">
                {(Object.keys(SORT_LABELS) as SortField[]).map(field => (
                  <button
                    key={field}
                    onClick={() => handleSortSelect(field)}
                    className="w-full text-left px-4 py-2.5 text-sm text-gray-200 hover:bg-gray-700 flex items-center justify-between"
                  >
                    <span>{SORT_LABELS[field]}</span>
                    {sortField === field && (
                      <span className="text-indigo-400 text-xs font-bold">
                        {sortDir === 'asc' ? '↑' : '↓'}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Actions dropdown */}
          <div ref={menuRef} className="relative">
            <button
              onClick={() => setMenuOpen(v => !v)}
              className="btn-secondary text-sm px-3 py-1.5 flex items-center gap-1.5"
            >
              Actions
              <svg className={`w-3.5 h-3.5 transition-transform ${menuOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {menuOpen && (
              <div className="absolute right-0 mt-1 w-44 bg-gray-800 border border-gray-700 rounded-xl shadow-xl z-50 overflow-hidden">
                <button
                  onClick={() => { closeMenu(); fileInputRef.current?.click() }}
                  disabled={importing}
                  className="w-full text-left px-4 py-2.5 text-sm text-gray-200 hover:bg-gray-700 disabled:opacity-40 flex items-center gap-2.5"
                >
                  <span className="text-base">↑</span>
                  {importing ? 'Importing…' : 'Import'}
                </button>
                <button
                  onClick={() => { closeMenu(); handleExport() }}
                  disabled={loading}
                  className="w-full text-left px-4 py-2.5 text-sm text-gray-200 hover:bg-gray-700 disabled:opacity-40 flex items-center gap-2.5"
                >
                  <span className="text-base">↓</span>
                  Export
                </button>
                <div className="border-t border-gray-700/60" />
                <button
                  onClick={() => { closeMenu(); handlePrint() }}
                  disabled={loading || filtered.length === 0}
                  className="w-full text-left px-4 py-2.5 text-sm text-gray-200 hover:bg-gray-700 disabled:opacity-40 flex items-center gap-2.5"
                >
                  <span className="text-base">🖨</span>
                  Print
                </button>
              </div>
            )}
          </div>
          <Link to={`/records/new?category=${cat}`} className="btn-primary text-sm px-3 py-1.5">
            + New
          </Link>
        </div>
      </div>

      {/* Category tabs */}
      <div className="flex gap-1 mb-4 bg-gray-800/50 p-1 rounded-xl">
        {CATEGORY_ORDER.map(c => (
          <Link
            key={c}
            to={`/${c.toLowerCase()}s`}
            className={`flex-1 text-center text-sm font-medium py-1.5 rounded-lg transition-colors ${
              cat === c
                ? 'bg-indigo-600 text-white'
                : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            {CATEGORY_LABELS[c]}
          </Link>
        ))}
      </div>

      {/* Search + filter */}
      <div className="flex gap-2 mb-4">
        <input
          type="search"
          className="input-field flex-1"
          placeholder={`Search ${CATEGORY_LABELS[cat].toLowerCase()}…`}
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <button
          onClick={() => {
            const next = !showInactive
            setShowInactive(next)
            localStorage.setItem('thelight.showInactive', String(next))
          }}
          className={`px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${
            showInactive
              ? 'bg-indigo-600/20 border-indigo-500/50 text-indigo-300'
              : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-gray-200'
          }`}
        >
          {showInactive ? 'All' : 'Active'}
        </button>
      </div>

      {error && (
        <div className="bg-red-900/30 border border-red-700/50 rounded-xl px-4 py-3 text-red-300 text-sm mb-4">
          {error}
        </div>
      )}

      {!loading && (
        <p className="text-xs text-gray-500 mb-3">
          {filtered.length} {filtered.length === 1 ? 'record' : 'records'}
          {!showInactive && ' · active only'}
        </p>
      )}

      <div className="card divide-y divide-gray-700/50">
        {loading ? (
          Array.from({ length: 6 }).map((_, i) => <SkeletonRow key={i} />)
        ) : filtered.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <p className="text-gray-400">
              {search ? 'No results for that search' : `No ${CATEGORY_LABELS[cat].toLowerCase()} yet`}
            </p>
            {!search && (
              <Link
                to={`/records/new?category=${cat}`}
                className="inline-block mt-3 text-sm text-indigo-400 hover:text-indigo-300"
              >
                Add the first one →
              </Link>
            )}
          </div>
        ) : (
          filtered.map(c => <CustomerRow key={c.id} customer={c} />)
        )}
      </div>
    </div>
  )
}

function CustomerRow({ customer: c }: { customer: CustomerItem }) {
  const name = fullName(c)
  const initials = [c.first[0], c.lastname[0]].filter(Boolean).join('').toUpperCase()

  return (
    <Link
      to={`/records/${c.id}`}
      className="flex items-center gap-4 px-4 py-3.5 hover:bg-gray-700/30 transition-colors"
    >
      <div className="w-10 h-10 rounded-full bg-indigo-700/30 flex items-center justify-center shrink-0 overflow-hidden">
        {c.photo ? (
          <img src={c.photo} alt={name} className="w-full h-full object-cover" />
        ) : (
          <span className="text-sm font-semibold text-indigo-300">{initials || '?'}</span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-medium text-gray-100 truncate">{name || '—'}</span>
          {!c.isActive && <span className="text-xs text-gray-500 shrink-0">inactive</span>}
        </div>
        <p className="text-sm text-gray-400 truncate">
          {[c.city, c.state].filter(Boolean).join(', ')}
          {c.category.toLowerCase() !== 'vendor' && c.salesman ? ` · ${c.salesman}` : ''}
        </p>
      </div>
      <div className="shrink-0 text-right flex flex-col items-end gap-1">
        {c.amount > 0 && <p className="text-sm font-semibold text-green-400">{formatCurrency(c.amount)}</p>}
        {c.phone && <p className="text-xs text-gray-500">{c.phone}</p>}
      </div>
    </Link>
  )
}

function SkeletonRow() {
  return (
    <div className="flex items-center gap-4 px-4 py-3.5 animate-pulse">
      <div className="w-10 h-10 rounded-full bg-gray-700 shrink-0" />
      <div className="flex-1 space-y-2">
        <div className="h-3.5 bg-gray-700 rounded w-40" />
        <div className="h-3 bg-gray-700/60 rounded w-28" />
      </div>
    </div>
  )
}
