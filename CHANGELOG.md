# Changelog

All notable changes to TrustLoop will be documented in this file.

## [0.2.0.0] - 2026-04-19

### Added
- **Approved drafts actually reach Slack.** This closes the customer-visible happy path: Slack message in → AI analysis → draft reply → operator approval → reply posts back into the original Slack thread. Previously `approveDraft()` flipped draft status to `APPROVED` and stopped; nothing ever called `chat.postMessage`. Now approval kicks off a new Temporal workflow on the `SUPPORT` queue that does the send, observes Slack's response, and writes the delivery state back to the draft. First-customer pilot is no longer blocked on the reply never being sent.
- **Ambiguous-delivery reconciliation.** Transient Slack failures (network timeout, retryable 5xx that may have already been accepted server-side) no longer risk duplicate replies. The draft transitions to a new `DELIVERY_UNKNOWN` state and a reconciler queries `conversations.replies` for the draft's `client_msg_id`. Found → `SENT` with the recovered thread ts. Not found → one more send attempt. Still failing → `SEND_FAILED`. The native Slack `client_msg_id` nonce is generated once at draft creation time so both Slack server-side dedup and reconciliation lookups use the same key.
- **Double-approval is now safe.** A double-click on the approve button or a duplicate tRPC call can no longer post the reply twice. `approveDraft()` wraps the status flip and a new `DraftDispatch` outbox insert in a single Prisma transaction with a compare-and-swap (`updateMany where status=AWAITING_APPROVAL`). The workflow dispatch uses a deterministic workflow ID (`send-draft-${draftId}`) with Temporal's `REJECT_DUPLICATE` reuse policy. The outbox row means a Temporal outage after commit still leaves work the sweep workflow can retry.
- **New observability events.** `DRAFT_SENT` and `DRAFT_SEND_FAILED` conversation events are emitted so the inbox UI and downstream analytics can see every delivery outcome.
- **Raised AI-generated PR size caps to realistic numbers.** The previous `MAX_FILES_PER_PR = 5` cap was too tight for typical bug fixes that also need to touch migrations, callers, and tests. The new caps are `MAX_FILES_PER_PR = 20` and a new `MAX_TOTAL_LINES_CHANGED_PER_PR = 500`. Calibration is backed by code-review research: median OSS PR is ~30 LOC / 2 files, Cisco found PRs over 400 LOC catch fewer bugs, and 200 LOC is the bar for "90% chance of completing review in an hour." Both caps intentionally sit above typical output so they only fire on runaway diffs, not legitimate fixes. Error messages now instruct the agent to split or escalate rather than silently failing.

### Changed
- **`SupportDraft` schema extended** with `deliveredAt`, `deliveryError`, `sendAttempts`, `slackClientMsgId` (unique), `slackMessageTs`. `SupportDraftStatus` enum gains `SENDING`, `SEND_FAILED`, `DELIVERY_UNKNOWN`. New `DraftDispatch` outbox model + `DraftDispatchKind` / `DraftDispatchStatus` enums.
- **Draft state machine** gains `startSending`, `sendSucceeded`, `sendFailed`, `deliveryUnknown`, `reconcileFound`, `reconcileRetry` events covering the new send loop. The happy path is now `GENERATING → AWAITING_APPROVAL → APPROVED → SENDING → SENT`. Property-style FSM coverage tests are added for every new transition.
- **Slack delivery adapter** accepts a `clientMsgId` and forwards it as `chat.postMessage.client_msg_id`. New `findReplyByClientMsgId` helper wraps `conversations.replies` for the reconciler.
- **`approveDraft()` signature** now takes the workflow dispatcher alongside the input. The tRPC router passes it through.

## [0.1.8.1] - 2026-04-19

