import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { useLocation, useSearchParams, Link } from 'react-router-dom'
import { getFunctions, httpsCallable } from 'firebase/functions'
import { subscribeToCustomers, importCustomersFromJSON, bulkDeactivate, bulkAssignSalesman } from '../../services/customerService'
import { categoryMatches, fullName, formatCurrency, type CustomerItem, CATEGORY_LABELS, type CustomerCategory } from '../../models/customer'
import { exportCustomersJSON, esc } from '../../utils/exportUtils'
import { useAuthStore } from '../../stores/authStore'
import { useToast } from '../../components/Toast'
import { useDebounce } from '../../hooks/useDebounce'
import { usePageTitle } from '../../hooks/usePageTitle'
import { useSearchShortcut } from '../../hooks/useSearchShortcut'
import { avatarColor, avatarOriginal } from '../../utils/avatarColor'
import { usePickerStore } from '../../stores/pickerStore'
import { usePrefStore } from '../../stores/prefStore'
import { usePermissions } from '../../hooks/usePermissions'
import { tagColor } from '../../utils/tagColor'
import { scoreLead } from '../../utils/leadScore'
import { calculateHealthScoreLight } from '../../utils/customerHealth'
import CSVImportModal from '../../components/CSVImportModal'
import { subscribeToSavedViews, createSavedView, deleteSavedView } from '../../services/savedViewService'
import type { SavedView } from '../../models/savedView'

const PAGE_SIZE = 50

type SortField = 'name' | 'date' | 'location' | 'active' | 'score'
type SortDir   = 'asc' | 'desc'

