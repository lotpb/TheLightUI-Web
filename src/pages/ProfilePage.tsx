import { useState, useEffect, useRef } from 'react'
import { useNavBack } from '../hooks/useNavBack'
import { usePageTitle } from '../hooks/usePageTitle'
import {
  updateProfile,
  updatePassword,
  reauthenticateWithCredential,
  EmailAuthProvider,
  sendEmailVerification,
} from 'firebase/auth'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage'
import { db, storage } from '../firebase/config'
import { useAuthStore } from '../stores/authStore'
import { useToast } from '../components/Toast'
import { Icon, ICONS } from '../components/Icon'
import { friendlyAuthError } from '../models/authErrors'
import {
  displayNameFor, initialsFor, passwordChecks, passwordIssue, profileDirty,
  roleIsReadOnly, roleLabel, PASSWORD_MIN_LENGTH,
  type ProfileDraft, type ProfileLoadState,
} from '../models/profileForm'

export default function ProfilePage() {
  usePageTitle('Profile')
  const user      = useAuthStore(s => s.user)
  const role      = useAuthStore(s => s.role)
  const companyId = useAuthStore(s => s.companyId)
  const navBack   = useNavBack('/dashboard')
  const toast     = useToast()

  const [draft, setDraft] = useState<ProfileDraft>({ firstName: '', lastName: '' })
  /**
   * What's actually stored, or null until it loads.
   *
   * The page had neither: `getDoc(...).then(...)` with no `.catch()` left both
   * fields empty on a failed read, indistinguishable from "no name set" — and
   * saving then wrote those empty strings over the real name plus
   * `displayName: null` on the auth record.
   */
  const [saved, setSaved]       = useState<ProfileDraft | null>(null)
  const [loadState, setLoad]    = useState<ProfileLoadState>('loading')
  const [saving, setSaving]     = useState(false)

  const [photoUrl, setPhotoUrl]   = useState('')
  const [uploading, setUploading] = useState(false)
  const photoInputRef = useRef<HTMLInputElement>(null)

  const [currentPw, setCurrentPw] = useState('')
  const [newPw, setNewPw]         = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [showPw, setShowPw]       = useState(false)
  const [pwSaving, setPwSaving]   = useState(false)
  const [pwSubmitted, setPwSubmitted] = useState(false)

  const [sendingVerify, setSendingVerify] = useState(false)
  const [verifySentAt, setVerifySentAt]   = useState<number | null>(null)
  const [checkingVerify, setCheckingVerify] = useState(false)
  const [verified, setVerified] = useState(!!user?.emailVerified)

  useEffect(() => { setVerified(!!user?.emailVerified) }, [user])

  function loadProfile() {
    if (!user) return
    setLoad('loading')
    getDoc(doc(db, 'users', user.uid))
      .then(snap => {
        let next: ProfileDraft
        if (snap.exists()) {
          const d = snap.data()
          next = {
            firstName: (d['firstName'] as string) ?? '',
            lastName:  (d['lastName'] as string) ?? '',
          }
          setPhotoUrl((d['profileImageUrl'] as string) || user.photoURL || '')
        } else {
          const parts = (user.displayName ?? '').split(' ')
          next = { firstName: parts[0] ?? '', lastName: parts.slice(1).join(' ') }
          setPhotoUrl(user.photoURL || '')
        }
        setDraft(next)
        setSaved(next)
        setLoad('loaded')
      })
      .catch(() => {
        // Explicitly not 'loaded': with `saved` still null the form stays
        // disabled, so a failed read can't be saved back as empty.
        setLoad('failed')
      })
  }

  useEffect(loadProfile, [user])

  const dirty = profileDirty(draft, saved)

  // Warn before losing edits — the page previously lost them silently on Back
  // or a tab close.
  useEffect(() => {
    if (!dirty) return
    function onBeforeUnload(e: BeforeUnloadEvent) { e.preventDefault() }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty])

  function handleBack() {
    if (dirty && !window.confirm('You have unsaved changes to your name. Leave without saving?')) return
    navBack()
  }

  async function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault()
    if (!user || loadState !== 'loaded') return
    setSaving(true)
    try {
      const next: ProfileDraft = {
        firstName: draft.firstName.trim(),
        lastName: draft.lastName.trim(),
      }
      await setDoc(doc(db, 'users', user.uid), next, { merge: true })
      await updateProfile(user, { displayName: displayNameFor(next) })
      setSaved(next)
      setDraft(next)
      toast('Profile updated.', 'success')
    } catch (err) {
      // Was `err.message`, which showed raw Firebase strings.
      toast(friendlyAuthError(err, 'Couldn’t save your profile. Try again.'), 'error')
    } finally {
      setSaving(false)
    }
  }

  async function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !user) return
    e.target.value = ''
    if (!file.type.startsWith('image/')) { toast('Please choose an image file.', 'error'); return }
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
      toast(friendlyAuthError(err, 'Couldn’t upload that photo. Try again.'), 'error')
    } finally {
      setUploading(false)
    }
  }

  const pwChecks = passwordChecks(newPw, confirmPw)
  const pwIssue  = passwordIssue(currentPw, newPw, confirmPw)

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault()
    setPwSubmitted(true)
    if (!user?.email || pwIssue) return
    setPwSaving(true)
    try {
      await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, currentPw))
      await updatePassword(user, newPw)
      toast('Password changed.', 'success')
      setCurrentPw(''); setNewPw(''); setConfirmPw('')
      setPwSubmitted(false)
    } catch (err) {
      toast(friendlyAuthError(err, 'Couldn’t change your password. Try again.'), 'error')
    } finally {
      setPwSaving(false)
    }
  }

  async function handleSendVerification() {
    if (!user) return
    setSendingVerify(true)
    try {
      await sendEmailVerification(user)
      setVerifySentAt(Date.now())
      toast('Verification email sent.', 'success')
    } catch (err) {
      toast(friendlyAuthError(err, 'Couldn’t send the verification email. Try again.'), 'error')
    } finally {
      setSendingVerify(false)
    }
  }

  /**
   * Re-reads the auth record.
   *
   * `user.emailVerified` is cached, so clicking the link in an inbox never
   * updated this page — the warning persisted until a full reload, with no
   * control to recheck.
   */
  async function handleCheckVerification() {
    if (!user) return
    setCheckingVerify(true)
    try {
      await user.reload()
      if (user.emailVerified) {
        setVerified(true)
        toast('Email verified.', 'success')
      } else {
        toast('Still not verified. Open the link in the email, then check again.', 'error')
      }
    } catch (err) {
      toast(friendlyAuthError(err, 'Couldn’t check your verification status.'), 'error')
    } finally {
      setCheckingVerify(false)
    }
  }

  const initials = initialsFor(draft)
  const fullName = displayNameFor(draft)

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={handleBack}
          className="text-indigo-400 hover:text-indigo-300 text-sm shrink-0 inline-flex items-center gap-1
                     focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 rounded px-1 py-0.5"
        >
          {/* Was a literal ← character. */}
          <Icon d={ICONS.chevronLeft} className="w-4 h-4" />
          Back
        </button>
        <h1 className="text-2xl font-bold text-white">Your profile</h1>
      </div>

      {/* Identity strip */}
      <div className="card p-4 mb-6 flex items-center gap-4">
        <button
          type="button"
          onClick={() => photoInputRef.current?.click()}
          disabled={uploading}
          className="relative w-16 h-16 rounded-full shrink-0 group
                     focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-2
                     focus-visible:ring-offset-gray-800"
          aria-label="Change profile photo"
        >
          {photoUrl ? (
            <img src={photoUrl} alt="" className="w-16 h-16 rounded-full object-cover" />
          ) : (
            <div className="w-16 h-16 rounded-full bg-indigo-700/40 flex items-center justify-center">
              <span className="text-xl font-bold text-indigo-300">{initials || '?'}</span>
            </div>
          )}
          {/* The overlay was opacity-0 group-hover:opacity-100 — no hover on
              touch, so the only affordance was a 1.94:1 caption. A permanent
              badge sits in the corner and the full overlay still appears on
              hover. */}
          <span className="absolute -bottom-0.5 -right-0.5 w-6 h-6 rounded-full bg-indigo-600 border-2 border-gray-800
                           flex items-center justify-center pointer-events-none">
            <Icon d={ICONS.photo} className="w-3 h-3 text-white" />
          </span>
          <div className="absolute inset-0 rounded-full bg-black/50 flex items-center justify-center
                          opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
            {uploading
              ? <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              : <Icon d={ICONS.photo} className="w-5 h-5 text-white" />}
          </div>
        </button>
        <input ref={photoInputRef} type="file" accept="image/*" className="hidden" onChange={handlePhotoChange} />

        <div className="min-w-0 flex-1">
          <p className="text-base font-semibold text-white truncate">
            {loadState === 'loading' ? 'Loading…' : fullName ?? 'No name set'}
          </p>
          <p className="text-sm text-gray-300 truncate">{user?.email}</p>
          {/* role and companyId were both in the auth store and neither
              appeared — on a CRM where 'viewer' silently blocks writes,
              what you are is the most useful line here. */}
          <div className="flex items-center gap-2 flex-wrap mt-1">
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
              roleIsReadOnly(role)
                ? 'bg-amber-500/20 text-amber-200'
                : 'bg-indigo-500/20 text-indigo-200'
            }`}>
              {roleLabel(role)}
            </span>
            {verified
              ? <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-green-500/20 text-green-200">Email verified</span>
              : <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-amber-500/20 text-amber-200">Email unverified</span>}
            {/* Was "Tap photo to change" at text-gray-600 — 1.94:1 — on a
                desktop web app. */}
            <span className="text-xs text-gray-400">Click your photo to change it</span>
          </div>
        </div>
      </div>

      {/* Profile info */}
      <form onSubmit={handleSaveProfile} className="card overflow-hidden mb-6">
        {/* Was bg-gray-800/50 on a .card that *is* bg-gray-800 — exactly
            1.000:1, so the section headers had no band at all. */}
        <div className="px-4 py-2.5 border-b border-gray-700 bg-gray-700/50">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-200">Profile info</p>
        </div>
        <div className="p-4 space-y-3">
          {loadState === 'failed' && (
            <div role="alert" className="flex items-start gap-2 bg-red-900/25 border border-red-700/50 rounded-lg px-3 py-2.5 text-sm text-red-200">
              <Icon d={ICONS.warning} className="w-4 h-4 shrink-0 mt-0.5" />
              <span className="flex-1">
                Couldn’t load your saved profile, so the fields below are blank and saving is disabled —
                otherwise it would overwrite your name with nothing.
              </span>
              <button
                type="button"
                onClick={loadProfile}
                className="shrink-0 underline hover:no-underline focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400 rounded"
              >
                Retry
              </button>
            </div>
          )}

          <div>
            <label htmlFor="profile-email" className="form-label">Email</label>
            {/* Was opacity-60, which dropped the contrast of the user's own
                address by 45% and read as a control that ought to work. */}
            <input
              id="profile-email"
              className="input-field bg-gray-800 text-gray-300 cursor-default"
              type="email"
              value={user?.email ?? ''}
              readOnly
              aria-describedby="profile-email-note"
            />
            <p id="profile-email-note" className="text-xs text-gray-400 mt-1">
              This is your sign-in address and can’t be changed here — ask an owner or admin to change it for you.
            </p>

            {!verified && (
              <div className="mt-2 flex items-center gap-3 flex-wrap">
                <button
                  type="button"
                  onClick={handleSendVerification}
                  disabled={sendingVerify}
                  className="text-xs text-indigo-400 hover:text-indigo-300 disabled:opacity-40
                             focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 rounded px-1"
                >
                  {sendingVerify ? 'Sending…' : verifySentAt ? 'Resend verification email' : 'Send verification email'}
                </button>
                {/* verifySent used to latch true forever, so a mail that never
                    arrived could only be resent by reloading the page. */}
                <button
                  type="button"
                  onClick={handleCheckVerification}
                  disabled={checkingVerify}
                  className="text-xs text-indigo-400 hover:text-indigo-300 disabled:opacity-40
                             focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 rounded px-1"
                >
                  {checkingVerify ? 'Checking…' : 'I’ve verified — check again'}
                </button>
                {verifySentAt && (
                  <span className="text-xs text-gray-400">Sent. Check your inbox and spam folder.</span>
                )}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="profile-first" className="form-label">First name</label>
              <input
                id="profile-first"
                className="input-field"
                value={draft.firstName}
                onChange={e => setDraft(d => ({ ...d, firstName: e.target.value }))}
                disabled={loadState !== 'loaded'}
                placeholder="First"
              />
            </div>
            <div>
              <label htmlFor="profile-last" className="form-label">Last name</label>
              <input
                id="profile-last"
                className="input-field"
                value={draft.lastName}
                onChange={e => setDraft(d => ({ ...d, lastName: e.target.value }))}
                disabled={loadState !== 'loaded'}
                placeholder="Last"
              />
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Save was always enabled, so it never said whether there was
                anything to save. */}
            <button
              type="submit"
              disabled={saving || !dirty || loadState !== 'loaded'}
              title={!dirty && loadState === 'loaded' ? 'No changes to save' : undefined}
              className="btn-primary text-sm px-4 py-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {saving ? 'Saving…' : 'Save profile'}
            </button>
            {dirty && <span className="text-xs text-amber-200">Unsaved changes</span>}
          </div>
        </div>
      </form>

      {/* Change password */}
      <form onSubmit={handleChangePassword} className="card overflow-hidden">
        <div className="px-4 py-2.5 border-b border-gray-700 bg-gray-700/50">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-200">Change password</p>
        </div>
        <div className="p-4 space-y-3">
          <div>
            <label htmlFor="profile-current-pw" className="form-label">Current password</label>
            <input
              id="profile-current-pw"
              className="input-field"
              type={showPw ? 'text' : 'password'}
              value={currentPw}
              onChange={e => setCurrentPw(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
            />
          </div>
          <div>
            <label htmlFor="profile-new-pw" className="form-label">New password</label>
            <input
              id="profile-new-pw"
              className="input-field"
              type={showPw ? 'text' : 'password'}
              value={newPw}
              onChange={e => setNewPw(e.target.value)}
              placeholder="••••••••"
              autoComplete="new-password"
            />
          </div>
          <div>
            <label htmlFor="profile-confirm-pw" className="form-label">Confirm new password</label>
            <input
              id="profile-confirm-pw"
              className="input-field"
              type={showPw ? 'text' : 'password'}
              value={confirmPw}
              onChange={e => setConfirmPw(e.target.value)}
              placeholder="••••••••"
              autoComplete="new-password"
            />
          </div>

          <label className="flex items-center gap-2 cursor-pointer w-fit">
            <input
              type="checkbox"
              checked={showPw}
              onChange={e => setShowPw(e.target.checked)}
              className="w-3.5 h-3.5 rounded accent-indigo-500"
            />
            <span className="text-xs text-gray-300">Show passwords</span>
          </label>

          {/* The rules were toast-only, fired on submit — nothing stated the
              minimum, and a typo in a masked field was only discoverable by
              failing. */}
          <ul className="space-y-1">
            {pwChecks.map(c => (
              <li key={c.id} className="flex items-center gap-2 text-xs">
                <Icon
                  d={c.met === false ? ICONS.close : ICONS.check}
                  className={`w-3 h-3 shrink-0 ${
                    c.met === true ? 'text-emerald-400' : c.met === false ? 'text-red-400' : 'text-gray-400'
                  }`}
                />
                <span className={c.met === true ? 'text-gray-200' : c.met === false ? 'text-red-300' : 'text-gray-300'}>
                  {c.label}
                </span>
              </li>
            ))}
          </ul>

          {pwSubmitted && pwIssue && (
            <p role="alert" className="flex items-start gap-2 text-sm text-red-300 bg-red-900/25 border border-red-700/50 rounded-lg px-3 py-2">
              <Icon d={ICONS.warning} className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{pwIssue}</span>
            </p>
          )}

          <button
            type="submit"
            disabled={pwSaving}
            className="btn-primary text-sm px-4 py-1.5 disabled:opacity-40"
          >
            {pwSaving ? 'Updating…' : 'Change password'}
          </button>
          <p className="text-xs text-gray-400">
            Minimum {PASSWORD_MIN_LENGTH} characters. You’ll stay signed in on this device.
          </p>
        </div>
      </form>

      {companyId && (
        <p className="text-xs text-gray-400 mt-4 text-center">
          Signed in to company <span className="text-gray-200 font-mono">{companyId}</span>
        </p>
      )}
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
      const side = Math.min(img.width, img.height)
      const sx   = (img.width - side) / 2
      const sy   = (img.height - side) / 2
      const size = Math.min(side, maxPx)

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