### Added
- **Local prompt-rendering foundation for the agents runtime.** Support analysis prompts now build through a typed prompt document and renderer seam inside `apps/agents`, instead of assembling everything through one growing string builder. The new seam stays local to the agents service, which keeps `packages/types` free of renderer-only abstractions while making future prompt growth easier to manage.
- **TOON input-serialization support and benchmark fixtures.** Added the official `@toon-format/toon` SDK plus renderer utilities for JSON and TOON serialization. TOON is not live by default yet, but the branch now has fixture tests that compare candidate structured payloads and prove fallback behavior before any production rollout.
- **Agents package test coverage for prompt infrastructure.** `@trustloop/agents` now has a real `vitest` test suite and Biome lint coverage for `src/` and `test/`, including new tests for prompt document rendering, TOON format selection, serializer fallback, and benchmark fixtures.
- **Implementation plan for staged TOON rollout.** Added `docs/plans/impl-plan-toon-prompt-foundation.md`, documenting the reviewed rollout: local-first renderer seam, measurement before live TOON enablement, delayed shared-package extraction, and explicit follow-up work for the `threadSnapshot` contract.

### Changed
- **Support-analysis prompt assembly now uses the new local renderer seam without changing live behavior.** `buildSupportAgentSystemPrompt()` and `buildAnalysisPromptWithContext()` now render from a prompt document, but the current support-analysis prompt text stays JSON-equivalent and session-context behavior remains intact while TOON stays behind the seam.
- **Prompt rollout strategy is now benchmark-led, not format-led.** The plan and TODOs now explicitly defer shared-package extraction and `threadSnapshot` contract redesign, and treat TOON as a measured optimization rather than a new repo-wide prompt platform.

## [0.1.8.0] - 2026-04-19

### Added
- **Workspace-scoped real-time support inbox updates.** The support page now opens a single authenticated SSE stream at `/api/{workspaceId}/support/stream` and refreshes immediately when a conversation changes, instead of waiting for a manual refresh or a tight polling loop. The server side uses a shared Postgres `LISTEN/NOTIFY` fanout layer in `support-realtime-service.ts`, so each `web` instance keeps one listener connection and only forwards invalidation events to subscribers in the matching workspace. The browser receives tiny invalidation events, not full payloads, then reuses the existing inbox/timeline queries as the source of truth.
- **Focused realtime contracts and tests.** Added `packages/types/src/support/support-realtime.schema.ts` for the SSE event envelope plus targeted tests for the schema and the browser stream hook. This locks the event shape to `{ workspaceId, conversationId, reason, occurredAt }` and keeps message content out of the stream.
- **Engineering spec for the rollout.** Added `docs/domains/support/spec-support-inbox-realtime-sse.md`, documenting why this feature uses SSE instead of WebSockets, how workspace isolation works, the rollout phases, and the migration path if Postgres fanout eventually needs to move to Redis or another bus.

### Changed
- **Support inbox refresh strategy is now event-first, polling-second.** `support-inbox.tsx` now relies on the SSE stream for primary freshness and keeps a 60-second visibility-aware recovery poll as a backstop. The open conversation drawer only refreshes when the incoming invalidation matches the selected conversation.
- **Support write paths now emit committed invalidations.** Slack ingress processing, assignee changes, status changes, delivery updates, and reaction toggles all publish workspace-scoped `CONVERSATION_CHANGED` events only after their authoritative writes commit. That keeps the realtime path consistent with the actual persisted state and avoids speculative client refreshes.

## [0.1.7.1] - 2026-04-12

### Added
- **Slack Functionality P0 engineering spec** landed at `docs/domains/support/spec-slack-functionality-p0.md`. Execution source of truth for the next Slack inbox push: mirror inbound customer files to Cloudflare R2, deliver outbound replies with real Slack file uploads and human agent identity (`chat:write.customize`), cache customer identity per install, and survive Slack Connect + reinstall windows without silent degradation. Covers schema (`SupportMessageAttachment` + `SupportCustomerProfile` + `SupportAttachment{Direction,UploadState,LifecyclePolicy}` enums + `SupportInstallation.oauthScopes` column), the workflow-dispatches-activity mirror pattern, Slack Connect `file_access: check_file_info` stub handling, single-message atomicity via `files.completeUploadExternal` `initial_comment` with a two-entry fallback path, first-party session-cookie auth for `/api/support/attachments/*` (out of `/api/rest/*`), full responsive + a11y spec calibrated against DESIGN.md, 25MB outbound / 100MB inbound size caps, and a nightly R2 garbage-collection sweeper for soft-deleted attachments. Flags a P0 pre-work PR: `slack-oauth-service.ts` currently upserts `SupportInstallation` rows on `providerInstallationId = appId` (Slack App ID), which collides across tenants and must be fixed before this work lands.

