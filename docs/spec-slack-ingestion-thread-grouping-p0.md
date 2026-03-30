# Slack Ingestion + Deterministic Thread Grouping (P0) Focused Engineering Spec

## 1) Purpose

Define the implementation spec for the first reliable support inbox loop:

1. ingest Slack customer-channel events safely
2. group events into deterministic conversations
3. assign and track owner/status/staleness
4. send replies back to the exact Slack thread
5. prevent silent failures with retries, dead-letter visibility, and notification evidence rules

This spec is the execution source of truth for section **B. Slack Ingestion + Thread Grouping (P0)** in:

- `docs/impl-plan-first-customer-happy-path-mvp.md`

## 2) Inputs and Locked Review Decisions

This spec incorporates approved decisions from `/office-hours`, `/plan-design-review`, `/plan-ceo-review`, and `/plan-eng-review`.

Core lock-ins:

- Event-sourced architecture with immutable ingress events + query projections.
- Slack-first implementation with adapter contracts (`ingest`, `send`, `identity`, `threadRef`).
- Canonical idempotency key reused across ingress/workflow/projection/delivery.
- Canonical conversation identity key: `workspaceInstallationId + teamId + channelId + externalThreadTs`.
- Fast-ack webhook model: verify + idempotency persist + immediate `200`; async processing in Temporal.
- Done-state guardrail: default Slack delivery ack required; manual override requires reason + audit log.
- Escalation ladder: `30m assignee`, `+15m on-call`, `+30m workspace admin`.
- Rollout posture: CI-first broad rollout is allowed for pre-user stage, but with hard kill switch: `SUPPORT_INGEST_ENABLED`.
- Projection freshness target: `p95 < 5s`, `p99 < 15s`; delayed-data UX fallback required.

## 3) Scope Plan (Wave 1 and Wave 2)

### Wave 1 (must ship first)

- Signed Slack ingress endpoint with replay-window protection.
- Immutable ingress event persistence + canonical idempotency enforcement.
- Deterministic grouping engine and projection updater.
- Inbox state model (`Unread`, `In Progress`, `Stale`, `Done`) + assignee.
- Outbound send path with bounded retry + dead-letter.
- Done-evidence gate (Slack ack or audited override).
- Kill switch + basic operational controls.

### Wave 2 (immediately after Wave 1)

- Escalation ladder automation.
- Operator-facing explainability panel + guided repair actions.
- Ticket-link/status plumbing in conversation model and UI.
- Channel-adapter contract hardening docs and cleanup.

## 4) In Scope / Out of Scope

In scope:

- Slack events API ingestion for customer support channels.
- Conversation grouping and projection persistence.
- Operator inbox surfaces and command actions.
- Slack outbound replies including image attachments.
- Retry/dead-letter/error visibility.

Out of scope (explicitly deferred):

- Direct Linear connector integration (after summary + code-index quality gate).
- Handoff brief synthesis panel (after summary + code-index quality gate).
- Multi-channel live adapters (Discord/Teams/email) in P0.
- Full SLO-driven auto-rollback orchestration.

## 5) Existing Code Reuse (Do Not Rebuild)

Reuse candidates already present:

- `apps/queue/src/domains/support/support.workflow.ts` (entrypoint scaffold)
- `apps/queue/src/domains/support/support.activity.ts` (activity scaffold)
- `apps/worker/src/main.ts` (dual worker + queue isolation)
- `apps/queue/src/runtime/workflows.ts` and `apps/queue/src/runtime/activities.ts` (registration surfaces)
- `packages/rest/src/workflow-router.ts` and `packages/rest/src/temporal-dispatcher.ts` (typed dispatch structure)
- `packages/types/src/workflow.schema.ts` (typed workflow contracts)
- `packages/rest/src/security/*` and workspace RBAC/audit patterns for policy reuse

## 6) Runtime Architecture

```text
Slack Events API
  -> apps/web signed ingress route
      -> verify signature + replay window + kill switch gate
      -> compute canonical idempotency key
      -> persist immutable ingress event (idempotent)
      -> return 200 quickly
      -> dispatch Temporal support workflow
            -> normalize event
            -> deterministic grouping
            -> projection update
            -> optional escalation scheduling

Operator action (UI)
  -> tRPC support inbox router
      -> command event write (assign/status/merge/split/send)
      -> Temporal activity for outbound send/retry
      -> projection refresh
```

## 7) Domain Boundaries and File Layout

### 7.1 `packages/types` (shared contracts)

Create support domain contract modules:

- `packages/types/src/support/support-ingress.schema.ts`
- `packages/types/src/support/support-conversation.schema.ts`
- `packages/types/src/support/support-command.schema.ts`
- `packages/types/src/support/support-delivery.schema.ts`
- `packages/types/src/support/support-adapter.schema.ts`
- `packages/types/src/support/index.ts`

Add exports in `packages/types/src/index.ts`.

### 7.2 `apps/web` (transport boundary only)

Add new HTTP handlers:

- `apps/web/src/app/api/slack/events/route.ts`
- `apps/web/src/server/http/rest/support/slack-events.ts`

