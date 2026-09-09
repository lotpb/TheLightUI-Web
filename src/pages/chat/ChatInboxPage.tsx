import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { fetchChatUser } from '../../services/chatService'
import { Icon, ICONS } from '../../components/Icon'
import { username, relativeTime, initials, displayName, type RecentMessage, type ChatUser } from '../../models/chat'
import { useAuthStore } from '../../stores/authStore'
import { useChatStore } from '../../stores/chatStore'
import { useDebounce } from '../../hooks/useDebounce'
import { usePageTitle } from '../../hooks/usePageTitle'
import { useSearchShortcut } from '../../hooks/useSearchShortcut'
import { avatarColor, avatarOriginal } from '../../utils/avatarColor'
import { usePrefStore } from '../../stores/prefStore'

export default function ChatInboxPage() {
  const user = useAuthStore(s => s.user)
  usePageTitle('Messages')
  // Straight from the store, which Layout already keeps watching for the nav
  // badge. This page used to open a second subscription to the same collection
  // and keep its own copy of the list — double the reads, and two maps that
  // could disagree about what the inbox contained.
  const messages = useChatStore(s => s.messages)
  const loading = useChatStore(s => s.loading)
  const error = useChatStore(s => s.error)
  const isUnread = useChatStore(s => s.isUnread)
  const unreadCount = useChatStore(s => s.unreadCount)
  const [contactProfiles, setContactProfiles] = useState<Map<string, ChatUser>>(new Map())
  const [query, setQuery] = useState('')
  const debouncedQuery = useDebounce(query)
  const searchInputRef = useRef<HTMLInputElement>(null)
  useSearchShortcut(searchInputRef, () => setQuery(''))
  const fetchedIds = useRef(new Set<string>())

  // Fetch profiles only for contacts not yet loaded — merges into existing cache
  useEffect(() => {
    if (messages.length === 0 || !user) return
    const contactIds = [...new Set(messages.map(m =>
      user.uid === m.fromId ? m.toId : m.fromId
    ))]
    const newIds = contactIds.filter(id => !fetchedIds.current.has(id))
    if (newIds.length === 0) return
    newIds.forEach(id => fetchedIds.current.add(id))
    Promise.all(newIds.map(id => fetchChatUser(id))).then(profiles => {
      setContactProfiles(prev => {
        const next = new Map(prev)
        profiles.forEach((p, i) => { if (p) next.set(newIds[i], p) })
        return next
      })
    })
  }, [messages, user])

  /**
   * Matches the message text and the email as well as the display name.
   *
   * It only tested the display name, which has two problems. The placeholder
   * says "Search conversations", so searching for something you remember saying
   * found nothing. And the name is asynchronous — until fetchChatUser resolves
   * a contact it's the email's local part, so "John" matched nothing and then
   * suddenly matched, with no explanation. Including the email means results
   * don't depend on what has finished loading.
   */
  const q = debouncedQuery.trim().toLowerCase()
  const filtered = q
    ? messages.filter(msg => {
        const contactId = (user?.uid ?? '') === msg.fromId ? msg.toId : msg.fromId
        const profile = contactProfiles.get(contactId)
        const name = profile ? displayName(profile) : username(msg.email)
        return name.toLowerCase().includes(q)
          || msg.email.toLowerCase().includes(q)
          || msg.text.toLowerCase().includes(q)
      })
    : messages

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold text-white">Messages</h1>
          {/* The unread count, which is what an indigo pill beside a title
              promises. It showed messages.length — how many conversations you
              have — in the exact visual language of an unread counter. */}
          {!loading && unreadCount > 0 && (
            <span className="bg-indigo-600/30 text-indigo-300 text-xs font-semibold px-2 py-0.5 rounded-full border border-indigo-500/30">
              {unreadCount} unread
            </span>
          )}
        </div>
        <Link to="/chat/new" className="btn-primary text-sm px-3 py-1.5">
          + New
        </Link>
      </div>

      {/* Search bar */}
      {/* Shared icons rather than two hand-inlined SVGs, and gray-400 rather
          than gray-500 (3.04:1 on a card in dark mode, which is the default). */}
      <div className="relative mb-4">
        <label htmlFor="chat-search" className="sr-only">Search conversations</label>
        <Icon
          d={ICONS.search}
          className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none"
        />
        <input
          id="chat-search"
          ref={searchInputRef}
          type="search"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search names and messages…"
          className="input-field pl-9 pr-10 py-2 text-sm"
        />
        {/* p-1.5 takes the target from the bare 16px glyph to 28px, over the
            24px floor — it's the only way to dismiss a query. */}
        {query && (
          <button
            type="button"
            onClick={() => setQuery('')}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1.5 rounded text-gray-400 hover:text-gray-200 hover:bg-gray-600/50 transition-colors
                       focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            aria-label="Clear search"
          >
            <Icon d={ICONS.close} className="w-4 h-4" />
          </button>
        )}
      </div>

      {error && (
        <div className="bg-red-900/30 border border-red-700/50 rounded-xl px-4 py-3 text-red-300 text-sm mb-4">
          {error}
        </div>
      )}

      <div className="card divide-y divide-gray-700/50">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => <InboxSkeleton key={i} />)
        ) : filtered.length === 0 ? (
          <div className="px-4 py-12 text-center">
            {/* Drawn, not 💬 — emoji paint their own bitmap and ignore `color`. */}
            <Icon d={ICONS.chat} className="w-8 h-8 mx-auto mb-3 text-gray-400" />
            {q ? (
              <p className="text-gray-400">No conversations match &ldquo;{query}&rdquo;</p>
            ) : (
              <>
                <p className="text-gray-400">No messages yet</p>
                <Link to="/chat/new" className="inline-block mt-3 text-sm text-indigo-400 hover:text-indigo-300">
                  Start a conversation →
                </Link>
              </>
            )}
          </div>
        ) : (
          filtered.map(msg => {
            const contactId = (user?.uid ?? '') === msg.fromId ? msg.toId : msg.fromId
            return <InboxRow
              key={msg.id}
              message={msg}
              currentUserId={user?.uid ?? ''}
              contactProfile={contactProfiles.get(contactId)}
              unread={isUnread(msg)}
            />
          })
        )}
      </div>
    </div>
  )
}

