import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { NavLink, useNavigate, useLocation } from 'react-router-dom'
import { useAuthStore } from '../stores/authStore'
import { usePermissions } from '../hooks/usePermissions'
import { useChatStore } from '../stores/chatStore'
import { useReminders } from '../hooks/useReminders'
import { useInstallPrompt } from '../hooks/useInstallPrompt'
import { useIdleTimeout, IDLE_SIGNOUT_KEY } from '../hooks/useIdleTimeout'
import { subscribeToNotifications, markNotificationRead, markAllNotificationsRead } from '../services/notificationService'
import type { AppNotification } from '../models/notification'
import GlobalSearch from './GlobalSearch'
import IdleWarningModal from './IdleWarningModal'
import RemindersPanel from './RemindersPanel'

// ─── Nav data ─────────────────────────────────────────────────────────────────

import { type NavItem, NAV_GROUPS, ALL_ITEMS } from '../config/navigation'

// ─── Main layout ──────────────────────────────────────────────────────────────

const ROLE_BADGE: Record<string, { label: string; classes: string }> = {
  owner:    { label: 'Owner',    classes: 'bg-yellow-500/20 text-yellow-300' },
  admin:    { label: 'Admin',    classes: 'bg-indigo-500/20 text-indigo-300' },
  salesman: { label: 'Salesman', classes: 'bg-teal-500/20 text-teal-300' },
  viewer:   { label: 'Viewer · Read Only', classes: 'bg-gray-500/20 text-gray-400' },
}

