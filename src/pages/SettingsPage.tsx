import { useState, useEffect, useRef } from 'react'
import { usePageTitle } from '../hooks/usePageTitle'
import { Link } from 'react-router-dom'
import { getFunctions, httpsCallable } from 'firebase/functions'
import { usePickerStore } from '../stores/pickerStore'
import { useAuthStore } from '../stores/authStore'
import { usePrefStore } from '../stores/prefStore'
import { savePickerLists, type PickerLists, type PickerLabels } from '../services/pickerService'
import { useToast } from '../components/Toast'
import {
  getAllCustomersOnce,
  exportCustomersToJSON,
  importCustomersFromJSON,
} from '../services/customerService'
import { getAllExpensesOnce, importExpensesFromJSON } from '../services/expenseService'
import { getAllTodosOnce, importTodosFromJSON } from '../services/todoService'
import {
  subscribeToCustomFieldDefs, createCustomFieldDef, updateCustomFieldDef, deleteCustomFieldDef,
} from '../services/customFieldService'
import { CUSTOM_FIELD_TYPE_LABELS, type CustomFieldDef, type CustomFieldType } from '../models/customField'

type ListKey = 'salesman' | 'job' | 'product' | 'advertiser' | 'contractor'

const SECTION_KEYS: { key: ListKey; placeholder: string }[] = [
  { key: 'salesman',   placeholder: 'Add name…'       },
  { key: 'job',        placeholder: 'Add job type…'   },
  { key: 'product',    placeholder: 'Add product…'    },
  { key: 'advertiser', placeholder: 'Add advertiser…' },
  { key: 'contractor', placeholder: 'Add name…'       },
]

const PREF_KEY = 'thelight.showInactive'

