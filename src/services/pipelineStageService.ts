import { doc, onSnapshot, setDoc, serverTimestamp, type Unsubscribe } from 'firebase/firestore'
import { db } from '../firebase/config'
import { getCompanyId } from '../stores/authStore'
import { DEFAULT_STAGES, type PipelineStageConfig } from '../models/pipelineStage'

// Reuses the existing companies/{companyId}/settings/{settingId} Firestore
// rule (already company-scoped, viewer-blocked) — no rule changes needed.
function stagesDoc(companyId: string) {
  return doc(db, 'companies', companyId, 'settings', 'pipelineStages')
}

export function subscribeToPipelineStages(
  onData: (stages: PipelineStageConfig[]) => void,
  onError: (err: Error) => void,
): Unsubscribe {
  const companyId = getCompanyId()
  if (!companyId) { onData(DEFAULT_STAGES); return () => {} }
  return onSnapshot(
    stagesDoc(companyId),
    snap => {
      const raw = snap.exists() ? snap.data().stages : null
      onData(Array.isArray(raw) && raw.length > 0 ? (raw as PipelineStageConfig[]) : DEFAULT_STAGES)
    },
    onError,
  )
}

export async function savePipelineStages(stages: PipelineStageConfig[]): Promise<void> {
  const companyId = getCompanyId()
  if (!companyId) throw new Error('Not authenticated')
  await setDoc(stagesDoc(companyId), { stages, updatedAt: serverTimestamp() }, { merge: true })
}
