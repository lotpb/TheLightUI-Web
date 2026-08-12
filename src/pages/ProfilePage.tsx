import { useState, useEffect, useRef } from 'react'
import { useNavBack } from '../hooks/useNavBack'
import { usePageTitle } from '../hooks/usePageTitle'
import {
  updateProfile,
  updatePassword,
  reauthenticateWithCredential,
  EmailAuthProvider,
} from 'firebase/auth'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage'
import { db, storage } from '../firebase/config'
import { useAuthStore } from '../stores/authStore'
import { useToast } from '../components/Toast'

export default function ProfilePage() {
  usePageTitle('Profile')
  const user    = useAuthStore(s => s.user)
  const navBack  = useNavBack('/dashboard')
  const toast   = useToast()

  const [firstName, setFirstName] = useState('')
  const [lastName,  setLastName]  = useState('')
  const [saving,    setSaving]    = useState(false)

  const [photoUrl,   setPhotoUrl]  = useState('')
  const [uploading,  setUploading] = useState(false)
  const photoInputRef = useRef<HTMLInputElement>(null)

  const [currentPw, setCurrentPw] = useState('')
  const [newPw,     setNewPw]     = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [pwSaving,  setPwSaving]  = useState(false)

  useEffect(() => {
    if (!user) return
    getDoc(doc(db, 'users', user.uid)).then(snap => {
      if (snap.exists()) {
        const d = snap.data()
        setFirstName((d['firstName'] as string) ?? '')
        setLastName((d['lastName']  as string) ?? '')
        setPhotoUrl((d['profileImageUrl'] as string) || user.photoURL || '')
      } else {
        const parts = (user.displayName ?? '').split(' ')
        setFirstName(parts[0] ?? '')
        setLastName(parts.slice(1).join(' '))
        setPhotoUrl(user.photoURL || '')
      }
    })
  }, [user])

  async function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault()
    if (!user) return
    setSaving(true)
    try {
      const first = firstName.trim()
      const last  = lastName.trim()
      await setDoc(doc(db, 'users', user.uid), { firstName: first, lastName: last }, { merge: true })
      await updateProfile(user, {
        displayName: [first, last].filter(Boolean).join(' ') || null,
      })
      toast('Profile updated.', 'success')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Save failed.', 'error')
    } finally {
      setSaving(false)
    }
  }

  async function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !user) return
    e.target.value = ''
    if (!file.type.startsWith('image/')) { toast('Please select an image file.', 'error'); return }
    if (file.size > 10 * 1024 * 1024) { toast('Image must be smaller than 10 MB.', 'error'); return }
    setUploading(true)
    try {
      const blob = await resizeImage(file, 512)
      const fileRef = storageRef(storage, `avatars/${user.uid}`)
      await uploadBytes(fileRef, blob, { contentType: 'image/jpeg' })
      const url = await getDownloadURL(fileRef)
      await setDoc(doc(db, 'users', user.uid), { profileImageUrl: url }, { merge: true })
      await updateProfile(user, { photoURL: url })
      setPhotoUrl(url)
      toast('Photo updated.', 'success')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Upload failed.', 'error')
    } finally {
      setUploading(false)
    }
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault()
    if (!user?.email) return
    if (newPw !== confirmPw) {
      toast('New passwords do not match.', 'error')
      return
    }
    if (newPw.length < 6) {
      toast('Password must be at least 6 characters.', 'error')
      return
    }
    setPwSaving(true)
    try {
      const credential = EmailAuthProvider.credential(user.email, currentPw)
      await reauthenticateWithCredential(user, credential)
      await updatePassword(user, newPw)
      toast('Password changed successfully.', 'success')
      setCurrentPw('')
      setNewPw('')
      setConfirmPw('')
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to change password.'
      if (msg.includes('wrong-password') || msg.includes('invalid-credential')) {
        toast('Current password is incorrect.', 'error')
      } else {
        toast(msg, 'error')
      }
    } finally {
      setPwSaving(false)
    }
  }

  const initials = [firstName[0], lastName[0]].filter(Boolean).join('').toUpperCase()

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button onClick={navBack} className="text-indigo-400 hover:text-indigo-300 text-sm shrink-0">
          ← Back
        </button>
        <h1 className="text-2xl font-bold text-white">Your Profile</h1>
      </div>

      {/* Avatar + email strip */}
      <div className="card p-4 mb-6 flex items-center gap-4">
        {/* Clickable avatar */}
        <button
          type="button"
          onClick={() => photoInputRef.current?.click()}
          disabled={uploading}
          className="relative w-16 h-16 rounded-full shrink-0 group focus:outline-none"
          aria-label="Change profile photo"
        >
          {photoUrl ? (
            <img src={photoUrl} alt="Profile" className="w-16 h-16 rounded-full object-cover" />
          ) : (
            <div className="w-16 h-16 rounded-full bg-indigo-700/40 flex items-center justify-center">
              <span className="text-xl font-bold text-indigo-300">{initials || '?'}</span>
            </div>
          )}
          {/* Overlay */}
          <div className="absolute inset-0 rounded-full bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
            {uploading ? (
              <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 0 1 5.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 0 0-1.134-.175 2.31 2.31 0 0 1-1.64-1.055l-.822-1.316a2.192 2.192 0 0 0-1.736-1.039 48.774 48.774 0 0 0-5.232 0 2.192 2.192 0 0 0-1.736 1.039l-.821 1.316Z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0ZM18.75 10.5h.008v.008h-.008V10.5Z" />
              </svg>
            )}
          </div>
        </button>
        <input
          ref={photoInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handlePhotoChange}
        />

        <div className="min-w-0 flex-1">
          <p className="text-base font-semibold text-white truncate">
            {[firstName, lastName].filter(Boolean).join(' ') || 'No name set'}
          </p>
          <p className="text-sm text-gray-400 truncate">{user?.email}</p>
          <p className="text-xs text-gray-600 mt-1">Tap photo to change</p>
        </div>
      </div>

      {/* Profile info form */}
      <form onSubmit={handleSaveProfile} className="card overflow-hidden mb-6">
        <div className="px-4 py-2.5 border-b border-gray-700/50 bg-gray-800/50">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Profile Info</p>
        </div>
        <div className="p-4 space-y-3">
          <div>
            <label className="form-label">Email</label>
            <input
              className="input-field opacity-60 cursor-default"
              type="email"
              value={user?.email ?? ''}
              readOnly
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="form-label">First Name</label>
              <input
                className="input-field"
                value={firstName}
                onChange={e => setFirstName(e.target.value)}
                placeholder="First"
              />
            </div>
            <div>
              <label className="form-label">Last Name</label>
              <input
                className="input-field"
                value={lastName}
                onChange={e => setLastName(e.target.value)}
                placeholder="Last"
              />
            </div>
          </div>
          <button type="submit" disabled={saving} className="btn-primary text-sm px-4 py-1.5">
            {saving ? 'Saving…' : 'Save Profile'}
          </button>
        </div>
      </form>

      {/* Change password form */}
      <form onSubmit={handleChangePassword} className="card overflow-hidden">
        <div className="px-4 py-2.5 border-b border-gray-700/50 bg-gray-800/50">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Change Password</p>
        </div>
        <div className="p-4 space-y-3">
          <div>
            <label className="form-label">Current Password</label>
            <input
              className="input-field"
              type="password"
              value={currentPw}
              onChange={e => setCurrentPw(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
              required
            />
          </div>
          <div>
            <label className="form-label">New Password</label>
            <input
              className="input-field"
              type="password"
              value={newPw}
              onChange={e => setNewPw(e.target.value)}
              placeholder="••••••••"
              autoComplete="new-password"
              required
            />
          </div>
          <div>
            <label className="form-label">Confirm New Password</label>
            <input
              className="input-field"
              type="password"
              value={confirmPw}
              onChange={e => setConfirmPw(e.target.value)}
              placeholder="••••••••"
              autoComplete="new-password"
              required
            />
          </div>
          <button type="submit" disabled={pwSaving} className="btn-primary text-sm px-4 py-1.5">
            {pwSaving ? 'Updating…' : 'Change Password'}
          </button>
        </div>
      </form>
    </div>
  )
}

// Resize + centre-crop to a square, then encode as JPEG at quality 0.88.
function resizeImage(file: File, maxPx: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      const side  = Math.min(img.width, img.height)
      const sx    = (img.width  - side) / 2
      const sy    = (img.height - side) / 2
      const size  = Math.min(side, maxPx)

      const canvas = document.createElement('canvas')
      canvas.width  = size
      canvas.height = size
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size)

      canvas.toBlob(
        blob => blob ? resolve(blob) : reject(new Error('Canvas export failed')),
        'image/jpeg',
        0.88,
      )
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Image load failed')) }
    img.src = url
  })
}