function InboxRow({ message: m, currentUserId, contactProfile, unread }: {
  message: RecentMessage
  currentUserId: string
  contactProfile?: ChatUser
  /**
   * Genuinely unread — from them, and newer than the last time you opened this
   * conversation. The bold name and the dot keyed off `!isFromMe` before, which
   * only means "they spoke last": reading a conversation never cleared it, and
   * replying was the only thing that did.
   */
  unread: boolean
}) {
  // The contact is the other person (not us)
  const contactId = currentUserId === m.fromId ? m.toId : m.fromId
  const contactEmail = m.email
  const name = contactProfile ? displayName(contactProfile) : username(contactEmail)
  const ini = contactProfile && (contactProfile.firstName || contactProfile.lastName)
    ? `${contactProfile.firstName[0] ?? ''}${contactProfile.lastName[0] ?? ''}`.toUpperCase()
    : initials(contactEmail)
  const isFromMe = m.fromId === currentUserId
  const coloredAvatars = usePrefStore(s => s.coloredAvatars)
  const color = coloredAvatars ? avatarColor(name) : avatarOriginal()

  return (
    <Link
      to={`/chat/${contactId}`}
      state={{ contactEmail, contactProfileUrl: m.profileImageUrl }}
      className="flex items-center gap-4 px-4 py-4 hover:bg-gray-700/30 transition-colors"
    >
      <div className="relative w-12 h-12 rounded-full shrink-0 overflow-hidden flex items-center justify-center" style={{ background: color.bg }}>
        <span className="text-sm font-bold" style={{ color: color.text }}>{ini || '?'}</span>
        {m.profileImageUrl && (
          <img
            src={m.profileImageUrl}
            alt={name}
            className="absolute inset-0 w-full h-full object-cover"
            onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
          />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className={`truncate ${unread ? 'font-bold text-white' : 'font-semibold text-gray-100'}`}>{name}</span>
          <div className="flex items-center gap-1.5 shrink-0">
            {/* gray-400: gray-500 is 3.04:1 on a card in dark mode, and this is
                on every row. */}
            <span className="text-xs text-gray-400">{relativeTime(m.timestamp)}</span>
            {unread && <span className="w-2 h-2 rounded-full bg-indigo-400 shrink-0" aria-label="Unread" />}
          </div>
        </div>
        <p className={`text-sm truncate mt-0.5 ${unread ? 'text-gray-200' : 'text-gray-400'}`}>
          {isFromMe && <span className="text-gray-400">You: </span>}
          {/* A drawn icon rather than 📷, which ignores `color` and sat at a
              different weight from everything around it. */}
          {m.text === 'Photo' ? (
            <span className="inline-flex items-center gap-1 align-middle">
              <Icon d={ICONS.photo} className="w-3.5 h-3.5 shrink-0" />
              Photo
            </span>
          ) : m.text}
        </p>
      </div>
    </Link>
  )
}

function InboxSkeleton() {
  return (
    <div className="flex items-center gap-4 px-4 py-4 animate-pulse">
      <div className="w-12 h-12 rounded-full bg-gray-700 shrink-0" />
      <div className="flex-1 space-y-2">
        <div className="flex justify-between">
          <div className="h-4 bg-gray-700 rounded w-28" />
          <div className="h-3 bg-gray-700/60 rounded w-12" />
        </div>
        <div className="h-3 bg-gray-700/60 rounded w-48" />
      </div>
    </div>
  )
}