Add support inbox API wrapper routes as needed and keep thin wrappers in `app/api/**/route.ts`.

### 7.3 `packages/rest` (orchestration + business rules)

Add support services and router:

- `packages/rest/src/services/support/slack-signature-service.ts`
- `packages/rest/src/services/support/support-ingress-service.ts`
- `packages/rest/src/services/support/support-projection-service.ts`
- `packages/rest/src/services/support/support-command-service.ts`
- `packages/rest/src/support-inbox-router.ts`

Wire router in `packages/rest/src/router.ts`.

### 7.4 `apps/queue` (workflow orchestration)

Expand support domain:

- `apps/queue/src/domains/support/support.workflow.ts`
- `apps/queue/src/domains/support/support.activity.ts`
- optional helper modules under `apps/queue/src/domains/support/` for grouping/retry classification

Keep worker registration in existing runtime files.

### 7.5 Adapter boundary

Add adapter layer:

- `apps/queue/src/domains/support/adapters/slack/*`

Rule:

- Slack-native payload types are allowed only inside adapter files.
- All upstream/downstream layers consume `@shared/types/support/*` contracts.

## 8) Data Model Changes (`packages/database/prisma/schema.prisma`)

Add support models (names may be adjusted to existing naming style, but semantics must remain):

1. `SupportInstallation`
- `id`, `workspaceId`, `provider` (`SLACK`), `providerInstallationId`, `teamId`, `botUserId`, `metadata`, `createdAt`, `updatedAt`
- unique index on (`provider`, `providerInstallationId`)

2. `SupportIngressEvent`
- `id`, `workspaceId`, `installationId`, `provider`, `providerEventId`, `canonicalIdempotencyKey`, `payloadJson`, `receivedAt`, `processedAt`, `processingState`
- unique index on `canonicalIdempotencyKey`
- index on (`workspaceId`, `receivedAt`)

3. `SupportConversation`
- `id`, `workspaceId`, `installationId`, `canonicalConversationKey`, `status`, `assigneeUserId`, `lastCustomerMessageAt`, `customerWaitingSince`, `staleAt`, `retryCount`, `lastActivityAt`, `createdAt`, `updatedAt`
- unique index on (`workspaceId`, `canonicalConversationKey`)
- queue hot-path composite index:
  - (`workspaceId`, `status`, `staleAt`, `customerWaitingSince`, `retryCount`, `lastActivityAt`)

4. `SupportConversationEvent`
- `id`, `conversationId`, `workspaceId`, `eventType`, `eventSource`, `summary`, `detailsJson`, `createdAt`
- index on (`conversationId`, `createdAt`)

5. `SupportDeliveryAttempt`
- `id`, `workspaceId`, `conversationId`, `commandId`, `provider`, `providerMessageId`, `attemptNumber`, `state`, `errorCode`, `errorMessage`, `nextRetryAt`, `createdAt`, `updatedAt`
- index on (`workspaceId`, `state`, `nextRetryAt`)

6. `SupportDeadLetter`
- `id`, `workspaceId`, `sourceType`, `sourceId`, `failureClass`, `failureReason`, `payloadJson`, `firstFailedAt`, `lastFailedAt`, `retryCount`, `resolvedAt`
- index on (`workspaceId`, `resolvedAt`, `lastFailedAt`)

7. `SupportTicketLink` (Wave 2 plumbing)
- `id`, `workspaceId`, `conversationId`, `provider` (`LINEAR` placeholder), `externalTicketId`, `externalStatus`, `syncState`, `lastSyncedAt`, `createdAt`, `updatedAt`

Migration rule:

- commit migration and regenerate Prisma client artifacts.

## 9) Canonical Keys and Deterministic Rules

### 9.1 Canonical idempotency key

Format:

- `installationId:teamId:channelId:eventTs:eventType`

Requirements:

- computed at ingress, persisted in `SupportIngressEvent`, reused in all downstream actions.
- all writes that can duplicate must be protected by either this key or a deterministic derivative.

### 9.2 Canonical conversation key

Format:

- `workspaceInstallationId:teamId:channelId:externalThreadTs`

Grouping order:

1. external thread id (`thread_ts`) exact match
2. reply chain link
3. fallback recency window (`2h`) + fingerprint fields

Fallback fingerprint fields:

- normalized message text hash
- `channelId`
- author role bucket
- 2-hour time bucket

### 9.3 Stale policy

- `Unread` -> stale at `30m`
- `In Progress` -> stale at `24h`
- `Done` -> never stale

## 10) Workflow and Activity Contracts

### 10.1 Workflow IDs

- ingress process: `support-ingress-{canonicalIdempotencyKey}`
- reply send: `support-send-{commandId}`

### 10.2 Workflow behavior

- orchestration only, deterministic.
- no direct DB/network calls in workflow code.
- activities perform all I/O.

### 10.3 Activity reliability

Default retries:

- retry transient failures only (`429`, `5xx`, network timeouts)
- bounded attempts with backoff
- terminal failures route to dead-letter and operator-visible state

### 10.4 Timeouts

Set explicit timeouts for each activity call.

Recommended baseline:

