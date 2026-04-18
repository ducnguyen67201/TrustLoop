# Soft Delete Strategy — Engineering Spec

**Status:** Draft
**Date:** 2026-04-01
**Scope:** All models in `packages/database/prisma/schema.prisma`

---

## 1. Problem Statement

The codebase currently uses hard deletes exclusively. This causes:

1. **Data loss** — Deleting a Slack installation cascades to all conversations, events, delivery attempts, and ticket links. No recovery possible.
2. **Unique constraint collisions** — Removing a workspace member then re-adding them fails at `@@unique([workspaceId, userId])` if any intermediate state exists. Disconnecting and reconnecting Slack hits `@@unique([provider, providerInstallationId])`.
3. **No audit trail for deletions** — We log `workspace.member.remove` and `workspace.slack.disconnect` in AuditLog, but the actual records vanish.
4. **Cascade destruction** — `onDelete: Cascade` across 18 relationships means one delete can wipe 10+ tables.

We're early enough that fixing this now avoids a painful migration later with real customer data.

---

## 2. Design Decisions

### 2.1 `deletedAt DateTime?` (not a boolean)

- `NULL` = active, non-null = soft-deleted with timestamp
- Gives audit info for free (when was it deleted?)
- Standard pattern across the industry
- Aligns with existing `revokedAt` on `WorkspaceApiKey`

### 2.2 Prisma Client Extension for auto-filtering

Use a Prisma Client extension (not middleware — middleware is deprecated in Prisma 7) to automatically inject `deletedAt: null` into all `findMany`, `findFirst`, `findUnique`, `count`, `aggregate`, and `groupBy` operations for soft-delete-enabled models.

Provide an explicit escape hatch: `{ includeDeleted: true }` in query args for admin/audit queries.

### 2.3 Partial unique indexes for constraint safety

PostgreSQL supports `CREATE UNIQUE INDEX ... WHERE deleted_at IS NULL`. This ensures:
- Active records maintain uniqueness
- Soft-deleted records don't block new records with the same unique key
- Multiple soft-deleted records with the same key can coexist

Prisma doesn't support partial indexes in schema DSL — use raw SQL in migrations.

### 2.4 Cascade soft delete (not cascade hard delete)

Replace `onDelete: Cascade` with `onDelete: Restrict` on soft-deletable models. Implement cascade soft delete in application code via a shared service.

---

## 3. Model Classification

### Tier 1: Soft Delete (add `deletedAt`)

| Model | Unique Constraints Affected | Cascade Children |
|---|---|---|
| **User** | `email` | Sessions (hard delete), Memberships, ApiKeys |
| **Workspace** | none | All workspace-scoped children |
| **WorkspaceMembership** | `(workspaceId, userId)` | none |
| **WorkspaceApiKey** | `keyPrefix` | none (already has `revokedAt`) |
| **SupportInstallation** | `(provider, providerInstallationId)` | IngressEvents, Conversations |
| **SupportConversation** | `(workspaceId, canonicalConversationKey)` | Events, DeliveryAttempts, TicketLinks |
| **SupportDeliveryAttempt** | none | none |
| **SupportTicketLink** | `(workspaceId, provider, externalTicketId)` | none |

### Tier 2: Hard Delete (keep as-is)

| Model | Reason |
|---|---|
| **Session** | Ephemeral, security-sensitive. Expired/logged-out sessions should be gone. |
| **SupportIngressEvent** | Idempotency record keyed by `canonicalIdempotencyKey`. Must remain for dedup. Never user-deleted. |

### Tier 3: Never Delete (append-only)

