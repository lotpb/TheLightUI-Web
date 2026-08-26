import { useEffect, useMemo, useState } from 'react'
import { usePageTitle } from '../../hooks/usePageTitle'
import { subscribeToCustomers } from '../../services/customerService'
import { subscribeToInvoices } from '../../services/invoiceService'
import { subscribeToExpenses } from '../../services/expenseService'
import { CATEGORIES, fullName, formatCurrency, type CustomerItem } from '../../models/customer'
import { effectiveStatus, fmtCurrency, invoiceTotal, type Invoice } from '../../models/invoice'
import { EXPENSE_CATEGORIES, type Expense } from '../../models/expense'
import { useAuthStore } from '../../stores/authStore'
import { buildInvoiceIIF, buildInvoiceQBOCSV, buildExpenseQBOCSV } from '../../utils/quickbooksExport'

// ── CSV utilities ─────────────────────────────────────────────────────────────

function escapeCell(v: string | number | boolean | null | undefined): string {
  const s = String(v ?? '')
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

function buildCSV(headers: string[], rows: (string | number | boolean | null | undefined)[][]): string {
  const head = headers.map(escapeCell).join(',')
  const body = rows.map(r => r.map(escapeCell).join(',')).join('\n')
  return `${head}\n${body}`
}

function downloadCSV(filename: string, csv: string) {
  downloadFile(filename, csv, 'text/csv;charset=utf-8;')
}

function downloadFile(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function printTable(title: string, headers: string[], rows: (string | number)[][]) {
  const th = headers.map(h => `<th>${h}</th>`).join('')
  const tb = rows.map(r =>
    `<tr>${r.map(c => `<td>${String(c ?? '').replace(/</g, '&lt;')}</td>`).join('')}</tr>`
  ).join('')
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/>
<title>${title}</title>
<style>
  body{font-family:system-ui,sans-serif;font-size:11px;padding:20px;color:#111}
  h2{font-size:16px;margin:0 0 12px;font-weight:700}
  table{width:100%;border-collapse:collapse}
  th{background:#1e293b;color:white;padding:6px 8px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.05em}
  td{padding:5px 8px;border-bottom:1px solid #e5e7eb;vertical-align:top;font-size:11px}
  tr:nth-child(even) td{background:#f8fafc}
  @page{margin:1cm}
</style></head><body>
<h2>${title} — ${new Date().toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'})}</h2>
<p style="font-size:11px;color:#6b7280;margin:0 0 12px">${rows.length} record${rows.length!==1?'s':''}</p>
<table><thead><tr>${th}</tr></thead><tbody>${tb}</tbody></table>
</body></html>`
  const w = window.open('', '_blank', 'width=1000,height=750')
  if (!w) return
  w.document.write(html)
  w.document.close()
  w.focus()
  w.print()
}

function fmtDate(d: Date | null | undefined): string {
  if (!d || isNaN(d.getTime()) || d.getTime() < 86_400_000) return ''
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// ── Contact field definitions ─────────────────────────────────────────────────

type ContactField = { key: keyof CustomerItem | 'fullName'; label: string; defaultOn: boolean }

const CONTACT_FIELDS: ContactField[] = [
  { key: 'first',          label: 'First Name',      defaultOn: true },
  { key: 'lastname',       label: 'Last Name',        defaultOn: true },
  { key: 'email',          label: 'Email',            defaultOn: true },
  { key: 'phone',          label: 'Phone',            defaultOn: true },
  { key: 'category',       label: 'Category',         defaultOn: true },
  { key: 'street',         label: 'Street',           defaultOn: true },
  { key: 'city',           label: 'City',             defaultOn: true },
  { key: 'state',          label: 'State',            defaultOn: true },
  { key: 'zip',            label: 'Zip',              defaultOn: false },
  { key: 'amount',         label: 'Amount',           defaultOn: true },
  { key: 'salesman',       label: 'Sales Rep',        defaultOn: true },
  { key: 'job',            label: 'Job',              defaultOn: false },
  { key: 'product',        label: 'Product',          defaultOn: false },
  { key: 'contractor',     label: 'Contractor',       defaultOn: false },
  { key: 'companyName',    label: 'Company',          defaultOn: false },
  { key: 'leadSource',     label: 'Lead Source',      defaultOn: false },
  { key: 'startDate',      label: 'Start Date',       defaultOn: false },
  { key: 'completionDate', label: 'Completion Date',  defaultOn: false },
  { key: 'followUpDate',   label: 'Follow-Up Date',   defaultOn: false },
  { key: 'creationDate',   label: 'Created',          defaultOn: false },
  { key: 'comments',       label: 'Notes',            defaultOn: false },
]

function getContactValue(c: CustomerItem, key: ContactField['key']): string | number {
  if (key === 'fullName')        return fullName(c)
  if (key === 'amount')          return c.amount
  if (key === 'startDate')       return fmtDate(c.startDate)
  if (key === 'completionDate')  return fmtDate(c.completionDate)
  if (key === 'followUpDate')    return fmtDate(c.followUpDate)
  if (key === 'creationDate')    return fmtDate(c.creationDate)
  return String((c as unknown as Record<string, unknown>)[key] ?? '')
}

type Tab = 'contacts' | 'invoices' | 'expenses'

// ── Main component ────────────────────────────────────────────────────────────

export default function ExportPage() {
  usePageTitle('Export Data')
  const companyId = useAuthStore(s => s.companyId)

  const [tab, setTab] = useState<Tab>('contacts')
  const [customers,  setCustomers]  = useState<CustomerItem[]>([])
  const [invoices,   setInvoices]   = useState<Invoice[]>([])
  const [expenses,   setExpenses]   = useState<Expense[]>([])

  // Contact filters
  const [catFilter,    setCatFilter]    = useState<string>('all')
  const [activeFilter, setActiveFilter] = useState<'all' | 'active' | 'inactive'>('active')
  const [repFilter,    setRepFilter]    = useState<string>('all')
  const [selectedFields, setSelectedFields] = useState<Set<string>>(
    () => new Set(CONTACT_FIELDS.filter(f => f.defaultOn).map(f => f.key))
  )

  // Invoice filters
  const [invStatus,    setInvStatus]    = useState<string>('all')
  const [invDateFrom,  setInvDateFrom]  = useState('')
  const [invDateTo,    setInvDateTo]    = useState('')

  // Expense filters
  const [expCat,       setExpCat]       = useState<string>('all')
  const [expDateFrom,  setExpDateFrom]  = useState('')
  const [expDateTo,    setExpDateTo]    = useState('')
  const [expReimburse, setExpReimburse] = useState<'all' | 'yes' | 'no'>('all')

  useEffect(() => {
    const u1 = subscribeToCustomers(setCustomers, () => {})
    const u2 = subscribeToInvoices(setInvoices, () => {})
    const u3 = subscribeToExpenses(setExpenses, () => {})
    return () => { u1(); u2(); u3() }
  }, [companyId])

  // All reps
  const allReps = useMemo(() => {
    const s = new Set<string>()
    customers.forEach(c => { if (c.salesman) s.add(c.salesman) })
    return Array.from(s).sort()
  }, [customers])

  // Filtered contacts
  const filteredContacts = useMemo(() => {
    return customers.filter(c => {
      if (catFilter !== 'all' && c.category.toLowerCase() !== catFilter.toLowerCase()) return false
      if (activeFilter === 'active' && !c.isActive) return false
      if (activeFilter === 'inactive' && c.isActive) return false
      if (repFilter !== 'all' && c.salesman !== repFilter) return false
      return true
    })
  }, [customers, catFilter, activeFilter, repFilter])

  // Filtered invoices
  const filteredInvoices = useMemo(() => {
    const from = invDateFrom ? new Date(invDateFrom) : null
    const to   = invDateTo   ? new Date(invDateTo + 'T23:59:59') : null
    return invoices.filter(inv => {
      if (invStatus !== 'all' && effectiveStatus(inv) !== invStatus) return false
      if (from && inv.issueDate < from) return false
      if (to   && inv.issueDate > to)   return false
      return true
    })
  }, [invoices, invStatus, invDateFrom, invDateTo])

  const invTotal = useMemo(
    () => filteredInvoices.reduce((s, inv) => s + invoiceTotal(inv), 0),
    [filteredInvoices]
  )

  // Filtered expenses
  const filteredExpenses = useMemo(() => {
    const from = expDateFrom ? new Date(expDateFrom) : null
    const to   = expDateTo   ? new Date(expDateTo + 'T23:59:59') : null
    return expenses.filter(exp => {
      if (expCat !== 'all' && exp.category !== expCat) return false
      if (expReimburse === 'yes' && !exp.isReimbursable) return false
      if (expReimburse === 'no'  &&  exp.isReimbursable) return false
      if (from && exp.date < from) return false
      if (to   && exp.date > to)   return false
      return true
    })
  }, [expenses, expCat, expDateFrom, expDateTo, expReimburse])

  const expTotal = useMemo(
    () => filteredExpenses.reduce((s, e) => s + e.amount, 0),
    [filteredExpenses]
  )

  // ── Export handlers ──────────────────────────────────────────────────────────

  function exportContactsCSV() {
    const fields = CONTACT_FIELDS.filter(f => selectedFields.has(f.key))
    const headers = fields.map(f => f.label)
    const rows = filteredContacts.map(c => fields.map(f => getContactValue(c, f.key)))
    downloadCSV(`contacts_${new Date().toISOString().slice(0,10)}.csv`, buildCSV(headers, rows))
  }

  function printContacts() {
    const fields = CONTACT_FIELDS.filter(f => selectedFields.has(f.key))
    const headers = fields.map(f => f.label)
    const rows = filteredContacts.map(c => fields.map(f => getContactValue(c, f.key)))
    printTable(`Contacts${catFilter !== 'all' ? ` — ${catFilter}s` : ''}`, headers, rows)
  }

  function exportInvoicesCSV() {
    const headers = ['Invoice #', 'Customer', 'Email', 'Issue Date', 'Due Date', 'Status', 'Subtotal', 'Tax', 'Total', 'Notes']
    const rows = filteredInvoices.map(inv => [
      inv.invoiceNumber,
      inv.customerName,
      inv.customerEmail,
      fmtDate(inv.issueDate),
      fmtDate(inv.dueDate),
      effectiveStatus(inv),
      inv.lineItems.reduce((s, l) => s + l.qty * l.rate, 0).toFixed(2),
      (inv.lineItems.reduce((s, l) => s + l.qty * l.rate, 0) * inv.taxRate / 100).toFixed(2),
      invoiceTotal(inv).toFixed(2),
      inv.notes,
    ])
    downloadCSV(`invoices_${new Date().toISOString().slice(0,10)}.csv`, buildCSV(headers, rows))
  }

  function printInvoices() {
    const headers = ['Invoice #', 'Customer', 'Issue Date', 'Due Date', 'Status', 'Total']
    const rows = filteredInvoices.map(inv => [
      inv.invoiceNumber, inv.customerName,
      fmtDate(inv.issueDate), fmtDate(inv.dueDate),
      effectiveStatus(inv), fmtCurrency(invoiceTotal(inv)),
    ])
    printTable('Invoices', headers, rows)
  }

  function exportInvoicesIIF() {
    downloadFile(`invoices_${new Date().toISOString().slice(0,10)}.iif`, buildInvoiceIIF(filteredInvoices), 'text/plain;charset=utf-8;')
  }

  function exportInvoicesQBOCSV() {
    downloadFile(`invoices_qbo_${new Date().toISOString().slice(0,10)}.csv`, buildInvoiceQBOCSV(filteredInvoices), 'text/csv;charset=utf-8;')
  }

  function exportExpensesCSV() {
    const headers = ['Date', 'Title', 'Category', 'Amount', 'Reimbursable', 'Notes']
    const rows = filteredExpenses.map(e => [
      fmtDate(e.date), e.title, e.category,
      e.amount.toFixed(2), e.isReimbursable ? 'Yes' : 'No', e.notes,
    ])
    downloadCSV(`expenses_${new Date().toISOString().slice(0,10)}.csv`, buildCSV(headers, rows))
  }

  function printExpenses() {
    const headers = ['Date', 'Title', 'Category', 'Amount', 'Reimbursable', 'Notes']
    const rows = filteredExpenses.map(e => [
      fmtDate(e.date), e.title, e.category,
      formatCurrency(e.amount), e.isReimbursable ? 'Yes' : 'No', e.notes,
    ])
    printTable('Expenses', headers, rows)
  }

  function exportExpensesQBOCSV() {
    downloadFile(`expenses_qbo_${new Date().toISOString().slice(0,10)}.csv`, buildExpenseQBOCSV(filteredExpenses), 'text/csv;charset=utf-8;')
  }

  function toggleField(key: string) {
    setSelectedFields(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">

      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Export Data</h1>
        <p className="text-sm text-gray-500 mt-0.5">Download your CRM data as CSV or print to PDF</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-gray-800/60 p-1 rounded-xl w-fit">
        {([
          { id: 'contacts', label: `Contacts (${customers.length})` },
          { id: 'invoices', label: `Invoices (${invoices.length})` },
          { id: 'expenses', label: `Expenses (${expenses.length})` },
        ] as { id: Tab; label: string }[]).map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`text-sm px-4 py-2 rounded-lg font-medium transition-colors ${
              tab === t.id ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Contacts tab ── */}
      {tab === 'contacts' && (
        <div className="space-y-4">
          {/* Filters */}
          <div className="card p-4 space-y-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Filters</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div>
                <label className="text-xs text-gray-500 block mb-1">Category</label>
                <select value={catFilter} onChange={e => setCatFilter(e.target.value)} className="input-field text-sm py-1.5 w-full">
                  <option value="all">All Categories</option>
                  {CATEGORIES.map(c => <option key={c} value={c}>{c}s</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Status</label>
                <select value={activeFilter} onChange={e => setActiveFilter(e.target.value as typeof activeFilter)} className="input-field text-sm py-1.5 w-full">
                  <option value="all">All Records</option>
                  <option value="active">Active Only</option>
                  <option value="inactive">Inactive Only</option>
                </select>
              </div>
              {allReps.length > 0 && (
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Sales Rep</label>
                  <select value={repFilter} onChange={e => setRepFilter(e.target.value)} className="input-field text-sm py-1.5 w-full">
                    <option value="all">All Reps</option>
                    {allReps.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
              )}
            </div>
          </div>

          {/* Field selection */}
          <div className="card p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Columns to Include</p>
              <div className="flex gap-3">
                <button onClick={() => setSelectedFields(new Set(CONTACT_FIELDS.map(f => f.key)))} className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors">All</button>
                <button onClick={() => setSelectedFields(new Set(CONTACT_FIELDS.filter(f => f.defaultOn).map(f => f.key)))} className="text-xs text-gray-500 hover:text-gray-300 transition-colors">Default</button>
                <button onClick={() => setSelectedFields(new Set())} className="text-xs text-gray-500 hover:text-gray-300 transition-colors">None</button>
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {CONTACT_FIELDS.map(f => (
                <label key={f.key} className="flex items-center gap-2 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={selectedFields.has(f.key)}
                    onChange={() => toggleField(f.key)}
                    className="w-3.5 h-3.5 rounded accent-indigo-500"
                  />
                  <span className={`text-xs transition-colors ${selectedFields.has(f.key) ? 'text-gray-300' : 'text-gray-600'}`}>
                    {f.label}
                  </span>
                </label>
              ))}
            </div>
          </div>

          {/* Preview + export */}
          <ExportActions
            count={filteredContacts.length}
            label="contacts"
            onCSV={exportContactsCSV}
            onPrint={printContacts}
            disabled={filteredContacts.length === 0 || selectedFields.size === 0}
            extraInfo={selectedFields.size === 0 ? 'Select at least one column' : undefined}
          />
        </div>
      )}

      {/* ── Invoices tab ── */}
      {tab === 'invoices' && (
        <div className="space-y-4">
          <div className="card p-4 space-y-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Filters</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div>
                <label className="text-xs text-gray-500 block mb-1">Status</label>
                <select value={invStatus} onChange={e => setInvStatus(e.target.value)} className="input-field text-sm py-1.5 w-full">
                  <option value="all">All Statuses</option>
                  <option value="draft">Draft</option>
                  <option value="sent">Sent</option>
                  <option value="paid">Paid</option>
                  <option value="overdue">Overdue</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Issue Date From</label>
                <input type="date" value={invDateFrom} onChange={e => setInvDateFrom(e.target.value)} className="input-field text-sm py-1.5 w-full" />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Issue Date To</label>
                <input type="date" value={invDateTo} onChange={e => setInvDateTo(e.target.value)} className="input-field text-sm py-1.5 w-full" />
              </div>
            </div>
          </div>

          <ExportActions
            count={filteredInvoices.length}
            label="invoices"
            total={invTotal}
            onCSV={exportInvoicesCSV}
            onPrint={printInvoices}
            disabled={filteredInvoices.length === 0}
          />

          <QuickBooksCard disabled={filteredInvoices.length === 0}>
            <button
              onClick={exportInvoicesIIF}
              disabled={filteredInvoices.length === 0}
              className="btn-secondary text-sm px-4 py-2 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              IIF (QuickBooks Desktop)
            </button>
            <button
              onClick={exportInvoicesQBOCSV}
              disabled={filteredInvoices.length === 0}
              className="btn-secondary text-sm px-4 py-2 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              CSV (QuickBooks Online)
            </button>
          </QuickBooksCard>
        </div>
      )}

      {/* ── Expenses tab ── */}
      {tab === 'expenses' && (
        <div className="space-y-4">
          <div className="card p-4 space-y-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Filters</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div>
                <label className="text-xs text-gray-500 block mb-1">Category</label>
                <select value={expCat} onChange={e => setExpCat(e.target.value)} className="input-field text-sm py-1.5 w-full">
                  <option value="all">All Categories</option>
                  {EXPENSE_CATEGORIES.map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Date From</label>
                <input type="date" value={expDateFrom} onChange={e => setExpDateFrom(e.target.value)} className="input-field text-sm py-1.5 w-full" />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Date To</label>
                <input type="date" value={expDateTo} onChange={e => setExpDateTo(e.target.value)} className="input-field text-sm py-1.5 w-full" />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Reimbursable</label>
                <select value={expReimburse} onChange={e => setExpReimburse(e.target.value as typeof expReimburse)} className="input-field text-sm py-1.5 w-full">
                  <option value="all">All</option>
                  <option value="yes">Reimbursable Only</option>
                  <option value="no">Non-Reimbursable Only</option>
                </select>
              </div>
            </div>
          </div>

          <ExportActions
            count={filteredExpenses.length}
            label="expenses"
            total={expTotal}
            onCSV={exportExpensesCSV}
            onPrint={printExpenses}
            disabled={filteredExpenses.length === 0}
          />

          <QuickBooksCard disabled={filteredExpenses.length === 0}>
            <button
              onClick={exportExpensesQBOCSV}
              disabled={filteredExpenses.length === 0}
              className="btn-secondary text-sm px-4 py-2 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              CSV (QuickBooks Online)
            </button>
          </QuickBooksCard>
        </div>
      )}
    </div>
  )
}

// ── Shared export actions card ────────────────────────────────────────────────

function ExportActions({
  count, label, total, onCSV, onPrint, disabled, extraInfo,
}: {
  count: number
  label: string
  total?: number
  onCSV: () => void
  onPrint: () => void
  disabled: boolean
  extraInfo?: string
}) {
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <p className="text-white font-semibold">
            {count.toLocaleString()} {label} ready to export
          </p>
          {total !== undefined && (
            <p className="text-sm text-gray-400">
              Total: {total.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}
            </p>
          )}
          {extraInfo && <p className="text-xs text-yellow-400 mt-0.5">{extraInfo}</p>}
        </div>
        <div className="flex gap-2">
          <button
            onClick={onPrint}
            disabled={disabled}
            className="btn-secondary text-sm px-4 py-2 flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6.72 13.829c-.24.03-.48.062-.72.096m.72-.096a42.415 42.415 0 0 1 10.56 0m-10.56 0L6.34 18m10.94-4.171c.24.03.48.062.72.096m-.72-.096L17.66 18m0 0 .229 2.523a1.125 1.125 0 0 1-1.12 1.227H7.231c-.662 0-1.18-.568-1.12-1.227L6.34 18m11.318 0h1.091A2.25 2.25 0 0 0 21 15.75V9.456c0-1.081-.768-2.015-1.837-2.175a48.055 48.055 0 0 0-1.913-.247M6.34 18H5.25A2.25 2.25 0 0 1 3 15.75V9.456c0-1.081.768-2.015 1.837-2.175a48.041 48.041 0 0 1 1.913-.247m10.5 0a48.536 48.536 0 0 0-10.5 0m10.5 0V3.375c0-.621-.504-1.125-1.125-1.125h-8.25c-.621 0-1.125.504-1.125 1.125v3.659M18 10.5h.008v.008H18V10.5Zm-3 0h.008v.008H15V10.5Z" />
            </svg>
            Print / PDF
          </button>
          <button
            onClick={onCSV}
            disabled={disabled}
            className="btn-primary text-sm px-4 py-2 flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
            </svg>
            Export CSV
          </button>
        </div>
      </div>
    </div>
  )
}

// ── QuickBooks export card ────────────────────────────────────────────────────

function QuickBooksCard({ disabled, children }: { disabled: boolean; children: React.ReactNode }) {
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <p className="text-white font-semibold">QuickBooks</p>
          <p className="text-xs text-gray-500 mt-0.5">
            {disabled ? 'No records match the current filters' : 'IIF imports into QuickBooks Desktop; CSV matches QuickBooks Online\'s importer columns'}
          </p>
        </div>
        <div className="flex gap-2">{children}</div>
      </div>
    </div>
  )
}
