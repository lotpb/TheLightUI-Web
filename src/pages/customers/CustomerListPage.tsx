import { useEffect, useMemo, useRef, useState, useCallback, type ReactNode } from 'react'
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
import { leadStatusColor, LEAD_STATUS_OPTIONS, isCanonicalLeadStatus } from '../../utils/leadStatusColor'
import { dealAgeDays, dealAgeClasses } from '../../utils/dealLength'
import { scoreLead, scoreBreakdown, SCORE_BANDS, scoreBandRange } from '../../utils/leadScore'
import { mergeTags, unknownTags, MERGE_TAGS } from '../../utils/mergeTags'
import { calculateHealthScore, healthBreakdown, HEALTH_BANDS, healthBandRange, type CustomerHealth, type HealthLabel } from '../../utils/customerHealth'
import { useSharedInvoices, useSharedServicePlans } from '../../hooks/useSharedCollections'
import CSVImportModal from '../../components/CSVImportModal'
import ConfirmModal from '../../components/ConfirmModal'
import { Icon, ICONS } from '../../components/Icon'
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

/**
 * What the right-hand cluster on each row holds, in the order it renders.
 *
 * Every row carried up to three right-aligned figures — an amount, a 0–100
 * score and a status word — in a 1024px-wide layout whose only header row said
 * "Select page". Nothing on the page said what a bare `72` was: a score, a
 * count, a percentage, a day count. Hidden below sm, where the cluster itself
 * is the only thing left of it.
 */
const CLUSTER_LEGEND: Record<CustomerCategory, string> = {
  // "Days open", not "Age": the number is days since creationDate, and sitting
  // beside a score chip it read equally well as days since last contact.
  Lead:     'Amount · Score · Days open',
  Customer: 'Amount · Health · Payment',
  Vendor:   'Amount · Rating · Callback',
  Employee: 'Employment status',
}

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


/**
 * The surface shared by the Views / Filters / Tag triggers.
 *
 * All three were hand-rolled `bg-gray-800 border-gray-700` — one step darker
 * than both the `.input-field` search box they sit beside and the
 * `.btn-secondary` Sort/Actions buttons directly above, which put three surface
 * treatments inside a single two-row control cluster for no semantic reason.
 * They now carry btn-secondary's fill. The border is present in both states so
 * activating one doesn't change its geometry.
 */
const TRIGGER_BASE = 'px-3 py-2 text-sm font-medium border transition-colors flex items-center gap-1.5'
const TRIGGER_IDLE = 'bg-gray-700 border-gray-700 text-gray-100 hover:bg-gray-600'
const TRIGGER_ON   = 'bg-indigo-600/20 border-indigo-500/50 text-indigo-300'

/**
 * The number on a filter trigger. There were two treatments eight pixels apart
 * — Views used `bg-gray-700 text-gray-300`, Filters `bg-indigo-500 text-white`
 * — for what reads as one affordance. One component now, with the distinction
 * stated rather than accidental: indigo means "this many filters are changing
 * the list in front of you", neutral means "this many of these exist".
 */
function CountBadge({ value, tone }: { value: number; tone: 'state' | 'inventory' }) {
  return (
    <span
      className={`text-xs font-bold px-1.5 py-0.5 rounded-full leading-none tabular-nums ${
        tone === 'state' ? 'bg-indigo-500 text-white' : 'bg-gray-600 text-gray-100'
      }`}
    >
      {value}
    </span>
  )
}

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

/**
 * The Common Filters sidebar shell.
 *
 * Below lg this stacks above the record list (`order-first`), where fully
 * expanded it measures about 636px — the Customer sidebar alone is fourteen
 * full-width buttons plus three group titles — so on a phone, or an iPad in
 * portrait, there was no record on screen at all until you scrolled past every
 * filter. It's a disclosure there, collapsed by default, and always open at lg
 * where it has its own 208px column beside the list.
 */
