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

export async function requestLeadScoring(): Promise<{ scored: number }> {
  const fns = getFunctions()
  const fn  = httpsCallable<Record<string, never>, { scored: number }>(fns, 'scoreLeads')
  const res = await fn({})
  return res.data
}
