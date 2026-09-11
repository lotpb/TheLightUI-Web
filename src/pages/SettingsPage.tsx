import { useState, useEffect, useRef, useMemo, type ReactNode } from 'react'
import { usePageTitle } from '../hooks/usePageTitle'
import { Link, useNavigate } from 'react-router-dom'
import { getFunctions, httpsCallable } from 'firebase/functions'
import { usePickerStore } from '../stores/pickerStore'
import { useAuthStore, setNotificationPref } from '../stores/authStore'
import { usePrefStore } from '../stores/prefStore'
import { savePickerLists, type PickerLists, type PickerLabels } from '../services/pickerService'
import { useToast } from '../components/Toast'
import { Icon, ICONS } from '../components/Icon'
import ConfirmModal from '../components/ConfirmModal'
import {
  getAllCustomersOnce,
  exportCustomersToJSON,
  importCustomersFromJSON,
} from '../services/customerService'
import { getAllExpensesOnce, importExpensesFromJSON } from '../services/expenseService'
import { getAllTodosOnce, importTodosFromJSON } from '../services/todoService'
import { saveJSONFile } from '../utils/exportUtils'
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

const LIST_KEYS: ListKey[] = SECTION_KEYS.map(s => s.key)

const PREF_KEY = 'thelight.showInactive'

/**
 * A settings section.
 *
 * The header strip was `bg-gray-800/50` sitting on a `.card`, which is itself
 * `bg-gray-800` — 50% of a colour composited over that same colour is that
 * colour, so the strip measured 1.000:1 against the card in both themes and did
 * nothing at all. Only its bottom border was ever visible. bg-gray-700 is a real
 * step in the same direction in both themes (1.42:1 dark, 1.39:1 light).
 *
 * Seven sections hand-rolled this block, three with subtly different padding.
 */
function SectionCard({
  title, children, action, collapsible = false, open = true, onToggle,
}: {
  title: string
  children: ReactNode
  /** Right-hand header slot — an unsaved badge, a count. */
  action?: ReactNode
  collapsible?: boolean
  open?: boolean
  onToggle?: () => void
}) {
  const strip = 'w-full px-4 py-2.5 bg-gray-700 border-b border-gray-600/40 flex items-center justify-between gap-2'
  const header = (
    <>
      <p className="text-xs font-semibold uppercase tracking-wider text-gray-300">{title}</p>
      <span className="flex items-center gap-2 shrink-0">
        {action}
        {collapsible && (
          <Icon
            d={ICONS.chevronDown}
            className={`w-4 h-4 text-gray-300 transition-transform ${open ? 'rotate-180' : ''}`}
          />
        )}
      </span>
    </>
  )

  return (
    <section className="card overflow-hidden mb-6">
      {collapsible ? (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className={`${strip} text-left hover:bg-gray-600 transition-colors
                      focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500`}
        >
          {header}
        </button>
      ) : (
        <div className={strip}>{header}</div>
      )}
      {open && <div className="p-4">{children}</div>}
    </section>
  )
}

/**
 * A labelled switch.
 *
 * Seven of these were hand-rolled at ~26 lines each, sharing three defects:
 *
 * - The knob was `bg-white`, which is var-backed — `--color-white` is
 *   `15 23 42` in light mode, so every knob rendered dark navy there, at 2.84:1
 *   on the indigo "on" track. `.toggle-knob` pins it to true white.
 * - The off track was `bg-gray-600`: 1.94:1 dark and 1.89:1 light against the
 *   card, under the 3:1 WCAG 1.4.11 asks of a control's boundary. gray-500 is
 *   3.04:1 / 7.58:1, and the knob clears 3:1 on both tracks (4.83:1 off,
 *   6.29:1 on).
 * - They were `<button aria-label>` with no `role="switch"` and no
 *   `aria-checked`, so a screen reader announced "Toggle light mode, button"
 *   and never said whether it was on. The visible label was a sibling <p>, so
 *   clicking the words did nothing — the only target was the 44×24 knob at the
 *   far right of a 672px card.
 *
 * The whole row is the control now, which also supplies its accessible name.
 */
