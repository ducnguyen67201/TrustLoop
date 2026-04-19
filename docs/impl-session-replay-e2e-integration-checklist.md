# Session Replay E2E Inbox + Analysis Integration Checklist

**Status**: Proposed
**Date**: 2026-04-18
**Paired spec**: [Session Replay E2E Inbox + Analysis Integration](spec-session-replay-e2e-integration.md)

This is a narrow implementation checklist for the conversation-thread matching,
inbox integration, replay interaction, and AI attach behavior defined in the
delta spec.

It does **not** replace the original broad session replay checklist. Use this
file for the `[ENG] Session Replay Fully E2E , typescript package, hook up into chat, Improve Session Replay`
task.

## 1. Shared contracts

- [x] Add shared identity-source constants under `packages/types/src/support/` or `packages/types/src/session-replay/`
- [x] Add shared session-match-source constants
- [x] Add shared schema/types for conversation/session match responses
- [x] Add `sessionReplay.getForConversation` response schema

## 2. Support conversation identity

- [x] Add normalized customer identity fields to the support conversation model/read model:
  - [x] `customerExternalUserId`
  - [x] `customerEmail`
  - [x] `customerSlackUserId`
  - [x] `customerIdentitySource`
  - [x] `customerIdentityUpdatedAt`
- [x] Populate those fields during support ingress / projection updates
- [x] Keep raw `detailsJson` unchanged for audit/debug purposes

## 3. Conversation/session match persistence

- [x] Add `SupportConversationSessionMatch` Prisma model
- [x] Add migration for the match table and indexes
- [x] Define one-primary-match semantics per conversation
- [x] Persist match provenance:
  - [x] `matchSource`
  - [x] `matchConfidence`
  - [x] `matchedIdentifierType`
  - [x] `matchedIdentifierValue`
  - [x] `score`
  - [x] `evidenceJson`

## 4. Matching service

- [x] Create a focused shared service for session/thread matching
- [x] Resolve conversation identity from first-class conversation fields before falling back to raw event parsing
- [x] Implement precedence order:
  - [x] exact `userId`
  - [x] exact normalized `userEmail`
  - [x] exact Slack profile email
  - [x] exact regex email fallback
- [x] Implement overlap-window logic using conversation activity times
- [x] Implement deterministic ranking for multiple candidates
- [x] Persist or update the primary match for the conversation

## 5. SDK deltas

- [x] Normalize email with trim + lowercase before flushing
- [x] Rotate `sessionId` when `setUser()` changes to a different concrete identity
- [x] Add `clearUser()` if needed by logout flow
- [x] Fix default SDK ingest path to `/api/rest/sessions/ingest`
- [x] Add or update SDK tests for identity change and normalization

## 6. Router and web data loading

- [x] Add `sessionReplay.getForConversation({ conversationId })`
- [x] Back the query with the shared matching service
- [x] Return:
  - [x] primary match metadata
  - [x] session record
  - [x] session brief
  - [x] timeline events
  - [x] `failurePointId`
- [x] Keep replay chunks as a separate lazy query
- [x] Replace client-derived rolling-window correlation in `use-session-replay.ts`

## 7. Analysis workflow reuse

- [x] Refactor analysis activity to use the shared matching service
- [x] Stop using a separate email-only correlation path in analysis
- [x] Attach `sessionDigest` only for strong matches
- [x] Keep regex-only matches visible in UI but not auto-attached to AI by default
- [x] Confirm agent request contract still uses the existing optional `sessionDigest` field

## 8. Session tab improvements

- [x] Show match source badge
- [x] Show confidence
- [x] Show deterministic session brief
- [x] Keep timeline and replay entrypoint in the same tab
- [x] Handle no-match, fuzzy-match, and strong-match states clearly

## 9. Replay interaction improvements

- [x] Clicking an event in the compact Session tab opens replay at that event
- [x] Clicking an event in the replay sidebar jumps to the nearest replay point
- [x] Compute replay jumps relative to replay event timestamps, not wall-clock time
- [x] Clamp gracefully when the event timestamp lies outside replay coverage
- [x] Add `Jump to failure` action
- [x] Add back 5s / forward 5s controls
- [x] Keep selected-event highlighting in sync with playback

## 10. Testing

### Matching

- [x] `userId` beats email
- [x] exact email beats regex email
- [ ] overlap-window logic catches sessions that started before the first customer message
- [ ] deterministic winner selection for multiple candidates
- [x] regex-only match remains `fuzzy`

### SDK and ingest

- [x] normalized email persists correctly
- [x] identity change rotates session
- [x] default SDK ingest route matches the real web route

### Inbox and replay UI

- [ ] opening a conversation shows the primary matched session
- [ ] Session tab shows source, confidence, and session brief
- [ ] event click opens replay and jumps correctly
- [ ] `Jump to failure` lands near the failure point

### Analysis

- [x] analysis uses the shared matching service
- [x] strong matches attach `sessionDigest`
- [x] regex-only matches do not auto-attach

### Manual end-to-end

- [ ] Demo app session with exact `userId` match
- [ ] Demo app session with exact email-only match
- [ ] Multiple sessions for one email in the same time window
- [ ] No session match case
- [ ] Replay click-to-jump flow in `/{workspaceId}/support`

## 11. Docs

- [x] Add delta spec: `docs/spec-session-replay-e2e-integration.md`
- [x] Keep this checklist in sync with implementation
- [x] Update the original broad checklist only where needed to avoid conflicting status
