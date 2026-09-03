import { Fragment, useEffect, useMemo, useRef, useState, useCallback, type ReactNode } from 'react'
import { useLocation, useSearchParams, Link } from 'react-router-dom'
import { getFunctions, httpsCallable } from 'firebase/functions'
import { subscribeToCustomers, importCustomersFromJSON, bulkDeactivate, bulkAssignSalesman, bulkAssignSalesmanUser, setPaymentStatus, setEmployeeStatus, REALTIME_LIMIT } from '../../services/customerService'
import { fetchSalesmenForCompany, memberDisplayName, type TeamMember } from '../../services/teamService'
import { categoryMatches, fullName, displayName, vendorFields, formatCurrency, type CustomerItem, CATEGORY_LABELS, type CustomerCategory } from '../../models/customer'
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
import { leadStatusColor } from '../../utils/leadStatusColor'
import { dealAgeDays, dealAgeClasses } from '../../utils/dealLength'
import { scoreLead, scoreBreakdown } from '../../utils/leadScore'
import { calculateHealthScore, healthBreakdown, type CustomerHealth, type HealthLabel } from '../../utils/customerHealth'
import { useSharedInvoices, useSharedServicePlans } from '../../hooks/useSharedCollections'
import CSVImportModal from '../../components/CSVImportModal'
import { subscribeToSavedViews, createSavedView, deleteSavedView } from '../../services/savedViewService'
import type { SavedView } from '../../models/savedView'

const PAGE_SIZE = 50

type SortField = 'name' | 'date' | 'location' | 'active' | 'score' | 'rating'
type SortDir   = 'asc' | 'desc'

const SORT_LABELS: Record<SortField, string> = {
  name:     'Name',
  date:     'Date',
  location: 'Location',
  active:   'Active',
  score:    'Score',
  rating:   'Rating',
}

/**
 * The sort menu was fixed across all four categories, so "Score" appeared on
 * /vendors and /employees and ordered them by scoreLead — a lead-qualification
 * score computed from phone/email/appointment fields. It produced a confident
 * but meaningless order. Rating is the vendor equivalent and only vendors
 * store one.
 */
function sortFieldsFor(cat: CustomerCategory): SortField[] {
  const base: SortField[] = ['name', 'date', 'location', 'active']
  if (cat === 'Lead') return [...base, 'score']
  if (cat === 'Vendor') return [...base, 'rating']
  return base
}

const CATEGORY_ORDER: CustomerCategory[] = ['Lead', 'Customer', 'Vendor', 'Employee']

const PATH_TO_CATEGORY: Record<string, CustomerCategory> = {
  '/leads': 'Lead',
  '/customers': 'Customer',
  '/vendors': 'Vendor',
  '/employees': 'Employee',
}

