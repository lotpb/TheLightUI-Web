import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { usePageTitle } from '../../hooks/usePageTitle'
import { getProposal, updateProposal, deleteProposal, convertProposalToInvoice } from '../../services/proposalService'
import { generateShareToken } from '../../services/publicProposalService'
import {
  effectiveStatus, fmtCurrency, proposalSubtotal, proposalTaxAmount, proposalTotal,
  lineItemTotal, statusClasses, statusLabel,
  type Proposal,
} from '../../models/proposal'
import { useToast } from '../../components/Toast'
import ConfirmModal from '../../components/ConfirmModal'
import { subscribeToCompanyProfile } from '../../services/companyProfileService'

export default function ProposalDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const toast = useToast()

  const [proposal, setProposal] = useState<Proposal | null>(null)
  const [loading, setLoading] = useState(true)
  const [statusSaving, setStatusSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [sharing, setSharing] = useState(false)
  const [converting, setConverting] = useState(false)

  // Company info — shared across the team via Firestore (companyProfileService)
  const [coName,  setCoName]  = useState('')
  const [coAddr,  setCoAddr]  = useState('')
  const [coPhone, setCoPhone] = useState('')
  const [coEmail, setCoEmail] = useState('')

  useEffect(() => subscribeToCompanyProfile(
    p => { setCoName(p.name); setCoAddr(p.address); setCoPhone(p.phone); setCoEmail(p.email) },
    () => {},
  ), [])

  usePageTitle(proposal ? `Proposal ${proposal.proposalNumber}` : 'Proposal')

  useEffect(() => {
    if (!id) return
    getProposal(id).then(p => { setProposal(p); setLoading(false) })
  }, [id])

  async function handleShare() {
    if (!proposal) return
    setSharing(true)
    try {
      const token = await generateShareToken(proposal, {
        name: coName, address: coAddr, phone: coPhone, email: coEmail,
      })
      setProposal({ ...proposal, shareToken: token })
      const url = `${window.location.origin}/p/${token}`
      await navigator.clipboard.writeText(url)
      toast('Share link copied to clipboard!', 'success')
    } catch {
      toast('Could not generate share link', 'error')
    } finally {
      setSharing(false)
    }
  }

  async function setStatus(status: Proposal['status']) {
    if (!proposal || !id) return
    setStatusSaving(true)
    try {
      await updateProposal(id, { status })
      setProposal({ ...proposal, status })
    } catch {
      toast('Could not update status', 'error')
    } finally {
      setStatusSaving(false)
    }
  }

  async function handleConvert() {
    if (!proposal) return
    setConverting(true)
    try {
      const invoiceId = await convertProposalToInvoice(proposal)
      toast('Converted to invoice', 'success')
      navigate(`/invoices/${invoiceId}`)
    } catch {
      toast('Could not convert to invoice', 'error')
    } finally {
      setConverting(false)
    }
  }

  async function handleDelete() {
    if (!id) return
    setDeleting(true)
    setConfirmDelete(false)
    try {
      await deleteProposal(id)
      navigate('/proposals')
    } finally {
      setDeleting(false)
    }
  }

  function fmtDate(d: Date) {
    return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
  }

  function timeAgo(d: Date): string {
    const diff = Date.now() - d.getTime()
    const mins = Math.floor(diff / 60_000)
    if (mins < 1)  return 'just now'
    if (mins < 60) return `${mins}m ago`
    const hrs = Math.floor(mins / 60)
    if (hrs < 24)  return `${hrs}h ago`
    const days = Math.floor(hrs / 24)
    if (days < 7)  return `${days}d ago`
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[300px]">
        <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!proposal) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16 text-center">
        <p className="text-gray-400">Proposal not found.</p>
        <Link to="/proposals" className="mt-4 text-indigo-400 hover:text-indigo-300 block">← Back to Proposals</Link>
      </div>
    )
  }

  const status   = effectiveStatus(proposal)
  const subtotal = proposalSubtotal(proposal)
  const taxAmt   = proposalTaxAmount(proposal)
  const total    = proposalTotal(proposal)

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 space-y-4">

      {/* Controls */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <Link to="/proposals" className="text-sm text-indigo-400 hover:text-indigo-300">
          ← Proposals
        </Link>
        <div className="flex items-center gap-2 flex-wrap">
          <Link to={`/proposals/${id}/edit`} className="btn-secondary text-sm px-3 py-1.5">Edit</Link>
          <button
            onClick={handleShare}
            disabled={sharing}
            className="btn-secondary text-sm px-3 py-1.5"
            title={proposal.shareToken ? 'Refresh and copy share link' : 'Generate customer share link'}
          >
            {sharing ? '…' : proposal.shareToken ? '🔗 Share Link' : '🔗 Share'}
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

      {/* Status bar */}
      <div className="card p-4 flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-1">
          <span className={`px-2.5 py-1 rounded-full text-xs font-semibold border ${statusClasses(status)}`}>
            {statusLabel(status)}
          </span>
          {proposal.respondedAt && (status === 'accepted' || status === 'declined') && (
            <span className="text-xs text-gray-500">on {fmtDate(proposal.respondedAt)}</span>
          )}
          {statusSaving && (
            <span className="w-3.5 h-3.5 border border-gray-500 border-t-transparent rounded-full animate-spin" />
          )}
          {proposal.lastReminderSentAt && (
            <span className="text-xs text-gray-500" title={proposal.lastReminderSentAt.toLocaleString()}>
              ✉️ Reminded {timeAgo(proposal.lastReminderSentAt)}
            </span>
          )}
        </div>
        <div className="flex gap-2 flex-wrap">
          {status === 'draft' && (
            <button onClick={() => setStatus('sent')} disabled={statusSaving} className="btn-secondary text-xs px-3 py-1.5">
              Mark Sent
            </button>
          )}
          {(status === 'sent' || status === 'expired') && (
            <>
              <button
                onClick={() => setStatus('accepted')}
                disabled={statusSaving}
                className="text-xs px-3 py-1.5 rounded-xl bg-green-600/20 text-green-400 border border-green-700/30 hover:bg-green-600/30 transition-colors disabled:opacity-40"
              >
                ✓ Mark Accepted
              </button>
              <button
                onClick={() => setStatus('declined')}
                disabled={statusSaving}
                className="text-xs px-3 py-1.5 rounded-xl bg-red-600/20 text-red-400 border border-red-700/30 hover:bg-red-600/30 transition-colors disabled:opacity-40"
              >
                ✕ Mark Declined
              </button>
            </>
          )}
          {status === 'accepted' && !proposal.convertedInvoiceId && (
            <button
              onClick={handleConvert}
              disabled={converting}
              className="text-xs px-3 py-1.5 rounded-xl bg-indigo-600/20 text-indigo-300 border border-indigo-700/30 hover:bg-indigo-600/30 transition-colors disabled:opacity-40"
            >
              {converting ? 'Converting…' : '🧾 Convert to Invoice'}
            </button>
          )}
          {proposal.convertedInvoiceId && (
            <Link
              to={`/invoices/${proposal.convertedInvoiceId}`}
              className="text-xs px-3 py-1.5 rounded-xl bg-emerald-600/20 text-emerald-300 border border-emerald-700/30 hover:bg-emerald-600/30 transition-colors"
            >
              View Invoice →
            </Link>
          )}
          {proposal.customerEmail && (
            <a
              href={`mailto:${proposal.customerEmail}?subject=Proposal ${proposal.proposalNumber}&body=Hi ${proposal.customerName},%0A%0APlease find attached proposal ${proposal.proposalNumber} for ${fmtCurrency(total)}, valid until ${fmtDate(proposal.expiresDate)}.%0A%0AThank you.`}
              className="text-xs px-3 py-1.5 rounded-xl bg-indigo-600/20 text-indigo-300 border border-indigo-700/30 hover:bg-indigo-600/30 transition-colors"
            >
              ✉️ Email Customer
            </a>
          )}
        </div>
      </div>

      {/* ── PROPOSAL DOCUMENT ──────────────────────────────── */}
      <div className="bg-white rounded-2xl shadow-lg overflow-hidden text-gray-900">

        <div className="bg-slate-800 px-8 py-6 flex items-start justify-between gap-4">
          <div>
            <p className="text-2xl font-bold text-white">{coName || 'Proposal'}</p>
            {coAddr  && <p className="text-slate-300 text-sm mt-0.5">{coAddr}</p>}
            {coPhone && <p className="text-slate-300 text-sm">{coPhone}</p>}
            {coEmail && <p className="text-slate-300 text-sm">{coEmail}</p>}
          </div>
          <div className="text-right shrink-0">
            <p className="text-3xl font-bold text-white">PROPOSAL</p>
            <p className="text-slate-300 text-sm font-mono mt-1">{proposal.proposalNumber}</p>
          </div>
        </div>

        <div className="px-8 py-5 grid grid-cols-3 gap-6 border-b border-gray-100">
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Prepared For</p>
            <p className="font-semibold text-gray-900">{proposal.customerName}</p>
            {proposal.customerAddress && <p className="text-sm text-gray-600 mt-0.5">{proposal.customerAddress}</p>}
            {proposal.customerPhone   && <p className="text-sm text-gray-600">{proposal.customerPhone}</p>}
            {proposal.customerEmail   && <p className="text-sm text-gray-600">{proposal.customerEmail}</p>}
          </div>
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Issue Date</p>
            <p className="font-semibold text-gray-900">{fmtDate(proposal.issueDate)}</p>
          </div>
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Expires</p>
            <p className="font-semibold text-gray-900">{fmtDate(proposal.expiresDate)}</p>
          </div>
        </div>

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
              {proposal.lineItems.map((item, idx) => (
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

        <div className="px-8 pb-6 flex justify-end">
          <div style={{ minWidth: '220px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: '6px', color: '#6b7280', fontSize: '14px' }}>
              <span>Subtotal</span>
              <span>{fmtCurrency(subtotal)}</span>
            </div>
            {proposal.taxRate > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: '6px', color: '#6b7280', fontSize: '14px' }}>
                <span>Tax ({proposal.taxRate}%)</span>
                <span>{fmtCurrency(taxAmt)}</span>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '2px solid #111827', paddingTop: '8px', marginTop: '4px', fontWeight: 700, fontSize: '18px', color: '#111827' }}>
              <span>Total</span>
              <span>{fmtCurrency(total)}</span>
            </div>
          </div>
        </div>

        {proposal.notes && (
          <div className="px-8 py-4 border-t border-gray-100">
            <p style={{ fontSize: '11px', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>Notes</p>
            <p style={{ fontSize: '13px', color: '#374151', whiteSpace: 'pre-wrap' }}>{proposal.notes}</p>
          </div>
        )}

        <div className="bg-slate-800 px-8 py-4 text-center">
          <p className="text-slate-400 text-xs">Thank you for the opportunity to work with you!</p>
        </div>
      </div>

      <ConfirmModal
        isOpen={confirmDelete}
        message={`Delete proposal ${proposal.proposalNumber}? This cannot be undone.`}
        onConfirm={handleDelete}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  )
}
