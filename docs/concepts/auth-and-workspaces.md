---
summary: "Google OAuth, workspace auto-join, role hierarchy, and the three auth surfaces (tli_ / tlk_ / operator session)"
read_when:
  - Working on sign-in, workspace provisioning, or membership roles
  - Adding or changing API key auth (tli_ or tlk_)
  - Touching tRPC context, CSRF, or session handling
  - Adding a new OAuth provider or auth path
title: "Auth and Workspaces"
---

# Auth and Workspaces

How a user becomes an authenticated operator inside a workspace, and how the three different auth surfaces (operator / internal service / customer API key) stay separated.

## Three auth surfaces

| Surface | Key prefix | Used by | Guard | Validated against |
|---------|-----------|---------|-------|-------------------|
| Operator session | — (session cookie) | Human operators in the UI | Next.js middleware + tRPC context | Session table (via NextAuth-style adapter) |
| Internal service | `tli_` | queue, agents, admin tooling | `withServiceAuth` | `INTERNAL_SERVICE_KEY` env var (timing-safe compare, no DB) |
| Workspace API key | `tlk_` | Browser SDK + customer integrations | `withWorkspaceApiKeyAuth` | `WorkspaceApiKey` table (HMAC hash compare) |

Auth guards: `packages/rest/src/security/rest-auth.ts`. Classification rules in root `AGENTS.md` → "REST API Classification."

## Operator sign-in (Google OAuth)

Production auth flow for humans. Deliberately narrow — Google OAuth is the only path today.

### Authorize request

- `packages/rest/src/services/auth/google-oauth/authorize.ts:26-51`
- Builds a PKCE-protected authorization URL:
  - `code_challenge_method: S256`
  - `code_verifier` stored server-side, hashed into `code_challenge`
  - `prompt: select_account` — forces the user to choose between personal and work Google accounts
  - `nonce` generated per-request, stored in a short-lived cookie, validated against the returned `id_token`

### Callback + token exchange

- `packages/rest/src/services/auth/google-oauth/token.ts` — POSTs `code + code_verifier` to Google's token endpoint
- `packages/rest/src/services/auth/google-oauth/verify.ts:1-60` — validates the returned `id_token`:
  - Uses `jose` against Google's JWKS (with rotation support)
  - Enforces `aud === GOOGLE_OAUTH_CLIENT_ID`
  - Accepts issuer as both `accounts.google.com` and `https://accounts.google.com`
  - Matches the stored `nonce` (CSRF protection)
  - Requires `email_verified === true` — **critical gate** for workspace auto-join downstream

### What the route receives

A verified `{ email, name, emailVerified, sub }` that becomes an `AuthIdentity` row. If the user is new to TrustLoop, the identity is created; if they've signed in before, the existing identity is updated.

## Workspace auto-join

Once a user has a verified Google identity, they need a workspace. Logic: `packages/rest/src/services/auth/workspace-auto-join-service.ts:1-208`.

### The algorithm

```
resolveFromVerifiedEmail({ email, emailVerified }):
  1. if !emailVerified → throw (should have been caught earlier)
  2. extract domain from email
  3. if domain in PERSONAL_EMAIL_DOMAINS → return null (land at /no-workspace)
  4. workspace = workspace.findByEmailDomain(domain)
  5. if workspace → ensureMembership(userId, workspaceId)
                 → return workspace
  6. else → return null (land at /no-workspace, "Contact us to provision")
```

### Personal-email reject list

- 22 domains hardcoded: `gmail.com`, `outlook.com`, `yahoo.com`, `proton.me`, `icloud.com`, etc.
- Prevents users with personal emails from spawning phantom workspaces or attaching to existing ones
- The reject list is a policy choice at the caller, not a DB check — see `AGENTS.md` → Service Layer Conventions ("Policy lives at the caller")

### `ensureMembership`

The race-sensitive part:

- Explicit `findFirst → update | create` instead of `prisma.upsert()`
- Why: the `workspaceMembership` table has a partial unique index `(workspaceId, userId) WHERE deletedAt IS NULL`. Prisma's `upsert()` can't target partial indexes. A concurrent request from the same user in two tabs can both see "no membership" and both try to create.
- Fallback: catch `P2002` unique-constraint error from Prisma, retry the `findFirst` once. Two-attempt max.

### What if the user has no matching workspace?

They land at `/no-workspace` with a "Contact us" message. TrustLoop team manually provisions the workspace by setting `Workspace.emailDomain`. This is deliberate for pilot — forces human first contact, prevents domain squatting, and keeps the surface minimal.

Self-serve workspace creation is flagged as P2 in `TODOS.md` for when this becomes a bottleneck.

## Membership + roles

- Roles: `OWNER` (rank 3) > `ADMIN` (rank 2) > `MEMBER` (rank 1)
- Defined as a const enum in shared types (imported as `WORKSPACE_ROLE`)
- Helpers in `packages/rest/src/services/auth/rbac.ts:1-60`:
  - `hasRequiredRole(actual, required)` — role hierarchy check
  - `canAssignWorkspaceRole(actor, targetRole)` — MEMBER can't assign anything; OWNER assignment requires existing OWNER
  - `canManageWorkspaceMember(actor, targetMember)` — ADMIN can only manage MEMBERs; OWNERs manage everyone

