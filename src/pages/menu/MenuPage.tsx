import { useEffect, useMemo, useState } from 'react'
import { NavLink, Link } from 'react-router-dom'
import { useAuthStore } from '../../stores/authStore'
import { usePageTitle } from '../../hooks/usePageTitle'
import { NAV_GROUPS, type NavGroup, type NavItem } from '../../config/navigation'
import { Icon, ICONS } from '../../components/Icon'

/** Most-recently-opened feature routes, newest first. */
const RECENTS_KEY = 'thelight.menu.recents'
const MAX_RECENTS = 7

function readRecents(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENTS_KEY) ?? '[]')
    return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : []
  } catch {
    return []
  }
}

/** Called when a feature is opened from the launcher. */
export function recordMenuVisit(to: string) {
  try {
    const next = [to, ...readRecents().filter(v => v !== to)].slice(0, MAX_RECENTS)
    localStorage.setItem(RECENTS_KEY, JSON.stringify(next))
  } catch { /* private mode — recents are a nicety, not a requirement */ }
}

/**
 * Greeting and date, refreshed as the clock moves.
 *
 * Both were computed once at render, so a tab opened at 4pm still said "Good
 * afternoon" at 9pm and one left overnight showed yesterday's date above
 * today's work. This is the app's landing page — `/` redirects here — so it's
 * exactly the page that stays open.
 */
function useClock(): { greeting: string; dateStr: string } {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(id)
  }, [])
  const hour = now.getHours()
  return {
    greeting: hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening',
    dateStr: now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }),
  }
}

export default function MenuPage() {
  usePageTitle('Menu')
  const user = useAuthStore(s => s.user)
  const storedFirstName = useAuthStore(s => s.firstName)
  const { greeting, dateStr } = useClock()

  const firstName = storedFirstName || user?.displayName?.split(' ')[0] || 'there'

  const [query, setQuery] = useState('')
  const [recents, setRecents] = useState<string[]>(() => readRecents())

  // Every item once, flat, for search and for resolving recent routes.
  const allItems = useMemo(
    () => NAV_GROUPS.flatMap(g => g.items.map(item => ({ item, group: g }))),
    [],
  )

  /**
   * Search across all 59 features.
   *
   * The launcher had none, so reaching a feature meant knowing which of six
   * categories someone had filed it under — and Tools alone holds 22 items.
   * Matches the label and the group name, so "vendor" finds both Vendors and
   * Vendor Scorecards, and "crm" lists the whole category.
   */
  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return null
    return allItems.filter(({ item, group }) =>
      item.label.toLowerCase().includes(q) || group.label.toLowerCase().includes(q),
    )
  }, [allItems, query])

  const recentItems = useMemo(
    () => recents
      .map(to => allItems.find(e => e.item.to === to))
      .filter((e): e is { item: NavItem; group: NavGroup } => !!e),
    [recents, allItems],
  )

  function handleOpen(to: string) {
    recordMenuVisit(to)
    setRecents(readRecents())
  }

  return (
    <div className="min-h-full bg-gray-950">

      {/* ── Page header ── */}
      <div className="relative overflow-hidden bg-gray-900 border-b border-gray-800">
        {/* Subtle radial glow */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,rgba(99,102,241,0.08),transparent_60%)] pointer-events-none" />
        <div className="relative px-4 sm:px-6 pt-4 pb-4 max-w-5xl mx-auto flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-medium text-gray-400 uppercase tracking-widest mb-1.5">{dateStr}</p>
            {/* break-words, not truncate: the logo reserves up to a third of a
                375px header, and the greeting — the one line addressed to the
                person reading it — was the thing that got clipped. */}
            <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight break-words">
              {greeting}, {firstName}
            </h1>
            {/* "6 categories · 59 features" lived here. A launcher advertising
                how many things exist tells you nothing you can act on; the
                search field and Recents below do the job it was pretending to. */}
          </div>
          {/* logo.jpg is a JPEG, so it has no alpha and renders as an opaque
              rectangle over a themed header. Sitting it on a deliberate white
              tile makes the block intentional in both themes rather than an
              artefact. A PNG or SVG with transparency is the real fix. */}
          <div className="shrink-0 bg-white rounded-lg p-1.5 mt-0.5">
            <img
              src="/logo.jpg"
              alt="The Light Software Solutions"
              className="h-8 sm:h-12 md:h-16 w-auto object-contain block"
            />
          </div>
        </div>

        {/* Search */}
        <div className="relative px-4 sm:px-6 pb-4 max-w-5xl mx-auto">
          <label htmlFor="menu-search" className="sr-only">Search features</label>
          <div className="relative">
            <input
              id="menu-search"
              type="search"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search features…"
              className="input-field w-full text-sm py-2 pl-9 pr-9"
            />
            <Icon
              d={ICONS.search}
              className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none"
            />
            {query && (
              <button
                onClick={() => setQuery('')}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded text-gray-400 hover:text-gray-200 hover:bg-gray-700/50 transition-colors
                           focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              >
                <Icon d={ICONS.close} className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Body ── */}
      <div className="px-4 sm:px-6 py-8 max-w-5xl mx-auto space-y-10">
        {results ? (
          results.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">
              Nothing matches "{query.trim()}".
            </p>
          ) : (
            <section>
              <div className="flex items-center gap-3 mb-4">
                <h2 className="text-sm font-semibold text-white leading-none">
                  {results.length} {results.length === 1 ? 'result' : 'results'}
                </h2>
                <div className="flex-1 h-px bg-gray-800/80" />
              </div>
              <FeatureGrid entries={results} onOpen={handleOpen} />
            </section>
          )
        ) : (
          <>
            {/* Recents. Nothing on the page previously distinguished the four
                features someone uses daily from the fifty-five they don't. */}
            {recentItems.length > 0 && (
              <section>
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-8 h-8 rounded-xl bg-indigo-600 flex items-center justify-center shrink-0 shadow-lg">
                    <Icon d={ICONS.clock} className="w-4 h-4 icon-on-solid" />
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-sm font-semibold text-white leading-none">Recent</h2>
                    <p className="text-xs text-gray-400 mt-0.5 truncate">Where you've been lately</p>
                  </div>
                  <div className="flex-1 h-px bg-gray-800/80" />
                </div>
                <FeatureGrid entries={recentItems} onOpen={handleOpen} />
              </section>
            )}

            {NAV_GROUPS.map(group => (
              <MenuSection key={group.id} group={group} onOpen={handleOpen} />
            ))}
          </>
        )}
      </div>

      {/* ── Footer ── */}
      <div className="px-6 pb-10 max-w-5xl mx-auto">
        <div className="border-t border-gray-800 pt-6 flex items-center justify-between">
          {/* gray-400, not gray-600 — Settings and Profile are the only route to
              those screens from the landing page and were at 2.66:1. */}
          <p className="text-xs text-gray-400">TheLight CRM</p>
          <div className="flex items-center gap-4">
            <NavLink to="/settings" className="text-xs text-gray-400 hover:text-gray-200 transition-colors">Settings</NavLink>
            <NavLink to="/profile"  className="text-xs text-gray-400 hover:text-gray-200 transition-colors">Profile</NavLink>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Section ───────────────────────────────────────────────────────────────────

