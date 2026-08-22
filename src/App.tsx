import { lazy, Suspense } from 'react'
import { createBrowserRouter, createRoutesFromElements, RouterProvider, Route, Navigate, Outlet } from 'react-router-dom'
import ProtectedRoute from './components/ProtectedRoute'
import Layout from './components/Layout'
import { ToastProvider } from './components/Toast'
import ErrorBoundary from './components/ErrorBoundary'

// Pages are lazy-loaded — each becomes its own chunk
const LoginPage          = lazy(() => import('./pages/LoginPage'))
const RegisterPage       = lazy(() => import('./pages/RegisterPage'))
const DashboardPage      = lazy(() => import('./pages/DashboardPage'))
const CustomerListPage   = lazy(() => import('./pages/customers/CustomerListPage'))
const CustomerDetailPage = lazy(() => import('./pages/customers/CustomerDetailPage'))
const CustomerFormPage   = lazy(() => import('./pages/customers/CustomerFormPage'))
const ChatInboxPage      = lazy(() => import('./pages/chat/ChatInboxPage'))
const ChatLogPage        = lazy(() => import('./pages/chat/ChatLogPage'))
const NewChatPage        = lazy(() => import('./pages/chat/NewChatPage'))
const MapsPage           = lazy(() => import('./pages/maps/MapsPage'))
const SettingsPage       = lazy(() => import('./pages/SettingsPage'))
const ProfilePage        = lazy(() => import('./pages/ProfilePage'))
const TipPage            = lazy(() => import('./pages/TipPage'))
const PipelinePage       = lazy(() => import('./pages/pipeline/PipelinePage'))
const ExpenseListPage    = lazy(() => import('./pages/expenses/ExpenseListPage'))
const ExpenseFormPage    = lazy(() => import('./pages/expenses/ExpenseFormPage'))
const ChartPage          = lazy(() => import('./pages/chart/ChartPage'))
const CalendarPage       = lazy(() => import('./pages/calendar/CalendarPage'))
const ReportsPage        = lazy(() => import('./pages/reports/ReportsPage'))
const GoalsPage          = lazy(() => import('./pages/goals/GoalsPage'))
const TodoPage           = lazy(() => import('./pages/todo/TodoPage'))
const TodoEditPage       = lazy(() => import('./pages/todo/TodoEditPage'))
const JobsPage           = lazy(() => import('./pages/jobs/JobsPage'))
const CommissionPage     = lazy(() => import('./pages/commission/CommissionPage'))
const DuplicatesPage     = lazy(() => import('./pages/duplicates/DuplicatesPage'))
const QuotePage          = lazy(() => import('./pages/quote/QuotePage'))
const CallbackQueuePage  = lazy(() => import('./pages/callback/CallbackQueuePage'))
const TargetsPage        = lazy(() => import('./pages/targets/TargetsPage'))
const ActivityFeedPage   = lazy(() => import('./pages/activity/ActivityFeedPage'))
const ImportPage         = lazy(() => import('./pages/import/ImportPage'))
const BroadcastPage      = lazy(() => import('./pages/blast/BlastPage'))
const FunnelPage         = lazy(() => import('./pages/funnel/FunnelPage'))
const InvoiceListPage        = lazy(() => import('./pages/invoices/InvoiceListPage'))
const InvoiceFormPage        = lazy(() => import('./pages/invoices/InvoiceFormPage'))
const InvoiceDetailPage      = lazy(() => import('./pages/invoices/InvoiceDetailPage'))
const RecurringInvoicesPage  = lazy(() => import('./pages/invoices/RecurringInvoicesPage'))
const HeatMapPage        = lazy(() => import('./pages/heatmap/HeatMapPage'))
const FollowUpsPage      = lazy(() => import('./pages/followups/FollowUpsPage'))
const ForecastPage       = lazy(() => import('./pages/forecast/ForecastPage'))
const BatchPage          = lazy(() => import('./pages/batch/BatchPage'))
const ServicePlansPage   = lazy(() => import('./pages/serviceplans/ServicePlansPage'))
const LeaderboardPage    = lazy(() => import('./pages/leaderboard/LeaderboardPage'))
const CatalogPage        = lazy(() => import('./pages/catalog/CatalogPage'))
const PublicInvoicePage   = lazy(() => import('./pages/invoices/PublicInvoicePage'))
const CustomerPortalPage  = lazy(() => import('./pages/portal/CustomerPortalPage'))
const TimeTrackingPage   = lazy(() => import('./pages/timetracking/TimeTrackingPage'))
const ReferralsPage      = lazy(() => import('./pages/referrals/ReferralsPage'))
const TeamPage           = lazy(() => import('./pages/team/TeamPage'))
const JoinPage           = lazy(() => import('./pages/join/JoinPage'))
const TemplatesPage         = lazy(() => import('./pages/templates/TemplatesPage'))
const SequencesPage         = lazy(() => import('./pages/sequences/SequencesPage'))
const MenuPage              = lazy(() => import('./pages/menu/MenuPage'))
const DocTemplatesPage      = lazy(() => import('./pages/doctemplates/DocTemplatesPage'))
const DocTemplatePreviewPage = lazy(() => import('./pages/doctemplates/DocTemplatePreviewPage'))
const LeadFormsPage         = lazy(() => import('./pages/leadforms/LeadFormsPage'))
const PublicLeadFormPage    = lazy(() => import('./pages/leadforms/PublicLeadFormPage'))
const CampaignsPage         = lazy(() => import('./pages/campaigns/CampaignsPage'))
const CampaignDetailPage    = lazy(() => import('./pages/campaigns/CampaignDetailPage'))
const SigningRequestsPage   = lazy(() => import('./pages/signing/SigningRequestsPage'))
const PublicSigningPage     = lazy(() => import('./pages/signing/PublicSigningPage'))
const ExportPage            = lazy(() => import('./pages/export/ExportPage'))
const AutomationsPage       = lazy(() => import('./pages/automations/AutomationsPage'))
const ServiceRequestsPage   = lazy(() => import('./pages/servicerequests/ServiceRequestsPage'))
const EmailInboxPage        = lazy(() => import('./pages/emailinbox/EmailInboxPage'))

