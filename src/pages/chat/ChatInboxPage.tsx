import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { subscribeToInbox, fetchChatUser } from '../../services/chatService'
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
  const markRead = useChatStore(s => s.markRead)
  usePageTitle('Messages')
  const [messages, setMessages] = useState<RecentMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [contactProfiles, setContactProfiles] = useState<Map<string, ChatUser>>(new Map())
  const [query, setQuery] = useState('')
  const debouncedQuery = useDebounce(query)
  const searchInputRef = useRef<HTMLInputElement>(null)
  useSearchShortcut(searchInputRef, () => setQuery(''))
  // track seen ids to upsert like iOS does
  const mapRef = useRef(new Map<string, RecentMessage>())
  const fetchedIds = useRef(new Set<string>())

  // Clear the unread badge whenever the inbox is open
  useEffect(() => { markRead() }, [])

  useEffect(() => {
    if (!user) return
    setLoading(true)

    const unsub = subscribeToInbox(
      user.uid,
      changed => {
        for (const msg of changed) {
          mapRef.current.set(msg.id, msg)
        }
        // Sort newest first
        const sorted = Array.from(mapRef.current.values())
          .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
        setMessages(sorted)
        setLoading(false)
      },
      err => { setError(err.message); setLoading(false) },
    )

    return () => {
      unsub()
      mapRef.current.clear()
      fetchedIds.current.clear()
      setMessages([])
      setContactProfiles(new Map())
    }
  }, [user])

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

  const q = debouncedQuery.trim().toLowerCase()
  const filtered = q
    ? messages.filter(msg => {
        const contactId = (user?.uid ?? '') === msg.fromId ? msg.toId : msg.fromId
        const profile = contactProfiles.get(contactId)
        const name = profile ? displayName(profile) : username(msg.email)
        return name.toLowerCase().includes(q)
      })
    : messages

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold text-white">Messages</h1>
          {!loading && messages.length > 0 && (
            <span className="bg-indigo-600/30 text-indigo-300 text-xs font-semibold px-2 py-0.5 rounded-full border border-indigo-500/30">
              {messages.length}
            </span>
          )}
        </div>
        <Link to="/chat/new" className="btn-primary text-sm px-3 py-1.5">
          + New
        </Link>
      </div>

      {/* Search bar */}
      <div className="relative mb-4">
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
        </svg>
        <input
          ref={searchInputRef}
          type="search"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search conversations…"
          className="input-field pl-9 py-2 text-sm"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
            aria-label="Clear search"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
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
            <p className="text-3xl mb-3">💬</p>
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
            />
          })
        )}
      </div>
    </div>
  )
}

function InboxRow({ message: m, currentUserId, contactProfile }: { message: RecentMessage; currentUserId: string; contactProfile?: ChatUser }) {
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
          <span className={`truncate ${!isFromMe ? 'font-bold text-white' : 'font-semibold text-gray-100'}`}>{name}</span>
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="text-xs text-gray-500">{relativeTime(m.timestamp)}</span>
            {!isFromMe && <span className="w-2 h-2 rounded-full bg-indigo-400 shrink-0" />}
          </div>
        </div>
        <p className={`text-sm truncate mt-0.5 ${!isFromMe ? 'text-gray-200' : 'text-gray-400'}`}>
          {isFromMe && <span className="text-gray-500">You: </span>}
          {m.text === 'Photo' ? '📷 Photo' : m.text}
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
