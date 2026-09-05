import { useEffect, useMemo, useState } from 'react'
import { usePageTitle } from '../../hooks/usePageTitle'
import {
  subscribeToCatalog, addCatalogItem, updateCatalogItem, deleteCatalogItem, adjustStock,
} from '../../services/catalogService'
import type { CatalogItem } from '../../models/catalogItem'
import { UNIT_OPTIONS, stockLevel, STOCK_LEVEL_LABELS, STOCK_LEVEL_COLORS } from '../../models/catalogItem'
import { useAuthStore } from '../../stores/authStore'
import { useToast } from '../../components/Toast'
import { formatCurrencyPrecise } from '../../models/customer'
import { Icon, ICONS } from '../../components/Icon'

const EMPTY_FORM = {
  name: '', description: '', price: '', unit: 'each', category: '',
  trackInventory: false, stockQty: '0', lowStockThreshold: '5',
}

type FormState = typeof EMPTY_FORM

/** Name or price, within each category group. */
type SortKey = 'name' | 'price'

/** The group that holds everything without a category, pinned last. */
const UNCATEGORIZED = 'Uncategorized'

function ItemForm({
  initial, embedded, onSave, onCancel,
}: {
  initial?: CatalogItem
  /** Drops the card chrome for use inside a list row, which is already a card. */
  embedded?: boolean
  onSave: (f: FormState) => Promise<void>
  onCancel: () => void
}) {
  const [form, setForm]   = useState<FormState>(
    initial
      ? {
          name: initial.name, description: initial.description, price: String(initial.price),
          unit: initial.unit, category: initial.category,
          trackInventory: initial.trackInventory,
          stockQty: String(initial.stockQty),
          lowStockThreshold: String(initial.lowStockThreshold),
        }
      : EMPTY_FORM,
  )
  const [saving, setSaving] = useState(false)

  function set<K extends keyof FormState>(field: K, value: FormState[K]) {
    setForm(f => ({ ...f, [field]: value }))
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim()) return
    setSaving(true)
    try { await onSave(form) } finally { setSaving(false) }
  }

  return (
    <form
      onSubmit={submit}
      className={embedded ? 'space-y-3' : 'card p-4 space-y-3 border border-indigo-500/30'}
    >
      {!embedded && <p className="text-sm font-semibold text-white">New Item</p>}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-gray-400 mb-1 block">Name *</label>
          <input
            autoFocus
            type="text"
            value={form.name}
            onChange={e => set('name', e.target.value)}
            placeholder="e.g. Standard Installation"
            className="input-field w-full text-sm py-1.5"
            required
          />
        </div>
        <div>
          <label className="text-xs text-gray-400 mb-1 block">Category</label>
          <input
            type="text"
            value={form.category}
            onChange={e => set('category', e.target.value)}
            placeholder="e.g. Labor, Materials"
            className="input-field w-full text-sm py-1.5"
          />
        </div>
        <div>
          <label className="text-xs text-gray-400 mb-1 block">Default Price</label>
          <input
            type="number"
            min="0"
            step="0.01"
            value={form.price}
            onChange={e => set('price', e.target.value)}
            placeholder="0.00"
            className="input-field w-full text-sm py-1.5"
          />
        </div>
        <div>
          <label className="text-xs text-gray-400 mb-1 block">Unit</label>
          <select
            value={form.unit}
            onChange={e => set('unit', e.target.value)}
            className="input-field w-full text-sm py-1.5"
          >
            {UNIT_OPTIONS.map(u => (
              <option key={u} value={u}>{u}</option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className="text-xs text-gray-400 mb-1 block">Description</label>
          <input
            type="text"
            value={form.description}
            onChange={e => set('description', e.target.value)}
            placeholder="Short description shown on invoices…"
            className="input-field w-full text-sm py-1.5"
          />
        </div>
      </div>

      <div className="border-t border-gray-700/40 pt-3">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={form.trackInventory}
            onChange={e => set('trackInventory', e.target.checked)}
            className="w-3.5 h-3.5 rounded accent-indigo-500"
          />
          <span className="text-sm text-gray-300">Track inventory for this item</span>
        </label>
        {form.trackInventory && (
          <div className="grid grid-cols-2 gap-3 mt-3">
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Stock Quantity</label>
              <input
                type="number" min="0"
                value={form.stockQty}
                onChange={e => set('stockQty', e.target.value)}
                className="input-field w-full text-sm py-1.5"
              />
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Low Stock Threshold</label>
              <input
                type="number" min="0"
                value={form.lowStockThreshold}
                onChange={e => set('lowStockThreshold', e.target.value)}
                className="input-field w-full text-sm py-1.5"
              />
              {/* A threshold of 0 silently disables the warning for this item,
                  since stockLevel only reports 'low' at or below it. */}
              {form.trackInventory && parseInt(form.lowStockThreshold) === 0 && (
                <p className="text-xs text-gray-400 mt-1">0 means never warn about low stock.</p>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="flex gap-2 pt-1">
        <button type="button" onClick={onCancel} className="btn-secondary text-sm px-4 py-1.5">Cancel</button>
        <button
          type="submit"
          disabled={saving || !form.name.trim()}
          className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-500 disabled:opacity-40 transition-colors"
        >
          {saving && <span className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />}
          {initial ? 'Save Changes' : 'Add Item'}
        </button>
      </div>
    </form>
  )
}

export default function CatalogPage() {
  usePageTitle('Product Catalog')
  const companyId  = useAuthStore(s => s.companyId)
  const toast      = useToast()

  const [items, setItems]     = useState<CatalogItem[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch]   = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [editId, setEditId]   = useState<string | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [lowOnly, setLowOnly] = useState(false)

  useEffect(() => {
    const unsub = subscribeToCatalog(
      its => { setItems(its); setLoading(false) },
      ()  => setLoading(false),
    )
    return unsub
  }, [companyId])

  const lowStockItems = useMemo(
    () => items.filter(i => { const lvl = stockLevel(i); return lvl === 'low' || lvl === 'out' }),
    [items],
  )

  // Only honoured while there's something low. Otherwise restocking the last
  // item would hide the banner — and with it the "Show all" button — leaving the
  // filter stuck on and the list permanently empty with no way back.
  const lowFilterActive = lowOnly && lowStockItems.length > 0

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    let out = items
    if (lowFilterActive) {
      const lowIds = new Set(lowStockItems.map(i => i.id))
      out = out.filter(i => lowIds.has(i.id))
    }
    if (!q) return out
    return out.filter(i =>
      i.name.toLowerCase().includes(q) ||
      i.description.toLowerCase().includes(q) ||
      i.category.toLowerCase().includes(q),
    )
  }, [items, search, lowFilterActive, lowStockItems])

  // Grouped by category, with a deliberate order in both dimensions. Items used
  // to appear in whatever order the subscription returned, and "Uncategorized"
  // sorted under U — between "Parts" and "Warranty" — rather than after the
  // real categories.
  const grouped = useMemo(() => {
    const map = new Map<string, CatalogItem[]>()
    for (const item of filtered) {
      const cat = item.category.trim() || UNCATEGORIZED
      if (!map.has(cat)) map.set(cat, [])
      map.get(cat)!.push(item)
    }
    for (const list of map.values()) {
      list.sort((a, b) => sortKey === 'price'
        ? a.price - b.price || a.name.localeCompare(b.name)
        : a.name.localeCompare(b.name))
    }
    return [...map.entries()].sort(([a], [b]) => {
      if (a === UNCATEGORIZED) return 1
      if (b === UNCATEGORIZED) return -1
      return a.localeCompare(b)
    })
  }, [filtered, sortKey])

  async function handleAdd(f: FormState) {
    try {
      await addCatalogItem(
        f.name.trim(), f.description.trim(), parseFloat(f.price) || 0, f.unit, f.category.trim(),
        f.trackInventory, parseInt(f.stockQty) || 0, parseInt(f.lowStockThreshold) || 0,
      )
      setShowAdd(false)
      toast('Item added', 'success')
    } catch {
      toast('Could not add that item', 'error')
    }
  }

  async function handleEdit(id: string, f: FormState) {
    try {
      await updateCatalogItem(
        id, f.name.trim(), f.description.trim(), parseFloat(f.price) || 0, f.unit, f.category.trim(),
        f.trackInventory, parseInt(f.stockQty) || 0, parseInt(f.lowStockThreshold) || 0,
      )
      setEditId(null)
      toast('Item updated', 'success')
    } catch {
      toast('Could not save that item', 'error')
    }
  }

  // Every mutation reports failure now. These four were bare awaits, so a
  // rejected write produced an unhandled rejection and a UI that looked like it
  // had succeeded — on the stock stepper that means the number on screen no
  // longer matches Firestore.
  async function handleAdjustStock(id: string, delta: number) {
    try {
      await adjustStock(id, delta)
    } catch {
      toast('Could not update stock', 'error')
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteCatalogItem(id)
      setDeleteId(null)
      toast('Item removed', 'success')
    } catch {
      toast('Could not remove that item', 'error')
    }
  }

  const lowNames = lowStockItems.slice(0, 4).map(i => i.name)
  const lowExtra = lowStockItems.length - lowNames.length

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-5">

      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-white">Product Catalog</h1>
          <p className="text-sm text-gray-400 mt-0.5">Items you can add to invoices in one click</p>
        </div>
        {/* Stays mounted and goes disabled while the form is open. Unmounting it
            made the page's one "add" affordance vanish at the moment of adding,
            and reflowed the header. */}
        <button
          onClick={() => { setShowAdd(true); setEditId(null) }}
          disabled={showAdd}
          className="shrink-0 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium
                     hover:bg-indigo-500 disabled:opacity-40 transition-colors
                     focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
        >
          <Icon d={ICONS.plus} className="w-4 h-4 shrink-0" />
          Add Item
        </button>
      </div>

      {/* Low stock banner. Was an unbounded comma-joined list of every low item's
          name with nothing clickable in it — thirty low items was a paragraph you
          then had to search for by hand. Caps the names and offers the filter
          instead. bg-yellow-900/30 + text-yellow-400 rather than
          bg-yellow-950/20 + yellow-300, because those two have light-mode rules
          and the originals measured 1.13:1 there. */}
      {lowStockItems.length > 0 && (
        <div className="card p-3 border-yellow-700/30 bg-yellow-900/30 flex items-start gap-2 flex-wrap">
          <Icon d={ICONS.warning} className="w-4 h-4 shrink-0 mt-0.5 text-yellow-400" />
          <p className="text-sm text-yellow-400 flex-1 min-w-0">
            {lowStockItems.length} item{lowStockItems.length !== 1 ? 's' : ''} low or out of stock
            {lowNames.length > 0 && <>: {lowNames.join(', ')}{lowExtra > 0 && ` and ${lowExtra} more`}</>}
          </p>
          <button
            onClick={() => setLowOnly(v => !v)}
            aria-pressed={lowFilterActive}
            className="shrink-0 text-xs font-medium px-2 py-1 rounded-lg bg-yellow-900/40 text-yellow-400
                       hover:bg-yellow-900/60 transition-colors
                       focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          >
            {lowFilterActive ? 'Show all' : 'Show only these'}
          </button>
        </div>
      )}

      {/* Add form */}
      {showAdd && (
        <ItemForm
          onSave={handleAdd}
          onCancel={() => setShowAdd(false)}
        />
      )}

      {/* Search + sort */}
      {items.length > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[12rem]">
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search items…"
              aria-label="Search catalog items by name, description or category"
              className="input-field w-full text-sm py-2 pr-9"
            />
            {/* Clearing used to mean selecting the text and deleting it. */}
            {search && (
              <button
                onClick={() => setSearch('')}
                aria-label="Clear search"
                className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1.5 rounded text-gray-400
                           hover:text-gray-200 hover:bg-gray-700/50 transition-colors
                           focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              >
                <Icon d={ICONS.close} className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="text-xs text-gray-400">Sort</span>
            {(['name', 'price'] as SortKey[]).map(k => (
              <button
                key={k}
                onClick={() => setSortKey(k)}
                aria-pressed={sortKey === k}
                className={`px-2.5 py-1 rounded-full text-xs font-medium capitalize transition-colors
                            focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                  sortKey === k ? 'bg-indigo-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-gray-200'
                }`}
              >
                {k}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* List */}
      {loading ? (
        <div className="card animate-pulse h-40" />
      ) : items.length === 0 ? (
        <div className="card p-12 text-center">
          <Icon d={ICONS.tag} className="w-8 h-8 mx-auto mb-3 text-gray-400" />
          <p className="text-gray-400 text-sm">No items in your catalog yet.</p>
          <p className="text-gray-400 text-xs mt-1">Add products and services to quickly populate invoices.</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="card p-8 text-center space-y-3">
          <p className="text-gray-400 text-sm">
            {lowFilterActive && !search.trim()
              ? 'Nothing matches — the low-stock filter is on.'
              : `No items match "${search}"`}
          </p>
          <div className="flex items-center justify-center gap-3">
            {search && (
              <button onClick={() => setSearch('')} className="text-sm text-indigo-400 hover:text-indigo-300">
                Clear search
              </button>
            )}
            {lowFilterActive && (
              <button onClick={() => setLowOnly(false)} className="text-sm text-indigo-400 hover:text-indigo-300">
                Show all items
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {grouped.map(([category, catItems]) => (
            <div key={category}>
              <p className="card-section-title mb-2 px-1">{category}</p>
              <div className="card divide-y divide-gray-700/40">
                {catItems.map(item => (
                  <div key={item.id} className="px-4 py-3 hover:bg-gray-800/30 transition-colors">
                    <div className="flex items-center gap-3">
                      {/* Name + desc */}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-200 truncate">{item.name}</p>
                        {item.description && (
                          <p className="text-xs text-gray-400 truncate mt-0.5">{item.description}</p>
                        )}
                      </div>

                      {/* Stock */}
                      {item.trackInventory && (
                        <div className="shrink-0 flex items-center gap-1.5">
                          {/* Icons rather than − (U+2212) and + as typeset text,
                              so they inherit the button's disabled state. */}
                          <button
                            onClick={() => handleAdjustStock(item.id, -1)}
                            disabled={item.stockQty <= 0}
                            aria-label={`Decrease stock of ${item.name}`}
                            className="w-6 h-6 flex items-center justify-center rounded-lg bg-gray-700 hover:bg-gray-600
                                       text-gray-300 disabled:opacity-30 transition-colors
                                       focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                          >
                            <Icon d={ICONS.minus} className="w-3.5 h-3.5" />
                          </button>
                          <div className="text-center w-12">
                            <p className="text-sm font-semibold text-gray-200 tabular-nums">{item.stockQty}</p>
                            <span className={`text-[10px] px-1.5 py-0.5 rounded-full whitespace-nowrap ${STOCK_LEVEL_COLORS[stockLevel(item)]}`}>
                              {STOCK_LEVEL_LABELS[stockLevel(item)]}
                            </span>
                          </div>
                          <button
                            onClick={() => handleAdjustStock(item.id, 1)}
                            aria-label={`Increase stock of ${item.name}`}
                            className="w-6 h-6 flex items-center justify-center rounded-lg bg-gray-700 hover:bg-gray-600
                                       text-gray-300 transition-colors
                                       focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                          >
                            <Icon d={ICONS.plus} className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}

                      {/* Price + unit. The unit is what the price is denominated
                          in — "per hr" vs "per job" changes the quote — so it's
                          gray-400 (5.78:1) rather than gray-600 (1.94:1). */}
                      <div className="shrink-0 text-right">
                        <p className="text-sm font-semibold text-green-400 tabular-nums">{formatCurrencyPrecise(item.price)}</p>
                        <p className="text-xs text-gray-400">per {item.unit}</p>
                      </div>

                      {/* Actions. Were opacity-0 group-hover:opacity-100, which
                          on a touch device meant there was no way to edit or
                          delete a catalogue item at all. */}
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => { setEditId(editId === item.id ? null : item.id); setShowAdd(false) }}
                          aria-label={`Edit ${item.name}`}
                          aria-expanded={editId === item.id}
                          className="p-1.5 rounded-lg text-gray-400 hover:text-gray-200 hover:bg-gray-700 transition-colors
                                     focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                          title="Edit"
                        >
                          <Icon d={ICONS.pencil} className="w-3.5 h-3.5" />
                        </button>
                        {deleteId === item.id ? (
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => handleDelete(item.id)}
                              className="text-xs font-medium text-red-400 hover:text-red-300 px-2 py-1 rounded
                                         focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                            >
                              Delete
                            </button>
                            <button
                              onClick={() => setDeleteId(null)}
                              className="text-xs text-gray-400 hover:text-gray-200 px-1 py-1 rounded
                                         focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setDeleteId(item.id)}
                            aria-label={`Delete ${item.name}`}
                            className="p-1.5 rounded-lg text-gray-400 hover:text-red-400 hover:bg-gray-700 transition-colors
                                       focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                            title="Delete"
                          >
                            <Icon d={ICONS.trash} className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* The form opens beneath the row instead of replacing it, so
                        the item you're editing stays on screen and the rows below
                        don't jump. `embedded` drops the form's own card and indigo
                        border, which nested a card inside this one. */}
                    {editId === item.id && (
                      <div className="mt-3 pt-3 border-t border-gray-700/40">
                        <ItemForm
                          initial={item}
                          embedded
                          onSave={f => handleEdit(item.id, f)}
                          onCancel={() => setEditId(null)}
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {items.length > 0 && (
        <p className="text-xs text-gray-400 text-center pb-2">
          {items.length} item{items.length !== 1 ? 's' : ''} · shared with your team · used in invoices
        </p>
      )}
    </div>
  )
}
