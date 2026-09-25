// Subscription plans and which modules each one unlocks.
//
// Mirrors the pricing page on the marketing site (thelight-crm.web.app):
// Starter excludes team chat, analytics and API access; Enterprise adds the
// integrations, developer and governance tools on top of Professional.
//
// The plan lives on companies/{companyId}.plan, written only by Cloud
// Functions (adminSetCompanyPlan, and onUserCreated/setupAccount, which start
// new companies on Starter). Every company created before plans existed
// carries plan: 'free' — those are "unassigned" and keep full access, so
// shipping this never locks an existing team out of a feature they were
// already using. Such a company is only restricted once someone deliberately
// assigns it a plan.
//
// Enforced in three places that must agree: this file (nav + route guard),
// the planAtLeast() Firestore rule, and requirePlan() in functions/src/common.ts.

export type Plan = 'starter' | 'professional' | 'enterprise'

export const PLANS: readonly Plan[] = ['starter', 'professional', 'enterprise']

export const PLAN_LABELS: Record<Plan, string> = {
  starter:      'Starter',
  professional: 'Professional',
  enterprise:   'Enterprise',
}

const PLAN_RANK: Record<Plan, number> = { starter: 0, professional: 1, enterprise: 2 }

/** A stored plan value, or null when it's missing, 'free', or anything unrecognised. */
export function parsePlan(value: unknown): Plan | null {
  return typeof value === 'string' && (PLANS as readonly string[]).includes(value)
    ? value as Plan
    : null
}

/** The plan features are checked against — unassigned companies get everything. */
export function effectivePlan(plan: Plan | null): Plan {
  return plan ?? 'enterprise'
}

export function planIncludes(plan: Plan, required: Plan): boolean {
  return PLAN_RANK[plan] >= PLAN_RANK[required]
}

/** Seat and record caps. null means unlimited. */
export interface PlanLimits { users: number | null; leads: number | null }

export const PLAN_LIMITS: Record<Plan, PlanLimits> = {
  starter:      { users: 3,    leads: 500 },
  professional: { users: null, leads: null },
  enterprise:   { users: null, leads: null },
}

/**
 * Why adding `adding` records would break the plan's record cap, or null if
 * it fits. Counts every record in the Customers collection — leads,
 * customers, vendors and employees alike — because category is too sparsely
 * populated on older records to count leads alone reliably.
 */
export function recordCapError(plan: Plan, existing: number, adding: number): string | null {
  const cap = PLAN_LIMITS[plan].leads
  if (cap === null || existing + adding <= cap) return null
  const room = Math.max(0, cap - existing)
  return room === 0
    ? `Your ${PLAN_LABELS[plan]} plan is at its ${cap}-record limit. Upgrade to add more.`
    : `Your ${PLAN_LABELS[plan]} plan allows ${cap} records and you have ${existing}, so only ${room} more can be added. Upgrade to add more.`
}

// Lowest plan that includes each route. Matched by longest path prefix, so
// '/invoices/recurring' (Professional) wins over '/invoices' (Starter) and a
// detail route like '/campaigns/:id' inherits from '/campaigns'. Anything not
// listed — records, maps, calendar, tasks, expenses, invoices, settings,
// team — is Starter.
const ROUTE_PLANS: Record<string, Plan> = {
  // Team
  '/chat':               'professional',
  '/leaderboard':        'professional',
  '/dispatch':           'professional',
  // Analytics
  '/dashboard':          'professional',
  '/chart':              'professional',
  '/reports':            'professional',
  '/profitability':      'professional',
  '/funnel':             'professional',
  '/forecast':           'professional',
  '/heatmap':            'professional',
  '/customer-health':    'professional',
  // Outreach
  '/templates':          'professional',
  '/followups':          'professional',
  '/sequences':          'professional',
  '/campaigns':          'professional',
  '/blast':              'professional',
  '/email-inbox':        'professional',
  '/sms-inbox':          'professional',
  '/lead-forms':         'professional',
  // Service
  '/service-plans':      'professional',
  '/warranties':         'professional',
  '/service-requests':   'professional',
  '/time-tracking':      'professional',
  '/referrals':          'professional',
  // Sales ops
  '/commission':         'professional',
  '/targets':            'professional',
  '/goals':              'professional',
  '/invoices/recurring': 'professional',
  '/purchase-orders':    'professional',
  '/vendor-scorecards':  'professional',
  '/catalog':            'professional',
  // Documents
  '/doc-templates':      'professional',
  '/signing-requests':   'professional',
  '/batch':              'professional',
  // Automation
  '/automations':        'enterprise',
  // Integrations
  '/quickbooks':         'enterprise',
  '/stripe-connect':     'enterprise',
  '/financing':          'enterprise',
  '/facebook-leads':     'enterprise',
  // Developer
  '/webhooks':           'enterprise',
  '/api-keys':           'enterprise',
  // Governance
  '/audit-log':          'enterprise',
}

/** The lowest plan that includes `pathname`. Query strings and hashes are ignored. */
export function requiredPlanFor(pathname: string): Plan {
  const path = pathname.split(/[?#]/)[0].replace(/\/+$/, '') || '/'
  let best: string | null = null
  for (const prefix of Object.keys(ROUTE_PLANS)) {
    if ((path === prefix || path.startsWith(prefix + '/'))
        && (best === null || prefix.length > best.length)) {
      best = prefix
    }
  }
  return best ? ROUTE_PLANS[best] : 'starter'
}

export function canAccessPath(plan: Plan, pathname: string): boolean {
  return planIncludes(plan, requiredPlanFor(pathname))
}
