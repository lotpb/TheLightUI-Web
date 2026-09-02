import { subscribeToCustomers } from '../services/customerService'
import { createSharedSubscription } from './createSharedSubscription'
import type { CustomerItem } from '../models/customer'

/**
 * Shares a single Firestore `Customers` listener across every consumer instead
 * of each page opening its own — ~30 pages read this collection.
 *
 * The ref-counting, delayed teardown, and company-switch handling now live in
 * createSharedSubscription; see that file for why the teardown is delayed.
 */
export const useSharedCustomers = createSharedSubscription<CustomerItem>(
  subscribeToCustomers,
  'Customers',
)