## [0.1.7.0] - 2026-04-12

### Changed
- **`messageTs` promoted to a first-class column on `SupportConversationEvent`.** Thread-parent resolution previously used a JSONB path filter (`detailsJson->>'messageTs' = $1`) which can't use a JSONB GIN index and forces a sequential scan over every event in the conversation. Now a real text column with a composite `(conversationId, messageTs)` B-tree index. Reply latency goes from O(events-per-conversation) to O(log n). Ingest writes still mirror `messageTs` into `detailsJson` for forensic lookup — removing the mirror is a future cleanup once we're confident nothing reads it.
- **Thread-parent resolution extracted to `supportEvents.resolveParentEventId`.** Both the ingress path (`runSupportPipeline`) and the reply path (`sendReplyWithRecordedAttempt`) now call the shared service instead of each maintaining their own inline query. Walk-up rule, defensive stale-client guard, and structural-client typing live in one place — `packages/rest/src/services/support/support-event-service.ts`. 5 new unit tests cover root/child/walk-up/scoping/structural-client cases.
- **`useConversationReply` hook extracted from `conversation-view.tsx`.** The component now owns layout and delegation; the hook owns timeline polling + reply/send/retry state and handlers. Reply flow can be tested in isolation and Pillar A's multi-file upload state will have a clean home instead of piling on top of the component.

### Added
- **Migration `20260412050000_support_event_message_ts_column`.** Adds the `messageTs` column, backfills it from `detailsJson`, and creates the composite index. 32 existing rows backfilled during development. Ingress writes the column alongside the detailsJson mirror going forward.

## [0.1.6.0] - 2026-04-12

