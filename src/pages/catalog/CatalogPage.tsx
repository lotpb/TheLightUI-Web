import { useEffect, useMemo, useState } from 'react'
import { usePageTitle } from '../../hooks/usePageTitle'
import {
  subscribeToCatalog, addCatalogItem, updateCatalogItem, deleteCatalogItem,
} from '../../services/catalogService'
import type { CatalogItem } from '../../models/catalogItem'
import { UNIT_OPTIONS } from '../../models/catalogItem'
import { useAuthStore } from '../../stores/authStore'
import { useToast } from '../../components/Toast'
import { formatCurrency } from '../../models/customer'

const EMPTY_FORM = { name: '', description: '', price: '', unit: 'each', category: '' }

type FormState = typeof EMPTY_FORM

function ItemForm({
  initial, onSave, onCancel,
}: {
  initial?: CatalogItem
  onSave: (f: FormState) => Promise<void>
  onCancel: () => void
}) {
  const [form, setForm]   = useState<FormState>(
    initial
      ? { name: initial.name, description: initial.description, price: String(initial.price), unit: initial.unit, category: initial.category }
      : EMPTY_FORM,
  )
  const [saving, setSaving] = useState(false)

  function set(field: keyof FormState, value: string) {
    setForm(f => ({ ...f, [field]: value }))
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim()) return
    setSaving(true)
    try { await onSave(form) } finally { setSaving(false) }
  }

  return (
    <form onSubmit={submit} className="card p-4 space-y-3 border border-indigo-500/30">
      <p className="text-sm font-semibold text-white">{initial ? 'Edit Item' : 'New Item'}</p>

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

      <div className="flex gap-2 pt-1">
        <button type="button" onClick={onCancel} className="btn-secondary text-sm px-4 py-1.5">Cancel</button>
        <button
          type="submit"
          disabled={saving || !form.name.trim()}
          className="px-4 py-1.5 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-500 disabled:opacity-40 transition-colors"
        >
          {saving ? 'Saving…' : initial ? 'Save Changes' : 'Add Item'}
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

  useEffect(() => {
    const unsub = subscribeToCatalog(
      its => { setItems(its); setLoading(false) },
      ()  => setLoading(false),
    )
    return unsub
  }, [companyId])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return items
    return items.filter(i =>
      i.name.toLowerCase().includes(q) ||
      i.description.toLowerCase().includes(q) ||
      i.category.toLowerCase().includes(q),
    )
  }, [items, search])

  // Group by category
  const grouped = useMemo(() => {
    const map = new Map<string, CatalogItem[]>()
    for (const item of filtered) {
      const cat = item.category.trim() || 'Uncategorized'
      if (!map.has(cat)) map.set(cat, [])
      map.get(cat)!.push(item)
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [filtered])

  async function handleAdd(f: FormState) {
    await addCatalogItem(f.name.trim(), f.description.trim(), parseFloat(f.price) || 0, f.unit, f.category.trim())
    setShowAdd(false)
    toast('Item added', 'success')
  }

  async function handleEdit(id: string, f: FormState) {
    await updateCatalogItem(id, f.name.trim(), f.description.trim(), parseFloat(f.price) || 0, f.unit, f.category.trim())
    setEditId(null)
    toast('Item updated', 'success')
  }

  async function handleDelete(id: string) {
    await deleteCatalogItem(id)
    setDeleteId(null)
    toast('Item removed', 'success')
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Product Catalog</h1>
          <p className="text-sm text-gray-400 mt-0.5">Items you can add to invoices in one click</p>
        </div>
        {!showAdd && (
          <button
            onClick={() => { setShowAdd(true); setEditId(null) }}
            className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-500 transition-colors"
          >
            + Add Item
          </button>
        )}
      </div>

      {/* Add form */}
      {showAdd && (
        <ItemForm
          onSave={handleAdd}
          onCancel={() => setShowAdd(false)}
        />
      )}

      {/* Search */}
      {items.length > 0 && (
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search items…"
          className="input-field w-full text-sm py-2"
        />
      )}

      {/* List */}
      {loading ? (
        <div className="card animate-pulse h-40" />
      ) : items.length === 0 ? (
        <div className="card p-12 text-center">
          <p className="text-3xl mb-3">📦</p>
          <p className="text-gray-400 text-sm">No items in your catalog yet.</p>
          <p className="text-gray-600 text-xs mt-1">Add products and services to quickly populate invoices.</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="text-gray-500 text-sm">No items match "{search}"</p>
        </div>
      ) : (
        <div className="space-y-4">
          {grouped.map(([category, catItems]) => (
            <div key={category}>
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2 px-1">{category}</p>
              <div className="card divide-y divide-gray-700/40">
                {catItems.map(item => (
                  editId === item.id ? (
                    <div key={item.id} className="p-3">
                      <ItemForm
                        initial={item}
                        onSave={f => handleEdit(item.id, f)}
                        onCancel={() => setEditId(null)}
                      />
                    </div>
                  ) : (
                    <div key={item.id} className="flex items-center gap-3 px-4 py-3 group hover:bg-gray-800/30 transition-colors">
                      {/* Name + desc */}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-200 truncate">{item.name}</p>
                        {item.description && (
                          <p className="text-xs text-gray-500 truncate mt-0.5">{item.description}</p>
                        )}
                      </div>

                      {/* Price + unit */}
                      <div className="shrink-0 text-right">
                        <p className="text-sm font-semibold text-green-400">{formatCurrency(item.price)}</p>
                        <p className="text-xs text-gray-600">per {item.unit}</p>
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => { setEditId(item.id); setShowAdd(false) }}
                          className="p-1.5 rounded-lg text-gray-500 hover:text-gray-200 hover:bg-gray-700 transition-colors"
                          title="Edit"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125" />
                          </svg>
                        </button>
                        {deleteId === item.id ? (
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => handleDelete(item.id)}
                              className="text-xs text-red-400 hover:text-red-300 px-2 py-1 rounded"
                            >
                              Delete
                            </button>
                            <button
                              onClick={() => setDeleteId(null)}
                              className="text-xs text-gray-500 hover:text-gray-300 px-1 py-1"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setDeleteId(item.id)}
                            className="p-1.5 rounded-lg text-gray-500 hover:text-red-400 hover:bg-gray-700 transition-colors"
                            title="Delete"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                            </svg>
                          </button>
                        )}
                      </div>
                    </div>
                  )
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {items.length > 0 && (
        <p className="text-xs text-gray-600 text-center pb-2">
          {items.length} item{items.length !== 1 ? 's' : ''} · shared with your team · used in invoices
        </p>
      )}
    </div>
  )
}
