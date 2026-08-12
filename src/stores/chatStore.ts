import { create } from 'zustand'
import { subscribeToInbox } from '../services/chatService'
import type { RecentMessage } from '../models/chat'
import type { Unsubscribe } from 'firebase/firestore'

const LAST_SEEN_KEY = 'thelight.chatLastSeen'

interface ChatStore {
  unreadCount: number
  markRead: () => void
  startWatch: (userId: string) => void
  stopWatch: () => void
}

// Module-level so they survive React re-renders
let _unsub: Unsubscribe | null = null
const _msgs = new Map<string, RecentMessage>()
let _userId = ''

export const useChatStore = create<ChatStore>((set) => ({
  unreadCount: 0,

  markRead() {
    localStorage.setItem(LAST_SEEN_KEY, String(Date.now()))
    set({ unreadCount: 0 })
  },

  startWatch(userId) {
    if (_unsub) return
    _userId = userId
    _unsub = subscribeToInbox(
      userId,
      (changed) => {
        for (const m of changed) _msgs.set(m.id, m)
        const lastSeen = parseInt(localStorage.getItem(LAST_SEEN_KEY) ?? '0', 10)
        const count = [..._msgs.values()].filter(
          m => m.fromId !== _userId && m.timestamp.getTime() > lastSeen
        ).length
        set({ unreadCount: count })
      },
      () => {},
    )
  },

  stopWatch() {
    _unsub?.()
    _unsub = null
    _msgs.clear()
    _userId = ''
    set({ unreadCount: 0 })
  },
}))
