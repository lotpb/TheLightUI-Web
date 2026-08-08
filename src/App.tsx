import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import ProtectedRoute from './components/ProtectedRoute'
import Layout from './components/Layout'

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
const TipPage            = lazy(() => import('./pages/TipPage'))
const ExpenseListPage    = lazy(() => import('./pages/expenses/ExpenseListPage'))
const ExpenseFormPage    = lazy(() => import('./pages/expenses/ExpenseFormPage'))
const ChartPage          = lazy(() => import('./pages/chart/ChartPage'))
const TodoPage           = lazy(() => import('./pages/todo/TodoPage'))
const TodoEditPage       = lazy(() => import('./pages/todo/TodoEditPage'))

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

function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route path="/login"    element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/" element={<Protected><Navigate to="/dashboard" replace /></Protected>} />

          <Route path="/dashboard" element={<Protected><DashboardPage /></Protected>} />

          {['leads', 'customers', 'vendors', 'employees'].map(cat => (
            <Route key={cat} path={`/${cat}`} element={<Protected><CustomerListPage /></Protected>} />
          ))}

          <Route path="/records/new"      element={<Protected><CustomerFormPage /></Protected>} />
          <Route path="/records/:id"      element={<Protected><CustomerDetailPage /></Protected>} />
          <Route path="/records/:id/edit" element={<Protected><CustomerFormPage /></Protected>} />

          <Route path="/chat"         element={<Protected><ChatInboxPage /></Protected>} />
          <Route path="/chat/new"     element={<Protected><NewChatPage /></Protected>} />
          <Route path="/chat/:userId" element={<Protected><ChatLogPage /></Protected>} />

          <Route path="/maps"              element={<Protected><MapsPage /></Protected>} />
          <Route path="/chart"             element={<Protected><ChartPage /></Protected>} />
          <Route path="/expenses"          element={<Protected><ExpenseListPage /></Protected>} />
          <Route path="/expenses/new"      element={<Protected><ExpenseFormPage /></Protected>} />
          <Route path="/expenses/:id/edit" element={<Protected><ExpenseFormPage /></Protected>} />
          <Route path="/todo"              element={<Protected><TodoPage /></Protected>} />
          <Route path="/todo/:id/edit"     element={<Protected><TodoEditPage /></Protected>} />
          <Route path="/tip"               element={<Protected><TipPage /></Protected>} />
          <Route path="/settings"          element={<Protected><SettingsPage /></Protected>} />

          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  )
}

export default App
