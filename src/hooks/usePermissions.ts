import { useMemo } from 'react'
import { useAuthStore } from '../stores/authStore'

export interface Permissions {
  canEdit: boolean        // create / edit / delete individual records
  canBulkAction: boolean  // bulk deactivate, assign, export, delete
  canImport: boolean      // import JSON / CSV
  canManageTeam: boolean  // invite, change roles, remove members
  isReadOnly: boolean     // shorthand: viewer role, no mutations at all
}

function resolvePermissions(role: string | null): Permissions {
  switch (role) {
    case 'owner':
    case 'admin':
      return { canEdit: true, canBulkAction: true, canImport: true, canManageTeam: true, isReadOnly: false }
    case 'salesman':
      return { canEdit: true, canBulkAction: false, canImport: false, canManageTeam: false, isReadOnly: false }
    case 'viewer':
      return { canEdit: false, canBulkAction: false, canImport: false, canManageTeam: false, isReadOnly: true }
    default:
      // Unknown/loading: be permissive to avoid flash-hiding UI while role resolves
      return { canEdit: true, canBulkAction: true, canImport: true, canManageTeam: false, isReadOnly: false }
  }
}

export function usePermissions(): Permissions {
  const role = useAuthStore(s => s.role)
  return useMemo(() => resolvePermissions(role), [role])
}
