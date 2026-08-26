import { useEffect, useMemo, useState } from 'react'
import { usePageTitle } from '../../hooks/usePageTitle'
import ConfirmModal from '../../components/ConfirmModal'
import {
  subscribeToAutomationRules, subscribeToAutomationLog,
  createAutomationRule, updateAutomationRule, deleteAutomationRule,
} from '../../services/automationRuleService'
import {
  type AutomationRule, type AutomationTrigger, type AutomationAction,
  type AutomationEntityType, type AutomationLogEntry,
  triggerFieldsFor, actionFieldsFor, actionTypesFor, ACTION_TYPE_LABELS, ENTITY_TYPE_LABELS,
  describeTrigger, describeAction,
} from '../../models/automationRule'

function emptyTrigger(): AutomationTrigger {
  return { entityType: 'customer', field: 'category', type: 'changes_to', value: 'Customer' }
}

function emptyAction(entityType: AutomationEntityType): AutomationAction {
  return { type: actionTypesFor(entityType)[0] }
}

export default function AutomationsPage() {
  usePageTitle('Automation Rules')

  const [rules, setRules] = useState<AutomationRule[]>([])
  const [log, setLog]     = useState<AutomationLogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [showLog, setShowLog] = useState(false)

  const [editId, setEditId] = useState<string | null>(null) // 'new' or rule id
  const [name, setName] = useState('')
  const [trigger, setTrigger] = useState<AutomationTrigger>(emptyTrigger())
  const [actions, setActions] = useState<AutomationAction[]>([emptyAction('customer')])
  const [saving, setSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<AutomationRule | null>(null)

  useEffect(() => {
    const u1 = subscribeToAutomationRules(items => { setRules(items); setLoading(false) }, () => setLoading(false))
    const u2 = subscribeToAutomationLog(setLog, () => {})
    return () => { u1(); u2() }
  }, [])

  const isNew = editId === 'new'
  const editingRule = useMemo(() => rules.find(r => r.id === editId) ?? null, [rules, editId])

  function openCreate() {
    setName('')
    setTrigger(emptyTrigger())
    setActions([emptyAction('customer')])
    setEditId('new')
  }

  function openEdit(rule: AutomationRule) {
    setName(rule.name)
    setTrigger(rule.trigger)
    setActions(rule.actions.length > 0 ? rule.actions : [emptyAction(rule.trigger.entityType)])
    setEditId(rule.id)
  }

  function closeModal() {
    setEditId(null)
  }

  function setEntityType(entityType: AutomationEntityType) {
    const fields = triggerFieldsFor(entityType)
    setTrigger({ entityType, field: fields[0].value, type: 'changes_to', value: fields[0].options?.[0] ?? '' })
    setActions([emptyAction(entityType)])
  }

  function updateAction(index: number, patch: Partial<AutomationAction>) {
    setActions(prev => prev.map((a, i) => i === index ? { ...a, ...patch } : a))
  }

  function addAction() {
    setActions(prev => [...prev, emptyAction(trigger.entityType)])
  }

  function removeAction(index: number) {
    setActions(prev => prev.filter((_, i) => i !== index))
  }

  async function handleSave() {
    if (!name.trim() || actions.length === 0) return
    setSaving(true)
    try {
      if (isNew) {
        await createAutomationRule({ name: name.trim(), trigger, actions })
      } else if (editingRule) {
        await updateAutomationRule(editingRule.id, { name: name.trim(), trigger, actions })
      }
      closeModal()
    } finally {
      setSaving(false)
    }
  }

  async function handleToggle(rule: AutomationRule) {
    await updateAutomationRule(rule.id, { enabled: !rule.enabled })
  }

  async function handleDelete() {
    if (!deleteTarget) return
    await deleteAutomationRule(deleteTarget.id)
    setDeleteTarget(null)
  }

  const triggerFields = triggerFieldsFor(trigger.entityType)
  const selectedField  = triggerFields.find(f => f.value === trigger.field)
  const actionFields   = actionFieldsFor(trigger.entityType)

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">

      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Automation Rules</h1>
          <p className="text-sm text-gray-500 mt-0.5">If/Then triggers that run automatically when a record changes</p>
        </div>
        <button onClick={openCreate} className="btn-primary text-sm px-4 py-2 shrink-0">
          + New Rule
        </button>
      </div>

      {/* Rules list */}
      {loading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : rules.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="text-gray-400 font-medium">No automation rules yet</p>
          <p className="text-sm text-gray-600 mt-1">Create one to react automatically to changes on Customers, Invoices, Service Requests, Purchase Orders, or E-Signature Requests.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {rules.map(rule => (
            <div key={rule.id} className="card p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-semibold text-white">{rule.name}</p>
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                      rule.enabled ? 'bg-green-500/20 text-green-300' : 'bg-gray-700 text-gray-400'
                    }`}>
                      {rule.enabled ? 'Active' : 'Paused'}
                    </span>
                    <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-gray-800 text-gray-400">
                      {ENTITY_TYPE_LABELS[rule.trigger.entityType]}
                    </span>
                  </div>
                  <p className="text-sm text-gray-400 mt-1.5">{describeTrigger(rule.trigger)}</p>
                  <ul className="mt-2 space-y-1">
                    {rule.actions.map((a, i) => (
                      <li key={i} className="text-xs text-gray-500 flex items-center gap-1.5">
                        <svg className="w-3 h-3 text-indigo-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 8.25 21 12m0 0-3.75 3.75M21 12H3" />
                        </svg>
                        {describeAction(a)}
                      </li>
                    ))}
                  </ul>
                  {rule.runCount > 0 && (
                    <p className="text-xs text-gray-600 mt-2">
                      Fired {rule.runCount} time{rule.runCount === 1 ? '' : 's'}
                      {rule.lastRunAt && ` · last ${rule.lastRunAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    onClick={() => handleToggle(rule)}
                    title={rule.enabled ? 'Pause rule' : 'Activate rule'}
                    className={`relative w-9 h-5 rounded-full transition-colors ${rule.enabled ? 'bg-indigo-600' : 'bg-gray-700'}`}
                  >
                    <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${rule.enabled ? 'translate-x-4' : ''}`} />
                  </button>
                  <button onClick={() => openEdit(rule)} className="text-gray-500 hover:text-gray-200 p-1.5 rounded-lg hover:bg-gray-800 transition-colors">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.863 4.487Zm0 0L19.5 7.125" />
                    </svg>
                  </button>
                  <button onClick={() => setDeleteTarget(rule)} className="text-gray-500 hover:text-red-400 p-1.5 rounded-lg hover:bg-gray-800 transition-colors">
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

      {/* Recent activity */}
      <div className="mt-8">
        <button
          onClick={() => setShowLog(v => !v)}
          className="flex items-center gap-1.5 text-sm font-medium text-gray-400 hover:text-gray-200 transition-colors"
        >
          <svg className={`w-3.5 h-3.5 transition-transform ${showLog ? '' : '-rotate-90'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="m19 9-7 7-7-7" />
          </svg>
          Recent Activity {log.length > 0 && `(${log.length})`}
        </button>
        {showLog && (
          <div className="mt-3 card divide-y divide-gray-800">
            {log.length === 0 ? (
              <p className="p-4 text-sm text-gray-600">No automations have fired yet.</p>
            ) : log.map(entry => (
              <div key={entry.id} className="p-3 flex items-center justify-between gap-3 text-sm">
                <div className="min-w-0">
                  <p className="text-gray-300 truncate">
                    <span className="font-medium text-white">{entry.ruleName}</span>
                    {' → '}
                    <span>{ENTITY_TYPE_LABELS[entry.entityType]}</span> "{entry.entityLabel}"
                  </p>
                  <p className="text-xs text-gray-500 truncate">{entry.actionsSummary}</p>
                </div>
                <span className="text-xs text-gray-600 shrink-0">
                  {entry.ranAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create / Edit modal */}
      {editId && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-0 sm:px-4">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={closeModal} />
          <div className="relative bg-gray-900 border border-gray-700 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-2xl shadow-2xl flex flex-col max-h-[94vh]">

            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700 shrink-0">
              <p className="font-semibold text-white">{isNew ? 'New Automation Rule' : `Edit: ${editingRule?.name ?? ''}`}</p>
              <button type="button" onClick={closeModal} className="text-gray-400 hover:text-gray-200">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-5">

              {/* Name */}
              <div>
                <label className="block text-xs text-gray-500 mb-1.5">Rule Name *</label>
                <input
                  autoFocus
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="e.g. Welcome new customers"
                  className="input-field w-full text-sm"
                />
              </div>

              {/* Trigger */}
              <div className="border border-gray-800 rounded-xl p-4 space-y-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">If — Trigger</p>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1.5">Record Type</label>
                    <select
                      value={trigger.entityType}
                      onChange={e => setEntityType(e.target.value as AutomationEntityType)}
                      className="input-field text-sm w-full"
                    >
                      {(Object.keys(ENTITY_TYPE_LABELS) as AutomationEntityType[]).map(et => (
                        <option key={et} value={et}>{ENTITY_TYPE_LABELS[et]}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1.5">Field</label>
                    <select
                      value={trigger.field}
                      onChange={e => {
                        const field = e.target.value
                        const opt = triggerFields.find(f => f.value === field)
                        setTrigger(t => ({ ...t, field, value: opt?.options?.[0] ?? '' }))
                      }}
                      className="input-field text-sm w-full"
                    >
                      {triggerFields.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 items-end">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1.5">Condition</label>
                    <select
                      value={trigger.type}
                      onChange={e => setTrigger(t => ({ ...t, type: e.target.value as AutomationTrigger['type'] }))}
                      className="input-field text-sm w-full"
                    >
                      <option value="changes_to">Changes to a specific value</option>
                      <option value="any_change">Changes at all</option>
                    </select>
                  </div>
                  {trigger.type === 'changes_to' && (
                    <div>
                      <label className="block text-xs text-gray-500 mb-1.5">Value</label>
                      {selectedField?.options ? (
                        <select
                          value={trigger.value}
                          onChange={e => setTrigger(t => ({ ...t, value: e.target.value }))}
                          className="input-field text-sm w-full"
                        >
                          {selectedField.options.map(o => <option key={o} value={o}>{o}</option>)}
                        </select>
                      ) : (
                        <input
                          value={trigger.value}
                          onChange={e => setTrigger(t => ({ ...t, value: e.target.value }))}
                          placeholder="Value"
                          className="input-field text-sm w-full"
                        />
                      )}
                    </div>
                  )}
                </div>

                <p className="text-xs text-gray-500 italic">{describeTrigger(trigger)}</p>
              </div>

              {/* Actions */}
              <div className="border border-gray-800 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Then — Actions</p>
                  <button type="button" onClick={addAction} className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors">
                    + Add action
                  </button>
                </div>

                {actions.map((action, i) => (
                  <div key={i} className="bg-gray-800/50 rounded-lg p-3 space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <select
                        value={action.type}
                        onChange={e => updateAction(i, { type: e.target.value as AutomationAction['type'] })}
                        className="input-field text-sm flex-1"
                      >
                        {actionTypesFor(trigger.entityType).map(t => (
                          <option key={t} value={t}>{ACTION_TYPE_LABELS[t]}</option>
                        ))}
                      </select>
                      {actions.length > 1 && (
                        <button type="button" onClick={() => removeAction(i)} className="text-gray-500 hover:text-red-400 p-1">
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                          </svg>
                        </button>
                      )}
                    </div>

                    {action.type === 'set_field' && (
                      <div className="grid grid-cols-2 gap-2">
                        <select
                          value={action.field ?? actionFields[0].value}
                          onChange={e => updateAction(i, { field: e.target.value, value: '' })}
                          className="input-field text-sm w-full"
                        >
                          {actionFields.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                        </select>
                        {(() => {
                          const opt = actionFields.find(f => f.value === (action.field ?? actionFields[0].value))
                          return opt?.options ? (
                            <select
                              value={action.value ?? ''}
                              onChange={e => updateAction(i, { value: e.target.value })}
                              className="input-field text-sm w-full"
                            >
                              {opt.options.map(o => <option key={o} value={o}>{o}</option>)}
                            </select>
                          ) : (
                            <input
                              value={action.value ?? ''}
                              onChange={e => updateAction(i, { value: e.target.value })}
                              placeholder="New value"
                              className="input-field text-sm w-full"
                            />
                          )
                        })()}
                      </div>
                    )}

                    {action.type === 'add_note' && (
                      <textarea
                        value={action.text ?? ''}
                        onChange={e => updateAction(i, { text: e.target.value })}
                        placeholder="Note text to add to the customer's comments"
                        rows={2}
                        className="input-field text-sm w-full resize-none"
                      />
                    )}

                    {action.type === 'set_followup_days' && (
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          min={0}
                          value={action.days ?? 0}
                          onChange={e => updateAction(i, { days: Number(e.target.value) })}
                          className="input-field text-sm w-24"
                        />
                        <span className="text-sm text-gray-500">day(s) from now</span>
                      </div>
                    )}

                    {action.type === 'send_email' && (
                      <div className="space-y-2">
                        <input
                          value={action.subject ?? ''}
                          onChange={e => updateAction(i, { subject: e.target.value })}
                          placeholder="Email subject — supports {first} {lastname} {city} {salesman}"
                          className="input-field text-sm w-full"
                        />
                        <textarea
                          value={action.body ?? ''}
                          onChange={e => updateAction(i, { body: e.target.value })}
                          placeholder="Email body"
                          rows={3}
                          className="input-field text-sm w-full resize-none"
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-gray-700 shrink-0">
              <button onClick={closeModal} className="btn-secondary text-sm px-4 py-2">Cancel</button>
              <button
                onClick={handleSave}
                disabled={!name.trim() || saving}
                className="btn-primary text-sm px-4 py-2 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {saving ? 'Saving…' : isNew ? 'Create Rule' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      <ConfirmModal
        isOpen={deleteTarget !== null}
        message={deleteTarget ? `Delete "${deleteTarget.name}"? This cannot be undone.` : ''}
        confirmLabel="Delete"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}