function QuickFilterPanel({ open, onToggle, activeCount, children }: {
  open: boolean
  onToggle: () => void
  activeCount: number
  children: ReactNode
}) {
  return (
    <div className="w-full lg:w-52 shrink-0 card p-3 order-first lg:order-none">
      {/* Reports how many of its own filters are on, so collapsing it can
          never hide an active filter without saying so. */}
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="lg:hidden w-full flex items-center gap-2 px-1 py-1 rounded text-xs font-bold uppercase tracking-wider text-gray-200
                   focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
      >
        <Icon d={ICONS.funnel} className="w-3.5 h-3.5 shrink-0" />
        Common Filters
        {activeCount > 0 && <CountBadge value={activeCount} tone="state" />}
        <span className="flex-1" />
        <Icon d={ICONS.chevronDown} className={`w-4 h-4 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      <p className="hidden lg:block text-xs font-bold uppercase tracking-wider text-gray-200 mb-2 px-1">Common Filters</p>
      <div className={`${open ? 'block' : 'hidden'} lg:block space-y-1 mt-2 lg:mt-0`}>
        {children}
      </div>
    </div>
  )
}

/** A titled group of quick filters, capped so a data-derived list can't grow
 *  the sidebar taller than the record table it sits beside — statuses and
 *  sources come from the records themselves, so imported data can produce
 *  dozens. The active option is always kept visible even when collapsed,
 *  so a filter can never be hidden while it's in effect. */
function QuickFilterGroup({ title, options, activeValue, onSelect, initial = 6, renderLabel }: {
  title: string
  options: string[]
  activeValue: string
  onSelect: (next: string) => void
  initial?: number
  /** Renders the option as something other than plain text — used by the Lead
   *  Status group, where the row shows each status as a hue-coded pill and the
   *  filter for the same value was unstyled grey text. */
  renderLabel?: (option: string) => ReactNode
}) {
  const [expanded, setExpanded] = useState(false)
  const base = options.slice(0, initial)
  const shown = expanded
    ? options
    : activeValue && !base.includes(activeValue) ? [...base, activeValue] : base
  const hiddenCount = options.length - shown.length

  return (
    <>
      {/* .card-section-title: this was text-[10px] while the panel's own
          heading was text-xs, so the sidebar ran two sizes of the same object.
          Same 12px now, separated by weight and colour instead. */}
      <p className="card-section-title pt-2 px-1">{title}</p>
      {shown.map(o => (
        <QuickFilterButton
          key={o}
          label={renderLabel ? renderLabel(o) : o}
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
  const { items: invoices, loading: invoicesLoading, failed: invoicesFailed } = useSharedInvoices(isCustomerView)
  const { items: servicePlans, loading: plansLoading, failed: plansFailed } = useSharedServicePlans(isCustomerView)

  // Three states, not two. `healthReady` alone conflated "still loading" with
  // "will never arrive", and the badge's placeholder is an animate-pulse — so a
  // listener that never resolved left a grey pulse on every row indefinitely
  // and the page read as permanently loading. A failed load now renders no
  // badge, never a score derived from absent invoices.
  const healthFailed  = isCustomerView && (invoicesFailed || plansFailed)
  const healthLoading = isCustomerView && !healthFailed && (invoicesLoading || plansLoading)
  const healthReady   = isCustomerView && !healthLoading && !healthFailed

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
  // On the page, not in the modal: Escape and Cancel close the dialog, and a
  // draft that evaporates on a stray keypress is its own reason not to use a
  // confirmation step. Reopening restores what was typed.
  const [emailDraft, setEmailDraft] = useState({ subject: '', body: '' })
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
  // Below lg the Common Filters sidebar stacks above the list (order-first),
  // where fully expanded it measures ~636px — so on a phone or an iPad in
  // portrait there was no record on screen at all until you scrolled past it.
  // Collapsed by default there, always open at lg where it has its own column.
  const [quickFiltersOpen, setQuickFiltersOpen] = useState(false)
  const [filterSalesman, setFilterSalesman] = useState('')
  // Seeded from ?state=, alongside the ?q= this page already accepted, so
  // /heatmap can hand off a place. It arrives as the grouping key (uppercase),
  // which is why the comparison below is case-insensitive.
  const [filterState, setFilterState]       = useState(() => searchParams.get('state') ?? '')
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
  const [confirmDeactivate, setConfirmDeactivate] = useState(false)
  const [deleteViewTarget, setDeleteViewTarget] = useState<SavedView | null>(null)
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

  /** Only the nine fields the Filters panel actually renders, so its own
   *  "Clear all" can't reach into the sidebar's state. */
  function clearPanelFilters() {
    setFilterSalesman('')
    setFilterState('')
    setFilterCallback('')
    setFilterDateFrom('')
    setFilterDateTo('')
    setFilterAmtMin('')
    setFilterAmtMax('')
    // Source and Product belong to the sidebar on /leads, so this button
    // mustn't reach them there — the whole point of the panel/sidebar split is
    // that each surface clears only what it shows.
    if (cat !== 'Lead') {
      setFilterLeadSource('')
      setFilterProduct('')
    }
  }

  /** Everything the list narrows on — including the tag and the search box,
   *  which the empty state's "Clear filters" used to leave in place. */
  function clearAllFilters() {
    clearAdvancedFilters()
    setTagFilter(null)
    setSearch('')
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

  // Was a bare await: no confirmation, no error handling, behind a hover-only
  // control. A saved view is shared configuration, and this was the least
  // protected destructive action on the page.
  async function handleDeleteView(view: SavedView) {
    setDeleteViewTarget(null)
    try {
      await deleteSavedView(view.id)
      toast(`Deleted view "${view.name}".`, 'success')
    } catch {
      toast('Could not delete that view.', 'error')
    }
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

  // Asks first. This hides every selected record from the list, and with
  // "Select all" one button to its left the selection can be thousands of
  // records — yet it sat in the same grey treatment as Export, which changes
  // nothing. The single-record equivalent on /records/:id already confirms.
  async function handleBulkDeactivate() {
    const ids = [...selectedIds]
    setConfirmDeactivate(false)
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

  // Both were `void setX(...)` inside the row — fire-and-forget, so a rejected
  // write left the row showing the new value with no indication it hadn't
  // persisted. Lifted here so they can report through the toast.
  /** Clamped, and scrolls the list back to the top like Prev/Next always did. */
  function goToPage(n: number) {
    const next = Math.min(Math.max(1, n), pageCount)
    setPage(next)
    listTopRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  async function handleMarkPaid(c: CustomerItem) {
    try {
      await setPaymentStatus(c.id, 'Paid')
    } catch {
      toast(`Could not mark ${displayName(c)} as paid.`, 'error')
    }
  }

  async function handleSetEmployeeStatus(c: CustomerItem, status: string) {
    try {
      await setEmployeeStatus(c.id, status, status !== 'Inactive')
    } catch {
      toast(`Could not update ${displayName(c)}'s status.`, 'error')
    }
  }

  // The only bulk handler that didn't report failure, on a page where the other
  // three all do.
  async function handleBulkExport() {
    const toExport = filtered.filter(c => selectedIds.has(c.id))
    try {
      await exportCustomersJSON(toExport)
    } catch {
      toast('Export failed.', 'error')
    }
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

  // Canonical statuses first, in pipeline order, then anything else the data
  // holds. Purely data-derived and alphabetically sorted, this produced
  // "Contacted, Lost, Negotiating, New, Proposal Sent, Qualified, Won" — A–Z
  // across a sequence with a natural order — and promoted an imported
  // "Qualifed" to a filter button indistinguishable from the real ones. Only
  // statuses actually present are listed, so no button can return nothing, and
  // non-canonical values stay reachable at the end rather than being dropped.
  const uniqueLeadStatuses = useMemo<string[]>(() => {
    const present = new Set<string>()
    all.filter(c => categoryMatches(c.category, cat) && c.leadStatus.trim()).forEach(c => present.add(c.leadStatus.trim()))
    const canonical = LEAD_STATUS_OPTIONS.filter(s => present.has(s))
    const extra = [...present].filter(s => !isCanonicalLeadStatus(s)).sort()
    return [...canonical, ...extra]
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

  // Two counts, not one. The Filters button opens a panel holding nine fields;
  // the Common Filters sidebar holds a different ten. Counting them together
  // made the badge read "3" while every select inside the panel said "All" and
  // the panel's own footer claimed "3 filters active" over nothing — and its
  // "Clear all" then cleared state the panel had never shown.
  // Which shared fields the Filters panel renders for this category. These are
  // the same conditions the panel's JSX uses, named once so the counts can't
  // disagree with what's on screen.
  //
  // Source and Product are the two that move: /leads shows them as sidebar
  // groups, every other category shows them as panel selects. Counting them as
  // panel filters unconditionally meant setting Source on /leads incremented
  // the Filters badge while the panel it opened had no Source control — the
  // same mismatch the split was introduced to fix, still live on this route.
  const panelShowsSalesman   = isLeadOrCustomer(cat) && uniqueSalesmen.length > 0
  const panelShowsLeadSource = uniqueLeadSources.length > 0 && cat !== 'Lead'
  const panelShowsProduct    = uniqueProducts.length > 0 && cat !== 'Lead'
  const panelShowsCallback   = isLeadOrCustomer(cat)
  const panelShowsAmount     = cat !== 'Employee'

  const panelFilterCount = [
    panelShowsSalesman ? filterSalesman : '',
    filterState,
    panelShowsLeadSource ? filterLeadSource : '',
    panelShowsProduct ? filterProduct : '',
    panelShowsCallback ? filterCallback : '',
    filterDateFrom, filterDateTo,
    panelShowsAmount ? filterAmtMin : '',
    panelShowsAmount ? filterAmtMax : '',
  ].filter(Boolean).length

  const quickFilterCount = [
    filterLeadStatus, filterQuality, filterAssignment, filterHealth, filterPaymentStatus,
    filterSalesmanFlag, filterProfession, filterRating, filterManager, filterEmployeeStatus,
    panelShowsLeadSource ? '' : filterLeadSource,
    panelShowsProduct ? '' : filterProduct,
  ].filter(Boolean).length

  const activeFilterCount = panelFilterCount + quickFilterCount

  // The tag has its own control and was counted by neither, so a tag-only
  // filter left the record line silent about why the list had shrunk — and sent
  // a zero-result list to the "No customers yet · Add the first one →" empty
  // state on a company with 412 of them.
  const anyFilterActive = activeFilterCount > 0 || !!tagFilter

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
    // Case-insensitive: the dropdown's options come from the data so an exact
    // match served it, but ?state= arrives uppercased from /heatmap, and
    // records spelled "ny" and "NY" were two separate places either way.
    if (filterState) {
      const want = filterState.trim().toLowerCase()
      items = items.filter(c => c.state.trim().toLowerCase() === want)
    }
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
              {/* Reports the sort it's applying. The label was the literal
                  string "Sort By" in every state, so a list ordered by Score
                  descending said nothing about it anywhere on the page — the
                  field and direction existed only inside the open dropdown,
                  while the record line below already names the search term and
                  the filter count. */}
              <span className="text-gray-400">Sort</span>
              {SORT_LABELS[sortField]}
              <Icon
                d={sortDir === 'asc' ? ICONS.arrowUp : ICONS.arrowDown}
                className="w-3 h-3 text-indigo-400 shrink-0"
              />
              <Icon d={ICONS.chevronDown} className={`w-3.5 h-3.5 transition-transform ${sortOpen ? 'rotate-180' : ''}`} />
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
              <Icon d={ICONS.chevronDown} className={`w-3.5 h-3.5 transition-transform ${menuOpen ? 'rotate-180' : ''}`} />
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
              {/* No opacity. These were the faintest text on the page — the
                  inactive counts measured 2.72:1 dark / 2.59:1 light against
                  their own tab, while the label beside them sits at 7.00:1, and
                  the active count at opacity-70 on indigo-600 came to 3.93:1.
                  They're the numbers the record line refers to when it says
                  "23 of 412". Size and weight already subordinate them to the
                  label, so the alpha was buying nothing. */}
              {!loading && categoryCounts[c] > 0 && (
                <span className="text-xs font-bold tabular-nums">
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
            className={`${TRIGGER_BASE} rounded-lg ${viewsOpen ? TRIGGER_ON : TRIGGER_IDLE}`}
          >
            <Icon d={ICONS.eye} className="w-4 h-4" />
            Views
            {savedViews.length > 0 && <CountBadge value={savedViews.length} tone="inventory" />}
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
                      {/* Always visible: opacity-0 group-hover means the
                          control doesn't exist on touch, so a saved view
                          couldn't be deleted at all from a tablet. */}
                      <button
                        onClick={() => setDeleteViewTarget(view)}
                        title="Delete view"
                        aria-label={`Delete view "${view.name}"`}
                        className="shrink-0 p-2 mr-1 rounded text-gray-400 hover:text-red-400 hover:bg-gray-700/50 transition-colors
                                   focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                      >
                        <Icon d={ICONS.close} className="w-3.5 h-3.5" />
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
          className={`${TRIGGER_BASE} rounded-lg ${filterOpen || panelFilterCount > 0 ? TRIGGER_ON : TRIGGER_IDLE}`}
        >
          <Icon d={ICONS.funnel} className="w-4 h-4" />
          Filters
          {/* panelFilterCount, not the page-wide total: this badge belongs to
              the panel this button opens. */}
          {panelFilterCount > 0 && <CountBadge value={panelFilterCount} tone="state" />}
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
              className={`${TRIGGER_BASE} ${
                tagFilter ? 'rounded-l-lg border-r-0' : 'rounded-lg'
              } ${tagFilter ? TRIGGER_ON : TRIGGER_IDLE}`}
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
            {panelShowsSalesman && (
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
            {panelShowsLeadSource && (
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
            {/* Not on /leads: Product joins Source in the Common Filters
                sidebar there, so the two taxonomies a lead is qualified by sit
                on one surface instead of split across two. */}
            {panelShowsProduct && (
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
            {panelShowsCallback && (
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
          {panelShowsAmount && (
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

          {/* Counts and clears this panel's own nine fields. It used to report
              the page-wide total and clear all nineteen, so setting a Health
              filter in the sidebar made the panel announce "1 filter active"
              with every select in it reading "All". */}
          {panelFilterCount > 0 && (
            <div className="flex items-center justify-between pt-1 border-t border-gray-700/50">
              <span className="text-xs text-gray-400">{panelFilterCount} filter{panelFilterCount !== 1 ? 's' : ''} active in this panel</span>
              <button
                onClick={clearPanelFilters}
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
            <Icon d={ICONS.close} className="w-4 h-4" />
          </button>
          <span className="text-sm font-medium text-white">{selectedIds.size} selected</span>
          {selectedIds.size < allFilteredIds.size && (
            <button onClick={selectAll} className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors">
              Select all {filtered.length}
            </button>
          )}
          <div className="flex-1" />
          {/* btn-danger, not the same grey as Export — this is the only button
              in the row that changes records. */}
          <button
            onClick={() => setConfirmDeactivate(true)}
            disabled={bulkWorking}
            className="btn-danger text-sm px-3 py-1.5 disabled:opacity-40"
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
              <Icon d={ICONS.chevronDown} className={`w-3.5 h-3.5 transition-transform ${assignOpen ? 'rotate-180' : ''}`} />
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
          /* States the relationship between the two numbers on screen. The
             category tab badge counts every record in the category, this line
             counted the filtered set — so with filters on the tab said 412 and
             this said 23, same question, two answers, no link between them.
             It also names the search term, because switching category clears
             the advanced filters but keeps the search, so half the query state
             survives navigation and previously did so silently. */
          <p className="text-xs text-gray-400 mb-3">
            {pageCount > 1
              ? `${rangeStart}–${rangeEnd} of ${filtered.length}`
              : `${filtered.length}`}
            {filtered.length !== categoryCounts[cat] && ` of ${categoryCounts[cat]}`}
            {filtered.length === 1 ? ' record' : ' records'}
            {!showInactive && ' · active only'}
            {debouncedSearch.trim() && ` · search "${debouncedSearch.trim()}"`}
            {/* The tag was in neither filter count, so this line stayed silent
                about the one control that had narrowed the list. */}
            {tagFilter && ` · tag "${tagFilter}"`}
            {activeFilterCount > 0 && ` · ${activeFilterCount} filter${activeFilterCount !== 1 ? 's' : ''}`}
          </p>
        )
      )}

      {/* Lead score bands. Same treatment /customers gets for health — the
          thresholds lived only inside scoreLead's if-chain, and scoreBreakdown
          reaches the reader through a `title` tooltip, which doesn't exist on
          touch. Keyed off SCORE_BANDS so the swatch is the chip it explains. */}
      {cat === 'Lead' && !listLoading && filtered.length > 0 && (
        <div className="flex items-center gap-x-3 gap-y-1.5 flex-wrap mb-3 text-xs text-gray-400">
          <span className="font-medium">Score bands:</span>
          {SCORE_BANDS.map((band, i) => (
            <span
              key={band.label}
              className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md font-semibold border ${band.badgeClass}`}
            >
              <span className={`w-1 h-1 rounded-full ${band.dotClass}`} />
              {band.label}
              <span className="tabular-nums font-bold">{scoreBandRange(i)}</span>
            </span>
          ))}
        </div>
      )}

      {/* Health bands, keyed with the chips' own badgeClass so the swatch is
          the thing it explains — the same approach /vendor-scorecards uses for
          its on-time colours. The chip's per-factor breakdown is a `title`
          tooltip, so on touch neither the thresholds nor the reasoning behind
          a "Good 72" existed anywhere on screen. */}
      {cat === 'Customer' && !listLoading && filtered.length > 0 && (
        <div className="flex items-center gap-x-3 gap-y-1.5 flex-wrap mb-3 text-xs text-gray-400">
          <span className="font-medium">Health bands:</span>
          {HEALTH_BANDS.map((band, i) => (
            <span
              key={band.label}
              className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md font-semibold border ${band.badgeClass}`}
            >
              <span className={`w-1 h-1 rounded-full ${band.dotClass}`} />
              {band.label}
              <span className="tabular-nums font-bold">{healthBandRange(i)}</span>
            </span>
          ))}
        </div>
      )}

      {/* Side-by-side only at the width this layout was designed for. The page
          caps at max-w-5xl (1024px), so below lg the 208px sidebar was just
          eating the record list. Stacked, the filters sit above the list
          (order-first) rather than below 50 rows of records. */}
      <div className={hasQuickFilterSidebar ? 'flex flex-col lg:flex-row gap-4 lg:items-start' : ''}>
      <div className={hasQuickFilterSidebar ? 'flex-1 min-w-0' : ''}>
      <div ref={listTopRef} className="card divide-y divide-gray-700/50">
        {/* Header strip. No longer gated on canBulkAction — it carries the
            column legend now, which every role needs, not just the checkbox. */}
        {!listLoading && filtered.length > 0 && (
          <div className="flex items-center gap-3 px-4 py-2 border-b border-gray-700/50 bg-gray-800/30">
            {perms.canBulkAction ? (
              <>
                {/* id + htmlFor: this was a bare checkbox with its label in a
                    sibling span, so it had no accessible name — and it's the
                    control that arms the bulk deactivate. */}
                <input
                  id="select-page"
                  type="checkbox"
                  checked={allPageSelected}
                  onChange={togglePage}
                  className="w-4 h-4 rounded border-gray-600 bg-gray-700 text-indigo-500 cursor-pointer shrink-0"
                />
                <label htmlFor="select-page" className="text-xs text-gray-400 cursor-pointer">
                  {allPageSelected ? 'Deselect page' : 'Select page'}
                </label>
              </>
            ) : (
              <span className="text-xs text-gray-400">Name</span>
            )}
            <div className="flex-1" />
            <span className="hidden sm:block text-xs text-gray-400">{CLUSTER_LEGEND[cat]}</span>
          </div>
        )}
        {listLoading ? (
          Array.from({ length: 6 }).map((_, i) => <SkeletonRow key={i} cat={cat} />)
        ) : filtered.length === 0 ? (
          <div className="px-4 py-8 text-center">
            {/* anyFilterActive includes the tag. Gated on activeFilterCount
                alone, a tag filter that matched nothing routed to the wrong
                branch entirely: a company with 412 customers was told "No
                customers yet" and invited to "Add the first one →", and the
                Clear filters branch was unreachable. */}
            <p className="text-gray-400">
              {search || anyFilterActive
                ? 'No results match those filters'
                : `No ${CATEGORY_LABELS[cat].toLowerCase()} yet`}
            </p>
            {search || anyFilterActive ? (
              <button
                onClick={clearAllFilters}
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
              healthLoading={healthLoading}
              onMarkPaid={() => handleMarkPaid(c)}
              onSetEmployeeStatus={status => handleSetEmployeeStatus(c, status)}
            />
          ))
        )}

        {/* Pagination footer — only shown when there's more than one page */}
        {/* First/last and a jump field. PAGE_SIZE is 50 against a 5,000-record
            cap, so this can be a hundred pages — and "{page} / {pageCount}" was
            a readout, making page 60 a 59-click journey with no way back to the
            end. */}
        {!listLoading && pageCount > 1 && (
          <div className="flex items-center justify-between gap-2 px-4 py-3">
            <div className="flex items-center gap-1">
              <button
                onClick={() => goToPage(1)}
                disabled={page === 1}
                aria-label="First page"
                title="First page"
                className="p-1.5 rounded text-gray-400 hover:text-gray-200 hover:bg-gray-700/50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors
                           focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              >
                <Icon d={ICONS.chevronDoubleLeft} className="w-4 h-4" />
              </button>
              <button
                onClick={() => goToPage(page - 1)}
                disabled={page === 1}
                className="flex items-center gap-1 text-sm text-gray-400 hover:text-gray-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <Icon d={ICONS.chevronLeft} className="w-4 h-4" />
                Prev
              </button>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-gray-400">
              <label htmlFor="page-jump" className="sr-only">Jump to page</label>
              <input
                id="page-jump"
                type="number"
                min={1}
                max={pageCount}
                value={page}
                onChange={e => {
                  const n = parseInt(e.target.value, 10)
                  if (Number.isFinite(n)) goToPage(n)
                }}
                className="input-field w-14 text-xs py-1 text-center tabular-nums"
              />
              <span className="tabular-nums whitespace-nowrap">of {pageCount}</span>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => goToPage(page + 1)}
                disabled={page === pageCount}
                className="flex items-center gap-1 text-sm text-gray-400 hover:text-gray-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                Next
                <Icon d={ICONS.chevronRight} className="w-4 h-4" />
              </button>
              <button
                onClick={() => goToPage(pageCount)}
                disabled={page === pageCount}
                aria-label="Last page"
                title="Last page"
                className="p-1.5 rounded text-gray-400 hover:text-gray-200 hover:bg-gray-700/50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors
                           focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              >
                <Icon d={ICONS.chevronDoubleRight} className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
      </div>
      {cat === 'Employee' && (
        <QuickFilterPanel
          open={quickFiltersOpen}
          onToggle={() => setQuickFiltersOpen(v => !v)}
          activeCount={quickFilterCount}
        >
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
        </QuickFilterPanel>
      )}
      {cat === 'Lead' && (
        <QuickFilterPanel
          open={quickFiltersOpen}
          onToggle={() => setQuickFiltersOpen(v => !v)}
          activeCount={quickFilterCount}
        >

          {/* Titled. The first six buttons were one undifferentiated stack of
              identical chips measuring three unrelated things — visibility,
              assignment, and quality — while everything below them was grouped.
              "Hot Leads" is a score band and "Stale" an age threshold, adjacent
              and indistinguishable; both now say which dimension they're on and
              what their threshold is. */}
          <p className="card-section-title px-1">Show</p>
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

          <p className="card-section-title pt-2 px-1">Assignment</p>
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

          <p className="card-section-title pt-2 px-1">Quality</p>
          <QuickFilterButton
            label={`Hot (score ${SCORE_BANDS[0].min}+)`}
            active={filterQuality === 'hot'}
            onClick={() => setFilterQuality(filterQuality === 'hot' ? '' : 'hot')}
          />
          <QuickFilterButton
            label="Stale (open 30+ days)"
            active={filterQuality === 'stale'}
            onClick={() => setFilterQuality(filterQuality === 'stale' ? '' : 'stale')}
          />

          {/* The pill, not plain text: the row renders each status as a
              hue-coded pill from LEAD_STATUS_COLORS, so "Won" was a green pill
              in the list and unstyled grey text in the control that filters for
              it. initial=7 so all the canonical statuses fit before the cap. */}
          {uniqueLeadStatuses.length > 0 && (
            <QuickFilterGroup
              title="Status"
              options={uniqueLeadStatuses}
              activeValue={filterLeadStatus}
              onSelect={setFilterLeadStatus}
              initial={LEAD_STATUS_OPTIONS.length}
              renderLabel={o => (
                <span className={`inline-block px-1.5 py-0.5 rounded-full text-xs font-medium ${leadStatusColor(o)}`}>
                  {o}
                </span>
              )}
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

          {/* Moved off the Filters panel so Source and Product — the two
              taxonomies a lead is qualified by — sit together. */}
          {uniqueProducts.length > 0 && (
            <QuickFilterGroup
              title="Product"
              options={uniqueProducts}
              activeValue={filterProduct}
              onSelect={setFilterProduct}
            />
          )}
        </QuickFilterPanel>
      )}
      {cat === 'Customer' && (
        <QuickFilterPanel
          open={quickFiltersOpen}
          onToggle={() => setQuickFiltersOpen(v => !v)}
          activeCount={quickFilterCount}
        >

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

          {/* .card-section-title: these were text-[10px] while the panel's own
              heading was text-xs, so the sidebar ran two sizes of the same
              object. Same 12px now, separated by weight and colour instead. */}
          <p className="card-section-title pt-2 px-1">Health</p>
          {/* From HEALTH_BANDS rather than a second hand-written list, so these
              can't drift from the chips or the legend. */}
          {HEALTH_BANDS.map(band => (
            <QuickFilterButton
              key={band.label}
              label={band.label}
              active={filterHealth === band.label}
              onClick={() => setFilterHealth(filterHealth === band.label ? '' : band.label)}
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
        </QuickFilterPanel>
      )}
      {cat === 'Vendor' && (
        <QuickFilterPanel
          open={quickFiltersOpen}
          onToggle={() => setQuickFiltersOpen(v => !v)}
          activeCount={quickFilterCount}
        >

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
              {/* .card-section-title: these were text-[10px] while the panel's own
              heading was text-xs, so the sidebar ran two sizes of the same
              object. Same 12px now, separated by weight and colour instead. */}
          <p className="card-section-title pt-2 px-1">Rating</p>
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
        </QuickFilterPanel>
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
      {emailModalOpen && (() => {
        const withEmail = filtered.filter(c => selectedIds.has(c.id) && c.email?.includes('@'))
        return (
          <BulkEmailModal
            recipientCount={selectedIds.size}
            emailCount={withEmail.length}
            sample={withEmail[0] ?? null}
            draft={emailDraft}
            onDraftChange={setEmailDraft}
            working={bulkWorking}
            onSend={(subject, body) => {
              setEmailModalOpen(false)
              setEmailDraft({ subject: '', body: '' })
              handleBulkEmail(subject, body)
            }}
            onClose={() => setEmailModalOpen(false)}
          />
        )
      })()}

      {/* Bulk deactivate confirmation. This hides every selected record from
          the list, and "Select all" sits one button away, so the selection can
          be thousands. */}
      <ConfirmModal
        isOpen={confirmDeactivate}
        message={`Deactivate ${selectedIds.size} ${selectedIds.size === 1 ? 'record' : 'records'}? They'll be hidden from this list until reactivated.`}
        confirmLabel="Deactivate"
        onConfirm={handleBulkDeactivate}
        onCancel={() => setConfirmDeactivate(false)}
      />

      <ConfirmModal
        isOpen={deleteViewTarget !== null}
        message={deleteViewTarget ? `Delete the saved view "${deleteViewTarget.name}"? This cannot be undone.` : ''}
        confirmLabel="Delete view"
        onConfirm={() => deleteViewTarget && handleDeleteView(deleteViewTarget)}
        onCancel={() => setDeleteViewTarget(null)}
      />
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
  healthLoading = false,
  onMarkPaid,
  onSetEmployeeStatus,
}: {
  customer: CustomerItem
  selected: boolean
  onToggle: () => void
  showCheckbox?: boolean
  /** True only while invoices/plans are genuinely in flight — see the page. */
  healthLoading?: boolean
  /** Both write to Firestore. The row used to `void` the promises, so a
   *  rejected write left the new value on screen with nothing said. The page
   *  owns them now so it can report failure through the toast. */
  onMarkPaid: () => Promise<void>
  onSetEmployeeStatus: (status: string) => Promise<void>
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
              {/* icon-on-solid, not text-white: text-white resolves to the
                  themed --color-white, which is dark navy in light mode, so the
                  check rendered dark-on-indigo there. */}
              <Icon d={ICONS.check} className="w-4 h-4 icon-on-solid" />
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
            {/* Shaped like the tags it stands for. As bare text it was a fifth
                silhouette in a row that already carries a round status pill,
                squared tag chips, a rounded-md score chip and plain-text days —
                and it belongs to the tag group, so it should look like it. */}
            {(c.tags ?? []).length > 2 && (
              <span className="px-1.5 py-0.5 rounded text-xs font-medium shrink-0 bg-gray-700/50 text-gray-400 border border-gray-600">
                +{c.tags.length - 2}
              </span>
            )}
          </div>
          {/* Each subtitle field truncates in its own box rather than the whole
              line being one joined string. Before, a long person name could eat
              the location and the assignee entirely, and because it clipped
              mid-token you couldn't tell which field you'd lost. Now every
              field always shows its beginning. The global `* { min-width: 0 }`
              reset in index.css is what lets these flex children shrink. */}
          {/* Two parts below sm, all of them from sm up.
              `truncate` flex children shrink *proportionally*, so you don't
              lose the last field — you lose a character or two off all of them
              at once. With four parts in the ~73px this column had on a 390px
              phone, each got about 18px: an ellipsis and nothing else. Each
              part is wrapped with its own separator so it hides as a unit. */}
          {subtitleParts.length > 0 && (
            <div className="flex items-center gap-1.5 text-sm text-gray-400">
              {subtitleParts.map((part, i) => (
                <span
                  key={i}
                  className={`flex items-center gap-1.5 min-w-0 ${i >= 2 ? 'hidden sm:flex' : ''}`}
                >
                  {i > 0 && <span aria-hidden className="shrink-0">·</span>}
                  <span className="truncate">{part}</span>
                </span>
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
        {/* sm:w-40, not w-40. The fixed column keeps the two numeric readouts
            landing in the same place on every row, which is worth 160px at
            desktop width — but it was applied at every width, so on a 390px
            phone it reserved 41% of the viewport and left the name and subtitle
            106px to share. Below sm it sizes to its content (~126px). */}
        <div className={`shrink-0 text-right flex flex-col items-end gap-1 self-start ${lowerCat === 'lead' ? 'sm:w-40' : ''}`}>
          {/* One amount for every category. Customers used to render their own
              copy outside the link, which meant clicking a customer's amount
              did nothing while clicking a lead's navigated. */}
          {/* Not for employees: the form puts Amount inside a !isEmployee
              section, so a value on a staff record is legacy import data with
              no defined meaning — and it rendered in the same slot, with the
              same styling, as a lead's deal value. */}
          {/* Leads always reserve this line, empty when there's no amount.
              The cluster is a flex column, so a lead with amount 0 lost its
              first row and slid the score chip and age up 24px — the rows kept
              an even 68px because the name/subtitle block sets the height, so
              the list looked evenly spaced while the chips inside it staggered.
              Sorting by Score is exactly when you scan that column vertically.
              An empty h-5 holds the slot without printing a placeholder. */}
          {lowerCat === 'lead' ? (
            <p className="h-5 text-sm font-semibold text-white tabular-nums">
              {c.amount > 0 ? formatCurrency(c.amount) : ''}
            </p>
          ) : c.amount > 0 && lowerCat !== 'employee' && (
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
            ) : healthLoading ? (
              // Holds the slot while invoices and plans load, so rows don't
              // reflow and no wrong label derived from partial data is shown.
              // Only while genuinely in flight: gated on `health` alone this
              // pulsed forever whenever a listener stalled.
              // w-24, not w-20: the chip it stands in for measures ~93px, so an
              // 80px placeholder reflowed the cluster on arrival.
              <span className="inline-block h-[1.125rem] w-24 rounded-md bg-gray-700/50 animate-pulse" />
            ) : null
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
      {/* Only rendered for the two categories that can put something here, and
          only fixed-width from sm up.
          The flat `w-[5.5rem]` steadied the right edge, but it was
          unconditional: Leads and Vendors can never have a trailing action, so
          they paid 88px plus a 12px gap for an empty div at every width — and
          on a 390px phone that was half of what the name and subtitle had to
          share. Below sm the slot is content-sized, so a paid customer's row
          gives the space back; at sm and up it holds the fixed width, which is
          where the stable right edge actually mattered. */}
      {(lowerCat === 'customer' || lowerCat === 'employee') && (
      <div className="shrink-0 self-start flex justify-end sm:w-[5.5rem]">
      {c.category.toLowerCase() === 'customer' && c.paymentStatus !== 'Paid' && (
        <button
          type="button"
          onClick={() => { void onMarkPaid() }}
          title={`Mark ${displayName(c)} as paid`}
          className="text-xs font-medium leading-none px-2 py-1.5 rounded-md bg-gray-800 border border-gray-700 text-gray-400 hover:text-gray-200 transition-colors
                     focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
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
            onChange={e => { void onSetEmployeeStatus(e.target.value) }}
            aria-label={`Employment status for ${displayName(c)}`}
            className={`text-xs font-medium leading-none pl-2 pr-1 py-1.5 rounded-md border bg-gray-800 cursor-pointer outline-none focus:border-indigo-500 ${employeeStatusClasses(status)}`}
          >
            {EMPLOYEE_STATUS_CYCLE.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        )
      })()}
      </div>
      )}
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

/**
 * The right-hand bars, per category, sized so the skeleton is exactly as tall
 * as the row it stands in for.
 *
 * A single shape can't do this: the cluster holds a different number of lines
 * per category. Customers stack an amount, a health chip and a payment word
 * (20 + 18 + 16 + two 4px gaps = 62px); Leads and Vendors stack an amount over
 * a single chip row (20 + 20 + one gap = 44px); Employees render nothing here
 * at all, because Amount is gated behind !isEmployee and their status control
 * lives in the trailing slot.
 *
 * Sizing every category to the customer's three lines — which is what shipped
 * first — made the skeleton 86px against a 68px lead row, so /leads pulled up
 * 108px over six rows when the data landed. The left-hand bars are 44px
 * (20 + 8 + 16) to match the real name + subtitle block, which is what sets the
 * height once the cluster is empty.
 */
const SKELETON_CLUSTER: Record<CustomerCategory, string[]> = {
  Lead:     ['h-5 w-16', 'h-5 w-28'],
  Customer: ['h-5 w-16', 'h-[1.125rem] w-24', 'h-4 w-12'],
  Vendor:   ['h-5 w-16', 'h-5 w-24'],
  Employee: [],
}

function SkeletonRow({ cat }: { cat: CustomerCategory }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 animate-pulse">
      <div className="w-9 h-9 rounded-full bg-gray-700 shrink-0" />
      <div className="flex-1 space-y-2">
        <div className="h-5 bg-gray-700 rounded w-40" />
        <div className="h-4 bg-gray-700/60 rounded w-28" />
      </div>
      {SKELETON_CLUSTER[cat].length > 0 && (
        <div className="shrink-0 self-start flex flex-col items-end gap-1">
          {SKELETON_CLUSTER[cat].map((bar, i) => (
            <div key={i} className={`${bar} bg-gray-700/60 rounded`} />
          ))}
        </div>
      )}
    </div>
  )
}

/** The server rejects anything above this; the review step says so first. */
const MAX_EMAIL_RECIPIENTS = 500

/**
 * Compose, then review, then send.
 *
 * This fires `bulkSendEmail`, which puts real mail in real customers'
 * inboxes, and it had no confirmation step at all — one press of a button
 * labelled "Send to 412 recipients" and it was done. The Deactivate button
 * eight pixels away, which is reversible and internal, opens a ConfirmModal.
 *
 * The subject also opened prefilled with `'Hi {first}, a message for you'` —
 * a real value, not a placeholder — so `required` was already satisfied and
 * you could send that to the whole list without ever touching the field. It
 * starts empty now, and the review step shows exactly what one recipient
 * will receive, with the merge tags resolved.
 */
function BulkEmailModal({
  recipientCount,
  emailCount,
  sample,
  draft,
  onDraftChange,
  working,
  onSend,
  onClose,
}: {
  recipientCount: number
  emailCount: number
  /** The first selected record with an email — whose message we preview. */
  sample: CustomerItem | null
  draft: { subject: string; body: string }
  onDraftChange: (draft: { subject: string; body: string }) => void
  working: boolean
  onSend: (subject: string, body: string) => void
  onClose: () => void
}) {
  const [step, setStep] = useState<'compose' | 'review'>('compose')
  const titleId = 'bulk-email-title'
  const { subject, body } = draft

  const ready = subject.trim() !== '' && body.trim() !== '' && emailCount > 0
  const overCap = emailCount > MAX_EMAIL_RECIPIENTS
  const strays = useMemo(() => unknownTags(`${subject}\n${body}`), [subject, body])

  const fields = sample
    ? { first: sample.first, lastname: sample.lastname, city: sample.city, salesman: sample.salesman }
    : {}
  const previewSubject = mergeTags(subject, fields)
  const previewBody    = mergeTags(body, fields)

  // Escape and the backdrop step back from review rather than discarding the
  // draft, and the draft lives on the page, so closing and reopening keeps it.
  const dismiss = useCallback(() => {
    if (step === 'review') setStep('compose')
    else onClose()
  }, [step, onClose])

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') dismiss() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [dismiss])

  // Return focus to whatever opened the dialog.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    return () => opener?.focus?.()
  }, [])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={dismiss} />
      {/* Was a plain div: no role, no aria-modal, no Escape, no autofocus —
          the only modal in the app that wasn't a dialog, on the most
          consequential surface in the page. */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative w-full max-w-lg bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl animate-slide-up"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-700/60">
          <h2 id={titleId} className="text-base font-semibold text-white">
            {step === 'compose' ? 'Send email' : 'Review before sending'}
          </h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="p-1.5 -mr-1.5 rounded text-gray-400 hover:text-gray-200 hover:bg-gray-700/50 transition-colors
                       focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          >
            <Icon d={ICONS.close} className="w-5 h-5" />
          </button>
        </div>

        {step === 'compose' ? (
          <form
            onSubmit={e => { e.preventDefault(); if (ready) setStep('review') }}
            className="p-6 space-y-4"
          >
            <div className={`px-3 py-2 rounded-lg text-sm flex items-center gap-2 ${
              emailCount === 0
                ? 'bg-red-900/30 border border-red-700/50 text-red-300'
                : 'bg-indigo-900/30 border border-indigo-700/50 text-indigo-300'
            }`}>
              <Icon d={ICONS.envelope} className="w-4 h-4 shrink-0" />
              {emailCount === 0
                ? `None of the ${recipientCount} selected records have an email address.`
                : `${emailCount} of ${recipientCount} selected record${recipientCount !== 1 ? 's' : ''} have an email address.`}
            </div>

            <div>
              <label htmlFor="bulk-subject" className="block text-xs text-gray-400 mb-1.5">Subject</label>
              <input
                id="bulk-subject"
                type="text"
                autoFocus
                value={subject}
                onChange={e => onDraftChange({ subject: e.target.value, body })}
                required
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 outline-none focus:border-indigo-500 placeholder-gray-400"
                placeholder="Hi {first}, a message for you"
              />
            </div>

            <div>
              <label htmlFor="bulk-body" className="block text-xs text-gray-400 mb-1.5">Body</label>
              <textarea
                id="bulk-body"
                value={body}
                onChange={e => onDraftChange({ subject, body: e.target.value })}
                required
                rows={7}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 outline-none focus:border-indigo-500 placeholder-gray-400 resize-none"
                placeholder="Write your message…"
              />
              <p className="text-xs text-gray-400 mt-1">
                Merge tags:{' '}
                {MERGE_TAGS.map(t => (
                  <code key={t} className="font-mono text-indigo-300 mr-1.5">{`{${t}}`}</code>
                ))}
              </p>
            </div>

            <div className="flex gap-3 pt-1">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 py-2 rounded-xl border border-gray-700 text-sm text-gray-300 hover:text-gray-100 hover:border-gray-600 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!ready}
                className="flex-1 py-2 rounded-xl bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Review
              </button>
            </div>
          </form>
        ) : (
          <div className="p-6 space-y-4">
            <div className="px-3 py-2 rounded-lg text-sm bg-amber-900/25 border border-amber-600/40 text-amber-200 flex items-start gap-2">
              <Icon d={ICONS.warning} className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                This sends immediately to <strong className="tabular-nums">{emailCount}</strong>{' '}
                customer{emailCount !== 1 ? 's' : ''} and cannot be recalled.
                {recipientCount > emailCount && (
                  <> {recipientCount - emailCount} selected record{recipientCount - emailCount !== 1 ? 's have' : ' has'} no email and will be skipped.</>
                )}
              </span>
            </div>

            {overCap && (
              <div className="px-3 py-2 rounded-lg text-sm bg-red-900/30 border border-red-700/50 text-red-300 flex items-start gap-2">
                <Icon d={ICONS.warning} className="w-4 h-4 shrink-0 mt-0.5" />
                {/* The server throws above 500 and the UI never mentioned it,
                    so a large selection failed only after you pressed Send. */}
                <span>Maximum {MAX_EMAIL_RECIPIENTS} recipients per send. Narrow the selection and try again.</span>
              </div>
            )}

            {strays.length > 0 && (
              <div className="px-3 py-2 rounded-lg text-sm bg-amber-900/25 border border-amber-600/40 text-amber-200 flex items-start gap-2">
                <Icon d={ICONS.warning} className="w-4 h-4 shrink-0 mt-0.5" />
                <span>
                  {strays.map(t => <code key={t} className="font-mono mr-1">{t}</code>)}
                  {strays.length === 1 ? 'is not a merge tag' : 'are not merge tags'} and will be sent as written.
                </span>
              </div>
            )}

            <div>
              <p className="text-xs text-gray-400 mb-1.5">
                {sample
                  ? <>What {(fullName(sample) || sample.email).trim()} will receive</>
                  : 'Preview'}
              </p>
              <div className="rounded-lg border border-gray-700 bg-gray-800 overflow-hidden">
                <p className="px-3 py-2 text-sm font-semibold text-gray-100 border-b border-gray-700 break-words">
                  {previewSubject || <span className="text-gray-400 font-normal">(no subject)</span>}
                </p>
                <p className="px-3 py-2 text-sm text-gray-200 whitespace-pre-wrap max-h-48 overflow-y-auto break-words">
                  {previewBody}
                </p>
              </div>
              {!sample && (
                <p className="text-xs text-gray-400 mt-1">
                  No sample record available, so merge tags are shown unresolved.
                </p>
              )}
            </div>

            <div className="flex gap-3 pt-1">
              <button
                type="button"
                onClick={() => setStep('compose')}
                disabled={working}
                className="flex-1 py-2 rounded-xl border border-gray-700 text-sm text-gray-300 hover:text-gray-100 hover:border-gray-600 transition-colors disabled:opacity-40"
              >
                Back
              </button>
              <button
                type="button"
                autoFocus
                onClick={() => onSend(subject, body)}
                disabled={working || !ready || overCap}
                className="flex-1 py-2 rounded-xl bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {working ? 'Sending…' : `Send ${emailCount} email${emailCount !== 1 ? 's' : ''}`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
