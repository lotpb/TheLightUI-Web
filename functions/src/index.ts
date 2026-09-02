// Cloud Functions entry point.
//
// This file exists only to re-export the deployed functions; the
// implementations live in the domain modules alongside it. Export names are
// the deployed function names, so moving one between modules is safe but
// renaming one destroys and recreates it.

export {
  onUserCreated,
  setupAccount,
  inviteUser,
  fixRole,
  syncUserClaims,
  adminListAllTeams,
  adminDeleteOrphanCompany,
  verifyRegistration,
} from './accounts'

export {
  createStripeCheckout,
  stripeWebhook,
  stripeConnectStart,
  stripeConnectCallback,
  stripeConnectDisconnect,
  stripeConnectWebhook,
} from './stripe'

export {
  connectFinancing,
  disconnectFinancing,
  createFinancingApplication,
  financingWebhook,
} from './financing'

export {
  quickbooksConnect,
  quickbooksOAuthCallback,
  quickbooksDisconnect,
  pushInvoiceToQuickBooks,
} from './quickbooks'

export {
  scoreLeads,
  draftReply,
} from './ai'

export {
  generateRecurringInvoices,
  bulkSendInvoiceReminders,
  bulkSendProposalReminders,
} from './invoices'

export {
  onNewChatMessage,
  onLeadCreated,
  onCustomerAssigned,
  warrantyExpirationReminders,
} from './alerts'

export {
  bulkSendEmail,
  sendSms,
  smsInboundWebhook,
  smsStatusWebhook,
  emailInboundWebhook,
} from './outreach'

export {
  onCustomerAutomation,
  onInvoiceAutomation,
  onServiceRequestAutomation,
  onServiceRequestCreated,
  getPortalDayAvailability,
  onPurchaseOrderAutomation,
  onSigningRequestAutomation,
} from './automations'

export {
  onCustomerAudit,
  onInvoiceAudit,
  onProposalAudit,
  onProposalResponse,
  onCompanyProfileWrite,
} from './audit'

export {
  apiRead,
} from './api'

export {
  facebookConnect,
  facebookOAuthCallback,
  facebookSubscribePage,
  facebookDisconnect,
  facebookLeadWebhook,
} from './facebook'