| Model | Reason |
|---|---|
| **AuditLog** | Compliance/audit trail. Append-only by design. Already uses `SetNull` for parent refs. |
| **SupportConversationEvent** | Immutable event log. Cascade soft delete with parent conversation (filter by conversation's `deletedAt`). |
| **SupportDeadLetter** | Operational record. Already has `resolvedAt`. Cleanup via TTL/cron, not user action. |

---

## 4. Schema Changes

### 4.1 Add `deletedAt` field to Tier 1 models

```prisma
model User {
  // ... existing fields ...
  deletedAt DateTime?
  // ... relations ...
  @@index([deletedAt])
}

model Workspace {
  deletedAt DateTime?
  @@index([deletedAt])
}

model WorkspaceMembership {
  deletedAt DateTime?
  @@index([deletedAt])
}

model WorkspaceApiKey {
  deletedAt DateTime?
  // Note: already has revokedAt — deletedAt means the record itself is logically removed
  @@index([deletedAt])
}

model SupportInstallation {
  deletedAt DateTime?
  @@index([deletedAt])
}

model SupportConversation {
  deletedAt DateTime?
  @@index([deletedAt])
}

model SupportDeliveryAttempt {
  deletedAt DateTime?
  @@index([deletedAt])
}

model SupportTicketLink {
  deletedAt DateTime?
  @@index([deletedAt])
}
```

### 4.2 Partial unique indexes (raw SQL in migration)

Drop the existing unique constraints and replace with partial unique indexes:

```sql
-- User.email: allow re-registration of deleted accounts
DROP INDEX IF EXISTS "User_email_key";
CREATE UNIQUE INDEX "User_email_key" ON "User" ("email") WHERE "deletedAt" IS NULL;

-- WorkspaceMembership: allow re-adding removed members
DROP INDEX IF EXISTS "WorkspaceMembership_workspaceId_userId_key";
CREATE UNIQUE INDEX "WorkspaceMembership_workspaceId_userId_key"
  ON "WorkspaceMembership" ("workspaceId", "userId") WHERE "deletedAt" IS NULL;

-- SupportInstallation: allow reconnecting same provider
DROP INDEX IF EXISTS "SupportInstallation_provider_providerInstallationId_key";
CREATE UNIQUE INDEX "SupportInstallation_provider_providerInstallationId_key"
  ON "SupportInstallation" ("provider", "providerInstallationId") WHERE "deletedAt" IS NULL;

-- SupportConversation: allow new conversation with same canonical key
DROP INDEX IF EXISTS "SupportConversation_workspaceId_canonicalConversationKey_key";
CREATE UNIQUE INDEX "SupportConversation_workspaceId_canonicalConversationKey_key"
  ON "SupportConversation" ("workspaceId", "canonicalConversationKey") WHERE "deletedAt" IS NULL;

-- SupportTicketLink: allow re-linking same ticket
DROP INDEX IF EXISTS "SupportTicketLink_workspaceId_provider_externalTicketId_key";
CREATE UNIQUE INDEX "SupportTicketLink_workspaceId_provider_externalTicketId_key"
  ON "SupportTicketLink" ("workspaceId", "provider", "externalTicketId") WHERE "deletedAt" IS NULL;

-- WorkspaceApiKey.keyPrefix is random/unique by generation — partial index optional
-- but adding for consistency
DROP INDEX IF EXISTS "WorkspaceApiKey_keyPrefix_key";
CREATE UNIQUE INDEX "WorkspaceApiKey_keyPrefix_key"
  ON "WorkspaceApiKey" ("keyPrefix") WHERE "deletedAt" IS NULL;
```

### 4.3 Update composite indexes to include `deletedAt`

For query performance, prepend `deletedAt` to frequently-filtered composite indexes:

```sql
-- SupportConversation inbox query (most critical)
DROP INDEX IF EXISTS "SupportConversation_workspaceId_status_staleAt_customerWaitin_idx";
CREATE INDEX "SupportConversation_inbox_idx"
  ON "SupportConversation" ("workspaceId", "status", "staleAt", "customerWaitingSince", "retryCount", "lastActivityAt")
  WHERE "deletedAt" IS NULL;

-- WorkspaceApiKey active keys
DROP INDEX IF EXISTS "WorkspaceApiKey_workspaceId_revokedAt_expiresAt_idx";
CREATE INDEX "WorkspaceApiKey_active_idx"
  ON "WorkspaceApiKey" ("workspaceId", "revokedAt", "expiresAt")
  WHERE "deletedAt" IS NULL;
```

### 4.4 Change cascade rules on soft-deletable models

Change `onDelete: Cascade` to `onDelete: Restrict` for relationships where the parent is soft-deletable. Application code handles cascade soft delete.

**Keep `onDelete: Cascade` for:**
- `Session.userId` → User (hard delete sessions when user soft-deleted, via application)
- `SupportIngressEvent.installationId` → SupportInstallation (ingress events follow installation lifecycle)

**Change to `onDelete: Restrict`:**
- All Workspace → child relationships (cascade soft delete in app code)
- SupportInstallation → SupportConversation (cascade soft delete)
- SupportConversation → Events, DeliveryAttempts, TicketLinks (cascade soft delete)

---

## 5. Prisma Client Extension

Create `packages/database/src/soft-delete.ts`:

```typescript
import { Prisma } from "@shared/database/generated/prisma/client";

/**
 * Models that support soft delete via `deletedAt` field.
 * Used by the Prisma extension to auto-filter queries.
 */
const SOFT_DELETE_MODELS = [
  "User",
  "Workspace",
  "WorkspaceMembership",
  "WorkspaceApiKey",
  "SupportInstallation",
  "SupportConversation",
  "SupportDeliveryAttempt",
  "SupportTicketLink",
] as const;

type SoftDeleteModel = (typeof SOFT_DELETE_MODELS)[number];

function isSoftDeleteModel(model: string): model is SoftDeleteModel {
  return SOFT_DELETE_MODELS.includes(model as SoftDeleteModel);
}

/**
 * Prisma Client extension that:
 * 1. Auto-injects `deletedAt: null` filter on read queries (unless includeDeleted: true)
 * 2. Converts `delete` to `update { deletedAt: now() }` for soft-delete models
 * 3. Converts `deleteMany` to `updateMany { deletedAt: now() }` for soft-delete models
 */
export const softDeleteExtension = Prisma.defineExtension({
  name: "soft-delete",
  query: {
    $allModels: {
      async findFirst({ model, args, query }) {
        if (isSoftDeleteModel(model) && !args.includeDeleted) {
          args.where = { ...args.where, deletedAt: null };
        }
        return query(args);
      },
      async findMany({ model, args, query }) {
        if (isSoftDeleteModel(model) && !args.includeDeleted) {
          args.where = { ...args.where, deletedAt: null };
        }
        return query(args);
      },
      async findUnique({ model, args, query }) {
        if (isSoftDeleteModel(model) && !args.includeDeleted) {
          // findUnique doesn't support arbitrary where — convert to findFirst
          args.where = { ...args.where, deletedAt: null };
        }
        return query(args);
      },
      async count({ model, args, query }) {
        if (isSoftDeleteModel(model) && !args.includeDeleted) {
          args.where = { ...args.where, deletedAt: null };
        }
        return query(args);
      },
      async delete({ model, args, query }) {
        if (isSoftDeleteModel(model)) {
          // Convert hard delete to soft delete
          return (prisma as any)[model].update({
            where: args.where,
            data: { deletedAt: new Date() },
          });
        }
        return query(args);
      },
      async deleteMany({ model, args, query }) {
        if (isSoftDeleteModel(model)) {
          return (prisma as any)[model].updateMany({
            where: args.where,
            data: { deletedAt: new Date() },
          });
        }
        return query(args);
      },
    },
  },
});
```

Apply in `packages/database/src/index.ts`:

```typescript
import { softDeleteExtension } from "./soft-delete";

// ... existing code ...

export const prisma = (globalForPrisma.prisma ?? createPrismaClient())
  .$extends(softDeleteExtension);
```

---

## 6. Application Code Changes

### 6.1 Delete operations → now automatic

With the extension, existing `.delete()` and `.deleteMany()` calls automatically become soft deletes for Tier 1 models. No code changes needed for:

- `packages/rest/src/security/session.ts:154` — Session is Tier 2 (hard delete), no change
- `packages/rest/src/workspace-router.ts:300` — WorkspaceMembership `.delete()` auto-converts
- `packages/rest/src/services/support/slack-oauth-service.ts:267` — SupportInstallation `.deleteMany()` auto-converts

### 6.2 Cascade soft delete service

Create `packages/rest/src/services/soft-delete-cascade.ts` to handle cascading:

```typescript
/**
 * Cascade soft delete for parent-child relationships.
 * Called after soft-deleting a parent record.
 */
export async function cascadeSoftDeleteWorkspace(workspaceId: string, tx: PrismaTransaction) {
  const now = new Date();
  await Promise.all([
    tx.workspaceMembership.updateMany({ where: { workspaceId, deletedAt: null }, data: { deletedAt: now } }),
    tx.workspaceApiKey.updateMany({ where: { workspaceId, deletedAt: null }, data: { deletedAt: now } }),
    tx.supportInstallation.updateMany({ where: { workspaceId, deletedAt: null }, data: { deletedAt: now } }),
    tx.supportConversation.updateMany({ where: { workspaceId, deletedAt: null }, data: { deletedAt: now } }),
    tx.supportDeliveryAttempt.updateMany({ where: { workspaceId, deletedAt: null }, data: { deletedAt: now } }),
    tx.supportTicketLink.updateMany({ where: { workspaceId, deletedAt: null }, data: { deletedAt: now } }),
  ]);
}

export async function cascadeSoftDeleteInstallation(installationId: string, workspaceId: string, tx: PrismaTransaction) {
  const now = new Date();
  // Soft delete conversations and their children
  const conversations = await tx.supportConversation.findMany({
    where: { installationId, workspaceId, deletedAt: null },
    select: { id: true },
  });
  const conversationIds = conversations.map((c) => c.id);

  await Promise.all([
    tx.supportConversation.updateMany({ where: { installationId, workspaceId, deletedAt: null }, data: { deletedAt: now } }),
    tx.supportDeliveryAttempt.updateMany({ where: { conversationId: { in: conversationIds }, deletedAt: null }, data: { deletedAt: now } }),
    tx.supportTicketLink.updateMany({ where: { conversationId: { in: conversationIds }, deletedAt: null }, data: { deletedAt: now } }),
  ]);
}

export async function cascadeSoftDeleteConversation(conversationId: string, tx: PrismaTransaction) {
  const now = new Date();
  await Promise.all([
    tx.supportDeliveryAttempt.updateMany({ where: { conversationId, deletedAt: null }, data: { deletedAt: now } }),
    tx.supportTicketLink.updateMany({ where: { conversationId, deletedAt: null }, data: { deletedAt: now } }),
  ]);
}
```

### 6.3 Upsert operations — handle "resurrect" pattern

When upserting on a unique key that might match a soft-deleted record:

**SupportInstallation upsert** (`slack-oauth-service.ts:189-216`):
```typescript
// Before: prisma.supportInstallation.upsert({ where: { provider_providerInstallationId: ... } })
// After: Check for soft-deleted record first, resurrect if found
const existing = await prisma.supportInstallation.findFirst({
  where: { provider: "SLACK", providerInstallationId: oauthResult.appId },
  includeDeleted: true, // escape hatch
});

if (existing?.deletedAt) {
  // Resurrect: clear deletedAt and update fields
  await prisma.supportInstallation.update({
    where: { id: existing.id },
    data: { deletedAt: null, workspaceId, botUserId, metadata, updatedAt: new Date() },
  });
} else {
  // Standard upsert (only matches active records due to partial unique index)
  await prisma.supportInstallation.upsert({ ... });
}
```

**WorkspaceMembership re-add** (`workspace-router.ts:141`):
```typescript
// Before: check exists → throw CONFLICT
// After: check exists (including deleted) → resurrect if deleted, conflict if active
const existing = await prisma.workspaceMembership.findFirst({
  where: { workspaceId, userId },
  includeDeleted: true,
});

if (existing && !existing.deletedAt) {
  throw new TRPCError({ code: "CONFLICT", message: "User is already a workspace member" });
}

if (existing?.deletedAt) {
  // Resurrect with new role
  await prisma.workspaceMembership.update({
    where: { id: existing.id },
    data: { deletedAt: null, role: input.role, updatedAt: new Date() },
  });
} else {
  await prisma.workspaceMembership.create({ ... });
}
```

**SupportConversation upsert** (`support.activity.ts:97-127`):
```typescript
// Same resurrect pattern — check for soft-deleted conversation with same canonical key
// and reactivate instead of creating new
```

### 6.4 Query operations — automatic via extension

All `findMany`, `findFirst`, `findUnique`, and `count` queries automatically exclude soft-deleted records. No per-query changes needed for:

- Inbox listing (`support-projection-service.ts`)
- Workspace member listing (`workspace-membership-service.ts`)
- API key listing (`workspace-api-key-router.ts`)
- Installation listing (`slack-oauth-service.ts`)
- Session resolution (`session.ts`) — Session is Tier 2, not affected
- All support command service lookups

### 6.5 Auth flows

**Registration** (`auth-router.ts:33`):
- `findUserIdentityByEmail` auto-filters `deletedAt: null`
- Deleted user's email becomes available for new registration
- Partial unique index allows the new `User` record

**Login** (`auth-router.ts`):
- `findUserAuthByEmail` auto-filters `deletedAt: null`
- Deleted users cannot log in (correct behavior)

**API key auth** (`context.ts:94`):
- `findUnique({ where: { keyPrefix } })` auto-filters `deletedAt: null`
- Soft-deleted API keys cannot authenticate (correct behavior)

---

## 7. Hard Delete for True Cleanup (Admin/Cron)

**Status:** Implemented in `packages/database/src/hard-delete.ts`

Soft-deleted records are eventually purged via three exported functions. All accept `prismaRaw` (the base client without the soft-delete extension) to ensure `deleteMany` performs actual SQL DELETEs.

### 7.1 Batch Purge

```typescript
import { prismaRaw, purgeDeletedRecords } from "@shared/database";

// Purge records soft-deleted more than 90 days ago (default)
const results = await purgeDeletedRecords(prismaRaw);
// => [{ model: "SupportTicketLink", deletedCount: 12 }, ...]

// Custom retention period
const results = await purgeDeletedRecords(prismaRaw, { retentionDays: 30 });

// Dry run — count without deleting
const preview = await purgeDeletedRecords(prismaRaw, { dryRun: true });
```

Deletes in dependency order (children first): SupportTicketLink → SupportDeliveryAttempt → SupportConversation → SupportInstallation → WorkspaceApiKey → WorkspaceMembership → Workspace → User.

### 7.2 Single-Record Hard Delete

```typescript
import { prismaRaw, hardDeleteById } from "@shared/database";

// Hard-delete one specific record (must already be soft-deleted)
await hardDeleteById(prismaRaw, "User", "cuid_123");

// Throws if record is active (not soft-deleted) — safety guard
// Error: "Cannot hard-delete User cuid_123: record not found or not soft-deleted."
```

### 7.3 Count for Monitoring

```typescript
import { prismaRaw, countSoftDeletedRecords } from "@shared/database";

// Count per model (for admin dashboards)
const counts = await countSoftDeletedRecords(prismaRaw, 90);
// => [{ model: "User", deletedCount: 3 }, ...]
```

### 7.4 Temporal Scheduled Workflow

**Status:** Implemented in `apps/queue/src/domains/maintenance/`

The purge runs as a Temporal scheduled workflow (`purgeDeletedRecordsWorkflow`) triggered daily at 3:00 AM UTC.

**Files:**
- `purge.activity.ts` — Temporal activity wrapping `purgeDeletedRecords`
- `purge.workflow.ts` — Temporal workflow orchestrating the activity
- `register-purge-schedule.ts` — One-time script to create the Temporal schedule

**Setup:**
```bash
# Register the schedule (run once per environment)
npx tsx apps/queue/src/domains/maintenance/register-purge-schedule.ts
```

The schedule can be viewed and managed in the Temporal UI at `http://localhost:8233/schedules`.

---

## 8. Implementation Checklist

### Phase 1: Schema + Extension (do first)
- [x] Add `deletedAt DateTime?` to all Tier 1 models in schema
- [x] Write migration with partial unique indexes (raw SQL)
- [x] Update composite indexes to include `deletedAt` where beneficial
- [x] Change `onDelete: Cascade` to `onDelete: Restrict` for soft-deletable parents
- [x] Implement Prisma Client extension in `packages/database/src/soft-delete.ts`
- [x] Wire extension into `packages/database/src/index.ts`
- [x] Run `db:generate` and verify no type errors

### Phase 2: Application Code
- [x] Create cascade soft delete service in `packages/rest/src/services/soft-delete-cascade.ts`
- [x] Update `slack-oauth-service.ts` disconnect → cascade soft delete installation
- [x] Update `workspace-router.ts` remove member → verify auto soft delete works
- [x] Update `slack-oauth-service.ts` upsert → resurrect pattern (`softUpsert`)
- [x] Update `workspace-router.ts` add member → resurrect pattern (`softUpsert`)
- [x] Update `support.activity.ts` conversation upsert → resurrect pattern (`softUpsert`)
- [x] Verify session hard delete still works (Tier 2, no extension intercept)

### Phase 3: Testing
- [x] Unit test: Prisma extension auto-filters `deletedAt: null`
- [x] Unit test: `.delete()` converts to soft delete for Tier 1 models
- [x] Unit test: `.delete()` stays hard delete for Tier 2 models (Session)
- [ ] Integration test: Remove + re-add workspace member (no unique constraint error)
- [ ] Integration test: Disconnect + reconnect Slack (no unique constraint error)
- [ ] Integration test: Soft-deleted user can't log in
- [ ] Integration test: Soft-deleted user's email can be re-registered
- [ ] Integration test: Cascade soft delete workspace → all children soft-deleted
- [ ] Integration test: Soft-deleted records invisible in inbox, member list, API key list

### Phase 4: Cleanup Infrastructure
- [x] Implement purge function for records past retention period (`packages/database/src/hard-delete.ts`)
- [x] Add `hardDeleteById` for single-record hard delete with safety guard
- [x] Add `countSoftDeletedRecords` for admin monitoring (dry-run mode)
- [x] Add `includeDeleted` escape hatch for admin tooling (`findIncludingDeleted` in `soft-delete-helpers.ts`)
- [x] Wire purge into Temporal scheduled workflow (`apps/queue/src/domains/maintenance/`)
- [x] Integration tests for purge: retention window, dependency ordering, safety guards, cascade scenario (9 tests)

---

## 9. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Extension misses a query path | Comprehensive test coverage for each model + each query type |
| Partial unique index not supported by Prisma introspection | Use `@@ignore` or raw SQL in migration; document in schema comments |
| Performance regression from extra `WHERE deletedAt IS NULL` | Partial indexes already filter; no sequential scan impact |
| `findUnique` with compound key + `deletedAt` filter | Prisma may fall back to `findFirst` internally; test and benchmark |
| Purge job accidentally deletes active records | Purge only matches `deletedAt IS NOT NULL AND deletedAt < cutoff`; double safety |
| Existing hard `onDelete: Cascade` in schema | Change to `Restrict` in same migration; app code handles cascade |

---

## 10. Open Questions

1. **Retention period** — 90 days default? Should it vary by model (e.g., longer for User/Workspace)?
2. **User deletion + GDPR** — Should `User` hard-delete personal data immediately but keep a tombstone record?
3. **Workspace deletion UX** — Should soft-deleting a workspace be recoverable via UI, or admin-only recovery?
4. **SupportConversationEvent** — Currently Tier 3 (never delete). Should it follow parent conversation's `deletedAt` as a filter instead of having its own field?
