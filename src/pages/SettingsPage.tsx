import { useState, useEffect, useRef } from 'react'
import { getFunctions, httpsCallable } from 'firebase/functions'
import { usePickerStore } from '../stores/pickerStore'
import { useAuthStore } from '../stores/authStore'
import { savePickerLists, type PickerLists } from '../services/pickerService'
import {
  getAllCustomersOnce,
  exportCustomersToJSON,
  importCustomersFromJSON,
} from '../services/customerService'

type ListKey = keyof PickerLists

const SECTIONS: { key: ListKey; label: string; placeholder: string }[] = [
  { key: 'salesman',    label: 'Salesman',    placeholder: 'Add salesman name…'   },
  { key: 'job',         label: 'Job Types',   placeholder: 'Add job type…'        },
  { key: 'product',     label: 'Products',    placeholder: 'Add product…'         },
  { key: 'advertiser',  label: 'Advertisers', placeholder: 'Add advertiser…'      },
  { key: 'contractor',  label: 'Contractors', placeholder: 'Add contractor name…' },
]

const PREF_KEY = 'thelight.showInactive'

export default function SettingsPage() {
  const { lists, fetch } = usePickerStore()
  const { companyId, role } = useAuthStore()

  const [showInactivePref, setShowInactivePref] = useState(
    () => localStorage.getItem(PREF_KEY) === 'true'
  )
  const [lightMode, setLightMode] = useState(
    () => localStorage.getItem('thelight.lightMode') === 'true'
  )

  function toggleShowInactive() {
    const next = !showInactivePref
    setShowInactivePref(next)
    localStorage.setItem(PREF_KEY, String(next))
  }

  function toggleLightMode() {
    const next = !lightMode
    setLightMode(next)
    localStorage.setItem('thelight.lightMode', String(next))
    document.documentElement.classList.toggle('light-mode', next)
  }

  const [local, setLocal] = useState<PickerLists>({
    salesman: [], job: [], product: [], advertiser: [], contractor: []
  })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved]   = useState(false)
  const [inputs, setInputs] = useState<Record<ListKey, string>>({
    salesman: '', job: '', product: '', advertiser: '', contractor: ''
  })

  // Invite state
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviting, setInviting] = useState(false)
  const [inviteMsg, setInviteMsg] = useState<{ ok: boolean; text: string } | null>(null)

  // Data management state
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [transferring, setTransferring] = useState(false)
  const [transferMsg, setTransferMsg] = useState<{ ok: boolean; text: string } | null>(null)

  async function handleExport() {
    setTransferring(true)
    setTransferMsg(null)
    try {
      const items = await getAllCustomersOnce()
      const json = exportCustomersToJSON(items)
      const blob = new Blob([json], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `CustomerBackup-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
      setTransferMsg({ ok: true, text: `Exported ${items.length} record${items.length === 1 ? '' : 's'}.` })
    } catch (err) {
      setTransferMsg({ ok: false, text: err instanceof Error ? err.message : 'Export failed.' })
    } finally {
      setTransferring(false)
    }
  }

  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''   // reset so same file can be re-imported
    const userId = useAuthStore.getState().user?.uid ?? ''
    setTransferring(true)
    setTransferMsg(null)
    try {
      const text = await file.text()
      const { count } = await importCustomersFromJSON(text, userId)
      setTransferMsg({ ok: true, text: `Imported ${count} record${count === 1 ? '' : 's'} to Firebase.` })
    } catch (err) {
      setTransferMsg({ ok: false, text: err instanceof Error ? err.message : 'Import failed.' })
    } finally {
      setTransferring(false)
    }
  }

useEffect(() => { fetch() }, [fetch])
  useEffect(() => { if (lists) setLocal(lists) }, [lists])

  function addItem(key: ListKey) {
    const val = inputs[key].trim()
    if (!val || local[key].includes(val)) return
    setLocal(prev => ({ ...prev, [key]: [...prev[key], val] }))
    setInputs(prev => ({ ...prev, [key]: '' }))
  }

  function removeItem(key: ListKey, item: string) {
    setLocal(prev => ({ ...prev, [key]: prev[key].filter(v => v !== item) }))
  }

  function handleKeyDown(e: React.KeyboardEvent, key: ListKey) {
    if (e.key === 'Enter') { e.preventDefault(); addItem(key) }
  }

  async function handleSave() {
    setSaving(true)
    setSaved(false)
    try {
      await savePickerLists(local)
      await fetch()
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } finally {
      setSaving(false)
    }
  }

  async function handleInvite() {
    const email = inviteEmail.trim()
    if (!email) return
    setInviting(true)
    setInviteMsg(null)
    try {
      const fns = getFunctions()
      const inviteUser = httpsCallable<{ email: string }, { success: boolean; alreadyInvited: boolean }>(fns, 'inviteUser')
      const result = await inviteUser({ email })
      if (result.data.alreadyInvited) {
        setInviteMsg({ ok: true, text: `${email} already has a pending invitation.` })
      } else {
        setInviteMsg({ ok: true, text: `Invitation sent to ${email}.` })
        setInviteEmail('')
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Invite failed'
      setInviteMsg({ ok: false, text: msg })
    } finally {
      setInviting(false)
    }
  }

return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-white">Settings</h1>
        <button onClick={handleSave} disabled={saving} className="btn-primary px-4 py-1.5 text-sm">
          {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save'}
        </button>
      </div>

      {/* Company & Team */}
      <div className="card overflow-hidden mb-6">
        <div className="px-4 py-2.5 border-b border-gray-700/50 bg-gray-800/50">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Company & Team</p>
        </div>
        <div className="p-4 space-y-4">
          <div className="flex justify-between text-sm">
            <span className="text-gray-400">Company ID</span>
            <span className="text-gray-300 font-mono text-xs">{companyId ?? '—'}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-400">Your role</span>
            <span className="text-gray-300 capitalize">{role ?? '—'}</span>
          </div>

          {/* Invite */}
          {(role === 'owner' || role === 'admin') && (
            <div className="pt-3 border-t border-gray-700/40 space-y-2">
              <p className="text-xs text-gray-400">Invite a team member</p>
              <div className="flex gap-2">
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={e => setInviteEmail(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleInvite()}
                  placeholder="colleague@example.com"
                  className="input-field flex-1 text-sm py-1.5"
                />
                <button onClick={handleInvite} disabled={inviting} className="btn-primary px-3 py-1.5 text-sm">
                  {inviting ? '…' : 'Invite'}
                </button>
              </div>
              {inviteMsg && (
                <p className={`text-xs ${inviteMsg.ok ? 'text-green-400' : 'text-red-400'}`}>{inviteMsg.text}</p>
              )}
            </div>
          )}

        </div>
      </div>

      {/* Display Preferences */}
      <div className="card overflow-hidden mb-6">
        <div className="px-4 py-2.5 border-b border-gray-700/50 bg-gray-800/50">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Display Preferences</p>
        </div>
        <div className="p-4 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-200">Light mode</p>
              <p className="text-xs text-gray-500 mt-0.5">Switch the entire app to a light color scheme</p>
            </div>
            <button
              type="button"
              onClick={toggleLightMode}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                lightMode ? 'bg-indigo-600' : 'bg-gray-600'
              }`}
              aria-label="Toggle light mode"
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                lightMode ? 'translate-x-6' : 'translate-x-1'
              }`} />
            </button>
          </div>
          <div className="border-t border-gray-700/40 pt-4 flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-200">Show inactive records by default</p>
              <p className="text-xs text-gray-500 mt-0.5">Applies to Leads, Customers, Vendors & Employees lists</p>
            </div>
            <button
              type="button"
              onClick={toggleShowInactive}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                showInactivePref ? 'bg-indigo-600' : 'bg-gray-600'
              }`}
              aria-label="Toggle show inactive records"
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                showInactivePref ? 'translate-x-6' : 'translate-x-1'
              }`} />
            </button>
          </div>
        </div>
      </div>

      {/* Data Management */}
      <div className="card overflow-hidden mb-6">
        <div className="px-4 py-2.5 border-b border-gray-700/50 bg-gray-800/50">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Data Management</p>
        </div>
        <div className="p-4 space-y-3">
          <p className="text-xs text-gray-500">Export all records as a JSON backup, or import a JSON file from iOS or a previous export.</p>
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={handleExport}
              disabled={transferring}
              className="btn-secondary text-sm px-4 py-1.5"
            >
              {transferring ? 'Working…' : 'Export JSON'}
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={transferring}
              className="btn-secondary text-sm px-4 py-1.5"
            >
              Import JSON
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={handleImportFile}
            />
          </div>
          {transferMsg && (
            <p className={`text-xs ${transferMsg.ok ? 'text-green-400' : 'text-red-400'}`}>
              {transferMsg.text}
            </p>
          )}
        </div>
      </div>

      <p className="text-sm text-gray-400 mb-6">
        Manage the dropdown lists used throughout the app. Changes sync to all devices.
      </p>

      <div className="space-y-5">
        {SECTIONS.map(({ key, label, placeholder }) => (
          <div key={key} className="card overflow-hidden">
            <div className="px-4 py-2.5 border-b border-gray-700/50 bg-gray-800/50">
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">{label}</p>
            </div>
            <div className="flex gap-2 p-3 border-b border-gray-700/30">
              <input
                type="text"
                value={inputs[key]}
                onChange={e => setInputs(prev => ({ ...prev, [key]: e.target.value }))}
                onKeyDown={e => handleKeyDown(e, key)}
                placeholder={placeholder}
                className="input-field flex-1 text-sm py-1.5"
              />
              <button onClick={() => addItem(key)} className="btn-primary px-3 py-1.5 text-sm">Add</button>
            </div>
            {local[key].length === 0 ? (
              <p className="px-4 py-3 text-sm text-gray-500 italic">No items yet.</p>
            ) : (
              <ul className="divide-y divide-gray-700/30">
                {local[key].map(item => (
                  <li key={item} className="flex items-center justify-between px-4 py-2.5">
                    <span className="text-sm text-gray-200">{item}</span>
                    <button
                      onClick={() => removeItem(key, item)}
                      className="text-gray-500 hover:text-red-400 transition-colors text-sm ml-2"
                      aria-label={`Remove ${item}`}
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>

      <div className="mt-6 card p-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">About</p>
        <div className="space-y-1.5 text-sm text-gray-400">
          <div className="flex justify-between">
            <span>App</span>
            <span className="text-gray-300">TheLight Web</span>
          </div>
          <div className="flex justify-between">
            <span>Backend</span>
            <span className="text-gray-300">Firebase (thelightui)</span>
          </div>
        </div>
      </div>
    </div>
  )
}
