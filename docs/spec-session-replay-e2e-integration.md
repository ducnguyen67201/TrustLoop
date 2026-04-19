# Session Replay E2E Inbox + Analysis Integration

**Status**: Proposed
**Date**: 2026-04-18
**Type**: Delta spec
**Base docs**:
- [Session Replay SDK + Error Context Capture Pipeline](spec-session-replay-sdk.md)
- [AI Analysis + Draft Generation Pipeline](spec-ai-analysis-pipeline.md)
- [Session Replay E2E Inbox + Analysis Integration Checklist](impl-session-replay-e2e-integration-checklist.md)

## Scope

This doc is intentionally narrow.

It does **not** restate capture architecture, ingest/storage design, or the
basic Session tab/replay concepts already defined in
`spec-session-replay-sdk.md`.

It only defines the missing end-to-end decisions for this task:

- how a browser session is matched to a support conversation
- how that same match is reused by inbox UI and AI analysis
- how replay event clicks should behave
- what operators can see in the Session tab beyond raw events

If this doc conflicts with the broader session replay spec, this doc wins for
matching, inbox integration, and replay interaction behavior.

## Problem statement

The repo already captures `userId` and `userEmail` into `SessionRecord`, and it
already renders a `Session` tab in the support UI. The unresolved part is the
contract in the middle:

- the support analysis path and the inbox UI do not use one shared match result
- matching still leans too heavily on email-only flow
- the support conversation model does not expose normalized customer identity as
  first-class data
- replay event clicks are wired, but the jump behavior is not explicitly defined
- there is no operator-facing brief that quickly answers "what was the user doing?"

## Decisions

### 1. Matching precedence

Session matching is deterministic and server-side only.

Use this precedence order:

1. exact `userId`
2. exact normalized `userEmail`
3. exact email from Slack `users.info`
4. exact email extracted from customer-authored thread text via regex

Rules:

- `userId` outranks every email-based signal
- regex email is fallback only, never primary if stronger identity exists
- no domain-only or fuzzy string matching
- matching stays scoped by `workspaceId`

### 2. Email normalization

V1 normalization is:

- trim
- lowercase

Do **not** do Gmail-specific transformations such as dot folding or
plus-address stripping in this phase.

### 3. Conversation/session time window

The UI must stop sending a rolling client-derived `now - 30 minutes` window.

The server derives the candidate window from the conversation itself:

- `windowStartAt = firstCustomerMessageAt - 30 minutes`
- `windowEndAt = lastCustomerMessageAt + 15 minutes`

A session is eligible when it overlaps the conversation window:

- `session.startedAt <= windowEndAt`
- `session.lastEventAt >= windowStartAt`

This replaces simpler logic that only checks whether `lastEventAt` falls inside
the window.

### 4. Candidate ranking

When multiple sessions are eligible, rank them in this order:

1. exact `userId` match
2. exact conversation-level email match
3. exact Slack profile email match
4. exact regex email match
5. smallest temporal distance to `firstCustomerMessageAt`
6. latest `lastEventAt`

### 5. Confidence and AI attach policy

Confidence:

- `confirmed`: exact `userId`, exact normalized email, or exact Slack profile email with a clear winner
- `fuzzy`: regex-only match or near-tie between candidates
- `none`: no candidate

AI attach policy:

- strong matches auto-attach `sessionDigest` to the existing analysis request
- regex-only matches remain visible in UI but do **not** auto-attach to AI by default
- this phase does not add a second standalone LLM summarizer for sessions

## Data model deltas

### Conversation identity

Add normalized customer identity onto the support conversation read model so
callers stop reparsing `detailsJson` independently.

Add:

- `customerExternalUserId String?`
- `customerEmail String?`
- `customerSlackUserId String?`
- `customerIdentitySource String?`
- `customerIdentityUpdatedAt DateTime?`

`customerIdentitySource` should be a shared enum-style constant in
`packages/types`.

Suggested values:

- `ADAPTER_PAYLOAD`
- `SLACK_PROFILE`
- `MESSAGE_PAYLOAD`
- `MESSAGE_REGEX`
- `MANUAL`

### Conversation/session match record

Persist match provenance in a dedicated join model instead of mutating
`SessionRecord` with one `conversationId`.

Proposed model: `SupportConversationSessionMatch`

