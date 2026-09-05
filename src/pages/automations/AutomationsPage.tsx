import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { usePageTitle } from '../../hooks/usePageTitle'
import ConfirmModal from '../../components/ConfirmModal'
import { Icon, ICONS } from '../../components/Icon'
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
import { subscribeToCompanyProfile, saveCompanyProfile, EMPTY_PROFILE, type CompanyProfile } from '../../services/companyProfileService'
import { useToast } from '../../components/Toast'

function emptyTrigger(): AutomationTrigger {
  return { entityType: 'customer', field: 'category', type: 'changes_to', value: 'Customer' }
}

function emptyAction(entityType: AutomationEntityType): AutomationAction {
  return { type: actionTypesFor(entityType)[0] }
}

const REVIEW_PRESET_MESSAGE =
  "Thanks for choosing us, {first}! If you have a minute, we'd really appreciate a quick review: {reviewlink}"

/**
 * Why an action can't be saved yet, or null when it's complete.
 *
 * handleSave only checked the rule name and that at least one action existed,
 * so a send_sms with no message, a send_email with no subject or body, or a
 * set_field with no value all saved happily — and then fired against live
 * customers, sending blank texts. These rules message people; an empty one is
 * worse than a missing one.
 */
function actionProblem(a: AutomationAction): string | null {
  switch (a.type) {
    case 'send_sms':  return a.text?.trim()    ? null : 'Text message is empty'
    case 'add_note':  return a.text?.trim()    ? null : 'Note text is empty'
    case 'send_email':
      if (!a.subject?.trim()) return 'Email subject is empty'
      return a.body?.trim() ? null : 'Email body is empty'
    case 'set_field': return a.value?.trim()   ? null : 'No value to set'
    case 'set_followup_days': return null // 0 days is meaningful
  }
}

/**
 * Clears the fields that belonged to the previous action type.
 *
 * updateAction spread the patch over the existing object, so switching
 * send_email → send_sms kept `subject` and `body`, and → set_field kept `text`.
 * Those stale values were written to Firestore, and describeAction could render
 * a rule card describing an action using data from a type no longer selected.
 */
function resetActionForType(type: AutomationAction['type']): AutomationAction {
  return { type }
}

/** Deep link where one exists, the module's list page otherwise. */
function entityHref(entry: AutomationLogEntry): string {
  switch (entry.entityType) {
    case 'customer':       return `/records/${entry.entityId}`
    case 'invoice':        return `/invoices/${entry.entityId}`
    case 'serviceRequest': return '/service-requests'
    case 'purchaseOrder':  return '/purchase-orders'
    case 'signingRequest': return '/signing-requests'
  }
}

