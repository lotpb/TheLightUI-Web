/**
 * Everything the list narrows on — all nineteen filters, not nine.
 *
 * The ten Common Filters were absent, and applySavedView cleared them to
 * compensate. So filtering to "at-risk customers assigned to Ann" and saving
 * it stored only "assigned to Ann": applying it later dropped the Health
 * filter and showed a larger set, with the save toast confirming the name and
 * saying nothing about what had been left out.
 *
 * Legacy documents lack the new keys; they parse as empty, which reproduces
 * exactly what those views did before.
 */
export interface SavedViewFilters {
  search: string
  showInactive: boolean
  tagFilter: string | null
  sortField: string
  sortDir: string
  filterSalesman: string
  filterState: string
  filterLeadSource: string
  filterProduct: string
  filterCallback: string
  filterDateFrom: string
  filterDateTo: string
  filterAmtMin: string
  filterAmtMax: string
  // ── Common Filters (the sidebar) ──
  filterLeadStatus: string
  filterQuality: string
  filterAssignment: string
  filterHealth: string
  filterPaymentStatus: string
  filterSalesmanFlag: string
  filterProfession: string
  filterRating: string
  filterManager: string
  filterEmployeeStatus: string
}

export interface SavedView {
  id: string
  companyId: string
  category: string   // 'Lead' | 'Customer' | 'Vendor' | 'Employee'
  name: string
  filters: SavedViewFilters
  createdAt: Date
}

export function emptySavedViewFilters(): SavedViewFilters {
  return {
    search: '',
    showInactive: false,
    tagFilter: null,
    sortField: 'name',
    sortDir: 'asc',
    filterSalesman: '',
    filterState: '',
    filterLeadSource: '',
    filterProduct: '',
    filterCallback: '',
    filterDateFrom: '',
    filterDateTo: '',
    filterAmtMin: '',
    filterAmtMax: '',
    filterLeadStatus: '',
    filterQuality: '',
    filterAssignment: '',
    filterHealth: '',
    filterPaymentStatus: '',
    filterSalesmanFlag: '',
    filterProfession: '',
    filterRating: '',
    filterManager: '',
    filterEmployeeStatus: '',
  }
}