function MenuSection({ group, onOpen }: { group: NavGroup; onOpen: (to: string) => void }) {
  return (
    <section>
      {/* Header. The saturated tile stays here — this is where the category's
          colour belongs, rather than repeated on all 22 of its cards. */}
      <div className="flex items-center gap-3 mb-4">
        <div className={`w-8 h-8 rounded-xl ${group.iconBg} flex items-center justify-center shrink-0 shadow-lg`}>
          {group.groupIcon('w-4 h-4 icon-on-solid')}
        </div>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-white leading-none">{group.label}</h2>
          {/* gray-400: this was gray-500, which is 4.16:1 on bg-gray-950 —
              just under the 4.5:1 floor — on the line explaining the category. */}
          <p className="text-xs text-gray-400 mt-0.5 truncate">{group.description}</p>
        </div>
        <div className="ml-2 flex items-center gap-2 shrink-0">
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full bg-gray-800 tabular-nums ${group.headerColor}`}>
            {group.items.length}
          </span>
        </div>
        <div className="flex-1 h-px bg-gray-800/80" />
      </div>

      <FeatureGrid entries={group.items.map(item => ({ item, group }))} onOpen={onOpen} />
    </section>
  )
}

function FeatureGrid({
  entries, onOpen,
}: {
  entries: { item: NavItem; group: NavGroup }[]
  onOpen: (to: string) => void
}) {
  return (
    <div className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-7 gap-2">
      {entries.map(({ item, group }) => (
        <FeatureCard key={item.to} item={item} group={group} onOpen={onOpen} />
      ))}
    </div>
  )
}

// ── Card ──────────────────────────────────────────────────────────────────────

/**
 * No isActive branch.
 *
 * FeatureCard used to style an active state twice — border/background, and icon
 * opacity plus label colour — but /menu is never itself a nav item, so you can
 * only see this page when no card's route is current. isActive was always false
 * and roughly a third of the component's styling could never render.
 *
 * The icon tile is also quiet now. Every card in a group carried the group's
 * saturated iconBg, so all 22 Tools tiles were the same slate square and the
 * colour repeated a category the section header states three lines above. The
 * hue survives as the glyph colour; shape and label do the distinguishing.
 */
function FeatureCard({
  item, group, onOpen,
}: {
  item: NavItem
  group: NavGroup
  onOpen: (to: string) => void
}) {
  return (
    <Link
      to={item.to}
      onClick={() => onOpen(item.to)}
      className="group flex flex-col items-center gap-2 pt-3.5 pb-3 px-1.5 rounded-2xl text-center select-none border
                 bg-gray-900/80 border-gray-800 transition-all duration-150
                 hover:bg-gray-800 hover:border-gray-700 active:scale-95
                 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
    >
      <div className="w-11 h-11 rounded-2xl bg-gray-800 border border-gray-700 flex items-center justify-center shrink-0
                      group-hover:border-gray-600 transition-colors duration-150">
        {item.icon(`w-6 h-6 ${group.headerColor}`)}
      </div>
      {/* No `title`: it duplicated the label printed directly beneath the icon
          on all 59 cards, so hovering produced a delayed grey box repeating
          what you could already read. */}
      <span className="text-xs font-medium leading-tight line-clamp-2 w-full text-gray-300 group-hover:text-white transition-colors duration-150">
        {item.label}
      </span>
    </Link>
  )
}
