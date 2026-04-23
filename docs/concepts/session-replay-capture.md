---
summary: "Browser SDK recording, ingest endpoint, storage model, and SessionDigest correlation into analysis"
read_when:
  - Working on the browser SDK recorder or transport
  - Touching the session ingest endpoint or storage models
  - Changing how SessionDigest is built or fed into the analysis prompt
  - Wiring raw rrweb chunks into agent context (currently not wired)
title: "Session Replay Capture"
---

# Session Replay Capture

How a browser session gets recorded, ingested, stored, and (eventually) fed into an analysis as evidence.

## The pipeline

```
Browser (customer product)
  └─ @trustloop/sdk-browser initialized with a tlk_ workspace API key
       ├─ rrweb recorder  ─────▶  rrweb event stream (DOM snapshots)
       └─ structured capture ──▶  CLICK / ROUTE / NETWORK_ERROR / CONSOLE_ERROR / EXCEPTION
                ↓
              batch + gzip
                ↓
  POST /api/rest/sessions/ingest  (auth: tlk_ API key)
                ↓
         upsert SessionRecord
            ├─ SessionEvent rows   (one per structured event)
            └─ SessionReplayChunk rows  (compressed rrweb, sequence-numbered)

[Later, during an analysis for a conversation]

buildThreadSnapshot activity
  └─ sessionCorrelation.findByEmails(emails, lookback=30min)
       └─ pick most recent SessionRecord for matched email
            └─ build SessionDigest (summary, not raw rrweb)
                 └─ inject into agent prompt as "Browser Session Context"
```

## Browser SDK

Shipped as `@trustloop/sdk-browser` from `packages/sdk-browser/src/`:

### Recorder (rrweb)

