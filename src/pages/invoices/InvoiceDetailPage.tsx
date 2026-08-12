import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { usePageTitle } from '../../hooks/usePageTitle'
import { getInvoice, updateInvoice, deleteInvoice } from '../../services/invoiceService'
import {
  effectiveStatus, fmtCurrency, invoiceSubtotal, invoiceTaxAmount, invoiceTotal,
  lineItemTotal, statusClasses, statusLabel,
  type Invoice,
} from '../../models/invoice'
import { useToast } from '../../components/Toast'
import ConfirmModal from '../../components/ConfirmModal'

const CO_NAME_KEY  = 'thelight.co.name'
const CO_ADDR_KEY  = 'thelight.co.address'
const CO_PHONE_KEY = 'thelight.co.phone'
const CO_EMAIL_KEY = 'thelight.co.email'

export default function InvoiceDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const toast = useToast()

  const [invoice, setInvoice] = useState<Invoice | null>(null)
  const [loading, setLoading] = useState(true)
  const [statusSaving, setStatusSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  // Company info (persisted, same keys as QuotePage)
  const [coName,  setCoName]  = useState(() => localStorage.getItem(CO_NAME_KEY)  ?? '')
  const [coAddr,  setCoAddr]  = useState(() => localStorage.getItem(CO_ADDR_KEY)  ?? '')
  const [coPhone, setCoPhone] = useState(() => localStorage.getItem(CO_PHONE_KEY) ?? '')
  const [coEmail, setCoEmail] = useState(() => localStorage.getItem(CO_EMAIL_KEY) ?? '')
  const [editCo,  setEditCo]  = useState(false)

  usePageTitle(invoice ? `Invoice ${invoice.invoiceNumber}` : 'Invoice')

  useEffect(() => {
    if (!id) return
    getInvoice(id).then(inv => { setInvoice(inv); setLoading(false) })
  }, [id])

  // Inject print CSS
  useEffect(() => {
    const style = document.createElement('style')
    style.id = 'invoice-print-css'
    style.textContent = `
      @media print {
        aside, nav, header, .no-print { display: none !important; }
        body { background: white !important; color: black !important; }
        .print-doc { box-shadow: none !important; border: none !important; color: black !important; background: white !important; }
        .print-doc * { color: black !important; border-color: #ddd !important; }
        .print-doc .print-accent { background: #1e293b !important; color: white !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        .print-doc .print-accent * { color: white !important; }
      }
    `
    document.head.appendChild(style)
    return () => { document.getElementById('invoice-print-css')?.remove() }
  }, [])

  function saveCoInfo() {
    localStorage.setItem(CO_NAME_KEY,  coName)
    localStorage.setItem(CO_ADDR_KEY,  coAddr)
    localStorage.setItem(CO_PHONE_KEY, coPhone)
    localStorage.setItem(CO_EMAIL_KEY, coEmail)
    setEditCo(false)
  }

  async function setStatus(status: Invoice['status']) {
    if (!invoice || !id) return
    setStatusSaving(true)
    try {
      await updateInvoice(id, { status })
      setInvoice({ ...invoice, status })
    } catch {
      toast('Could not update status', 'error')
    } finally {
      setStatusSaving(false)
    }
  }

  async function handleDelete() {
    if (!id) return
    setDeleting(true)
    setConfirmDelete(false)
    try {
      await deleteInvoice(id)
      navigate('/invoices')
    } finally {
      setDeleting(false)
    }
  }

  function fmtDate(d: Date) {
    return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[300px]">
        <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!invoice) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16 text-center">
        <p className="text-gray-400">Invoice not found.</p>
        <Link to="/invoices" className="mt-4 text-indigo-400 hover:text-indigo-300 block">← Back to Invoices</Link>
      </div>
    )
  }

  const status  = effectiveStatus(invoice)
  const subtotal = invoiceSubtotal(invoice)
  const taxAmt   = invoiceTaxAmount(invoice)
  const total    = invoiceTotal(invoice)

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 space-y-4">

      {/* Controls — hidden when printing */}
      <div className="no-print flex items-center justify-between gap-3 flex-wrap">
        <Link to="/invoices" className="text-sm text-indigo-400 hover:text-indigo-300">
          ← Invoices
        </Link>
        <div className="flex items-center gap-2 flex-wrap">
          <Link to={`/invoices/${id}/edit`} className="btn-secondary text-sm px-3 py-1.5">Edit</Link>
          <button
            onClick={() => window.print()}
            className="btn-secondary text-sm px-3 py-1.5"
          >
            🖨️ Print
          </button>
          <button
            onClick={() => setConfirmDelete(true)}
            disabled={deleting}
            className="btn-danger text-sm px-3 py-1.5"
          >
            Delete
          </button>
        </div>
      </div>

      {/* Status bar — hidden when printing */}
      <div className="no-print card p-4 flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-1">
          <span className={`px-2.5 py-1 rounded-full text-xs font-semibold border ${statusClasses(status)}`}>
            {statusLabel(status)}
          </span>
          {statusSaving && (
            <span className="w-3.5 h-3.5 border border-gray-500 border-t-transparent rounded-full animate-spin" />
          )}
        </div>
        <div className="flex gap-2 flex-wrap">
          {status !== 'sent' && status !== 'paid' && (
            <button onClick={() => setStatus('sent')} disabled={statusSaving} className="btn-secondary text-xs px-3 py-1.5">
              Mark Sent
            </button>
          )}
          {status !== 'paid' && (
            <button
              onClick={() => setStatus('paid')}
              disabled={statusSaving}
              className="text-xs px-3 py-1.5 rounded-xl bg-green-600/20 text-green-400 border border-green-700/30 hover:bg-green-600/30 transition-colors disabled:opacity-40"
            >
              ✓ Mark Paid
            </button>
          )}
          {status === 'paid' && (
            <button onClick={() => setStatus('sent')} disabled={statusSaving} className="btn-secondary text-xs px-3 py-1.5">
              Unmark Paid
            </button>
          )}
          {invoice.customerEmail && (
            <a
              href={`mailto:${invoice.customerEmail}?subject=Invoice ${invoice.invoiceNumber}&body=Hi ${invoice.customerName},%0A%0APlease find attached invoice ${invoice.invoiceNumber} for ${fmtCurrency(total)}, due ${fmtDate(invoice.dueDate)}.%0A%0AThank you for your business.`}
              className="text-xs px-3 py-1.5 rounded-xl bg-indigo-600/20 text-indigo-300 border border-indigo-700/30 hover:bg-indigo-600/30 transition-colors"
            >
              ✉️ Email Customer
            </a>
          )}
        </div>
      </div>

      {/* Company info editor — hidden when printing */}
      <div className="no-print card overflow-hidden">
        <div className="px-4 py-2 border-b border-gray-700/50 bg-gray-800/50 flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Your Company Info</p>
          <button
            onClick={() => editCo ? saveCoInfo() : setEditCo(true)}
            className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
          >
            {editCo ? 'Save' : 'Edit'}
          </button>
        </div>
        {editCo ? (
          <div className="p-3 grid grid-cols-2 gap-2">
            <input type="text" value={coName}  onChange={e => setCoName(e.target.value)}  placeholder="Company name" className="input-field text-sm py-1.5 col-span-2" />
            <input type="text" value={coAddr}  onChange={e => setCoAddr(e.target.value)}  placeholder="Address"      className="input-field text-sm py-1.5 col-span-2" />
            <input type="text" value={coPhone} onChange={e => setCoPhone(e.target.value)} placeholder="Phone"        className="input-field text-sm py-1.5" />
            <input type="text" value={coEmail} onChange={e => setCoEmail(e.target.value)} placeholder="Email"        className="input-field text-sm py-1.5" />
          </div>
        ) : (
          <div className="px-4 py-2">
            {coName || coAddr || coPhone ? (
              <p className="text-xs text-gray-500">{[coName, coAddr, coPhone, coEmail].filter(Boolean).join(' · ')}</p>
            ) : (
              <p className="text-xs text-gray-600 italic">Click Edit to add your company info — it will appear on the invoice header.</p>
            )}
          </div>
        )}
      </div>

      {/* ── INVOICE DOCUMENT ──────────────────────────────── */}
      <div className="print-doc bg-white rounded-2xl shadow-lg overflow-hidden text-gray-900">

        {/* Header band */}
        <div className="print-accent bg-slate-800 px-8 py-6 flex items-start justify-between gap-4">
          <div>
            <p className="text-2xl font-bold text-white">{coName || 'Invoice'}</p>
            {coAddr  && <p className="text-slate-300 text-sm mt-0.5">{coAddr}</p>}
            {coPhone && <p className="text-slate-300 text-sm">{coPhone}</p>}
            {coEmail && <p className="text-slate-300 text-sm">{coEmail}</p>}
          </div>
          <div className="text-right shrink-0">
            <p className="text-3xl font-bold text-white">INVOICE</p>
            <p className="text-slate-300 text-sm font-mono mt-1">{invoice.invoiceNumber}</p>
          </div>
        </div>

        {/* Meta row */}
        <div className="px-8 py-5 grid grid-cols-3 gap-6 border-b border-gray-100">
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Bill To</p>
            <p className="font-semibold text-gray-900">{invoice.customerName}</p>
            {invoice.customerAddress && <p className="text-sm text-gray-600 mt-0.5">{invoice.customerAddress}</p>}
            {invoice.customerPhone   && <p className="text-sm text-gray-600">{invoice.customerPhone}</p>}
            {invoice.customerEmail   && <p className="text-sm text-gray-600">{invoice.customerEmail}</p>}
          </div>
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Issue Date</p>
            <p className="font-semibold text-gray-900">{fmtDate(invoice.issueDate)}</p>
          </div>
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Due Date</p>
            <p className="font-semibold text-gray-900">{fmtDate(invoice.dueDate)}</p>
          </div>
        </div>

        {/* Line items table */}
        <div className="px-8 py-5">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
                <th style={{ textAlign: 'left', paddingBottom: '8px', fontSize: '11px', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Description</th>
                <th style={{ textAlign: 'center', paddingBottom: '8px', fontSize: '11px', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', width: '60px' }}>Qty</th>
                <th style={{ textAlign: 'right', paddingBottom: '8px', fontSize: '11px', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', width: '100px' }}>Rate</th>
                <th style={{ textAlign: 'right', paddingBottom: '8px', fontSize: '11px', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', width: '100px' }}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {invoice.lineItems.map((item, idx) => (
                <tr key={idx} style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <td style={{ padding: '10px 0', fontSize: '14px', color: '#111827' }}>{item.description || '—'}</td>
                  <td style={{ padding: '10px 0', fontSize: '14px', color: '#374151', textAlign: 'center' }}>{item.qty}</td>
                  <td style={{ padding: '10px 0', fontSize: '14px', color: '#374151', textAlign: 'right' }}>{fmtCurrency(item.rate)}</td>
                  <td style={{ padding: '10px 0', fontSize: '14px', fontWeight: 500, color: '#111827', textAlign: 'right' }}>{fmtCurrency(lineItemTotal(item))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Totals */}
        <div className="px-8 pb-6 flex justify-end">
          <div style={{ minWidth: '220px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: '6px', color: '#6b7280', fontSize: '14px' }}>
              <span>Subtotal</span>
              <span>{fmtCurrency(subtotal)}</span>
            </div>
            {invoice.taxRate > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: '6px', color: '#6b7280', fontSize: '14px' }}>
                <span>Tax ({invoice.taxRate}%)</span>
                <span>{fmtCurrency(taxAmt)}</span>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '2px solid #111827', paddingTop: '8px', marginTop: '4px', fontWeight: 700, fontSize: '18px', color: '#111827' }}>
              <span>Total</span>
              <span>{fmtCurrency(total)}</span>
            </div>
          </div>
        </div>

        {/* Notes */}
        {invoice.notes && (
          <div className="px-8 py-4 border-t border-gray-100">
            <p style={{ fontSize: '11px', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>Notes</p>
            <p style={{ fontSize: '13px', color: '#374151', whiteSpace: 'pre-wrap' }}>{invoice.notes}</p>
          </div>
        )}

        {/* Footer */}
        <div className="print-accent bg-slate-800 px-8 py-4 text-center">
          <p className="text-slate-400 text-xs">Thank you for your business!</p>
        </div>
      </div>

      <ConfirmModal
        isOpen={confirmDelete}
        message={`Delete invoice ${invoice.invoiceNumber}? This cannot be undone.`}
        onConfirm={handleDelete}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  )
}
