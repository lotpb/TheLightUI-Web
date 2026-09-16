import { doc, onSnapshot } from 'firebase/firestore'
import { getFunctions, httpsCallable } from 'firebase/functions'
import { db } from '../firebase/config'
import { getCompanyId } from '../stores/authStore'

export interface LeadScore {
  score: number
  reason: string
}

export interface LeadScoreDoc {
  scores: Record<string, LeadScore>
  scoredAt: Date
  scoredCount: number
}

export function subscribeToLeadScores(
  onData: (doc: LeadScoreDoc | null) => void,
  onError: (e: Error) => void,
): () => void {
  const companyId = getCompanyId()
  if (!companyId) { onData(null); return () => {} }

  return onSnapshot(
    doc(db, 'LeadScores', companyId),
    snap => {
      if (!snap.exists()) { onData(null); return }
      const d = snap.data()
      onData({
        scores:      (d['scores'] as Record<string, LeadScore>) ?? {},
        scoredAt:    d['scoredAt']?.toDate() ?? new Date(0),
        scoredCount: (d['scoredCount'] as number) ?? 0,
      })
    },
    e => onError(e as Error),
  )
}

export interface LeadScoringResult {
  scored: number
  /**
   * Leads that qualified, before the model's own cap.
   *
   * The callable reads the first 200 company documents and scores at most 60
   * of them. Without these two numbers the board showed badges on an
   * arbitrary subset and said nothing, so "not scored" and "scored but
   * unremarkable" looked identical.
   */
  eligible: number
  /** True when the 200-document read itself was capped. */
  readCapped: boolean
}

export async function requestLeadScoring(): Promise<LeadScoringResult> {
  const fns = getFunctions()
  const fn  = httpsCallable<Record<string, never>, Partial<LeadScoringResult>>(fns, 'scoreLeads')
  const res = await fn({})
  return {
    scored: res.data.scored ?? 0,
    // A deployment predating these fields returns neither; falling back to the
    // scored count keeps the caption truthful rather than claiming a sample
    // size it can't substantiate.
    eligible: res.data.eligible ?? res.data.scored ?? 0,
    readCapped: res.data.readCapped === true,
  }
}
