import { doc, onSnapshot, setDoc, serverTimestamp, type Unsubscribe } from 'firebase/firestore'
import { db } from '../firebase/config'
import { getCompanyId } from '../stores/authStore'
import { DEFAULT_STAGES, type PipelineStageConfig } from '../models/pipelineStage'
import { clampStaleDays, DEFAULT_STALE_DAYS } from '../models/pipelineBoard'

// Reuses the existing companies/{companyId}/settings/{settingId} Firestore
// rule (already company-scoped, viewer-blocked) — no rule changes needed.
function stagesDoc(companyId: string) {
  return doc(db, 'companies', companyId, 'settings', 'pipelineStages')
}

/**
 * Stages plus the going-cold threshold, which lives in the same settings doc.
 *
 * STALE_DAYS was hardcoded at 7 in PipelinePage while the stages around it
 * were fully configurable — a 7-day roofing lead and a 7-day commercial bid
 * aren't the same thing. Same document, so no Firestore rule changes.
 */
export function subscribeToPipelineStages(
  onData: (stages: PipelineStageConfig[], staleDays: number) => void,
  onError: (err: Error) => void,
): Unsubscribe {
  const companyId = getCompanyId()
  if (!companyId) { onData(DEFAULT_STAGES, DEFAULT_STALE_DAYS); return () => {} }
  return onSnapshot(
    stagesDoc(companyId),
    snap => {
      const data = snap.exists() ? snap.data() : {}
      const raw = data.stages
      onData(
        Array.isArray(raw) && raw.length > 0 ? (raw as PipelineStageConfig[]) : DEFAULT_STAGES,
        clampStaleDays(data.staleDays),
      )
    },
    onError,
  )
}

export async function savePipelineStaleDays(staleDays: number): Promise<void> {
  const companyId = getCompanyId()
  if (!companyId) throw new Error('Not authenticated')
  await setDoc(
    stagesDoc(companyId),
    { staleDays: clampStaleDays(staleDays), updatedAt: serverTimestamp() },
    { merge: true },
  )
}

export async function savePipelineStages(stages: PipelineStageConfig[]): Promise<void> {
  const companyId = getCompanyId()
  if (!companyId) throw new Error('Not authenticated')
  await setDoc(stagesDoc(companyId), { stages, updatedAt: serverTimestamp() }, { merge: true })
}
