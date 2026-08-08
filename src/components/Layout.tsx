import { useState } from 'react'
import { NavLink, useNavigate, useLocation } from 'react-router-dom'
import { useAuthStore } from '../stores/authStore'

const ALL_NAV = [
  { to: '/dashboard', label: 'Dashboard', icon: '▦' },
  { to: '/expenses',  label: 'Expenses',  icon: '💰' },
  { to: '/leads',     label: 'Leads',     icon: '◎' },
  { to: '/customers', label: 'Customers', icon: '◉' },
  { to: '/vendors',   label: 'Vendors',   icon: '◈' },
  { to: '/employees', label: 'Employees', icon: '◆' },
  { to: '/chart',     label: 'Charts',    icon: '📊' },
  { to: '/chat',      label: 'Chat',      icon: '💬' },
  { to: '/todo',      label: 'To-Do',     icon: '✅' },
  { to: '/tip',       label: 'Tip',       icon: '💵' },
  { to: '/settings',  label: 'Settings',  icon: '⚙' },
]

// First 4 shown as tabs; rest go in "More" sheet
const MOBILE_TABS = ALL_NAV.slice(0, 4)
const MOBILE_MORE = ALL_NAV.slice(4)

const SIDEBAR_NAV = ALL_NAV

export default function Layout({ children }: { children: React.ReactNode }) {
  const signOut = useAuthStore(s => s.signOut)
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [showMore, setShowMore] = useState(false)

  const isChatLog = /^\/chat\/.+/.test(pathname)
  const isFullHeight = isChatLog || pathname === '/maps'

  async function handleSignOut() {
    await signOut()
    navigate('/login', { replace: true })
  }

  const moreIsActive = MOBILE_MORE.some(item => pathname.startsWith(item.to))

  return (
    <div className="flex w-full overflow-hidden bg-gray-950" style={{ height: '100dvh' }}>
      {/* Sidebar — desktop */}
      <aside className="hidden md:flex flex-col w-56 shrink-0 bg-gray-900 border-r border-gray-800">
        <div className="px-5 py-4 border-b border-gray-800 flex items-center justify-between">
          <span className="text-lg font-bold text-white tracking-tight">TheLight</span>
          <button
            onClick={handleSignOut}
            className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-100 px-2 py-1.5 rounded-lg hover:bg-gray-800 transition-colors"
          >
            <span>⎋</span>
            Sign Out
          </button>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {SIDEBAR_NAV.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-indigo-600 text-white'
                    : 'text-gray-400 hover:text-gray-100 hover:bg-gray-800'
                }`
              }
            >
              <span className="text-base">{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Mobile top bar */}
        <div
          className="md:hidden flex items-center justify-between px-4 bg-gray-900 border-b border-gray-800"
          style={{ paddingTop: 'max(env(safe-area-inset-top), 12px)', paddingBottom: '8px' }}
        >
          <span className="text-sm font-semibold text-white">TheLight</span>
          <button
            onClick={handleSignOut}
            className="text-xs text-gray-400 hover:text-white px-2 py-1 rounded"
          >
            Sign Out
          </button>
        </div>

        <main className={`flex-1 ${isFullHeight ? 'flex flex-col overflow-hidden' : 'overflow-y-auto'}`}>
          {children}
        </main>

        {/* Bottom tab bar — mobile (5 tabs + More) */}
        <nav
          className="md:hidden flex border-t border-gray-800 bg-gray-900"
          style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 16px)' }}
        >
          {MOBILE_TABS.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              end
              className={({ isActive }) =>
                `flex-1 flex flex-col items-center justify-center py-2.5 gap-0.5 text-[10px] font-medium transition-colors ${
                  isActive ? 'text-indigo-400' : 'text-gray-500'
                }`
              }
            >
              <span className="text-lg leading-none">{item.icon}</span>
              <span>{item.label}</span>
            </NavLink>
          ))}

          {/* More button */}
          <button
            onClick={() => setShowMore(true)}
            className={`flex-1 flex flex-col items-center justify-center py-2.5 gap-0.5 text-[10px] font-medium transition-colors ${
              moreIsActive ? 'text-indigo-400' : 'text-gray-500'
            }`}
          >
            <span className="text-lg leading-none">☰</span>
            <span>More</span>
          </button>
        </nav>
      </div>

      {/* "More" slide-up sheet — mobile */}
      {showMore && (
        <div className="md:hidden fixed inset-0 z-50 flex flex-col justify-end">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => setShowMore(false)}
          />
          {/* Sheet */}
          <div
            className="relative bg-gray-900 rounded-t-2xl border-t border-gray-700 px-4 pt-4"
            style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 16px)' }}
          >
            <div className="w-10 h-1 bg-gray-600 rounded-full mx-auto mb-4" />
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-semibold text-white">Menu</span>
              <button
                onClick={handleSignOut}
                className="text-xs text-gray-400 hover:text-white px-2 py-1 rounded"
              >
                Sign Out
              </button>
            </div>
            <div className="grid grid-cols-4 gap-2 pb-2">
              {MOBILE_MORE.map(item => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  onClick={() => setShowMore(false)}
                  className={({ isActive }) =>
                    `flex flex-col items-center gap-1.5 py-3 px-2 rounded-xl text-[11px] font-medium transition-colors ${
                      isActive
                        ? 'bg-indigo-600/30 text-indigo-300'
                        : 'bg-gray-800 text-gray-300'
                    }`
                  }
                >
                  <span className="text-2xl leading-none">{item.icon}</span>
                  <span className="text-center leading-tight">{item.label}</span>
                </NavLink>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
