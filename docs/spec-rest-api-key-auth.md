# REST API Key Authentication

Two-layer auth system protecting all exposed REST endpoints.

## Key Formats

| Prefix | Name             | Scope                    | Validation        |
|--------|------------------|--------------------------|-------------------|
| `tli_` | TrustLoop Internal | Service-to-service      | Env var comparison (timing-safe) |
| `tlk_` | TrustLoop Key      | Workspace-scoped (customer) | DB lookup + HMAC verification |

## Auth Guards

Both guards live in `packages/rest/src/security/rest-auth.ts` and work as higher-order functions wrapping Next.js route handlers.

### `withServiceAuth(handler)`

Protects internal endpoints. Validates `Authorization: Bearer tli_...` against the `INTERNAL_SERVICE_KEY` env var using `crypto.timingSafeEqual`.

### `withWorkspaceApiKeyAuth(handler)`

Protects customer-facing endpoints. Extracts `Authorization: Bearer tlk_<prefix>.<secret>`, looks up the key by prefix in `WorkspaceApiKey`, validates expiry/revocation, verifies secret hash via HMAC, updates `lastUsedAt`, and injects `{ workspaceId, keyId }` into the handler context.

## Endpoint Map

### Protected (service key required)

| Endpoint                              | Method | Guard            |
|---------------------------------------|--------|------------------|
| `/api/rest/codex/connect`             | POST   | `withServiceAuth` |
| `/api/rest/codex/feedback`            | POST   | `withServiceAuth` |
| `/api/rest/codex/search`              | POST   | `withServiceAuth` |
| `/api/rest/codex/sync`                | POST   | `withServiceAuth` |
| `/api/rest/codex/pr-intent`           | POST   | `withServiceAuth` |
| `/api/rest/codex/repositories/select` | POST   | `withServiceAuth` |
| `/api/rest/codex/settings`            | GET    | `withServiceAuth` |
| `/api/rest/workflows/dispatch`        | POST   | `withServiceAuth` |

### Unprotected (by design)

| Endpoint                  | Reason                          |
|---------------------------|---------------------------------|
| `/api/health`             | Health check                    |
| `/api/rest/health`        | Health check                    |
| `/api/slack/events`       | Slack signature verification    |
| `/api/slack/oauth/callback` | OAuth flow                   |
| `/api/github/callback`    | OAuth flow                      |
| `/api/trpc/*`             | Own tRPC middleware (session + API key) |

## Error Responses

All auth failures return a tRPC-compatible error shape:

```json
// 401 - missing, invalid, expired, or revoked key
{
  "error": {
    "message": "Invalid or missing API key",
    "code": "UNAUTHORIZED"
  }
}

// 403 - valid key, insufficient permissions (future use)
{
  "error": {
    "message": "Insufficient permissions for this operation",
    "code": "FORBIDDEN"
  }
}
```

## Environment Setup

Add to `.env`:

```bash
# Generate a service key
node -e "console.log('tli_' + require('crypto').randomBytes(40).toString('hex'))"

# Add to .env
INTERNAL_SERVICE_KEY=tli_<generated-value>
```

The `INTERNAL_SERVICE_KEY` is validated at startup via `packages/env/src/shared.ts`. Must start with `tli_` and be at least 20 characters.

## Usage

### Protecting an internal endpoint

```typescript
import { withServiceAuth } from "@shared/rest/security/rest-auth";

export const handleMyEndpoint = withServiceAuth(async (request) => {
  // auth is already validated
  const body = await request.json();
  return NextResponse.json(result);
});
```

### Protecting a customer-facing endpoint

```typescript
import { withWorkspaceApiKeyAuth } from "@shared/rest/security/rest-auth";

export const handleMyEndpoint = withWorkspaceApiKeyAuth(async (request, { workspaceId, keyId }) => {
  // workspace context is resolved from the API key
  return NextResponse.json(result);
});
```

### Calling a protected endpoint

```bash
curl -X POST http://localhost:3000/api/rest/codex/search \
  -H "Authorization: Bearer tli_<your-service-key>" \
  -H "Content-Type: application/json" \
  -d '{"query": "..."}'
```

## Files

| File | Purpose |
|------|---------|
| `packages/rest/src/security/service-key.ts` | Service key generation + validation |
| `packages/rest/src/security/rest-auth.ts` | `withServiceAuth` and `withWorkspaceApiKeyAuth` guards |
| `packages/env/src/shared.ts` | `INTERNAL_SERVICE_KEY` env schema |
