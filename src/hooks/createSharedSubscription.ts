import { useEffect, useState } from 'react'
import type { Unsubscribe } from 'firebase/firestore'
import { useAuthStore, getCompanyId } from '../stores/authStore'

/**
 * Turns a company-wide `subscribeToX` service function into a hook that opens
 * at most one Firestore listener no matter how many components use it.
 *
 * Several collections are read by a dozen or more pages, and a few components
 * (GlobalSearch) open five at once — each previously its own listener, its own
 * download, and its own copy in memory. Sharing collapses those to one.
 *
 * The delayed teardown is not just an optimisation. Tearing a listener down and
 * immediately recreating it — which is what a tab switcher or a command palette
 * that opens and closes does — is enough to trip the Firestore SDK's
 * "INTERNAL ASSERTION FAILED: Unexpected state". Keeping the subscription warm
 * for a few seconds after the last consumer unmounts avoids that entirely.
 *
 * Generalised from the hand-rolled useSharedCustomers, which is now built on it.
 */

/** Matches services that report a cap and those that don't (hitCap optional). */
export type SharedSubscribe<T> = (
  onData: (items: T[], hitCap?: boolean) => void,
  onError: (err: Error) => void,
) => Unsubscribe

export interface SharedSnapshot<T> {
  items: T[]
  loading: boolean
  /** True when the service hit its realtime document cap — results are partial. */
  hitCap: boolean
}

/** How long the underlying listener stays alive after the last consumer leaves. */
const TEARDOWN_DELAY_MS = 5_000

export function createSharedSubscription<T>(
  subscribe: SharedSubscribe<T>,
  label: string,
): () => SharedSnapshot<T> {
  type Listener = (snap: SharedSnapshot<T>) => void

  let snapshot: SharedSnapshot<T> = { items: [], loading: true, hitCap: false }
  let unsub: Unsubscribe | null = null
  let subscribedCompanyId: string | null = null
  let refCount = 0
  let teardownTimer: ReturnType<typeof setTimeout> | null = null
  const listeners = new Set<Listener>()

  function notify() {
    for (const l of listeners) l(snapshot)
  }

  function open(companyId: string) {
    unsub?.()
    subscribedCompanyId = companyId
    // Keep the previous items visible while the new company's data loads,
    // matching the original useSharedCustomers behaviour.
    snapshot = { items: snapshot.items, loading: true, hitCap: snapshot.hitCap }
    notify()
    unsub = subscribe(
      (items, hitCap) => { snapshot = { items, loading: false, hitCap: hitCap ?? false }; notify() },
      err => {
        console.error(`[shared:${label}] subscription failed:`, err)
        snapshot = { ...snapshot, loading: false }
        notify()
      },
    )
  }

  function close() {
    unsub?.()
    unsub = null
    subscribedCompanyId = null
    snapshot = { items: [], loading: true, hitCap: false }
  }

  // A company switch while mounted must move every consumer to the new tenant.
  useAuthStore.subscribe(state => {
    if (refCount > 0 && state.companyId && state.companyId !== subscribedCompanyId) {
      open(state.companyId)
    }
  })

  return function useSharedSubscription(): SharedSnapshot<T> {
    const [state, setState] = useState(snapshot)

    useEffect(() => {
      listeners.add(setState)
      setState(snapshot)

      if (teardownTimer) {
        clearTimeout(teardownTimer)
        teardownTimer = null
      }
      refCount++

      const companyId = getCompanyId()
      if (companyId && companyId !== subscribedCompanyId) open(companyId)

      return () => {
        listeners.delete(setState)
        refCount--
        if (refCount === 0) {
          teardownTimer = setTimeout(() => { if (refCount === 0) close() }, TEARDOWN_DELAY_MS)
        }
      }
    }, [])

    return state
  }
}
