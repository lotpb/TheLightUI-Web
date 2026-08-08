import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchAllUsers } from '../../services/chatService'
import { initials, displayName, type ChatUser } from '../../models/chat'
import { useAuthStore } from '../../stores/authStore'

export default function NewChatPage() {
  const navigate = useNavigate()
  const authUser = useAuthStore(s => s.user)
  const [users, setUsers] = useState<ChatUser[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchAllUsers(authUser?.uid)
      .then(all => { setUsers(all); setLoading(false) })
      .catch(e => { setError(e.message); setLoading(false) })
  }, [authUser?.uid])

  const filtered = search.trim()
    ? users.filter(u => {
        const q = search.toLowerCase()
        return (
          u.email.toLowerCase().includes(q) ||
          displayName(u).toLowerCase().includes(q) ||
          u.firstName.toLowerCase().includes(q) ||
          u.lastName.toLowerCase().includes(q)
        )
      })
    : users

  function openChat(u: ChatUser) {
    navigate(`/chat/${u.uid}`, {
      state: { contactEmail: u.email, contactProfileUrl: u.profileImageUrl },
    })
  }

  return (
    <div className="w-full px-8 py-6">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate(-1)} className="text-indigo-400 hover:text-indigo-300">←</button>
        <h1 className="text-2xl font-bold text-white">New Message</h1>
      </div>

      <input
        type="search"
        className="input-field mb-4"
        placeholder="Search users…"
        value={search}
        onChange={e => setSearch(e.target.value)}
        autoFocus
      />

      {error && (
        <div className="bg-red-900/30 border border-red-700/50 rounded-xl px-4 py-3 text-red-300 text-sm mb-4">
          {error}
        </div>
      )}

      <div className="card divide-y divide-gray-700/50">
        {loading ? (
          Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 px-4 py-3.5 animate-pulse">
              <div className="w-10 h-10 rounded-full bg-gray-700 shrink-0" />
              <div className="flex-1 space-y-2">
                <div className="h-4 bg-gray-700 rounded w-32" />
                <div className="h-3 bg-gray-700/60 rounded w-44" />
              </div>
            </div>
          ))
        ) : filtered.length === 0 ? (
          <p className="px-4 py-8 text-center text-gray-400">
            {search ? 'No users match that search' : 'No other users found'}
          </p>
        ) : (
          filtered.map(u => (
            <button
              key={u.uid}
              onClick={() => openChat(u)}
              className="w-full flex items-center gap-4 px-4 py-3.5 hover:bg-gray-700/30 transition-colors text-left"
            >
              <div className="w-10 h-10 rounded-full bg-indigo-700/30 flex items-center justify-center overflow-hidden shrink-0">
                {u.profileImageUrl ? (
                  <img src={u.profileImageUrl} alt={displayName(u)} className="w-full h-full object-cover" />
                ) : (
                  <span className="text-sm font-bold text-indigo-300">
                    {u.firstName && u.lastName
                      ? `${u.firstName[0]}${u.lastName[0]}`.toUpperCase()
                      : initials(u.email) || '?'}
                  </span>
                )}
              </div>
              <div className="min-w-0">
                <p className="font-medium text-gray-100 truncate">{displayName(u)}</p>
                <p className="text-sm text-gray-400 truncate">{u.email}</p>
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  )
}
