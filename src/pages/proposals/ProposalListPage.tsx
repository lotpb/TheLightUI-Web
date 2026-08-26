import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { getFunctions, httpsCallable } from 'firebase/functions'
import { usePageTitle } from '../../hooks/usePageTitle'
import { subscribeToProposals, deleteProposal, updateProposal } from '../../services/proposalService'
import {
  effectiveStatus, fmtCurrency, proposalTotal, statusClasses, statusLabel,
  type Proposal, type ProposalStatus,
} from '../../models/proposal'
import { useAuthStore } from '../../stores/authStore'
import { usePermissions } from '../../hooks/usePermissions'
import { useToast } from '../../components/Toast'
import ConfirmModal from '../../components/ConfirmModal'

const TABS: { key: ProposalStatus | 'all'; label: string }[] = [
  { key: 'all',      label: 'All' },
  { key: 'draft',    label: 'Draft' },
  { key: 'sent',     label: 'Sent' },
  { key: 'accepted', label: 'Accepted' },
  { key: 'declined', label: 'Declined' },
  { key: 'expired',  label: 'Expired' },
]

export default function ProposalListPage() {
  usePageTitle('Proposals')
  const companyId = useAuthStore(s => s.companyId)
  const perms = usePermissions()
  const toast = useToast()

  const [proposals, setProposals] = useState<Proposal[]>([])
  const [loading, setLoading]     = useState(true)
  const [tab,     setTab]         = useState<ProposalStatus | 'all'>('all')
  const [search,  setSearch]      = useState('')

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkWorking, setBulkWorking] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    const unsub = subscribeToProposals(
      items => { setProposals(items); setLoading(false) },
      ()    => setLoading(false),
    )
    return unsub
  }, [companyId])

  const enriched = useMemo(() =>
    proposals.map(p => ({ ...p, _status: effectiveStatus(p) })),
  [proposals])

  const filtered = useMemo(() => {
    let items = enriched
    if (tab !== 'all') items = items.filter(p => p._status === tab)
    if (search.trim()) {
      const q = search.toLowerCase()
      items = items.filter(p =>
        p.customerName.toLowerCase().includes(q) ||
        p.proposalNumber.toLowerCase().includes(q),
      )
    }
    return items
  }, [enriched, tab, search])

  // Drop selections that scrolled out of the current filter so the bulk bar
  // count never silently includes hidden rows.
  useEffect(() => {
    const visible = new Set(filtered.map(p => p.id))
    setSelectedIds(prev => {
      const next = new Set([...prev].filter(id => visible.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [filtered])

  const kpis = useMemo(() => {
    const sent     = enriched.filter(p => p._status === 'sent')
    const accepted = enriched.filter(p => p._status === 'accepted')
    const responded = enriched.filter(p => p._status === 'accepted' || p._status === 'declined')
    const pendingValue  = sent.reduce((s, p) => s + proposalTotal(p), 0)
    const acceptedValue = accepted.reduce((s, p) => s + proposalTotal(p), 0)
    const winRate = responded.length > 0 ? Math.round((accepted.length / responded.length) * 100) : 0
    return { pendingValue, acceptedValue, winRate, sentCount: sent.length }
  }, [enriched])

  const counts = useMemo(() => {
    const m: Record<string, number> = { all: enriched.length }
    for (const p of enriched) m[p._status] = (m[p._status] ?? 0) + 1
    return m
  }, [enriched])

  function fmtDate(d: Date) {
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }

  function toggleOne(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }
  function toggleAll() {
    setSelectedIds(prev => prev.size === filtered.length ? new Set() : new Set(filtered.map(p => p.id)))
  }
  function clearSelection() {
    setSelectedIds(new Set())
  }

  async function handleBulkStatus(status: ProposalStatus) {
    setBulkWorking(true)
    try {
      await Promise.all([...selectedIds].map(id => updateProposal(id, { status })))
      toast(`Marked ${selectedIds.size} proposal${selectedIds.size === 1 ? '' : 's'} as ${statusLabel(status)}`, 'success')
      clearSelection()
    } catch {
      toast('Bulk status update failed', 'error')
    } finally {
      setBulkWorking(false)
    }
  }

  async function handleBulkDelete() {
    setConfirmDelete(false)
    setBulkWorking(true)
    try {
      await Promise.all([...selectedIds].map(id => deleteProposal(id)))
      toast(`Deleted ${selectedIds.size} proposal${selectedIds.size === 1 ? '' : 's'}`, 'success')
      clearSelection()
    } catch {
      toast('Bulk delete failed', 'error')
    } finally {
      setBulkWorking(false)
    }
  }

  async function handleBulkRemind() {
    setBulkWorking(true)
    try {
      const fns = getFunctions()
      const result = await httpsCallable<{ proposalIds: string[] }, { sent: number; skipped: number }>(
        fns, 'bulkSendProposalReminders',
      )({ proposalIds: [...selectedIds] })
      const { sent, skipped } = result.data
      toast(`Sent ${sent} reminder${sent === 1 ? '' : 's'}${skipped > 0 ? ` (${skipped} skipped — no email on file)` : ''}`, sent > 0 ? 'success' : 'error')
      clearSelection()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not send reminders', 'error')
    } finally {
      setBulkWorking(false)
    }
  }

  const someSelected = selectedIds.size > 0

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Proposals</h1>
          <p className="text-sm text-gray-400 mt-0.5">Quotes &amp; estimates sent to customers</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Link to="/proposals/pipeline" className="btn-secondary text-sm px-3 py-2">Board View</Link>
          <Link to="/proposals/new" className="btn-primary text-sm px-4 py-2">
            + New Proposal
          </Link>
        </div>
      </div>

      {/* KPI strip */}
      {!loading && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Pending', value: fmtCurrency(kpis.pendingValue), color: 'text-blue-400' },
            { label: 'Accepted Value', value: fmtCurrency(kpis.acceptedValue), color: 'text-green-400' },
            { label: 'Win Rate', value: `${kpis.winRate}%`, color: 'text-white' },
            { label: 'Awaiting Response', value: String(kpis.sentCount), color: 'text-amber-400' },
          ].map(k => (
            <div key={k.label} className="card p-4">
              <p className={`text-lg font-bold ${k.color}`}>{k.value}</p>
              <p className="text-xs text-gray-500 mt-0.5">{k.label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Search */}
      <input
        type="search"
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="Search by customer or proposal number…"
        className="input-field w-full text-sm py-2"
      />

      {/* Status tabs */}
      <div className="flex gap-1.5 flex-wrap">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
              tab === t.key
                ? 'bg-indigo-600 text-white'
                : 'bg-gray-800 text-gray-400 hover:text-gray-200'
            }`}
          >
            {t.label}
            {counts[t.key] !== undefined && (
              <span className="ml-1 opacity-60">({counts[t.key]})</span>
            )}
          </button>
        ))}
      </div>

      {/* Bulk action bar */}
      {!loading && someSelected && perms.canBulkAction && (
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={clearSelection} className="text-gray-400 hover:text-gray-200 transition-colors" aria-label="Clear selection">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
          <span className="text-sm font-medium text-white">{selectedIds.size} selected</span>
          <div className="flex-1" />
          <button onClick={() => handleBulkStatus('sent')} disabled={bulkWorking} className="text-sm px-3 py-1.5 rounded-lg bg-gray-700 text-gray-200 hover:bg-gray-600 transition-colors disabled:opacity-40">
            Mark Sent
          </button>
          <button onClick={() => handleBulkStatus('accepted')} disabled={bulkWorking} className="text-sm px-3 py-1.5 rounded-lg bg-green-700/70 text-white hover:bg-green-600 transition-colors disabled:opacity-40">
            Mark Accepted
          </button>
          <button onClick={() => handleBulkStatus('declined')} disabled={bulkWorking} className="text-sm px-3 py-1.5 rounded-lg bg-red-700/70 text-white hover:bg-red-600 transition-colors disabled:opacity-40">
            Mark Declined
          </button>
          <button onClick={handleBulkRemind} disabled={bulkWorking} className="text-sm px-3 py-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-500 transition-colors disabled:opacity-40">
            ✉️ Send Reminder
          </button>
          <button onClick={() => setConfirmDelete(true)} disabled={bulkWorking} className="text-sm px-3 py-1.5 rounded-lg bg-red-900/60 text-red-200 hover:bg-red-800 transition-colors disabled:opacity-40">
            Delete
          </button>
        </div>
      )}

      {/* Proposal list */}
      {loading ? (
        <div className="card divide-y divide-gray-700/30">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 px-4 py-4 animate-pulse">
              <div className="flex-1 space-y-2">
                <div className="h-3.5 bg-gray-700 rounded w-40" />
                <div className="h-3 bg-gray-700/60 rounded w-24" />
              </div>
              <div className="h-5 bg-gray-700 rounded w-20" />
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="card p-12 text-center space-y-2">
          <p className="text-3xl">📝</p>
          <p className="text-gray-400 text-sm">
            {proposals.length === 0
              ? 'No proposals yet. Create one from a customer record or click + New Proposal.'
              : 'No proposals match your search.'}
          </p>
          {proposals.length === 0 && (
            <Link to="/proposals/new" className="inline-block mt-2 text-sm text-indigo-400 hover:text-indigo-300">
              Create your first proposal →
            </Link>
          )}
        </div>
      ) : (
        <div className="card divide-y divide-gray-700/30 overflow-hidden">
          {perms.canBulkAction && (
            <div className="flex items-center gap-3 px-4 py-2 bg-gray-800/30">
              <input
                type="checkbox"
                checked={selectedIds.size === filtered.length}
                onChange={toggleAll}
                className="w-4 h-4 rounded border-gray-600 bg-gray-700 text-indigo-500 cursor-pointer shrink-0"
              />
              <span className="text-xs text-gray-500">
                {selectedIds.size === filtered.length ? 'Deselect all' : 'Select all'}
              </span>
            </div>
          )}
          {filtered.map(p => {
            const total  = proposalTotal(p)
            const status = p._status
            return (
              <div key={p.id} className="flex items-center gap-3 px-4 py-4 hover:bg-gray-700/20 transition-colors">
                {perms.canBulkAction && (
                  <input
                    type="checkbox"
                    checked={selectedIds.has(p.id)}
                    onChange={() => toggleOne(p.id)}
                    className="w-4 h-4 rounded border-gray-600 bg-gray-700 text-indigo-500 cursor-pointer shrink-0"
                  />
                )}
                <Link to={`/proposals/${p.id}`} className="flex items-center gap-4 flex-1 min-w-0">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <p className="text-sm font-semibold text-gray-100 truncate">{p.customerName}</p>
                      <p className="text-xs text-gray-600 shrink-0">{p.proposalNumber}</p>
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">
                      Issued {fmtDate(p.issueDate)} · Expires {fmtDate(p.expiresDate)}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <p className="text-sm font-bold text-white">{fmtCurrency(total)}</p>
                    {p.convertedInvoiceId && (
                      <span title="Converted to invoice" className="text-emerald-400 text-sm">🧾</span>
                    )}
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${statusClasses(status)}`}>
                      {statusLabel(status)}
                    </span>
                  </div>
                </Link>
              </div>
            )
          })}
        </div>
      )}

      <ConfirmModal
        isOpen={confirmDelete}
        message={`Delete ${selectedIds.size} selected proposal${selectedIds.size === 1 ? '' : 's'}? This cannot be undone.`}
        onConfirm={handleBulkDelete}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  )
}
