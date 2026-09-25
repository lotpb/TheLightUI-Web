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

function resolvePermissions(role: string | null): Permissions {
  switch (role) {
    case 'owner':
    case 'admin':
      return { canEdit: true, canBulkAction: true, canImport: true, canManageTeam: true, canManageCompany: true, isReadOnly: false }
    case 'salesman':
      return { canEdit: true, canBulkAction: false, canImport: false, canManageTeam: false, canManageCompany: false, isReadOnly: false }
    case 'viewer':
      return { canEdit: false, canBulkAction: false, canImport: false, canManageTeam: false, canManageCompany: false, isReadOnly: true }
    default:
      // Unknown/loading: be permissive to avoid flash-hiding UI while role resolves
      // canManageCompany false like canManageTeam: an owner sees company
      // settings read-only for a moment while the role loads, which beats
      // letting a member type into fields the rules will refuse.
      return { canEdit: true, canBulkAction: true, canImport: true, canManageTeam: false, canManageCompany: false, isReadOnly: false }
  }
}

export function usePermissions(): Permissions {
  const role = useAuthStore(s => s.role)
  return useMemo(() => resolvePermissions(role), [role])
}
