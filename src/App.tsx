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
const BlastPage          = lazy(() => import('./pages/blast/BlastPage'))
const FunnelPage         = lazy(() => import('./pages/funnel/FunnelPage'))
const AppointmentsPage   = lazy(() => import('./pages/appointments/AppointmentsPage'))
const InvoiceListPage    = lazy(() => import('./pages/invoices/InvoiceListPage'))
const InvoiceFormPage    = lazy(() => import('./pages/invoices/InvoiceFormPage'))
const InvoiceDetailPage  = lazy(() => import('./pages/invoices/InvoiceDetailPage'))
const HeatMapPage        = lazy(() => import('./pages/heatmap/HeatMapPage'))
const FollowUpsPage      = lazy(() => import('./pages/followups/FollowUpsPage'))
const ForecastPage       = lazy(() => import('./pages/forecast/ForecastPage'))
const BatchPage          = lazy(() => import('./pages/batch/BatchPage'))
const ServicePlansPage   = lazy(() => import('./pages/serviceplans/ServicePlansPage'))

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
      <Route path="/" element={<Protected><Navigate to="/dashboard" replace /></Protected>} />

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
      <Route path="/blast"             element={<Protected><BlastPage /></Protected>} />
      <Route path="/funnel"            element={<Protected><FunnelPage /></Protected>} />
      <Route path="/appointments"      element={<Protected><AppointmentsPage /></Protected>} />
      <Route path="/invoices"          element={<Protected><InvoiceListPage /></Protected>} />
      <Route path="/invoices/new"      element={<Protected><InvoiceFormPage /></Protected>} />
      <Route path="/invoices/:id"      element={<Protected><InvoiceDetailPage /></Protected>} />
      <Route path="/invoices/:id/edit" element={<Protected><InvoiceFormPage /></Protected>} />
      <Route path="/heatmap"           element={<Protected><HeatMapPage /></Protected>} />
      <Route path="/followups"         element={<Protected><FollowUpsPage /></Protected>} />
      <Route path="/forecast"          element={<Protected><ForecastPage /></Protected>} />
      <Route path="/batch"             element={<Protected><BatchPage /></Protected>} />
      <Route path="/service-plans"     element={<Protected><ServicePlansPage /></Protected>} />
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
