import { createSharedSubscription } from './createSharedSubscription'
import { subscribeToInvoices } from '../services/invoiceService'
import { subscribeToProposals } from '../services/proposalService'
import { subscribeToTodos } from '../services/todoService'
import { subscribeToExpenses } from '../services/expenseService'
import { subscribeToServicePlans } from '../services/servicePlanService'
import { subscribeToCatalog } from '../services/catalogService'
import type { Invoice } from '../models/invoice'
import type { Proposal } from '../models/proposal'
import type { Todo } from '../models/todo'
import type { Expense } from '../models/expense'
import type { ServicePlan } from '../models/servicePlan'
import type { CatalogItem } from '../models/catalogItem'

/**
 * Shared listeners for the company-wide collections with more than one reader.
 *
 * Consumer counts at the time of writing: invoices 7, todos 5, service plans 5,
 * proposals 4, catalog 4, expenses 3. Without sharing, a page that reads three
 * of them opens three listeners, and GlobalSearch opens five at once every time
 * the palette is opened.
 *
 * Customers has its own module (useSharedCustomers) purely because it is
 * imported in so many places.
 */

export const useSharedInvoices     = createSharedSubscription<Invoice>(subscribeToInvoices, 'Invoices')
export const useSharedProposals    = createSharedSubscription<Proposal>(subscribeToProposals, 'Proposals')
export const useSharedTodos        = createSharedSubscription<Todo>(subscribeToTodos, 'ToDoItems')
export const useSharedExpenses     = createSharedSubscription<Expense>(subscribeToExpenses, 'Expenses')
export const useSharedServicePlans = createSharedSubscription<ServicePlan>(subscribeToServicePlans, 'ServicePlans')
export const useSharedCatalog      = createSharedSubscription<CatalogItem>(subscribeToCatalog, 'catalog')
