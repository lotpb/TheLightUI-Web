import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  createInvite, revokeInvite, subscribeToInvites, type InviteRecord,
  subscribeToEmailInvites, revokeEmailInvite, type EmailInviteRecord,
} from '../../services/inviteService'
import { unifyInvites, type UnifiedInvite, type InviteState } from '../../models/invite'
import ConfirmModal from '../../components/ConfirmModal'
import { Icon, ICONS } from '../../components/Icon'
import { useDismissOnOutside } from '../../hooks/useDismissOnOutside'
import { usePageTitle } from '../../hooks/usePageTitle'
import {
  subscribeToTeam, setMemberRole, removeTeamMember,
  memberDisplayName, type TeamMember,
  isSuperAdminEmail, fetchAllCompaniesTeam, callableErrorMessage, deleteOrphanCompany,
  type AllTeamsResult, type CompanyTeamGroup, type AllTeamsMember,
} from '../../services/teamService'
import { useAuthStore } from '../../stores/authStore'
import { useToast } from '../../components/Toast'
import { avatarColor, avatarOriginal } from '../../utils/avatarColor'
import { usePrefStore } from '../../stores/prefStore'

// Always the actual last-seen time, independent of online status, so an
// online member's last-seen value isn't hidden behind an "Online" label.
function lastSeenText(lastSeen: Date | null): string | null {
  if (!lastSeen) return null
  const min = Math.floor((Date.now() - lastSeen.getTime()) / 60000)
  if (min < 1) return 'Just now'
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  return lastSeen.toLocaleDateString()
}

/**
 * One presence string, not three signals.
 *
 * Each row carried a green dot on the avatar, an "Online" pill under the
 * email, and a last-seen timestamp on the right — the dot and the pill saying
 * the same thing twice in a 672px row. The dot stays (it's free, it's on the
 * avatar) and this replaces the pill and the timestamp with one value.
 */