- `packages/sdk-browser/src/recorder.ts:23-97`
- Wraps [rrweb](https://github.com/rrweb-io/rrweb) to capture DOM mutations, inputs, scrolls, and viewport changes
- Emits events into an in-memory array
- Pauses on `visibilitychange → hidden` (no point recording when the user can't see the page)
- Graceful fallback: if rrweb fails to load or init, the structured capture still works

### Structured capture

- `packages/sdk-browser/src/capture.ts`
- Event types: `CLICK`, `ROUTE`, `NETWORK_ERROR`, `CONSOLE_ERROR`, `EXCEPTION`
- These are cheap to store and query. The rrweb chunks are the "pictures"; the structured events are the "index."

### Session lifecycle

- `packages/sdk-browser/src/session.ts:24-53`
- `sessionId` generated as UUID at SDK init
- Auto-rotates after 30 minutes of inactivity (`trackActivity()` touches a last-active timestamp on every event)
- Lets us treat each page refresh or tab-switch differently from an idle pause

### Transport

- `packages/sdk-browser/src/transport.ts:158-253`
- Batches events, gzip-compresses, flushes on:
  - Batch size threshold reached (default every N events)
  - Time threshold (default every 10 seconds)
  - Page unload (via `fetch` with `keepalive: true` — not `sendBeacon`, because beacon drops custom headers including auth)
- Retries with exponential backoff, 3 attempts
- Payload splitting: if a batch exceeds max bytes (default 1MB), split across multiple POSTs
- Offline queueing: `navigator.onLine === false` → queue in memory + localStorage, drain on reconnect

## Ingest endpoint

- Server handler: `apps/web/src/server/http/rest/sessions/ingest.ts`
- Route: `apps/web/src/app/api/rest/sessions/ingest/route.ts` (delegates to the handler)

### Auth

- `withWorkspaceApiKeyAuth` — requires `Authorization: Bearer tlk_...`
- Customer includes the key when initializing the SDK. The key is scoped to one workspace; all incoming sessions belong to that workspace.

### Validation

- `sessionIngestPayloadSchema` — Zod schema for the batch payload
- Size cap: 1MB per POST after decompression
- If the request body is gzip-compressed (common), decompress before validation

### Write path

- Returns `202 Accepted` immediately; writes happen asynchronously in an after-response task
- Transaction:
  1. `findFirst({ where: { workspaceId, sessionId, deletedAt: null } })` → if missing, `create`. This manual pattern exists because Prisma's `upsert()` can't target the partial unique index `(workspaceId, sessionId) WHERE deletedAt IS NULL`. See `TODOS.md` → "Session-ingest upsert race retry" for the known race.
  2. Upsert `SessionEvent` rows per structured event
  3. Insert `SessionReplayChunk` rows for each rrweb batch, compressed, sequence-numbered

## Storage

Prisma models (see the schema at `packages/database/prisma/schema/session-replay.prisma`):

- **`SessionRecord`** — per-session row: `workspaceId`, `sessionId`, `userId`, `userEmail`, `eventCount`, `hasReplayData`, `firstEventAt`, `lastEventAt`
- **`SessionEvent`** — structured events: `type` (enum), `timestamp`, `url`, `payload` (JSON)
- **`SessionReplayChunk`** — compressed rrweb batches: `sessionRecordId`, `sequenceNumber`, `eventCount`, `startAt`, `endAt`, `compressedData`

### Indexes

- `(workspaceId, sessionId)` partial unique (where `deletedAt IS NULL`)
- `(workspaceId, userEmail, lastEventAt)` — for the correlation lookup in the analysis pipeline
- `(sessionRecordId, sequenceNumber)` on chunks

## Correlation to SupportConversations

The SDK captures `userEmail` (set by the customer's product when the user logs in). That email is the bridge:

- `packages/rest/src/services/support/session-correlation/` (split folder; see `find.ts`, `extract.ts`, `digest.ts`)
- During `buildThreadSnapshot`:
  1. Extract customer email from the Slack user (`users.info` via Slack API, falls back to regex-scraping message bodies)
  2. Query recent `SessionRecord`s for that workspace + email within the lookback window (default 30 min)
  3. Build a `SessionDigest` — a summary of user actions, errors, network failures, console errors, failure point, and environment
  4. Pass the digest into the agent prompt as "Browser Session Context"

Important: **no direct `sessionId` foreign key on `SupportConversation`.** Correlation is runtime-computed from email + time window. This means:
- If the customer's Slack email differs from their product email, correlation fails silently
- If the customer waited > 30 min between the failure and messaging support, correlation fails silently
- Operators can't manually link a session to a conversation (yet)

This is deliberate for pilot — email + window is good enough signal, and a foreign key would require schema changes plus a "which session is the right one?" UX.

## What the agent sees

The agent gets **SessionDigest**, not raw rrweb. Digest shape:

- User actions (CLICK, ROUTE sequence)
- Console errors + exceptions near the failure point
- Network failures with status codes and URLs
- Inferred failure point (last error or ~5 seconds before the last user action before abandonment)
- Environment (browser, OS, viewport, app version if tagged)

Raw rrweb chunks are stored but NOT passed to the agent. This is a deliberate tradeoff:

- Token economics: rrweb DOM snapshots are thousands of tokens per second of recording
- Complexity: passing rrweb requires either rendering frames or a specialized model
- Value: a digest with "user clicked X, got 500 from /api/Y, saw 'undefined is not a function'" is almost always enough for the agent

Wiring rrweb chunks into the prompt is flagged as P2 in `TODOS.md` → "Wire rrweb chunks into the agent prompt."

## Known thin spots

- **No operator UI to view replay.** Chunks are stored but there's no "play this session" button in the inbox yet. The inflight `impl-plan-elite-agent-handoff` work (now archived to `~/.gstack/`) was building toward that.
- **No `sessionId` on `SupportConversation`.** Makes back-queries ("which sessions did this customer have around the time of this conversation?") a correlation query instead of a join.
- **Ingest race on concurrent first-batch-ever.** Two flushes from the same session in the same second can both see "no SessionRecord yet" and both try to create, leading to a unique-violation error on the second. Currently logged and the SDK's next retry recovers. Known TODO.

## Invariants

- **All ingest requests authenticate with a `tlk_`-prefixed workspace API key via `withWorkspaceApiKeyAuth`.** Ingest is never anonymous. No unauthenticated session writes reach the DB.
- **Raw rrweb chunks are stored but never reach the agent prompt.** Only `SessionDigest` (summary: actions, errors, network, console, failure point, environment) is prompted. Wiring rrweb in is a prompt-shape migration.
- **`SessionRecord` uses a partial unique index `(workspaceId, sessionId) WHERE deletedAt IS NULL`.** Writes use manual `findFirst → update | create`, never Prisma `upsert()` — upsert cannot target partial indexes and the extension-level conversion breaks soft-delete semantics.
- **Correlation to `SupportConversation` is runtime-computed from email + time window.** There is no foreign key from `SupportConversation` to `SessionRecord`. Changing this is a schema migration, not a refactor.
- **The transport uses `fetch` with `keepalive: true` on page unload, not `navigator.sendBeacon`.** `sendBeacon` drops the `Authorization` header, which breaks auth. Replacing the transport path is a one-way door.
- **Never embed secrets, PII, or credentials in replay payloads.** The ingest endpoint accepts whatever the SDK sends; redaction is the SDK's responsibility and must stay on by default.

## Related concepts

- `ai-analysis-pipeline.md` — how `SessionDigest` is consumed
- `auth-and-workspaces.md` — how the SDK's `tlk_` key gets validated

## Keep this doc honest

Update when you:
- Change the event types captured
- Change the transport batching/compression/retry behavior
- Move from polling ingest to a true streaming ingest
- Add a foreign key from `SupportConversation` to a session
- Wire raw rrweb chunks into the agent prompt (would also update `ai-analysis-pipeline.md`)
- Change the correlation signal (email → something else)
