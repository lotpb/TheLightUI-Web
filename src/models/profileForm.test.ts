import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { friendlyAuthError, needsReauth } from './authErrors'
import {
  displayNameFor, initialsFor, passwordChecks, passwordIssue, profileDirty,
  roleIsReadOnly, roleLabel, PASSWORD_MIN_LENGTH,
} from './profileForm'

/**
 * Four handlers passed `err.message` straight to a toast, so users saw
 * `Firebase: Error (auth/requires-recent-login).` The shared mapper in
 * authStore covered six codes and then returned the raw message, which leaked
 * the same way for anything unmapped.
 */
describe('friendlyAuthError', () => {
  const FALLBACK = 'Something went wrong.'

  it('maps the codes the old mapper already covered', () => {
    expect(friendlyAuthError(new Error('Firebase: Error (auth/wrong-password).'), FALLBACK))
      .toBe('Incorrect password.')
    expect(friendlyAuthError(new Error('auth/user-not-found'), FALLBACK))
      .toBe('No account found with that email.')
    expect(friendlyAuthError(new Error('auth/email-already-in-use'), FALLBACK))
      .toBe('An account with this email already exists.')
    expect(friendlyAuthError(new Error('auth/weak-password'), FALLBACK))
      .toMatch(/at least 6 characters/)
    expect(friendlyAuthError(new Error('auth/too-many-requests'), FALLBACK))
      .toMatch(/Too many attempts/)
    expect(friendlyAuthError(new Error('auth/network-request-failed'), FALLBACK))
      .toMatch(/Network error/)
  })

  it('maps requires-recent-login, which /profile hits and the old mapper missed', () => {
    const msg = friendlyAuthError(new Error('Firebase: Error (auth/requires-recent-login).'), FALLBACK)
    expect(msg).toMatch(/sign out and back in/i)
    expect(msg).not.toContain('Firebase')
  })

  it('maps storage failures, for the avatar upload', () => {
    expect(friendlyAuthError(new Error('storage/unauthorized'), FALLBACK)).toMatch(/permission/i)
    expect(friendlyAuthError(new Error('storage/quota-exceeded'), FALLBACK)).toMatch(/Storage is full/)
  })

  it('never leaks a raw Firebase string for an unmapped code', () => {
    // The whole point: the old mapper's last line was `return msg`.
    const raw = 'Firebase: Error (auth/some-brand-new-code).'
    expect(friendlyAuthError(new Error(raw), FALLBACK)).toBe(FALLBACK)
    expect(friendlyAuthError(new Error(raw), FALLBACK)).not.toContain('Firebase')
    expect(friendlyAuthError(new Error(raw), FALLBACK)).not.toContain('auth/')
  })

  it('reads the code off a FirebaseError-shaped object, not just the message', () => {
    expect(friendlyAuthError({ code: 'auth/too-many-requests', message: 'opaque' }, FALLBACK))
      .toMatch(/Too many attempts/)
  })

  it('handles anything thrown', () => {
    expect(friendlyAuthError(undefined, FALLBACK)).toBe(FALLBACK)
    expect(friendlyAuthError(null, FALLBACK)).toBe(FALLBACK)
    expect(friendlyAuthError('auth/wrong-password', FALLBACK)).toBe('Incorrect password.')
    expect(friendlyAuthError({}, FALLBACK)).toBe(FALLBACK)
  })

  it('identifies the reauthentication case for the UI', () => {
    expect(needsReauth(new Error('auth/requires-recent-login'))).toBe(true)
    expect(needsReauth(new Error('auth/wrong-password'))).toBe(false)
    expect(needsReauth(undefined)).toBe(false)
  })

  it('is what authStore uses, so login and profile agree', () => {
    const store = readFileSync('src/stores/authStore.ts', 'utf8')
    expect(store).toContain("from '../models/authErrors'")
    // The private copy, whose last line leaked the raw message, is gone.
    expect(store).not.toMatch(/^function friendlyAuthError/m)
  })
})

describe('profileDirty', () => {
  const saved = { firstName: 'Jane', lastName: 'Doe' }

  it('is false before the stored profile has loaded', () => {
    // Otherwise the page claims unsaved changes on first paint.
    expect(profileDirty({ firstName: '', lastName: '' }, null)).toBe(false)
  })

  it('is false when nothing changed', () => {
    expect(profileDirty({ ...saved }, saved)).toBe(false)
  })

  it('ignores surrounding whitespace, which saving would trim anyway', () => {
    expect(profileDirty({ firstName: ' Jane ', lastName: 'Doe  ' }, saved)).toBe(false)
  })

  it('notices a real edit to either field', () => {
    expect(profileDirty({ ...saved, firstName: 'Janet' }, saved)).toBe(true)
    expect(profileDirty({ ...saved, lastName: '' }, saved)).toBe(true)
  })
})