### Changed
- **Thread hierarchy resolved server-side, not at render time.** Events now carry a first-class `parentEventId` column on `SupportConversationEvent`, populated at ingress (for customer messages) and at reply delivery (for operator messages) from Slack's `thread_ts`. The inbox UI groups children by this field directly — no more `threadTs ↔ messageTs` matching in the browser. Keeps the UI trivial and moves thread awareness into the data model where it belongs.
- **Parent resolution walks up one hop** when the direct lookup lands on a thread child. When the operator clicks "reply" on a thread reply (which sets the resolver target to the child's messageTs), the server normalizes to the thread root so every reply points at the top-of-thread. Matches Slack's own thread flattening — there's no real "sub-thread" concept.

### Added
- **Migration `20260412040000_support_event_parent_event_id`.** Adds the nullable `parentEventId` column with a self-referential FK (`SET NULL` on delete), plus an index for child-lookup queries. Includes a two-step backfill: first pass matches `threadTs → messageTs` across all existing events, second pass walks grandchildren up to their true root.

### Removed
- **Client-side thread tree matching.** The old `buildThreadTree` consulted `threadTs`, `messageTs`, and `replyToEventId` with fall-through rules to build the hierarchy in the browser. Replaced with a 10-line group-by on `parentEventId`. The rule set shrunk from 4 rules to 1.

## [0.1.5.0] - 2026-04-12

### Fixed
- **Inbox now renders Slack threads as threads.** Previously the conversation view showed every event in flat chronological order, which turned a threaded Slack conversation into a jumble of interleaved messages. The tree builder now reads `threadTs` on each event and groups thread children under their parent: customer thread replies, operator replies whose resolver targeted a specific thread, and explicit "reply to this message" replies all collapse to one level of nesting under the correct parent. Each customer burst (standalone top-level message) is its own top-level thread in the view. When the operator clicks "reply" on a message that's itself a thread reply, the new reply is flattened to sit alongside it under the thread parent, matching Slack's own flattening behavior.
- **Grandchild nesting bug.** The previous nesting logic matched only `replyToEventId` and would put a reply under a thread child, creating a grandchild that the `MessageThread` component doesn't recurse into. The reply would then fail to render at all. The new resolver normalizes reply targets to the thread root.

### Added
- **`apps/web/src/components/support/thread-tree.ts`.** Extracted the tree-building logic from `message-list.tsx` into a pure module with 8 unit tests in `apps/web/test/thread-tree.test.ts`. Covers standalone messages, threaded replies via `threadTs`, explicit `replyToEventId` paths, replyToEventId-pointing-at-a-child normalization, orphaned thread references, and preservation of event order inside each bucket.

## [0.1.4.0] - 2026-04-12

### Added
- **Replies land wherever the customer is active.** If the customer replied inside a specific Slack thread, the operator's reply continues that thread. If the customer sent a new standalone message in the channel, the operator's reply threads off that message directly. One TrustLoop conversation can now own multiple Slack threads without fragmenting. Explicit "reply to this message" from the UI still overrides. This is what v0.1.1.0's "burst-sensitive" attempt was trying to do, but it lacked the routing infrastructure; v0.1.4.0 adds it.
- **`SupportConversationThreadAlias` table.** A new join table tracks every Slack thread a conversation has ever spawned. Ingress looks up incoming customer thread-replies against this table before canonical-key fallback, so responses to any of the conversation's threads route back to the original conversation instead of creating a phantom new one. Unique on `(installationId, channelId, threadTs)`; cascades on conversation/installation delete.

## [0.1.3.0] - 2026-04-12

### Fixed
- **Customer replies no longer spawn phantom conversations.** When v0.1.1.0 introduced burst-sensitive thread targeting (each cluster of customer messages got its own Slack thread), a routing bug emerged: if the operator's reply started a new Slack thread anchored on a later message, the customer's response to that thread came back with a `thread_ts` that didn't match the conversation's canonical key, and ingress would create a brand-new conversation for it. The inbox looked like the thread history had been lost. Fixed by reverting to conversation-anchored thread targeting: every operator reply now targets the conversation's root `thread_ts` (the first customer message), so every customer response lands back in the same conversation. Explicit "reply to this specific message" from the UI still overrides.

## [0.1.2.0] - 2026-04-12

### Changed
- **Slack ingress filter now distinguishes our own bot from other bots.** Previously we dropped every bot-authored Slack message at the ingress boundary to stop `chat.postMessage` echoes from leaking into the inbox. That was correct for echoes but over-aggressive: it also silently threw away messages from other integrations posting in the same channel (e.g. a GitHub app uploading a PR diff). The filter now compares each event's `user` field against `installation.botUserId` (captured at OAuth install time) and drops only our own bot. Other-integration bot messages pass through and will be mirrored once file-attachment support lands. Legacy installs where `botUserId` is null fall back to the old blanket drop — safe default until they re-install or backfill the field.
- **Dev seed honors `SLACK_DEV_BOT_USER_ID` env var.** If you're dev-testing against a real Slack workspace, set `SLACK_DEV_BOT_USER_ID` in `.env` to your workspace's actual bot user ID so the echo filter works out of the box. Without the env var, the seed uses a placeholder that only works for synthetic (no-real-Slack) dev loops.

## [0.1.1.0] - 2026-04-12

### Fixed
- **Session replay recordings now actually land in the database.** Every browser session flushed by the TrustLoop SDK was silently failing to write because Prisma's `upsert()` cannot target a partial unique index. Replaced with a manual find-or-create inside the existing transaction. Session replay history picks up the moment the fix deploys.
- **Operator replies no longer show up as duplicate customer messages.** Slack's Events API echoes every `chat.postMessage` call back as a new message event, and the old ingress pipeline was ingesting those echoes as customer bubbles in the inbox, making it look like the customer was saying the same thing as the operator. The ingress now drops bot-authored and system-noise events (edits, pins, channel joins) at the boundary.
- **Replies now land in the most relevant Slack thread.** When a customer sends several messages in a row, the operator's reply targets whichever message is newest at send time, then every follow-up reply in that same burst stays in the same thread. Previous behavior threaded everything off the first-ever message in the conversation, which pushed operator answers out of the visual conversation flow. Explicit "reply to this message" from the inbox UI still overrides.

### Changed
- **Queue worker dev script now uses `tsx watch`.** Editing activities or workflow code under `apps/queue/src` triggers an automatic worker restart, eliminating a whole class of "why isn't my fix taking effect" bugs.
- **Naming convention for Temporal workflow/activity files.** Every artifact for a feature now shares one hyphenated prefix (`support-analysis.workflow.ts`, `support-analysis.activity.ts`, `support-analysis.schema.ts`, `support-analysis-service.ts`) so a single fuzzy search surfaces all of it. Renamed the support-analysis workflow + trigger files to match. Documented in `AGENTS.md` as a non-negotiable naming rule.

## [0.1.0.0] - 2026-04-11

### Added
- **Google sign-in.** New users can click "Continue with Google" on `/login` and land in TrustLoop without ever creating a password. Google is now the primary sign-in CTA; email/password is available behind a disclosure link. No existing users are affected.
- **Workspace auto-join by verified email domain.** When a user signs in with Google at a domain that already has a TrustLoop workspace (e.g. `@acme.com` → the Acme workspace), they join it automatically as a MEMBER. No admin invite required. Email must be Google-verified as a defense-in-depth check against domain spoofing. Personal email domains (gmail, outlook, etc.) are explicitly blocked from matching.
- **Warm `/no-workspace` experience for new customers.** First-time users from a domain without a TrustLoop workspace land on a friendly "Your team hasn't set up TrustLoop yet — email hello@trustloop.com" page. The TrustLoop team provisions workspaces manually during customer onboarding.
- **Funnel-level audit events.** `auth.google.first_sign_in` fires on first-ever Google sign-in with the user's email domain and whether it matched a workspace. `auth.google.auto_joined` fires when auto-join actually happens. Every callback also emits a structured log line with the outcome (`new_user_auto_joined` / `new_user_no_workspace` / `returning_user`) for future support questions.
- `AuthIdentity` model linking `(provider, providerAccountId)` to `User`, with schema hooks for GitHub, Microsoft, and SAML providers later at ~30 minutes each.
- `Workspace.emailDomain` column with partial unique index for auto-join lookups.
- `User.name` and `User.avatarUrl` nullable columns, populated from the Google profile on first sign-in.

### Changed
- `User.passwordHash` is now nullable. Google-only users have no password.
- Password login in `auth-router.ts` now rejects null-hash users with the same generic 401 as a wrong-password attempt. No information leaks about which accounts exist or which provider they're linked to.
- `UserIdentity` TS type in `user-service.ts` renamed to `UserIdentityRecord` to free the name for the new Prisma model.

### Infrastructure
- `jose@6.2.2` added to `@shared/rest` for Google id_token verification with JWKS caching and rotation.
- `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, and `GOOGLE_OAUTH_REDIRECT_PATH` env vars added to the shared schema (all optional — Google sign-in is hidden when unset).
- New routes `/api/auth/google/start` and `/api/auth/google/callback`.
- New `auth.providers` publicProcedure on the tRPC auth router for CLI/test clients.

## [0.0.1.0] - 2026-04-03

### Added
- Soft delete support for all Tier 1 models (User, Workspace, WorkspaceMembership, WorkspaceApiKey, SupportInstallation, SupportConversation, SupportDeliveryAttempt, SupportTicketLink)
- Prisma Client extension that auto-filters soft-deleted records from all read queries
- Partial unique indexes so disconnecting and reconnecting Slack (or removing and re-adding members) no longer hits unique constraint errors
- Cascade soft delete services for workspace, installation, and conversation hierarchies
- Typed `resurrectOrUpsert()` helper that handles the check-deleted / resurrect / or-create pattern
- `cascadeDeactivateUser()` function that soft-deletes a user and hard-deletes their sessions
- Purge function for permanently removing records past 90-day retention
- Spec document covering model classification, schema changes, and edge cases

### Changed
- Slack disconnect now soft-deletes the installation and cascades to conversations
- Workspace member removal now soft-deletes instead of hard-deleting
- Conversation upsert now checks for and resurrects soft-deleted records with the same canonical key
- Session resolution now blocks soft-deleted users at request time
- FK cascade rules changed from CASCADE to RESTRICT on soft-deletable parent models
