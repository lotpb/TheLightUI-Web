import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { usePageTitle } from '../../hooks/usePageTitle'
import { useToast } from '../../components/Toast'
import ConfirmModal from '../../components/ConfirmModal'
import {
  subscribeToServiceRequests, updateServiceRequestStatus, deleteServiceRequest,
} from '../../services/serviceRequestService'
import {
  type ServiceRequest, type ServiceRequestStatus,
  SERVICE_REQUEST_STATUSES, STATUS_LABELS, STATUS_COLORS,
} from '../../models/serviceRequest'

type Tab = 'active' | ServiceRequestStatus

function fmtDate(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function ServiceRequestsPage() {
  usePageTitle('Service Requests')
  const toast = useToast()

  const [requests, setRequests] = useState<ServiceRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>('active')
  const [deleteTarget, setDeleteTarget] = useState<ServiceRequest | null>(null)

  useEffect(() => subscribeToServiceRequests(
    items => { setRequests(items); setLoading(false) },
    () => setLoading(false),
  ), [])

  const filtered = useMemo(() => {
    if (tab === 'active') return requests.filter(r => r.status !== 'completed' && r.status !== 'dismissed')
    return requests.filter(r => r.status === tab)
  }, [requests, tab])

  const newCount = useMemo(() => requests.filter(r => r.status === 'new').length, [requests])

  async function handleStatusChange(r: ServiceRequest, status: ServiceRequestStatus) {
    try {
      await updateServiceRequestStatus(r.id, status)
    } catch {
      toast('Failed to update status', 'error')
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    await deleteServiceRequest(deleteTarget.id)
    setDeleteTarget(null)
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">

      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Service Requests</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Requests submitted by customers through their portal
          {newCount > 0 && <span className="text-yellow-400 font-medium"> · {newCount} new</span>}
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-gray-800/60 p-1 rounded-xl w-fit overflow-x-auto">
        {(['active', ...SERVICE_REQUEST_STATUSES] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`text-sm px-3.5 py-1.5 rounded-lg font-medium transition-colors whitespace-nowrap ${
              tab === t ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            {t === 'active' ? 'Active' : STATUS_LABELS[t]}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : filtered.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="text-gray-400 font-medium">No requests here</p>
          <p className="text-sm text-gray-600 mt-1">Requests submitted from a customer's portal link will show up here.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(r => (
            <div key={r.id} className="card p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-semibold text-white">{r.name || 'Unnamed'}</p>
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_COLORS[r.status]}`}>
                      {STATUS_LABELS[r.status]}
                    </span>
                  </div>
                  <p className="text-sm text-gray-300 mt-1.5 whitespace-pre-wrap">{r.description}</p>
                  <div className="flex items-center gap-3 mt-2 text-xs text-gray-500 flex-wrap">
                    {r.phone && <span>📞 {r.phone}</span>}
                    {r.email && <span>✉ {r.email}</span>}
                    {r.preferredDate && <span>Preferred: {r.preferredDate}</span>}
                    <span>Submitted {fmtDate(r.createdAt)}</span>
                    {r.customerId && (
                      <Link to={`/records/${r.customerId}`} className="text-indigo-400 hover:text-indigo-300">
                        View customer →
                      </Link>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => setDeleteTarget(r)}
                  className="text-gray-500 hover:text-red-400 p-1.5 rounded-lg hover:bg-gray-800 transition-colors shrink-0"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                  </svg>
                </button>
              </div>

              {/* Status buttons */}
              <div className="flex gap-1.5 mt-3 flex-wrap">
                {SERVICE_REQUEST_STATUSES.map(s => (
                  <button
                    key={s}
                    onClick={() => handleStatusChange(r, s)}
                    disabled={r.status === s}
                    className={`text-xs px-2.5 py-1 rounded-lg font-medium transition-colors ${
                      r.status === s
                        ? `${STATUS_COLORS[s]} cursor-default`
                        : 'bg-gray-800 text-gray-500 hover:text-gray-300 hover:bg-gray-700'
                    }`}
                  >
                    {STATUS_LABELS[s]}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <ConfirmModal
        isOpen={deleteTarget !== null}
        message={deleteTarget ? `Delete this service request from ${deleteTarget.name || 'this customer'}?` : ''}
        confirmLabel="Delete"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}
