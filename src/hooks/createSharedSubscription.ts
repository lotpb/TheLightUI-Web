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
  /**
   * True when this collection could not be loaded: the listener errored, or it
   * never delivered a first snapshot. Distinct from "loaded and empty" — a
   * consumer deriving a value from it (a health score from invoices) must not
   * treat missing data as absent data and publish a confident wrong answer.
   */
  failed: boolean
}

/** How long the underlying listener stays alive after the last consumer leaves. */
const TEARDOWN_DELAY_MS = 5_000

/**
 * How long to wait for a first snapshot before declaring the listener failed.
 *
 * Firestore does not always call the error handler — a listener can simply stop
 * delivering, with no data and no error — and then `loading` stays true forever
 * and any UI holding a slot for the value holds it forever too. /customers
 * renders an animate-pulse placeholder on every row's health badge in exactly
 * that case, which reads as a page that never finished loading.
 */
const FIRST_SNAPSHOT_TIMEOUT_MS = 15_000

/** Returned by a disabled hook. Module-level so the reference is stable and
 *  doesn't invalidate consumers' memo dependencies on every render. */
const DISABLED_SNAPSHOT: SharedSnapshot<unknown> = { items: [], loading: true, hitCap: false, failed: false }

export function createSharedSubscription<T>(
  subscribe: SharedSubscribe<T>,
  label: string,
): (enabled?: boolean) => SharedSnapshot<T> {
  type Listener = (snap: SharedSnapshot<T>) => void

  let snapshot: SharedSnapshot<T> = { items: [], loading: true, hitCap: false, failed: false }
  let unsub: Unsubscribe | null = null
  let subscribedCompanyId: string | null = null
  let refCount = 0
  let teardownTimer: ReturnType<typeof setTimeout> | null = null
  let firstSnapshotTimer: ReturnType<typeof setTimeout> | null = null
  const listeners = new Set<Listener>()

  function notify() {
    for (const l of listeners) l(snapshot)
  }

  function clearFirstSnapshotTimer() {
    if (firstSnapshotTimer) {
      clearTimeout(firstSnapshotTimer)
      firstSnapshotTimer = null
    }
  }

  function open(companyId: string) {
    unsub?.()
    clearFirstSnapshotTimer()
    subscribedCompanyId = companyId
    // Keep the previous items visible while the new company's data loads,
    // matching the original useSharedCustomers behaviour.
    snapshot = { items: snapshot.items, loading: true, hitCap: snapshot.hitCap, failed: false }
    notify()

    firstSnapshotTimer = setTimeout(() => {
      firstSnapshotTimer = null
      if (!snapshot.loading) return
      console.error(
        `[shared:${label}] no first snapshot within ${FIRST_SNAPSHOT_TIMEOUT_MS}ms — ` +
        'giving up so consumers stop waiting. The listener stays open in case it recovers.',
      )
      snapshot = { ...snapshot, loading: false, failed: true }
      notify()
    }, FIRST_SNAPSHOT_TIMEOUT_MS)

    unsub = subscribe(
      (items, hitCap) => {
        clearFirstSnapshotTimer()
        snapshot = { items, loading: false, hitCap: hitCap ?? false, failed: false }
        notify()
      },
      err => {
        clearFirstSnapshotTimer()
        console.error(`[shared:${label}] subscription failed:`, err)
        snapshot = { ...snapshot, loading: false, failed: true }
        notify()
      },
    )
  }

  function close() {
    unsub?.()
    unsub = null
    clearFirstSnapshotTimer()
    subscribedCompanyId = null
    snapshot = { items: [], loading: true, hitCap: false, failed: false }
  }

  // A company switch while mounted must move every consumer to the new tenant.
  useAuthStore.subscribe(state => {
    if (refCount > 0 && state.companyId && state.companyId !== subscribedCompanyId) {
      open(state.companyId)
    }
  })

  /**
   * `enabled` lets a caller that only sometimes needs the data skip opening the
   * listener. Hooks can't be called conditionally, but they can opt out —
   * CustomerListPage serves four routes and only needs invoices and service
   * plans on /customers; without this it would subscribe on /leads, /vendors
   * and /employees too. Reports `loading: true` while disabled so a consumer
   * can't mistake "not subscribed" for "loaded and empty".
   */
  return function useSharedSubscription(enabled = true): SharedSnapshot<T> {
    const [state, setState] = useState(snapshot)

    useEffect(() => {
      if (!enabled) return

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
    }, [enabled])

    return enabled ? state : (DISABLED_SNAPSHOT as SharedSnapshot<T>)
  }
}
