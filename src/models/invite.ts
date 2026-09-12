import type { Timestamp } from 'firebase/firestore'

/**
 * One invite history from two collections.
 *
 * `/team` writes links to `invites`; `/settings` calls `inviteUser`, which
 * writes to `invitations` and emails a /register link. The Team page's
 * "Invite History" read only the first, so every invite sent by email was
 * absent from the page that claims to list them.
 *
 * Pure on purpose: this is the part worth testing, and importing the service
 * pulls in authStore, which registers a `document` listener at module scope.
 */

export interface InviteLike {
  code: string
  role: string
  createdAt: Timestamp
  expiresAt: Timestamp
  used: boolean
  usedByEmail?: string
  usedByName?: string
  usedAt?: Timestamp
  revoked?: boolean
  revokedAt?: Timestamp
}

export interface EmailInviteLike {
  id: string
  email: string
  status: string
  createdAt: Timestamp | null
}

export type InviteState = 'joined' | 'pending' | 'expired' | 'revoked'

export interface UnifiedInvite {
  key: string
  /** Which path created it, so the row can say so. */
  source: 'link' | 'email'
  role: string | null
  /** Who took it up, or who it was addressed to. */
  who: string | null
  state: InviteState
  /** Sorting and the trailing date. */
  at: Date | null
  /** Only revocable while genuinely outstanding. */
  revocable: boolean
}

function linkState(inv: InviteLike, now: Date): InviteState {
  if (inv.revoked) return 'revoked'
  if (inv.used) return 'joined'
  return inv.expiresAt.toDate() < now ? 'expired' : 'pending'
}

/** Newest first, link and email invites interleaved by date. */
export function unifyInvites(
  links: InviteLike[],
  emails: EmailInviteLike[],
  now: Date = new Date(),
): UnifiedInvite[] {
  const out: UnifiedInvite[] = links.map(inv => {
    const state = linkState(inv, now)
    return {
      key: `link:${inv.code}`,
      source: 'link' as const,
      role: inv.role,
      who: state === 'joined' ? (inv.usedByName || inv.usedByEmail || 'Unknown') : null,
      state,
      at: (state === 'joined' ? inv.usedAt?.toDate() : null)
        ?? inv.revokedAt?.toDate()
        ?? inv.createdAt?.toDate()
        ?? null,
      revocable: state === 'pending',
    }
  })
  for (const inv of emails) {
    const state: InviteState = inv.status === 'accepted' ? 'joined'
      : inv.status === 'revoked' ? 'revoked'
      : 'pending'
    out.push({
      key: `email:${inv.id}`,
      source: 'email',
      // The callable takes no role — it always assigns member.
      role: null,
      who: inv.email || null,
      state,
      at: inv.createdAt?.toDate() ?? null,
      revocable: state === 'pending',
    })
  }
  return out.sort((a, b) => (b.at?.getTime() ?? 0) - (a.at?.getTime() ?? 0))
}
