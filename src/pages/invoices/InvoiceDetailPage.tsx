import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { usePageTitle } from '../../hooks/usePageTitle'
import { getInvoice, updateInvoice, deleteInvoice } from '../../services/invoiceService'
import { generateShareToken } from '../../services/publicInvoiceService'
import {
  effectiveStatus, fmtCurrency, invoiceSubtotal, invoiceTaxAmount, invoiceTotal,
  lineItemTotal, statusClasses, statusLabel,
  type Invoice,
} from '../../models/invoice'
import { useToast } from '../../components/Toast'
import ConfirmModal from '../../components/ConfirmModal'
import { isSafeHttpUrl } from '../../utils/safeUrl'

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
  const [sharing, setSharing] = useState(false)

  // Company info (persisted, same keys as QuotePage)
  const [coName,  setCoName]  = useState(() => localStorage.getItem(CO_NAME_KEY)  ?? '')
  const [coAddr,  setCoAddr]  = useState(() => localStorage.getItem(CO_ADDR_KEY)  ?? '')
  const [coPhone, setCoPhone] = useState(() => localStorage.getItem(CO_PHONE_KEY) ?? '')
  const [coEmail, setCoEmail] = useState(() => localStorage.getItem(CO_EMAIL_KEY) ?? '')
  const [editCo,  setEditCo]  = useState(false)

  // Payment link
  const [paymentLinkInput, setPaymentLinkInput] = useState('')
  const [savingLink, setSavingLink] = useState(false)
  const [editLink, setEditLink] = useState(false)

  usePageTitle(invoice ? `Invoice ${invoice.invoiceNumber}` : 'Invoice')

  // Sync payment link input when invoice loads
  useEffect(() => {
    if (invoice) setPaymentLinkInput(invoice.paymentLink ?? '')
  }, [invoice?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!id) return
    getInvoice(id).then(inv => { setInvoice(inv); setLoading(false) })
  }, [id])


  async function handleShare() {
    if (!invoice) return
    setSharing(true)
    try {
      const token = await generateShareToken(invoice, {
        name: coName, address: coAddr, phone: coPhone, email: coEmail,
      })
      setInvoice({ ...invoice, shareToken: token })
      const url = `${window.location.origin}/i/${token}`
      await navigator.clipboard.writeText(url)
      toast('Share link copied to clipboard!', 'success')
    } catch {
      toast('Could not generate share link', 'error')
    } finally {
      setSharing(false)
    }
  }

  async function savePaymentLink() {
    if (!id || !invoice) return
    const trimmed = paymentLinkInput.trim() || null
    if (trimmed && !isSafeHttpUrl(trimmed)) {
      toast('Payment link must be a valid http:// or https:// URL', 'error')
      return
    }
    setSavingLink(true)
    try {
      await updateInvoice(id, { paymentLink: trimmed })
      setInvoice({ ...invoice, paymentLink: trimmed })
      setEditLink(false)
      toast(trimmed ? 'Payment link saved' : 'Payment link removed', 'success')
    } catch {
      toast('Could not save payment link', 'error')
    } finally {
      setSavingLink(false)
    }
  }

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

  function handlePrint() {
    if (!invoice) return
    const subtotal = invoiceSubtotal(invoice)
    const taxAmt   = invoiceTaxAmount(invoice)
    const total    = invoiceTotal(invoice)

    const itemRows = invoice.lineItems.map(item => `
      <tr>
        <td>${item.description || '—'}</td>
        <td class="center">${item.qty}</td>
        <td class="right">${fmtCurrency(item.rate)}</td>
        <td class="right bold">${fmtCurrency(lineItemTotal(item))}</td>
      </tr>`).join('')

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>Invoice ${invoice.invoiceNumber}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, Helvetica, Arial, sans-serif; font-size: 13px; color: #111; background: white; padding: 40px 48px; }
    .header { background: white; color: #111; padding: 28px 32px; display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #e5e7eb; }
    .header-left h1 { font-size: 22px; font-weight: 700; color: #111; }
    .header-left p { font-size: 12px; color: #6b7280; margin-top: 2px; }
    .header-right { text-align: right; }
    .header-right .inv-title { font-size: 28px; font-weight: 800; letter-spacing: .05em; color: #111; }
    .header-right .inv-num { font-size: 12px; color: #6b7280; font-family: monospace; margin-top: 4px; }
    .meta { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 24px; padding: 20px 32px; border-bottom: 1px solid #e5e7eb; }
    .meta-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .07em; color: #6b7280; margin-bottom: 4px; }
    .meta-value { font-size: 14px; font-weight: 600; color: #111; }
    .meta-sub { font-size: 12px; color: #6b7280; margin-top: 2px; }
    .items { padding: 20px 32px; }
    table { width: 100%; border-collapse: collapse; }
    thead tr { border-bottom: 2px solid #e5e7eb; }
    th { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; color: #6b7280; padding-bottom: 8px; text-align: left; }
    th.center { text-align: center; width: 60px; }
    th.right { text-align: right; width: 100px; }
    td { padding: 10px 0; border-bottom: 1px solid #f3f4f6; font-size: 13px; color: #111; vertical-align: top; }
    td.center { text-align: center; color: #374151; }
    td.right { text-align: right; color: #374151; }
    td.bold { font-weight: 600; }
    .subtotal-row td { border-bottom: none; font-size: 13px; color: #6b7280; padding: 4px 0; }
    .total-row td { border-top: 2px solid #111; padding-top: 10px; font-size: 18px; font-weight: 700; color: #111; }
    .totals { padding: 0 32px 24px; display: flex; justify-content: flex-end; }
    .totals-inner { min-width: 240px; }
    .subtotal-line { display: flex; justify-content: space-between; font-size: 13px; color: #6b7280; padding-bottom: 5px; }
    .total-line { display: flex; justify-content: space-between; font-size: 18px; font-weight: 700; color: #111; border-top: 2px solid #111; padding-top: 8px; margin-top: 4px; }
    .notes { padding: 16px 32px; border-top: 1px solid #e5e7eb; }
    .notes-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .07em; color: #6b7280; margin-bottom: 6px; }
    .notes-body { font-size: 12px; color: #374151; white-space: pre-wrap; }
    .footer { background: white; color: #6b7280; text-align: center; padding: 14px; font-size: 11px; border-top: 1px solid #e5e7eb; }
    @media print { body { padding: 0; } @page { margin: 1cm; } }
  </style>
</head>
<body>
  <div class="header">
    <div class="header-left">
      <h1>${coName || 'Invoice'}</h1>
      ${coAddr  ? `<p>${coAddr}</p>`  : ''}
      ${coPhone ? `<p>${coPhone}</p>` : ''}
      ${coEmail ? `<p>${coEmail}</p>` : ''}
    </div>
    <div class="header-right">
      <div class="inv-title">INVOICE</div>
      <div class="inv-num">${invoice.invoiceNumber}</div>
    </div>
  </div>

  <div class="meta">
    <div>
      <div class="meta-label">Bill To</div>
      <div class="meta-value">${invoice.customerName}</div>
      ${invoice.customerAddress ? `<div class="meta-sub">${invoice.customerAddress}</div>` : ''}
      ${invoice.customerPhone   ? `<div class="meta-sub">${invoice.customerPhone}</div>`   : ''}
      ${invoice.customerEmail   ? `<div class="meta-sub">${invoice.customerEmail}</div>`   : ''}
    </div>
    <div>
      <div class="meta-label">Issue Date</div>
      <div class="meta-value">${fmtDate(invoice.issueDate)}</div>
    </div>
    <div>
      <div class="meta-label">Due Date</div>
      <div class="meta-value">${fmtDate(invoice.dueDate)}</div>
    </div>
  </div>

  <div class="items">
    <table>
      <thead>
        <tr>
          <th>Description</th>
          <th class="center">Qty</th>
          <th class="right">Rate</th>
          <th class="right">Amount</th>
        </tr>
      </thead>
      <tbody>${itemRows}</tbody>
    </table>
  </div>

  <div class="totals">
    <div class="totals-inner">
      <div class="subtotal-line"><span>Subtotal</span><span>${fmtCurrency(subtotal)}</span></div>
      ${invoice.taxRate > 0 ? `<div class="subtotal-line"><span>Tax (${invoice.taxRate}%)</span><span>${fmtCurrency(taxAmt)}</span></div>` : ''}
      <div class="total-line"><span>Total</span><span>${fmtCurrency(total)}</span></div>
    </div>
  </div>

  ${invoice.notes ? `<div class="notes"><div class="notes-label">Notes</div><div class="notes-body">${invoice.notes}</div></div>` : ''}

  <div class="footer">Thank you for your business!</div>
</body>
</html>`

    const w = window.open('', '_blank', 'width=900,height=750')
    if (!w) return
    w.document.write(html)
    w.document.close()
    w.focus()
    w.print()
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
            onClick={handleShare}
            disabled={sharing}
            className="btn-secondary text-sm px-3 py-1.5"
            title={invoice?.shareToken ? 'Refresh and copy share link' : 'Generate customer share link'}
          >
            {sharing ? '…' : invoice?.shareToken ? '🔗 Share Link' : '🔗 Share'}
          </button>
          <button
            onClick={handlePrint}
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
          {invoice?.recurring && (
            <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-violet-900/30 text-violet-400 border border-violet-700/30 flex items-center gap-1">
              ↻ {invoice.recurring.charAt(0).toUpperCase() + invoice.recurring.slice(1)}
              {invoice.nextRecurDate && (
                <span className="text-violet-500">· Next {invoice.nextRecurDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
              )}
            </span>
          )}
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

      {/* Online Payments — hidden when printing */}
      <div className="no-print card overflow-hidden">
        <div className="px-4 py-2 border-b border-gray-700/50 bg-gray-800/50 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Online Payments</p>
            {invoice.paymentLink && (
              <span className="text-xs bg-green-500/15 text-green-400 px-2 py-0.5 rounded-full font-medium">Active</span>
            )}
          </div>
          <button
            onClick={() => editLink ? savePaymentLink() : setEditLink(true)}
            disabled={savingLink}
            className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors disabled:opacity-40"
          >
            {savingLink ? 'Saving…' : editLink ? 'Save' : invoice.paymentLink ? 'Edit' : 'Add Link'}
          </button>
        </div>

        {editLink ? (
          <div className="p-4 space-y-3">
            <div>
              <label className="text-xs text-gray-500 block mb-1.5">Payment Link URL</label>
              <input
                autoFocus
                type="url"
                value={paymentLinkInput}
                onChange={e => setPaymentLinkInput(e.target.value)}
                placeholder="https://buy.stripe.com/… or any payment URL"
                className="input-field w-full text-sm"
              />
              <p className="text-xs text-gray-600 mt-1.5">
                Paste a Stripe Payment Link, PayPal, or any payment URL. When set, the "Pay Now" button on the shared invoice will link directly to it.
              </p>
            </div>
            <div className="bg-gray-800/60 rounded-xl p-3 space-y-2">
              <p className="text-xs font-semibold text-gray-400">Stripe Checkout (auto-generated)</p>
              <p className="text-xs text-gray-500">
                For per-invoice Stripe Checkout Sessions, configure <code className="text-gray-400">STRIPE_SECRET_KEY</code> in Firebase:
              </p>
              <div className="flex items-center gap-2">
                <code className="text-xs text-gray-400 bg-gray-900 rounded px-2 py-1 flex-1 truncate font-mono">
                  printf 'sk_live_…' | npx firebase-tools functions:secrets:set STRIPE_SECRET_KEY --data-file -
                </code>
              </div>
              <p className="text-xs text-gray-500">
                Webhook URL for Stripe dashboard:
              </p>
              <div className="flex items-center gap-2">
                <code className="text-xs text-gray-400 bg-gray-900 rounded px-2 py-1 flex-1 truncate font-mono">
                  https://us-central1-thelightui.cloudfunctions.net/stripeWebhook
                </code>
                <button
                  onClick={() => navigator.clipboard.writeText('https://us-central1-thelightui.cloudfunctions.net/stripeWebhook').then(() => toast('Copied!', 'success'))}
                  className="text-xs text-gray-400 hover:text-gray-200 px-2 py-1 rounded hover:bg-gray-700 transition-colors shrink-0"
                >
                  Copy
                </button>
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={savePaymentLink} disabled={savingLink} className="btn-primary text-xs px-4 py-1.5 disabled:opacity-40">
                {savingLink ? 'Saving…' : 'Save'}
              </button>
              <button onClick={() => { setEditLink(false); setPaymentLinkInput(invoice.paymentLink ?? '') }} className="btn-secondary text-xs px-4 py-1.5">
                Cancel
              </button>
              {invoice.paymentLink && (
                <button
                  onClick={() => { setPaymentLinkInput(''); savePaymentLink() }}
                  className="text-xs text-gray-500 hover:text-red-400 transition-colors px-3 py-1.5"
                >
                  Remove
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="px-4 py-2">
            {invoice.paymentLink ? (
              <div className="flex items-center gap-2">
                {isSafeHttpUrl(invoice.paymentLink) ? (
                  <a
                    href={invoice.paymentLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-green-400 hover:text-green-300 transition-colors truncate flex-1"
                  >
                    {invoice.paymentLink}
                  </a>
                ) : (
                  <span className="text-xs text-red-400 truncate flex-1" title="This link isn't a valid http:// or https:// URL and won't be used">
                    ⚠️ {invoice.paymentLink}
                  </span>
                )}
                <button
                  onClick={() => navigator.clipboard.writeText(invoice.paymentLink!).then(() => toast('Copied!', 'success'))}
                  className="text-xs text-gray-500 hover:text-gray-200 shrink-0 px-2 py-1 rounded hover:bg-gray-700 transition-colors"
                >
                  Copy
                </button>
              </div>
            ) : (
              <p className="text-xs text-gray-600 italic">
                Add a Stripe Payment Link so customers can pay online from the shared invoice.
                {!invoice.shareToken && ' Generate a share link first.'}
              </p>
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
