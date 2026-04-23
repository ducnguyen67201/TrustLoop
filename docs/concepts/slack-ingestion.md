---
summary: "Slack webhook lifecycle: signature verify, dedup, Temporal dispatch, realtime fanout"
read_when:
  - Working on the Slack webhook intake path
  - Touching signature verification or replay-window logic
  - Debugging why a Slack event did or didn't become a conversation event
title: "Slack Ingestion"
---

# Slack Ingestion

How a Slack event becomes a `SupportConversationEvent` on a `SupportConversation`.

This is the entry point for all customer-facing support traffic. The goal is: take an untrusted webhook payload, prove it's actually from Slack, deduplicate it, and kick off a Temporal workflow that decides which conversation the message belongs to.

## Entry point

- `apps/web/src/app/api/slack/events/route.ts:POST` — the Next.js route
- delegates to `handleSlackEventsWebhook()` in `apps/web/src/server/http/rest/support/slack-events.ts:1-37`

The route is **unauthenticated** (no `withServiceAuth`, no `withWorkspaceApiKeyAuth`). Slack signature verification is the auth boundary — see next section.

## Signature verification

All requests are verified before any DB work:

- `packages/rest/src/services/support/slack-signature-service.ts:57-78`
- Algorithm: `HMAC-SHA256` over the string `v0:${timestamp}:${rawBody}`
- Timing-safe comparison against the `X-Slack-Signature` header
- Replay protection: requests with `X-Slack-Request-Timestamp` older than `SLACK_REPLAY_WINDOW_SECONDS` (default 5 minutes) are rejected
- The `SlackAppInstallation` row holds the `signingSecret` keyed by team+app

If verification fails, the route returns 401 and the request never reaches any business logic.

## Parse + dedupe

After signature verification, the payload is parsed and deduplicated:

- `packages/rest/src/services/support/support-ingress-service.ts:99-198`
- Supported event types: `message`, `reaction_added`, `reaction_removed`, `message.channels`, `message.groups`, `message.im`, `message.mpim`, `message.file_share` (and edit/delete variants)
- **Canonical idempotency key:** `${installationId}:${teamId}:${channelId}:${eventTs}:${eventType}` — stable across Slack retries, unique across installations
- The key is persisted to `supportIngressEvent` (unique index). Duplicate webhooks return 202 with no downstream work

This dedup is critical — Slack retries aggressively and we can't afford to analyze the same message twice.

## Temporal dispatch

Once the ingress event is persisted, the HTTP response returns 200 and a workflow is dispatched asynchronously:

- `packages/rest/src/temporal-dispatcher.ts:56-70`
- Workflow: `workflowNames.supportInbox` on `TASK_QUEUES.SUPPORT`
- Workflow ID: `support-ingress-${canonicalIdempotencyKey}` — deterministic, so Temporal's own dedup kicks in if the dispatcher retries
- Workflow input: `{ workspaceId, installationId, ingressEventId }`

The webhook handler does **not** wait for the workflow to complete. Slack has a 3-second timeout; our response is already on the wire.

## Thread routing (inside the workflow)

The dispatched workflow calls `buildThreadSnapshot` activity, which decides which `SupportConversation` this message belongs to:

- `apps/queue/src/domains/support/support.activity.ts:183-258`

Three-tier priority:

```
1. THREAD-ALIAS LOOKUP (if threadTs ≠ messageTs AND author is customer)
   ├─ supportConversationThreadAlias.findUnique((installationId, channelId, threadTs))
   └─ Walk mergedIntoConversationId chain up to 5 hops to find an
      active, non-deleted conversation
   → use primary's threadTs as resolvedThreadTs

2. GROUPING ANCHOR (standalone message from customer in an active channel)
   ├─ supportGroupingAnchor.findFirst where:
   │    • channelId matches
   │    • authorSlackUserId matches
   │    • windowExpiresAt > now
   │    • conversation.status IN [UNREAD, IN_PROGRESS, STALE]
   │    • conversation.deletedAt IS NULL
   ├─ Respect maxGroupingWindowMinutes cap (no unbounded extension)
   └─ Slide window: update windowExpiresAt to now + windowMinutes
   → use anchorMessageTs as resolvedThreadTs

3. FALLBACK
   → use message's own threadTs, create new SupportConversation
```

