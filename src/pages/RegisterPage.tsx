import { useRef, useState, useEffect } from 'react'
import { usePageTitle } from '../hooks/usePageTitle'
import { useNavigate, Link } from 'react-router-dom'
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage'
import { doc, setDoc } from 'firebase/firestore'
import { sendWelcomeMessage } from '../services/chatService'
import { updateProfile } from 'firebase/auth'
import { useAuthStore } from '../stores/authStore'
import { storage, db } from '../firebase/config'

export default function RegisterPage() {
  usePageTitle('Create Account')
  const [firstName, setFirstName]   = useState('')
  const [lastName, setLastName]     = useState('')
  const [phone, setPhone]           = useState('')
  const [email, setEmail]           = useState('')
  const [password, setPassword]     = useState('')
  const [confirm, setConfirm]       = useState('')
  const [photo, setPhoto]           = useState<File | null>(null)
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const [localError, setLocalError] = useState<string | null>(null)
  const [saving, setSaving]         = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const { signUp, loading, error, clearError, user } = useAuthStore()
  const navigate = useNavigate()

  useEffect(() => {
    if (user && !saving) navigate('/dashboard', { replace: true })
  }, [user, saving, navigate])

  function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setLocalError('Please select an image file.')
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      setLocalError('Image must be smaller than 10 MB.')
      return
    }
    setPhoto(file)
    setPhotoPreview(prev => { if (prev) URL.revokeObjectURL(prev); return URL.createObjectURL(file) })
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLocalError(null)
    clearError()

    if (password !== confirm) {
      setLocalError('Passwords do not match.')
      return
    }
    if (password.length < 6) {
      setLocalError('Password must be at least 6 characters.')
      return
    }

    await signUp(email, password)

    const { user: newUser, error: signUpError } = useAuthStore.getState()
    if (signUpError || !newUser) return

    setSaving(true)
    try {
      let photoURL = ''

      if (photo) {
        const resized = await resizeImage(photo, 512)
        const storageRef = ref(storage, `avatars/${newUser.uid}`)
        await uploadBytes(storageRef, resized, { contentType: 'image/jpeg' })
        photoURL = await getDownloadURL(storageRef)
      }

      await updateProfile(newUser, {
        displayName: `${firstName} ${lastName}`.trim(),
        photoURL: photoURL || undefined,
      })

      await setDoc(doc(db, 'users', newUser.uid), {
        uid: newUser.uid,
        firstName,
        lastName,
        phone,
        email,
        profileImageUrl: photoURL,
        createdAt: new Date().toISOString(),
      })

      await sendWelcomeMessage(newUser.uid, email)
    } catch (err) {
      setLocalError('Account created but profile save failed. You can update it in Settings.')
    } finally {
      setSaving(false)
    }
  }

  const displayError = localError ?? error
  const isLoading = loading || saving

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gray-950">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-white tracking-tight">TheLight</h1>
          <p className="text-gray-400 mt-2 text-sm">Create your account</p>
        </div>

        <div className="card p-6">
          <form onSubmit={handleSubmit} className="space-y-4">

            {/* Profile photo picker */}
            <div className="flex flex-col items-center gap-2 pb-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="relative w-20 h-20 rounded-full bg-gray-700 border-2 border-dashed border-gray-500 hover:border-indigo-500 transition-colors overflow-hidden flex items-center justify-center"
              >
                {photoPreview ? (
                  <img src={photoPreview} alt="Preview" className="w-full h-full object-cover" />
                ) : (
                  <span className="text-3xl">👤</span>
                )}
                <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity rounded-full">
                  <span className="text-white text-xs font-medium">Change</span>
                </div>
              </button>
              <span className="text-xs text-gray-400">
                {photo ? photo.name : 'Tap to choose profile photo'}
              </span>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handlePhotoChange}
              />
            </div>

            {/* Name row */}
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="block text-sm font-medium text-gray-300 mb-1.5">First Name</label>
                <input
                  type="text"
                  className="input-field"
                  placeholder="John"
                  value={firstName}
                  onChange={e => setFirstName(e.target.value)}
                  required
                  autoComplete="given-name"
                />
              </div>
              <div className="flex-1">
                <label className="block text-sm font-medium text-gray-300 mb-1.5">Last Name</label>
                <input
                  type="text"
                  className="input-field"
                  placeholder="Doe"
                  value={lastName}
                  onChange={e => setLastName(e.target.value)}
                  required
                  autoComplete="family-name"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">Phone Number</label>
              <input
                type="tel"
                className="input-field"
                placeholder="(555) 555-5555"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                autoComplete="tel"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">Email</label>
              <input
                type="email"
                className="input-field"
                placeholder="you@example.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">Password</label>
              <input
                type="password"
                className="input-field"
                placeholder="••••••••"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                autoComplete="new-password"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">Confirm Password</label>
              <input
                type="password"
                className="input-field"
                placeholder="••••••••"
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                required
                autoComplete="new-password"
              />
            </div>

            {displayError && (
              <div className="bg-red-900/30 border border-red-700/50 rounded-lg px-3 py-2.5">
                <p className="text-red-300 text-sm">{displayError}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading}
              className="btn-primary w-full mt-2"
            >
              {saving ? 'Saving profile…' : loading ? 'Creating account…' : 'Create Account'}
            </button>

            <div className="text-center pt-1">
              <span className="text-sm text-gray-400">Already have an account? </span>
              <Link to="/login" className="text-sm text-indigo-400 hover:text-indigo-300">
                Sign in
              </Link>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}

function resizeImage(file: File, maxPx: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      const side = Math.min(img.width, img.height)
      const sx   = (img.width  - side) / 2
      const sy   = (img.height - side) / 2
      const size = Math.min(side, maxPx)
      const canvas = document.createElement('canvas')
      canvas.width  = size
      canvas.height = size
      canvas.getContext('2d')!.drawImage(img, sx, sy, side, side, 0, 0, size, size)
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
