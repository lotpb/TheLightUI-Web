import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { usePageTitle } from '../../hooks/usePageTitle'
import {
  subscribeToTeam, inviteTeamMember, setMemberRole, removeTeamMember,
  memberDisplayName, type TeamMember,
} from '../../services/teamService'
import { useAuthStore } from '../../stores/authStore'
import { useToast } from '../../components/Toast'
import { avatarColor, AVATAR_ORIGINAL } from '../../utils/avatarColor'
import { usePrefStore } from '../../stores/prefStore'

function presenceLabel(isOnline: boolean, lastSeen: Date | null): string | null {
  if (isOnline) return 'Online'
  if (!lastSeen) return null
  const min = Math.floor((Date.now() - lastSeen.getTime()) / 60000)
  if (min < 1) return 'Just now'
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  return lastSeen.toLocaleDateString()
}

const ROLES = ['owner', 'admin', 'salesman', 'viewer'] as const
type Role = typeof ROLES[number]

const ROLE_BADGE: Record<string, { label: string; classes: string }> = {
  owner:    { label: 'Owner',    classes: 'bg-yellow-500/20 text-yellow-300 border-yellow-600/30' },
  admin:    { label: 'Admin',    classes: 'bg-indigo-500/20 text-indigo-300 border-indigo-600/30' },
  salesman: { label: 'Salesman', classes: 'bg-teal-500/20 text-teal-300 border-teal-600/30' },
  viewer:   { label: 'Viewer',   classes: 'bg-gray-500/20 text-gray-400 border-gray-600/30' },
}

