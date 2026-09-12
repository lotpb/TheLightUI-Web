import { describe, it, expect } from 'vitest'
import { Timestamp } from 'firebase/firestore'
import { unifyInvites, type InviteLike, type EmailInviteLike } from '../models/invite'

const NOW = new Date('2026-09-11T12:00:00Z')
const ts = (iso: string) => Timestamp.fromDate(new Date(iso))

function link(over: Partial<InviteLike> = {}): InviteLike {
    return {
        code: 'ABC123',
        role: 'salesman',
        createdAt: ts('2026-09-10T12:00:00Z'),
        expiresAt: ts('2026-09-17T12:00:00Z'),
        used: false,
        revoked: false,
        ...over,
    }
}

function email(over: Partial<EmailInviteLike> = {}): EmailInviteLike {
    return {
        id: 'e1',
        email: 'new@x.com',
        status: 'pending',
        createdAt: ts('2026-09-09T12:00:00Z'),
        ...over,
    }
}

describe('unifyInvites — both paths in one history', () => {
    // Invite History read `invites` only, so every invite sent by email from
    // Settings was absent from the page that claims to list them.
    it('includes email invites alongside link invites', () => {
        const rows = unifyInvites([link()], [email()], NOW)
        expect(rows.map(r => r.source)).toEqual(['link', 'email'])
    })

    it('sorts newest first across both sources', () => {
        const rows = unifyInvites(
            [link({ code: 'OLD', createdAt: ts('2026-09-01T00:00:00Z') })],
            [email({ id: 'NEW', createdAt: ts('2026-09-10T00:00:00Z') })],
            NOW,
        )
        expect(rows.map(r => r.key)).toEqual(['email:NEW', 'link:OLD'])
    })

    it('puts undated rows last rather than first', () => {
        const rows = unifyInvites([link()], [email({ id: 'nodate', createdAt: null })], NOW)
        expect(rows[rows.length - 1].key).toBe('email:nodate')
    })
})

describe('unifyInvites — link states', () => {
    it('is pending while unused and in date', () => {
        const [row] = unifyInvites([link()], [], NOW)
        expect(row).toMatchObject({ state: 'pending', revocable: true, who: null })
    })

    it('is expired past its expiry', () => {
        const [row] = unifyInvites([link({ expiresAt: ts('2026-09-01T00:00:00Z') })], [], NOW)
        expect(row).toMatchObject({ state: 'expired', revocable: false })
    })

    it('is joined once used, and names who took it', () => {
        const [row] = unifyInvites([link({
            used: true, usedByName: 'Ann Lee', usedAt: ts('2026-09-10T15:00:00Z'),
        })], [], NOW)
        expect(row).toMatchObject({ state: 'joined', who: 'Ann Lee', revocable: false })
        expect(row.at?.toISOString()).toBe('2026-09-10T15:00:00.000Z')
    })

    it('falls back to the email, then to Unknown, for who joined', () => {
        expect(unifyInvites([link({ used: true, usedByEmail: 'a@x.com' })], [], NOW)[0].who).toBe('a@x.com')
        expect(unifyInvites([link({ used: true })], [], NOW)[0].who).toBe('Unknown')
    })

    it('reads as revoked, not used, once cancelled', () => {
        // Revocation is a flag, so the history keeps the record instead of the
        // row vanishing.
        const [row] = unifyInvites([link({ revoked: true, revokedAt: ts('2026-09-11T09:00:00Z') })], [], NOW)
        expect(row).toMatchObject({ state: 'revoked', revocable: false })
        expect(row.at?.toISOString()).toBe('2026-09-11T09:00:00.000Z')
    })

    it('shows revoked even if the link had also expired', () => {
        const [row] = unifyInvites(
            [link({ revoked: true, expiresAt: ts('2026-09-01T00:00:00Z') })], [], NOW)
        expect(row.state).toBe('revoked')
    })

    it('never offers to revoke something already settled', () => {
        const rows = unifyInvites([
            link({ code: 'a', used: true }),
            link({ code: 'b', revoked: true }),
            link({ code: 'c', expiresAt: ts('2026-01-01T00:00:00Z') }),
        ], [], NOW)
        expect(rows.every(r => !r.revocable)).toBe(true)
    })
})

describe('unifyInvites — email states', () => {
    it('maps the callable statuses', () => {
        const states = ['pending', 'accepted', 'revoked'].map(
            status => unifyInvites([], [email({ status })], NOW)[0].state)
        expect(states).toEqual(['pending', 'joined', 'revoked'])
    })

    it('treats an unrecognised status as pending rather than hiding the row', () => {
        expect(unifyInvites([], [email({ status: 'sent' })], NOW)[0].state).toBe('pending')
    })

    it('reports no role, because inviteUser always assigns member', () => {
        expect(unifyInvites([], [email()], NOW)[0].role).toBeNull()
    })

    it('shows the address it was sent to', () => {
        expect(unifyInvites([], [email({ email: 'new@x.com' })], NOW)[0].who).toBe('new@x.com')
    })
})

describe('unifyInvites — empty', () => {
    it('returns nothing for nothing', () => {
        expect(unifyInvites([], [], NOW)).toEqual([])
    })
})
