import { useMemo } from 'react'
import { useAuthStore } from '../stores/authStore'

export interface Permissions {
  canEdit: boolean        // create / edit / delete individual records
  canBulkAction: boolean  // bulk deactivate, assign, export, delete
  canImport: boolean      // import JSON / CSV
  canManageTeam: boolean  // invite, change roles, remove members
  /** Company-wide configuration: profile/letterhead, SMS number, review link,
   *  pipeline stages, targets. Owner/admin — mirrors firestore.rules. */
  canManageCompany: boolean
  isReadOnly: boolean     // shorthand: viewer role, no mutations at all
}

const ADMIN: Permissions = {
  canEdit: true, canBulkAction: true, canImport: true, canManageTeam: true, canManageCompany: true, isReadOnly: false,
}
/** Works records; no import, bulk actions, team or company settings. */
const MEMBER: Permissions = {
  canEdit: true, canBulkAction: false, canImport: false, canManageTeam: false, canManageCompany: false, isReadOnly: false,
}
const VIEWER: Permissions = {
  canEdit: false, canBulkAction: false, canImport: false, canManageTeam: false, canManageCompany: false, isReadOnly: true,
}
/**
 * Only while the role is still loading: permissive for records, so owners
 * don't see buttons blink away and back on every page load. Team and company
 * settings stay off — a moment read-only beats a member typing into fields
 * the rules will refuse.
 */
const LOADING: Permissions = {
  canEdit: true, canBulkAction: true, canImport: true, canManageTeam: false, canManageCompany: false, isReadOnly: false,
}

/**
 * What a role may do.
 *
 * Every unrecognised role used to land on the permissive loading default, and
 * that included 'member' — the role every invited teammate gets
 * (functions/src/accounts.ts). So an ordinary invitee had Import and bulk
 * export, which salesmen don't. Loading is now told apart from an unknown role
 * by `ready` (authStore sets role and isReady together), and any role that
 * isn't owner/admin/viewer gets salesman access. That matches firestore.rules,
 * which let any non-viewer write records but keep team and company settings
 * to owner/admin.
 *
 * Case-insensitive: five users were stored as 'Viewer', missed the 'viewer'
 * case, and so got the permissive default — read-only users with full access.
 */
export function resolvePermissions(role: string | null, ready = true): Permissions {
  const r = role?.trim().toLowerCase() || null
  if (r === 'owner' || r === 'admin') return ADMIN
  if (r === 'viewer') return VIEWER
  if (r === null && !ready) return LOADING
  return MEMBER   // salesman, member (the invite default), legacy 'user', anything else
}

export function usePermissions(): Permissions {
  const role  = useAuthStore(s => s.role)
  const ready = useAuthStore(s => s.isReady)
  return useMemo(() => resolvePermissions(role, ready), [role, ready])
}
