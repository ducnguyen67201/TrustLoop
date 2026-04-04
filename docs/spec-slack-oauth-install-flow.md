# Slack OAuth Install Flow — Engineering Spec

## 1) Purpose

Define the implementation spec for self-service Slack workspace connection:

1. workspace admin clicks "Connect Slack" in settings UI
2. backend generates HMAC-signed OAuth authorize URL with CSRF state
3. user approves on Slack's consent screen
4. callback exchanges code for bot token via `oauth.v2.access`
5. `SupportInstallation` record is created/updated automatically
6. user is redirected back to settings with success feedback

This replaces the current manual token-copy + DB-insert workflow with a standard OAuth 2.0 install flow.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     Current Flow (Manual / Dev-Only)                    │
│                                                                         │
│  Developer → Slack API Dashboard → Copy signing secret + bot token      │
│           → .env file → psql INSERT INTO SupportInstallation            │
│                                                                         │
│  Problem: Only devs can do it. Not scalable for customers.              │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│                     New Flow (Self-Service OAuth)                        │
│                                                                         │
│                                                                         │
│  ┌──────────┐     ┌──────────────┐     ┌───────────┐     ┌──────────┐  │
│  │ TrustLoop│     │  TrustLoop   │     │   Slack   │     │ TrustLoop│  │
│  │ Settings │     │   Backend    │     │   OAuth   │     │  Backend │  │
│  │   UI     │     │              │     │           │     │          │  │
│  └────┬─────┘     └──────┬───────┘     └─────┬─────┘     └────┬─────┘  │
│       │                  │                   │                │         │
│       │ 1. Click         │                   │                │         │
│       │ "Connect Slack"  │                   │                │         │
│       │─────────────────>│                   │                │         │
│       │                  │                   │                │         │
│       │  2. Generate     │                   │                │         │
│       │  HMAC-signed     │                   │                │         │
│       │  OAuth URL       │                   │                │         │
│       │<─────────────────│                   │                │         │
│       │                  │                   │                │         │
│       │ 3. Browser redirect ────────────────>│                │         │
│       │    (authorize URL with state param)  │                │         │
│       │                  │                   │                │         │
│       │                  │    4. User clicks  │                │         │
│       │                  │       "Allow"      │                │         │
│       │                  │                   │                │         │
│       │                  │   5. Redirect back │                │         │
│       │                  │   with auth code   │                │         │
│       │                  │<──────────────────│                │         │
│       │                  │                   │                │         │
│       │                  │ 6. Verify HMAC state               │         │
│       │                  │ 7. Exchange code ─────────────────>│         │
│       │                  │    for bot token   │  oauth.v2.access        │
│       │                  │<──────────────────────────────────│         │
│       │                  │                   │                │         │
│       │                  │ 8. Upsert SupportInstallation      │         │
│       │                  │    (workspaceId + botToken)         │         │
│       │                  │ 9. Write audit log                 │         │
│       │                  │                   │                │         │
│       │ 10. Redirect to  │                   │                │         │
│       │ settings?slack=  │                   │                │         │
│       │ connected        │                   │                │         │
│       │<─────────────────│                   │                │         │
│       │                  │                   │                │         │
│       │ 11. Show         │                   │                │         │
│       │ "Connected" badge│                   │                │         │
│       │                  │                   │                │         │
│  └──────────┘     └──────────────┘     └───────────┘     └──────────┘  │
│                                                                         │
│  Result: Admin self-serves. No dev needed. Token stored automatically.  │
└─────────────────────────────────────────────────────────────────────────┘
```

## 2) Inputs and Decisions

Core lock-ins:

- Uses existing `SupportInstallation` model — no schema changes required.
- HMAC-signed state parameter for CSRF protection — avoids a DB-backed nonce table.
- Bot scopes: `chat:write`, `channels:history`, `groups:history` (matching current Slack app config).
- ADMIN-only role gate for connect/disconnect, matching the API key management pattern.
- Hybrid API design: tRPC for authenticated queries/mutations, plain HTTP route for the OAuth callback redirect.
- Settings UI follows the existing `api-keys` page pattern with shadcn/ui components.

## 3) Scope

### In scope

- OAuth authorize URL generation with signed state.
- OAuth callback handler (code exchange, installation upsert).
- tRPC procedures for: get OAuth URL, list installations, disconnect.
- Settings → Integrations UI page with connect/disconnect.
- Audit logging for connect and disconnect actions.

### Out of scope (deferred)

- Multi-workspace install (one Slack team → one TrustLoop workspace).
- Token rotation / refresh (Slack bot tokens don't expire).
- OAuth for non-Slack providers (Discord, Teams, email).
- Granular per-channel scope selection UI.

## 4) Environment Variables

Add to `packages/env/src/shared.ts` → `serverSchemas`:

```
SLACK_CLIENT_ID     z.string().min(1).optional()
SLACK_CLIENT_SECRET z.string().min(1).optional()
```

Both optional so non-Slack deployments still validate. Service functions throw `ValidationError` at call time if missing.

Add to `packages/env/src/web.ts` → `runtimeEnv`:

```
SLACK_CLIENT_ID: process.env.SLACK_CLIENT_ID,
SLACK_CLIENT_SECRET: process.env.SLACK_CLIENT_SECRET,
```

Add to `.env.example`:

```
SLACK_CLIENT_ID=your-slack-app-client-id
SLACK_CLIENT_SECRET=your-slack-app-client-secret
```

## 5) Shared Zod Schemas

**New file:** `packages/types/src/support/support-installation.schema.ts`

```ts
// OAuth state payload (internal, never exposed to client)
slackOAuthStatePayloadSchema: {
  workspaceId: z.string(),
  nonce: z.string(),
  expiresAt: z.number(),   // Unix ms
}

