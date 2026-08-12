import { create } from 'zustand'
import { fetchPickerLists, savePickerLists, type PickerLists, type PickerLabels, DEFAULT_LABELS } from '../services/pickerService'

interface PickerState {
  lists: PickerLists
  labels: PickerLabels
  loaded: boolean
  fetch: () => Promise<void>
  save: (lists: PickerLists) => Promise<void>
}

const STORAGE_KEY = 'thelight.pickerLists'

function loadCached(): PickerLists {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw) as PickerLists
  } catch { /* ignore */ }
  return { salesman: [], job: [], product: [], advertiser: [], contractor: [] }
}

function persistCache(lists: PickerLists) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(lists)) } catch { /* ignore */ }
}

function mergeLabels(lists: PickerLists): PickerLabels {
  return { ...DEFAULT_LABELS, ...lists.labels }
}

const cached = loadCached()

export const usePickerStore = create<PickerState>((set) => ({
  lists:  cached,
  labels: mergeLabels(cached),
  loaded: false,

  fetch: async () => {
    const lists = await fetchPickerLists()
    persistCache(lists)
    set({ lists, labels: mergeLabels(lists), loaded: true })
  },

  save: async (lists) => {
    persistCache(lists)
    set({ lists, labels: mergeLabels(lists) })
    await savePickerLists(lists)
  },
}))

export const RATE_OPTIONS = ['5', '4', '3', '2', '1']
export const CALLBACK_OPTIONS = ['', 'Yes']
export const CATEGORY_OPTIONS = ['', 'Lead', 'Customer', 'Vendor', 'Employee']