export default function SettingsPage() {
  const { lists, labels: storedLabels, fetch } = usePickerStore()
  const { companyId, role } = useAuthStore()
  const { coloredAvatars, setColoredAvatars } = usePrefStore()
  const toast = useToast()

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
  const [localLabels, setLocalLabels] = useState<PickerLabels>(() => storedLabels)
  const [editingLabel, setEditingLabel] = useState<ListKey | null>(null)
  const [labelDraft, setLabelDraft] = useState('')
  usePageTitle('Settings')
  const [saving, setSaving] = useState(false)
  const [inputs, setInputs] = useState<Record<ListKey, string>>({
    salesman: '', job: '', product: '', advertiser: '', contractor: ''
  })

  // Invite state
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviting, setInviting] = useState(false)
  const [fixingRole, setFixingRole] = useState(false)

  async function handleFixRole() {
    setFixingRole(true)
    try {
      const fns = getFunctions()
      const fixRole = httpsCallable<object, { role: string }>(fns, 'fixRole')
      const result = await fixRole({})
      // Force token refresh so the corrected role is picked up immediately
      const { auth: fbAuth } = await import('../firebase/config')
      await fbAuth.currentUser?.getIdToken(true)
      const tokenResult = await fbAuth.currentUser?.getIdTokenResult()
      const newRole = tokenResult?.claims['role'] as string | undefined
      useAuthStore.setState({ role: newRole ?? result.data.role })
      toast(`Role corrected to "${result.data.role}". Please refresh if needed.`, 'success')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Fix failed', 'error')
    } finally {
      setFixingRole(false)
    }
  }


  // Data management state
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [transferring, setTransferring] = useState(false)

  function downloadJSON(filename: string, content: string) {
    const blob = new Blob([content], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  async function handleExport() {
    setTransferring(true)
    try {
      const [customers, expenses, todos] = await Promise.all([
        getAllCustomersOnce(),
        getAllExpensesOnce(),
        getAllTodosOnce(),
      ])

      // CustomerBackup.json — all records (leads, vendors, employees)
      downloadJSON('CustomerBackup.json', exportCustomersToJSON(customers))

      // ExpenseBackup.json
      const expenseRecords = expenses.map(e => ({
        id: e.id,
        title: e.title,
        amount: e.amount,
        category: e.category,
        date: e.date.toISOString(),
        notes: e.notes,
        isReimbursable: e.isReimbursable,
        lastUpdate: e.lastUpdate.toISOString(),
      }))
      downloadJSON('ExpenseBackup.json', JSON.stringify(expenseRecords, null, 2))

      // ToDoListBackup.json
      const todoRecords = todos.map(t => ({
        id: t.id,
        title: t.title,
        notes: t.notes,
        isCompleted: t.isCompleted,
        priority: t.priority,
        dueDate: t.dueDate ? t.dueDate.toISOString() : null,
        createdAt: t.createdAt.toISOString(),
        position: t.position,
      }))
      downloadJSON('ToDoListBackup.json', JSON.stringify(todoRecords, null, 2))

      toast(
        `Exported ${customers.length} records, ${expenses.length} expenses, ${todos.length} todos.`,
        'success',
      )
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Export failed.', 'error')
    } finally {
      setTransferring(false)
    }
  }

  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    const userId = useAuthStore.getState().user?.uid ?? ''
    setTransferring(true)
    try {
      const text = await file.text()
      const parsed: unknown = JSON.parse(text)
      const records: Record<string, unknown>[] = Array.isArray(parsed)
        ? parsed as Record<string, unknown>[]
        : ((parsed as { records?: Record<string, unknown>[] }).records ?? [])

      if (records.length === 0) {
        toast('File is empty or has no records.', 'error')
        return
      }

      const sample = records[0]
      let result: { count: number }

      if ('isCompleted' in sample) {
        // ToDoListBackup.json
        result = await importTodosFromJSON(text, userId)
        toast(`Imported ${result.count} todo${result.count === 1 ? '' : 's'}.`, 'success')
      } else if ('isReimbursable' in sample) {
        // ExpenseBackup.json
        result = await importExpensesFromJSON(text)
        toast(`Imported ${result.count} expense${result.count === 1 ? '' : 's'}.`, 'success')
      } else {
        // CustomerBackup.json (leads, vendors, employees)
        result = await importCustomersFromJSON(text, userId)
        toast(`Imported ${result.count} record${result.count === 1 ? '' : 's'}.`, 'success')
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Import failed.', 'error')
    } finally {
      setTransferring(false)
    }
  }

  // Custom field definitions
  const [customFields, setCustomFields] = useState<CustomFieldDef[]>([])
  const [newFieldLabel, setNewFieldLabel] = useState('')
  const [newFieldType, setNewFieldType] = useState<CustomFieldType>('text')
  const [newFieldOptions, setNewFieldOptions] = useState('')
  const [creatingField, setCreatingField] = useState(false)
  const [editingFieldId, setEditingFieldId] = useState<string | null>(null)
  const [editFieldLabel, setEditFieldLabel] = useState('')
  const [editFieldOptions, setEditFieldOptions] = useState('')

  useEffect(() => subscribeToCustomFieldDefs(setCustomFields, () => {}), [])

  async function handleAddCustomField() {
    const label = newFieldLabel.trim()
    if (!label) return
    setCreatingField(true)
    try {
      await createCustomFieldDef(
        {
          label,
          type: newFieldType,
          options: newFieldOptions.split(',').map(o => o.trim()).filter(Boolean),
        },
        customFields.map(f => f.key),
      )
      setNewFieldLabel('')
      setNewFieldType('text')
      setNewFieldOptions('')
      toast(`Field "${label}" added.`, 'success')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to add field.', 'error')
    } finally {
      setCreatingField(false)
    }
  }

  function startEditField(f: CustomFieldDef) {
    setEditingFieldId(f.id)
    setEditFieldLabel(f.label)
    setEditFieldOptions(f.options.join(', '))
  }

  async function saveEditField() {
    if (!editingFieldId) return
    const label = editFieldLabel.trim()
    if (!label) return
    await updateCustomFieldDef(editingFieldId, {
      label,
      options: editFieldOptions.split(',').map(o => o.trim()).filter(Boolean),
    })
    setEditingFieldId(null)
  }

  async function handleDeleteCustomField(f: CustomFieldDef) {
    await deleteCustomFieldDef(f.id)
    toast(`Field "${f.label}" removed. Existing values are kept on records but hidden.`, 'info')
  }

  useEffect(() => { fetch() }, [fetch])
  useEffect(() => { if (lists) { setLocal(lists); setLocalLabels(l => ({ ...l, ...lists.labels })) } }, [lists])

  function commitLabel(key: ListKey) {
    const trimmed = labelDraft.trim()
    if (trimmed) setLocalLabels(prev => ({ ...prev, [key]: trimmed }))
    setEditingLabel(null)
  }

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
    if (editingLabel) commitLabel(editingLabel)
    setSaving(true)
    try {
      await savePickerLists({ ...local, labels: localLabels })
      await fetch()
      toast('Settings saved.', 'success')
    } catch {
      toast('Save failed. Please try again.', 'error')
    } finally {
      setSaving(false)
    }
  }

  async function handleInvite() {
    const email = inviteEmail.trim()
    if (!email) return
    setInviting(true)
    try {
      const fns = getFunctions()
      const inviteUser = httpsCallable<{ email: string }, { success: boolean; alreadyInvited: boolean }>(fns, 'inviteUser')
      const result = await inviteUser({ email })
      if (result.data.alreadyInvited) {
        toast(`${email} already has a pending invitation.`, 'info')
      } else {
        toast(`Invitation sent to ${email}.`, 'success')
        setInviteEmail('')
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Invite failed', 'error')
    } finally {
      setInviting(false)
    }
  }

return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-white">Settings</h1>
        <button onClick={handleSave} disabled={saving} className="btn-primary px-4 py-1.5 text-sm">
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>

      {/* Company & Team */}
      <div className="card overflow-hidden mb-6">
        <div className="px-4 py-2.5 border-b border-gray-700/50 bg-gray-800/50">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Company & Team</p>
        </div>
        <div className="p-4 space-y-4">
          <div className="flex justify-between items-center text-sm">
            <span className="text-gray-400">Your account</span>
            <Link to="/profile" className="text-indigo-400 hover:text-indigo-300 text-sm">
              Edit profile →
            </Link>
          </div>
          <div className="border-t border-gray-700/40 pt-4 flex justify-between text-sm">
            <span className="text-gray-400">Company ID</span>
            <span className="text-gray-300 font-mono text-xs">{companyId ?? '—'}</span>
          </div>
          <div className="flex justify-between items-center text-sm">
            <span className="text-gray-400">Your role</span>
            <div className="flex items-center gap-2">
              <span className="text-gray-300 capitalize">{role ?? '—'}</span>
              <button
                onClick={handleFixRole}
                disabled={fixingRole}
                title="Fix incorrect role"
                className="text-xs text-indigo-400 hover:text-indigo-300 disabled:opacity-40 transition-colors"
              >
                {fixingRole ? '…' : 'Fix'}
              </button>
            </div>
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
              <p className="text-sm text-gray-200">{showInactivePref ? 'Include all records' : 'Active records only'}</p>
              <p className="text-xs text-gray-500 mt-0.5">Show inactive entries in Leads, Customers, Vendors & Employees lists</p>
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
          <div className="border-t border-gray-700/40 pt-4 flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-200">Color-coded avatars</p>
              <p className="text-xs text-gray-500 mt-0.5">Each contact gets a unique color based on their name</p>
            </div>
            <button
              type="button"
              onClick={() => setColoredAvatars(!coloredAvatars)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                coloredAvatars ? 'bg-indigo-600' : 'bg-gray-600'
              }`}
              aria-label="Toggle colored avatars"
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                coloredAvatars ? 'translate-x-6' : 'translate-x-1'
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
          <p className="text-xs text-gray-500">Export all data as JSON backups (CustomerBackup.json, ExpenseBackup.json, ToDoListBackup.json). Import auto-detects the file type — customers, expenses, or todos.</p>
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={handleExport}
              disabled={transferring}
              className="btn-secondary text-sm px-4 py-1.5"
            >
              {transferring ? 'Working…' : 'Export All Data'}
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={transferring}
              className="btn-secondary text-sm px-4 py-1.5"
            >
              Import Data
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={handleImportFile}
            />
          </div>
        </div>
      </div>

      {/* Custom Fields */}
      <div className="card overflow-hidden mb-6">
        <div className="px-4 py-2.5 border-b border-gray-700/50 bg-gray-800/50">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Custom Fields</p>
        </div>
        <div className="p-4 space-y-4">
          <p className="text-xs text-gray-500">
            Add extra fields to Customer, Lead, Vendor & Employee records — no code changes needed.
          </p>

          {customFields.length === 0 ? (
            <p className="text-sm text-gray-500 italic">No custom fields yet.</p>
          ) : (
            <ul className="divide-y divide-gray-700/30 -mx-4">
              {customFields.map(f => (
                <li key={f.id} className="px-4 py-2.5">
                  {editingFieldId === f.id ? (
                    <div className="space-y-2">
                      <input
                        autoFocus
                        value={editFieldLabel}
                        onChange={e => setEditFieldLabel(e.target.value)}
                        className="input-field text-sm w-full py-1.5"
                      />
                      {f.type === 'select' && (
                        <input
                          value={editFieldOptions}
                          onChange={e => setEditFieldOptions(e.target.value)}
                          placeholder="Options, comma separated"
                          className="input-field text-sm w-full py-1.5"
                        />
                      )}
                      <div className="flex gap-2">
                        <button onClick={saveEditField} className="btn-primary text-xs px-3 py-1">Save</button>
                        <button onClick={() => setEditingFieldId(null)} className="btn-secondary text-xs px-3 py-1">Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-gray-200">{f.label}</span>
                          <span className="text-xs font-medium px-1.5 py-0.5 rounded bg-gray-700 text-gray-400">
                            {CUSTOM_FIELD_TYPE_LABELS[f.type]}
                          </span>
                        </div>
                        {f.type === 'select' && f.options.length > 0 && (
                          <p className="text-xs text-gray-600 mt-0.5 truncate">{f.options.join(', ')}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button onClick={() => startEditField(f)} className="text-gray-500 hover:text-gray-200 p-1.5 rounded hover:bg-gray-800 transition-colors">
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125" />
                          </svg>
                        </button>
                        <button onClick={() => handleDeleteCustomField(f)} className="text-gray-500 hover:text-red-400 p-1.5 rounded hover:bg-gray-800 transition-colors">
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}

          {/* Add new field */}
          <div className="border-t border-gray-700/40 pt-3 space-y-2">
            <div className="flex gap-2 flex-wrap">
              <input
                value={newFieldLabel}
                onChange={e => setNewFieldLabel(e.target.value)}
                placeholder="Field name, e.g. Warranty Length"
                className="input-field flex-1 text-sm py-1.5 min-w-[160px]"
              />
              <select
                value={newFieldType}
                onChange={e => setNewFieldType(e.target.value as CustomFieldType)}
                className="input-field text-sm py-1.5"
              >
                {Object.entries(CUSTOM_FIELD_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            {newFieldType === 'select' && (
              <input
                value={newFieldOptions}
                onChange={e => setNewFieldOptions(e.target.value)}
                placeholder="Options, comma separated — e.g. 1 Year, 2 Years, 5 Years"
                className="input-field text-sm w-full py-1.5"
              />
            )}
            <button
              onClick={handleAddCustomField}
              disabled={!newFieldLabel.trim() || creatingField}
              className="btn-primary text-sm px-4 py-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {creatingField ? 'Adding…' : '+ Add Field'}
            </button>
          </div>
        </div>
      </div>

      <p className="text-sm text-gray-400 mb-6">
        Manage the dropdown lists used throughout the app. Changes sync to all devices.
      </p>

      <div className="space-y-5">
        {SECTION_KEYS.map(({ key, placeholder }) => (
          <div key={key} className="card overflow-hidden">
            <div className="px-4 py-2.5 border-b border-gray-700/50 bg-gray-800/50 flex items-center justify-between gap-2">
              {editingLabel === key ? (
                <input
                  autoFocus
                  type="text"
                  value={labelDraft}
                  onChange={e => setLabelDraft(e.target.value)}
                  onBlur={() => commitLabel(key)}
                  onKeyDown={e => { if (e.key === 'Enter') commitLabel(key); if (e.key === 'Escape') setEditingLabel(null) }}
                  className="text-xs font-semibold uppercase tracking-wider bg-transparent border-b border-indigo-500 outline-none text-gray-200 w-40"
                />
              ) : (
                <>
                  <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">{localLabels[key as keyof PickerLabels]}</p>
                  <button
                    type="button"
                    onClick={() => { setEditingLabel(key); setLabelDraft(localLabels[key as keyof PickerLabels]) }}
                    className="text-gray-600 hover:text-gray-300 transition-colors shrink-0"
                    title="Rename"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125" />
                    </svg>
                  </button>
                </>
              )}
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
