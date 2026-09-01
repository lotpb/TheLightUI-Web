# Firestore rules tests

`firestore.rules` is the only thing standing between one company's data and
another's. These tests exercise it against the real Firestore emulator, so a
rule change that opens a cross-tenant hole fails CI instead of shipping.

## Running

```bash
npm run test:rules
```

That starts the Firestore emulator, runs the suite, and shuts the emulator down.
It needs a JDK on PATH (the emulator is a Java process); nothing else. The
regular `npm test` does **not** include these — it stays emulator-free and fast.

## Layout

| File | Covers |
|---|---|
| `helpers.ts` | Shared identities, emulator setup, rule-bypassing seed helper |
| `companyScoped.test.ts` | The ~35 collections carrying a `companyId` field |
| `docIdScoped.test.ts` | Collections where the document ID *is* the companyId |
| `publicTokens.test.ts` | Customer-facing token links and invites |
| `internal.test.ts` | Credential/index collections no client may touch |
| `users.test.ts` | Profiles, roles, and the mirrored chat collections |

## Fixtures

Two companies and five roles, because every question here is "can A reach B's
data, and does the caller's role matter?"

| Identity | Company | Role |
|---|---|---|
| `ALICE` | A | owner |
| `ADMIN_A` | A | admin |
| `SALES_A` | A | salesman |
| `VIEWER_A` | A | viewer (read-only) |
| `BOB` | B | owner |
| `NOCLAIM` | — | signed in, no `companyId` claim |

Roles live in `users/{uid}` documents rather than token claims, because
`callerRole()` in the rules resolves them with a `get()`. `resetAndSeedUsers()`
re-creates those documents before each test, since `clearFirestore()` wipes them.

## Adding a collection

Most collections just need a row in the `SPECS` table in
`companyScoped.test.ts`; the shared `describe.each` block then asserts the full
matrix (read/list/create/update/delete × owner/viewer/other-company/anonymous)
against it. Reach for a hand-written test only when the rule has a shape the
table doesn't model — a public read path, a token transition, a doc-ID-scoped
owner check.

## Invariants worth preserving

The table-driven assertions encode these; they're spelled out here because the
rules file repeats the same block ~40 times and it's easy to paste a subtly
weaker copy:

- **`list` must constrain `companyId`.** `allow list: if hasCompanyId()` alone
  lets any authenticated user enumerate every company's records.
- **`update` must pin `request.resource.data.companyId`, not just
  `resource.data.companyId`.** Checking only the existing document lets a member
  move a record into another company.
- **Combined `allow update, delete` can't check `request.resource`** (a delete
  has none), so split the two when the update needs that constraint.
- **Public write paths must bound their affected keys.** `publicProposals`,
  `signingRequests`, and `invites` all accept writes from callers who aren't
  team members; each uses `affectedKeys().hasOnly(...)` to keep a narrow
  status/consumption transition from becoming an arbitrary edit.
