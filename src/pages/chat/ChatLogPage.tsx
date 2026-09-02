import { useEffect, useRef, useState, useCallback } from 'react'
import { useParams, useLocation, Link } from 'react-router-dom'
import { useNavBack } from '../../hooks/useNavBack'
import { usePageTitle } from '../../hooks/usePageTitle'
import {
  fetchChatUser, subscribeToConversation, sendTextMessage, sendImageMessage,
} from '../../services/chatService'
import { initials, displayName, type ChatMessage, type ChatUser } from '../../models/chat'
import { useAuthStore } from '../../stores/authStore'
import { avatarColor, avatarOriginal } from '../../utils/avatarColor'
import { usePrefStore } from '../../stores/prefStore'

interface LocationState {
  contactEmail?: string
  contactProfileUrl?: string
}

export default function ChatLogPage() {
  const { userId: contactId } = useParams<{ userId: string }>()
  const location = useLocation()
  const navBack  = useNavBack('/chat')
  const state = (location.state ?? {}) as LocationState
  const authUser = useAuthStore(s => s.user)

  const [contact, setContact] = useState<ChatUser | null>(null)
  const [currentUser, setCurrentUser] = useState<ChatUser | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // Fetch both user profiles once
  useEffect(() => {
    if (!authUser || !contactId) return

    fetchChatUser(authUser.uid).then(u => setCurrentUser(u))

    fetchChatUser(contactId).then(u => {
      if (u) {
        setContact(u)
      } else if (state.contactEmail) {
        setContact({
          id: contactId,
          uid: contactId,
          email: state.contactEmail,
          profileImageUrl: state.contactProfileUrl ?? '',
          firstName: '',
          lastName: '',
        })
      }
    })
  }, [authUser, contactId, state.contactEmail, state.contactProfileUrl])

  // Real-time message listener
  useEffect(() => {
    if (!authUser?.uid || !contactId) return
    const unsub = subscribeToConversation(
      authUser.uid,
      contactId,
      newMsgs => setMessages(prev => {
        const ids = new Set(prev.map(m => m.id))
        const fresh = newMsgs.filter(m => !ids.has(m.id))
        return fresh.length > 0 ? [...prev, ...fresh] : prev
      }),
      err => setError(err.message),
    )
    return () => { unsub(); setMessages([]) }
  }, [authUser?.uid, contactId])

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSend = useCallback(async () => {
    const trimmed = text.trim()
    if (!trimmed || !authUser || !contact || !currentUser) return
    setText('')
    setSending(true)

    setError(null)
    try {
      await sendTextMessage(
        authUser.uid, contact, trimmed,
        currentUser.profileImageUrl, currentUser.email,
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Send failed')
      setText(trimmed)
    } finally {
      setSending(false)
    }
  }, [text, authUser, contact, currentUser])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
  }

  const handleImagePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !authUser || !contact || !currentUser) return
    e.target.value = ''
    if (!file.type.startsWith('image/')) { setError('Please select an image file.'); return }
    if (file.size > 10 * 1024 * 1024) { setError('Image must be smaller than 10 MB.'); return }
    setUploading(true)
    setError(null)
    try {
      const resized = await resizeChatImage(file, 1024)
      await sendImageMessage(
        authUser.uid, contact, resized,
        currentUser.profileImageUrl, currentUser.email,
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  const coloredAvatars = usePrefStore(s => s.coloredAvatars)
  const contactName = contact ? displayName(contact) : '…'
  usePageTitle(contact ? contactName : 'Messages')
  const contactIni = contact
    ? (contact.firstName && contact.lastName
        ? `${contact.firstName[0]}${contact.lastName[0]}`.toUpperCase()
        : initials(contact.email))
    : ''

  return (
    <div className="flex flex-col h-full w-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-8 py-3 border-b border-gray-800 bg-gray-900 shrink-0">
        <button onClick={navBack} className="text-indigo-400 hover:text-indigo-300 mr-1">←</button>
        <div className="relative w-9 h-9 rounded-full flex items-center justify-center overflow-hidden shrink-0" style={{ background: (coloredAvatars ? avatarColor(contactName) : avatarOriginal()).bg }}>
          <span className="text-xs font-bold" style={{ color: (coloredAvatars ? avatarColor(contactName) : avatarOriginal()).text }}>{contactIni || '?'}</span>
          {contact?.profileImageUrl && (
            <img
              src={contact.profileImageUrl}
              alt={contactName}
              className="absolute inset-0 w-full h-full object-cover"
              onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
            />
          )}
        </div>
        <div>
          <p className="font-semibold text-gray-100 text-sm leading-tight">{contactName}</p>
          {contact?.email && <p className="text-xs text-gray-400">{contact.email}</p>}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-8 py-4 space-y-2">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-32">
            <p className="text-gray-500 text-sm">No messages yet. Say hello!</p>
          </div>
        )}

        {messages.map((msg, i) => {
          const prev = messages[i - 1]
          const showSep = !prev || !sameDay(prev.timestamp, msg.timestamp)
          return (
            <div key={msg.id}>
              {showSep && <DateSeparator date={msg.timestamp} />}
              <MessageBubble message={msg} isFromMe={msg.fromId === authUser?.uid} />
            </div>
          )
        })}

        {(uploading) && (
          <div className="flex justify-end">
            <div className="bg-indigo-700/40 rounded-2xl px-4 py-2.5 text-indigo-300 text-sm flex items-center gap-2">
              <span className="w-3.5 h-3.5 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
              Uploading…
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Error */}
      {error && (
        <div className="px-8 pb-2">
          <div className="bg-red-900/30 border border-red-700/50 rounded-lg px-3 py-2 text-red-300 text-sm">
            {error}
          </div>
        </div>
      )}

      {/* Input bar */}
      <div className="shrink-0 px-8 py-3 border-t border-gray-800 bg-gray-900 flex items-end gap-2">
        <button
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="text-gray-400 hover:text-indigo-400 transition-colors text-xl pb-0.5"
          title="Send image"
        >
          📷
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleImagePick}
        />

        <textarea
          className="input-field flex-1 resize-none min-h-[40px] max-h-32 py-2.5"
          placeholder="Message…"
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={1}
        />

        <button
          onClick={handleSend}
          disabled={sending || !text.trim()}
          className="btn-primary px-4 py-2 shrink-0 self-end"
        >
          {sending ? '…' : 'Send'}
        </button>
      </div>
    </div>
  )
}

