import {
  collection, doc, getDoc, getDocs, writeBatch,
  query, orderBy, where, onSnapshot, Timestamp,
  type Unsubscribe,
} from 'firebase/firestore'
import {
  ref, uploadBytes, getDownloadURL,
} from 'firebase/storage'
import { db, storage } from '../firebase/config'
import {
  chatUserFromDoc, chatMessageFromDoc, recentMessageFromDoc,
  type ChatUser, type ChatMessage, type RecentMessage, type ChatMessageType,
} from '../models/chat'
import { getCompanyId } from '../stores/authStore'

// -- Users --

export async function fetchChatUser(uid: string): Promise<ChatUser | null> {
  const snap = await getDoc(doc(db, 'users', uid))
  if (!snap.exists()) return null
  const d = snap.data()
  return {
    id: snap.id,
    uid: (d['uid'] as string) || snap.id,
    email: (d['email'] as string) || '',
    profileImageUrl: (d['profileImageUrl'] as string) || '',
    firstName: (d['firstName'] as string) || '',
    lastName: (d['lastName'] as string) || '',
  }
}

export async function fetchAllUsers(excludeUid?: string): Promise<ChatUser[]> {
  const companyId = getCompanyId()
  const q = companyId
    ? query(collection(db, 'users'), where('companyId', '==', companyId))
    : collection(db, 'users')
  const snap = await getDocs(q)
  return snap.docs
    .map(chatUserFromDoc)
    .filter(u => u.uid !== excludeUid)
}

// -- Inbox --

// Mirrors iOS: listens on recent_messages/{userId}/messages ordered by timestamp.
// Uses docChanges() to upsert — same pattern as MainMessagesViewModel.
export function subscribeToInbox(
  userId: string,
  onChange: (messages: RecentMessage[]) => void,
  onError: (err: Error) => void,
): Unsubscribe {
  const q = query(
    collection(db, 'recent_messages', userId, 'messages'),
    orderBy('timestamp', 'desc'),
  )
  return onSnapshot(
    q,
    snap => {
      const changed = snap.docChanges()
        .filter(c => c.type === 'added' || c.type === 'modified')
        .map(c => recentMessageFromDoc(c.doc))
      // Always call onChange so the inbox can clear its loading state,
      // even when the first snapshot is empty (no recent messages yet).
      onChange(changed)
    },
    onError,
  )
}

// -- Conversation --

// Mirrors iOS: listens on messages/{fromId}/{toId} ordered by timestamp.
// Only processes 'added' changes (not edits/deletes).
export function subscribeToConversation(
  fromId: string,
  toId: string,
  onMessages: (msgs: ChatMessage[]) => void,
  onError: (err: Error) => void,
): Unsubscribe {
  const q = query(
    collection(db, 'messages', fromId, toId),
    orderBy('timestamp', 'asc'),
  )
  return onSnapshot(
    q,
    snap => {
      const added = snap.docChanges()
        .filter(c => c.type === 'added')
        .map(c => chatMessageFromDoc(c.doc))
      if (added.length > 0) onMessages(added)
    },
    onError,
  )
}

// -- Sending --

export async function sendTextMessage(
  fromId: string,
  toUser: ChatUser,
  text: string,
  senderProfileUrl: string,
  senderEmail: string,
): Promise<void> {
  await _sendMessage({
    text, recentText: text, messageType: 'text',
    fromId, toUser, senderProfileUrl, senderEmail,
  })
}

export async function sendImageMessage(
  fromId: string,
  toUser: ChatUser,
  file: File,
  senderProfileUrl: string,
  senderEmail: string,
): Promise<void> {
  const fileName = `${crypto.randomUUID()}.jpg`
  const storageRef = ref(storage, `chat_images/${fromId}/${toUser.uid}/${fileName}`)
  await uploadBytes(storageRef, file, { contentType: 'image/jpeg' })
  const imageURL = await getDownloadURL(storageRef)
  await _sendMessage({
    text: imageURL, recentText: 'Photo', messageType: 'image',
    fromId, toUser, senderProfileUrl, senderEmail,
  })
}

interface SendParams {
  text: string
  recentText: string
  messageType: ChatMessageType
  fromId: string
  toUser: ChatUser
  senderProfileUrl: string
  senderEmail: string
}

// Sends a one-time welcome message from the TheLight system account to a new user.
export async function sendWelcomeMessage(newUid: string, newUserEmail: string): Promise<void> {
  const SYSTEM_ID    = 'thelight-system'
  const SYSTEM_EMAIL = 'support@thelightui.com'
  const welcomeText  =
    'Welcome to TheLight. We make it simple to manage your business, stay organized, ' +
    'and keep everything you need in one place. If you have any questions, chat with us anytime. ' +
    'We are here to help.'

  const timestamp   = Timestamp.now()
  const messageId   = doc(collection(db, 'messages')).id

  const messageData = {
    fromId:      SYSTEM_ID,
    toId:        newUid,
    text:        welcomeText,
    messageType: 'text',
    timestamp,
  }

  const senderMsgRef    = doc(db, 'messages', SYSTEM_ID, newUid,    messageId)
  const recipientMsgRef = doc(db, 'messages', newUid,    SYSTEM_ID, messageId)
  const senderRecentRef    = doc(db, 'recent_messages', SYSTEM_ID, 'messages', newUid)
  const recipientRecentRef = doc(db, 'recent_messages', newUid,    'messages', SYSTEM_ID)

  const batch = writeBatch(db)
  batch.set(senderMsgRef,    messageData)
  batch.set(recipientMsgRef, messageData)
  batch.set(senderRecentRef, {
    timestamp, text: welcomeText,
    fromId: SYSTEM_ID, toId: newUid,
    profileImageUrl: '', email: newUserEmail,
  })
  batch.set(recipientRecentRef, {
    timestamp, text: welcomeText,
    fromId: SYSTEM_ID, toId: newUid,
    profileImageUrl: '', email: SYSTEM_EMAIL,
  })
  await batch.commit()
}

// Mirrors iOS sendMessage: batch-writes to both sides of messages/ and recent_messages/
async function _sendMessage({
  text, recentText, messageType,
  fromId, toUser, senderProfileUrl, senderEmail,
}: SendParams): Promise<void> {
  const timestamp = Timestamp.now()
  const messageData = {
    fromId,
    toId: toUser.uid,
    text,
    messageType,
    timestamp,
  }

  // Generate shared message ID
  const messageId = doc(collection(db, 'messages')).id

  const senderMsgRef   = doc(db, 'messages', fromId, toUser.uid, messageId)
  const recipientMsgRef = doc(db, 'messages', toUser.uid, fromId, messageId)
  const senderRecentRef   = doc(db, 'recent_messages', fromId, 'messages', toUser.uid)
  const recipientRecentRef = doc(db, 'recent_messages', toUser.uid, 'messages', fromId)

  const senderRecent = {
    timestamp, text: recentText,
    fromId, toId: toUser.uid,
    profileImageUrl: toUser.profileImageUrl,
    email: toUser.email,
  }
  const recipientRecent = {
    timestamp, text: recentText,
    fromId, toId: toUser.uid,
    profileImageUrl: senderProfileUrl,
    email: senderEmail,
  }

  const batch = writeBatch(db)
  batch.set(senderMsgRef, messageData)
  batch.set(recipientMsgRef, messageData)
  batch.set(senderRecentRef, senderRecent)
  batch.set(recipientRecentRef, recipientRecent)
  await batch.commit()
}