// tRPC response for OAuth URL generation
slackOAuthAuthorizeUrlResponseSchema: {
  authorizeUrl: z.string(),
}

// Installation summary for UI display
supportInstallationSummarySchema: {
  id: z.string(),
  provider: z.literal("SLACK"),
  teamId: z.string(),
  teamName: z.string().nullable(),
  botUserId: z.string().nullable(),
  providerInstallationId: z.string(),
  connectedAt: z.string(),    // ISO datetime
}

// List response
supportInstallationListResponseSchema: {
  installations: z.array(supportInstallationSummarySchema),
}

// Disconnect request
supportInstallationDisconnectRequestSchema: {
  installationId: z.string(),
}

// Disconnect response
supportInstallationDisconnectResponseSchema: {
  disconnected: z.literal(true),
}
```

Export from `packages/types/src/support/index.ts`.

## 6) Service Layer

**New file:** `packages/rest/src/services/support/slack-oauth-service.ts`

### 6.1 `generateSlackOAuthUrl(workspaceId: string): string`

- Reads `SLACK_CLIENT_ID` and `APP_BASE_URL` from `@shared/env`.
- Constructs redirect URI: `${APP_BASE_URL}/api/slack/oauth/callback`.
- Builds state payload: `{ workspaceId, nonce: randomBytes(16).hex(), expiresAt: Date.now() + 10min }`.
- Signs state: `base64url(JSON.stringify(payload)) + '.' + hmac_sha256(SESSION_SECRET, payload_b64)`.
- Bot scopes: `chat:write,channels:history,groups:history`.
- Returns: `https://slack.com/oauth/v2/authorize?client_id=...&scope=...&redirect_uri=...&state=...`.

### 6.2 `verifyAndDecodeOAuthState(state: string): { workspaceId: string }`

- Splits on `.`, base64url-decodes payload, verifies HMAC using `SESSION_SECRET`.
- Checks `expiresAt > Date.now()`.
- Returns decoded `workspaceId`.
- Throws `ValidationError` on tampering, expiry, or malformed input.

### 6.3 `exchangeSlackOAuthCode(code: string, redirectUri: string): Promise<SlackOAuthAccessResponse>`

