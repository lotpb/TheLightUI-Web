import { create } from 'zustand'
import { subscribeToInbox } from '../services/chatService'
import type { RecentMessage } from '../models/chat'
import type { Unsubscribe } from 'firebase/firestore'

/**
 * Per-conversation "last opened" times: { [contactUid]: epoch ms }.
 *
 * Read state used to be a single global timestamp, written whenever the inbox
 * was opened. That made the nav badge and the inbox rows disagree permanently:
 * the badge dropped to zero the moment you looked at the list, while each row
 * drew its dot from `fromId !== me` — "they spoke last" — which no amount of
 * reading ever cleared, only replying. Two indicators for one idea,
 * contradicting each other in opposite directions.
 *
 * A conversation is read when you open *it*, which is the only event that
 * actually means you have read something.
 */
const SEEN_KEY = 'thelight.chatSeen'

/** The old single-timestamp key, still honoured as a floor so existing users
 *  don't return to an inbox where everything is suddenly unread again. */
const LEGACY_SEEN_KEY = 'thelight.chatLastSeen'

function readSeen(): Record<string, number> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(SEEN_KEY) ?? '{}')
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      const out: Record<string, number> = {}
      for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
        if (typeof v === 'number' && Number.isFinite(v)) out[k] = v
      }
      return out
    }
  } catch { /* private mode, or a malformed value — start clean */ }
  return {}
}

function readLegacyFloor(): number {
  const n = parseInt(localStorage.getItem(LEGACY_SEEN_KEY) ?? '0', 10)
  return Number.isFinite(n) ? n : 0
}

function persistSeen(seen: Record<string, number>) {
  try { localStorage.setItem(SEEN_KEY, JSON.stringify(seen)) } catch { /* ignore */ }
}

interface ChatStore {
  /** Newest first. The inbox renders straight from here. */
  messages: RecentMessage[]
  loading: boolean
  error: string | null
  /** Conversations holding something you haven't opened. */
  unreadCount: number
  isUnread: (m: RecentMessage) => boolean
  markConversationRead: (contactId: string) => void
  startWatch: (userId: string) => void
  stopWatch: () => void
}

// Module-level so they survive React re-renders.
let _unsub: Unsubscribe | null = null
const _msgs = new Map<string, RecentMessage>()
let _userId = ''
let _seen = readSeen()
let _legacyFloor = readLegacyFloor()

/** `RecentMessage.id` is the other party's uid — see models/chat. */
function seenAt(contactId: string): number {
  return Math.max(_seen[contactId] ?? 0, _legacyFloor)
}

function unreadFor(m: RecentMessage): boolean {
  return m.fromId !== _userId && m.timestamp.getTime() > seenAt(m.id)
}

function snapshot() {
  const messages = [..._msgs.values()].sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
  return { messages, unreadCount: messages.filter(unreadFor).length }
}

export const useChatStore = create<ChatStore>((set) => ({
  messages: [],
  loading: true,
  error: null,
  unreadCount: 0,

  isUnread: unreadFor,

  markConversationRead(contactId) {
    if (!contactId) return
    _seen = { ..._seen, [contactId]: Date.now() }
    persistSeen(_seen)
    set(snapshot())
  },

  /**
   * One listener for the whole app.
   *
   * The inbox page used to open a second subscription to this same collection
   * for its own copy of the list — double the reads, and two independently
   * built maps that could disagree about what the inbox held.
   */
  startWatch(userId) {
    if (_unsub && _userId === userId) return
    _unsub?.()
    _userId = userId
    _seen = readSeen()
    _legacyFloor = readLegacyFloor()
    set({ loading: true, error: null })
    _unsub = subscribeToInbox(
      userId,
      (changed) => {
        for (const m of changed) _msgs.set(m.id, m)
        set({ ...snapshot(), loading: false, error: null })
      },
      (err) => set({ loading: false, error: err.message }),
    )
  },

  stopWatch() {
    _unsub?.()
    _unsub = null
    _msgs.clear()
    _userId = ''
    set({ messages: [], unreadCount: 0, loading: true, error: null })
  },
}))
