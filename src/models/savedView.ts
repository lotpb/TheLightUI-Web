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
  }
}