export default function AutomationsPage() {
  usePageTitle('Automation Rules')
  const toast = useToast()

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
  // Activating is the consequential direction — it's what starts sending texts
  // and emails to customers — and it used to happen on one unconfirmed click,
  // while deleting (which sends nothing) already had a confirmation.
  const [activateTarget, setActivateTarget] = useState<AutomationRule | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)

  const [profile, setProfile] = useState<CompanyProfile>(EMPTY_PROFILE)
  const [reviewLink, setReviewLink] = useState('')
  const [savingReviewLink, setSavingReviewLink] = useState(false)

  useEffect(() => {
    const u1 = subscribeToAutomationRules(items => { setRules(items); setLoading(false) }, () => setLoading(false))
    const u2 = subscribeToAutomationLog(setLog, () => {})
    const u3 = subscribeToCompanyProfile(p => { setProfile(p); setReviewLink(p.reviewLink ?? '') }, () => {})
    return () => { u1(); u2(); u3() }
  }, [])

  async function handleSaveReviewLink() {
    setSavingReviewLink(true)
    try {
      // saveCompanyProfile writes every field on the object (merge:true only
      // skips fields absent from it) — passing just {reviewLink} would blank
      // out the company's name/address/phone/email, so the rest of the
      // last-loaded profile has to come along for the write.
      await saveCompanyProfile({ ...profile, reviewLink: reviewLink.trim() })
      toast('Review link saved', 'success')
    } catch {
      toast('Could not save the review link', 'error')
    } finally {
      setSavingReviewLink(false)
    }
  }

  // Prefills the new-rule modal with a ready-to-go "text on invoice paid"
  // review request — the admin still reviews and saves it via the normal
  // flow, this just removes the tedium of picking trigger/action fields by hand.
  function openReviewPreset() {
    setName('Request a review')
    setTrigger({ entityType: 'invoice', field: 'status', type: 'changes_to', value: 'paid' })
    setActions([{ type: 'send_sms', text: REVIEW_PRESET_MESSAGE }])
    setEditId('new')
  }

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

  /** Type changes replace the action rather than merging, so no stale fields survive. */
  function changeActionType(index: number, type: AutomationAction['type']) {
    setActions(prev => prev.map((a, i) => i === index ? resetActionForType(type) : a))
  }

  function addAction() {
    setActions(prev => [...prev, emptyAction(trigger.entityType)])
  }

  function removeAction(index: number) {
    setActions(prev => prev.filter((_, i) => i !== index))
  }

  // Every mutation reports failure. handleSave had try/finally but no catch, and
  // handleToggle/handleDelete were bare awaits — so a rejected write gave an
  // unhandled rejection and a UI that looked like it had worked. The page
  // already imported useToast and used it only for the review link.
  async function handleSave() {
    if (!canSave) return
    setSaving(true)
    try {
      if (isNew) {
        await createAutomationRule({ name: name.trim(), trigger, actions })
      } else if (editingRule) {
        await updateAutomationRule(editingRule.id, { name: name.trim(), trigger, actions })
      }
      closeModal()
      toast(isNew ? 'Rule created' : 'Rule saved', 'success')
    } catch {
      toast('Could not save that rule', 'error')
    } finally {
      setSaving(false)
    }
  }

  async function setEnabled(rule: AutomationRule, enabled: boolean) {
    try {
      await updateAutomationRule(rule.id, { enabled })
    } catch {
      toast(enabled ? 'Could not activate that rule' : 'Could not pause that rule', 'error')
    }
  }

  function handleToggle(rule: AutomationRule) {
    if (rule.enabled) setEnabled(rule, false)   // pausing is safe, no prompt
    else setActivateTarget(rule)                // activating starts messaging
  }

  async function handleDelete() {
    if (!deleteTarget) return
    try {
      await deleteAutomationRule(deleteTarget.id)
      setDeleteTarget(null)
      toast('Rule deleted', 'success')
    } catch {
      toast('Could not delete that rule', 'error')
    }
  }

  const triggerFields = triggerFieldsFor(trigger.entityType)
  const selectedField  = triggerFields.find(f => f.value === trigger.field)
  const actionFields   = actionFieldsFor(trigger.entityType)

  const actionProblems = actions.map(actionProblem)
  const firstProblem   = actionProblems.find(p => p !== null) ?? null
  const canSave = name.trim().length > 0 && actions.length > 0 && firstProblem === null && !saving

  // Escape closes, focus starts inside, and Tab cycles within the dialog. It was
  // a bare div with an onClick backdrop: no role, no aria-modal, no key handling
  // and no focus management, so Tab walked into the page behind a six-field form.
  useEffect(() => {
    if (!editId) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { closeModal(); return }
      if (e.key !== 'Tab') return
      const root = dialogRef.current
      if (!root) return
      const f = root.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])',
      )
      if (f.length === 0) return
      const first = f[0], last = f[f.length - 1]
      if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
      else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [editId])

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">

      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Automation Rules</h1>
          <p className="text-sm text-gray-400 mt-0.5">If/Then triggers that run automatically when a record changes</p>
        </div>
        <button onClick={openCreate} className="btn-primary text-sm px-4 py-2 shrink-0">
          + New Rule
        </button>
      </div>

      {/* Two cards, not one. These were a company-profile setting and a rule
          template fused together behind a divider, taking the most valuable
          space on the page to do two unrelated jobs. The template is now an
          offer to create something, phrased as an action; the setting is a
          setting. */}
      <div className="card p-4 mb-4">
        <label htmlFor="review-link" className="card-section-title block mb-1.5">Review Link</label>
        <div className="flex items-center gap-2">
          <input
            id="review-link"
            value={reviewLink}
            onChange={e => setReviewLink(e.target.value)}
            placeholder="https://g.page/r/.../review or your Yelp review link"
            className="input-field text-sm flex-1"
          />
          <button
            onClick={handleSaveReviewLink}
            disabled={savingReviewLink}
            className="btn-secondary inline-flex items-center gap-1.5 text-sm px-3 py-1.5 shrink-0 disabled:opacity-50"
          >
            {savingReviewLink && <span className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />}
            Save
          </button>
        </div>
        {/* bg-gray-700, not bg-gray-800: --gray-800 is 255 255 255 in light
            mode, so the code chip was white on a white card. */}
        <p className="text-xs text-gray-400 mt-1.5">
          Fills the <code className="px-1 py-0.5 rounded bg-gray-700 text-gray-200">{'{reviewlink}'}</code> tag in any rule's
          email or text message.
        </p>
      </div>

      <div className="card p-4 mb-6 flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <p className="text-sm font-medium text-gray-200">Request a review when an invoice is paid</p>
          <p className="text-xs text-gray-400 mt-0.5">Texts the customer a thank-you with your review link.</p>
        </div>
        <button
          onClick={openReviewPreset}
          className="btn-secondary inline-flex items-center gap-1.5 text-sm px-3 py-1.5 shrink-0 whitespace-nowrap"
        >
          <Icon d={ICONS.sparkle} className="w-3.5 h-3.5 shrink-0" />
          Use this rule
        </button>
      </div>

      {/* Rules list */}
      {loading ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : rules.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="text-gray-400 font-medium">No automation rules yet</p>
          <p className="text-sm text-gray-400 mt-1">Create one to react automatically to changes on Customers, Invoices, Service Requests, Purchase Orders, or E-Signature Requests.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {rules.map(rule => (
            /* A paused rule reads as paused. It used to be identical to a live
               one apart from a small pill — same card, same white title, same
               full-strength action list — on a page where "is this running?" is
               the only question that matters. Paused now loses the left accent
               and drops to 60% opacity, so the list is scannable at a glance. */
            <div
              key={rule.id}
              className={`card p-4 border-l-2 transition-opacity ${
                rule.enabled ? 'border-l-green-500' : 'border-l-gray-600 opacity-60'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-semibold text-white">{rule.name}</p>
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                      rule.enabled ? 'bg-green-500/20 text-green-300' : 'bg-gray-700 text-gray-400'
                    }`}>
                      {rule.enabled ? 'Active' : 'Paused'}
                    </span>
                    <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-gray-700 text-gray-300">
                      {ENTITY_TYPE_LABELS[rule.trigger.entityType]}
                    </span>
                  </div>
                  <p className="text-sm text-gray-400 mt-1.5">{describeTrigger(rule.trigger)}</p>
                  <ul className="mt-2 space-y-1">
                    {rule.actions.map((a, i) => (
                      <li key={i} className="text-xs text-gray-400 flex items-center gap-1.5">
                        <Icon d={ICONS.arrowRight} className="w-3 h-3 text-indigo-400 shrink-0" />
                        {describeAction(a)}
                      </li>
                    ))}
                  </ul>
                  {rule.runCount > 0 && (
                    <p className="text-xs text-gray-400 mt-2">
                      Fired {rule.runCount} time{rule.runCount === 1 ? '' : 's'}
                      {rule.lastRunAt && ` · last ${rule.lastRunAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {/* role=switch + aria-checked + a name. This was a <button>
                      with only a title attribute — a screen reader announced
                      "button" for the control that decides whether a rule sends
                      texts and emails to customers. */}
                  <button
                    type="button"
                    role="switch"
                    aria-checked={rule.enabled}
                    aria-label={`${rule.enabled ? 'Pause' : 'Activate'} rule "${rule.name}"`}
                    onClick={() => handleToggle(rule)}
                    title={rule.enabled ? 'Pause rule' : 'Activate rule'}
                    className={`relative w-9 h-5 rounded-full transition-colors shrink-0
                                focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                      rule.enabled ? 'bg-indigo-600' : 'bg-gray-600'
                    }`}
                  >
                    <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${rule.enabled ? 'translate-x-4' : ''}`} />
                  </button>
                  <button
                    onClick={() => openEdit(rule)}
                    aria-label={`Edit rule "${rule.name}"`}
                    title="Edit"
                    className="text-gray-400 hover:text-gray-200 p-1.5 rounded-lg hover:bg-gray-700/50 transition-colors
                               focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                  >
                    <Icon d={ICONS.pencil} className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setDeleteTarget(rule)}
                    aria-label={`Delete rule "${rule.name}"`}
                    title="Delete"
                    className="text-gray-400 hover:text-red-400 p-1.5 rounded-lg hover:bg-gray-700/50 transition-colors
                               focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                  >
                    <Icon d={ICONS.trash} className="w-4 h-4" />
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
              <p className="p-4 text-sm text-gray-400">No automations have fired yet.</p>
            ) : log.map(entry => (
              /* The record is now reachable and the timestamp is unambiguous.
                 Entries showed month + day only, so five firings today were five
                 identical rows and last year's looked like this year's — and
                 neither the rule nor the record was a link, so you couldn't get
                 from "this fired" to the thing it changed. */
              <div key={entry.id} className="p-3 flex items-center justify-between gap-3 text-sm">
                <div className="min-w-0">
                  <p className="text-gray-300 truncate">
                    <span className="font-medium text-white">{entry.ruleName}</span>
                    <Icon d={ICONS.arrowRight} className="w-3 h-3 inline-block mx-1.5 align-[-1px] text-gray-400" />
                    <span className="text-gray-400">{ENTITY_TYPE_LABELS[entry.entityType]}</span>{' '}
                    <Link to={entityHref(entry)} className="text-indigo-400 hover:text-indigo-300 hover:underline">
                      {entry.entityLabel || 'record'}
                    </Link>
                  </p>
                  <p className="text-xs text-gray-400 truncate">{entry.actionsSummary}</p>
                </div>
                <span
                  className="text-xs text-gray-400 shrink-0 tabular-nums"
                  title={entry.ranAt.toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short' })}
                >
                  {entry.ranAt.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create / Edit modal */}
      {editId && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-0 sm:px-4">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={closeModal} aria-hidden="true" />
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="rule-dialog-title"
            className="relative bg-gray-900 border border-gray-700 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-2xl shadow-2xl flex flex-col max-h-[94vh]"
          >

            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700 shrink-0">
              <p id="rule-dialog-title" className="font-semibold text-white">
                {isNew ? 'New Automation Rule' : `Edit: ${editingRule?.name ?? ''}`}
              </p>
              <button
                type="button"
                onClick={closeModal}
                aria-label="Close"
                className="p-1.5 -mr-1.5 rounded text-gray-400 hover:text-gray-200 hover:bg-gray-700/50 transition-colors
                           focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              >
                <Icon d={ICONS.close} className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-5">

              {/* Name */}
              <div>
                <label className="form-label">Rule Name *</label>
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
                <p className="card-section-title">If — Trigger</p>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="form-label">Record Type</label>
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
                    <label className="form-label">Field</label>
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
                    <label className="form-label">Condition</label>
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
                      <label className="form-label">Value</label>
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

                <p className="text-xs text-gray-400 italic">{describeTrigger(trigger)}</p>
              </div>

              {/* Actions */}
              <div className="border border-gray-800 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="card-section-title">Then — Actions</p>
                  <button type="button" onClick={addAction} className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors">
                    + Add action
                  </button>
                </div>

                {actions.map((action, i) => (
                  <div key={i} className="bg-gray-800/50 rounded-lg p-3 space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <select
                        value={action.type}
                        aria-label={`Action ${i + 1} type`}
                        onChange={e => changeActionType(i, e.target.value as AutomationAction['type'])}
                        className="input-field text-sm flex-1"
                      >
                        {actionTypesFor(trigger.entityType).map(t => (
                          <option key={t} value={t}>{ACTION_TYPE_LABELS[t]}</option>
                        ))}
                      </select>
                      {actions.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeAction(i)}
                          aria-label={`Remove action ${i + 1}`}
                          className="p-1.5 rounded text-gray-400 hover:text-red-400 hover:bg-gray-700/50 transition-colors
                                     focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                        >
                          <Icon d={ICONS.close} className="w-4 h-4" />
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
                        <span className="text-sm text-gray-400">day(s) from now</span>
                      </div>
                    )}

                    {action.type === 'send_email' && (
                      <div className="space-y-2">
                        <input
                          value={action.subject ?? ''}
                          onChange={e => updateAction(i, { subject: e.target.value })}
                          placeholder="Email subject — supports {first} {lastname} {city} {salesman} {reviewlink}"
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

                    {action.type === 'send_sms' && (
                      <textarea
                        value={action.text ?? ''}
                        onChange={e => updateAction(i, { text: e.target.value })}
                        placeholder="Text message — supports {first} {lastname} {city} {salesman} {reviewlink}"
                        rows={3}
                        className="input-field text-sm w-full resize-none"
                      />
                    )}

                    {/* Says what's missing, per action, rather than letting an
                        empty message save and then fire at a customer. */}
                    {actionProblems[i] && (
                      <p className="flex items-center gap-1.5 text-xs text-amber-400">
                        <Icon d={ICONS.warning} className="w-3.5 h-3.5 shrink-0" />
                        {actionProblems[i]}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-gray-700 shrink-0">
              {/* The reason Save is unavailable, next to Save. */}
              {!canSave && !saving && (
                <p className="text-xs text-gray-400 mr-auto">
                  {!name.trim() ? 'Give the rule a name to save it.' : firstProblem}
                </p>
              )}
              <button onClick={closeModal} className="btn-secondary text-sm px-4 py-2">Cancel</button>
              <button
                onClick={handleSave}
                disabled={!canSave}
                className="btn-primary inline-flex items-center gap-1.5 text-sm px-4 py-2 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {saving && <span className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />}
                {isNew ? 'Create Rule' : 'Save Changes'}
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

      {/* Activation confirmation. Deleting a rule sends nothing and was already
          confirmed; switching one on is what starts contacting customers, and
          that was a single unprompted click. */}
      <ConfirmModal
        isOpen={activateTarget !== null}
        message={activateTarget
          ? `Activate "${activateTarget.name}"? It will run automatically from now on — ${describeTrigger(activateTarget.trigger).toLowerCase()}, then ${activateTarget.actions.map(describeAction).join('; ').toLowerCase()}.`
          : ''}
        confirmLabel="Activate"
        onConfirm={() => { if (activateTarget) setEnabled(activateTarget, true); setActivateTarget(null) }}
        onCancel={() => setActivateTarget(null)}
      />
    </div>
  )
}