function SettingToggle({ label, description, checked, onChange }: {
  label: string
  description: string
  checked: boolean
  onChange: () => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      className="w-full py-4 flex items-center justify-between gap-4 text-left rounded-lg
                 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
    >
      <span className="min-w-0">
        <span className="block text-sm text-gray-200">{label}</span>
        {/* text-gray-400, not 500: gray-500 is 3.04:1 on a card, and this is
            the line that says what the setting does. */}
        <span className="block text-xs text-gray-400 mt-0.5">{description}</span>
      </span>
      <span
        aria-hidden
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
          checked ? 'bg-indigo-600' : 'bg-gray-500'
        }`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full toggle-knob transition-transform ${
            checked ? 'translate-x-6' : 'translate-x-1'
          }`}
        />
      </span>
    </button>
  )
}

/** Divided stack of switches. The -my-4 cancels the card's own padding against
 *  each row's py-4, so the rows keep 16px of breathing room and the dividers
 *  land between them rather than inside the padding. */
function ToggleList({ children }: { children: ReactNode }) {
  return <div className="divide-y divide-gray-700/40 -my-4">{children}</div>
}

/** Label + value row, for the read-only facts in Company & Team and About. */
function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-gray-400">{label}</span>
      {children}
    </div>
  )
}

export default function SettingsPage() {
  const { lists, labels: storedLabels, loaded, fetch } = usePickerStore()
  const { companyId, role, notifyNewLeads, notifyChatMessages, notifyAssignment, notifyAssignmentEmail, signOut } = useAuthStore()
  const { coloredAvatars, setColoredAvatars } = usePrefStore()
  const toast = useToast()
  const navigate = useNavigate()

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
    document.documentElement.style.colorScheme = next ? 'light' : 'dark'
  }

  const [local, setLocal] = useState<PickerLists>({
    salesman: [], job: [], product: [], advertiser: [], contractor: []
  })
  const [localLabels, setLocalLabels] = useState<PickerLabels>(() => storedLabels)
  const [editingLabel, setEditingLabel] = useState<ListKey | null>(null)
  const [labelDraft, setLabelDraft] = useState('')
  const [dropdownListsOpen, setDropdownListsOpen] = useState(false)
  usePageTitle('Settings')
  const [saving, setSaving] = useState(false)
  const [inputs, setInputs] = useState<Record<ListKey, string>>({
    salesman: '', job: '', product: '', advertiser: '', contractor: ''
  })

  // Invite state
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviting, setInviting] = useState(false)

  // Data management state
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [transferring, setTransferring] = useState(false)

  const [copiedCompanyId, setCopiedCompanyId] = useState(false)
  const [confirmSignOut, setConfirmSignOut] = useState(false)

  // saveJSONFile shows a native "Save As" dialog on browsers that support
  // it (only the first call per click keeps the user-activation needed to
  // show one, so the 2nd/3rd files below fall back to auto-download — which
  // still needs staggering so the browser doesn't drop or throttle them).
  function delay(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms))
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
      await saveJSONFile('CustomerBackup.json', exportCustomersToJSON(customers))
      await delay(300)

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
      await saveJSONFile('ExpenseBackup.json', JSON.stringify(expenseRecords, null, 2))
      await delay(300)

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
      await saveJSONFile('ToDoListBackup.json', JSON.stringify(todoRecords, null, 2))

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
  // Third state, so the list doesn't assert "No custom fields yet" while the
  // subscription's first snapshot is still in flight — the page used to tell
  // you that you had none and then fill in.
  const [fieldsLoaded, setFieldsLoaded] = useState(false)
  const [newFieldLabel, setNewFieldLabel] = useState('')
  const [newFieldType, setNewFieldType] = useState<CustomFieldType>('text')
  const [newFieldOptions, setNewFieldOptions] = useState('')
  const [creatingField, setCreatingField] = useState(false)
  const [editingFieldId, setEditingFieldId] = useState<string | null>(null)
  const [editFieldLabel, setEditFieldLabel] = useState('')
  const [editFieldOptions, setEditFieldOptions] = useState('')
  const [deleteFieldTarget, setDeleteFieldTarget] = useState<CustomFieldDef | null>(null)

  useEffect(() => subscribeToCustomFieldDefs(
    defs => { setCustomFields(defs); setFieldsLoaded(true) },
    () => setFieldsLoaded(true),
  ), [])

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

  // Asks first. This was a single unconfirmed click that wrote to Firestore,
  // for a definition that applies across every Customer, Lead, Vendor and
  // Employee record — and the toast explained the consequence afterwards.
  async function handleDeleteCustomField(f: CustomFieldDef) {
    setDeleteFieldTarget(null)
    try {
      await deleteCustomFieldDef(f.id)
      toast(`Field "${f.label}" removed. Existing values are kept on records but hidden.`, 'info')
    } catch {
      toast(`Could not remove "${f.label}".`, 'error')
    }
  }

  useEffect(() => { fetch() }, [fetch])
  useEffect(() => { if (lists) { setLocal(lists); setLocalLabels(l => ({ ...l, ...lists.labels })) } }, [lists])

  /**
   * Whether the dropdown lists hold edits that aren't on the server.
   *
   * The page's only Save button used to sit top-right, permanently enabled, and
   * governed nothing but this one section — which is collapsed by default. So
   * it read as a page-wide Save (every toggle, custom field and invite here
   * writes on its own), while the edits it actually protected could be lost by
   * navigating away with no warning. Gated on `loaded`, because `local` starts
   * empty and would otherwise read as dirty on the first render.
   */
  const listsDirty = useMemo(() => {
    if (!loaded) return false
    const listChanged = LIST_KEYS.some(k => local[k].join('\u0000') !== (lists[k] ?? []).join('\u0000'))
    const labelChanged = LIST_KEYS.some(
      k => (localLabels[k as keyof PickerLabels] ?? '') !== (storedLabels[k as keyof PickerLabels] ?? '')
    )
    return listChanged || labelChanged
  }, [loaded, local, localLabels, lists, storedLabels])

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
      toast('Dropdown lists saved.', 'success')
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

  async function copyCompanyId() {
    if (!companyId) return
    try {
      await navigator.clipboard.writeText(companyId)
      setCopiedCompanyId(true)
      setTimeout(() => setCopiedCompanyId(false), 1500)
    } catch {
      toast('Could not copy to the clipboard.', 'error')
    }
  }

  async function handleSignOut() {
    setConfirmSignOut(false)
    await signOut()
    navigate('/login', { replace: true })
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      {/* No page-level Save. It only ever wrote the dropdown lists, and it now
          lives in that section, beside the fields it commits. */}
      <h1 className="text-2xl font-bold text-white mb-6">Settings</h1>

      {/* ── Company & Team ── */}
      <SectionCard title="Company & Team">
        <div className="divide-y divide-gray-700/40 -my-4">
          <div className="py-4">
            <InfoRow label="Your account">
              <Link to="/profile" className="text-indigo-400 hover:text-indigo-300 inline-flex items-center gap-1">
                Edit profile
                <Icon d={ICONS.arrowRight} className="w-3.5 h-3.5 shrink-0" />
              </Link>
            </InfoRow>
          </div>
          <div className="py-4 space-y-1">
            <InfoRow label="Company ID">
              {/* Was a raw Firestore ID with no way to get it out of the page
                  and nothing saying what it's for. */}
              <span className="flex items-center gap-1.5 min-w-0">
                <span className="text-gray-300 font-mono text-xs truncate">{companyId ?? '—'}</span>
                {companyId && (
                  <button
                    type="button"
                    onClick={copyCompanyId}
                    aria-label="Copy company ID"
                    className="shrink-0 p-1.5 rounded text-gray-400 hover:text-gray-200 hover:bg-gray-700/50 transition-colors
                               focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                  >
                    <Icon d={copiedCompanyId ? ICONS.check : ICONS.clipboard} className="w-3.5 h-3.5" />
                  </button>
                )}
              </span>
            </InfoRow>
            <p className="text-xs text-gray-400">Quote this when contacting support.</p>
          </div>
          <div className="py-4">
            <InfoRow label="Your role">
              <span className="text-gray-300 capitalize">{role ?? '—'}</span>
            </InfoRow>
          </div>

          {(role === 'owner' || role === 'admin') && (
            <div className="py-4 space-y-2">
              <label htmlFor="invite-email" className="block text-xs text-gray-400">Invite a team member</label>
              <div className="flex gap-2">
                <input
                  id="invite-email"
                  type="email"
                  value={inviteEmail}
                  onChange={e => setInviteEmail(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleInvite()}
                  placeholder="colleague@example.com"
                  className="input-field flex-1 text-sm"
                />
                <button onClick={handleInvite} disabled={inviting} className="btn-primary text-sm shrink-0 disabled:opacity-40">
                  {inviting ? 'Inviting…' : 'Invite'}
                </button>
              </div>
            </div>
          )}
        </div>
      </SectionCard>

      {/* ── Display Preferences ── */}
      <SectionCard title="Display Preferences">
        <ToggleList>
          <SettingToggle
            label="Light mode"
            description="Switch the entire app to a light color scheme"
            checked={lightMode}
            onChange={toggleLightMode}
          />
          {/* A fixed label. This one read "Include all records" / "Active
              records only" — the label changed when you toggled it, so unlike
              its two siblings you couldn't tell whether it named the current
              state or what the switch would do. */}
          <SettingToggle
            label="Show inactive records"
            description="Include deactivated entries in the Leads, Customers, Vendors & Employees lists"
            checked={showInactivePref}
            onChange={toggleShowInactive}
          />
          <SettingToggle
            label="Color-coded avatars"
            description="Each contact gets a unique color based on their name"
            checked={coloredAvatars}
            onChange={() => setColoredAvatars(!coloredAvatars)}
          />
        </ToggleList>
      </SectionCard>

      {/* ── Notifications ── */}
      <SectionCard title="Notifications">
        <ToggleList>
          <SettingToggle
            label="New lead alerts"
            description="Get a push notification when a new lead is created"
            checked={notifyNewLeads}
            onChange={() => setNotificationPref('notifyNewLeads', !notifyNewLeads)}
          />
          <SettingToggle
            label="New message alerts"
            description="Get a push notification for new chat messages"
            checked={notifyChatMessages}
            onChange={() => setNotificationPref('notifyChatMessages', !notifyChatMessages)}
          />
          <SettingToggle
            label="Lead assignment alerts"
            description="Get a push notification when a lead or customer is assigned to you"
            checked={notifyAssignment}
            onChange={() => setNotificationPref('notifyAssignment', !notifyAssignment)}
          />
          <SettingToggle
            label="Lead assignment emails"
            description="Get an email when a lead or customer is assigned to you"
            checked={notifyAssignmentEmail}
            onChange={() => setNotificationPref('notifyAssignmentEmail', !notifyAssignmentEmail)}
          />
        </ToggleList>
      </SectionCard>

      {/* ── Custom Fields ── */}
      <SectionCard
        title="Custom Fields"
        action={fieldsLoaded && customFields.length > 0
          ? <span className="text-xs font-bold px-1.5 py-0.5 rounded-full leading-none tabular-nums bg-gray-600 text-gray-100">{customFields.length}</span>
          : undefined}
      >
        <div className="space-y-4">
          <p className="text-xs text-gray-400">
            Add extra fields to Customer, Lead, Vendor &amp; Employee records — no code changes needed.
          </p>

          {!fieldsLoaded ? (
            <div className="space-y-2" aria-hidden>
              {[0, 1].map(i => (
                <div key={i} className="h-5 bg-gray-700/60 rounded w-48 animate-pulse" />
              ))}
            </div>
          ) : customFields.length === 0 ? (
            <p className="text-sm text-gray-400">No custom fields yet.</p>
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
                        aria-label={`Rename "${f.label}"`}
                        className="input-field text-sm w-full py-1.5"
                      />
                      {f.type === 'select' && (
                        <input
                          value={editFieldOptions}
                          onChange={e => setEditFieldOptions(e.target.value)}
                          placeholder="Options, comma separated"
                          aria-label={`Options for "${f.label}"`}
                          className="input-field text-sm w-full py-1.5"
                        />
                      )}
                      <div className="flex gap-2">
                        <button onClick={saveEditField} className="btn-primary text-xs px-3 py-1.5">Save</button>
                        <button onClick={() => setEditingFieldId(null)} className="btn-secondary text-xs px-3 py-1.5">Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-gray-200">{f.label}</span>
                          <span className="text-xs font-medium px-1.5 py-0.5 rounded bg-gray-700 text-gray-300">
                            {CUSTOM_FIELD_TYPE_LABELS[f.type]}
                          </span>
                        </div>
                        {/* text-gray-400: this was gray-600 — 1.94:1 dark and
                            1.89:1 light, failing in both themes — on the only
                            place the app shows a select field's choices. */}
                        {f.type === 'select' && f.options.length > 0 && (
                          <p className="text-xs text-gray-400 mt-0.5 truncate">{f.options.join(', ')}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => startEditField(f)}
                          aria-label={`Edit "${f.label}"`}
                          className="p-1.5 rounded text-gray-400 hover:text-gray-200 hover:bg-gray-700/50 transition-colors
                                     focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                        >
                          <Icon d={ICONS.pencil} className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => setDeleteFieldTarget(f)}
                          aria-label={`Remove "${f.label}"`}
                          className="p-1.5 rounded text-gray-400 hover:text-red-400 hover:bg-gray-700/50 transition-colors
                                     focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                        >
                          <Icon d={ICONS.trash} className="w-3.5 h-3.5" />
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
                aria-label="New field name"
                className="input-field flex-1 text-sm py-1.5 min-w-[160px]"
              />
              <select
                value={newFieldType}
                onChange={e => setNewFieldType(e.target.value as CustomFieldType)}
                aria-label="New field type"
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
                aria-label="New field options"
                className="input-field text-sm w-full py-1.5"
              />
            )}
            <button
              onClick={handleAddCustomField}
              disabled={!newFieldLabel.trim() || creatingField}
              className="btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Icon d={ICONS.plus} className="w-4 h-4 shrink-0" />
              {creatingField ? 'Adding…' : 'Add Field'}
            </button>
          </div>
        </div>
      </SectionCard>

      {/* ── Manage Dropdown Lists ── */}
      <SectionCard
        title="Manage Dropdown Lists"
        collapsible
        open={dropdownListsOpen}
        onToggle={() => setDropdownListsOpen(o => !o)}
        // Surfaced on the header, so a collapsed section can't hide the fact
        // that there's something here waiting to be saved.
        // indigo-600, not 500: white on indigo-500 is 4.47:1, and at 12px bold
        // this doesn't reach the 14pt-bold threshold for the large-text
        // exemption. indigo-600 is 6.29:1 and is already in the light-mode
        // true-white override list.
        action={listsDirty
          ? <span className="text-xs font-bold px-1.5 py-0.5 rounded-full leading-none bg-indigo-600 text-white">Unsaved</span>
          : undefined}
      >
        <p className="text-sm text-gray-400 mb-5">
          Manage the dropdown lists used throughout the app (Salesman, Job Type, Product, Lead Source, Contractor).
          Changes sync to all devices once saved.
        </p>

        {/* Sub-sections, not nested cards. These were five `.card`s inside a
            `.card` — identical bg-gray-800, identical border, identical header
            strip — so the nesting read as flat and slightly broken. Dividers
            carry the grouping instead. */}
        <div className="divide-y divide-gray-700/50">
          {SECTION_KEYS.map(({ key, placeholder }) => (
            <div key={key} className="py-4 first:pt-0 last:pb-0">
              <div className="flex items-center justify-between gap-2 mb-2">
                {editingLabel === key ? (
                  <input
                    autoFocus
                    type="text"
                    value={labelDraft}
                    onChange={e => setLabelDraft(e.target.value)}
                    onBlur={() => commitLabel(key)}
                    onKeyDown={e => { if (e.key === 'Enter') commitLabel(key); if (e.key === 'Escape') setEditingLabel(null) }}
                    aria-label="List name"
                    className="input-field text-xs font-semibold uppercase tracking-wider py-1 w-44"
                  />
                ) : (
                  <>
                    <p className="text-xs font-semibold uppercase tracking-wider text-gray-300">
                      {localLabels[key as keyof PickerLabels]}
                    </p>
                    <button
                      type="button"
                      onClick={() => { setEditingLabel(key); setLabelDraft(localLabels[key as keyof PickerLabels]) }}
                      aria-label={`Rename "${localLabels[key as keyof PickerLabels]}"`}
                      className="shrink-0 p-1.5 rounded text-gray-400 hover:text-gray-200 hover:bg-gray-700/50 transition-colors
                                 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                    >
                      <Icon d={ICONS.pencil} className="w-3.5 h-3.5" />
                    </button>
                  </>
                )}
              </div>

              <div className="flex gap-2 mb-2">
                <input
                  type="text"
                  value={inputs[key]}
                  onChange={e => setInputs(prev => ({ ...prev, [key]: e.target.value }))}
                  onKeyDown={e => handleKeyDown(e, key)}
                  placeholder={placeholder}
                  aria-label={`Add to ${localLabels[key as keyof PickerLabels]}`}
                  className="input-field flex-1 text-sm py-1.5"
                />
                <button onClick={() => addItem(key)} className="btn-primary text-xs px-3 py-1.5 shrink-0">Add</button>
              </div>

              {/* Doesn't claim the list is empty until it's actually been
                  loaded — `local` starts as five empty arrays, so all five
                  lists reported "No items yet." on every page load. */}
              {!loaded ? (
                <div className="h-5 bg-gray-700/60 rounded w-32 animate-pulse" aria-hidden />
              ) : local[key].length === 0 ? (
                <p className="text-sm text-gray-400">No items yet.</p>
              ) : (
                <ul className="divide-y divide-gray-700/30">
                  {local[key].map(item => (
                    <li key={item} className="flex items-center justify-between gap-2 py-1.5">
                      <span className="text-sm text-gray-200 min-w-0 truncate">{item}</span>
                      {/* A real button. This was a bare ✕ text glyph with no
                          padding — a 20px target, under the 24px floor — and a
                          second rendering of the X used for custom fields
                          a hundred lines above. */}
                      <button
                        onClick={() => removeItem(key, item)}
                        aria-label={`Remove ${item}`}
                        className="shrink-0 p-1.5 rounded text-gray-400 hover:text-red-400 hover:bg-gray-700/50 transition-colors
                                   focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                      >
                        <Icon d={ICONS.close} className="w-3.5 h-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>

        {/* Save lives with what it saves, and is only live when there's
            something to commit. */}
        <div className="border-t border-gray-700/50 pt-4 mt-4 flex items-center justify-between gap-3">
          <p className="text-xs text-gray-400">
            {listsDirty ? 'You have unsaved changes to these lists.' : 'All changes saved.'}
          </p>
          <button
            onClick={handleSave}
            disabled={saving || !listsDirty}
            className="btn-primary text-sm shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {saving ? 'Saving…' : 'Save lists'}
          </button>
        </div>
      </SectionCard>

      {/* ── Data Management ──
          Moved below the configuration sections: it's used rarely, half of it
          overwrites records, and it sat above both Custom Fields and the
          dropdown lists. */}
      <SectionCard title="Data Management">
        <div className="space-y-3">
          <p className="text-xs text-gray-400">
            Export all data as JSON backups (CustomerBackup.json, ExpenseBackup.json, ToDoListBackup.json).
            Import auto-detects the file type — customers, expenses, or todos.
          </p>
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={handleExport}
              disabled={transferring}
              className="btn-secondary text-sm inline-flex items-center gap-1.5 disabled:opacity-40"
            >
              <Icon d={ICONS.downloadTray} className="w-4 h-4 shrink-0" />
              {transferring ? 'Working…' : 'Export All Data'}
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={transferring}
              className="btn-secondary text-sm inline-flex items-center gap-1.5 disabled:opacity-40"
            >
              <Icon d={ICONS.uploadTray} className="w-4 h-4 shrink-0" />
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
      </SectionCard>

      {/* ── About ── */}
      <SectionCard title="About">
        <div className="divide-y divide-gray-700/40 -my-4">
          <div className="py-4 space-y-1.5">
            <InfoRow label="App">
              <span className="text-gray-300">TheLight Web</span>
            </InfoRow>
            <InfoRow label="Environment">
              <span className="text-gray-300">Firebase (thelightui)</span>
            </InfoRow>
          </div>
          {/* Settings is where people look for this; the only other way out was
              the app chrome's own menu. */}
          <div className="py-4">
            <button
              onClick={() => setConfirmSignOut(true)}
              className="btn-danger text-sm inline-flex items-center gap-1.5"
            >
              <Icon d={ICONS.user} className="w-4 h-4 shrink-0" />
              Sign out
            </button>
          </div>
        </div>
      </SectionCard>

      <ConfirmModal
        isOpen={deleteFieldTarget !== null}
        message={deleteFieldTarget
          ? `Remove the custom field "${deleteFieldTarget.label}"? It disappears from every Customer, Lead, Vendor and Employee form. Values already saved on records are kept but hidden.`
          : ''}
        confirmLabel="Remove field"
        onConfirm={() => deleteFieldTarget && handleDeleteCustomField(deleteFieldTarget)}
        onCancel={() => setDeleteFieldTarget(null)}
      />

      <ConfirmModal
        isOpen={confirmSignOut}
        message="Sign out of TheLight?"
        confirmLabel="Sign out"
        onConfirm={handleSignOut}
        onCancel={() => setConfirmSignOut(false)}
      />
    </div>
  )
}
