import { useEffect, useState } from 'react'
import { usePageTitle } from '../../hooks/usePageTitle'
import { useToast } from '../../components/Toast'
import ConfirmModal from '../../components/ConfirmModal'
import { subscribeToApiKeys, createApiKey, updateApiKey, deleteApiKey } from '../../services/apiKeyService'
import { type ApiKey, type ApiScope, API_SCOPES, API_SCOPE_LABELS } from '../../models/apiKey'

const API_BASE = 'https://us-central1-thelightui.cloudfunctions.net/apiRead'

function fmtDate(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) + ' · ' +
    d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

export default function ApiKeysPage() {
  usePageTitle('API Keys')
  const toast = useToast()

  const [keys, setKeys] = useState<ApiKey[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [name, setName] = useState('')
  const [scopes, setScopes] = useState<Set<ApiScope>>(new Set())
  const [saving, setSaving] = useState(false)
  const [newRawKey, setNewRawKey] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ApiKey | null>(null)

  useEffect(() => subscribeToApiKeys(
    items => { setKeys(items); setLoading(false) },
    () => setLoading(false),
  ), [])

  function toggleScope(s: ApiScope) {
    setScopes(prev => {
      const next = new Set(prev)
      next.has(s) ? next.delete(s) : next.add(s)
      return next
    })
  }

  function openForm() {
    setName('')
    setScopes(new Set())
    setShowForm(true)
  }

  async function handleCreate() {
    if (!name.trim() || scopes.size === 0) return
    setSaving(true)
    try {
      const rawKey = await createApiKey(name.trim(), [...scopes])
      setShowForm(false)
      setNewRawKey(rawKey)
    } catch {
      toast('Failed to create API key', 'error')
    } finally {
      setSaving(false)
    }
  }

  async function handleToggle(key: ApiKey) {
    await updateApiKey(key.id, { enabled: !key.enabled })
  }

  async function handleDelete() {
    if (!deleteTarget) return
    await deleteApiKey(deleteTarget.id)
    setDeleteTarget(null)
  }

  async function copyKey(key: string) {
    await navigator.clipboard.writeText(key)
    toast('Copied to clipboard', 'success')
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">

      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">API Keys</h1>
          <p className="text-sm text-gray-500 mt-0.5">Let external tools read Customer &amp; Invoice data</p>
        </div>
        {!showForm && (
          <button onClick={openForm} className="btn-primary text-sm px-4 py-2 shrink-0">+ New Key</button>
        )}
      </div>

      {/* Newly created key — shown once */}
      {newRawKey && (
        <div className="card p-5 mb-5 border-green-700/40 bg-green-950/20 space-y-3">
          <p className="text-sm font-semibold text-green-300">Key created — copy it now, it won't be shown again</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-xs bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-gray-200 overflow-x-auto whitespace-nowrap">
              {newRawKey}
            </code>
            <button onClick={() => copyKey(newRawKey)} className="btn-primary text-xs px-3 py-2 shrink-0">Copy</button>
          </div>
          <button onClick={() => setNewRawKey(null)} className="text-xs text-gray-500 hover:text-gray-300">Done, I've saved it</button>
        </div>
      )}

      {/* Create form */}
      {showForm && (
        <div className="card p-5 mb-5 space-y-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1.5">Key Name *</label>
            <input
              autoFocus
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Zapier Integration"
              className="input-field w-full text-sm"
            />
          </div>
          <div>
            <p className="text-xs text-gray-500 mb-1.5">Permissions:</p>
            <div className="space-y-1.5">
              {API_SCOPES.map(s => (
                <label key={s} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={scopes.has(s)}
                    onChange={() => toggleScope(s)}
                    className="w-3.5 h-3.5 rounded accent-indigo-500"
                  />
                  <span className="text-sm text-gray-300">{API_SCOPE_LABELS[s]}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setShowForm(false)} className="btn-secondary text-sm px-4 py-1.5">Cancel</button>
            <button
              onClick={handleCreate}
              disabled={!name.trim() || scopes.size === 0 || saving}
              className="btn-primary text-sm px-4 py-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {saving ? 'Creating…' : 'Create Key'}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : keys.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="text-gray-400 font-medium">No API keys yet</p>
          <p className="text-sm text-gray-600 mt-1">Create one to let an external tool read Customer or Invoice data.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {keys.map(key => (
            <div key={key.id} className="card p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-medium text-white">{key.name}</p>
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                      key.enabled ? 'bg-green-500/20 text-green-300' : 'bg-gray-700 text-gray-400'
                    }`}>
                      {key.enabled ? 'Active' : 'Revoked'}
                    </span>
                  </div>
                  <p className="text-xs font-mono text-gray-500 mt-1">{key.keyPrefix}…</p>
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {key.scopes.map(s => (
                      <span key={s} className="text-xs px-2 py-0.5 rounded-full bg-gray-800 text-gray-400">
                        {API_SCOPE_LABELS[s]}
                      </span>
                    ))}
                  </div>
                  <p className="text-xs text-gray-600 mt-2">
                    Created {fmtDate(key.createdAt)} by {key.createdByName || 'Unknown'}
                    {key.lastUsedAt && <> · Last used {fmtDate(key.lastUsedAt)}</>}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    onClick={() => handleToggle(key)}
                    title={key.enabled ? 'Revoke' : 'Reactivate'}
                    className={`relative w-9 h-5 rounded-full transition-colors ${key.enabled ? 'bg-indigo-600' : 'bg-gray-700'}`}
                  >
                    <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${key.enabled ? 'translate-x-4' : ''}`} />
                  </button>
                  <button onClick={() => setDeleteTarget(key)} className="text-gray-500 hover:text-red-400 p-1.5 rounded-lg hover:bg-gray-800 transition-colors">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-6 card p-4 space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Using the API</p>
        <p className="text-xs text-gray-500">
          Send the key as a bearer token: <code className="px-1 py-0.5 rounded bg-gray-800 text-gray-300">Authorization: Bearer &lt;key&gt;</code>
        </p>
        <div className="space-y-1.5 text-xs font-mono text-gray-400">
          <p><span className="text-indigo-400">GET</span> {API_BASE}/customers/lookup?email=jane@example.com</p>
          <p><span className="text-indigo-400">GET</span> {API_BASE}/customers/:id</p>
          <p><span className="text-indigo-400">GET</span> {API_BASE}/invoices/:id</p>
          <p><span className="text-indigo-400">GET</span> {API_BASE}/invoices?status=paid</p>
        </div>
      </div>

      <ConfirmModal
        isOpen={deleteTarget !== null}
        message={deleteTarget ? `Delete "${deleteTarget.name}"? Any integration using this key will stop working immediately.` : ''}
        confirmLabel="Delete"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}
