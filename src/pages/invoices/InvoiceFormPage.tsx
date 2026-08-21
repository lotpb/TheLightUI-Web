import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { usePageTitle } from '../../hooks/usePageTitle'
import { createInvoice, getInvoice, updateInvoice } from '../../services/invoiceService'
import { subscribeToCustomers } from '../../services/customerService'
import { subscribeToCatalog } from '../../services/catalogService'
import { fullName, type CustomerItem } from '../../models/customer'
import type { CatalogItem } from '../../models/catalogItem'
import {
  fmtCurrency, generateInvoiceNumber, lineItemTotal,
  type Invoice, type InvoiceLineItem, type RecurringInterval,
} from '../../models/invoice'
import { useAuthStore } from '../../stores/authStore'
import { useToast } from '../../components/Toast'
import { validateInvoiceForm } from '../../validation/invoiceFormSchema'

function dateToInput(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function inputToDate(s: string): Date {
  return s ? new Date(s + 'T12:00:00') : new Date()
}

function dueDefault(): Date {
  const d = new Date()
  d.setDate(d.getDate() + 30)
  return d
}

const emptyLine = (): InvoiceLineItem => ({ description: '', qty: 1, rate: 0 })

export default function InvoiceFormPage() {
  const { id } = useParams<{ id: string }>()
  const isEdit  = Boolean(id)

  const [searchParams] = useSearchParams()
  const prefillCustomerId = searchParams.get('customerId') ?? ''
  const fromQuoteId       = searchParams.get('fromQuote') ?? ''

  usePageTitle(isEdit ? 'Edit Invoice' : fromQuoteId ? 'Invoice from Quote' : 'New Invoice')
  const navigate = useNavigate()
  const toast    = useToast()
  const companyId = useAuthStore(s => s.companyId)

  // Customer picker state
  const [customers, setCustomers]     = useState<CustomerItem[]>([])
  const [customerQuery, setCustQuery] = useState('')
  const [showCustList, setShowCustList] = useState(false)

  // Catalog picker state
  const [catalog, setCatalog]           = useState<CatalogItem[]>([])
  const [showCatalog, setShowCatalog]   = useState(false)
  const [catalogQuery, setCatalogQuery] = useState('')
  const catalogRef = useRef<HTMLDivElement>(null)

  // Form state
  const [customerId,      setCustomerId]      = useState('')
  const [customerName,    setCustomerName]    = useState('')
  const [customerPhone,   setCustomerPhone]   = useState('')
  const [customerEmail,   setCustomerEmail]   = useState('')
  const [customerAddress, setCustomerAddress] = useState('')
  const [invoiceNumber,   setInvoiceNumber]   = useState(generateInvoiceNumber)
  const [issueDate,       setIssueDate]       = useState(dateToInput(new Date()))
  const [dueDate,         setDueDate]         = useState(dateToInput(dueDefault()))
  const [lineItems,       setLineItems]       = useState<InvoiceLineItem[]>([emptyLine()])
  const [taxRate,         setTaxRate]         = useState(0)
  const [notes,           setNotes]           = useState('')
  const [recurring,       setRecurring]       = useState<RecurringInterval | null>(null)
  const [nextRecurDate,   setNextRecurDate]   = useState(dateToInput(dueDefault()))
  const [saving,          setSaving]          = useState(false)
  const [loading,         setLoading]         = useState(isEdit)

  useEffect(() => {
    const unsub = subscribeToCustomers(items => setCustomers(items), () => {})
    return unsub
  }, [companyId])

  useEffect(() => {
    const unsub = subscribeToCatalog(setCatalog, () => {})
    return unsub
  }, [companyId])

  // Close catalog dropdown on outside click
  useEffect(() => {
    if (!showCatalog) return
    function onDown(e: MouseEvent) {
      if (catalogRef.current && !catalogRef.current.contains(e.target as Node)) {
        setShowCatalog(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [showCatalog])

  // Load existing invoice (edit mode)
  useEffect(() => {
    if (!isEdit || !id) return
    getInvoice(id).then(inv => {
      if (!inv) { navigate('/invoices'); return }
      setCustomerId(inv.customerId)
      setCustomerName(inv.customerName)
      setCustomerPhone(inv.customerPhone)
      setCustomerEmail(inv.customerEmail)
      setCustomerAddress(inv.customerAddress)
      setInvoiceNumber(inv.invoiceNumber)
      setIssueDate(dateToInput(inv.issueDate))
      setDueDate(dateToInput(inv.dueDate))
      setLineItems(inv.lineItems.length ? inv.lineItems : [emptyLine()])
      setTaxRate(inv.taxRate)
      setNotes(inv.notes)
      setRecurring(inv.recurring ?? null)
      if (inv.nextRecurDate) setNextRecurDate(dateToInput(inv.nextRecurDate))
      setCustQuery(inv.customerName)
      setLoading(false)
    })
  }, [id, isEdit])

  // Pre-fill from customer (new invoice from customer detail)
  useEffect(() => {
    if (isEdit || !prefillCustomerId || customers.length === 0) return
    const c = customers.find(c => c.id === prefillCustomerId)
    if (c) selectCustomer(c)
  }, [prefillCustomerId, customers, isEdit])

  // Pre-fill from quote (Convert to Invoice)
  useEffect(() => {
    if (isEdit || !fromQuoteId || customers.length === 0) return
    const c = customers.find(c => c.id === fromQuoteId)
    if (!c) return
    selectCustomer(c)
    // Build a line item from the customer's work data
    const description = [c.job, c.product].filter(Boolean).join(' — ') || 'Services'
    const qty  = c.quantity > 0 ? c.quantity : 1
    const rate = c.amount > 0 ? Math.round((c.amount / qty) * 100) / 100 : 0
    if (description || rate > 0) {
      setLineItems([{ description, qty, rate }])
    }
    // Pull notes saved on the quote
    const quoteNotes = localStorage.getItem(`thelight.quote.notes.${fromQuoteId}`)
    if (quoteNotes) setNotes(quoteNotes)
  }, [fromQuoteId, customers, isEdit])

  function selectCustomer(c: CustomerItem) {
    setCustomerId(c.id)
    setCustomerName(fullName(c))
    setCustomerPhone(c.phone)
    setCustomerEmail(c.email)
    setCustomerAddress([c.street, c.city, c.state, c.zip].filter(Boolean).join(', '))
    setCustQuery(fullName(c))
    setShowCustList(false)
  }

  const custSuggestions = useMemo(() => {
    if (!showCustList) return []
    const q = customerQuery.trim().toLowerCase()
    if (!q) return customers.slice(0, 8)
    return customers.filter(c =>
      fullName(c).toLowerCase().includes(q) ||
      c.phone.includes(q) ||
      c.email.toLowerCase().includes(q),
    ).slice(0, 8)
  }, [customers, customerQuery, showCustList])

  function updateLine(idx: number, field: keyof InvoiceLineItem, value: string) {
    setLineItems(prev => {
      const next = [...prev]
      if (field === 'description') next[idx] = { ...next[idx], description: value }
      if (field === 'qty')  next[idx] = { ...next[idx], qty:  parseFloat(value) || 0 }
      if (field === 'rate') next[idx] = { ...next[idx], rate: parseFloat(value) || 0 }
      return next
    })
  }

  function removeLine(idx: number) {
    if (lineItems.length === 1) return
    setLineItems(prev => prev.filter((_, i) => i !== idx))
  }

  function addFromCatalog(item: CatalogItem) {
    setLineItems(prev => [...prev, { description: item.name + (item.description ? ` — ${item.description}` : ''), qty: 1, rate: item.price }])
    setShowCatalog(false)
    setCatalogQuery('')
  }

  const catalogSuggestions = useMemo(() => {
    const q = catalogQuery.trim().toLowerCase()
    if (!q) return catalog.slice(0, 20)
    return catalog.filter(i =>
      i.name.toLowerCase().includes(q) ||
      i.description.toLowerCase().includes(q) ||
      i.category.toLowerCase().includes(q),
    ).slice(0, 20)
  }, [catalog, catalogQuery])

  const subtotal = lineItems.reduce((s, l) => s + lineItemTotal(l), 0)
  const taxAmt   = subtotal * (taxRate / 100)
  const total    = subtotal + taxAmt

  async function handleSave(status: Invoice['status']) {
    const finalCustomerName = customerName.trim() || customerQuery.trim()
    const validationError = validateInvoiceForm({ customerId, customerName: finalCustomerName, lineItems })
    if (validationError) {
      toast(validationError, 'error')
      return
    }
    setSaving(true)
    const data: Omit<Invoice, 'id' | 'createdAt' | 'updatedAt'> = {
      companyId: companyId ?? '',
      customerId,
      customerName: finalCustomerName,
      customerPhone,
      customerEmail,
      customerAddress,
      invoiceNumber,
      issueDate: inputToDate(issueDate),
      dueDate:   inputToDate(dueDate),
      status,
      lineItems,
      notes,
      taxRate,
      recurring,
      nextRecurDate: recurring ? inputToDate(nextRecurDate) : null,
    }
    try {
      if (isEdit && id) {
        await updateInvoice(id, data)
        navigate(`/invoices/${id}`)
      } else {
        const newId = await createInvoice(data)
        navigate(`/invoices/${newId}`)
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Save failed', 'error')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[300px]">
        <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">{isEdit ? 'Edit Invoice' : fromQuoteId ? 'Invoice from Quote' : 'New Invoice'}</h1>
          <p className="text-sm text-gray-400 mt-0.5">{invoiceNumber}</p>
        </div>
        <button onClick={() => navigate(-1)} className="text-sm text-gray-500 hover:text-gray-300 transition-colors">
          Cancel
        </button>
      </div>

      {/* Customer */}
      <div className="card">
        <div className="px-4 py-2 border-b border-gray-700/50 bg-gray-800/50 rounded-t-xl">
          <p className="text-sm font-semibold uppercase tracking-wider text-gray-400">Customer</p>
        </div>
        <div className="p-4 space-y-3">
          <div className="relative">
            <input
              type="text"
              value={customerQuery}
              onChange={e => { setCustQuery(e.target.value); setShowCustList(true) }}
              onFocus={() => setShowCustList(true)}
              onBlur={() => setTimeout(() => setShowCustList(false), 200)}
              placeholder="Search customers…"
              className="input-field w-full text-sm py-2"
            />
            {showCustList && custSuggestions.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-gray-900 border border-gray-700 rounded-xl shadow-2xl z-20 overflow-hidden">
                {custSuggestions.map(c => (
                  <button
                    key={c.id}
                    onPointerDown={() => selectCustomer(c)}
                    className="w-full text-left px-4 py-2.5 hover:bg-gray-700/50 transition-colors"
                  >
                    <p className="text-sm font-medium text-gray-200">{fullName(c)}</p>
                    <p className="text-xs text-gray-500">{c.phone || c.email || c.city}</p>
                  </button>
                ))}
              </div>
            )}
          </div>

          {customerId && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Phone</label>
                <input type="text" value={customerPhone} onChange={e => setCustomerPhone(e.target.value)} className="input-field w-full text-sm py-1.5" />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Email</label>
                <input type="text" value={customerEmail} onChange={e => setCustomerEmail(e.target.value)} className="input-field w-full text-sm py-1.5" />
              </div>
              <div className="col-span-2">
                <label className="text-xs text-gray-500 mb-1 block">Address</label>
                <input type="text" value={customerAddress} onChange={e => setCustomerAddress(e.target.value)} className="input-field w-full text-sm py-1.5" />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Invoice details */}
      <div className="card overflow-hidden">
        <div className="px-4 py-2 border-b border-gray-700/50 bg-gray-800/50">
          <p className="text-sm font-semibold uppercase tracking-wider text-gray-400">Details</p>
        </div>
        <div className="p-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Invoice #</label>
            <input type="text" value={invoiceNumber} onChange={e => setInvoiceNumber(e.target.value)} className="input-field w-full text-sm py-1.5 font-mono" />
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Issue Date</label>
            <input type="date" value={issueDate} onChange={e => setIssueDate(e.target.value)} className="input-field w-full text-sm py-1.5" />
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Due Date</label>
            <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className="input-field w-full text-sm py-1.5" />
          </div>
        </div>
      </div>

      {/* Line items */}
      <div className="card overflow-hidden">
        <div className="px-4 py-2 border-b border-gray-700/50 bg-gray-800/50 flex items-center justify-between gap-2">
          <p className="text-sm font-semibold uppercase tracking-wider text-gray-400">Line Items</p>
          <div className="flex items-center gap-2">
            {/* Catalog picker */}
            {catalog.length > 0 && (
              <div className="relative" ref={catalogRef}>
                <button
                  type="button"
                  onClick={() => { setShowCatalog(v => !v); setCatalogQuery('') }}
                  className="text-xs text-teal-400 hover:text-teal-300 transition-colors flex items-center gap-1"
                >
                  📦 Catalog
                </button>
                {showCatalog && (
                  <div className="absolute right-0 top-full mt-1 w-72 bg-gray-900 border border-gray-700 rounded-xl shadow-2xl z-30 overflow-hidden">
                    <div className="p-2 border-b border-gray-700/50">
                      <input
                        autoFocus
                        type="text"
                        value={catalogQuery}
                        onChange={e => setCatalogQuery(e.target.value)}
                        placeholder="Search catalog…"
                        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"
                      />
                    </div>
                    <div className="max-h-64 overflow-y-auto">
                      {catalogSuggestions.length === 0 ? (
                        <p className="px-4 py-3 text-sm text-gray-500">No items found</p>
                      ) : (
                        catalogSuggestions.map(item => (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => addFromCatalog(item)}
                            className="w-full text-left px-4 py-2.5 hover:bg-gray-700/50 transition-colors flex items-center justify-between gap-3"
                          >
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-gray-200 truncate">{item.name}</p>
                              {item.description && (
                                <p className="text-xs text-gray-500 truncate">{item.description}</p>
                              )}
                            </div>
                            <span className="text-sm font-semibold text-green-400 shrink-0">
                              ${item.price.toFixed(2)}/{item.unit}
                            </span>
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
            <button
              type="button"
              onClick={() => setLineItems(prev => [...prev, emptyLine()])}
              className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
            >
              + Add line
            </button>
          </div>
        </div>

        <div className="divide-y divide-gray-700/30">
          {lineItems.map((item, idx) => (
            <div key={idx} className="flex gap-2 px-4 py-3 items-center">
              <input
                type="text"
                value={item.description}
                onChange={e => updateLine(idx, 'description', e.target.value)}
                placeholder="Description…"
                className="input-field flex-1 text-sm py-1.5"
              />
              <input
                type="number"
                value={item.qty || ''}
                onChange={e => updateLine(idx, 'qty', e.target.value)}
                placeholder="Qty"
                min={0}
                className="input-field w-16 text-sm py-1.5 text-center"
              />
              <input
                type="number"
                value={item.rate || ''}
                onChange={e => updateLine(idx, 'rate', e.target.value)}
                placeholder="Rate"
                min={0}
                step={0.01}
                className="input-field w-24 text-sm py-1.5 text-right"
              />
              <p className="w-20 text-sm font-medium text-gray-300 text-right shrink-0">
                {fmtCurrency(lineItemTotal(item))}
              </p>
              <button
                onClick={() => removeLine(idx)}
                disabled={lineItems.length === 1}
                className="text-gray-600 hover:text-red-400 transition-colors disabled:opacity-30 shrink-0"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))}
        </div>

        {/* Totals */}
        <div className="px-4 py-3 border-t border-gray-700/50 bg-gray-800/30 space-y-1.5">
          <div className="flex justify-between text-sm text-gray-400">
            <span>Subtotal</span>
            <span>{fmtCurrency(subtotal)}</span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-400">Tax</span>
              <input
                type="number"
                value={taxRate || ''}
                onChange={e => setTaxRate(parseFloat(e.target.value) || 0)}
                placeholder="0"
                min={0}
                max={100}
                step={0.1}
                className="input-field w-16 text-sm py-0.5 text-center"
              />
              <span className="text-sm text-gray-500">%</span>
            </div>
            <span className="text-sm text-gray-400">{fmtCurrency(taxAmt)}</span>
          </div>
          <div className="flex justify-between text-base font-bold text-white border-t border-gray-700/50 pt-1.5 mt-1">
            <span>Total</span>
            <span>{fmtCurrency(total)}</span>
          </div>
        </div>
      </div>

      {/* Notes */}
      <div className="card overflow-hidden">
        <div className="px-4 py-2 border-b border-gray-700/50 bg-gray-800/50">
          <p className="text-sm font-semibold uppercase tracking-wider text-gray-400">Notes</p>
        </div>
        <div className="p-4">
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            rows={3}
            placeholder="Payment terms, special instructions…"
            className="input-field w-full resize-none text-sm"
          />
        </div>
      </div>

      {/* Recurring */}
      <div className="card overflow-hidden">
        <div className="px-4 py-2 border-b border-gray-700/50 bg-gray-800/50 flex items-center justify-between">
          <p className="text-sm font-semibold uppercase tracking-wider text-gray-400">Recurring Invoice</p>
          <label className="flex items-center gap-2 cursor-pointer">
            <span className="text-xs text-gray-500">{recurring ? 'On' : 'Off'}</span>
            <div
              onClick={() => setRecurring(r => r ? null : 'monthly')}
              className={`relative w-9 h-5 rounded-full transition-colors cursor-pointer ${recurring ? 'bg-indigo-600' : 'bg-gray-700'}`}
            >
              <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${recurring ? 'translate-x-4' : 'translate-x-0.5'}`} />
            </div>
          </label>
        </div>
        {recurring ? (
          <div className="p-4 flex flex-wrap gap-4 items-end">
            <div>
              <label className="label-text">Repeat every</label>
              <select
                value={recurring}
                onChange={e => setRecurring(e.target.value as RecurringInterval)}
                className="input-field text-sm mt-1"
              >
                <option value="monthly">Month</option>
                <option value="quarterly">Quarter (3 months)</option>
                <option value="yearly">Year</option>
              </select>
            </div>
            <div>
              <label className="label-text">First occurrence</label>
              <input
                type="date"
                value={nextRecurDate}
                onChange={e => setNextRecurDate(e.target.value)}
                className="input-field text-sm mt-1"
              />
            </div>
            <p className="text-xs text-gray-500 w-full -mt-2">
              A new copy of this invoice will be auto-generated and marked Sent on each scheduled date.
            </p>
          </div>
        ) : (
          <p className="px-4 py-3 text-sm text-gray-500">
            Enable to auto-generate this invoice on a recurring schedule.
          </p>
        )}
      </div>

      {/* Save buttons */}
      <div className="flex gap-3 justify-end pb-8">
        <button
          onClick={() => handleSave('draft')}
          disabled={saving}
          className="btn-secondary text-sm px-5 py-2 disabled:opacity-40"
        >
          Save as Draft
        </button>
        <button
          onClick={() => handleSave('sent')}
          disabled={saving}
          className="btn-primary text-sm px-6 py-2 disabled:opacity-40"
        >
          {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Save & Mark Sent'}
        </button>
      </div>
    </div>
  )
}
