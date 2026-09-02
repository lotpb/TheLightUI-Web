import { NavLink } from 'react-router-dom'
import { useAuthStore } from '../../stores/authStore'
import { usePageTitle } from '../../hooks/usePageTitle'
import { NAV_GROUPS, type NavGroup, type NavItem } from '../../config/navigation'

export default function MenuPage() {
  usePageTitle('Menu')
  const user = useAuthStore(s => s.user)
  const storedFirstName = useAuthStore(s => s.firstName)

  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  const firstName = storedFirstName || user?.displayName?.split(' ')[0] || 'there'
  const dateStr = new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  })

  const totalFeatures = NAV_GROUPS.reduce((sum, g) => sum + g.items.length, 0)

  return (
    <div className="min-h-full bg-gray-950">

      {/* ── Page header ── */}
      <div className="relative overflow-hidden bg-gray-900 border-b border-gray-800">
        {/* Subtle radial glow */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,rgba(99,102,241,0.08),transparent_60%)] pointer-events-none" />
        <div className="relative px-4 sm:px-6 pt-4 pb-4 max-w-5xl mx-auto flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-medium text-gray-400 uppercase tracking-widest mb-1.5">{dateStr}</p>
            <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight truncate">
              {greeting}, {firstName}
            </h1>
            <p className="text-sm text-gray-400 mt-1.5">
              {NAV_GROUPS.length} categories &middot; {totalFeatures} features
            </p>
          </div>
          <img
            src="/logo.jpg"
            alt="The Light Software Solutions"
            className="h-10 sm:h-14 md:h-20 w-auto max-w-[40%] sm:max-w-none object-contain rounded shrink-0 mt-1"
          />
        </div>
      </div>

      {/* ── Category sections ── */}
      <div className="px-4 sm:px-6 py-8 max-w-5xl mx-auto space-y-10">
        {NAV_GROUPS.map(group => (
          <MenuSection key={group.id} group={group} />
        ))}
      </div>

      {/* ── Footer ── */}
      <div className="px-6 pb-10 max-w-5xl mx-auto">
        <div className="border-t border-gray-800 pt-6 flex items-center justify-between">
          <p className="text-xs text-gray-600">TheLight CRM</p>
          <div className="flex items-center gap-4">
            <NavLink to="/settings" className="text-xs text-gray-600 hover:text-gray-400 transition-colors">Settings</NavLink>
            <NavLink to="/profile"  className="text-xs text-gray-600 hover:text-gray-400 transition-colors">Profile</NavLink>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Section ───────────────────────────────────────────────────────────────────

function MenuSection({ group }: { group: NavGroup }) {
  return (
    <section>
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <div className={`w-8 h-8 rounded-xl ${group.iconBg} flex items-center justify-center shrink-0 shadow-lg`}>
          {group.groupIcon('w-4 h-4 text-white')}
        </div>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-white leading-none">{group.label}</h2>
          <p className="text-xs text-gray-500 mt-0.5 truncate">{group.description}</p>
        </div>
        <div className="ml-2 flex items-center gap-2 shrink-0">
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full bg-gray-800 ${group.headerColor}`}>
            {group.items.length}
          </span>
        </div>
        <div className="flex-1 h-px bg-gray-800/80" />
      </div>

      {/* Feature grid */}
      <div className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-7 gap-2">
        {group.items.map(item => (
          <FeatureCard key={item.to} item={item} group={group} />
        ))}
      </div>
    </section>
  )
}

// ── Card ──────────────────────────────────────────────────────────────────────

function FeatureCard({ item, group }: { item: NavItem; group: NavGroup }) {
  return (
    <NavLink
      to={item.to}
      title={item.label}
      className={({ isActive }) =>
        `group flex flex-col items-center gap-2 pt-3.5 pb-3 px-1.5 rounded-2xl text-center transition-all duration-150 border select-none ${
          isActive
            ? `bg-gray-800 border-gray-600`
            : 'bg-gray-900/80 border-gray-800 hover:bg-gray-800 hover:border-gray-700 active:scale-95'
        }`
      }
    >
      {({ isActive }) => (
        <>
          <div
            className={`w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 transition-all duration-150 ${
              isActive
                ? group.iconBg
                : `${group.iconBg} opacity-80 group-hover:opacity-100`
            }`}
          >
            {item.icon('w-5 h-5 text-white')}
          </div>
          <span
            className={`text-xs font-medium leading-tight line-clamp-2 w-full transition-colors duration-150 ${
              isActive ? 'text-white' : 'text-gray-400 group-hover:text-gray-200'
            }`}
          >
            {item.label}
          </span>
        </>
      )}
    </NavLink>
  )
}
