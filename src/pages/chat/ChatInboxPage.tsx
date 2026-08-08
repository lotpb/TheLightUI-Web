import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { subscribeToInbox, fetchChatUser } from '../../services/chatService'
import { username, relativeTime, initials, displayName, type RecentMessage, type ChatUser } from '../../models/chat'
import { useAuthStore } from '../../stores/authStore'

export default function ChatInboxPage() {
  const user = useAuthStore(s => s.user)
  const [messages, setMessages] = useState<RecentMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [contactProfiles, setContactProfiles] = useState<Map<string, ChatUser>>(new Map())
  // track seen ids to upsert like iOS does
  const mapRef = useRef(new Map<string, RecentMessage>())
  const fetchedIds = useRef(new Set<string>())

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

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-white">Messages</h1>
        <Link to="/chat/new" className="btn-primary text-sm px-3 py-1.5">
          + New
        </Link>
      </div>

      {error && (
        <div className="bg-red-900/30 border border-red-700/50 rounded-xl px-4 py-3 text-red-300 text-sm mb-4">
          {error}
        </div>
      )}

      <div className="card divide-y divide-gray-700/50">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => <InboxSkeleton key={i} />)
        ) : messages.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <p className="text-3xl mb-3">💬</p>
            <p className="text-gray-400">No messages yet</p>
            <Link to="/chat/new" className="inline-block mt-3 text-sm text-indigo-400 hover:text-indigo-300">
              Start a conversation →
            </Link>
          </div>
        ) : (
          messages.map(msg => {
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

  return (
    <Link
      to={`/chat/${contactId}`}
      state={{ contactEmail, contactProfileUrl: m.profileImageUrl }}
      className="flex items-center gap-4 px-4 py-4 hover:bg-gray-700/30 transition-colors"
    >
      <div className="w-12 h-12 rounded-full shrink-0 overflow-hidden bg-indigo-700/30 flex items-center justify-center">
        {m.profileImageUrl ? (
          <img src={m.profileImageUrl} alt={name} className="w-full h-full object-cover" />
        ) : (
          <span className="text-sm font-bold text-indigo-300">{ini || '?'}</span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-semibold text-gray-100 truncate">{name}</span>
          <span className="text-xs text-gray-500 shrink-0">{relativeTime(m.timestamp)}</span>
        </div>
        <p className="text-sm text-gray-400 truncate mt-0.5">
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
