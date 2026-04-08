# Session Replay SDK + Error Context Capture Pipeline

**Status**: In Progress
**Branch**: `duc/billing-metering`
**Date**: 2026-04-07

## Overview

TrustLoop's AI analysis pipeline receives browser context from customer apps via a client-side SDK. When a support thread arrives, the system correlates the thread to a captured browser session, compiles a structured digest, and injects it into the AI agent's prompt. Developers can also watch a visual replay of the user's session.

Two consumers, one capture stream:
1. **AI agent** (primary) — reads a compiled `SessionDigest` of structured events
2. **Developer** (secondary) — watches rrweb-powered visual replay in the thread UI

## Architecture

```
Customer's App                    TrustLoop
+-------------------+             +---------------------------+
| @trustloop/sdk    |   HTTPS     | POST /api/rest/sessions/  |
| (rrweb + events)  | ---------> |        ingest             |
+-------------------+             | (withWorkspaceApiKeyAuth) |
                                  +---------------------------+
                                           |
                                    +------+------+
                                    |             |
                              Structured     Raw rrweb
                              Events         Blob (gzip)
                                    |             |
                              +-----v-----+  +---v--------+
                              | Postgres   |  | Postgres   |
                              | session_   |  | session_   |
                              | events     |  | replay_    |
                              |            |  | chunks     |
                              +-----+------+  +---+--------+
                                    |             |
                              +-----v-----+  +---v--------+
                              | Session    |  | Replay     |
                              | Digest     |  | Viewer     |
                              | (AI agent) |  | (developer)|
                              +------------+  +------------+
```

## SDK Installation (Customer-Facing)

```bash
npm install @trustloop/sdk rrweb
```

```typescript
import { TrustLoop } from '@trustloop/sdk';

TrustLoop.init({
  apiKey: 'tlk_...',
  maskAllText: true,      // default: true (PII safe)
  maskAllInputs: true,    // default: true
});

// Identify the end-user (enables session-to-thread correlation)
TrustLoop.setUser({
  email: 'jane@acme.com',
  name: 'Jane Doe',
});

// Consent controls
TrustLoop.startRecording();  // opt-in
TrustLoop.stopRecording();   // opt-out
```

### What the SDK Captures

**Stream A — Structured Events** (lightweight, always on):
- Route changes (pushState, replaceState, popstate)
- Clicks: selector path, element tag, text (truncated/hashed), coordinates
- Console errors (`console.error`, `console.warn`)
- Uncaught exceptions + unhandled rejections with stack traces
- Fetch/XHR failures: method, URL, status, duration
- Page metadata: URL, referrer, viewport, user agent, release

**Stream B — rrweb DOM Replay** (heavier, for visual reconstruction):
- Initial DOM snapshot + incremental DOM mutations
- Mouse movements (sampled), clicks, scroll, input focus
- Viewport resize

### SDK Behavior

- **Ring buffer**: keeps last 5 minutes of events (configurable 1-15 min)
- **Batching**: flushes every 10 seconds or immediately on error
- **Transport**: `fetch` for rrweb payloads, `sendBeacon` for page-unload structured events
- **Compression**: `CompressionStream` where available, uncompressed fallback
- **Max payload**: 512KB compressed per flush (splits if exceeded)
- **Retry**: exponential backoff (1s, 2s, 4s), silent drop after 3 failures
- **Fault isolation**: all SDK code wrapped in try-catch, never crashes host app
- **Offline**: pauses flushes when offline, resumes on reconnect
- **Tab visibility**: pauses rrweb recording when tab hidden

## API Endpoints

### Ingest (SDK → TrustLoop)

```
POST /api/rest/sessions/ingest
Authorization: Bearer tlk_...
Content-Type: application/json

{
  "sessionId": "sess_abc123",
  "workspaceId": "ws_...",       // resolved from API key
  "userId": "user_123",
  "userEmail": "jane@acme.com",
  "timestamp": 1712505600000,
  "structuredEvents": [...],
  "rrwebEvents": "<base64-compressed>"
}

→ 202 Accepted (async write)
→ 401 Unauthorized (invalid key)
→ 429 Too Many Requests + Retry-After header
→ 413 Payload Too Large (>1MB)
```

CORS enabled: `Access-Control-Allow-Origin: *`
Rate limit: 100 req/s per workspace.

### Replay Chunk Delivery

```
GET /api/rest/sessions/:sessionId/replay/:sequence
Authorization: Bearer <session-token>

→ 200 OK (application/octet-stream, raw binary)
→ 404 Not Found
```

### tRPC Queries (Internal)

```typescript
sessionReplay.getEvents({ sessionRecordId, limit?, cursor? })
sessionReplay.correlate({ userEmail?, userId?, windowStartAt, windowEndAt })
sessionReplay.getSession({ sessionRecordId })
```

## Data Model

### SessionRecord

| Field | Type | Description |
|-------|------|-------------|
| id | cuid | Primary key |
| workspaceId | string | FK to Workspace |
| sessionId | string | Client-generated session ID |
| userId | string? | End-user identifier |
| userEmail | string? | For thread correlation |
| release | string? | App version |
| userAgent | string? | Browser info |
| startedAt | DateTime | First event timestamp |
| lastEventAt | DateTime | Most recent event |
| eventCount | int | Total structured events |
| hasReplayData | boolean | Whether rrweb chunks exist |
| metadata | Json? | Custom properties |

