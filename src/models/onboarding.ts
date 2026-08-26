export interface OnboardingStep {
  id: 'firstRecord' | 'inviteTeam' | 'firstDocument'
  label: string
  description: string
  to: string
  linkLabel: string
}

export const ONBOARDING_STEPS: OnboardingStep[] = [
  {
    id: 'firstRecord',
    label: 'Add your first lead or customer',
    description: 'Your CRM is empty — start by adding a record.',
    to: '/records/new',
    linkLabel: '+ Add a record',
  },
  {
    id: 'inviteTeam',
    label: 'Invite your team',
    description: 'Bring salesmen, admins, or viewers into your company.',
    to: '/team',
    linkLabel: 'Invite teammates',
  },
  {
    id: 'firstDocument',
    label: 'Create your first invoice or proposal',
    description: 'Bill a customer or send a quote to see it in action.',
    to: '/invoices/new',
    linkLabel: 'Create an invoice',
  },
]