describe('displayNameFor and initialsFor', () => {
  it('joins the two names', () => {
    expect(displayNameFor({ firstName: 'Jane', lastName: 'Doe' })).toBe('Jane Doe')
  })

  it('copes with only one name', () => {
    expect(displayNameFor({ firstName: 'Jane', lastName: '' })).toBe('Jane')
    expect(displayNameFor({ firstName: '', lastName: 'Doe' })).toBe('Doe')
  })

  it('is null rather than an empty string when both are blank', () => {
    // updateProfile wants null to clear a displayName, not ''.
    expect(displayNameFor({ firstName: '  ', lastName: '' })).toBeNull()
  })

  it('builds initials, and nothing from nothing', () => {
    expect(initialsFor({ firstName: 'jane', lastName: 'doe' })).toBe('JD')
    expect(initialsFor({ firstName: 'Jane', lastName: '' })).toBe('J')
    expect(initialsFor({ firstName: '', lastName: '' })).toBe('')
  })
})

/** The rules were toast-only, fired on submit, stated nowhere beforehand. */
describe('passwordChecks', () => {
  it('shows nothing as failed on an untouched form', () => {
    expect(passwordChecks('', '').every(c => c.met === null)).toBe(true)
  })

  it('judges length as soon as there is input', () => {
    expect(passwordChecks('abc', '').find(c => c.id === 'length')!.met).toBe(false)
    expect(passwordChecks('abcdef', '').find(c => c.id === 'length')!.met).toBe(true)
  })

  it('judges the match only once confirmation has been typed', () => {
    expect(passwordChecks('abcdef', '').find(c => c.id === 'match')!.met).toBeNull()
    expect(passwordChecks('abcdef', 'abcdeg').find(c => c.id === 'match')!.met).toBe(false)
    expect(passwordChecks('abcdef', 'abcdef').find(c => c.id === 'match')!.met).toBe(true)
  })

  it('states the real minimum', () => {
    expect(passwordChecks('a', '').find(c => c.id === 'length')!.label)
      .toContain(String(PASSWORD_MIN_LENGTH))
  })
})

describe('passwordIssue', () => {
  it('passes a valid change', () => {
    expect(passwordIssue('oldpass', 'newpass1', 'newpass1')).toBeNull()
  })

  it('names each missing field in the order they are filled', () => {
    expect(passwordIssue('', '', '')).toMatch(/current password/i)
    expect(passwordIssue('old', '', '')).toMatch(/new password/i)
    expect(passwordIssue('old', 'newpass1', '')).toMatch(/confirm/i)
  })

  it('rejects a short password before Firebase has to', () => {
    expect(passwordIssue('old', 'abc', 'abc')).toMatch(/at least 6/)
  })

  it('rejects a mismatch', () => {
    expect(passwordIssue('old', 'newpass1', 'newpass2')).toMatch(/don’t match/)
  })

  it('rejects reusing the current password', () => {
    // Firebase accepts this silently, so nothing told the user it was a no-op.
    expect(passwordIssue('samepass', 'samepass', 'samepass')).toMatch(/same as your current/)
  })

  it('checks length before match, so the more basic problem is reported first', () => {
    expect(passwordIssue('old', 'abc', 'xyz')).toMatch(/at least 6/)
  })
})

describe('roleLabel', () => {
  it('names the known roles', () => {
    expect(roleLabel('owner')).toBe('Owner')
    expect(roleLabel('admin')).toBe('Admin')
    expect(roleLabel('member')).toBe('Member')
  })

  it('says what a viewer actually is', () => {
    // 'viewer' silently blocks writes across the app, so the label says so.
    expect(roleLabel('viewer')).toMatch(/read-only/i)
    expect(roleIsReadOnly('viewer')).toBe(true)
    expect(roleIsReadOnly('admin')).toBe(false)
  })

  it('is case-insensitive', () => {
    expect(roleLabel('OWNER')).toBe('Owner')
  })

  it('handles a missing role without rendering "null"', () => {
    expect(roleLabel(null)).toBe('Role not set')
    expect(roleLabel(undefined)).toBe('Role not set')
    expect(roleLabel('')).toBe('Role not set')
  })

  it('passes an unknown role through rather than hiding it', () => {
    expect(roleLabel('superadmin')).toBe('superadmin')
  })
})