Signals used:
- Channel (strict equality)
- Thread TS (strict equality via alias table)
- Slack user ID (for standalone grouping)
- Time window (5-60 min sliding, per-installation configurable)
- Conversation status (only UNREAD/IN_PROGRESS/STALE are eligible for grouping)

No semantic similarity. Grouping is deterministic based on Slack metadata + a time window.

See `thread-grouping.md` for the detailed algorithm and edge cases.

## Persistence + event emission

Once `resolvedThreadTs` is known, the activity:

1. Upserts the `SupportConversation` (or finds the existing one)
2. Inserts a `SupportConversationEvent` row typed by Slack event kind (`MESSAGE_RECEIVED`, `REACTION_ADDED`, etc.)
3. If the conversation status transitions (e.g. DONE → UNREAD on new customer message), routes through `transitionConversation()` FSM
4. Emits `supportRealtime.emitConversationChanged(...)` → pg_notify → SSE fanout to the inbox UI

## Realtime fanout

- `packages/rest/src/services/support/support-realtime-service.ts:203-217`
- Uses `prisma.$executeRaw` (NOT `$queryRaw`) to call `pg_notify('support_inbox_stream', payload)`. `$queryRaw` returns no resultset for NOTIFY, so it silently no-ops.
- The listener is a long-lived client per web process, registered via `LISTEN support_inbox_stream` at boot time (`support-realtime-service.ts:129-164`)
- On notification: parse payload, fan out to all SSE streams subscribed to that `workspaceId`
- SSE endpoint: `apps/web/src/server/http/support/support-stream.ts:14-113` (authenticated, workspace-member-gated, 25s keepalive)

## Failure modes

| Failure | Behavior |
|---------|----------|
| Signature mismatch / replay | 401, nothing persisted |
| Duplicate canonical key (Slack retry) | 202, no downstream work |
| Temporal dispatch fails after dedup row written | Workflow retried via Temporal's own idempotency on `support-ingress-${key}` |
| Thread-alias chain has a cycle | Bounded at 5 hops; chain beyond that is treated as data corruption and logged |
| Grouping anchor window expired mid-processing | Falls through to tier 3 (new conversation) — correct behavior |
| `pg_notify` payload exceeds 8KB | Postgres rejects; emit fails. We keep payloads tiny (ids + reason) to stay well under |

## Invariants

- **Every inbound Slack request must pass HMAC-SHA256 signature verification before any DB write or Temporal dispatch.** No exceptions, no bypass flag.
- **The canonical idempotency key `${installationId}:${teamId}:${channelId}:${eventTs}:${eventType}` is the single source of dedup truth.** Duplicate keys never re-run the workflow.
- **Thread routing is purely deterministic** — channel + thread_ts + user + time window + conversation status. No semantic similarity, no content-based clustering, no ML signal.
- **The webhook handler returns 200 within Slack's 3-second timeout.** All downstream work (grouping, FSM, analysis) runs asynchronously via Temporal. Adding synchronous work to the handler breaks Slack's retry behavior.
- **The thread-alias chain is bounded at 5 hops.** Chains beyond that are treated as data corruption and logged; they do not extend forever.
- **The `pg_notify` payload stays small** (ids + reason only, never full event data). Postgres rejects payloads over 8KB.

## Related concepts

- `thread-grouping.md` — the algorithm in detail, including merge/reassign corrections
- `support-conversation-fsm.md` — what happens to `status` on each event type
- `ai-analysis-pipeline.md` — how a new message triggers an analysis (debounce workflow)

## Keep this doc honest

If you change any of the following, update this file in the same PR:

- The signature verification algorithm or replay window
- The canonical idempotency key shape
- The three-tier thread routing priority
- The realtime fanout channel or payload shape
- The Temporal workflow ID pattern