const SORT_LABELS: Record<SortField, string> = {
  name:     'Name',
  date:     'Date',
  location: 'Location',
  active:   'Active',
  score:    'Score',
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
  usePageTitle(CATEGORY_LABELS[cat])
  const companyId = useAuthStore(s => s.companyId)
  const labels = usePickerStore(s => s.labels)
  const toast = useToast()
  const perms = usePermissions()

  const [all, setAll] = useState<CustomerItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [hitRecordCap, setHitRecordCap] = useState(false)
  const [searchParams] = useSearchParams()
  const [search, setSearch] = useState(() => searchParams.get('q') ?? '')
  const debouncedSearch = useDebounce(search)
  const [showInactive, setShowInactive] = useState(
    () => localStorage.getItem('thelight.showInactive') === 'true'
  )
  const [importing, setImporting] = useState(false)
  const [csvImportOpen, setCsvImportOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [sortOpen, setSortOpen] = useState(false)
  const [sortField, setSortField] = useState<SortField>('name')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [page, setPage] = useState(1)
  const [tagFilter, setTagFilter] = useState<string | null>(null)
  const [tagOpen, setTagOpen]     = useState(false)
  const tagRef = useRef<HTMLDivElement>(null)

  // Advanced filters
  const [filterOpen, setFilterOpen]         = useState(false)
  const [filterSalesman, setFilterSalesman] = useState('')
  const [filterState, setFilterState]       = useState('')
  const [filterLeadSource, setFilterLeadSource] = useState('')
  const [filterProduct, setFilterProduct]   = useState('')
  const [filterCallback, setFilterCallback] = useState('')
  const [filterDateFrom, setFilterDateFrom] = useState('')
  const [filterDateTo, setFilterDateTo]     = useState('')
  const [filterAmtMin, setFilterAmtMin]     = useState('')
  const [filterAmtMax, setFilterAmtMax]     = useState('')

  // Saved views
  const [savedViews, setSavedViews] = useState<SavedView[]>([])
  const [viewsOpen, setViewsOpen]   = useState(false)
  const [savingView, setSavingView] = useState(false)
  const [newViewName, setNewViewName] = useState('')
  const viewsRef = useRef<HTMLDivElement>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  useSearchShortcut(searchInputRef, () => setSearch(''))
  const listTopRef   = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const sortRef = useRef<HTMLDivElement>(null)
  const assignRef = useRef<HTMLDivElement>(null)

  // ── Bulk selection ────────────────────────────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [assignOpen, setAssignOpen]   = useState(false)
  const [bulkWorking, setBulkWorking] = useState(false)
  const [emailModalOpen, setEmailModalOpen] = useState(false)
  const closeAssign = useCallback(() => setAssignOpen(false), [])
  useClickOutside(assignRef, closeAssign, assignOpen)

  function clearAdvancedFilters() {
    setFilterSalesman('')
    setFilterState('')
    setFilterLeadSource('')
    setFilterProduct('')
    setFilterCallback('')
    setFilterDateFrom('')
    setFilterDateTo('')
    setFilterAmtMin('')
    setFilterAmtMax('')
  }

  useEffect(() => subscribeToSavedViews(cat, setSavedViews, () => {}), [cat])

  function applySavedView(view: SavedView) {
    const f = view.filters
    setSearch(f.search)
    setShowInactive(f.showInactive)
    localStorage.setItem('thelight.showInactive', String(f.showInactive))
    setTagFilter(f.tagFilter)
    setSortField(f.sortField as SortField)
    setSortDir(f.sortDir as SortDir)
    setFilterSalesman(f.filterSalesman)
    setFilterState(f.filterState)
    setFilterLeadSource(f.filterLeadSource)
    setFilterProduct(f.filterProduct)
    setFilterCallback(f.filterCallback)
    setFilterDateFrom(f.filterDateFrom)
    setFilterDateTo(f.filterDateTo)
    setFilterAmtMin(f.filterAmtMin)
    setFilterAmtMax(f.filterAmtMax)
    setViewsOpen(false)
  }

  async function handleSaveView() {
    const name = newViewName.trim()
    if (!name) return
    setSavingView(true)
    try {
      await createSavedView(cat, name, {
        search, showInactive, tagFilter,
        sortField, sortDir,
        filterSalesman, filterState, filterLeadSource, filterProduct,
        filterCallback, filterDateFrom, filterDateTo, filterAmtMin, filterAmtMax,
      })
      setNewViewName('')
      toast(`Saved view "${name}"`, 'success')
    } catch {
      toast('Failed to save view', 'error')
    } finally {
      setSavingView(false)
    }
  }

  async function handleDeleteView(view: SavedView) {
    await deleteSavedView(view.id)
  }

  // Clear selection when category or filter changes
  useEffect(() => { setSelectedIds(new Set()) }, [cat, showInactive, debouncedSearch])

  // Reset advanced filters when switching category
  useEffect(() => { clearAdvancedFilters() }, [cat]) // eslint-disable-line react-hooks/exhaustive-deps

  function toggleOne(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function togglePage() {
    if (allPageSelected) {
      setSelectedIds(prev => {
        const next = new Set(prev)
        paginated.forEach(c => next.delete(c.id))
        return next
      })
    } else {
      setSelectedIds(prev => {
        const next = new Set(prev)
        paginated.forEach(c => next.add(c.id))
        return next
      })
    }
  }

  function selectAll()  { setSelectedIds(new Set(allFilteredIds)) }
  function clearSelection() { setSelectedIds(new Set()) }

  async function handleBulkDeactivate() {
    const ids = [...selectedIds]
    setBulkWorking(true)
    try {
      await bulkDeactivate(ids)
      toast(`Deactivated ${ids.length} record${ids.length !== 1 ? 's' : ''}.`, 'success')
      clearSelection()
    } catch {
      toast('Bulk deactivate failed.', 'error')
    } finally {
      setBulkWorking(false)
    }
  }

  async function handleBulkAssign(salesman: string) {
    const ids = [...selectedIds]
    setAssignOpen(false)
    setBulkWorking(true)
    try {
      await bulkAssignSalesman(ids, salesman)
      toast(`Assigned ${ids.length} record${ids.length !== 1 ? 's' : ''} to ${salesman}.`, 'success')
      clearSelection()
    } catch {
      toast('Bulk assign failed.', 'error')
    } finally {
      setBulkWorking(false)
    }
  }

  async function handleBulkExport() {
    const toExport = filtered.filter(c => selectedIds.has(c.id))
    await exportCustomersJSON(toExport)
  }

  async function handleBulkEmail(subject: string, body: string) {
    const ids = [...selectedIds]
    setBulkWorking(true)
    try {
      const fns = getFunctions()
      const result = await httpsCallable<
        { customerIds: string[]; subject: string; body: string },
        { sent: number; skipped: number }
      >(fns, 'bulkSendEmail')({ customerIds: ids, subject, body })
      const { sent, skipped } = result.data
      toast(
        `Sent ${sent} email${sent !== 1 ? 's' : ''}${skipped > 0 ? ` · ${skipped} skipped (no email)` : ''}.`,
        sent > 0 ? 'success' : 'error',
      )
      clearSelection()
    } catch (err) {
      toast(`Email send failed: ${err instanceof Error ? err.message : 'Unknown error'}`, 'error')
    } finally {
      setBulkWorking(false)
    }
  }

  const closeMenu     = useCallback(() => setMenuOpen(false), [])
  const closeSortOpen = useCallback(() => setSortOpen(false), [])
  const closeTag      = useCallback(() => setTagOpen(false), [])
  const closeViews    = useCallback(() => setViewsOpen(false), [])
  useClickOutside(menuRef, closeMenu, menuOpen)
  useClickOutside(sortRef, closeSortOpen, sortOpen)
  useClickOutside(tagRef, closeTag, tagOpen)
  useClickOutside(viewsRef, closeViews, viewsOpen)

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
      (items, hitCap) => { setAll(items); setHitRecordCap(hitCap); setLoading(false) },
      err => { setError(err.message); setLoading(false) },
    )
    return unsub
  }, [companyId])

  const categoryCounts = useMemo(() => {
    const base = showInactive ? all : all.filter(c => c.isActive)
    return Object.fromEntries(
      CATEGORY_ORDER.map(c => [c, base.filter(item => categoryMatches(item.category, c)).length])
    ) as Record<CustomerCategory, number>
  }, [all, showInactive])

  // All unique tags across the current category (for the filter dropdown)
  const allCatTags = useMemo<string[]>(() => {
    const set = new Set<string>()
    all.filter(c => categoryMatches(c.category, cat)).forEach(c => (c.tags ?? []).forEach(t => set.add(t)))
    return [...set].sort()
  }, [all, cat])

  // Unique option lists for advanced filters
  const uniqueSalesmen = useMemo<string[]>(() => {
    const set = new Set<string>()
    all.filter(c => categoryMatches(c.category, cat) && c.salesman.trim()).forEach(c => set.add(c.salesman.trim()))
    return [...set].sort()
  }, [all, cat])

  const uniqueStates = useMemo<string[]>(() => {
    const set = new Set<string>()
    all.filter(c => categoryMatches(c.category, cat) && c.state.trim()).forEach(c => set.add(c.state.trim()))
    return [...set].sort()
  }, [all, cat])

  const uniqueLeadSources = useMemo<string[]>(() => {
    const set = new Set<string>()
    all.filter(c => categoryMatches(c.category, cat) && c.leadSource.trim()).forEach(c => set.add(c.leadSource.trim()))
    return [...set].sort()
  }, [all, cat])

  const uniqueProducts = useMemo<string[]>(() => {
    const set = new Set<string>()
    all.filter(c => categoryMatches(c.category, cat) && c.product.trim()).forEach(c => set.add(c.product.trim()))
    return [...set].sort()
  }, [all, cat])

  const activeFilterCount = [
    filterSalesman, filterState, filterLeadSource, filterProduct,
    filterCallback, filterDateFrom, filterDateTo, filterAmtMin, filterAmtMax,
  ].filter(Boolean).length

  const filtered = useMemo(() => {
    let items = all.filter(c => categoryMatches(c.category, cat))
    if (!showInactive) items = items.filter(c => c.isActive)
    if (tagFilter) items = items.filter(c => (c.tags ?? []).includes(tagFilter))
    if (debouncedSearch.trim()) {
      const q = debouncedSearch.toLowerCase()
      items = items.filter(c =>
        fullName(c).toLowerCase().includes(q) ||
        c.phone.includes(q) ||
        c.city.toLowerCase().includes(q) ||
        c.email.toLowerCase().includes(q) ||
        c.salesman.toLowerCase().includes(q),
      )
    }
    // Advanced filters
    if (filterSalesman) items = items.filter(c => c.salesman === filterSalesman)
    if (filterState)    items = items.filter(c => c.state === filterState)
    if (filterLeadSource) items = items.filter(c => c.leadSource === filterLeadSource)
    if (filterProduct)  items = items.filter(c => c.product === filterProduct)
    if (filterCallback === 'yes') items = items.filter(c => c.callback.toLowerCase() === 'yes')
    else if (filterCallback === 'no') items = items.filter(c => c.callback.toLowerCase() !== 'yes')
    if (filterDateFrom) {
      const from = new Date(filterDateFrom)
      items = items.filter(c => c.creationDate >= from)
    }
    if (filterDateTo) {
      const to = new Date(filterDateTo)
      to.setHours(23, 59, 59, 999)
      items = items.filter(c => c.creationDate <= to)
    }
    if (filterAmtMin) items = items.filter(c => c.amount >= Number(filterAmtMin))
    if (filterAmtMax) items = items.filter(c => c.amount <= Number(filterAmtMax))

    const dir = sortDir === 'asc' ? 1 : -1
    items = [...items].sort((a, b) => {
      switch (sortField) {
        case 'name':     return dir * fullName(a).localeCompare(fullName(b))
        case 'date':     return dir * (a.creationDate.getTime() - b.creationDate.getTime())
        case 'location': return dir * (a.city || '').localeCompare(b.city || '')
        case 'active':   return dir * (Number(b.isActive) - Number(a.isActive))
        case 'score':    return dir * (scoreLead(a).score - scoreLead(b).score)
        default:         return 0
      }
    })
    return items
  }, [all, cat, debouncedSearch, showInactive, tagFilter, sortField, sortDir,
      filterSalesman, filterState, filterLeadSource, filterProduct, filterCallback,
      filterDateFrom, filterDateTo, filterAmtMin, filterAmtMax])

  // Reset to page 1 whenever anything changes the filtered set
  useEffect(() => { setPage(1) }, [debouncedSearch, cat, showInactive, tagFilter, sortField, sortDir,
    filterSalesman, filterState, filterLeadSource, filterProduct, filterCallback,
    filterDateFrom, filterDateTo, filterAmtMin, filterAmtMax])

  const pageCount  = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const paginated  = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const rangeStart = filtered.length === 0 ? 0 : (page - 1) * PAGE_SIZE + 1
  const rangeEnd   = Math.min(page * PAGE_SIZE, filtered.length)

  // Bulk selection derived values (must come after filtered/paginated)
  const allFilteredIds  = useMemo(() => new Set(filtered.map(c => c.id)), [filtered])
  const allPageSelected = paginated.length > 0 && paginated.every(c => selectedIds.has(c.id))
  const someSelected    = selectedIds.size > 0

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
        <th>${labels.salesman}</th>
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
  async function handleExport() {
    const toExport = all.filter(c => categoryMatches(c.category, cat))
    await exportCustomersJSON(toExport)
  }

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setImporting(true)
    try {
      const jsonText = await file.text()
      const { count } = await importCustomersFromJSON(jsonText, '', cat)
      toast(`Imported ${count} record${count !== 1 ? 's' : ''}.`, 'success')
    } catch (err) {
      toast(`Import failed: ${err instanceof Error ? err.message : 'Unknown error'}`, 'error')
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
                {perms.canImport && (
                  <>
                    <button
                      onClick={() => { closeMenu(); fileInputRef.current?.click() }}
                      disabled={importing}
                      className="w-full text-left px-4 py-2.5 text-sm text-gray-200 hover:bg-gray-700 disabled:opacity-40 flex items-center gap-2.5"
                    >
                      <span className="text-base">↑</span>
                      {importing ? 'Importing…' : 'Import JSON'}
                    </button>
                    <button
                      onClick={() => { closeMenu(); setCsvImportOpen(true) }}
                      className="w-full text-left px-4 py-2.5 text-sm text-gray-200 hover:bg-gray-700 flex items-center gap-2.5"
                    >
                      <span className="text-base">📥</span>
                      Import CSV
                    </button>
                  </>
                )}
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
          {perms.canEdit && (
            <Link to={`/records/new?category=${cat}`} className="btn-primary text-sm px-3 py-1.5">
              + New
            </Link>
          )}
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
            <span className="flex items-center justify-center gap-1.5">
              {CATEGORY_LABELS[c]}
              {!loading && categoryCounts[c] > 0 && (
                <span className={`text-xs font-bold tabular-nums ${cat === c ? 'opacity-70' : 'opacity-50'}`}>
                  {categoryCounts[c]}
                </span>
              )}
            </span>
          </Link>
        ))}
      </div>

      {/* Search + filter */}
      <div className="flex gap-2 mb-2">
        <input
          ref={searchInputRef}
          type="search"
          className="input-field flex-1"
          placeholder={`Search ${CATEGORY_LABELS[cat].toLowerCase()}…`}
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        {/* Saved views */}
        <div ref={viewsRef} className="relative">
          <button
            onClick={() => setViewsOpen(v => !v)}
            className={`px-3 py-2 rounded-lg text-sm font-medium border transition-colors flex items-center gap-1.5 ${
              viewsOpen ? 'bg-indigo-600/20 border-indigo-500/50 text-indigo-300' : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-gray-200'
            }`}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12c1.5-4.5 5.25-7.5 9.75-7.5s8.25 3 9.75 7.5c-1.5 4.5-5.25 7.5-9.75 7.5S3.75 16.5 2.25 12Z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
            </svg>
            Views
            {savedViews.length > 0 && (
              <span className="bg-gray-700 text-gray-300 text-xs font-bold px-1.5 py-0.5 rounded-full leading-none">
                {savedViews.length}
              </span>
            )}
          </button>
          {viewsOpen && (
            <div className="absolute right-0 mt-1 w-64 bg-gray-800 border border-gray-700 rounded-xl shadow-xl z-50 overflow-hidden">
              {savedViews.length === 0 ? (
                <p className="px-4 py-3 text-sm text-gray-500">No saved views for {CATEGORY_LABELS[cat]} yet.</p>
              ) : (
                <div className="max-h-64 overflow-y-auto divide-y divide-gray-700/50">
                  {savedViews.map(view => (
                    <div key={view.id} className="flex items-center group">
                      <button
                        onClick={() => applySavedView(view)}
                        className="flex-1 text-left px-4 py-2.5 text-sm text-gray-200 hover:bg-gray-700 transition-colors truncate"
                      >
                        {view.name}
                      </button>
                      <button
                        onClick={() => handleDeleteView(view)}
                        title="Delete view"
                        className="px-2.5 text-gray-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="p-2 border-t border-gray-700/50 flex gap-1.5">
                <input
                  value={newViewName}
                  onChange={e => setNewViewName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleSaveView() }}
                  placeholder="Save current filters as…"
                  className="input-field flex-1 text-xs py-1.5"
                />
                <button
                  onClick={handleSaveView}
                  disabled={!newViewName.trim() || savingView}
                  className="btn-primary text-xs px-2.5 py-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Save
                </button>
              </div>
            </div>
          )}
        </div>
        {/* Advanced filters toggle */}
        <button
          onClick={() => setFilterOpen(v => !v)}
          className={`px-3 py-2 rounded-lg text-sm font-medium border transition-colors flex items-center gap-1.5 ${
            filterOpen || activeFilterCount > 0
              ? 'bg-indigo-600/20 border-indigo-500/50 text-indigo-300'
              : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-gray-200'
          }`}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 4a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v2a1 1 0 0 1-.293.707L13 13.414V19a1 1 0 0 1-.553.894l-4 2A1 1 0 0 1 7 21v-7.586L3.293 6.707A1 1 0 0 1 3 6V4Z" />
          </svg>
          Filters
          {activeFilterCount > 0 && (
            <span className="bg-indigo-500 text-white text-xs font-bold px-1.5 py-0.5 rounded-full leading-none">
              {activeFilterCount}
            </span>
          )}
        </button>
        <button
          onClick={() => {
            const next = !showInactive
            setShowInactive(next)
            localStorage.setItem('thelight.showInactive', String(next))
          }}
          className={`px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${
            !showInactive
              ? 'bg-indigo-600/20 border-indigo-500/50 text-indigo-300'
              : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-gray-200'
          }`}
        >
          {showInactive ? 'All' : 'Active'}
        </button>
        {/* Tag filter */}
        {allCatTags.length > 0 && (
          <div ref={tagRef} className="relative">
            <button
              onClick={() => setTagOpen(v => !v)}
              className={`px-3 py-2 rounded-lg text-sm font-medium border transition-colors flex items-center gap-1.5 ${
                tagFilter
                  ? 'bg-indigo-600/20 border-indigo-500/50 text-indigo-300'
                  : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-gray-200'
              }`}
            >
              🏷 {tagFilter ?? 'Tag'}
              {tagFilter && (
                <span
                  onClick={e => { e.stopPropagation(); setTagFilter(null) }}
                  className="ml-0.5 opacity-70 hover:opacity-100"
                >×</span>
              )}
            </button>
            {tagOpen && (
              <div className="absolute right-0 mt-1 w-44 bg-gray-800 border border-gray-700 rounded-xl shadow-xl z-50 overflow-hidden">
                {allCatTags.map(tag => (
                  <button
                    key={tag}
                    onClick={() => { setTagFilter(tagFilter === tag ? null : tag); setTagOpen(false) }}
                    className={`w-full text-left px-4 py-2.5 text-sm flex items-center gap-2 hover:bg-gray-700 transition-colors ${tagFilter === tag ? 'text-indigo-300' : 'text-gray-200'}`}
                  >
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${tagColor(tag)}`}>{tag}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Advanced filter panel */}
      {filterOpen && (
        <div className="mb-4 p-4 bg-gray-800/70 rounded-xl border border-gray-700/50 space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {uniqueSalesmen.length > 0 && (
              <div>
                <label className="block text-xs text-gray-500 mb-1">{labels.salesman ?? 'Salesman'}</label>
                <select
                  value={filterSalesman}
                  onChange={e => setFilterSalesman(e.target.value)}
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg px-2 py-1.5 text-sm text-gray-200 outline-none focus:border-indigo-500"
                >
                  <option value="">All</option>
                  {uniqueSalesmen.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            )}
            {uniqueStates.length > 0 && (
              <div>
                <label className="block text-xs text-gray-500 mb-1">State</label>
                <select
                  value={filterState}
                  onChange={e => setFilterState(e.target.value)}
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg px-2 py-1.5 text-sm text-gray-200 outline-none focus:border-indigo-500"
                >
                  <option value="">All</option>
                  {uniqueStates.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            )}
            {uniqueLeadSources.length > 0 && (
              <div>
                <label className="block text-xs text-gray-500 mb-1">Lead Source</label>
                <select
                  value={filterLeadSource}
                  onChange={e => setFilterLeadSource(e.target.value)}
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg px-2 py-1.5 text-sm text-gray-200 outline-none focus:border-indigo-500"
                >
                  <option value="">All</option>
                  {uniqueLeadSources.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            )}
            {uniqueProducts.length > 0 && (
              <div>
                <label className="block text-xs text-gray-500 mb-1">Product</label>
                <select
                  value={filterProduct}
                  onChange={e => setFilterProduct(e.target.value)}
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg px-2 py-1.5 text-sm text-gray-200 outline-none focus:border-indigo-500"
                >
                  <option value="">All</option>
                  {uniqueProducts.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            )}
            <div>
              <label className="block text-xs text-gray-500 mb-1">Callback</label>
              <select
                value={filterCallback}
                onChange={e => setFilterCallback(e.target.value)}
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-2 py-1.5 text-sm text-gray-200 outline-none focus:border-indigo-500"
              >
                <option value="">All</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Date From</label>
              <input
                type="date"
                value={filterDateFrom}
                onChange={e => setFilterDateFrom(e.target.value)}
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-2 py-1.5 text-sm text-gray-200 outline-none focus:border-indigo-500"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Date To</label>
              <input
                type="date"
                value={filterDateTo}
                onChange={e => setFilterDateTo(e.target.value)}
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-2 py-1.5 text-sm text-gray-200 outline-none focus:border-indigo-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Min Amount ($)</label>
              <input
                type="number"
                min={0}
                value={filterAmtMin}
                onChange={e => setFilterAmtMin(e.target.value)}
                placeholder="0"
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-2 py-1.5 text-sm text-gray-200 outline-none focus:border-indigo-500 placeholder-gray-600"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Max Amount ($)</label>
              <input
                type="number"
                min={0}
                value={filterAmtMax}
                onChange={e => setFilterAmtMax(e.target.value)}
                placeholder="No limit"
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-2 py-1.5 text-sm text-gray-200 outline-none focus:border-indigo-500 placeholder-gray-600"
              />
            </div>
          </div>

          {activeFilterCount > 0 && (
            <div className="flex items-center justify-between pt-1 border-t border-gray-700/50">
              <span className="text-xs text-gray-500">{activeFilterCount} filter{activeFilterCount !== 1 ? 's' : ''} active</span>
              <button
                onClick={clearAdvancedFilters}
                className="text-xs text-red-400 hover:text-red-300 transition-colors font-medium"
              >
                Clear all
              </button>
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="bg-red-900/30 border border-red-700/50 rounded-xl px-4 py-3 text-red-300 text-sm mb-4">
          {error}
        </div>
      )}

      {hitRecordCap && (
        <div className="bg-yellow-900/20 border border-yellow-600/40 rounded-xl px-4 py-3 text-yellow-300 text-sm mb-4">
          ⚠ Showing the first 2,000 records only. Some records may not be visible — contact support to raise this limit.
        </div>
      )}

      {/* Bulk action bar — replaces record count when items are selected */}
      {!loading && someSelected && perms.canBulkAction ? (
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <button onClick={clearSelection} className="text-gray-400 hover:text-gray-200 transition-colors" aria-label="Clear selection">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
          <span className="text-sm font-medium text-white">{selectedIds.size} selected</span>
          {selectedIds.size < allFilteredIds.size && (
            <button onClick={selectAll} className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors">
              Select all {filtered.length}
            </button>
          )}
          <div className="flex-1" />
          <button
            onClick={handleBulkDeactivate}
            disabled={bulkWorking}
            className="text-sm px-3 py-1.5 rounded-lg bg-gray-700 text-gray-200 hover:bg-gray-600 transition-colors disabled:opacity-40"
          >
            Deactivate
          </button>
          {/* Assign dropdown */}
          <div ref={assignRef} className="relative">
            <button
              onClick={() => setAssignOpen(v => !v)}
              disabled={bulkWorking}
              className="text-sm px-3 py-1.5 rounded-lg bg-gray-700 text-gray-200 hover:bg-gray-600 transition-colors disabled:opacity-40 flex items-center gap-1"
            >
              Assign {labels.salesman}
              <svg className={`w-3.5 h-3.5 transition-transform ${assignOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {assignOpen && (
              <div className="absolute right-0 mt-1 w-48 bg-gray-800 border border-gray-700 rounded-xl shadow-xl z-50 overflow-hidden">
                {labels && (
                  <AssignInput onAssign={handleBulkAssign} salesmanList={usePickerStore.getState().lists.salesman} />
                )}
              </div>
            )}
          </div>
          <button
            onClick={() => setEmailModalOpen(true)}
            disabled={bulkWorking}
            className="text-sm px-3 py-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-500 transition-colors disabled:opacity-40"
          >
            Email
          </button>
          <button
            onClick={handleBulkExport}
            disabled={bulkWorking}
            className="text-sm px-3 py-1.5 rounded-lg bg-gray-700 text-gray-200 hover:bg-gray-600 transition-colors disabled:opacity-40"
          >
            Export
          </button>
        </div>
      ) : (
        !loading && (
          <p className="text-xs text-gray-500 mb-3">
            {pageCount > 1
              ? `${rangeStart}–${rangeEnd} of ${filtered.length} records`
              : `${filtered.length} ${filtered.length === 1 ? 'record' : 'records'}`}
            {!showInactive && ' · active only'}
            {activeFilterCount > 0 && ` · ${activeFilterCount} filter${activeFilterCount !== 1 ? 's' : ''}`}
          </p>
        )
      )}

      <div ref={listTopRef} className="card divide-y divide-gray-700/50">
        {/* Select-all checkbox row — hidden for roles without bulk actions */}
        {!loading && filtered.length > 0 && perms.canBulkAction && (
          <div className="flex items-center gap-3 px-4 py-2 border-b border-gray-700/50 bg-gray-800/30">
            <input
              type="checkbox"
              checked={allPageSelected}
              onChange={togglePage}
              className="w-4 h-4 rounded border-gray-600 bg-gray-700 text-indigo-500 cursor-pointer shrink-0"
            />
            <span className="text-xs text-gray-500">
              {allPageSelected ? 'Deselect page' : 'Select page'}
            </span>
          </div>
        )}
        {loading ? (
          Array.from({ length: 6 }).map((_, i) => <SkeletonRow key={i} />)
        ) : filtered.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <p className="text-gray-400">
              {search || activeFilterCount > 0
                ? 'No results match those filters'
                : `No ${CATEGORY_LABELS[cat].toLowerCase()} yet`}
            </p>
            {search || activeFilterCount > 0 ? (
              <button
                onClick={() => { setSearch(''); clearAdvancedFilters() }}
                className="mt-3 text-sm text-indigo-400 hover:text-indigo-300"
              >
                Clear filters
              </button>
            ) : (
              <Link
                to={`/records/new?category=${cat}`}
                className="inline-block mt-3 text-sm text-indigo-400 hover:text-indigo-300"
              >
                Add the first one →
              </Link>
            )}
          </div>
        ) : (
          paginated.map(c => (
            <CustomerRow
              key={c.id}
              customer={c}
              selected={selectedIds.has(c.id)}
              onToggle={() => toggleOne(c.id)}
              showCheckbox={perms.canBulkAction}
            />
          ))
        )}

        {/* Pagination footer — only shown when there's more than one page */}
        {!loading && pageCount > 1 && (
          <div className="flex items-center justify-between px-4 py-3">
            <button
              onClick={() => { setPage(p => Math.max(1, p - 1)); listTopRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }}
              disabled={page === 1}
              className="flex items-center gap-1 text-sm text-gray-400 hover:text-gray-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
              Prev
            </button>
            <span className="text-xs text-gray-500 tabular-nums">
              {page} / {pageCount}
            </span>
            <button
              onClick={() => { setPage(p => Math.min(pageCount, p + 1)); listTopRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }}
              disabled={page === pageCount}
              className="flex items-center gap-1 text-sm text-gray-400 hover:text-gray-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              Next
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        )}
      </div>
      {csvImportOpen && (
        <CSVImportModal
          defaultCategory={cat}
          onClose={() => setCsvImportOpen(false)}
          onImported={count => {
            toast(`Imported ${count} record${count !== 1 ? 's' : ''}.`, 'success')
          }}
        />
      )}
      {emailModalOpen && (
        <BulkEmailModal
          recipientCount={selectedIds.size}
          emailCount={filtered.filter(c => selectedIds.has(c.id) && c.email?.includes('@')).length}
          working={bulkWorking}
          onSend={(subject, body) => {
            setEmailModalOpen(false)
            handleBulkEmail(subject, body)
          }}
          onClose={() => setEmailModalOpen(false)}
        />
      )}
    </div>
  )
}

function CustomerRow({
  customer: c,
  selected,
  onToggle,
  showCheckbox = true,
}: {
  customer: CustomerItem
  selected: boolean
  onToggle: () => void
  showCheckbox?: boolean
}) {
  const name = c.category.toLowerCase() === 'vendor' ? (c.first || '—') : fullName(c)
  const initials = [c.first[0], c.category.toLowerCase() !== 'vendor' ? c.lastname[0] : ''].filter(Boolean).join('').toUpperCase()
  const coloredAvatars = usePrefStore(s => s.coloredAvatars)
  const color = coloredAvatars ? avatarColor(name) : avatarOriginal()

  return (
    <div className={`group flex items-center gap-3 px-4 py-3 transition-colors ${selected ? 'bg-indigo-600/10' : 'hover:bg-gray-700/30'}`}>
      {/* Avatar doubles as the selection toggle */}
      {showCheckbox ? (
        <button
          type="button"
          onClick={onToggle}
          className="relative w-9 h-9 rounded-full shrink-0 overflow-hidden focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          aria-label={selected ? 'Deselect' : 'Select'}
        >
          {selected ? (
            <div className="w-full h-full bg-indigo-600 flex items-center justify-center">
              <svg className="w-4 h-4 text-white" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
              </svg>
            </div>
          ) : (
            <>
              <div className="w-full h-full flex items-center justify-center" style={{ background: color.bg }}>
                {c.photo
                  ? <img src={c.photo} alt={name} className="w-full h-full object-cover" />
                  : <span className="text-sm font-semibold" style={{ color: color.text }}>{initials || '?'}</span>
                }
              </div>
              {/* Hover: dim avatar and show checkbox hint */}
              <div className="absolute inset-0 bg-gray-900/60 rounded-full opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                <div className="w-4 h-4 rounded border-2 border-white" />
              </div>
            </>
          )}
        </button>
      ) : (
        <div
          className="w-9 h-9 rounded-full shrink-0 overflow-hidden flex items-center justify-center"
          style={{ background: color.bg }}
        >
          {c.photo
            ? <img src={c.photo} alt={name} className="w-full h-full object-cover" />
            : <span className="text-sm font-semibold" style={{ color: color.text }}>{initials || '?'}</span>
          }
        </div>
      )}
      <Link
        to={`/records/${c.id}`}
        className="flex items-center gap-3 flex-1 min-w-0"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-gray-100 truncate">{name || '—'}</span>
            {!c.isActive && <span className="text-xs text-gray-500 shrink-0">inactive</span>}
            {(c.tags ?? []).slice(0, 2).map(tag => (
              <span key={tag} className={`px-1.5 py-0.5 rounded-full text-xs font-medium shrink-0 ${tagColor(tag)}`}>{tag}</span>
            ))}
            {(c.tags ?? []).length > 2 && (
              <span className="text-xs text-gray-600 shrink-0">+{c.tags.length - 2}</span>
            )}
          </div>
          <p className="text-sm text-gray-400 truncate">
            {[c.city, c.state].filter(Boolean).join(', ')}
            {c.category.toLowerCase() !== 'vendor' && c.salesman ? ` · ${c.salesman}` : ''}
          </p>
        </div>
        <div className="shrink-0 text-right flex flex-col items-end gap-1">
          {c.amount > 0 && <p className="text-sm font-semibold text-green-400">{formatCurrency(c.amount)}</p>}
          {c.category.toLowerCase() === 'lead' && (() => {
            const ls = scoreLead(c)
            return (
              <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-xs font-semibold border ${ls.badgeClass}`}>
                <span className={`w-1 h-1 rounded-full ${ls.dotClass}`} />
                {ls.label}
              </span>
            )
          })()}
          {c.category.toLowerCase() === 'customer' && (() => {
            const hs = calculateHealthScoreLight(c)
            return (
              <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-xs font-semibold border ${hs.badgeClass}`}>
                <span className={`w-1 h-1 rounded-full ${hs.dotClass}`} />
                {hs.label}
              </span>
            )
          })()}
          {c.phone && <p className="text-xs text-gray-500">{c.phone}</p>}
        </div>
      </Link>
    </div>
  )
}

function AssignInput({
  onAssign,
  salesmanList,
}: {
  onAssign: (name: string) => void
  salesmanList: string[]
}) {
  const [custom, setCustom] = useState('')
  return (
    <div className="p-2 space-y-1">
      {salesmanList.map(s => (
        <button
          key={s}
          onClick={() => onAssign(s)}
          className="w-full text-left px-3 py-2 text-sm text-gray-200 hover:bg-gray-700 rounded-lg transition-colors"
        >
          {s}
        </button>
      ))}
      <div className="flex gap-1 pt-1 border-t border-gray-700">
        <input
          type="text"
          value={custom}
          onChange={e => setCustom(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && custom.trim()) onAssign(custom.trim()) }}
          placeholder="Type name…"
          className="flex-1 bg-gray-900 border border-gray-700 rounded-lg px-2 py-1.5 text-xs text-white placeholder-gray-500 outline-none focus:border-indigo-500"
        />
        <button
          onClick={() => { if (custom.trim()) onAssign(custom.trim()) }}
          className="px-2 py-1.5 bg-indigo-600 rounded-lg text-xs text-white hover:bg-indigo-500"
        >
          Set
        </button>
      </div>
    </div>
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

function BulkEmailModal({
  recipientCount,
  emailCount,
  working,
  onSend,
  onClose,
}: {
  recipientCount: number
  emailCount: number
  working: boolean
  onSend: (subject: string, body: string) => void
  onClose: () => void
}) {
  const [subject, setSubject] = useState('Hi {first}, a message for you')
  const [body, setBody]       = useState('')

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!subject.trim() || !body.trim()) return
    onSend(subject, body)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-lg bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-700/60">
          <h2 className="text-base font-semibold text-white">Send Email</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Recipient summary */}
          <div className={`px-3 py-2 rounded-lg text-sm flex items-center gap-2 ${
            emailCount === 0
              ? 'bg-red-900/30 border border-red-700/50 text-red-300'
              : 'bg-indigo-900/30 border border-indigo-700/50 text-indigo-300'
          }`}>
            <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75" />
            </svg>
            {emailCount === 0
              ? `None of the ${recipientCount} selected records have an email address.`
              : `${emailCount} of ${recipientCount} selected record${recipientCount !== 1 ? 's' : ''} have an email address.`}
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1.5">Subject</label>
            <input
              type="text"
              value={subject}
              onChange={e => setSubject(e.target.value)}
              required
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 outline-none focus:border-indigo-500 placeholder-gray-600"
              placeholder="Email subject…"
            />
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1.5">Body</label>
            <textarea
              value={body}
              onChange={e => setBody(e.target.value)}
              required
              rows={7}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 outline-none focus:border-indigo-500 placeholder-gray-600 resize-none"
              placeholder="Write your message…"
            />
            <p className="text-xs text-gray-600 mt-1">
              Merge tags: <span className="text-gray-500 font-mono">{'{first}'}</span> <span className="text-gray-500 font-mono">{'{lastname}'}</span> <span className="text-gray-500 font-mono">{'{city}'}</span> <span className="text-gray-500 font-mono">{'{salesman}'}</span>
            </p>
          </div>

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2 rounded-xl border border-gray-700 text-sm text-gray-400 hover:text-gray-200 hover:border-gray-600 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={working || emailCount === 0 || !subject.trim() || !body.trim()}
              className="flex-1 py-2 rounded-xl bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {working ? 'Sending…' : `Send to ${emailCount} recipient${emailCount !== 1 ? 's' : ''}`}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
