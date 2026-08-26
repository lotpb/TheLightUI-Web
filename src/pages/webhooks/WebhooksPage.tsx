import { useEffect, useState } from 'react'
import { usePageTitle } from '../../hooks/usePageTitle'
import { useToast } from '../../components/Toast'
import ConfirmModal from '../../components/ConfirmModal'
import {
  subscribeToWebhooks, createWebhook, updateWebhook, deleteWebhook,
} from '../../services/webhookSubscriptionService'
import {
  type WebhookSubscription, type WebhookEvent,
  WEBHOOK_EVENTS, WEBHOOK_EVENT_LABELS,
} from '../../models/webhookSubscription'

function fmtDate(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) + ' · ' +
    d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

export default function WebhooksPage() {
  usePageTitle('Webhooks')
  const toast = useToast()

  const [hooks, setHooks] = useState<WebhookSubscription[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [url, setUrl] = useState('')
  const [events, setEvents] = useState<Set<WebhookEvent>>(new Set())
  const [saving, setSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<WebhookSubscription | null>(null)
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null)

  useEffect(() => subscribeToWebhooks(
    items => { setHooks(items); setLoading(false) },
    () => setLoading(false),
  ), [])

  function toggleEvent(e: WebhookEvent) {
    setEvents(prev => {
      const next = new Set(prev)
      next.has(e) ? next.delete(e) : next.add(e)
      return next
    })
  }

  function openForm() {
    setUrl('')
    setEvents(new Set())
    setShowForm(true)
  }

  async function handleCreate() {
    if (!url.trim() || events.size === 0) return
    setSaving(true)
    try {
      await createWebhook(url.trim(), [...events])
      setShowForm(false)
      toast('Webhook created', 'success')
    } catch {
      toast('Failed to create webhook', 'error')
    } finally {
      setSaving(false)
    }
  }

  async function handleToggle(hook: WebhookSubscription) {
    await updateWebhook(hook.id, { enabled: !hook.enabled })
  }

  async function handleDelete() {
    if (!deleteTarget) return
    await deleteWebhook(deleteTarget.id)
    setDeleteTarget(null)
  }

  async function copySecret(secret: string) {
    await navigator.clipboard.writeText(secret)
    toast('Secret copied to clipboard', 'success')
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">

      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Webhooks</h1>
          <p className="text-sm text-gray-500 mt-0.5">Send CRM events to Zapier, Make, or your own tools</p>
        </div>
        {!showForm && (
          <button onClick={openForm} className="btn-primary text-sm px-4 py-2 shrink-0">+ New Webhook</button>
        )}
      </div>

      {/* Create form */}
      {showForm && (
        <div className="card p-5 mb-5 space-y-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1.5">Endpoint URL *</label>
            <input
              autoFocus
              value={url}
              onChange={e => setUrl(e.target.value)}
              placeholder="https://hooks.zapier.com/hooks/catch/..."
              className="input-field w-full text-sm"
            />
          </div>
          <div>
            <p className="text-xs text-gray-500 mb-1.5">Send this webhook for:</p>
            <div className="space-y-1.5">
              {WEBHOOK_EVENTS.map(e => (
                <label key={e} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={events.has(e)}
                    onChange={() => toggleEvent(e)}
                    className="w-3.5 h-3.5 rounded accent-indigo-500"
                  />
                  <span className="text-sm text-gray-300">{WEBHOOK_EVENT_LABELS[e]}</span>
                  <span className="text-xs text-gray-600 font-mono">{e}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setShowForm(false)} className="btn-secondary text-sm px-4 py-1.5">Cancel</button>
            <button
              onClick={handleCreate}
              disabled={!url.trim() || events.size === 0 || saving}
              className="btn-primary text-sm px-4 py-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {saving ? 'Creating…' : 'Create Webhook'}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : hooks.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="text-gray-400 font-medium">No webhooks configured</p>
          <p className="text-sm text-gray-600 mt-1">Create one to notify an external tool whenever a CRM event happens.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {hooks.map(hook => (
            <div key={hook.id} className="card p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-mono text-sm text-gray-200 truncate">{hook.url}</p>
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                      hook.enabled ? 'bg-green-500/20 text-green-300' : 'bg-gray-700 text-gray-400'
                    }`}>
                      {hook.enabled ? 'Active' : 'Paused'}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {hook.events.map(e => (
                      <span key={e} className="text-xs px-2 py-0.5 rounded-full bg-gray-800 text-gray-400">
                        {WEBHOOK_EVENT_LABELS[e] ?? e}
                      </span>
                    ))}
                  </div>
                  <div className="mt-2 text-xs text-gray-500 space-y-0.5">
                    {hook.lastTriggeredAt ? (
                      <p>
                        Last delivery {fmtDate(hook.lastTriggeredAt)} ·{' '}
                        <span className={hook.lastStatus === 'success' ? 'text-green-400' : 'text-red-400'}>
                          {hook.lastStatus === 'success' ? 'Delivered' : `Failed${hook.lastError ? `: ${hook.lastError}` : ''}`}
                        </span>
                        {hook.failureCount > 0 && ` · ${hook.failureCount} consecutive failure${hook.failureCount !== 1 ? 's' : ''}`}
                      </p>
                    ) : (
                      <p>No deliveries yet</p>
                    )}
                    <div className="flex items-center gap-2">
                      <span>Secret: {revealedSecret === hook.id ? hook.secret : '•'.repeat(20)}</span>
                      <button
                        onClick={() => setRevealedSecret(revealedSecret === hook.id ? null : hook.id)}
                        className="text-indigo-400 hover:text-indigo-300"
                      >
                        {revealedSecret === hook.id ? 'Hide' : 'Show'}
                      </button>
                      <button onClick={() => copySecret(hook.secret)} className="text-indigo-400 hover:text-indigo-300">Copy</button>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    onClick={() => handleToggle(hook)}
                    title={hook.enabled ? 'Pause' : 'Activate'}
                    className={`relative w-9 h-5 rounded-full transition-colors ${hook.enabled ? 'bg-indigo-600' : 'bg-gray-700'}`}
                  >
                    <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${hook.enabled ? 'translate-x-4' : ''}`} />
                  </button>
                  <button onClick={() => setDeleteTarget(hook)} className="text-gray-500 hover:text-red-400 p-1.5 rounded-lg hover:bg-gray-800 transition-colors">
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

      <div className="mt-6 card p-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">How to verify deliveries</p>
        <p className="text-xs text-gray-500 leading-relaxed">
          Each request includes an <code className="px-1 py-0.5 rounded bg-gray-800 text-gray-300">X-TheLight-Signature</code> header —
          an HMAC-SHA256 hex digest of the raw request body, signed with your webhook's secret. Recompute it on your
          end and compare to confirm the request actually came from this app.
        </p>
      </div>

      <ConfirmModal
        isOpen={deleteTarget !== null}
        message={deleteTarget ? `Delete this webhook? ${deleteTarget.url} will stop receiving events.` : ''}
        confirmLabel="Delete"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}
