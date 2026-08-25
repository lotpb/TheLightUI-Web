import { useEffect, useState } from 'react'
import { subscribeToCustomers } from '../services/customerService'
import { useAuthStore, getCompanyId } from '../stores/authStore'
import type { CustomerItem } from '../models/customer'

interface Snapshot {
  items: CustomerItem[]
  loading: boolean
}

type Listener = (snap: Snapshot) => void

let snapshot: Snapshot = { items: [], loading: true }
let unsub: (() => void) | null = null
let subscribedCompanyId: string | null = null
let refCount = 0
let teardownTimer: ReturnType<typeof setTimeout> | null = null
const listeners = new Set<Listener>()

function notify() {
  for (const l of listeners) l(snapshot)
}

function subscribe(companyId: string) {
  unsub?.()
  subscribedCompanyId = companyId
  snapshot = { items: snapshot.items, loading: true }
  notify()
  unsub = subscribeToCustomers(
    (items) => { snapshot = { items, loading: false }; notify() },
    ()      => { snapshot = { ...snapshot, loading: false }; notify() },
  )
}

function teardown() {
  unsub?.()
  unsub = null
  subscribedCompanyId = null
  snapshot = { items: [], loading: true }
}

useAuthStore.subscribe((state) => {
  if (refCount > 0 && state.companyId && state.companyId !== subscribedCompanyId) {
    subscribe(state.companyId)
  }
})

/**
 * Shares a single Firestore `Customers` listener across every consumer instead of
 * each page opening its own. Pages that flip back and forth quickly (e.g. the
 * Pipeline/Jobs tab switcher) would otherwise tear the listener down and recreate
 * it fast enough to trip the Firestore SDK's "INTERNAL ASSERTION FAILED: Unexpected
 * state" bug, so the underlying subscription is kept alive for a few seconds after
 * the last consumer unmounts.
 */
export function useSharedCustomers(): Snapshot {
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