- POST to `https://slack.com/api/oauth.v2.access` with:
  - `client_id`, `client_secret`, `code`, `redirect_uri`
- Parses response: `access_token`, `bot_user_id`, `team.id`, `team.name`, `app_id`.
- Throws `PermanentExternalError` if response `ok: false`.
- Never logs token values.

### 6.4 `completeSlackOAuthInstall(workspaceId: string, oauthResponse: SlackOAuthAccessResponse): Promise<SupportInstallation>`

- `prisma.supportInstallation.upsert`:
  - `where: { provider_providerInstallationId: { provider: 'SLACK', providerInstallationId: oauthResponse.appId } }`
  - `create`: full record with `workspaceId`, `provider: 'SLACK'`, `providerInstallationId`, `teamId`, `botUserId`, `metadata: { botToken, teamName }`
  - `update`: refreshes `teamId`, `botUserId`, `metadata`, `workspaceId`
- Writes audit event: `workspace.slack.connect`.
- Returns created/updated installation.

### 6.5 `listWorkspaceInstallations(workspaceId: string): Promise<SupportInstallationSummary[]>`

- `prisma.supportInstallation.findMany({ where: { workspaceId } })`.
- Maps to summary schema shape, extracting `teamName` from `metadata` JSON.

### 6.6 `disconnectInstallation(workspaceId: string, installationId: string, actorUserId: string): Promise<void>`

- Deletes installation with workspace scope check.
- Writes audit event: `workspace.slack.disconnect`.
- Throws `NOT_FOUND` if no matching record.

## 7) tRPC Router

**New file:** `packages/rest/src/support-installation-router.ts`

Following the `workspace-api-key-router.ts` pattern:

```ts
export const supportInstallationRouter = router({
  getSlackOAuthUrl: workspaceRoleProcedure(WORKSPACE_ROLE.ADMIN)
    .query(({ ctx }) => {
      const authorizeUrl = generateSlackOAuthUrl(ctx.workspaceId);
      return { authorizeUrl };
    }),

  list: workspaceProcedure
    .query(({ ctx }) => {
      return listWorkspaceInstallations(ctx.workspaceId);
    }),

  disconnect: workspaceRoleProcedure(WORKSPACE_ROLE.ADMIN)
    .input(supportInstallationDisconnectRequestSchema)
    .mutation(({ ctx, input }) => {
      return disconnectInstallation(ctx.workspaceId, input.installationId, ctx.user.id);
    }),
});
```

**Wire in:** `packages/rest/src/router.ts` → add `supportInstallation: supportInstallationRouter`.

**Export from:** `packages/rest/src/index.ts`.

## 8) OAuth Callback HTTP Handler

### 8.1 Route handler

**New file:** `apps/web/src/app/api/slack/oauth/callback/route.ts`

```ts
import { handleSlackOAuthCallback } from "@/server/http/rest/support/slack-oauth-callback";

export async function GET(request: Request) {
  return handleSlackOAuthCallback(request);
}
```

### 8.2 Handler implementation

**New file:** `apps/web/src/server/http/rest/support/slack-oauth-callback.ts`

```
1. Parse query params: code, state, error
2. If error param present → redirect to settings/integrations?slack=denied
3. If missing code/state → redirect to settings/integrations?slack=error
4. verifyAndDecodeOAuthState(state) → extract workspaceId
5. exchangeSlackOAuthCode(code, redirectUri)
6. completeSlackOAuthInstall(workspaceId, oauthResponse)
7. Redirect to /${workspaceId}/settings/integrations?slack=connected
8. Catch block → redirect with ?slack=error
```

All errors redirect rather than return JSON — this is a browser flow.

## 9) UI Changes

### 9.1 Workspace paths

**File:** `apps/web/src/lib/workspace-paths.ts`

Add:

```ts
export function workspaceIntegrationsPath(workspaceId: string): string {
  return `${workspaceSettingsPath(workspaceId)}/integrations`;
}
```

### 9.2 Settings layout navigation