// Only Lead/Customer use `salesman` as a real assignee — Vendor repurposes it as
// a Callback flag and Employee as an "is a salesperson" flag (see CustomerFormPage).
function isLeadOrCustomer(cat: CustomerCategory): boolean {
  return cat === 'Lead' || cat === 'Customer'
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

/** Inline icon matching this page's existing SVGs (strokeWidth 2, currentColor
 *  so it follows hover states). The shared ico() helper in config/navigation is
 *  strokeWidth 1.5 and single-path, which doesn't fit here. */
function Icon({ d, className = 'w-4 h-4' }: { d: string | readonly string[]; className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      {(Array.isArray(d) ? d : [d as string]).map((p, i) => (
        <path key={i} strokeLinecap="round" strokeLinejoin="round" d={p} />
      ))}
    </svg>
  )
}

// Heroicons v2 outline paths, replacing emoji (🏷 🖨 ⚠) and ASCII arrows (↑ ↓).
// Those render from Apple Color Emoji or the UI font, so they can't inherit a
// button's colour — the same trap index.css documents for .icon-star.
const ICONS = {
  tag: [
    'M9.568 3H5.25A2.25 2.25 0 0 0 3 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 0 0 5.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 0 0 9.568 3Z',
    'M6 6h.008v.008H6V6Z',
  ],
  printer: 'M6.72 13.829c-.24.03-.48.062-.72.096m.72-.096a42.415 42.415 0 0 1 10.56 0m-10.56 0L6.34 18m10.94-4.171c.24.03.48.062.72.096m-.72-.096L17.66 18m0 0 .229 2.523a1.125 1.125 0 0 1-1.12 1.227H7.231c-.662 0-1.18-.568-1.12-1.227L6.34 18m11.318 0h1.091A2.25 2.25 0 0 0 21 15.75V9.456c0-1.081-.768-2.015-1.837-2.175a48.055 48.055 0 0 0-1.913-.247M6.34 18H5.25A2.25 2.25 0 0 1 3 15.75V9.456c0-1.081.768-2.015 1.837-2.175a48.041 48.041 0 0 1 1.913-.247m10.5 0a48.536 48.536 0 0 0-10.5 0m10.5 0V3.375c0-.621-.504-1.125-1.125-1.125h-8.25c-.621 0-1.125.504-1.125 1.125v3.659M18 10.5h.008v.008H18V10.5Zm-3 0h.008v.008H15V10.5Z',
  uploadTray: 'M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M7.5 7.5 12 3m0 0 4.5 4.5M12 3v13.5',
  downloadTray: 'M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3',
  arrowUp: 'M4.5 10.5 12 3m0 0 7.5 7.5M12 3v18',
  arrowDown: 'M19.5 13.5 12 21m0 0-7.5-7.5M12 21V3',
  warning: 'M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z',
  close: 'M6 18 18 6M6 6l12 12',
  // ★/☆ render from Apple Color Emoji as a solid black star that ignores
  // `color` outright — the .icon-star rule in index.css exists for exactly
  // this. Use the path with that class, never the glyph.
  star: 'M11.48 3.499a.562.562 0 0 1 1.04 0l2.125 5.111a.563.563 0 0 0 .475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 0 0-.182.557l1.285 5.385a.562.562 0 0 1-.84.61l-4.725-2.885a.562.562 0 0 0-.586 0L6.982 20.54a.562.562 0 0 1-.84-.61l1.285-5.386a.562.562 0 0 0-.182-.557l-4.204-3.602a.562.562 0 0 1 .321-.988l5.518-.442a.563.563 0 0 0 .475-.345L11.48 3.5Z',
} as const

function QuickFilterButton({ label, active, onClick }: { label: ReactNode; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
        active ? 'bg-indigo-600/20 text-indigo-300' : 'text-gray-400 hover:text-gray-200 hover:bg-gray-700/50'
      }`}
    >
      {label}
    </button>
  )
}

/** A titled group of quick filters, capped so a data-derived list can't grow
 *  the sidebar taller than the record table it sits beside — statuses and
 *  sources come from the records themselves, so imported data can produce
 *  dozens. The active option is always kept visible even when collapsed,
 *  so a filter can never be hidden while it's in effect. */
function QuickFilterGroup({ title, options, activeValue, onSelect, initial = 6 }: {
  title: string
  options: string[]
  activeValue: string
  onSelect: (next: string) => void
  initial?: number
}) {
  const [expanded, setExpanded] = useState(false)
  const base = options.slice(0, initial)
  const shown = expanded
    ? options
    : activeValue && !base.includes(activeValue) ? [...base, activeValue] : base
  const hiddenCount = options.length - shown.length

  return (
    <>
      <p className="text-[10px] font-bold uppercase tracking-wider text-gray-200 pt-2 px-1">{title}</p>
      {shown.map(o => (
        <QuickFilterButton
          key={o}
          label={o}
          active={activeValue === o}
          onClick={() => onSelect(activeValue === o ? '' : o)}
        />
      ))}
      {(hiddenCount > 0 || expanded) && (
        <button
          type="button"
          onClick={() => setExpanded(v => !v)}
          className="w-full text-left px-3 py-1 text-xs font-medium text-indigo-400 hover:text-indigo-300 transition-colors"
        >
          {expanded ? 'Show less' : `Show ${hiddenCount} more`}
        </button>
      )}
    </>
  )
}

export default function CustomerListPage() {
  const { pathname } = useLocation()
  const cat: CustomerCategory = PATH_TO_CATEGORY[pathname] ?? 'Lead'
  const hasQuickFilterSidebar = cat === 'Employee' || cat === 'Lead' || cat === 'Customer' || cat === 'Vendor'
  usePageTitle(CATEGORY_LABELS[cat])
  const companyId = useAuthStore(s => s.companyId)
  const user = useAuthStore(s => s.user)
  const labels = usePickerStore(s => s.labels)
  const toast = useToast()
  const perms = usePermissions()

  // Health used to be computed here with calculateHealthScoreLight (recency +
  // engagement only, scaled to 100) while the record page and /health used the
  // full score. Same labels, same colours, different verdicts: a customer with
  // overdue invoices read "Good" (70) on this list and "At Risk" (35) one click
  // away. The list now uses the same full score as everywhere else, which needs
  // invoices and service plans — opted out on the other three category routes
  // so they don't open listeners whose data goes unused.
  const isCustomerView = cat === 'Customer'
  const { items: invoices, loading: invoicesLoading } = useSharedInvoices(isCustomerView)
  const { items: servicePlans, loading: plansLoading } = useSharedServicePlans(isCustomerView)
  const healthReady = isCustomerView && !invoicesLoading && !plansLoading

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
  // Quick filters (right-hand sidebar) — not part of saved views yet.
  const [filterLeadStatus, setFilterLeadStatus] = useState('')
  const [filterQuality, setFilterQuality]       = useState<'' | 'hot' | 'stale'>('')
  const [filterAssignment, setFilterAssignment] = useState<'' | 'mine' | 'unassigned'>('')
  const [filterHealth, setFilterHealth]         = useState<'' | HealthLabel>('')
  const [filterPaymentStatus, setFilterPaymentStatus] = useState('')
  // `salesman` is repurposed as a plain Yes/No flag for Employee ("is a
  // salesperson") and Vendor ("has callback") — a different field from the
  // generic `callback` ("was contacted") used by the Lead/Customer filter.
  const [filterEmployeeStatus, setFilterEmployeeStatus] = useState('')
  const [filterSalesmanFlag, setFilterSalesmanFlag] = useState<'' | 'yes' | 'no'>('')
  const [filterProfession, setFilterProfession] = useState('')
  const [filterRating, setFilterRating]         = useState('')
  const [filterManager, setFilterManager]       = useState('')

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
    setFilterLeadStatus('')
    setFilterQuality('')
    setFilterAssignment('')
    setFilterHealth('')
    setFilterPaymentStatus('')
    setFilterSalesmanFlag('')
    setFilterProfession('')
    setFilterRating('')
    setFilterManager('')
    setFilterEmployeeStatus('')
  }

  useEffect(() => subscribeToSavedViews(cat, setSavedViews, () => {}), [cat])

  function applySavedView(view: SavedView) {
    const f = view.filters
    // Reset first: saved views don't carry the quick filters yet, so without
    // this any that happen to be active stay applied and silently intersect
    // with the view — meaning the view doesn't reproduce what was saved.
    clearAdvancedFilters()
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
      // Employees carry a second status field that has to agree with `active`,
      // the same pairing CustomerDetailPage.handleToggleActive applies.
      // Without it these rows kept an "Active" employment badge after being
      // deactivated.
      await bulkDeactivate(ids, cat === 'Employee' ? { employeeStatus: 'Inactive' } : {})
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

  async function handleBulkAssignUser(uid: string, displayName: string) {
    const ids = [...selectedIds]
    setAssignOpen(false)
    setBulkWorking(true)
    try {
      await bulkAssignSalesmanUser(ids, uid, displayName)
      toast(`Assigned ${ids.length} record${ids.length !== 1 ? 's' : ''} to ${displayName}.`, 'success')
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

  const uniqueLeadStatuses = useMemo<string[]>(() => {
    const set = new Set<string>()
    all.filter(c => categoryMatches(c.category, cat) && c.leadStatus.trim()).forEach(c => set.add(c.leadStatus.trim()))
    return [...set].sort()
  }, [all, cat])

  const uniquePaymentStatuses = useMemo<string[]>(() => {
    const set = new Set<string>()
    all.filter(c => categoryMatches(c.category, cat) && c.paymentStatus.trim()).forEach(c => set.add(c.paymentStatus.trim()))
    return [...set].sort()
  }, [all, cat])

  // Vendor-only fields: `profession` (trade), `rate` (1-5 star rating), and
  // `callback` (repurposed to hold the manager's name for Vendor records).
  const uniqueProfessions = useMemo<string[]>(() => {
    const set = new Set<string>()
    all.filter(c => categoryMatches(c.category, cat) && c.profession.trim()).forEach(c => set.add(c.profession.trim()))
    return [...set].sort()
  }, [all, cat])

  // Normalised before deduping: `rate` is a string, so '5' and '5.0' used to
  // become two separate filter buttons that each matched a different subset.
  const uniqueRatings = useMemo<string[]>(() => {
    const set = new Set<string>()
    all.filter(c => categoryMatches(c.category, cat) && c.rate.trim()).forEach(c => {
      const n = Number(c.rate.trim())
      if (Number.isFinite(n)) set.add(String(n))
    })
    return [...set].sort((a, b) => Number(b) - Number(a))
  }, [all, cat])

  const uniqueManagers = useMemo<string[]>(() => {
    const set = new Set<string>()
    all.filter(c => categoryMatches(c.category, cat) && c.callback.trim()).forEach(c => set.add(c.callback.trim()))
    return [...set].sort()
  }, [all, cat])

  const uniqueProducts = useMemo<string[]>(() => {
    const set = new Set<string>()
    all.filter(c => categoryMatches(c.category, cat) && c.product.trim()).forEach(c => set.add(c.product.trim()))
    return [...set].sort()
  }, [all, cat])

  // calculateHealthScore filters the invoice and plan arrays by customerId
  // internally. Both collections cap at 5,000 docs, so calling it per customer
  // against the full arrays would be up to 25M comparisons per recompute.
  // Pre-grouping makes each call O(1) — passing an already-narrowed array is
  // equivalent, since the internal filter then just passes it through.
  const invoicesByCustomer = useMemo(() => {
    const m = new Map<string, typeof invoices>()
    for (const inv of invoices) {
      const list = m.get(inv.customerId)
      if (list) list.push(inv)
      else m.set(inv.customerId, [inv])
    }
    return m
  }, [invoices])

  const plansByCustomer = useMemo(() => {
    const m = new Map<string, typeof servicePlans>()
    for (const p of servicePlans) {
      const list = m.get(p.customerId)
      if (list) list.push(p)
      else m.set(p.customerId, [p])
    }
    return m
  }, [servicePlans])

  const healthFor = useCallback(
    (c: CustomerItem): CustomerHealth => calculateHealthScore(
      c,
      invoicesByCustomer.get(c.id) ?? [],
      plansByCustomer.get(c.id) ?? [],
    ),
    [invoicesByCustomer, plansByCustomer],
  )

  // A health filter can't be applied until invoices and service plans arrive,
  // so the list has to keep showing skeletons until then. Otherwise it renders
  // every customer for a moment and snaps to the filtered set — the same
  // flash-of-wrong-content the badge placeholder avoids.
  const listLoading = loading || (!!filterHealth && !healthReady)

  const activeFilterCount = [
    filterSalesman, filterState, filterLeadSource, filterProduct,
    filterCallback, filterDateFrom, filterDateTo, filterAmtMin, filterAmtMax,
    filterLeadStatus, filterQuality, filterAssignment, filterHealth, filterPaymentStatus,
    filterSalesmanFlag, filterProfession, filterRating, filterManager, filterEmployeeStatus,
  ].filter(Boolean).length

  const filtered = useMemo(() => {
    let items = all.filter(c => categoryMatches(c.category, cat))
    if (!showInactive) items = items.filter(c => c.isActive)
    if (tagFilter) items = items.filter(c => (c.tags ?? []).includes(tagFilter))
    if (debouncedSearch.trim()) {
      const q = debouncedSearch.toLowerCase()
      items = items.filter(c =>
        fullName(c).toLowerCase().includes(q) ||
        c.companyName.toLowerCase().includes(q) ||
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
    if (filterLeadStatus) items = items.filter(c => c.leadStatus === filterLeadStatus)
    if (filterQuality === 'hot') items = items.filter(c => scoreLead(c).label === 'Hot')
    else if (filterQuality === 'stale') items = items.filter(c => dealAgeDays(c) >= 30)
    // "Mine" = assigned to me OR created by me. Creating a lead doesn't make you
    // its salesman, so authorship counts on its own — otherwise this filter is
    // permanently empty for anyone whose role isn't 'salesman' (they can't
    // appear in the assignee picker at all).
    if (filterAssignment === 'mine') {
      items = items.filter(c => !!user?.uid && (c.assignedToUid === user.uid || c.createdByUid === user.uid))
    }
    else if (filterAssignment === 'unassigned') items = items.filter(c => !c.assignedToUid)
    // Must use the same score the badge renders, or filtering by "At Risk"
    // returns a different set than the badges show. Skipped until the
    // collections load, so the filter can't silently match on partial data.
    if (filterHealth && healthReady) items = items.filter(c => healthFor(c).label === filterHealth)
    if (filterPaymentStatus) items = items.filter(c => c.paymentStatus === filterPaymentStatus)
    // "No" has to mean "not yes" rather than literally 'no', the same way
    // filterCallback above treats it: on records where the flag was never set
    // `salesman` is empty, and those belong in the No bucket.
    // Employment status was displayed and editable but had no filter at all —
    // you could see who was On Leave but not list them. Matches on the resolved
    // status so records with an unset field are still reachable.
    if (filterEmployeeStatus) items = items.filter(c => effectiveEmployeeStatus(c) === filterEmployeeStatus)
    if (filterSalesmanFlag === 'yes') items = items.filter(c => c.salesman.toLowerCase() === 'yes')
    else if (filterSalesmanFlag === 'no') items = items.filter(c => c.salesman.toLowerCase() !== 'yes')
    if (filterProfession) items = items.filter(c => c.profession === filterProfession)
    if (filterRating) items = items.filter(c => Number(c.rate) === Number(filterRating))
    if (filterManager) items = items.filter(c => c.callback === filterManager)
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
    // Score is derived, not stored, so precompute it once per record instead of
    // recomputing inside the comparator — that ran it O(n log n) times.
    const scores = sortField === 'score'
      ? new Map(items.map(c => [c.id, scoreLead(c).score]))
      : null
    items = [...items].sort((a, b) => {
      switch (sortField) {
        case 'name':     return dir * displayName(a).localeCompare(displayName(b))
        case 'date':     return dir * (a.creationDate.getTime() - b.creationDate.getTime())
        case 'location': return dir * (a.city || '').localeCompare(b.city || '')
        case 'active':   return dir * (Number(b.isActive) - Number(a.isActive))
        case 'score':    return dir * ((scores!.get(a.id) ?? 0) - (scores!.get(b.id) ?? 0))
        case 'rating':   return dir * ((Number(a.rate) || 0) - (Number(b.rate) || 0))
        default:         return 0
      }
    })
    return items
  }, [all, cat, debouncedSearch, showInactive, tagFilter, sortField, sortDir,
      filterSalesman, filterState, filterLeadSource, filterProduct, filterCallback,
      filterDateFrom, filterDateTo, filterAmtMin, filterAmtMax,
      filterLeadStatus, filterQuality, filterAssignment, filterHealth, filterPaymentStatus, user,
      filterSalesmanFlag, filterProfession, filterRating, filterManager, filterEmployeeStatus,
      healthReady, healthFor])

  // Reset to page 1 whenever anything changes the filtered set
  useEffect(() => { setPage(1) }, [debouncedSearch, cat, showInactive, tagFilter, sortField, sortDir,
    filterSalesman, filterState, filterLeadSource, filterProduct, filterCallback,
    filterDateFrom, filterDateTo, filterAmtMin, filterAmtMax,
    filterLeadStatus, filterQuality, filterAssignment, filterHealth, filterPaymentStatus,
    filterSalesmanFlag, filterProfession, filterRating, filterManager, filterEmployeeStatus])

  const pageCount  = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const paginated  = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const rangeStart = filtered.length === 0 ? 0 : (page - 1) * PAGE_SIZE + 1
  const rangeEnd   = Math.min(page * PAGE_SIZE, filtered.length)

  // Bulk selection derived values (must come after filtered/paginated)
  const allFilteredIds  = useMemo(() => new Set(filtered.map(c => c.id)), [filtered])
  const allPageSelected = paginated.length > 0 && paginated.every(c => selectedIds.has(c.id))
  const someSelected    = selectedIds.size > 0

  // Keep the selection inside the visible set. The clear-on-change effect above
  // only watches category/showInactive/search, so narrowing any of the ~18
  // advanced or quick filters used to leave hidden rows selected — and the bulk
  // actions disagreed about what that meant: Deactivate/Assign/Email read
  // selectedIds directly (acting on rows no longer on screen), while Export
  // intersects with `filtered` (silently exporting fewer than the count shown).
  // Pruning rather than clearing keeps a partial selection usable across a
  // filter tweak.
  useEffect(() => {
    setSelectedIds(prev => {
      if (prev.size === 0) return prev
      const next = new Set([...prev].filter(id => allFilteredIds.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [allFilteredIds])

  function handlePrint() {
    const dateStr = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    const label = CATEGORY_LABELS[cat]

    // The fifth column was hard-coded to the Salesman label printing
    // `c.salesman`. Vendors store the Callback Yes/No flag in that field and
    // employees store an is-a-salesperson flag, so both printed a column
    // headed "Salesman" full of Yes/No.
    const personColumn: { heading: string; value: (c: CustomerItem) => string } =
      cat === 'Vendor'
        ? { heading: 'Manager', value: c => vendorFields(c).manager || '' }
        : cat === 'Employee'
          ? { heading: 'Role', value: c => c.job || c.profession || '' }
          : { heading: labels.salesman ?? 'Salesman', value: c => c.salesman || '' }

    const rows = filtered.map(c => {
      const name = displayName(c)
      // Company-named records list the company, with the contact person beneath it.
      const personName = c.companyName.trim() ? fullName(c) : ''
      const location = [c.city, c.state].filter(Boolean).join(', ')
      const amt = c.amount > 0 ? formatCurrency(c.amount) : ''
      return `
        <tr style="border-bottom:1px solid #e5e7eb;">
          <td style="padding:10px 8px;font-size:14px;font-weight:500;color:#111;vertical-align:top;">${esc(name) || '—'}${!c.isActive ? ' <span style="font-size:11px;color:#9ca3af;">(inactive)</span>' : ''}${personName ? `<div style="font-size:12px;font-weight:400;color:#6b7280;">${esc(personName)}</div>` : ''}</td>
          <td style="padding:10px 8px;font-size:12px;color:#6b7280;white-space:nowrap;vertical-align:top;">${esc(c.phone || '')}</td>
          <td style="padding:10px 8px;font-size:12px;color:#6b7280;white-space:nowrap;vertical-align:top;">${esc(location)}</td>
          <td style="padding:10px 8px;font-size:12px;color:#6b7280;vertical-align:top;">${esc(c.email || '')}</td>
          <td style="padding:10px 8px;font-size:12px;color:#6b7280;white-space:nowrap;vertical-align:top;">${esc(personColumn.value(c))}</td>
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
        <th>${esc(personColumn.heading)}</th>
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
    <div className={hasQuickFilterSidebar ? 'max-w-5xl mx-auto px-4 py-6' : 'max-w-3xl mx-auto px-4 py-6'}>
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
              className="btn-secondary text-sm flex items-center gap-1.5"
            >
              Sort By
              <svg className={`w-3.5 h-3.5 transition-transform ${sortOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {sortOpen && (
              <div className="absolute right-0 mt-1 w-40 bg-gray-800 border border-gray-700 rounded-xl shadow-xl z-50 overflow-hidden">
                {sortFieldsFor(cat).map(field => (
                  <button
                    key={field}
                    onClick={() => handleSortSelect(field)}
                    className="w-full text-left px-4 py-2.5 text-sm text-gray-200 hover:bg-gray-700 flex items-center justify-between"
                  >
                    <span>{SORT_LABELS[field]}</span>
                    {sortField === field && (
                      <Icon
                        className="w-3 h-3 text-indigo-400"
                        d={sortDir === 'asc' ? ICONS.arrowUp : ICONS.arrowDown}
                      />
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
              className="btn-secondary text-sm flex items-center gap-1.5"
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
                      <Icon d={ICONS.uploadTray} />
                      {importing ? 'Importing…' : 'Import JSON'}
                    </button>
                    <button
                      onClick={() => { closeMenu(); setCsvImportOpen(true) }}
                      className="w-full text-left px-4 py-2.5 text-sm text-gray-200 hover:bg-gray-700 flex items-center gap-2.5"
                    >
                      <Icon d={ICONS.uploadTray} />
                      Import CSV
                    </button>
                  </>
                )}
                <button
                  onClick={() => { closeMenu(); handleExport() }}
                  disabled={loading}
                  className="w-full text-left px-4 py-2.5 text-sm text-gray-200 hover:bg-gray-700 disabled:opacity-40 flex items-center gap-2.5"
                >
                  <Icon d={ICONS.downloadTray} />
                  Export JSON
                </button>
                <div className="border-t border-gray-700/60" />
                <button
                  onClick={() => { closeMenu(); handlePrint() }}
                  disabled={listLoading || filtered.length === 0}
                  className="w-full text-left px-4 py-2.5 text-sm text-gray-200 hover:bg-gray-700 disabled:opacity-40 flex items-center gap-2.5"
                >
                  <Icon d={ICONS.printer} />
                  Print
                </button>
              </div>
            )}
          </div>
          {perms.canEdit && (
            <Link to={`/records/new?category=${cat}`} className="btn-primary text-sm">
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

      {/* Search + filter. flex-wrap makes wrapping deliberate rather than
          something the row falls into when a button's label grows, and the
          search field keeps a floor width so it can't be squeezed to a sliver
          before the row decides to wrap. */}
      <div className="flex flex-wrap gap-2 mb-2">
        <input
          ref={searchInputRef}
          type="search"
          className="input-field flex-1 min-w-[14rem]"
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
                <p className="px-4 py-3 text-sm text-gray-400">No saved views for {CATEGORY_LABELS[cat]} yet.</p>
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
                        className="px-2.5 text-gray-400 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
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
        {/* The Active/All toggle used to live here as well as in the Common
            Filters sidebar. Both wrote the same showInactive state, and every
            category's sidebar carries the labelled pair ("Active Leads" /
            "All Leads"), so this copy was redundant — and ambiguous, since its
            label was its state rather than its action. The record count line
            below still reports "· active only". */}
        {/* Tag filter */}
        {allCatTags.length > 0 && (
          <div ref={tagRef} className="relative flex items-stretch">
            {/* Two sibling buttons, not a <span onClick> nested inside a
                <button>: nesting interactive content is invalid markup and left
                the clear action unreachable by keyboard. Segmented via the
                corner radii so it still reads as one control. */}
            <button
              onClick={() => setTagOpen(v => !v)}
              className={`px-3 py-2 text-sm font-medium border transition-colors flex items-center gap-1.5 ${
                tagFilter ? 'rounded-l-lg border-r-0' : 'rounded-lg'
              } ${
                tagFilter
                  ? 'bg-indigo-600/20 border-indigo-500/50 text-indigo-300'
                  : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-gray-200'
              }`}
            >
              <Icon d={ICONS.tag} className="w-4 h-4 shrink-0" />
              {/* The label swaps between "Tag" and an arbitrary-length tag
                  name, which is what let this button shove the row into a
                  reflow. Capped and truncated so its width stays bounded. */}
              <span className="truncate max-w-[8rem]">{tagFilter ?? 'Tag'}</span>
            </button>
            {tagFilter && (
              <button
                onClick={() => setTagFilter(null)}
                aria-label={`Clear tag filter "${tagFilter}"`}
                className="px-2 rounded-r-lg border border-indigo-500/50 bg-indigo-600/20 text-indigo-300 hover:bg-indigo-600/30 transition-colors flex items-center"
              >
                <Icon d={ICONS.close} className="w-3.5 h-3.5" />
              </button>
            )}
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
            {/* Only Lead/Customer use `salesman` as an assignee — Employee
                repurposes it as an is-a-salesperson flag and Vendor as a
                Callback flag (see isLeadOrCustomer). Ungated, this rendered a
                dropdown labelled "Salesman" whose only options were "yes" and
                "no", duplicating the sidebar's Salesperson buttons through a
                different piece of state the two could disagree on. */}
            {isLeadOrCustomer(cat) && uniqueSalesmen.length > 0 && (
              <div>
                <label className="block text-xs text-gray-400 mb-1">{labels.salesman ?? 'Salesman'}</label>
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
                <label className="block text-xs text-gray-400 mb-1">State</label>
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
            {/* Leads get Source as a quick-filter group in the sidebar, so the
                select would be a second control on the same filterLeadSource
                state. The other categories have no sidebar Source group, so
                they still need it here. */}
            {uniqueLeadSources.length > 0 && cat !== 'Lead' && (
              <div>
                <label className="block text-xs text-gray-400 mb-1">Lead Source</label>
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
                <label className="block text-xs text-gray-400 mb-1">Product</label>
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
            {/* Lead/Customer only. `callback` is the real callback flag for
                those two, but Vendor repurposes it to hold the Manager's NAME
                (see isLeadOrCustomer) — so this select filtered
                c.callback === 'yes' against a person's name: "Yes" matched
                nothing and "No" matched everything. Vendors already have a
                working "Callback: Yes/No" pair in the sidebar, which reads the
                field that actually holds the flag (c.salesman), so this was
                also a second control labelled "Callback" on the same page.
                Employees don't have the dimension at all. */}
            {isLeadOrCustomer(cat) && (
            <div>
              <label className="block text-xs text-gray-400 mb-1">Callback</label>
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
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Date From</label>
              <input
                type="date"
                value={filterDateFrom}
                onChange={e => setFilterDateFrom(e.target.value)}
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-2 py-1.5 text-sm text-gray-200 outline-none focus:border-indigo-500"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Date To</label>
              <input
                type="date"
                value={filterDateTo}
                onChange={e => setFilterDateTo(e.target.value)}
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-2 py-1.5 text-sm text-gray-200 outline-none focus:border-indigo-500"
              />
            </div>
          </div>

          {/* Amount isn't an employee field — the form gates it behind
              !isEmployee — so a min/max range over staff records filters on
              legacy import data. */}
          {cat !== 'Employee' && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Min Amount ($)</label>
              <input
                type="number"
                min={0}
                value={filterAmtMin}
                onChange={e => setFilterAmtMin(e.target.value)}
                placeholder="0"
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-2 py-1.5 text-sm text-gray-200 outline-none focus:border-indigo-500 placeholder-gray-400"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Max Amount ($)</label>
              <input
                type="number"
                min={0}
                value={filterAmtMax}
                onChange={e => setFilterAmtMax(e.target.value)}
                placeholder="No limit"
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-2 py-1.5 text-sm text-gray-200 outline-none focus:border-indigo-500 placeholder-gray-400"
              />
            </div>
          </div>
          )}

          {activeFilterCount > 0 && (
            <div className="flex items-center justify-between pt-1 border-t border-gray-700/50">
              <span className="text-xs text-gray-400">{activeFilterCount} filter{activeFilterCount !== 1 ? 's' : ''} active</span>
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
          <span className="flex items-start gap-2">
            <Icon d={ICONS.warning} className="w-4 h-4 shrink-0 mt-0.5" />
            <span>Showing the first {REALTIME_LIMIT.toLocaleString()} records only. Some records may not be visible — contact support to raise this limit.</span>
          </span>
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
                {isLeadOrCustomer(cat) ? (
                  <UserAssignInput onAssign={handleBulkAssignUser} />
                ) : labels && (
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
        !listLoading && (
          <p className="text-xs text-gray-400 mb-3">
            {pageCount > 1
              ? `${rangeStart}–${rangeEnd} of ${filtered.length} records`
              : `${filtered.length} ${filtered.length === 1 ? 'record' : 'records'}`}
            {!showInactive && ' · active only'}
            {activeFilterCount > 0 && ` · ${activeFilterCount} filter${activeFilterCount !== 1 ? 's' : ''}`}
          </p>
        )
      )}

      {/* Side-by-side only at the width this layout was designed for. The page
          caps at max-w-5xl (1024px), so below lg the 208px sidebar was just
          eating the record list. Stacked, the filters sit above the list
          (order-first) rather than below 50 rows of records. */}
      <div className={hasQuickFilterSidebar ? 'flex flex-col lg:flex-row gap-4 lg:items-start' : ''}>
      <div className={hasQuickFilterSidebar ? 'flex-1 min-w-0' : ''}>
      <div ref={listTopRef} className="card divide-y divide-gray-700/50">
        {/* Select-all checkbox row — hidden for roles without bulk actions */}
        {!listLoading && filtered.length > 0 && perms.canBulkAction && (
          <div className="flex items-center gap-3 px-4 py-2 border-b border-gray-700/50 bg-gray-800/30">
            <input
              type="checkbox"
              checked={allPageSelected}
              onChange={togglePage}
              className="w-4 h-4 rounded border-gray-600 bg-gray-700 text-indigo-500 cursor-pointer shrink-0"
            />
            <span className="text-xs text-gray-400">
              {allPageSelected ? 'Deselect page' : 'Select page'}
            </span>
          </div>
        )}
        {listLoading ? (
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
              health={healthReady ? healthFor(c) : null}
            />
          ))
        )}

        {/* Pagination footer — only shown when there's more than one page */}
        {!listLoading && pageCount > 1 && (
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
            <span className="text-xs text-gray-400 tabular-nums">
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
      </div>
      {cat === 'Employee' && (
        <div className="w-full lg:w-52 shrink-0 card p-3 space-y-1 order-first lg:order-none">
          <p className="text-xs font-bold uppercase tracking-wider text-gray-200 mb-2 px-1">Common Filters</p>
          <QuickFilterButton
            label="Active Employees"
            active={!showInactive}
            onClick={() => { setShowInactive(false); localStorage.setItem('thelight.showInactive', 'false') }}
          />
          <QuickFilterButton
            label="All Employees"
            active={showInactive}
            onClick={() => { setShowInactive(true); localStorage.setItem('thelight.showInactive', 'true') }}
          />
          <QuickFilterButton
            label="Salesperson"
            active={filterSalesmanFlag === 'yes'}
            onClick={() => setFilterSalesmanFlag(filterSalesmanFlag === 'yes' ? '' : 'yes')}
          />
          <QuickFilterButton
            label="Not a Salesperson"
            active={filterSalesmanFlag === 'no'}
            onClick={() => setFilterSalesmanFlag(filterSalesmanFlag === 'no' ? '' : 'no')}
          />
          {/* The one dimension this route uniquely tracks, and the only one
              that had no filter. Fixed list rather than data-derived: these are
              the three values the form offers, so an imported typo shouldn't
              become a filter button. */}
          <QuickFilterGroup
            title="Employment"
            options={EMPLOYEE_STATUS_CYCLE}
            activeValue={filterEmployeeStatus}
            onSelect={setFilterEmployeeStatus}
          />

          {/* Same unbounded-list problem as the Lead sidebar: this is one
              button per state present in the data, which can reach 50. */}
          {uniqueStates.length > 0 && (
            <QuickFilterGroup
              title="State"
              options={uniqueStates}
              activeValue={filterState}
              onSelect={setFilterState}
            />
          )}
        </div>
      )}
      {cat === 'Lead' && (
        <div className="w-full lg:w-52 shrink-0 card p-3 space-y-1 order-first lg:order-none">
          <p className="text-xs font-bold uppercase tracking-wider text-gray-200 mb-2 px-1">Common Filters</p>

          <QuickFilterButton
            label="Active Leads"
            active={!showInactive}
            onClick={() => { setShowInactive(false); localStorage.setItem('thelight.showInactive', 'false') }}
          />
          <QuickFilterButton
            label="All Leads"
            active={showInactive}
            onClick={() => { setShowInactive(true); localStorage.setItem('thelight.showInactive', 'true') }}
          />

          <QuickFilterButton
            label="My Leads"
            active={filterAssignment === 'mine'}
            onClick={() => setFilterAssignment(filterAssignment === 'mine' ? '' : 'mine')}
          />
          <QuickFilterButton
            label="Unassigned"
            active={filterAssignment === 'unassigned'}
            onClick={() => setFilterAssignment(filterAssignment === 'unassigned' ? '' : 'unassigned')}
          />

          <QuickFilterButton
            label="Hot Leads"
            active={filterQuality === 'hot'}
            onClick={() => setFilterQuality(filterQuality === 'hot' ? '' : 'hot')}
          />
          <QuickFilterButton
            label="Stale (30+ Days)"
            active={filterQuality === 'stale'}
            onClick={() => setFilterQuality(filterQuality === 'stale' ? '' : 'stale')}
          />

          {uniqueLeadStatuses.length > 0 && (
            <QuickFilterGroup
              title="Status"
              options={uniqueLeadStatuses}
              activeValue={filterLeadStatus}
              onSelect={setFilterLeadStatus}
            />
          )}

          {uniqueLeadSources.length > 0 && (
            <QuickFilterGroup
              title="Source"
              options={uniqueLeadSources}
              activeValue={filterLeadSource}
              onSelect={setFilterLeadSource}
            />
          )}
        </div>
      )}
      {cat === 'Customer' && (
        <div className="w-full lg:w-52 shrink-0 card p-3 space-y-1 order-first lg:order-none">
          <p className="text-xs font-bold uppercase tracking-wider text-gray-200 mb-2 px-1">Common Filters</p>

          <QuickFilterButton
            label="Active Customers"
            active={!showInactive}
            onClick={() => { setShowInactive(false); localStorage.setItem('thelight.showInactive', 'false') }}
          />
          <QuickFilterButton
            label="All Customers"
            active={showInactive}
            onClick={() => { setShowInactive(true); localStorage.setItem('thelight.showInactive', 'true') }}
          />

          <QuickFilterButton
            label="My Customers"
            active={filterAssignment === 'mine'}
            onClick={() => setFilterAssignment(filterAssignment === 'mine' ? '' : 'mine')}
          />
          <QuickFilterButton
            label="Unassigned"
            active={filterAssignment === 'unassigned'}
            onClick={() => setFilterAssignment(filterAssignment === 'unassigned' ? '' : 'unassigned')}
          />

          <p className="text-[10px] font-bold uppercase tracking-wider text-gray-200 pt-2 px-1">Health</p>
          {(['Excellent', 'Good', 'Fair', 'At Risk'] as HealthLabel[]).map(h => (
            <QuickFilterButton
              key={h}
              label={h}
              active={filterHealth === h}
              onClick={() => setFilterHealth(filterHealth === h ? '' : h)}
            />
          ))}

          {/* Last of the data-derived groups to get capped — imported payment
              values can otherwise grow the sidebar past the record list. */}
          {uniquePaymentStatuses.length > 0 && (
            <QuickFilterGroup
              title="Payment Status"
              options={uniquePaymentStatuses}
              activeValue={filterPaymentStatus}
              onSelect={setFilterPaymentStatus}
            />
          )}
        </div>
      )}
      {cat === 'Vendor' && (
        <div className="w-full lg:w-52 shrink-0 card p-3 space-y-1 order-first lg:order-none">
          <p className="text-xs font-bold uppercase tracking-wider text-gray-200 mb-2 px-1">Common Filters</p>

          <QuickFilterButton
            label="Active Vendors"
            active={!showInactive}
            onClick={() => { setShowInactive(false); localStorage.setItem('thelight.showInactive', 'false') }}
          />
          <QuickFilterButton
            label="All Vendors"
            active={showInactive}
            onClick={() => { setShowInactive(true); localStorage.setItem('thelight.showInactive', 'true') }}
          />

          <QuickFilterButton
            label="Callback: Yes"
            active={filterSalesmanFlag === 'yes'}
            onClick={() => setFilterSalesmanFlag(filterSalesmanFlag === 'yes' ? '' : 'yes')}
          />
          <QuickFilterButton
            label="Callback: No"
            active={filterSalesmanFlag === 'no'}
            onClick={() => setFilterSalesmanFlag(filterSalesmanFlag === 'no' ? '' : 'no')}
          />

          {uniqueRatings.length > 0 && (
            <>
              <p className="text-[10px] font-bold uppercase tracking-wider text-gray-200 pt-2 px-1">Rating</p>
              {uniqueRatings.map(r => (
                <QuickFilterButton
                  key={r}
                  label={<span className="inline-flex items-center gap-1">{r}<Icon d={ICONS.star} className="w-3 h-3 icon-star" /></span>}
                  active={filterRating === r}
                  onClick={() => setFilterRating(filterRating === r ? '' : r)}
                />
              ))}
            </>
          )}

          {uniqueProfessions.length > 0 && (
            <QuickFilterGroup
              title="Profession"
              options={uniqueProfessions}
              activeValue={filterProfession}
              onSelect={setFilterProfession}
            />
          )}

          {uniqueManagers.length > 0 && (
            <QuickFilterGroup
              title="Manager"
              options={uniqueManagers}
              activeValue={filterManager}
              onSelect={setFilterManager}
            />
          )}
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

function fmtShortDate(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/** Days since the record was last touched — the recency input to the health
 *  score. Mirrors dealAgeDays() for leads. */
function daysSinceUpdate(c: CustomerItem): number {
  return Math.max(0, Math.floor((Date.now() - c.lastUpdateDate.getTime()) / 86_400_000))
}

function CustomerRow({
  customer: c,
  selected,
  onToggle,
  showCheckbox = true,
  health = null,
}: {
  customer: CustomerItem
  selected: boolean
  onToggle: () => void
  showCheckbox?: boolean
  /** Full health score, computed by the page. Null until the invoice and
   *  service-plan collections have loaded, so the badge renders a placeholder
   *  rather than briefly showing a label derived from partial data. */
  health?: CustomerHealth | null
}) {
  // A company name takes the row's title; the person's name drops to the subtitle.
  const showCompanyFirst = c.companyName.trim() !== ''
  const personName = fullName(c)
  const name = showCompanyFirst
    ? c.companyName.trim()
    : c.category.toLowerCase() === 'vendor' ? (c.first || '—') : personName
  const initials = showCompanyFirst
    ? name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase()
    : [c.first[0], c.category.toLowerCase() !== 'vendor' ? c.lastname[0] : ''].filter(Boolean).join('').toUpperCase()
  const coloredAvatars = usePrefStore(s => s.coloredAvatars)
  const color = coloredAvatars ? avatarColor(name) : avatarOriginal()

  // Subtitle fields, in display order. Kept as discrete strings so each can
  // truncate on its own instead of being concatenated into one clipped line.
  const lowerCat = c.category.toLowerCase()
  const subtitleParts = [
    showCompanyFirst ? personName : '',
    [c.city, c.state].filter(Boolean).join(', '),
    // Employees showed only an unlabelled adNo here, while job, profession and
    // manager — the fields you'd actually scan a staff list for — went unused.
    // Each part truncates independently, so adding them can't clip the others
    // out of existence.
    ...(lowerCat === 'employee'
      ? [
          c.job || c.profession,
          c.manager ? `Reports to ${c.manager}` : '',
          c.adNo ? `ID ${c.adNo}` : '',
        ]
      : lowerCat === 'vendor'
        // Manager and Next Follow-up Date are both vendor form fields that the
        // list never showed. Manager is read through vendorFields because it's
        // stored in `callback`, not `manager`.
        ? [
            c.profession,
            vendorFields(c).manager ? `Mgr ${vendorFields(c).manager}` : '',
            c.followUpDate ? `Follow-up ${fmtShortDate(c.followUpDate)}` : '',
          ]
        : [c.salesman]),
    // Recency is the single largest input to a customer's health score (35 of
    // 100) and had no presence on the row at all — the verdict was visible but
    // its dominant cause wasn't. Leads show deal age in the same spirit.
    lowerCat === 'customer' ? `Updated ${daysSinceUpdate(c)}d ago` : '',
  ].filter(Boolean)

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
            {!c.isActive && <span className="text-xs text-gray-400 shrink-0">inactive</span>}
            {c.category.toLowerCase() === 'lead' && c.leadStatus && (
              <span className={`px-1.5 py-0.5 rounded-full text-xs font-medium shrink-0 ${leadStatusColor(c.leadStatus)}`}>
                {c.leadStatus}
              </span>
            )}
            {/* Tags are squared and #-prefixed so they read as a different
                class of object from the fully-round status pill beside them.
                Both were rounded-full and hue-coded, and since tag hues come
                from a hash they can land on the same colour as a status —
                a violet pill could be "Proposal Sent" or the tag "Referral". */}
            {(c.tags ?? []).slice(0, 2).map(tag => (
              <span key={tag} className={`px-1.5 py-0.5 rounded text-xs font-medium shrink-0 ${tagColor(tag)}`}>#{tag}</span>
            ))}
            {(c.tags ?? []).length > 2 && (
              <span className="text-xs text-gray-400 shrink-0">+{c.tags.length - 2}</span>
            )}
          </div>
          {/* Each subtitle field truncates in its own box rather than the whole
              line being one joined string. Before, a long person name could eat
              the location and the assignee entirely, and because it clipped
              mid-token you couldn't tell which field you'd lost. Now every
              field always shows its beginning. The global `* { min-width: 0 }`
              reset in index.css is what lets these flex children shrink. */}
          {subtitleParts.length > 0 && (
            <div className="flex items-center gap-1.5 text-sm text-gray-400">
              {subtitleParts.map((part, i) => (
                <Fragment key={i}>
                  {i > 0 && <span aria-hidden className="shrink-0">·</span>}
                  <span className="truncate">{part}</span>
                </Fragment>
              ))}
            </div>
          )}
        </div>
        {/* Leads get a fixed-width column so the two numeric readouts land in
            the same place on every row. Without it the column's width floated
            with the amount string and the score label ("Hot" vs "Cold"), so
            nothing aligned vertically and the subtitle's truncation point moved
            row to row. Left auto for the other categories, whose clusters hold
            different content. */}
        <div className={`shrink-0 text-right flex flex-col items-end gap-1 self-start ${c.category.toLowerCase() === 'lead' ? 'w-40' : ''}`}>
          {/* One amount for every category. Customers used to render their own
              copy outside the link, which meant clicking a customer's amount
              did nothing while clicking a lead's navigated. */}
          {/* Not for employees: the form puts Amount inside a !isEmployee
              section, so a value on a staff record is legacy import data with
              no defined meaning — and it rendered in the same slot, with the
              same styling, as a lead's deal value. */}
          {c.amount > 0 && lowerCat !== 'employee' && (
            <p className="text-sm font-semibold text-white tabular-nums">{formatCurrency(c.amount)}</p>
          )}
          {c.category.toLowerCase() === 'customer' && (
            // rounded-md to match the lead score chip: both are computed
            // quality readouts, so they share a silhouette. The number is shown
            // for the same reason it is on leads — the four labels span
            // 20-point bands, so 60 and 79 both read "Good".
            health ? (
              <span
                title={healthBreakdown(health)}
                className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-xs font-semibold border cursor-help ${health.badgeClass}`}
              >
                <span className={`w-1 h-1 rounded-full ${health.dotClass}`} />
                {health.label}
                <span className="tabular-nums font-bold">{health.score}</span>
              </span>
            ) : (
              // Holds the slot while invoices and plans load, so rows don't
              // reflow and no wrong label derived from partial data is shown.
              <span className="inline-block h-[1.125rem] w-20 rounded-md bg-gray-700/50 animate-pulse" />
            )
          )}
          {/* Payment state as a readout, not an action. Previously the row
              rendered a green "$ Paid" *button* only when the customer had NOT
              paid — so green signalled unpaid, and a customer who had paid
              showed no payment indicator at all. Both states are now shown,
              with the colour matching the meaning. rounded-md keeps it in the
              same family as the health chip beside it. */}
          {c.category.toLowerCase() === 'customer' && (
            // Plain text, not a filled chip: the health badge beside it is the
            // graded primary readout, and a second tinted pill competed with it
            // for the same hues. Emphasis sits on the exception — unpaid gets
            // amber and weight, paid stays quiet — the same way deal age is
            // handled on /leads.
            <span
              className={`text-xs ${
                c.paymentStatus === 'Paid'
                  ? 'text-gray-400 font-normal'
                  : 'text-amber-400 font-semibold'
              }`}
            >
              {c.paymentStatus === 'Paid' ? 'Paid' : c.paymentStatus || 'Unpaid'}
            </span>
          )}
          {lowerCat === 'vendor' && (() => {
            const { callbackFlag } = vendorFields(c)
            const rating = Number(c.rate)
            const hasRating = c.rate.trim() !== '' && Number.isFinite(rating)
            if (!hasRating && !callbackFlag.trim()) return null
            return (
              // The sidebar can filter vendors by rating and by the callback
              // flag, but neither appeared anywhere in the row — filtering
              // acted on data the list never showed.
              <div className="flex items-center justify-end gap-2 text-xs">
                {hasRating && (
                  <span className="inline-flex items-center gap-0.5 tabular-nums text-gray-300">
                    {rating}
                    <Icon d={ICONS.star} className="w-3 h-3 icon-star" />
                  </span>
                )}
                {callbackFlag.trim() && (
                  <span className={callbackFlag.toLowerCase() === 'yes' ? 'text-amber-400 font-semibold' : 'text-gray-400'}>
                    Callback {callbackFlag.toLowerCase() === 'yes' ? 'Yes' : 'No'}
                  </span>
                )}
              </div>
            )
          })()}
          {c.category.toLowerCase() === 'lead' && (
            <div className="flex items-center justify-end gap-2 w-full">
              {/* Score keeps its temperature hue but goes squared-with-a-dot,
                  so it can't be mistaken for the round status pill. The number
                  is shown because the four labels span 20-point buckets — a 70
                  and a 100 both read "Hot" — and because Sort By › Score
                  already orders on it, so without it the sort looks arbitrary.
                  The tooltip surfaces the per-factor breakdown. */}
              {(() => {
                const ls = scoreLead(c)
                return (
                  <span
                    title={scoreBreakdown(ls)}
                    className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-xs font-semibold border cursor-help ${ls.badgeClass}`}
                  >
                    <span className={`w-1 h-1 rounded-full ${ls.dotClass}`} />
                    {ls.label}
                    <span className="tabular-nums font-bold">{ls.score}</span>
                  </span>
                )
              })()}
              {/* Age drops the pill shape entirely: dealAgeClasses only returns
                  a text treatment, so wrapping it in px/py/rounded-full
                  rendered a pill silhouette with no fill next to genuinely
                  filled ones. Plain tabular-nums text reads as the number it
                  is. No font-weight here — dealAgeClasses owns it, so the
                  weight ramp isn't fighting a fixed font-medium. */}
              {(() => {
                const days = dealAgeDays(c)
                return (
                  <span className={`text-xs tabular-nums shrink-0 w-10 text-right ${dealAgeClasses(days)}`}>
                    {days}d
                  </span>
                )
              })()}
            </div>
          )}
        </div>
      </Link>
      {/* Trailing action slot. Only real buttons live out here — an <a> can't
          contain interactive content, which is the whole reason the customer
          and employee clusters were ever outside the link. The readouts that
          came along for the ride (amount, health badge) are back inside it. */}
      {/* A verb label and the app's quiet toolbar treatment, so this reads as
          an action rather than a second status chip. The old "$ Paid" was a
          green tinted pill — visually identical to the readouts beside it,
          while actually writing to Firestore on a single click. */}
      {c.category.toLowerCase() === 'customer' && c.paymentStatus !== 'Paid' && (
        <button
          type="button"
          onClick={() => { void setPaymentStatus(c.id, 'Paid') }}
          title={`Mark ${displayName(c)} as paid`}
          className="shrink-0 self-start text-xs font-medium leading-none px-2 py-1.5 rounded-md bg-gray-800 border border-gray-700 text-gray-400 hover:text-gray-200 transition-colors"
        >
          Mark paid
        </button>
      )}
      {c.category.toLowerCase() === 'employee' && (() => {
        // Never invent a status. An empty employeeStatus used to render as
        // "Active", so a record with isActive:false showed the word "inactive"
        // beside its name and an "Active" badge on the same row. Falling back
        // to isActive means the two can't contradict each other.
        const status = effectiveEmployeeStatus(c)
        return (
          // A select, not a badge that cycles on click. The old control looked
          // exactly like the status readouts around it while rewriting the
          // record on a single click, and reaching a specific value took up to
          // two clicks with no way back if you overshot. A select is visibly a
          // control, lands on any value in one action, and is keyboard
          // reachable. Colour still carries the status.
          <select
            value={status}
            onChange={e => {
              const nextStatus = e.target.value
              void setEmployeeStatus(c.id, nextStatus, nextStatus !== 'Inactive')
            }}
            aria-label={`Employment status for ${displayName(c)}`}
            className={`shrink-0 self-start text-xs font-medium leading-none pl-2 pr-1 py-1.5 rounded-md border bg-gray-800 cursor-pointer outline-none focus:border-indigo-500 ${employeeStatusClasses(status)}`}
          >
            {EMPLOYEE_STATUS_CYCLE.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        )
      })()}
    </div>
  )
}

const EMPLOYEE_STATUS_CYCLE = ['Active', 'On Leave', 'Inactive']

/** The status to display when the field is unset. `isActive` is the only other
 *  signal available, and deriving from it guarantees the badge can't disagree
 *  with the "inactive" marker beside the name. */
function effectiveEmployeeStatus(c: CustomerItem): string {
  return c.employeeStatus || (c.isActive ? 'Active' : 'Inactive')
}


function employeeStatusClasses(status: string): string {
  switch (status) {
    case 'On Leave': return 'bg-amber-600/20 text-amber-400 border-amber-700/30 hover:bg-amber-600/30'
    case 'Inactive':  return 'bg-gray-600/20 text-gray-400 border-gray-700/30 hover:bg-gray-600/30'
    default:          return 'bg-green-600/20 text-green-400 border-green-700/30 hover:bg-green-600/30'
  }
}

function UserAssignInput({
  onAssign,
}: {
  onAssign: (uid: string, displayName: string) => void
}) {
  const [salesmen, setSalesmen] = useState<TeamMember[] | null>(null)

  useEffect(() => {
    fetchSalesmenForCompany().then(setSalesmen).catch(() => setSalesmen([]))
  }, [])

  if (salesmen === null) {
    return <div className="p-3 text-xs text-gray-400">Loading team…</div>
  }
  if (salesmen.length === 0) {
    return (
      <div className="p-3 text-xs text-gray-400">
        No salesmen on your team yet. Invite one from Team settings.
      </div>
    )
  }
  return (
    <div className="p-2 space-y-1">
      {salesmen.map(m => (
        <button
          key={m.uid}
          onClick={() => onAssign(m.uid, memberDisplayName(m))}
          className="w-full text-left px-3 py-2 text-sm text-gray-200 hover:bg-gray-700 rounded-lg transition-colors"
        >
          {memberDisplayName(m)}
        </button>
      ))}
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
          className="flex-1 bg-gray-900 border border-gray-700 rounded-lg px-2 py-1.5 text-xs text-white placeholder-gray-400 outline-none focus:border-indigo-500"
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
          <button onClick={onClose} className="text-gray-400 hover:text-gray-200 transition-colors">
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
            <label className="block text-xs text-gray-400 mb-1.5">Subject</label>
            <input
              type="text"
              value={subject}
              onChange={e => setSubject(e.target.value)}
              required
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 outline-none focus:border-indigo-500 placeholder-gray-400"
              placeholder="Email subject…"
            />
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1.5">Body</label>
            <textarea
              value={body}
              onChange={e => setBody(e.target.value)}
              required
              rows={7}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 outline-none focus:border-indigo-500 placeholder-gray-400 resize-none"
              placeholder="Write your message…"
            />
            <p className="text-xs text-gray-400 mt-1">
              Merge tags: <span className="text-gray-400 font-mono">{'{first}'}</span> <span className="text-gray-400 font-mono">{'{lastname}'}</span> <span className="text-gray-400 font-mono">{'{city}'}</span> <span className="text-gray-400 font-mono">{'{salesman}'}</span>
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
