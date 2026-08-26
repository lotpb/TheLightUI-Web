import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { usePageTitle } from '../../hooks/usePageTitle'
import { subscribeToAuditLog } from '../../services/auditLogService'
import {
  type AuditLogEntry, type AuditEntityType,
  ACTION_LABELS, ACTION_COLORS, fieldLabel,
} from '../../models/auditLog'

type Filter = 'all' | AuditEntityType

function fmtDate(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) + ' · ' +
    d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

export default function AuditLogPage() {
  usePageTitle('Audit Log')

  const [entries, setEntries] = useState<AuditLogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter]   = useState<Filter>('all')

  useEffect(() => subscribeToAuditLog(
    items => { setEntries(items); setLoading(false) },
    () => setLoading(false),
  ), [])

  const filtered = useMemo(
    () => filter === 'all' ? entries : entries.filter(e => e.entityType === filter),
    [entries, filter],
  )

  function recordLink(entry: AuditLogEntry): string | null {
    if (entry.action === 'deleted') return null
    if (entry.entityType === 'customer') return `/records/${entry.entityId}`
    if (entry.entityType === 'proposal') return `/proposals/${entry.entityId}`
    return `/invoices/${entry.entityId}`
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">

      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Audit Log</h1>
        <p className="text-sm text-gray-500 mt-0.5">Who changed what on Customer, Invoice &amp; Proposal records</p>
      </div>

      <div className="flex gap-1 mb-6 bg-gray-800/60 p-1 rounded-xl w-fit">
        {(['all', 'customer', 'invoice', 'proposal'] as Filter[]).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`text-sm px-4 py-1.5 rounded-lg font-medium capitalize transition-colors ${
              filter === f ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            {f === 'all' ? 'All' : f === 'customer' ? 'Customers' : f === 'invoice' ? 'Invoices' : 'Proposals'}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : filtered.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="text-gray-400 font-medium">No changes recorded yet</p>
          <p className="text-sm text-gray-600 mt-1">Edits to Customers and Invoices will show up here.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(entry => {
            const link = recordLink(entry)
            return (
              <div key={entry.id} className="card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${ACTION_COLORS[entry.action]}`}>
                        {ACTION_LABELS[entry.action]}
                      </span>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-gray-800 text-gray-400 capitalize">
                        {entry.entityType}
                      </span>
                      {link ? (
                        <Link to={link} className="font-medium text-indigo-400 hover:text-indigo-300 truncate">
                          {entry.entityLabel || entry.entityId}
                        </Link>
                      ) : (
                        <span className="font-medium text-gray-300 truncate">{entry.entityLabel || entry.entityId}</span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 mt-1.5">
                      {entry.changedBy} · {fmtDate(entry.createdAt)}
                    </p>
                    {entry.changes.length > 0 && (
                      <ul className="mt-2 space-y-1">
                        {entry.changes.map((c, i) => (
                          <li key={i} className="text-xs text-gray-400">
                            <span className="text-gray-300 font-medium">{fieldLabel(c.field)}</span>
                            {': '}
                            <span className="text-gray-500">{c.from || '(empty)'}</span>
                            {' → '}
                            <span className="text-gray-200">{c.to || '(empty)'}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