**File:** `apps/web/src/app/[workspaceId]/settings/layout.tsx`

Add third nav item:

```ts
{
  href: integrationsPath,
  label: "Integrations",
  icon: RiPlugLine,
  isActive: pathname === integrationsPath,
}
```

Import `workspaceIntegrationsPath` and `RiPlugLine`.

### 9.3 Integrations page

**New file:** `apps/web/src/app/[workspaceId]/settings/integrations/page.tsx`

Following the `api-keys/page.tsx` pattern:

- Uses `useAuthSession` for auth.
- Uses `useSlackInstallation` hook (see 9.5).
- Uses `AsyncDataGuard` for loading/error states.
- Reads `?slack=connected|denied|error` from `useSearchParams()` to show status alerts.
- Renders `SlackConnectionCard` component.
- ADMIN-only connect/disconnect; read-only view for MEMBER role.

### 9.4 Slack connection card component

**New file:** `apps/web/src/components/workspace/slack-connection-card.tsx`

Props: `installations`, `onConnect`, `onDisconnect`, `isConnecting`, `canManage`.

States:

- **Connected:** Badge "Connected", team name, team ID, connected date, Disconnect button (with confirmation dialog).
- **Not connected:** "Connect Slack" button that triggers OAuth redirect.
- **Connecting:** Loading spinner on the button.

Uses shadcn components: `Card`, `CardHeader`, `CardContent`, `Button`, `Badge`, `Dialog`, `Alert`.

### 9.5 Client hook

**New file:** `apps/web/src/hooks/use-slack-installation.ts`

Following `use-workspace-api-keys.ts` pattern:

```ts
- data: installation list response (or null)
- isLoading, error: standard loading states
- refresh(): fetches supportInstallation.list
- connect(): fetches supportInstallation.getSlackOAuthUrl, then window.location.href = authorizeUrl
- disconnect(installationId): calls supportInstallation.disconnect mutation, then refresh()
```

## 10) Slack App Dashboard Configuration

Manual step — must be done before OAuth flow works:

1. Go to Slack app dashboard → **OAuth & Permissions** → **Redirect URLs**.
2. Add: `${APP_BASE_URL}/api/slack/oauth/callback`.
3. For local dev with ngrok: `https://<ngrok-url>/api/slack/oauth/callback`.
4. For production: `https://<prod-domain>/api/slack/oauth/callback`.

## 11) Security Controls

- **CSRF protection:** HMAC-signed state parameter with 10-minute expiry. Uses `SESSION_SECRET` as signing key. Prevents state forgery without a DB nonce table.
- **Role gating:** ADMIN-only for connect/disconnect. Read access for all workspace members.
- **CSRF on mutations:** Disconnect mutation goes through `workspaceRoleProcedure` which enforces `csrfMutationMiddleware`.
- **Token storage:** Bot token stored in `SupportInstallation.metadata` JSON (existing pattern used by `slack-delivery-service.ts`).
- **Token logging:** Never log raw credentials per AGENTS.md rules.
- **Workspace isolation:** All queries scoped by `workspaceId`.
- **Audit trail:** Connect and disconnect actions logged via `writeAuditEvent`.

## 12) Error Handling

| Scenario | Behavior |
|----------|----------|
| User denies on Slack consent | Redirect to `?slack=denied`, show info alert |
| State HMAC tampered | Redirect to `?slack=error`, log warning |
| State expired (>10min) | Redirect to `?slack=error`, show "try again" |
| Slack `oauth.v2.access` fails | Redirect to `?slack=error`, log error details |
| Missing `SLACK_CLIENT_ID` env | `ValidationError` at URL generation time |
| Duplicate install (same Slack team) | Upsert overwrites — one team → one workspace |

All callback errors redirect with query params rather than returning JSON error pages.

## 13) File Layout Summary

### New files