- Slack API calls: `startToCloseTimeout: 30s`
- DB projection writes: `startToCloseTimeout: 15s`
- signature verification/normalization: `startToCloseTimeout: 10s`

## 11) API Surface

### 11.1 Slack ingress (public but signed)

`POST /api/slack/events`

Validation sequence:

1. `SUPPORT_INGEST_ENABLED` must be true
2. signature header verification
3. replay window check
4. installation/workspace mapping check
5. canonical key compute and idempotent event insert
6. immediate `200` response
7. async workflow dispatch

### 11.2 Support inbox router (authenticated workspace members)

Add `supportInbox` procedures in `packages/rest`:

- `listConversations`
- `getConversationTimeline`
- `assignConversation`
- `updateConversationStatus`
- `mergeConversations`
- `splitConversation`
- `sendReply`
- `retryDelivery`
- `markDoneWithOverrideReason`

Auth rules:

- `workspaceProcedure` baseline for read operations
- role-gated mutations where needed (`ADMIN` for sensitive remediation actions)

## 12) UI Plan (shadcn-only)

Pages/components:

- queue list pane with `Unread/In Progress/Stale/Done` tabs
- timeline pane with event rows and grouping reason visibility
- action rail with assignee/status/delivery controls
- mobile: queue -> detail -> action drawer flow

Required states:

- loading
- empty
- partial
- error
- success

Accessibility:

- keyboard-operable row selection and action controls
- live region updates for delivery state changes
- minimum 44x44 touch targets
- AA contrast for status indicators

## 13) Security Controls

- strict Slack signature verification and replay-window enforcement
- no support ingest through public generic dispatch endpoint
- workspace installation mapping validation before persistence
- audited manual overrides for done-evidence bypass
- constant metadata keys for logs: `workspaceId`, `threadId`, `workflowId`

## 14) Error and Rescue Strategy

Failure classification:

- `ValidationError` -> reject/visible operator feedback
- `TransientExternalError` -> retry with backoff
- `PermanentExternalError` -> dead-letter + operator action required
- `ConflictError` -> idempotent no-op or safe retry path

Silent-failure rule:

- Any failure path must satisfy at least one:
  - user-visible state
  - structured log
  - dead-letter entry

## 15) Performance and SLO

Targets:

- projection freshness: `p95 < 5s`, `p99 < 15s`
- inbox query latency target: `p95 < 300ms` for default page size

Mitigations:

- queue composite index
- append-only ingest writes
- projection writes in transactions
- delayed-data UX fallback when freshness SLO is breached

## 16) Testing Plan

### 16.1 Wave 1 test gate (blocking)

Unit:

- canonical key generation
- grouping deterministic rules
- stale computation
- done-evidence policy

Integration:

- signed ingress -> event store -> workflow dispatch
- workflow -> grouping -> projection writes
- send reply -> retry classification -> dead-letter path

E2E/chaos:

- duplicate event storm
- out-of-order events
- Slack rate limit burst
- terminal delivery failure and operator retry
- done-evidence block + override audit

### 16.2 Wave 2 test gate (blocking for Wave 2)

- escalation ladder timing and recipient selection
- explainability reasons visible and accurate
- guided repair actions (merge/split/remap)
- ticket-link/status plumbing consistency

## 17) Rollout and Operations

Rollout mode:

- CI-first launch is allowed for current pre-user stage.

Mandatory safeguards even in CI-first mode:

- `SUPPORT_INGEST_ENABLED` kill switch
- smoke command/runbook for pause and replay
- dead-letter queue dashboard visibility

Kill-switch runbook (minimum):

1. set `SUPPORT_INGEST_ENABLED=false`
2. confirm ingress returns paused response
3. inspect dead-letter and retries
4. replay after fix

## 18) Worktree Parallelization Strategy

| Step | Modules touched | Depends on |
|------|------------------|------------|
| Wave 1 data/contracts | `packages/types`, `packages/database` | — |
| Wave 1 ingest+workflow | `apps/web`, `packages/rest`, `apps/queue` | data/contracts |
| Wave 1 UI | `apps/web` UI + `packages/rest` router | ingest+workflow APIs |
| Wave 2 ops features | `apps/queue`, `packages/rest`, `apps/web` | Wave 1 stable |
| Wave 2 ticket plumbing | `packages/types`, `packages/database`, `packages/rest` | Wave 1 stable |

Parallel lanes:

- Lane A: Wave 1 data/contracts -> ingest/workflow
- Lane B: Wave 1 UI (starts after API contracts are merged)
- Lane C: Wave 2 ops features (after Wave 1)
- Lane D: Wave 2 ticket plumbing (after Wave 1)

## 19) Definition of Done (P0)

- All Wave 1 deliverables implemented with passing Wave 1 gate.
- No silent failure paths in failure registry.
- Done-evidence rule enforced with audited override.
- Kill switch and replay runbook validated.
- Metrics/logging present for ingest/group/delivery states.
- Documentation updated (`spec` + `implementation checklist`).

## 20) Next Document

Implementation task list and file-by-file execution order:

- `docs/impl-slack-ingestion-thread-grouping-p0-checklist.md`