function roleBadge(role: string | null) {
  const cfg = role ? (ROLE_BADGE[role] ?? { label: role, classes: 'bg-gray-700 text-gray-400 border-gray-600/30' }) : null
  if (!cfg) return null
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold border ${cfg.classes}`}>
      {cfg.label}
    </span>
  )
}

function canManage(myRole: string | null): boolean {
  return myRole === 'owner' || myRole === 'admin'
}

// ── Member card ───────────────────────────────────────────────────────────────

function MemberCard({
  member,
  isMe,
  myRole,
  onRoleChange,
  onRemove,
  coloredAvatars,
}: {
  member: TeamMember
  isMe: boolean
  myRole: string | null
  onRoleChange: (m: TeamMember, role: Role) => void
  onRemove: (m: TeamMember) => void
  coloredAvatars: boolean
}) {
  const name    = memberDisplayName(member)
  const initials = [member.firstName[0], member.lastName[0]].filter(Boolean).join('').toUpperCase() || name[0]?.toUpperCase() || '?'
  const color   = coloredAvatars ? avatarColor(name) : AVATAR_ORIGINAL
  const [showMenu, setShowMenu] = useState(false)
  const isOwner = member.role === 'owner'
  const manage  = canManage(myRole) && !isMe && !isOwner

  return (
    <div className="card px-4 py-3 flex items-center gap-3 relative">
      {/* Avatar with presence dot */}
      <div className="relative shrink-0">
        <div
          className="w-10 h-10 rounded-full flex items-center justify-center overflow-hidden text-sm font-semibold"
          style={{ background: member.profileImageUrl ? undefined : color.bg, color: color.text }}
        >
          {member.profileImageUrl
            ? <img src={member.profileImageUrl} alt={name} className="w-full h-full object-cover" />
            : initials}
        </div>
        {(member.isOnline || member.lastSeen) && (
          <span className={`absolute bottom-0 right-0 block h-2.5 w-2.5 rounded-full ring-2 ring-gray-800 ${member.isOnline ? 'bg-green-500' : 'bg-gray-500'}`} />
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-semibold text-gray-100 truncate">{name}</p>
          {isMe && <span className="text-xs text-gray-500">(you)</span>}
          {roleBadge(member.role)}
        </div>
        <p className="text-xs text-gray-500 truncate mt-0.5">{member.email}</p>
        {presenceLabel(member.isOnline, member.lastSeen) && (
          <p className={`text-xs mt-0.5 font-medium ${member.isOnline ? 'text-green-400' : 'text-gray-500'}`}>
            {presenceLabel(member.isOnline, member.lastSeen)}
          </p>
        )}
        <Link
          to={`/employees?q=${encodeURIComponent(member.email)}`}
          className="text-xs text-indigo-400 hover:text-indigo-300 mt-1 inline-block"
        >
          View Employee Record →
        </Link>
      </div>

      {/* Actions (admin/owner only, not self, not other owners) */}
      {manage && (
        <div className="relative shrink-0">
          <button
            onClick={() => setShowMenu(o => !o)}
            className="p-1.5 rounded-lg text-gray-500 hover:text-gray-200 hover:bg-gray-700 transition-colors"
            title="Manage member"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.75a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5ZM12 12.75a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5ZM12 18.75a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5Z" />
            </svg>
          </button>
          {showMenu && (
            <div
              className="absolute right-0 top-8 z-20 bg-gray-800 border border-gray-700 rounded-xl shadow-xl min-w-40 overflow-hidden"
              onBlur={() => setShowMenu(false)}
            >
              <div className="px-3 py-2 border-b border-gray-700/50">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Set Role</p>
              </div>
              {ROLES.filter(r => r !== 'owner').map(r => (
                <button
                  key={r}
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-700 transition-colors capitalize ${member.role === r ? 'text-indigo-400 font-semibold' : 'text-gray-200'}`}
                  onClick={() => { onRoleChange(member, r); setShowMenu(false) }}
                >
                  {r}
                </button>
              ))}
              <div className="border-t border-gray-700/50">
                <button
                  className="w-full text-left px-3 py-2 text-sm text-red-400 hover:bg-gray-700 transition-colors"
                  onClick={() => { onRemove(member); setShowMenu(false) }}
                >
                  Remove from team
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function TeamPage() {
  usePageTitle('Team')
  const user         = useAuthStore(s => s.user)
  const role         = useAuthStore(s => s.role)
  const companyId    = useAuthStore(s => s.companyId)
  const coloredAvats = usePrefStore(s => s.coloredAvatars)
  const toast        = useToast()

  const [members, setMembers]     = useState<TeamMember[]>([])
  const [loading, setLoading]     = useState(true)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviting, setInviting]   = useState(false)
  const [confirmRemove, setConfirmRemove] = useState<TeamMember | null>(null)
  const [removing, setRemoving]   = useState(false)

  useEffect(() => {
    const unsub = subscribeToTeam(
      m => { setMembers(m); setLoading(false) },
      () => setLoading(false),
    )
    return unsub
  }, [companyId])

  async function handleInvite() {
    const email = inviteEmail.trim()
    if (!email) return
    setInviting(true)
    try {
      const { alreadyInvited } = await inviteTeamMember(email)
      if (alreadyInvited) {
        toast(`${email} already has a pending invitation.`, 'info')
      } else {
        toast(`Invitation sent to ${email}.`, 'success')
        setInviteEmail('')
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Invite failed', 'error')
    } finally {
      setInviting(false)
    }
  }

  async function handleRoleChange(member: TeamMember, newRole: Role) {
    try {
      await setMemberRole(member.uid, newRole)
      toast(`${memberDisplayName(member)} is now ${newRole}.`, 'success')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Role update failed', 'error')
    }
  }

  async function handleRemove(member: TeamMember) {
    setRemoving(true)
    try {
      await removeTeamMember(member.uid)
      toast(`${memberDisplayName(member)} removed from team.`, 'success')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Remove failed', 'error')
    } finally {
      setRemoving(false)
      setConfirmRemove(null)
    }
  }

  const isAdmin = role === 'owner' || role === 'admin'

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Team</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            {loading ? '…' : `${members.length} member${members.length !== 1 ? 's' : ''}`}
            {companyId && <span className="text-gray-600 ml-2 font-mono text-xs">· {companyId}</span>}
          </p>
        </div>
      </div>

      {/* Invite (admin/owner only) */}
      {isAdmin && (
        <div className="card p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-3">Invite Member</p>
          <div className="flex gap-2">
            <input
              type="email"
              value={inviteEmail}
              onChange={e => setInviteEmail(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleInvite()}
              placeholder="colleague@example.com"
              className="input-field flex-1 text-sm py-1.5"
            />
            <button
              onClick={handleInvite}
              disabled={inviting || !inviteEmail.trim()}
              className="px-4 py-1.5 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-500 disabled:opacity-40 transition-colors"
            >
              {inviting ? '…' : 'Invite'}
            </button>
          </div>
          <p className="text-xs text-gray-600 mt-2">They'll receive an email with a link to join your company account.</p>
        </div>
      )}

      {/* Member list */}
      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map(i => <div key={i} className="card h-16 animate-pulse" />)}
        </div>
      ) : members.length === 0 ? (
        <div className="card p-12 text-center">
          <p className="text-3xl mb-3">👥</p>
          <p className="text-gray-400 text-sm">No team members found.</p>
          <p className="text-gray-600 text-xs mt-1">Invite colleagues using the form above.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {members.map(m => (
            <MemberCard
              key={m.uid}
              member={m}
              isMe={m.uid === user?.uid}
              myRole={role}
              onRoleChange={handleRoleChange}
              onRemove={setConfirmRemove}
              coloredAvatars={coloredAvats}
            />
          ))}
        </div>
      )}

      {/* Role legend */}
      {members.length > 0 && (
        <div className="card p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-3">Role Permissions</p>
          <div className="space-y-1.5 text-xs text-gray-400">
            <p><span className="text-yellow-300 font-semibold">Owner</span> — full access, cannot be changed by others</p>
            <p><span className="text-indigo-300 font-semibold">Admin</span> — can invite, change roles, and manage team</p>
            <p><span className="text-teal-300 font-semibold">Salesman</span> — full CRM access, no team management</p>
            <p><span className="text-gray-300 font-semibold">Viewer</span> — read-only access to records</p>
          </div>
        </div>
      )}

      {/* Confirm remove modal */}
      {confirmRemove && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 max-w-sm w-full shadow-2xl">
            <p className="text-white font-semibold mb-2">Remove {memberDisplayName(confirmRemove)}?</p>
            <p className="text-sm text-gray-400 mb-5">
              They will lose access to the company account. This can be undone by re-inviting them.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmRemove(null)}
                className="flex-1 btn-secondary py-2 text-sm"
              >
                Cancel
              </button>
              <button
                onClick={() => handleRemove(confirmRemove)}
                disabled={removing}
                className="flex-1 py-2 rounded-xl bg-red-600 text-white text-sm font-semibold hover:bg-red-500 disabled:opacity-40 transition-colors"
              >
                {removing ? 'Removing…' : 'Remove'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