// Resize preserving aspect ratio — no crop, max longest side = maxPx
function resizeChatImage(file: File, maxPx: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      const scale  = Math.min(1, maxPx / Math.max(img.width, img.height))
      const w      = Math.round(img.width  * scale)
      const h      = Math.round(img.height * scale)
      const canvas = document.createElement('canvas')
      canvas.width  = w
      canvas.height = h
      canvas.getContext('2d')!.drawImage(img, 0, 0, w, h)
      canvas.toBlob(
        blob => blob ? resolve(blob) : reject(new Error('Canvas export failed')),
        'image/jpeg',
        0.85,
      )
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Image load failed')) }
    img.src = url
  })
}

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() &&
         a.getMonth()    === b.getMonth()    &&
         a.getDate()     === b.getDate()
}

function dateSepLabel(d: Date): string {
  const now   = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const diff  = Math.round((today.getTime() - target.getTime()) / 86400000)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Yesterday'
  if (d.getFullYear() === now.getFullYear())
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function DateSeparator({ date }: { date: Date }) {
  return (
    <div className="flex items-center gap-3 my-3">
      <div className="flex-1 h-px bg-gray-700/50" />
      <span className="text-xs text-gray-500 font-medium shrink-0">{dateSepLabel(date)}</span>
      <div className="flex-1 h-px bg-gray-700/50" />
    </div>
  )
}

function MessageBubble({ message: m, isFromMe }: { message: ChatMessage; isFromMe: boolean }) {
  const time = m.timestamp.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })

  return (
    <div className={`flex ${isFromMe ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[75%] ${isFromMe ? 'items-end' : 'items-start'} flex flex-col gap-1`}>
        {m.messageType === 'image' ? (
          <a href={m.text} target="_blank" rel="noopener noreferrer">
            <img
              src={m.text}
              alt="Shared image"
              className={`rounded-2xl max-w-xs max-h-64 object-cover ${
                isFromMe ? 'rounded-br-sm' : 'rounded-bl-sm'
              }`}
              loading="lazy"
            />
          </a>
        ) : (
          <div
            className={`px-4 py-2.5 rounded-2xl text-sm leading-relaxed break-words ${
              isFromMe
                ? 'bg-indigo-600 text-white rounded-br-sm'
                : 'bg-gray-700 text-gray-100 rounded-bl-sm'
            }`}
          >
            {m.text}
            {m.leadId && (
              <Link
                to={`/records/${m.leadId}`}
                className="block mt-1.5 text-xs font-semibold text-indigo-300 hover:text-indigo-200 underline"
              >
                View lead →
              </Link>
            )}
          </div>
        )}
        <span className="text-xs text-gray-500 px-1">{time}</span>
      </div>
    </div>
  )
}
