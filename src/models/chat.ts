import { Timestamp, type DocumentData, type QueryDocumentSnapshot } from 'firebase/firestore'

export type ChatMessageType = 'text' | 'image'

export interface ChatUser {
  id: string          // Firestore doc ID (= uid)
  uid: string
  email: string
  profileImageUrl: string
  firstName: string
  lastName: string
}

export interface ChatMessage {
  id: string
  fromId: string
  toId: string
  text: string
  timestamp: Date
  messageType: ChatMessageType
  // Set only on automated "lead assigned" system messages (onCustomerAssigned
  // Cloud Function) — lets the chat UI render a direct link to the record.
  leadId?: string
}

export interface RecentMessage {
  id: string          // contact's uid (Firestore doc ID)
  text: string
  email: string
  fromId: string
  toId: string
  profileImageUrl: string
  timestamp: Date
}

// -- Parsers --

function ts(v: unknown): Date {
  if (v instanceof Timestamp) return v.toDate()
  return new Date()
}
function s(d: DocumentData, k: string): string {
  return typeof d[k] === 'string' ? d[k] : ''
}

export function chatUserFromDoc(doc: QueryDocumentSnapshot): ChatUser {
  const d = doc.data()
  return {
    id: doc.id,
    uid: s(d, 'uid') || doc.id,
    email: s(d, 'email'),
    profileImageUrl: s(d, 'profileImageUrl'),
    firstName: s(d, 'firstName'),
    lastName: s(d, 'lastName'),
  }
}

export function displayName(user: ChatUser): string {
  const full = `${user.firstName} ${user.lastName}`.trim()
  return full || username(user.email)
}

export function chatMessageFromDoc(doc: QueryDocumentSnapshot): ChatMessage {
  const d = doc.data()
  const rawType = s(d, 'messageType')
  return {
    id: doc.id,
    fromId: s(d, 'fromId'),
    toId: s(d, 'toId'),
    text: s(d, 'text'),
    timestamp: ts(d['timestamp']),
    messageType: rawType === 'image' ? 'image' : 'text',
    leadId: s(d, 'leadId') || undefined,
  }
}

export function recentMessageFromDoc(doc: QueryDocumentSnapshot): RecentMessage {
  const d = doc.data()
  return {
    id: doc.id,       // doc ID is the other user's uid
    text: s(d, 'text'),
    email: s(d, 'email'),
    fromId: s(d, 'fromId'),
    toId: s(d, 'toId'),
    profileImageUrl: s(d, 'profileImageUrl'),
    timestamp: ts(d['timestamp']),
  }
}

export function username(email: string): string {
  return email.split('@')[0] ?? email
}

export function relativeTime(date: Date): string {
  const diff = Math.max(0, Date.now() - date.getTime()) / 1000
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

export function initials(email: string): string {
  const parts = email.split('@')[0].split(/[._-]/)
  return parts.slice(0, 2).map(p => p[0]?.toUpperCase() ?? '').join('')
}