Unique: `[workspaceId, sessionId]`

### SessionEvent

| Field | Type | Description |
|-------|------|-------------|
| id | cuid | Primary key |
| workspaceId | string | FK to Workspace |
| sessionRecordId | string | FK to SessionRecord |
| eventType | enum | CLICK, ROUTE, NETWORK_ERROR, CONSOLE_ERROR, EXCEPTION |
| timestamp | DateTime | When the event occurred |
| url | string? | Page URL at time of event |
| payload | Json | Event-specific structured data |

Index: `[sessionRecordId, timestamp]`
Partitioned by month on `timestamp` column.

### SessionReplayChunk

| Field | Type | Description |
|-------|------|-------------|
| id | cuid | Primary key |
| workspaceId | string | FK to Workspace |
| sessionRecordId | string | FK to SessionRecord |
| sequenceNumber | int | Chunk order |
| compressedData | bytes | gzip-compressed rrweb events |
| eventCount | int | Events in this chunk |
| startTimestamp | DateTime | First event in chunk |
| endTimestamp | DateTime | Last event in chunk |

## Session-to-Thread Correlation

When a support thread arrives (via Slack), TrustLoop correlates it to a browser session:

1. Extract email addresses mentioned in the Slack thread messages (fuzzy regex match)
2. Query `SessionRecord` by matched email within 30-minute window before the thread timestamp
3. If multiple matches: pick the session with the most recent `lastEventAt`
4. Compile a `SessionDigest` from the matched session's structured events (LIMIT 200)

**Important**: The Slack thread author (bob@company.com) is NOT the end-user (jane@acme.com). Correlation relies on the thread mentioning the end-user's email. This is a fuzzy match and may be wrong. The UI displays match confidence.

## SessionDigest (AI Agent Input)

The AI agent receives a compiled digest, not raw events:

```typescript
{
  sessionId: "sess_abc123",
  userId: "user_123",
  duration: "3m 42s",
  pageCount: 5,
  routeHistory: ["/dashboard", "/settings", "/billing"],
  lastActions: [...],       // last 30 structured events
  errors: [...],            // all EXCEPTION events
  failurePoint: {           // last EXCEPTION/NETWORK_ERROR within 60s
    timestamp: "2026-04-07T10:15:25Z",
    type: "NETWORK_ERROR",
    description: "POST /api/flows/generate → 500 (1883ms)",
    precedingActions: [...]  // 5 events before failure
  },
  networkFailures: [...],
  consoleErrors: [...],
  environment: {
    url: "https://app.acme.com/dashboard",
    userAgent: "Chrome/126",
    viewport: "1920x1080",
    release: "1.2.3"
  }
}
```

## UI Design (Conversation Sheet)

### Tab-based Navigation

The conversation sheet uses tabs: **Timeline** | **Analysis** | **Session**

The Session tab has a green dot indicator when session data exists.

### Session Tab Layout

```
┌─ SESSION CONTEXT BAR ───────────────────┐
│ Session matched (fuzzy)                 │
│ jane@acme.com · 3m 42s · Chrome 126    │
│ Confidence: Possible match              │
└─────────────────────────────────────────┘

┌─ EVENT TIMELINE (virtualized) ──────────┐
│ 10:15:22  /dashboard          ROUTE     │
│ 10:15:24  Click "Generate"    CLICK     │
│ 10:15:25  POST /api/flows     ❌ 500    │ ← failure point
│ 10:15:26  Uncaught TypeError  ERROR     │
│ 10:15:30  /dashboard          ROUTE     │
└─────────────────────────────────────────┘

[▶ Open Replay]
```

### Replay Player (Full-Width Modal)

When the developer clicks "Open Replay", a full-width modal opens:
- Left (~70%): rrweb playback viewport
- Right (~30%): Event timeline sidebar (synced with playback)
- Bottom: Playback controls (play/pause, 1x/2x speed, scrub bar)

### Interaction States

| Component | Loading | Empty | Error |
|-----------|---------|-------|-------|
| Session tab | Skeleton rows | "No session data. SDK may not be installed." | "Failed to load. Retry." |
| Context bar | "Searching..." | "No matching session" | "Lookup failed" |
| Replay modal | "Loading chunks (2/7)..." | "No replay data available" | "Recording corrupted. Retry." |

## Privacy & Consent

- `maskAllText: true` and `maskAllInputs: true` by default (rrweb PII masking)
- Workspace-level toggle: `sessionCaptureEnabled` (default false, opt-in)
- SDK consent API: `startRecording()` / `stopRecording()`
- Visual recording indicator: small red dot when recording
- Retention: 7 days default (plan-gated for longer)

## Scaling Notes

- **SessionEvent** table: time-partitioned by month. At 1000 DAU per workspace, expect 100-500K rows/day.
- **SessionReplayChunk**: compressed rrweb stored as Postgres `bytea`. Migrate to S3 when table exceeds 50GB.
- **Ingest writes**: async (202 Accepted before DB write). Write failures are logged but not surfaced to SDK.
- **Rate limit**: 100 req/s per workspace (in-memory, per-instance).
- **API key auth**: `lastUsedAt` debounced (flush every 60s, not per-request).

## Related Docs

- [Positional JSON Format](spec-positional-json-format.md)
- [REST API Key Auth](spec-rest-api-key-auth.md)
- [AI Analysis Pipeline](spec-ai-analysis-pipeline.md)
