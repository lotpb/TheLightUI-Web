import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { subscribeToSigningRequests, deleteSigningRequest } from '../../services/signingRequestService'
import { KIND_LABELS } from '../../models/docTemplate'
import { STATUS_COLORS, STATUS_LABELS } from '../../models/signingRequest'
import type { SigningRequest } from '../../models/signingRequest'
import { useToast } from '../../components/Toast'
import { usePageTitle } from '../../hooks/usePageTitle'
import ConfirmModal from '../../components/ConfirmModal'

function fmtDate(d: Date | null): string {
  if (!d) return '—'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

type FilterStatus = 'all' | 'pending' | 'signed'

export default function SigningRequestsPage() {
  usePageTitle('E-Signatures')
  const toast = useToast()

  const [requests,  setRequests]  = useState<SigningRequest[]>([])
  const [loading,   setLoading]   = useState(true)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [filter,    setFilter]    = useState<FilterStatus>('all')
  const [copied,    setCopied]    = useState<string | null>(null)
  const [viewing,   setViewing]   = useState<SigningRequest | null>(null)

  useEffect(() => {
    return subscribeToSigningRequests(
      r => { setRequests(r); setLoading(false) },
      () => setLoading(false),
    )
  }, [])

  async function copyLink(token: string) {
    const url = `${window.location.origin}/sign/${token}`
    try {
      await navigator.clipboard.writeText(url)
      setCopied(token)
      setTimeout(() => setCopied(null), 2000)
    } catch {
      toast('Could not copy to clipboard', 'error')
    }
  }

  async function handleDelete(id: string) {
    setConfirmId(null)
    try {
      await deleteSigningRequest(id)
      toast('Signing request deleted', 'success')
    } catch {
      toast('Failed to delete', 'error')
    }
  }

  const filtered = filter === 'all' ? requests : requests.filter(r => r.status === filter)
  const pending  = requests.filter(r => r.status === 'pending').length
  const signed   = requests.filter(r => r.status === 'signed').length

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">E-Signatures</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Track document signing requests sent to customers
          </p>
        </div>
        <Link to="/doc-templates" className="btn-secondary text-sm px-4 py-2">
          + New Request
        </Link>
      </div>

      {/* Stats */}
      {requests.length > 0 && (
        <div className="grid grid-cols-3 gap-3 mb-6">
          {[
            { label: 'Total', value: requests.length },
            { label: 'Pending', value: pending, cls: 'text-yellow-300' },
            { label: 'Signed', value: signed, cls: 'text-green-300' },
          ].map(({ label, value, cls }) => (
            <div key={label} className="card p-4 text-center">
              <p className={`text-2xl font-bold ${cls ?? 'text-white'}`}>{value}</p>
              <p className="text-xs text-gray-500 mt-0.5">{label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Filter tabs */}
      {requests.length > 0 && (
        <div className="flex gap-1 mb-4 bg-gray-800/60 p-1 rounded-xl w-fit">
          {(['all', 'pending', 'signed'] as FilterStatus[]).map(s => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={`text-xs px-3 py-1.5 rounded-lg font-medium capitalize transition-colors ${
                filter === s ? 'bg-gray-700 text-white' : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {/* List */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="card p-4 animate-pulse">
              <div className="h-4 bg-gray-700 rounded w-40 mb-2" />
              <div className="h-3 bg-gray-700/60 rounded w-64" />
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="card p-12 text-center">
          <p className="text-4xl mb-3">✍️</p>
          <p className="text-gray-300 font-medium mb-1">
            {requests.length === 0 ? 'No signing requests yet' : 'No matching requests'}
          </p>
          <p className="text-sm text-gray-500 mb-4">
            {requests.length === 0
              ? 'Generate a document from a template, then send it for e-signature'
              : 'Try a different filter'}
          </p>
          {requests.length === 0 && (
            <Link to="/doc-templates" className="btn-primary text-sm px-4 py-2">
              Go to Document Templates
            </Link>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(req => (
            <div key={req.id} className="card p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="font-medium text-white truncate">{req.document.templateName}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${STATUS_COLORS[req.status]}`}>
                      {STATUS_LABELS[req.status]}
                    </span>
                    <span className="text-xs text-gray-600 shrink-0">{KIND_LABELS[req.document.templateKind]}</span>
                  </div>
                  <p className="text-sm text-gray-300">{req.document.customerName}</p>
                  {req.document.customerEmail && (
                    <p className="text-xs text-gray-500">{req.document.customerEmail}</p>
                  )}
                  <div className="flex gap-4 mt-1.5 text-xs text-gray-600">
                    <span>Sent {fmtDate(req.createdAt)}</span>
                    {req.signedAt && <span>Signed {fmtDate(req.signedAt)}</span>}
                  </div>
                </div>

                <div className="flex flex-col gap-1.5 items-end shrink-0">
                  <div className="flex gap-1">
                    <button
                      onClick={() => copyLink(req.id)}
                      className={`text-xs px-2 py-1 rounded transition-colors ${
                        copied === req.id
                          ? 'text-green-400 bg-green-500/10'
                          : 'text-gray-400 hover:text-gray-200 hover:bg-gray-700'
                      }`}
                    >
                      {copied === req.id ? '✓ Copied' : 'Copy Link'}
                    </button>
                    {req.status === 'signed' && (
                      <button
                        onClick={() => setViewing(req)}
                        className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors px-2 py-1 rounded hover:bg-gray-700"
                      >
                        View
                      </button>
                    )}
                    <button
                      onClick={() => setConfirmId(req.id)}
                      className="text-xs text-gray-500 hover:text-red-400 transition-colors px-2 py-1 rounded hover:bg-gray-700"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Signed document viewer */}
      {viewing && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-0 sm:px-4">
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => setViewing(null)} />
          <div className="relative bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-2xl shadow-2xl flex flex-col max-h-[94vh]">
            <div className="flex items-center justify-between px-5 py-4 bg-gray-800 rounded-t-2xl sm:rounded-t-2xl shrink-0">
              <p className="font-semibold text-white text-sm">{viewing.document.templateName} — Signed Copy</p>
              <button onClick={() => setViewing(null)} className="text-gray-400 hover:text-gray-200">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              <SignedDocView req={viewing} />
            </div>
          </div>
        </div>
      )}

      <ConfirmModal
        isOpen={!!confirmId}
        message="Delete this signing request? This cannot be undone."
        onConfirm={() => confirmId && handleDelete(confirmId)}
        onCancel={() => setConfirmId(null)}
      />
    </div>
  )
}

function SignedDocView({ req }: { req: SigningRequest }) {
  const d = req.document
  const today = req.signedAt?.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    ?? new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })

  return (
    <div style={{ background: 'white', padding: '32px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <p style={{ fontSize: 18, fontWeight: 700, color: '#0f172a', margin: 0 }}>{d.companyName || 'Company'}</p>
          {d.companyAddress && <p style={{ fontSize: 13, color: '#64748b', margin: '2px 0 0' }}>{d.companyAddress}</p>}
          {d.companyPhone && <p style={{ fontSize: 13, color: '#64748b', margin: '2px 0 0' }}>{d.companyPhone}</p>}
        </div>
        <div style={{ textAlign: 'right' }}>
          <p style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#64748b', margin: 0 }}>{KIND_LABELS[d.templateKind]}</p>
          <p style={{ fontSize: 16, fontWeight: 700, color: '#0f172a', margin: '4px 0 0' }}>{d.templateName}</p>
          <p style={{ fontSize: 12, color: '#64748b', margin: '4px 0 0' }}>Date: {today}</p>
        </div>
      </div>

      {/* Prepared for */}
      <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: 20, marginBottom: 20 }}>
        <p style={{ fontSize: 11, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.1em', margin: '0 0 6px' }}>Prepared For</p>
        <p style={{ fontSize: 16, fontWeight: 700, color: '#0f172a', margin: 0 }}>{d.customerName}</p>
        {d.customerStreet && <p style={{ fontSize: 13, color: '#475569', margin: '3px 0 0' }}>{d.customerStreet}</p>}
        {(d.customerCity || d.customerState) && (
          <p style={{ fontSize: 13, color: '#475569', margin: '2px 0 0' }}>
            {[d.customerCity, d.customerState, d.customerZip].filter(Boolean).join(', ')}
          </p>
        )}
        {d.customerEmail && <p style={{ fontSize: 13, color: '#475569', margin: '2px 0 0' }}>{d.customerEmail}</p>}
      </div>

      {/* Intro */}
      {d.intro && (
        <p style={{ fontSize: 14, color: '#334155', lineHeight: 1.8, margin: '0 0 24px', whiteSpace: 'pre-wrap' }}>{d.intro}</p>
      )}

      {/* Sections */}
      {d.sections.map((sec, i) => (
        <div key={i} style={{ marginBottom: 20 }}>
          {sec.heading && (
            <p style={{ fontSize: 11, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.1em', margin: '0 0 8px' }}>
              {sec.heading}
            </p>
          )}
          {sec.body && (
            <p style={{ fontSize: 14, color: '#334155', lineHeight: 1.8, margin: 0, whiteSpace: 'pre-wrap' }}>{sec.body}</p>
          )}
        </div>
      ))}

      {/* Closing */}
      {d.closing && (
        <p style={{ fontSize: 14, color: '#334155', lineHeight: 1.8, margin: '0 0 28px', whiteSpace: 'pre-wrap', borderTop: '1px solid #e2e8f0', paddingTop: 20 }}>
          {d.closing}
        </p>
      )}

      {/* Signature */}
      <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: 24 }}>
        <p style={{ fontSize: 11, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.1em', margin: '0 0 12px' }}>
          Electronic Signature
        </p>
        <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            {req.signatureDataUrl && (
              <img
                src={req.signatureDataUrl}
                alt="Signature"
                style={{ maxHeight: 80, maxWidth: '100%', objectFit: 'contain', display: 'block', marginBottom: 6 }}
              />
            )}
            <div style={{ borderTop: '1px solid #cbd5e1', paddingTop: 4 }}>
              <p style={{ fontSize: 12, color: '#94a3b8', margin: 0 }}>
                {req.signerName ? `${req.signerName} — Customer Signature` : 'Customer Signature'}
              </p>
            </div>
          </div>
          <div style={{ width: 160 }}>
            <p style={{ fontSize: 14, fontWeight: 600, color: '#334155', margin: '0 0 6px' }}>{today}</p>
            <div style={{ borderTop: '1px solid #cbd5e1', paddingTop: 4 }}>
              <p style={{ fontSize: 12, color: '#94a3b8', margin: 0 }}>Date Signed</p>
            </div>
          </div>
        </div>
        <div style={{ marginTop: 12, padding: '8px 12px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8 }}>
          <p style={{ fontSize: 12, color: '#16a34a', margin: 0 }}>
            ✓ Electronically signed via TheLightUI on {today}
          </p>
        </div>
      </div>
    </div>
  )
}