function presenceText(member: { isOnline: boolean; lastSeen: Date | null }): string | null {
  if (member.isOnline) return 'Online now'
  return lastSeenText(member.lastSeen)
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
  const cfg = role ? (ROLE_BADGE[role.toLowerCase()] ?? { label: role, classes: 'bg-gray-700 text-gray-400 border-gray-600/30' }) : null
  if (!cfg) return null
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold border ${cfg.classes}`}>
      {cfg.label}
    </span>
  )
}

/** Pending / joined / expired / revoked, told apart at a glance. */
const INVITE_STATE_CHIP: Record<InviteState, { label: string; classes: string }> = {
  pending: { label: 'Outstanding', classes: 'bg-indigo-500/20 text-indigo-300 border-indigo-600/30' },
  joined:  { label: 'Joined',      classes: 'bg-green-500/15 text-green-300 border-green-600/30' },
  expired: { label: 'Expired',     classes: 'bg-gray-700 text-gray-300 border-gray-600/40' },
  revoked: { label: 'Revoked',     classes: 'bg-red-500/15 text-red-300 border-red-600/30' },
}

function InviteStateChip({ state }: { state: InviteState }) {
  const cfg = INVITE_STATE_CHIP[state]
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold border shrink-0 ${cfg.classes}`}>
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
  menuOpen,
  onToggleMenu,
  onCloseMenu,
}: {
  member: TeamMember
  isMe: boolean
  myRole: string | null
  onRoleChange: (m: TeamMember, role: Role) => void
  onRemove: (m: TeamMember) => void
  coloredAvatars: boolean
  /** Lifted to the page: `showMenu` was per-card, so every member's menu
   *  could be open at once, each holding a "Remove from team". */
  menuOpen: boolean
  onToggleMenu: () => void
  onCloseMenu: () => void
}) {
  const name    = memberDisplayName(member)
  const initials = [member.firstName[0], member.lastName[0]].filter(Boolean).join('').toUpperCase() || name[0]?.toUpperCase() || '?'
  const color   = coloredAvatars ? avatarColor(name) : avatarOriginal()
  const menuRef = useRef<HTMLDivElement>(null)
  // Was `onBlur` on a non-focusable <div>, which never fires: the menu could
  // only be closed by pressing the same button again.
  useDismissOnOutside(menuRef, onCloseMenu, menuOpen)
  const isOwner = member.role === 'owner'
  const manage  = canManage(myRole) && !isMe && !isOwner
  const presence = presenceText(member)

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
          {isMe && <span className="text-xs text-gray-400">(you)</span>}
          {roleBadge(member.role)}
        </div>
        <p className="text-xs text-gray-400 truncate mt-0.5">{member.email}</p>
        <Link
          to={`/employees?q=${encodeURIComponent(member.email)}`}
          className="text-xs text-indigo-400 hover:text-indigo-300 mt-1 inline-flex items-center gap-1 rounded
                     focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        >
          Employee record
          <Icon d={ICONS.arrowRight} className="w-3 h-3" />
        </Link>
      </div>

      {/* One presence value, replacing the dot's duplicate "Online" pill. */}
      {presence && (
        <span className={`text-xs font-medium shrink-0 ${member.isOnline ? 'text-green-400' : 'text-gray-400'}`}>
          {presence}
        </span>
      )}

      {/* Actions (admin/owner only, not self, not other owners) */}
      {manage && (
        <div ref={menuRef} className="relative shrink-0">
          <button
            onClick={onToggleMenu}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label={`Manage ${name}`}
            /* Was text-gray-500 — 3.04:1 on the card — for the only route to
               role changes and removal. */
            className="p-1.5 rounded-lg text-gray-300 hover:text-white hover:bg-gray-700 transition-colors
                       focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            title="Manage member"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.75a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5ZM12 12.75a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5ZM12 18.75a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5Z" />
            </svg>
          </button>
          {menuOpen && (
            <div
              role="menu"
              className="absolute right-0 top-8 z-20 bg-gray-800 border border-gray-700 rounded-xl shadow-xl min-w-40 overflow-hidden"
            >
              <div className="px-3 py-2 border-b border-gray-700/50">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Set Role</p>
              </div>
              {ROLES.filter(r => r !== 'owner').map(r => (
                <button
                  key={r}
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-700 transition-colors capitalize ${member.role === r ? 'text-indigo-400 font-semibold' : 'text-gray-200'}`}
                  role="menuitem"
                  onClick={() => { onRoleChange(member, r); onCloseMenu() }}
                >
                  {r}
                </button>
              ))}
              <div className="border-t border-gray-700/50">
                <button
                  className="w-full text-left px-3 py-2 text-sm text-red-400 hover:bg-gray-700 transition-colors"
                  role="menuitem"
                  onClick={() => { onRemove(member); onCloseMenu() }}
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

// ── All-companies group (super admin) ───────────────────────────────────────────

const GROUP_KIND_BADGE: Record<CompanyTeamGroup['kind'], { label: string; classes: string } | null> = {
  company:     null,
  orphan:      { label: 'Orphaned',   classes: 'bg-amber-500/15 text-amber-300 border-amber-600/30' },
  unassigned:  { label: 'No company', classes: 'bg-gray-700 text-gray-400 border-gray-600/30' },
}

function AllCompanyMemberRow({
  member, myUid, coloredAvatars,
}: {
  member: AllTeamsMember
  myUid: string | undefined
  coloredAvatars: boolean
}) {
  const name = memberDisplayName(member)
  const initials = [member.firstName[0], member.lastName[0]].filter(Boolean).join('').toUpperCase() || name[0]?.toUpperCase() || '?'
  const color = coloredAvatars ? avatarColor(name) : avatarOriginal()
  const badgeRole = member.isOwner ? 'owner' : member.role

  return (
    <div className={`flex items-center gap-3 py-1.5 px-2 ${member.isOwner ? 'rounded-lg ring-1 ring-yellow-500/40 bg-yellow-500/5' : ''}`}>
      <div className="relative shrink-0">
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center overflow-hidden text-xs font-semibold"
          style={{ background: member.profileImageUrl ? undefined : color.bg, color: color.text }}
        >
          {member.profileImageUrl
            ? <img src={member.profileImageUrl} alt={name} className="w-full h-full object-cover" />
            : initials}
        </div>
        {(member.isOnline || member.lastSeen) && (
          <span className={`absolute bottom-0 right-0 block h-2 w-2 rounded-full ring-2 ring-gray-800 ${member.isOnline ? 'bg-green-500' : 'bg-gray-500'}`} />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-medium text-gray-100 truncate">{name}</p>
          {member.uid === myUid && <span className="text-xs text-gray-400">(you)</span>}
          {roleBadge(badgeRole)}
        </div>
        <p className="text-xs text-gray-400 truncate">{member.email}</p>
      </div>
      {presenceText(member) && (
        <span className={`text-xs font-medium shrink-0 ${member.isOnline ? 'text-green-400' : 'text-gray-400'}`}>
          {presenceText(member)}
        </span>
      )}
    </div>
  )
}

function AllCompanyGroup({
  group, myUid, coloredAvatars, onDeleteOrphan,
}: {
  group: CompanyTeamGroup
  myUid: string | undefined
  coloredAvatars: boolean
  onDeleteOrphan: (group: CompanyTeamGroup) => void
}) {
  const kindBadge = GROUP_KIND_BADGE[group.kind]
  return (
    <div className="py-3">
      <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          <p className="text-sm font-semibold text-gray-100 truncate">{group.name}</p>
          {group.companyId && <span className="font-mono text-xs text-gray-400">· {group.companyId}</span>}
          {kindBadge && (
            <span className={`px-2 py-0.5 rounded-full text-xs font-semibold border ${kindBadge.classes}`}>{kindBadge.label}</span>
          )}
          {group.plan && (
            <span className="px-2 py-0.5 rounded-full text-xs bg-gray-700 text-gray-300">{group.plan}</span>
          )}
        </div>
        <span className="text-xs text-gray-400 shrink-0">
          {group.memberCount} member{group.memberCount !== 1 ? 's' : ''}
        </span>
      </div>

      {group.ownerMissing && (
        <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
          <p className="text-xs text-yellow-300">Owner {group.ownerEmail || group.ownerUid} has no user record.</p>
          {group.kind === 'company' && group.memberCount === 0 && (
            <button
              onClick={() => onDeleteOrphan(group)}
              className="text-xs text-red-400 hover:text-red-300 font-semibold shrink-0"
            >
              Delete orphan
            </button>
          )}
        </div>
      )}

      {group.members.length === 0 ? (
        <p className="text-xs text-gray-400">No members</p>
      ) : (
        <div className="space-y-1">
          {group.members.map(m => (
            <AllCompanyMemberRow key={m.uid} member={m} myUid={myUid} coloredAvatars={coloredAvatars} />
          ))}
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
  const [inviteRole, setInviteRole] = useState<string>('salesman')
  const [inviting, setInviting]   = useState(false)
  const [generatedLink, setGeneratedLink] = useState<string | null>(null)
  const [confirmRemove, setConfirmRemove] = useState<TeamMember | null>(null)
  const [removing, setRemoving]   = useState(false)
  const [invites, setInvites]     = useState<InviteRecord[]>([])
  const [emailInvites, setEmailInvites] = useState<EmailInviteRecord[]>([])
  const [showInviteHistory, setShowInviteHistory] = useState(false)
  const [confirmRevoke, setConfirmRevoke] = useState<UnifiedInvite | null>(null)
  const [revoking, setRevoking]   = useState(false)
  const [copyFailed, setCopyFailed] = useState(false)
  /** One open member menu at a time. */
  const [openMenuUid, setOpenMenuUid] = useState<string | null>(null)

  const isAdmin      = role === 'owner' || role === 'admin'
  const isSuperAdmin = isSuperAdminEmail(user?.email)
  const [showAllCompanies, setShowAllCompanies] = useState(false)
  const [allTeams, setAllTeams]     = useState<AllTeamsResult | null>(null)
  const [allLoading, setAllLoading] = useState(false)
  const [allError, setAllError]     = useState<string | null>(null)
  const [confirmDeleteCompany, setConfirmDeleteCompany] = useState<CompanyTeamGroup | null>(null)
  const [deletingCompany, setDeletingCompany] = useState(false)

  useEffect(() => {
    const unsub = subscribeToTeam(
      m => { setMembers(m); setLoading(false) },
      () => setLoading(false),
    )
    return unsub
  }, [companyId])

  useEffect(() => {
    const unsub = subscribeToInvites(setInvites)
    return unsub
  }, [companyId])

  // The other invite path. Reading `invitations` needs the owner/admin rule
  // added alongside this change; a viewer's listener fails and is ignored.
  useEffect(() => {
    if (!isAdmin) return
    const unsub = subscribeToEmailInvites(setEmailInvites, () => setEmailInvites([]))
    return unsub
  }, [companyId, isAdmin])

  const history = useMemo(() => unifyInvites(invites, emailInvites), [invites, emailInvites])
  const pendingCount = history.filter(h => h.state === 'pending').length

  /**
   * Creating the invite and copying it are two different operations, and they
   * shared one try/catch.
   *
   * createInvite writes the doc first. If clipboard.writeText then threw —
   * denied permission, insecure context, Safari outside a user gesture — the
   * same catch fired a red "Failed to generate link", while the link rendered
   * in the box underneath it and a live single-use invite sat in Firestore.
   * The natural response, pressing it again, minted another one.
   */
  async function handleGenerateLink() {
    setInviting(true)
    setGeneratedLink(null)
    setCopyFailed(false)
    let link: string
    try {
      link = await createInvite(inviteRole, user?.email ?? '')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not create the invite', 'error')
      setInviting(false)
      return
    }
    setGeneratedLink(link)
    setInviting(false)
    try {
      await navigator.clipboard.writeText(link)
      toast('Invite link copied to clipboard.', 'success')
    } catch {
      setCopyFailed(true)
      toast('Invite created — copy the link below.', 'success')
    }
  }

  async function handleRevoke(row: UnifiedInvite) {
    setRevoking(true)
    try {
      const id = row.key.slice(row.key.indexOf(':') + 1)
      if (row.source === 'link') await revokeInvite(id)
      else await revokeEmailInvite(id)
      toast('Invite revoked.', 'success')
      setConfirmRevoke(null)
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Revoke failed', 'error')
    } finally {
      setRevoking(false)
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

  async function handleDeleteOrphanCompany(group: CompanyTeamGroup) {
    setDeletingCompany(true)
    try {
      await deleteOrphanCompany(group.companyId)
      toast(`Deleted orphaned company ${group.name || group.companyId}.`, 'success')
      setConfirmDeleteCompany(null)
      await loadAllTeams()
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Delete failed', 'error')
    } finally {
      setDeletingCompany(false)
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

  async function loadAllTeams() {
    if (allLoading) return
    setAllLoading(true)
    setAllError(null)
    try {
      setAllTeams(await fetchAllCompaniesTeam())
    } catch (err) {
      setAllError(callableErrorMessage(err))
    } finally {
      setAllLoading(false)
    }
  }

  function toggleAllCompanies() {
    const next = !showAllCompanies
    setShowAllCompanies(next)
    if (next && !allTeams && !allLoading) void loadAllTeams()
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Team</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            {loading ? '…' : `${members.length} member${members.length !== 1 ? 's' : ''}`}
            {pendingCount > 0 && ` · ${pendingCount} invite${pendingCount !== 1 ? 's' : ''} outstanding`}
          </p>
        </div>
      </div>

      {/* Invite (admin/owner only) */}
      {isAdmin && (
        <div className="card p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">Invite Member</p>
          <div className="flex gap-2">
            <select
              value={inviteRole}
              onChange={e => { setInviteRole(e.target.value); setGeneratedLink(null) }}
              className="input-field text-sm py-1.5 flex-1"
            >
              <option value="salesman">Salesman</option>
              <option value="admin">Admin</option>
              <option value="viewer">Viewer</option>
            </select>
            <button
              onClick={handleGenerateLink}
              disabled={inviting}
              className="px-4 py-1.5 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-500 disabled:opacity-40 transition-colors whitespace-nowrap"
            >
              {/* Was a 🔗 emoji, which can't take the button's colour. */}
              {inviting
                ? 'Creating…'
                : <span className="inline-flex items-center gap-1.5"><Icon d={ICONS.link} className="w-4 h-4" />Copy link</span>}
            </button>
          </div>
          {generatedLink && (
            <div className="mt-3">
              {copyFailed && (
                <p className="text-xs text-yellow-300 mb-1.5 flex items-start gap-1.5">
                  <Icon d={ICONS.warning} className="w-3.5 h-3.5 shrink-0 mt-px" />
                  The invite exists but this browser blocked the clipboard. Copy it by hand.
                </p>
              )}
              <div className="flex items-center gap-2 bg-gray-900 rounded-lg px-3 py-2">
                <p className="text-xs text-gray-300 truncate flex-1 font-mono">{generatedLink}</p>
                <button
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(generatedLink)
                      setCopyFailed(false)
                      toast('Copied.', 'success')
                    } catch {
                      setCopyFailed(true)
                      toast('This browser blocked the clipboard — select the link and copy it.', 'error')
                    }
                  }}
                  className="text-indigo-400 hover:text-indigo-300 text-xs font-semibold shrink-0 rounded px-1 py-0.5
                             focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                >
                  Copy
                </button>
              </div>
            </div>
          )}
          <p className="text-xs text-gray-400 mt-2">Generate a link and share it. Valid for 7 days, single use.</p>
        </div>
      )}

      {/* Both invite paths, with a way to take back the outstanding ones. */}
      {isAdmin && history.length > 0 && (
        <div className="card p-4">
          <button
            onClick={() => setShowInviteHistory(o => !o)}
            aria-expanded={showInviteHistory}
            className="w-full flex items-center justify-between gap-2 rounded
                       focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          >
            <span className="flex items-center gap-2 min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Invite history</p>
              {pendingCount > 0 && (
                <span className="text-xs font-semibold px-1.5 py-0.5 rounded-full bg-indigo-600/20 text-indigo-300 border border-indigo-500/40">
                  {pendingCount} outstanding
                </span>
              )}
            </span>
            <Icon
              d={ICONS.chevronDown}
              className={`w-4 h-4 text-gray-400 shrink-0 transition-transform ${showInviteHistory ? 'rotate-180' : ''}`}
            />
          </button>
          {showInviteHistory && (
            <ul className="mt-3 divide-y divide-gray-700/40">
              {history.map(row => (
                <li key={row.key} className="flex items-center gap-2 py-2 text-sm">
                  {/* Which path it came from. Link invites carry a role;
                      inviteUser takes none and always assigns member. */}
                  <span
                    title={row.source === 'link' ? 'Shared link' : 'Emailed invitation'}
                    className="shrink-0 text-gray-400"
                  >
                    <Icon d={row.source === 'link' ? ICONS.link : ICONS.envelope} className="w-3.5 h-3.5" />
                  </span>
                  <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-gray-700 text-gray-200 capitalize shrink-0">
                    {row.role ?? 'member'}
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    {row.state === 'joined'
                      ? <span className="text-gray-200">Joined by <span className="font-medium">{row.who}</span></span>
                      : row.who
                        ? <span className="text-gray-300">{row.who}</span>
                        : <span className="text-gray-400">Shared link</span>}
                  </span>
                  <InviteStateChip state={row.state} />
                  {row.at && (
                    <span className="text-xs text-gray-400 shrink-0 tabular-nums">
                      {row.at.toLocaleDateString()}
                    </span>
                  )}
                  {row.revocable && (
                    <button
                      onClick={() => setConfirmRevoke(row)}
                      className="text-xs text-red-400 hover:text-red-300 font-semibold shrink-0 rounded px-1.5 py-1
                                 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                    >
                      Revoke
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* All Companies (super admin only) */}
      {isSuperAdmin && (
        <div className="card p-4">
          <button onClick={toggleAllCompanies} className="w-full flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">All Companies (Super Admin)</p>
            <svg
              className={`w-4 h-4 text-gray-400 transition-transform ${showAllCompanies ? 'rotate-180' : ''}`}
              fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
            </svg>
          </button>

          {showAllCompanies && (
            <div className="mt-3">
              {allLoading ? (
                <div className="space-y-2">
                  {/* Stands in for AllCompanyGroup — a header line plus
                      member rows — not a 64px block. */}
                  {[1, 2, 3].map(i => (
                    <div key={i} className="py-3 animate-pulse">
                      <div className="flex items-center gap-2 mb-2">
                        <div className="h-4 w-32 bg-gray-700 rounded" />
                        <div className="h-3 w-20 bg-gray-700/60 rounded" />
                      </div>
                      {[1, 2].map(j => (
                        <div key={j} className="flex items-center gap-3 py-1.5 px-2">
                          <div className="w-8 h-8 rounded-full bg-gray-700 shrink-0" />
                          <div className="flex-1 space-y-1">
                            <div className="h-3.5 w-36 bg-gray-700 rounded" />
                            <div className="h-3 w-44 bg-gray-700/60 rounded" />
                          </div>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              ) : allError ? (
                <div>
                  <p className="text-xs text-red-400 mb-2">{allError}</p>
                  <button onClick={() => void loadAllTeams()} className="text-xs text-indigo-400 hover:text-indigo-300">
                    Try again
                  </button>
                </div>
              ) : allTeams ? (() => {
                const otherGroups = allTeams.groups.filter(g => g.companyId !== companyId)
                const otherMembers = otherGroups.reduce((n, g) => n + g.memberCount, 0)
                return otherGroups.length === 0 ? (
                  <p className="text-xs text-gray-400">No other companies found.</p>
                ) : (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-xs text-gray-400">
                        {otherGroups.length} companies · {otherMembers} members
                        {allTeams.generatedAt && (
                          <span className="text-gray-400"> · as of {allTeams.generatedAt.toLocaleTimeString()}</span>
                        )}
                      </p>
                      <button onClick={() => void loadAllTeams()} className="text-xs text-indigo-400 hover:text-indigo-300">
                        Refresh
                      </button>
                    </div>
                    {allTeams.truncated && (
                      <p className="text-xs text-yellow-300">Results truncated — showing the first companies/members only.</p>
                    )}
                    <div className="divide-y divide-gray-700/50">
                      {otherGroups.map(g => (
                        <AllCompanyGroup
                          key={g.companyId || g.kind}
                          group={g}
                          myUid={user?.uid}
                          coloredAvatars={coloredAvats}
                          onDeleteOrphan={setConfirmDeleteCompany}
                        />
                      ))}
                    </div>
                  </div>
                )
              })() : null}
            </div>
          )}
        </div>
      )}

      {/* Member list */}
      {loading ? (
        /* h-16 against a card that measures ~86px: avatar 40px beside a
           three-line block of name, email and the employee link, inside
           py-3. Three members meant a 60px jump when data landed. */
        <div className="space-y-2">
          {[1, 2, 3].map(i => (
            <div key={i} className="card px-4 py-3 flex items-center gap-3 animate-pulse">
              <div className="w-10 h-10 rounded-full bg-gray-700 shrink-0" />
              <div className="flex-1 min-w-0 space-y-1.5">
                <div className="h-4 w-40 bg-gray-700 rounded" />
                <div className="h-3 w-52 bg-gray-700/60 rounded" />
                <div className="h-3 w-28 bg-gray-700/60 rounded" />
              </div>
              <div className="h-3 w-14 bg-gray-700/60 rounded shrink-0" />
            </div>
          ))}
        </div>
      ) : members.length === 0 ? (
        <div className="card p-12 text-center">
          {/* Was 👥 — emoji paint their own bitmap and ignore `color`. */}
          <Icon d={ICONS.user} className="w-8 h-8 mx-auto mb-3 text-gray-400" />
          <p className="text-gray-300 text-sm">No team members found.</p>
          <p className="text-gray-400 text-xs mt-1">Invite colleagues using the form above.</p>
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
              menuOpen={openMenuUid === m.uid}
              onToggleMenu={() => setOpenMenuUid(cur => cur === m.uid ? null : m.uid)}
              onCloseMenu={() => setOpenMenuUid(null)}
            />
          ))}
        </div>
      )}

      {/* Role legend */}
      {members.length > 0 && (
        <div className="card p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">Role Permissions</p>
          <div className="space-y-1.5 text-xs text-gray-400">
            <p><span className="text-yellow-300 font-semibold">Owner</span> — full access. The role can&rsquo;t be granted or removed from this page, by anyone, including the owner</p>
            <p><span className="text-indigo-300 font-semibold">Admin</span> — can invite, change roles, and manage team</p>
            <p><span className="text-teal-300 font-semibold">Salesman</span> — full CRM access, no team management</p>
            <p><span className="text-gray-200 font-semibold">Viewer</span> — read-only access to records</p>
          </div>
        </div>
      )}

      {/* Were two hand-rolled divs: no role, no aria-modal, no Escape, no
          backdrop dismiss, no autofocus — for this page's destructive
          actions, while ConfirmModal is imported in ten other files. */}
      <ConfirmModal
        isOpen={!!confirmRemove}
        message={confirmRemove
          ? `Remove ${memberDisplayName(confirmRemove)}? They lose access to the company account. You can re-invite them afterwards.`
          : ''}
        confirmLabel={removing ? 'Removing…' : 'Remove'}
        onConfirm={() => { if (confirmRemove) void handleRemove(confirmRemove) }}
        onCancel={() => setConfirmRemove(null)}
      />

      <ConfirmModal
        isOpen={!!confirmRevoke}
        message={confirmRevoke
          ? confirmRevoke.source === 'link'
            ? 'Revoke this invite link? Anyone holding it will no longer be able to join.'
            : `Revoke the invitation to ${confirmRevoke.who}? The emailed link will stop working.`
          : ''}
        confirmLabel={revoking ? 'Revoking…' : 'Revoke'}
        onConfirm={() => { if (confirmRevoke) void handleRevoke(confirmRevoke) }}
        onCancel={() => setConfirmRevoke(null)}
      />

      <ConfirmModal
        isOpen={!!confirmDeleteCompany}
        message={confirmDeleteCompany
          ? `Delete ${confirmDeleteCompany.name || confirmDeleteCompany.companyId}? This permanently deletes the company record. The server re-checks it has zero users and zero customer records first, and refuses otherwise.`
          : ''}
        confirmLabel={deletingCompany ? 'Deleting…' : 'Delete'}
        onConfirm={() => { if (confirmDeleteCompany) void handleDeleteOrphanCompany(confirmDeleteCompany) }}
        onCancel={() => setConfirmDeleteCompany(null)}
      />

    </div>
  )
}
