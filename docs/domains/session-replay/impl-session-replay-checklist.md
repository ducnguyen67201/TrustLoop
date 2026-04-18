# Session Replay Implementation Checklist

**Branch**: `duc/session-replay`
**Date**: 2026-04-07

## Week 1: SDK + Ingest + AI Integration

### 1.1 Shared Types
- [x] `packages/types/src/session-replay/session-event.schema.ts`
- [x] `packages/types/src/session-replay/session-digest.schema.ts`
- [x] `packages/types/src/session-replay/session-replay.schema.ts`
- [x] `packages/types/src/session-replay/index.ts`
- [x] `packages/types/src/positional-format/session-digest.ts`
- [x] Update `packages/types/src/index.ts`

### 1.2 Database Schema
- [ ] `packages/database/prisma/schema/session-replay.prisma`
- [ ] Add session replay relations to Workspace model in `auth.prisma`
- [ ] Add `sessionCaptureEnabled` Boolean to Workspace
- [ ] Run `db:generate` to verify schema
- [ ] Create migration with time-based partitioning on SessionEvent

### 1.3 SDK Package
- [ ] `packages/sdk-browser/package.json`
- [ ] `packages/sdk-browser/tsconfig.json`
- [ ] `packages/sdk-browser/tsup.config.ts`
- [ ] `packages/sdk-browser/vitest.config.ts`
- [ ] `packages/sdk-browser/src/index.ts`
- [ ] `packages/sdk-browser/src/types.ts`
- [ ] `packages/sdk-browser/src/session.ts`
- [ ] `packages/sdk-browser/src/ring-buffer.ts`
- [ ] `packages/sdk-browser/src/capture.ts`
- [ ] `packages/sdk-browser/src/recorder.ts`
- [ ] `packages/sdk-browser/src/transport.ts`
- [ ] `packages/sdk-browser/src/consent.ts`
- [ ] Tests: ring-buffer, transport, capture, session, consent

### 1.4 Ingest Endpoint
- [ ] `packages/rest/src/security/ingest-rate-limit.ts`
- [ ] Debounce `lastUsedAt` in `rest-auth.ts`
- [ ] `apps/web/src/server/http/rest/sessions/ingest.ts` (CORS + async writes)
- [ ] `apps/web/src/app/api/rest/sessions/ingest/route.ts`
- [ ] `apps/web/src/server/http/rest/sessions/replay-chunk.ts`
- [ ] `apps/web/src/app/api/rest/sessions/[sessionId]/replay/[sequence]/route.ts`
- [ ] Tests: auth, CORS, validation, rate limit, async write

### 1.5 Session Correlation + Agent Prompt
- [ ] `extractEmailsFromEvents()` helper in analysis activity
- [ ] `compileSessionDigest()` helper
- [ ] Session correlation in `buildThreadSnapshot`
- [ ] `buildAnalysisPromptWithContext()` in agent prompt
- [ ] `formatSessionDigestForPrompt()` helper
- [ ] Update `analyzeRequestSchema` with optional `sessionDigest`
- [ ] Tests: email extraction, digest compilation, correlation flow

### 1.6 tRPC Router
- [ ] `packages/rest/src/session-replay-router.ts`
- [ ] Export from `packages/rest/src/index.ts`
- [ ] Wire into app router in `apps/web`
- [ ] Tests: getEvents, correlate, getSession

## Week 2: UI

### Timeline Panel + Replay Viewer
- [x] `apps/web/src/components/session-replay/session-context-bar.tsx`
- [x] `apps/web/src/components/session-replay/session-event-timeline.tsx`
- [x] `apps/web/src/components/session-replay/session-replay-modal.tsx`
- [x] `apps/web/src/components/session-replay/session-tab.tsx`
- [x] `apps/web/src/components/session-replay/index.ts`
- [x] `apps/web/src/hooks/use-session-replay.ts`
- [x] Tab-based navigation in `support-conversation-sheet.tsx`
- [ ] Install shadcn `tabs` component
- [x] Install shadcn `progress` component

## Week 3: Polish
- [ ] Retention job (Temporal workflow to purge expired sessions)
- [ ] SDK install docs page in settings UI
- [ ] GDPR cascade delete endpoint
- [ ] Bundle size verification
- [ ] Consent framework: visual recording indicator styling

## Docs
- [x] `docs/domains/session-replay/spec-session-replay-sdk.md`
- [x] `docs/domains/session-replay/impl-session-replay-checklist.md`

## Architecture Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | Debounce lastUsedAt (60s) | Reduce 100 writes/s to ~1/60s per key |
| 2 | Inline CORS in ingest handler | Only CORS surface in the app |
| 3 | LIMIT 200 on correlation query | Bound query time in 30s activity |
| 4 | Async acknowledge-then-write (202) | Don't block on DB at 100 req/s |
| 5 | bytea now, S3 at 50GB | Boring by default |
| 6 | Full Prisma relations | Match existing conventions |
| 7 | tsup for SDK build | Standard ESM browser bundle tool |
| 8 | Full test suite (happy-dom) | Complete browser capture coverage |
| 9 | Drop unused SessionEvent index | Fewer indexes = faster inserts |
| 10 | Fuzzy email match from thread | MVP correlation for Slack-to-session join |
| 11 | Full consent framework | Privacy as week-0 constraint |
| 12 | tRPC for JSON, REST for chunks | Right tool for right delivery format |