| File | Purpose |
|------|---------|
| `packages/types/src/support/support-installation.schema.ts` | Zod schemas for OAuth + installation |
| `packages/rest/src/services/support/slack-oauth-service.ts` | Core OAuth business logic |
| `packages/rest/src/support-installation-router.ts` | tRPC router for installation management |
| `apps/web/src/app/api/slack/oauth/callback/route.ts` | OAuth callback route (thin wrapper) |
| `apps/web/src/server/http/rest/support/slack-oauth-callback.ts` | OAuth callback handler |
| `apps/web/src/app/[workspaceId]/settings/integrations/page.tsx` | Integrations settings page |
| `apps/web/src/components/workspace/slack-connection-card.tsx` | Slack connection UI card |
| `apps/web/src/hooks/use-slack-installation.ts` | Client hook for installation state |

### Modified files

| File | Change |
|------|--------|
| `packages/env/src/shared.ts` | Add `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET` |
| `packages/env/src/web.ts` | Add to `runtimeEnv` mapping |
| `packages/types/src/support/index.ts` | Re-export installation schemas |
| `packages/rest/src/router.ts` | Wire `supportInstallation` router |
| `packages/rest/src/index.ts` | Export new router |
| `apps/web/src/lib/workspace-paths.ts` | Add `workspaceIntegrationsPath` |
| `apps/web/src/app/[workspaceId]/settings/layout.tsx` | Add Integrations nav item |
| `.env.example` | Add placeholder client ID/secret |

## 14) Implementation Order

| Step | Modules | Depends on | Parallelizable |
|------|---------|------------|----------------|
| 1. Env vars | `packages/env`, `.env.example` | — | Yes |
| 2. Zod schemas | `packages/types` | — | Yes (with Step 1) |
| 3. OAuth service | `packages/rest/src/services/` | Steps 1 + 2 | — |
| 4. tRPC router | `packages/rest/src/` | Step 3 | Yes (with Step 5) |
| 5. Callback handler | `apps/web/src/server/http/`, `apps/web/src/app/api/` | Step 3 | Yes (with Step 4) |
| 6. Workspace paths + layout | `apps/web/src/lib/`, `apps/web/src/app/` | — | Yes (with any) |
| 7. Client hook | `apps/web/src/hooks/` | Step 4 | — |
| 8. UI page + component | `apps/web/src/app/`, `apps/web/src/components/` | Steps 6 + 7 | — |

## 15) Testing Plan

### Unit tests

- `verifyAndDecodeOAuthState`: valid state, tampered HMAC, expired state, malformed input.
- `generateSlackOAuthUrl`: correct URL structure, scopes, state signature.
- Schema validation: all Zod schemas parse/reject correctly.

### Integration tests

- OAuth callback: mock Slack `oauth.v2.access`, verify `SupportInstallation` created.
- tRPC `getSlackOAuthUrl`: verify ADMIN role gate, URL returned.
- tRPC `disconnect`: verify deletion + audit log written.
- tRPC `list`: verify workspace scoping.

### Manual E2E

- Click "Connect Slack" → redirected to Slack → approve → redirected back with "Connected" badge.
- Verify `SupportInstallation` record in DB with correct `botToken` in metadata.
- Send message in Slack channel → verify event ingestion works with the OAuth-provisioned token.
- Click "Disconnect" → confirm dialog → installation removed → Slack events stop processing.

## 16) Definition of Done

- [ ] Environment variables added and validated.
- [ ] Zod schemas defined and exported.
- [ ] OAuth service implemented with HMAC state, code exchange, installation upsert.
- [ ] tRPC router wired with role-gated procedures.
- [ ] OAuth callback route handles success, denial, and error paths.
- [ ] Integrations settings page renders with connect/disconnect.
- [ ] Audit events logged for connect and disconnect.
- [ ] Unit tests for state signing/verification.
- [ ] Integration test for callback → installation creation.
- [ ] Manual E2E validation against real Slack workspace.
- [ ] Slack app dashboard redirect URL configured.

## 17) Next Document

Implementation checklist with file-by-file execution:

- `docs/impl-slack-oauth-install-flow-checklist.md`