The first user from a new email domain becomes OWNER (today via manual provisioning; future: via self-serve flow).

## tRPC context + middlewares

- `packages/rest/src/context.ts:1-100`
- `TRPCContext` shape:
  ```ts
  {
    user: User | null,
    session: Session | null,
    activeWorkspaceId: string | null,
    role: WorkspaceRole | null,
    apiKeyAuth: { workspaceId, keyId } | null,  // populated only on API key paths
  }
  ```
- `resolveWorkspaceContext(session)` loads the user's memberships, picks the active workspace (cookie-pinned) or falls back to the first, sets `role` accordingly
- Middlewares:
  - `authenticatedUserMiddleware` — requires `session && user`, otherwise throws `UNAUTHORIZED`
  - `csrfMutationMiddleware` — validates CSRF token on all mutations
  - Role-gated middlewares (e.g. `adminOnlyMiddleware`) wrap the above and call `hasRequiredRole`

## API keys: the two prefixes

### `tli_` — internal service key

- One secret, held by `apps/queue` and `apps/agents`
- Validated in `withServiceAuth` via timing-safe string compare against `INTERNAL_SERVICE_KEY` env var
- No DB lookup — fast and deterministic
- Used for: queue → web REST calls, agents → web REST calls, admin scripts

### `tlk_` — workspace API key

- Issued per workspace (can have multiple active keys per workspace, e.g. for SDK rotation)
- Stored in `WorkspaceApiKey` table with:
  - HMAC hash of the secret portion (never the plaintext)
  - `revokedAt`, `expiresAt` for lifecycle
  - `lastUsedAt` with 60-second debounce (don't hammer the DB on every request)
- Validated in `withWorkspaceApiKeyAuth`:
  1. Parse `tlk_<keyId>_<secret>` format
  2. Look up `WorkspaceApiKey` by `keyId`, check not revoked / expired
  3. Compute HMAC of presented secret, compare to stored hash (timing-safe)
  4. Debounced `lastUsedAt` update
  5. Inject `{ workspaceId, keyId }` into request context

Used for: Browser SDK session ingest, customer webhook endpoints, future customer integrations.

## Session + cookie handling

- HTTP-only, SameSite=Lax cookies
- Session table has `expiresAt`, refreshed on activity
- Sign-out: explicit POST to `/api/auth/signout` — nukes the session row and clears the cookie

## Hosted domain (`hd`) restriction — NOT implemented

Flagged as P3 in `TODOS.md`. Would let a workspace admin restrict Google sign-in to a specific `hd` domain (e.g. "only @acme.com Google Workspace accounts"). Implementation path:
- Add `hostedDomain String?` to `Workspace`
- Pass `hd` on the Google authorization URL
- Verify the `hd` claim on the returned `id_token`
- Reject with a clear error if mismatched

Not urgent — no customer has asked.

## Invariants

- **Workspace auto-join requires `email_verified === true` from Google.** Unverified emails never attach to a workspace. No "trust the header" bypass.
- **Personal email domains (gmail, outlook, yahoo, proton, icloud, etc.) are rejected at the caller** before any DB lookup. They never spawn or attach to a workspace.
- **`tli_` and `tlk_` keys validate through different guards.** `withServiceAuth` (tli_, env-var compare) is for internal traffic only. `withWorkspaceApiKeyAuth` (tlk_, DB + HMAC) is for customer traffic. Using the wrong guard on an endpoint is a security bug.
- **`ensureMembership` uses explicit find-then-create, not Prisma `upsert`.** The partial unique index `(workspaceId, userId) WHERE deletedAt IS NULL` cannot be targeted by upsert.
- **Google OAuth uses PKCE (S256), nonce, and `prompt=select_account`.** Removing any of these weakens auth. PKCE protects against intercepted codes, nonce protects against CSRF, and `select_account` prevents silent sign-in with the wrong Google account.
- **`id_token` verification always uses the current JWKS** (rotates automatically via `jose`). Never hardcode a public key.
- **Session cookies are HTTP-only + SameSite=Lax.** Never readable from client-side JS.

## Related concepts

- `architecture.md` → "Authentication surfaces" for the big picture
- `session-replay-capture.md` — how `tlk_` keys are used by the browser SDK
- `docs/conventions/spec-rest-api-key-auth.md` — full spec on the two auth guards

## Keep this doc honest

Update when you:
- Add a new OAuth provider (Microsoft, GitHub, etc.)
- Change the personal-email reject list
- Change the role hierarchy or add a new role
- Implement `hd` restriction
- Add SAML / SCIM (would be a new concept doc)
- Change the `tlk_` / `tli_` key format or validation
- Add an alternate sign-in path (magic link, etc.)
