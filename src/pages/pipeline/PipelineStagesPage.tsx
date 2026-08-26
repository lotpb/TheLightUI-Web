import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { usePageTitle } from '../../hooks/usePageTitle'
import { useSharedCustomers } from '../../hooks/useSharedCustomers'
import { subscribeToPipelineStages, savePipelineStages } from '../../services/pipelineStageService'
import {
  DEFAULT_STAGES, STAGE_COLOR_PALETTE, STAGE_COLOR_CLASSES, slugifyStageId, effectiveStageId,
  type PipelineStageConfig, type StageKind, type StageColorKey,
} from '../../models/pipelineStage'
import { categoryMatches } from '../../models/customer'
import { useToast } from '../../components/Toast'
import ConfirmModal from '../../components/ConfirmModal'

const KIND_LABELS: Record<StageKind, string> = { open: 'Normal', won: 'Marks Won', lost: 'Marks Lost' }

export default function PipelineStagesPage() {
  usePageTitle('Pipeline Stages')
  const toast = useToast()
  const { items: customers } = useSharedCustomers()

  const [stages, setStages] = useState<PipelineStageConfig[]>(DEFAULT_STAGES)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [newLabel, setNewLabel] = useState('')
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  useEffect(() => subscribeToPipelineStages(
    s => { setStages(s); setLoading(false) },
    () => setLoading(false),
  ), [])

  const salesRecords = useMemo(
    () => customers.filter(c => categoryMatches(c.category, 'Lead') || categoryMatches(c.category, 'Customer')),
    [customers],
  )
  const countByStage = useMemo(() => {
    const m: Record<string, number> = {}
    for (const c of salesRecords) {
      const id = effectiveStageId(c, stages)
      m[id] = (m[id] ?? 0) + 1
    }
    return m
  }, [salesRecords, stages])

  async function persist(next: PipelineStageConfig[]) {
    setStages(next)
    setSaving(true)
    try {
      await savePipelineStages(next)
    } catch {
      toast('Could not save changes', 'error')
    } finally {
      setSaving(false)
    }
  }

  function addStage() {
    const label = newLabel.trim()
    if (!label) return
    const id = slugifyStageId(label, new Set(stages.map(s => s.id)))
    const usedColors = new Set(stages.map(s => s.colorKey))
    const colorKey = STAGE_COLOR_PALETTE.find(c => !usedColors.has(c)) ?? STAGE_COLOR_PALETTE[0]
    persist([...stages, { id, label, colorKey, kind: 'open', requiresDate: false }])
    setNewLabel('')
  }

  function updateStage(id: string, patch: Partial<PipelineStageConfig>) {
    let next = stages.map(s => s.id === id ? { ...s, ...patch } : s)
    // Only one stage may hold the 'won' or 'lost' role at a time.
    if (patch.kind === 'won' || patch.kind === 'lost') {
      next = next.map(s => s.id !== id && s.kind === patch.kind ? { ...s, kind: 'open' as StageKind } : s)
    }
    persist(next)
  }

  function move(id: string, dir: -1 | 1) {
    const idx = stages.findIndex(s => s.id === id)
    const target = idx + dir
    if (idx < 0 || target < 0 || target >= stages.length) return
    const next = [...stages]
    ;[next[idx], next[target]] = [next[target], next[idx]]
    persist(next)
  }

  function deleteStage(id: string) {
    persist(stages.filter(s => s.id !== id))
    setConfirmDeleteId(null)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[300px]">
        <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const deleteTarget = stages.find(s => s.id === confirmDeleteId)

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 space-y-5">

      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Pipeline Stages</h1>
          <p className="text-sm text-gray-400 mt-0.5">Customize the columns on your Pipeline board</p>
        </div>
        <Link to="/pipeline" className="text-sm text-indigo-400 hover:text-indigo-300 shrink-0">
          ← Pipeline
        </Link>
      </div>

      <div className="card divide-y divide-gray-700/30 overflow-hidden">
        {stages.map((s, idx) => {
          const colors = STAGE_COLOR_CLASSES[s.colorKey]
          const count = countByStage[s.id] ?? 0
          return (
            <div key={s.id} className="p-4 space-y-3">
              <div className="flex items-center gap-2">
                <div className="flex flex-col gap-0.5 shrink-0">
                  <button
                    onClick={() => move(s.id, -1)}
                    disabled={idx === 0 || saving}
                    className="text-gray-500 hover:text-gray-200 disabled:opacity-20 transition-colors"
                  >▲</button>
                  <button
                    onClick={() => move(s.id, 1)}
                    disabled={idx === stages.length - 1 || saving}
                    className="text-gray-500 hover:text-gray-200 disabled:opacity-20 transition-colors"
                  >▼</button>
                </div>
                <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${colors.bar}`} />
                <input
                  type="text"
                  value={s.label}
                  onChange={e => updateStage(s.id, { label: e.target.value })}
                  className="input-field flex-1 text-sm py-1.5 font-medium"
                />
                <span className="text-xs text-gray-500 shrink-0">{count} record{count === 1 ? '' : 's'}</span>
                <button
                  onClick={() => count > 0 ? setConfirmDeleteId(s.id) : deleteStage(s.id)}
                  className="text-gray-600 hover:text-red-400 transition-colors shrink-0"
                  title="Delete stage"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="flex items-center gap-4 flex-wrap pl-8">
                <div className="flex items-center gap-1.5">
                  {STAGE_COLOR_PALETTE.map(key => (
                    <button
                      key={key}
                      onClick={() => updateStage(s.id, { colorKey: key as StageColorKey })}
                      className={`w-4 h-4 rounded-full ${STAGE_COLOR_CLASSES[key].bar} ${s.colorKey === key ? 'ring-2 ring-white/60' : ''}`}
                      title={key}
                    />
                  ))}
                </div>

                <select
                  value={s.kind}
                  onChange={e => updateStage(s.id, { kind: e.target.value as StageKind })}
                  className="input-field text-xs py-1 px-2"
                >
                  {(['open', 'won', 'lost'] as StageKind[]).map(k => (
                    <option key={k} value={k}>{KIND_LABELS[k]}</option>
                  ))}
                </select>

                <label className="flex items-center gap-1.5 text-xs text-gray-400 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={s.requiresDate}
                    onChange={e => updateStage(s.id, { requiresDate: e.target.checked })}
                    className="accent-indigo-500"
                  />
                  Prompt for a date
                </label>
              </div>
            </div>
          )
        })}
      </div>

      <div className="card p-4 flex gap-2">
        <input
          type="text"
          value={newLabel}
          onChange={e => setNewLabel(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') addStage() }}
          placeholder="New stage name…"
          className="input-field flex-1 text-sm py-2"
        />
        <button onClick={addStage} disabled={!newLabel.trim()} className="btn-primary text-sm px-4 py-2 disabled:opacity-40">
          + Add Stage
        </button>
      </div>

      <div className="text-xs text-gray-500 space-y-1">
        <p>• <span className="text-gray-400">Marks Won</span> converts the record to a Customer when dropped here. Only one stage can hold this role.</p>
        <p>• <span className="text-gray-400">Marks Lost</span> marks the record inactive when dropped here. Only one stage can hold this role.</p>
        <p>• Deleting a stage doesn't delete any records — they'll reappear in the first column until moved.</p>
      </div>

      <ConfirmModal
        isOpen={!!deleteTarget}
        message={`"${deleteTarget?.label}" has ${deleteTarget ? countByStage[deleteTarget.id] ?? 0 : 0} record(s) in it. They'll move to the first column until reassigned. Delete this stage?`}
        onConfirm={() => confirmDeleteId && deleteStage(confirmDeleteId)}
        onCancel={() => setConfirmDeleteId(null)}
      />
    </div>
  )
}