Fields:

- `workspaceId`
- `conversationId`
- `sessionRecordId`
- `matchSource`
- `matchConfidence`
- `matchedIdentifierType`
- `matchedIdentifierValue`
- `score`
- `evidenceJson`
- `isPrimary`

This lets the system:

- keep one primary match for inbox and analysis
- retain candidate history
- explain why a session was selected

## Runtime and API deltas

### Shared matching service

All matching must go through one shared server-side service used by both:

- inbox/session UI
- support analysis workflow

Suggested service surface:

- `resolveConversationIdentity(conversationId)`
- `findSessionCandidates(workspaceId, identity, window)`
- `rankSessionCandidates(candidates, anchorTimes)`
- `upsertPrimarySessionMatch(conversationId, candidate)`
- `getPrimarySessionMatch(conversationId)`

### Conversation-centric query

Replace ad hoc client correlation with a server-resolved query:

`sessionReplay.getForConversation({ conversationId })`

Suggested response:

- `match`
- `session`
- `sessionBrief`
- `events`
- `failurePointId`

Replay chunks stay lazy-loaded on a separate query.

### Analysis workflow reuse

The queue analysis activity must use the same shared matching service instead of
custom email-only correlation logic.

That means:

- one server-side source of truth for the chosen session
- one attach policy for `sessionDigest`
- no UI/analysis disagreement about which session belongs to the thread

### SDK deltas

The TypeScript SDK remains the only browser integration surface.

Required deltas:

- normalize email before flushing
- rotate `sessionId` if `setUser()` changes from one concrete user to another
- optional `clearUser()` support after logout
- default ingest path must match the real route: `/api/rest/sessions/ingest`

## UI deltas

### Session tab

The Session tab should show:

- match state
- match source badge
- confidence
- short session brief
- event timeline
- replay entrypoint

The session brief should be deterministic and derived from `SessionDigest`, not
produced by a separate LLM job.

V1 brief shape:

- 1 headline sentence
- up to 3 short bullets

Example:

- `User moved from /billing to /settings, tried Save, and hit a 500.`
- `Last route: /settings`
- `Failure: POST /api/account -> 500`
- `Console: TypeError after failed request`

### Replay event click behavior

Clicking an event from the compact Session tab timeline or the replay sidebar must:

1. open the replay if needed
2. highlight the selected event
3. jump the player to the nearest replay point for that event

Jump contract:

- compute offsets relative to replay event timestamps, not wall-clock `Date.now()`
- if the exact structured-event timestamp is missing, jump to the nearest replay event at or before it
- if outside replay coverage, clamp to the nearest available point and show a small hint

### Required replay controls

This phase should include:

- play/pause
- 1x / 2x / 4x / 8x speed
- back 5s / forward 5s
- jump to failure point
- current-event highlighting while playback advances

## AI analysis deltas

Use the existing `sessionDigest` field on the analysis request.

For this phase:

- attach session context to the existing analysis call when match policy allows
- let the current analysis agent use that context in `reasoningTrace` and draft when relevant
- do not add a second LLM workflow just to summarize the session

The operator-facing "what the user was doing" summary is handled by the
deterministic Session tab brief, not a new AI contract.

## Test matrix

### Matching

- exact `userId` beats exact email
- exact email beats regex email
- overlap-window logic catches sessions that started before the first customer message
- multiple candidates rank deterministically
- regex-only match is visible in UI but not auto-attached to AI

### SDK and ingest

- normalized email persists correctly
- identity change rotates session
- default SDK ingest route matches the web route

### Inbox and replay UI

- opening a conversation shows the primary matched session
- the Session tab displays source, confidence, and session brief
- clicking an event opens replay and jumps to the correct replay point
- `Jump to failure` lands near the failure point

### Analysis

- analysis uses the shared match service
- strong matches attach `sessionDigest`
- weak regex-only matches do not auto-attach

## Acceptance criteria

- Inbox UI and analysis workflow use the same server-side session match result.
- Session matching prefers `userId` over `userEmail`, and exact email over regex.
- Conversation-level identity is modeled explicitly instead of being rebuilt from
  raw event payloads everywhere.
- Replay event clicks are deterministic and jump to the correct replay-relative point.
- Operators can quickly understand the session from the Session tab without opening
  the full replay first.