export default function Layout({ children }: { children: React.ReactNode }) {
  const signOut = useAuthStore(s => s.signOut)
  const user    = useAuthStore(s => s.user)
  const role    = useAuthStore(s => s.role)
  usePermissions() // ensure hook is called for any future gating
  const navigate = useNavigate()
  const { pathname } = useLocation()

  const [showSearch,    setShowSearch]    = useState(false)
  const [showReminders, setShowReminders] = useState(false)
  const closeSearch = useCallback(() => setShowSearch(false), [])

  const { notifications: reminderItems, urgentCount, recentActivity, permission, notificationSupport, requestPermission } = useReminders()
  const { unreadCount, startWatch, stopWatch } = useChatStore()

  const [appNotifications, setAppNotifications] = useState<AppNotification[]>([])
  useEffect(() => subscribeToNotifications(setAppNotifications, () => {}), [])
  const unreadNotifCount = useMemo(() => appNotifications.filter(n => !n.read).length, [appNotifications])
  const bellBadgeCount = urgentCount + unreadNotifCount

  // Sidebar collapsed (icon-only) state
  const [collapsed, setCollapsed] = useState(() =>
    localStorage.getItem('thelight.nav.collapsed') === '1'
  )

  // Favorites
  const [favorites, setFavorites] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem('thelight.nav.favorites')
      if (raw) return JSON.parse(raw)
    } catch { /* ignore */ }
    return []
  })

  useEffect(() => {
    // Safari (Private Browsing, or storage evicted by ITP) throws on
    // setItem instead of just failing quietly — guard it like the read above
    // so a save failure doesn't propagate as an uncaught error.
    try {
      localStorage.setItem('thelight.nav.favorites', JSON.stringify(favorites))
    } catch { /* ignore */ }
  }, [favorites])

  function toggleFavorite(to: string) {
    setFavorites(prev => prev.includes(to) ? prev.filter(t => t !== to) : [...prev, to])
  }

  // Favorites drag-to-reorder
  const favDragIndex = useRef<number | null>(null)
  const [favDragOver, setFavDragOver] = useState<number | null>(null)

  function onFavDragStart(e: React.DragEvent, index: number) {
    favDragIndex.current = index
    e.dataTransfer.effectAllowed = 'move'
  }
  function onFavDragOver(e: React.DragEvent, index: number) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (favDragOver !== index) setFavDragOver(index)
  }
  function onFavDragEnd() {
    favDragIndex.current = null
    setFavDragOver(null)
  }
  function onFavDrop(e: React.DragEvent, dropIndex: number) {
    e.preventDefault()
    const from = favDragIndex.current
    if (from === null || from === dropIndex) { onFavDragEnd(); return }
    setFavorites(prev => {
      const next = [...prev]
      const [moved] = next.splice(from, 1)
      next.splice(dropIndex, 0, moved)
      return next
    })
    favDragIndex.current = null
    setFavDragOver(null)
  }

  const allItemsMap = useMemo(
    () => Object.fromEntries(ALL_ITEMS.map(item => [item.to, item])),
    []
  )

  // Mobile tab bar: first 4 favorites, padded with non-favorite items if needed
  const mobileTabs = useMemo(() => {
    if (favorites.length === 0) return ALL_ITEMS.slice(0, 4)
    const favItems = favorites
      .map(to => allItemsMap[to])
      .filter((item): item is NavItem => Boolean(item))
      .slice(0, 4)
    if (favItems.length >= 4) return favItems
    const favSet = new Set(favorites)
    const rest = ALL_ITEMS.filter(item => !favSet.has(item.to))
    return [...favItems, ...rest].slice(0, 4)
  }, [favorites, allItemsMap])

  // Which groups are open (expanded)
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem('thelight.nav.groups')
      if (raw) return new Set<string>(JSON.parse(raw))
    } catch { /* ignore */ }
    return new Set(NAV_GROUPS.map(g => g.id))
  })

  useEffect(() => {
    try {
      localStorage.setItem('thelight.nav.collapsed', collapsed ? '1' : '0')
    } catch { /* ignore */ }
  }, [collapsed])

  useEffect(() => {
    try {
      localStorage.setItem('thelight.nav.groups', JSON.stringify([...openGroups]))
    } catch { /* ignore */ }
  }, [openGroups])

  function toggleGroup(id: string) {
    setOpenGroups(prev => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id); else n.add(id)
      return n
    })
  }

  // Cmd+K global search
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setShowSearch(v => !v)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (user?.uid) startWatch(user.uid); else stopWatch()
    return () => stopWatch()
  }, [user?.uid])

  function navIcon(item: NavItem, cls: string) {
    if (item.to !== '/chat' || unreadCount === 0) return item.icon(cls)
    return (
      <div className="relative shrink-0">
        {item.icon(cls)}
        <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 px-1 bg-red-500 rounded-full border border-gray-900 flex items-center justify-center text-xs font-bold text-white leading-none">
          {unreadCount > 9 ? '9+' : unreadCount}
        </span>
      </div>
    )
  }

  const { canInstall, install, dismiss: dismissInstall } = useInstallPrompt()

  const isChatLog    = /^\/chat\/.+/.test(pathname)
  // /pipeline is a board: its columns scroll internally and the page itself
  // must not. It was already written as a full-height flex layout (h-full,
  // shrink-0 headers, flex-1 min-h-0 board) but wasn't registered here, so it
  // compensated with a hard-coded calc(100vh - 230px) on every column.
  const isFullHeight = isChatLog || pathname === '/maps' || pathname === '/pipeline'

  async function handleSignOut() {
    await signOut()
    navigate('/login', { replace: true })
  }

  // Idle session timeout — flag the reason first so the login screen can
  // explain itself rather than looking like a random sign-out.
  const handleIdleExpire = useCallback(async () => {
    try { sessionStorage.setItem(IDLE_SIGNOUT_KEY, '1') } catch { /* ignore */ }
    await signOut()
    navigate('/login', { replace: true })
  }, [signOut, navigate])

  const { msRemaining, stayActive } = useIdleTimeout(Boolean(user), handleIdleExpire)

  const moreIsActive = pathname === '/menu' || !mobileTabs.some(item => pathname.startsWith(item.to))

  return (
    <div className="flex w-full overflow-hidden bg-gray-950" style={{ height: '100dvh' }}>

      {/* Skip to main content — visible only on keyboard focus */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-[100] focus:bg-indigo-600 focus:text-white focus:px-3 focus:py-1.5 focus:rounded-lg focus:text-sm focus:font-medium"
      >
        Skip to main content
      </a>

      {/* ── Sidebar — desktop ── */}
      <aside
        className={`hidden md:flex flex-col shrink-0 bg-gray-900 border-r border-gray-800 transition-all duration-200 ${
          collapsed ? 'w-14' : 'w-56'
        }`}
      >
        {/* Header */}
        <div className={`border-b border-gray-800 ${collapsed ? 'flex flex-col items-center justify-center px-0 py-3 gap-2' : 'px-4 pt-3 pb-2'}`}>
          {/* Top row: title + icon buttons */}
          <div className={`flex items-center ${collapsed ? 'flex-col gap-2' : 'justify-between'}`}>
            {!collapsed && (
              <NavLink to="/menu" className="shrink-0">
                <img
                  src="/logo.jpg"
                  alt="The Light Software Solutions"
                  className="h-8 w-auto object-contain rounded"
                />
              </NavLink>
            )}
            <div className={`flex items-center ${collapsed ? 'flex-col gap-2' : 'gap-0.5'}`}>
              {/* Collapse toggle */}
              <button
                onClick={() => setCollapsed(v => !v)}
                title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                className="text-gray-500 hover:text-gray-200 p-1.5 rounded-lg hover:bg-gray-800 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  {collapsed
                    ? <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 4.5l7.5 7.5-7.5 7.5m-6-15l7.5 7.5-7.5 7.5" />
                    : <path strokeLinecap="round" strokeLinejoin="round" d="M18.75 19.5l-7.5-7.5 7.5-7.5m-6 15L5.25 12l7.5-7.5" />
                  }
                </svg>
              </button>
              {/* Search */}
              <button
                onClick={() => setShowSearch(true)}
                title="Search (⌘K)"
                className="text-gray-500 hover:text-gray-200 p-1.5 rounded-lg hover:bg-gray-800 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
                </svg>
              </button>
              {/* Reminders + Notifications */}
              <button
                onClick={() => setShowReminders(v => !v)}
                title="Reminders & Notifications"
                className="relative text-gray-500 hover:text-gray-200 p-1.5 rounded-lg hover:bg-gray-800 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0" />
                </svg>
                {bellBadgeCount > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 bg-red-500 rounded-full border border-gray-900 flex items-center justify-center text-xs font-bold text-white leading-none">
                    {bellBadgeCount > 9 ? '9+' : bellBadgeCount}
                  </span>
                )}
              </button>
              {/* Sign out — collapsed icon */}
              {collapsed && (
                <button
                  onClick={handleSignOut}
                  title="Sign Out"
                  className="text-gray-500 hover:text-gray-200 p-1.5 rounded-lg hover:bg-gray-800 transition-colors"
                >
                  <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 9V5.25A2.25 2.25 0 0 1 10.5 3h6a2.25 2.25 0 0 1 2.25 2.25v13.5A2.25 2.25 0 0 1 16.5 21h-6a2.25 2.25 0 0 1-2.25-2.25V15m-3 0-3-3m0 0 3-3m-3 3H15" />
                  </svg>
                </button>
              )}
            </div>
          </div>
          {/* Sign out + collapse-all — expanded, below title */}
          {!collapsed && (
            <div className="mt-1 flex items-center gap-2 flex-wrap">
              <button
                onClick={handleSignOut}
                className="flex items-center gap-1.5 text-xs text-white hover:text-gray-300 px-0.5 py-1 rounded transition-colors"
              >
                <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 9V5.25A2.25 2.25 0 0 1 10.5 3h6a2.25 2.25 0 0 1 2.25 2.25v13.5A2.25 2.25 0 0 1 16.5 21h-6a2.25 2.25 0 0 1-2.25-2.25V15m-3 0-3-3m0 0 3-3m-3 3H15" />
                </svg>
                Sign Out
              </button>
              <button
                onClick={() => setOpenGroups(new Set())}
                title="Collapse all sections"
                className="flex items-center px-0.5 py-1 rounded transition-colors"
              >
                <svg className="w-3.5 h-3.5 shrink-0 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 9V4.5M9 9H4.5M9 9 3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5 5.25 5.25" />
                </svg>
              </button>
              {/* Role badge — visible when expanded */}
              {role && ROLE_BADGE[role] && (
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${ROLE_BADGE[role].classes}`}>
                  {ROLE_BADGE[role].label}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 py-3 overflow-y-auto overflow-x-hidden">

          {/* ── Menu link ── */}
          <div className={`px-2 mb-2 ${collapsed ? 'flex justify-center' : ''}`}>
            <NavLink
              to="/menu"
              title="Menu"
              className={({ isActive }) =>
                `flex items-center gap-2.5 rounded-lg transition-colors ${
                  collapsed ? 'w-9 h-9 justify-center' : 'px-3 py-2'
                } ${isActive ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-gray-100 hover:bg-gray-800'}`
              }
            >
              <svg className={collapsed ? 'w-5 h-5' : 'w-4 h-4 shrink-0'} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
              </svg>
              {!collapsed && <span className="text-sm font-medium">Menu</span>}
            </NavLink>
          </div>

          {/* ── Favorites group ── */}
          {!collapsed && (
            <div className="mb-1">
              <div className="w-full flex items-center gap-2.5 px-3 py-1.5 rounded-lg mx-1 text-yellow-400">
                <svg className="w-4 h-4 shrink-0" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M11.48 3.499a.562.562 0 0 1 1.04 0l2.125 5.111a.563.563 0 0 0 .475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 0 0-.182.557l1.285 5.385a.562.562 0 0 1-.84.61l-4.725-2.885a.562.562 0 0 0-.586 0L6.982 20.54a.562.562 0 0 1-.84-.61l1.285-5.386a.562.562 0 0 0-.182-.557l-4.204-3.602a.562.562 0 0 1 .321-.988l5.518-.442a.563.563 0 0 0 .475-.345L11.48 3.5Z" />
                </svg>
                <span className="text-xs font-semibold uppercase tracking-wider flex-1">Favorites</span>
              </div>

              <div className="mt-0.5 space-y-0.5 px-2">
                {favorites.length === 0 && (
                  <p className="px-3 py-1.5 text-xs text-gray-600 italic">
                    Hover any menu item and click ★ to pin it here
                  </p>
                )}
                {favorites.map((to, index) => {
                  const item = allItemsMap[to]
                  if (!item) return null
                  const isDropTarget = favDragOver === index
                  return (
                    <div
                      key={to}
                      className={`relative group/fav rounded-lg transition-colors ${isDropTarget ? 'ring-1 ring-indigo-400 bg-indigo-950/40' : ''}`}
                      draggable
                      onDragStart={e => onFavDragStart(e, index)}
                      onDragOver={e => onFavDragOver(e, index)}
                      onDragEnd={onFavDragEnd}
                      onDrop={e => onFavDrop(e, index)}
                    >
                      {/* Drag handle */}
                      <span
                        className="absolute left-1 top-1/2 -translate-y-1/2 cursor-grab text-gray-700 opacity-0 group-hover/fav:opacity-100 transition-opacity select-none"
                        title="Drag to reorder"
                      >
                        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M8.5 6a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0ZM8.5 12a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0ZM8.5 18a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0ZM18.5 6a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0ZM18.5 12a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0ZM18.5 18a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Z" />
                        </svg>
                      </span>
                      <NavLink
                        to={item.to}
                        className={({ isActive }) =>
                          `flex items-center gap-2.5 pl-5 pr-8 py-2 rounded-lg text-sm font-medium transition-colors ${
                            isActive ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-gray-100 hover:bg-gray-800'
                          }`
                        }
                      >
                        {navIcon(item, 'w-4 h-4 shrink-0')}
                        <span className="truncate">{item.label}</span>
                      </NavLink>
                      <button
                        onClick={() => toggleFavorite(to)}
                        title="Remove from favorites"
                        className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 rounded text-yellow-400 opacity-0 group-hover/fav:opacity-100 hover:text-yellow-300 transition-opacity"
                      >
                        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M11.48 3.499a.562.562 0 0 1 1.04 0l2.125 5.111a.563.563 0 0 0 .475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 0 0-.182.557l1.285 5.385a.562.562 0 0 1-.84.61l-4.725-2.885a.562.562 0 0 0-.586 0L6.982 20.54a.562.562 0 0 1-.84-.61l1.285-5.386a.562.562 0 0 0-.182-.557l-4.204-3.602a.562.562 0 0 1 .321-.988l5.518-.442a.563.563 0 0 0 .475-.345L11.48 3.5Z" />
                        </svg>
                      </button>
                    </div>
                  )
                })}
              </div>

              <div className="mx-3 my-1 border-t border-yellow-900/40" />
            </div>
          )}

          {NAV_GROUPS.map(group => {
            const isOpen = openGroups.has(group.id)

            return (
              <div key={group.id} className="mb-1">
                {/* Group header */}
                <button
                  onClick={() => collapsed ? setCollapsed(false) : toggleGroup(group.id)}
                  title={collapsed ? group.label : undefined}
                  className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-left transition-colors rounded-lg mx-1 ${
                    isOpen ? 'text-indigo-400' : 'text-white hover:text-gray-200'
                  } ${collapsed ? 'justify-center' : ''}`}
                >
                  {group.groupIcon(collapsed ? 'w-5 h-5 shrink-0' : 'w-4 h-4 shrink-0')}
                  {!collapsed && (
                    <>
                      <span className="text-xs font-semibold uppercase tracking-wider flex-1">
                        {group.label}
                      </span>
                      <svg
                        className={`w-3 h-3 transition-transform shrink-0 ${isOpen ? '' : '-rotate-90'}`}
                        fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="m19 9-7 7-7-7" />
                      </svg>
                    </>
                  )}
                </button>

                {/* Group items */}
                {!collapsed && isOpen && (
                  <div className="mt-0.5 space-y-0.5 px-2">
                    {group.items.map(item => {
                      const isFav = favorites.includes(item.to)
                      return (
                        <div key={item.to} className="relative group/nav">
                          <NavLink
                            to={item.to}
                            className={({ isActive }) =>
                              `flex items-center gap-2.5 px-3 py-2 pr-8 rounded-lg text-sm font-medium transition-colors ${
                                isActive
                                  ? 'bg-indigo-600 text-white'
                                  : 'text-gray-400 hover:text-gray-100 hover:bg-gray-800'
                              }`
                            }
                          >
                            {navIcon(item, 'w-4 h-4 shrink-0')}
                            <span className="truncate">{item.label}</span>
                          </NavLink>
                          <button
                            onClick={() => toggleFavorite(item.to)}
                            title={isFav ? 'Remove from favorites' : 'Add to favorites'}
                            className={`absolute right-1.5 top-1/2 -translate-y-1/2 p-1 rounded transition-all hover:text-yellow-300 ${
                              isFav
                                ? 'text-yellow-400 opacity-100'
                                : 'text-gray-600 opacity-0 group-hover/nav:opacity-100 group-hover/nav:text-gray-400'
                            }`}
                          >
                            <svg className="w-3 h-3" fill={isFav ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.562.562 0 0 1 1.04 0l2.125 5.111a.563.563 0 0 0 .475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 0 0-.182.557l1.285 5.385a.562.562 0 0 1-.84.61l-4.725-2.885a.562.562 0 0 0-.586 0L6.982 20.54a.562.562 0 0 1-.84-.61l1.285-5.386a.562.562 0 0 0-.182-.557l-4.204-3.602a.562.562 0 0 1 .321-.988l5.518-.442a.563.563 0 0 0 .475-.345L11.48 3.5Z" />
                            </svg>
                          </button>
                        </div>
                      )
                    })}
                  </div>
                )}

                {/* Icon-only: show items as icon row */}
                {collapsed && (
                  <div className="flex flex-col items-center gap-0.5 mt-0.5 px-1 pb-1">
                    {group.items.map(item => (
                      <NavLink
                        key={item.to}
                        to={item.to}
                        title={item.label}
                        className={({ isActive }) =>
                          `flex items-center justify-center w-9 h-9 rounded-lg transition-colors ${
                            isActive
                              ? 'bg-indigo-600 text-white'
                              : 'text-gray-500 hover:text-gray-100 hover:bg-gray-800'
                          }`
                        }
                      >
                        {navIcon(item, 'w-4 h-4')}
                      </NavLink>
                    ))}
                  </div>
                )}

                {/* Divider between groups (collapsed mode: subtle line) */}
                {collapsed && (
                  <div className="mx-3 my-1 border-t border-gray-800" />
                )}
              </div>
            )
          })}

        </nav>
      </aside>

      {/* ── Main content ── */}
      <div className="flex-1 flex flex-col overflow-hidden">

        {/* Mobile top bar */}
        <div
          className="md:hidden flex items-center justify-between px-4 bg-gray-900 border-b border-gray-800"
          style={{ paddingTop: 'max(env(safe-area-inset-top), 12px)', paddingBottom: '8px' }}
        >
          <img src="/logo.jpg" alt="The Light Software Solutions" className="h-7 w-auto object-contain rounded" />
          <div className="flex items-center gap-1">
            <button onClick={() => setShowSearch(true)} className="text-gray-400 hover:text-white p-1.5 rounded transition-colors" aria-label="Search">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
              </svg>
            </button>
            <button onClick={() => setShowReminders(v => !v)} aria-label="Reminders & Notifications" className="relative text-gray-400 hover:text-white p-1.5 rounded transition-colors">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0" />
              </svg>
              {bellBadgeCount > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 bg-red-500 rounded-full border border-gray-900 flex items-center justify-center text-xs font-bold text-white leading-none">
                  {bellBadgeCount > 9 ? '9+' : bellBadgeCount}
                </span>
              )}
            </button>
            <button onClick={handleSignOut} className="text-xs text-gray-400 hover:text-white px-2 py-1 rounded">Sign Out</button>
          </div>
        </div>

        <main id="main-content" className={`flex-1 ${isFullHeight ? 'flex flex-col overflow-hidden' : 'overflow-y-auto'}`}>
          {children}
        </main>

        {/* PWA install banner — Android Chrome only, dismissed via localStorage */}
        {canInstall && (
          <div className="md:hidden flex items-center gap-3 px-4 py-2.5 bg-indigo-950 border-t border-indigo-800/60">
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-indigo-100 truncate">Add TheLight to your home screen</p>
            </div>
            <button
              onClick={install}
              className="shrink-0 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 px-3 py-1.5 rounded-lg transition-colors"
            >
              Install
            </button>
            <button
              onClick={dismissInstall}
              aria-label="Dismiss install banner"
              className="shrink-0 text-indigo-400 hover:text-indigo-200 p-1 -mr-1 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}

        {/* Mobile bottom tab bar */}
        <nav className="md:hidden flex border-t border-gray-800 bg-gray-900" style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 16px)' }}>
          {mobileTabs.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              end
              className={({ isActive }) =>
                `flex-1 flex flex-col items-center justify-center py-2.5 gap-0.5 text-xs font-medium transition-colors ${
                  isActive ? 'text-indigo-400' : 'text-gray-500'
                }`
              }
            >
              {navIcon(item, 'w-5 h-5')}
              <span>{item.label}</span>
            </NavLink>
          ))}
          <NavLink
            to="/menu"
            className={`flex-1 flex flex-col items-center justify-center py-2.5 gap-0.5 text-xs font-medium transition-colors ${
              moreIsActive ? 'text-indigo-400' : 'text-gray-500'
            }`}
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
            </svg>
            <span>Menu</span>
          </NavLink>
        </nav>
      </div>

      {/* Idle timeout warning */}
      {msRemaining !== null && (
        <IdleWarningModal
          secondsLeft={Math.ceil(msRemaining / 1000)}
          onStay={stayActive}
          onSignOut={handleSignOut}
        />
      )}

      {/* Global search modal */}
      {showSearch && <GlobalSearch onClose={closeSearch} />}

      {/* Reminders & Notifications panel */}
      {showReminders && (
        <RemindersPanel
          notifications={reminderItems}
          recentActivity={recentActivity}
          permission={permission}
          notificationSupport={notificationSupport}
          onRequestPermission={requestPermission}
          onClose={() => setShowReminders(false)}
          appNotifications={appNotifications}
          onMarkNotificationRead={markNotificationRead}
          onMarkAllNotificationsRead={() => markAllNotificationsRead(appNotifications.filter(n => !n.read).map(n => n.id))}
        />
      )}

    </div>
  )
}