function PageLoader() {
  return (
    <div className="flex items-center justify-center w-full h-full min-h-[200px]">
      <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )
}

function Protected({ children }: { children: React.ReactNode }) {
  return (
    <ProtectedRoute>
      <Layout>{children}</Layout>
    </ProtectedRoute>
  )
}

// Root layout: provides Toast context + Suspense + per-page error boundary
function RootLayout() {
  return (
    <ToastProvider>
      <ErrorBoundary label="page">
        <Suspense fallback={<PageLoader />}>
          <Outlet />
        </Suspense>
      </ErrorBoundary>
    </ToastProvider>
  )
}

// createBrowserRouter (data router) is required for useBlocker to work
const router = createBrowserRouter(
  createRoutesFromElements(
    <Route element={<RootLayout />}>
      <Route path="/login"    element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/i/:token"      element={<PublicInvoicePage />} />
      <Route path="/portal/:token" element={<CustomerPortalPage />} />
      <Route path="/join"    element={<JoinPage />} />
      <Route path="/" element={<Protected><Navigate to="/menu" replace /></Protected>} />

      <Route path="/dashboard" element={<Protected><DashboardPage /></Protected>} />
      <Route path="/pipeline"  element={<Protected><PipelinePage /></Protected>} />

      {(['leads', 'customers', 'vendors', 'employees'] as const).map(cat => (
        <Route key={cat} path={`/${cat}`} element={<Protected><CustomerListPage /></Protected>} />
      ))}

      <Route path="/records/new"      element={<Protected><CustomerFormPage /></Protected>} />
      <Route path="/records/:id"      element={<Protected><CustomerDetailPage /></Protected>} />
      <Route path="/records/:id/edit"  element={<Protected><CustomerFormPage /></Protected>} />
      <Route path="/records/:id/quote" element={<Protected><QuotePage /></Protected>} />

      <Route path="/chat"         element={<Protected><ChatInboxPage /></Protected>} />
      <Route path="/chat/new"     element={<Protected><NewChatPage /></Protected>} />
      <Route path="/chat/:userId" element={<Protected><ChatLogPage /></Protected>} />

      <Route path="/maps"              element={<Protected><MapsPage /></Protected>} />
      <Route path="/chart"             element={<Protected><ChartPage /></Protected>} />
      <Route path="/calendar"           element={<Protected><CalendarPage /></Protected>} />
      <Route path="/reports"            element={<Protected><ReportsPage /></Protected>} />
      <Route path="/goals"              element={<Protected><GoalsPage /></Protected>} />
      <Route path="/expenses"          element={<Protected><ExpenseListPage /></Protected>} />
      <Route path="/expenses/new"      element={<Protected><ExpenseFormPage /></Protected>} />
      <Route path="/expenses/:id/edit" element={<Protected><ExpenseFormPage /></Protected>} />
      <Route path="/todo"              element={<Protected><TodoPage /></Protected>} />
      <Route path="/todo/:id/edit"     element={<Protected><TodoEditPage /></Protected>} />
      <Route path="/jobs"              element={<Protected><JobsPage /></Protected>} />
      <Route path="/commission"        element={<Protected><CommissionPage /></Protected>} />
      <Route path="/duplicates"        element={<Protected><DuplicatesPage /></Protected>} />
      <Route path="/callback"          element={<Protected><CallbackQueuePage /></Protected>} />
      <Route path="/targets"           element={<Protected><TargetsPage /></Protected>} />
      <Route path="/activity"          element={<Protected><ActivityFeedPage /></Protected>} />
      <Route path="/import"            element={<Protected><ImportPage /></Protected>} />
      <Route path="/blast"             element={<Protected><BroadcastPage /></Protected>} />
      <Route path="/funnel"            element={<Protected><FunnelPage /></Protected>} />
      <Route path="/appointments"      element={<Navigate to="/calendar" replace />} />
      <Route path="/invoices"              element={<Protected><InvoiceListPage /></Protected>} />
      <Route path="/invoices/new"          element={<Protected><InvoiceFormPage /></Protected>} />
      <Route path="/invoices/recurring"    element={<Protected><RecurringInvoicesPage /></Protected>} />
      <Route path="/invoices/:id"          element={<Protected><InvoiceDetailPage /></Protected>} />
      <Route path="/invoices/:id/edit"     element={<Protected><InvoiceFormPage /></Protected>} />
      <Route path="/heatmap"           element={<Protected><HeatMapPage /></Protected>} />
      <Route path="/followups"         element={<Protected><FollowUpsPage /></Protected>} />
      <Route path="/forecast"          element={<Protected><ForecastPage /></Protected>} />
      <Route path="/batch"             element={<Protected><BatchPage /></Protected>} />
      <Route path="/service-plans"     element={<Protected><ServicePlansPage /></Protected>} />
      <Route path="/time-tracking"     element={<Protected><TimeTrackingPage /></Protected>} />
      <Route path="/referrals"         element={<Protected><ReferralsPage /></Protected>} />
      <Route path="/templates"                          element={<Protected><TemplatesPage /></Protected>} />
      <Route path="/sequences"                          element={<Protected><SequencesPage /></Protected>} />
      <Route path="/doc-templates"                      element={<Protected><DocTemplatesPage /></Protected>} />
      <Route path="/doc-templates/:id/generate"         element={<Protected><DocTemplatePreviewPage /></Protected>} />
      <Route path="/lead-forms"                          element={<Protected><LeadFormsPage /></Protected>} />
      <Route path="/f/:companyId"                        element={<PublicLeadFormPage />} />
      <Route path="/campaigns"                           element={<Protected><CampaignsPage /></Protected>} />
      <Route path="/campaigns/:id"                       element={<Protected><CampaignDetailPage /></Protected>} />
      <Route path="/signing-requests"                    element={<Protected><SigningRequestsPage /></Protected>} />
      <Route path="/sign/:token"                         element={<PublicSigningPage />} />
      <Route path="/export"                              element={<Protected><ExportPage /></Protected>} />
      <Route path="/automations"                         element={<Protected><AutomationsPage /></Protected>} />
      <Route path="/service-requests"                    element={<Protected><ServiceRequestsPage /></Protected>} />
      <Route path="/email-inbox"                         element={<Protected><EmailInboxPage /></Protected>} />
      <Route path="/team"              element={<Protected><TeamPage /></Protected>} />
      <Route path="/leaderboard"       element={<Protected><LeaderboardPage /></Protected>} />
      <Route path="/catalog"           element={<Protected><CatalogPage /></Protected>} />
      <Route path="/menu"              element={<Protected><MenuPage /></Protected>} />
      <Route path="/tip"               element={<Protected><TipPage /></Protected>} />
      <Route path="/settings"          element={<Protected><SettingsPage /></Protected>} />
      <Route path="/profile"           element={<Protected><ProfilePage /></Protected>} />

      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Route>
  )
)

function App() {
  return (
    <ErrorBoundary label="app">
      <RouterProvider router={router} />
    </ErrorBoundary>
  )
}

export default App
