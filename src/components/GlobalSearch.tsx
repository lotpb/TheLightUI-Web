import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { subscribeToCustomers } from '../services/customerService'
import { subscribeToInvoices } from '../services/invoiceService'
import { subscribeToTodos } from '../services/todoService'
import { subscribeToExpenses } from '../services/expenseService'
import { fullName, type CustomerItem, type CustomerCategory, CATEGORY_LABELS } from '../models/customer'
import { fmtCurrency, type Invoice } from '../models/invoice'
import type { Todo } from '../models/todo'
import type { Expense } from '../models/expense'
import { useAuthStore } from '../stores/authStore'
import { useDebounce } from '../hooks/useDebounce'
import { avatarColor, avatarOriginal } from '../utils/avatarColor'
import { usePrefStore } from '../stores/prefStore'
import { useFocusTrap } from '../hooks/useFocusTrap'

const CATEGORY_ORDER: CustomerCategory[] = ['Lead', 'Customer', 'Vendor', 'Employee']
const MAX_PER_GROUP = 4

interface Props {
  onClose: () => void
}

export default function GlobalSearch({ onClose }: Props) {
  const navigate       = useNavigate()
  const companyId      = useAuthStore(s => s.companyId)
  const user           = useAuthStore(s => s.user)
  const coloredAvatars = usePrefStore(s => s.coloredAvatars)
  const inputRef       = useRef<HTMLInputElement>(null)
  const panelRef       = useRef<HTMLDivElement>(null)
  useFocusTrap(panelRef)

  const [allCustomers, setAllCustomers] = useState<CustomerItem[]>([])
  const [allInvoices,  setAllInvoices]  = useState<Invoice[]>([])
  const [allTodos,     setAllTodos]     = useState<Todo[]>([])
  const [allExpenses,  setAllExpenses]  = useState<Expense[]>([])
  const [query, setQuery] = useState('')
  const debouncedQuery    = useDebounce(query, 150)

  useEffect(() => {
    const u1 = subscribeToCustomers(setAllCustomers, () => {})
    const u2 = subscribeToInvoices(setAllInvoices,   () => {})
    const u3 = subscribeToTodos(items => setAllTodos(items), () => {})
    const u4 = subscribeToExpenses(setAllExpenses,   () => {})
    return () => { u1(); u2(); u3(); u4() }
  }, [companyId, user])

  useEffect(() => { inputRef.current?.focus() }, [])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const q = debouncedQuery.trim().toLowerCase()

  const customerResults = useMemo(() => {
    if (!q) return []
    return allCustomers.filter(c =>
      fullName(c).toLowerCase().includes(q) ||
      c.phone.includes(q) ||
      c.email.toLowerCase().includes(q) ||
      c.city.toLowerCase().includes(q) ||
      c.salesman.toLowerCase().includes(q) ||
      c.leadSource.toLowerCase().includes(q) ||
      c.contractor.toLowerCase().includes(q),
    )
  }, [allCustomers, q])

  const invoiceResults = useMemo(() => {
    if (!q) return []
    return allInvoices.filter(inv =>
      inv.invoiceNumber.toLowerCase().includes(q) ||
      inv.customerName.toLowerCase().includes(q) ||
      inv.customerEmail.toLowerCase().includes(q) ||
      inv.customerPhone.includes(q),
    )
  }, [allInvoices, q])

  const todoResults = useMemo(() => {
    if (!q) return []
    return allTodos.filter(t => t.title.toLowerCase().includes(q))
  }, [allTodos, q])

  const expenseResults = useMemo(() => {
    if (!q) return []
    return allExpenses.filter(e =>
      e.title.toLowerCase().includes(q) ||
      e.category.toLowerCase().includes(q),
    )
  }, [allExpenses, q])

  const grouped = useMemo(() => {
    const map = new Map<CustomerCategory, CustomerItem[]>()
    for (const cat of CATEGORY_ORDER) map.set(cat, [])
    for (const c of customerResults) {
      const cat = (c.category as CustomerCategory) ?? 'Lead'
      if (map.has(cat)) map.get(cat)!.push(c)
    }
    return CATEGORY_ORDER.map(cat => ({ cat, items: map.get(cat)! })).filter(g => g.items.length > 0)
  }, [customerResults])

  const totalResults = customerResults.length + invoiceResults.length + todoResults.length + expenseResults.length

  function go(path: string) {
    navigate(path)
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
        aria-label="Search"
        className="relative bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-xl shadow-2xl overflow-hidden flex flex-col max-h-[82vh]"
      >
        {/* Input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-700 shrink-0">
          <svg className="w-5 h-5 text-gray-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
          </svg>
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search records, invoices, tasks, expenses…"
            className="flex-1 bg-transparent text-white placeholder-gray-500 outline-none text-sm"
          />
          <kbd className="hidden sm:inline text-xs text-gray-500 bg-gray-800 border border-gray-700 px-1.5 py-0.5 rounded font-mono">Esc</kbd>
        </div>

        {/* Results */}
        <div className="overflow-y-auto flex-1">
          {!q ? (
            <div className="px-4 py-8 text-center">
              <p className="text-sm text-gray-500">Search across records, invoices, tasks, and expenses</p>
              <p className="text-xs text-gray-600 mt-1">Tip: press <kbd className="bg-gray-800 border border-gray-700 px-1 rounded font-mono">⌘K</kbd> anytime to open</p>
            </div>
          ) : totalResults === 0 ? (
            <div className="px-4 py-8 text-center">
              <p className="text-sm text-gray-400">No results for <span className="text-white">"{debouncedQuery}"</span></p>
            </div>
          ) : (
            <>
              <p className="px-4 pt-3 pb-1 text-xs text-gray-500">{totalResults} result{totalResults !== 1 ? 's' : ''}</p>

              {/* ── Customer groups ── */}
              {grouped.map(({ cat, items }) => {
                const shown    = items.slice(0, MAX_PER_GROUP)
                const overflow = items.length - shown.length
                return (
                  <div key={cat}>
                    <SectionHeader label={CATEGORY_LABELS[cat]} />
                    {shown.map(c => {
                      const name     = fullName(c)
                      const initials = [c.first[0], c.lastname[0]].filter(Boolean).join('').toUpperCase()
                      const color    = coloredAvatars ? avatarColor(name) : avatarOriginal()
                      const sub      = [c.city, c.state].filter(Boolean).join(', ') || c.phone || ''
                      return (
                        <button
                          key={c.id}
                          onClick={() => go(`/records/${c.id}`)}
                          className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-800 transition-colors text-left"
                        >
                          <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 overflow-hidden" style={{ background: color.bg }}>
                            {c.photo
                              ? <img src={c.photo} alt={name} className="w-full h-full object-cover" />
                              : <span className="text-xs font-semibold" style={{ color: color.text }}>{initials || '?'}</span>}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-100 truncate">{name || '—'}</p>
                            {sub && <p className="text-xs text-gray-400 truncate">{sub}</p>}
                          </div>
                          {!c.isActive && <span className="text-xs text-gray-500 shrink-0">inactive</span>}
                        </button>
                      )
                    })}
                    {overflow > 0 && (
                      <button onClick={() => { navigate(`/${cat.toLowerCase()}s`); onClose() }} className="w-full text-left px-4 py-2 text-xs text-indigo-400 hover:text-indigo-300 transition-colors">
                        +{overflow} more in {CATEGORY_LABELS[cat]} →
                      </button>
                    )}
                  </div>
                )
              })}

              {/* ── Invoices ── */}
              {invoiceResults.length > 0 && (
                <div>
                  <SectionHeader label="Invoices" />
                  {invoiceResults.slice(0, MAX_PER_GROUP).map(inv => (
                    <button
                      key={inv.id}
                      onClick={() => go(`/invoices/${inv.id}`)}
                      className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-800 transition-colors text-left"
                    >
                      <div className="w-8 h-8 rounded-full bg-indigo-500/20 flex items-center justify-center shrink-0">
                        <span className="text-sm">🧾</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-100 truncate">{inv.invoiceNumber} · {inv.customerName}</p>
                        <p className="text-xs text-gray-400">{fmtCurrency(inv.lineItems.reduce((s, l) => s + l.qty * l.rate, 0))} · {inv.status}</p>
                      </div>
                    </button>
                  ))}
                  {invoiceResults.length > MAX_PER_GROUP && (
                    <button onClick={() => go('/invoices')} className="w-full text-left px-4 py-2 text-xs text-indigo-400 hover:text-indigo-300 transition-colors">
                      +{invoiceResults.length - MAX_PER_GROUP} more invoices →
                    </button>
                  )}
                </div>
              )}

              {/* ── Tasks ── */}
              {todoResults.length > 0 && (
                <div>
                  <SectionHeader label="Tasks" />
                  {todoResults.slice(0, MAX_PER_GROUP).map(todo => (
                    <button
                      key={todo.id}
                      onClick={() => go(`/todo/${todo.id}/edit`)}
                      className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-800 transition-colors text-left"
                    >
                      <div className="w-8 h-8 rounded-full bg-violet-500/20 flex items-center justify-center shrink-0">
                        <span className="text-sm">{todo.isCompleted ? '✅' : '☐'}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-medium truncate ${todo.isCompleted ? 'text-gray-500 line-through' : 'text-gray-100'}`}>{todo.title}</p>
                        {todo.dueDate && <p className="text-xs text-gray-400">Due {todo.dueDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</p>}
                      </div>
                      <span className={`text-xs shrink-0 capitalize ${todo.priority === 'high' ? 'text-red-400' : todo.priority === 'medium' ? 'text-yellow-400' : 'text-gray-500'}`}>
                        {todo.priority}
                      </span>
                    </button>
                  ))}
                  {todoResults.length > MAX_PER_GROUP && (
                    <button onClick={() => go('/todo')} className="w-full text-left px-4 py-2 text-xs text-indigo-400 hover:text-indigo-300 transition-colors">
                      +{todoResults.length - MAX_PER_GROUP} more tasks →
                    </button>
                  )}
                </div>
              )}

              {/* ── Expenses ── */}
              {expenseResults.length > 0 && (
                <div>
                  <SectionHeader label="Expenses" />
                  {expenseResults.slice(0, MAX_PER_GROUP).map(exp => (
                    <button
                      key={exp.id}
                      onClick={() => go('/expenses')}
                      className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-800 transition-colors text-left"
                    >
                      <div className="w-8 h-8 rounded-full bg-amber-500/20 flex items-center justify-center shrink-0">
                        <span className="text-sm">💸</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-100 truncate">{exp.title}</p>
                        <p className="text-xs text-gray-400">{exp.category}</p>
                      </div>
                      <span className="text-sm font-semibold text-amber-400 shrink-0">{fmtCurrency(exp.amount)}</span>
                    </button>
                  ))}
                  {expenseResults.length > MAX_PER_GROUP && (
                    <button onClick={() => go('/expenses')} className="w-full text-left px-4 py-2 text-xs text-indigo-400 hover:text-indigo-300 transition-colors">
                      +{expenseResults.length - MAX_PER_GROUP} more expenses →
                    </button>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function SectionHeader({ label }: { label: string }) {
  return (
    <div className="px-4 py-1.5 bg-gray-800/60 border-y border-gray-800">
      <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">{label}</span>
    </div>
  )
}
