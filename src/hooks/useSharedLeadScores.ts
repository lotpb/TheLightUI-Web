import { useEffect, useState } from 'react'
import { subscribeToLeadScores, type LeadScoreDoc } from '../services/leadScoreService'
import { useAuthStore, getCompanyId } from '../stores/authStore'

let doc: LeadScoreDoc | null = null
let unsub: (() => void) | null = null
let subscribedCompanyId: string | null = null
let refCount = 0
let teardownTimer: ReturnType<typeof setTimeout> | null = null
const listeners = new Set<(d: LeadScoreDoc | null) => void>()

function notify() {
  for (const l of listeners) l(doc)
}

function subscribe(companyId: string) {
  unsub?.()
  subscribedCompanyId = companyId
  unsub = subscribeToLeadScores(
    (d) => { doc = d; notify() },
    ()  => {},
  )
}

function teardown() {
  unsub?.()
  unsub = null
  subscribedCompanyId = null
  doc = null
}

useAuthStore.subscribe((state) => {
  if (refCount > 0 && state.companyId && state.companyId !== subscribedCompanyId) {
    subscribe(state.companyId)
  }
})

/**
 * Same rationale as useSharedCustomers: flipping quickly between Pipeline and
 * Jobs unmounts/remounts Pipeline's lead-score listener on every switch, which
 * can trip the same Firestore SDK "INTERNAL ASSERTION FAILED" race. Keep the
 * listener alive for a few seconds after Pipeline unmounts instead of tearing
 * it down immediately.
 */
export function useSharedLeadScores(): LeadScoreDoc | null {
  const [state, setState] = useState(doc)

  useEffect(() => {
    listeners.add(setState)
    setState(doc)

    if (teardownTimer) {
      clearTimeout(teardownTimer)
      teardownTimer = null
    }
    refCount++

    const companyId = getCompanyId()
    if (companyId && companyId !== subscribedCompanyId) {
      subscribe(companyId)
    }

    return () => {
      listeners.delete(setState)
      refCount--
      if (refCount === 0) {
        teardownTimer = setTimeout(() => {
          if (refCount === 0) teardown()
        }, 5000)
      }
    }
  }, [])

  return state
}
