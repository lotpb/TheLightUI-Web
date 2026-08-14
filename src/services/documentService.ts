import {
  collection, doc, addDoc, deleteDoc,
  onSnapshot, query, where, serverTimestamp,
  type Unsubscribe,
} from 'firebase/firestore'
import {
  ref, uploadBytesResumable, getDownloadURL, deleteObject,
} from 'firebase/storage'
import { db, storage } from '../firebase/config'
import { getCompanyId } from '../stores/authStore'
import type { CustomerDocument } from '../models/document'

const COLLECTION = 'Documents'
const MAX_BYTES   = 10 * 1024 * 1024 // 10 MB

function docFromSnap(d: { id: string; data: () => Record<string, unknown> }): CustomerDocument {
  const data = d.data()
  const ts = data['createdAt'] as { toDate?: () => Date } | null
  return {
    id: d.id,
    companyId:      typeof data['companyId']      === 'string' ? data['companyId']      : '',
    customerId:     typeof data['customerId']     === 'string' ? data['customerId']     : '',
    name:           typeof data['name']           === 'string' ? data['name']           : '',
    url:            typeof data['url']            === 'string' ? data['url']            : '',
    storagePath:    typeof data['storagePath']    === 'string' ? data['storagePath']    : '',
    size:           typeof data['size']           === 'number' ? data['size']           : 0,
    mimeType:       typeof data['mimeType']       === 'string' ? data['mimeType']       : '',
    uploadedBy:     typeof data['uploadedBy']     === 'string' ? data['uploadedBy']     : '',
    uploadedByName: typeof data['uploadedByName'] === 'string' ? data['uploadedByName'] : '',
    createdAt: ts?.toDate?.() ?? new Date(),
  }
}

export function subscribeToDocuments(
  customerId: string,
  onData: (docs: CustomerDocument[]) => void,
  onError: (err: Error) => void,
): Unsubscribe {
  const companyId = getCompanyId()
  if (!companyId) { onError(new Error('Not authenticated')); return () => {} }

  return onSnapshot(
    query(
      collection(db, COLLECTION),
      where('companyId', '==', companyId),
      where('customerId', '==', customerId),
    ),
    snap => {
      const items = snap.docs.map(docFromSnap)
      items.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      onData(items)
    },
    onError,
  )
}

export function uploadDocument(
  customerId: string,
  file: File,
  userId: string,
  userName: string,
  onProgress: (pct: number) => void,
): Promise<CustomerDocument> {
  const companyId = getCompanyId()
  if (!companyId) return Promise.reject(new Error('Not authenticated'))
  if (file.size > MAX_BYTES) return Promise.reject(new Error('File exceeds 10 MB limit'))

  const timestamp   = Date.now()
  const storagePath = `documents/${companyId}/${customerId}/${timestamp}-${file.name}`
  const storageRef  = ref(storage, storagePath)
  const task        = uploadBytesResumable(storageRef, file)

  return new Promise((resolve, reject) => {
    task.on(
      'state_changed',
      snap => onProgress(Math.round((snap.bytesTransferred / snap.totalBytes) * 100)),
      reject,
      async () => {
        try {
          const url = await getDownloadURL(task.snapshot.ref)
          const docRef = await addDoc(collection(db, COLLECTION), {
            companyId,
            customerId,
            name: file.name,
            url,
            storagePath,
            size: file.size,
            mimeType: file.type || 'application/octet-stream',
            uploadedBy: userId,
            uploadedByName: userName,
            createdAt: serverTimestamp(),
          })
          resolve({
            id: docRef.id,
            companyId,
            customerId,
            name: file.name,
            url,
            storagePath,
            size: file.size,
            mimeType: file.type || 'application/octet-stream',
            uploadedBy: userId,
            uploadedByName: userName,
            createdAt: new Date(),
          })
        } catch (e) {
          reject(e)
        }
      },
    )
  })
}

export async function deleteDocument(document: CustomerDocument): Promise<void> {
  await deleteDoc(doc(db, COLLECTION, document.id))
  if (document.storagePath) {
    try {
      await deleteObject(ref(storage, document.storagePath))
    } catch {
      // Storage object may already be gone — ignore
    }
  }
}
