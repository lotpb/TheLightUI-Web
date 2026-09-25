import { describe, it, expect, vi } from 'vitest'

vi.mock('../stores/authStore', () => ({ useAuthStore: vi.fn() }))
import { resolvePermissions } from './usePermissions'

const salesman = resolvePermissions('salesman')

describe('resolvePermissions', () => {
  it("invited teammates ('member') get salesman access, not Import or bulk export", () => {
    const m = resolvePermissions('member')
    expect(m).toEqual(salesman)
    expect(m.canImport).toBe(false)
    expect(m.canBulkAction).toBe(false)
    expect(m.canEdit).toBe(true)
  })

  it('any unrecognised role gets salesman access too', () => {
    for (const r of ['user', 'contractor', 'mystery', '']) expect(resolvePermissions(r), r).toEqual(salesman)
  })

  it('a role that is still loading keeps the permissive record access, but no team/company settings', () => {
    const p = resolvePermissions(null, false)
    expect(p.canImport).toBe(true)
    expect(p.canBulkAction).toBe(true)
    expect(p.canManageTeam).toBe(false)
    expect(p.canManageCompany).toBe(false)
  })

  it('a missing role once loading has finished is not the loading default', () => {
    expect(resolvePermissions(null, true)).toEqual(salesman)
  })

  it('is case- and whitespace-insensitive — "Viewer" is read-only', () => {
    expect(resolvePermissions('Viewer').isReadOnly).toBe(true)
    expect(resolvePermissions(' VIEWER ').canEdit).toBe(false)
    expect(resolvePermissions('Admin').canImport).toBe(true)
  })

  it('owner and admin keep everything', () => {
    for (const r of ['owner', 'admin']) {
      const p = resolvePermissions(r)
      expect(p.canImport && p.canBulkAction && p.canManageTeam && p.canManageCompany && p.canEdit).toBe(true)
    }
  })
})
