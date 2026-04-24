# TODOS

## Doc Philosophy Enforcement

### Scoped `AGENTS.md` per subtree

**What:** Add a scoped `AGENTS.md` under `apps/web/`, `apps/queue/`, `apps/agents/`, `packages/rest/`, `packages/types/`, `packages/database/`. Each file lists the rules that apply inside that subtree (e.g. "all Prisma reads/writes go through services", "no direct `prisma.*` calls in routers"). Mirror openclaw/openclaw's per-subtree AGENTS.md pattern.

**Why:** Root AGENTS.md is 450+ lines and agents don't always read it end-to-end for scoped tasks. Per-subtree files let agents pull only the rules relevant to the file they're editing. Openclaw's "no plans committed" discipline holds because every subtree enforces its own rules; TrustLoop just adopted "no plans" but lacks the matching enforcement structure.

**Context:** Deferred from the 2026-04-21 docs-cleanup /autoplan. Both CEO dual voices flagged that a philosophy section without scoped enforcement will erode.

**Effort:** M (human) / M (CC — ~1 hour per subtree, 6 subtrees)
**Priority:** P2
**Depends on:** Nothing. Do as small PRs, one subtree at a time.

### CI lint blocking forward-looking doc patterns

**What:** Add a CI check that fails the build if any of: `docs/plans/**/*.md`, `docs/specs/**/*.md`, `docs/domains/**/*.md`, `docs/**/impl-plan-*.md`, `docs/**/spec-*.md` (outside `docs/conventions/`), `docs/**/design-*.md`, `docs/**/impl-*.md` (outside `docs/conventions/`) exist.

**Why:** The Doc Philosophy section in AGENTS.md is prose-only. Without mechanical enforcement, a contributor (or an AI agent following old habits) will recreate `docs/plans/impl-plan-*.md` within months. A CI guard catches it at PR time.

**Context:** Deferred from the 2026-04-21 docs-cleanup /autoplan. CEO dual voices (Claude + Codex) both flagged this as the missing enforcement layer.

**Effort:** S (human: ~30 min / CC: ~10 min)
**Priority:** P3
**Depends on:** Nothing.

## AI Analysis

### Per-workspace Sentry adapter (only if a paying customer asks)

**What:** A per-workspace BYO-Sentry integration. OAuth or PAT, encrypted token in a new `sentryConnection` table, `getConfig(workspaceId)` lookup, gated `searchSentry` tool registration when a workspace has a connection. Mirrors the existing GitHub install pattern.

**Why:** The original env-based Sentry tool was removed on 2026-04-19 because it leaked across tenants and duplicated SDK-collected signals. A per-workspace adapter is fine to revisit if an enterprise customer with existing Sentry history asks for cross-correlation. Until then, the SDK is the source.

**Context:** Removed on 2026-04-19. Both /autoplan dual-voice CEO/Eng reviews recommended disconnect-first; user chose hard-delete and accepted the rebuild cost if BYO-Sentry returns.

**Effort:** M (human) / S (CC)
**Priority:** P3
**Depends on:** A paying customer explicitly asking for it.

### Wire rrweb chunks into the agent prompt

**What:** Frames at the failure timestamp = "the agent saw what the user saw." Pull the rrweb session replay chunk corresponding to the failure point, render keyframes, inject into the prompt context.

**Why:** Natural follow-up to the Sentry removal. Rrweb is already captured by `packages/sdk-browser/src/recorder.ts` and stored in `sessionReplayChunk` — but never reaches the agent. This is the highest-leverage upgrade to draft quality.

**Context:** Flagged in `/autoplan` cross-phase themes as the natural follow-up to Sentry removal. Out of scope for that PR.

**Effort:** M
**Priority:** P2
**Depends on:** Sentry removal (done in chore/remove-sentry-integration).

## Auth & Onboarding

### Self-serve workspace creation UI

**What:** Let the first user at a brand-new domain create a workspace themselves (becoming OWNER), instead of landing at `/no-workspace` and waiting for the TrustLoop team to provision it manually.

**Why:** Launching Google sign-in with white-glove provisioning (TrustLoop team sets `Workspace.emailDomain` by hand) is the right move for pilot #1-#5 — it forces a human first contact with every prospect, prevents domain squatting, and removes a whole UI from launch scope. But once you're doing 5+ pilots a week, manual provisioning becomes the bottleneck.

**Context:** Added from `/plan-ceo-review` of the Google sign-in plan on 2026-04-11. The CEO review selected SELECTIVE EXPANSION and accepted workspace auto-join by verified email domain for users whose domain already matches a workspace. For new domains, the user chose "land at /no-workspace with a 'Contact us' message" instead of auto-creating a workspace. That decision is smart now but should be revisited when the manual workflow becomes a bottleneck.

When you pick this up: the `AuthIdentity` model, `Workspace.emailDomain` column, and `resolveWorkspaceFromVerifiedEmail` helper already exist. You'll need: (1) a new workspace-create form on `/no-workspace` prefilled with the domain and a proposed name, (2) a confirmation step that sets `Workspace.emailDomain`, (3) protection against domain squatting (maybe: domain must pass a DNS TXT verification, or only allow if the user's `email_verified=true` AND the domain isn't on the personal-email block list, which it already is).

**Effort:** M (human) / S (CC)
**Priority:** P2
**Depends on:** Initial Google sign-in + auto-join PR landing (in flight on main).

### `hd` (hosted domain) parameter per-workspace for customer-restricted sign-in

**What:** Let a workspace admin restrict Google sign-in for their workspace to only users from a specific Google Workspace `hd` domain. Pass the `hd` parameter on `/authorize` and verify it on the returned id_token.

**Why:** Enterprise-lite SSO. A customer with strict identity policies can say "only @acme.com Google Workspace accounts can sign in to our TrustLoop workspace" without requiring full SAML/SCIM.

**Context:** Added from `/plan-ceo-review` of the Google sign-in plan on 2026-04-11. Deferred because there is no customer demand signal yet — no prospect has asked for it. The full SSO/SAML/SCIM path is still the post-P0 end state per `docs/domains/auth/spec-auth-workspace-security-p0.md`. This is a half-measure that provides enterprise comfort without committing to the full SSO build.

When you pick this up: add a `hostedDomain String?` field to `Workspace`, pass it as `hd` on the Google authorization URL, verify the `hd` claim on the returned id_token matches. Reject with a clear error if not. Should take ~1 hour of CC time.

**Effort:** S (human) / S (CC)
**Priority:** P3
**Depends on:** Google sign-in + auto-join PR landing. Customer asking for it.

### Multiple email domains per workspace (`WorkspaceEmailDomain` table)

**What:** Support multiple email domains matching the same workspace — e.g. Acme Corp with subsidiaries `acme.com`, `acme-eu.com`, and a recent acquisition `bravo.io`, all of which should auto-join the Acme workspace.

**Why:** Real companies have acquisitions, regional subsidiaries, and brand multiples. A single `emailDomain` column covers pilot #1-#10 but will break the first time a real enterprise signs up.

**Context:** Added from `/plan-ceo-review` of the Google sign-in plan on 2026-04-11. The initial design uses a simple `Workspace.emailDomain String?` column with a partial unique index. This is the right call for speed now. When the first customer with multiple domains hits, promote to a many-to-one `WorkspaceEmailDomain` table with a backfill: `INSERT INTO workspace_email_domain (workspaceId, domain) SELECT id, emailDomain FROM workspace WHERE emailDomain IS NOT NULL`.

**Effort:** S (human) / S (CC)
**Priority:** P3
**Depends on:** First customer with multiple domains asking.

### Personal-email block list for paid plan seats

**What:** Prevent personal-email domain users (gmail.com, outlook.com, etc.) from occupying paid plan seats on a customer's workspace.

**Why:** When billing ships, you don't want a customer paying for seats that are "alice.random@gmail.com" — it's an accidental freeloader problem and a licensing concern.

**Context:** Added from `/plan-ceo-review` of the Google sign-in plan on 2026-04-11. The `PERSONAL_EMAIL_DOMAINS` reject list already exists in `workspace-auto-join-service.ts` — it blocks personal emails from being used as workspace match keys during auto-join. This TODO extends that list to be enforced at seat assignment time once billing exists.

**Effort:** S (human) / S (CC)
**Priority:** P3
**Depends on:** Billing/metering work shipping (Deliverable D in the MVP plan).

## Auth

### Lock read-side of support routers against workspace API keys

**What:** `supportInboxRouter.listConversations`, `supportInboxRouter.getConversationTimeline`, `supportAnalysisRouter.getLatestAnalysis`, and the `sessionReplayRouter` queries (`list`, `getEvents`, `correlate`, `getSession`, `getReplayChunks`) all ride `workspaceProcedure`, which still accepts workspace API keys (`tlk_*`). After the operator-mutation role gate, mutations are safe — but reads still expose conversation timelines (operator reply bodies, draft content), analysis output (override reasons, suggested drafts), and session replay events (user email, click streams) to any holder of a valid workspace API key.

**Why:** Workspace API keys are intended for customer-facing ingest endpoints (SDK ingestion, webhook inbound). They are not meant to read operator-private data. A leaked key today means the attacker can tail every customer support conversation.

**Context:** Flagged by both Claude + Codex adversarial reviewers during `/ship` on 2026-04-19 (commit locking operator mutations). The mutation fix was landed; reads were scoped to a follow-up at user direction. Cited files: `packages/rest/src/support-inbox-router.ts:31,43`, `packages/rest/src/support-analysis-router.ts:41`, `packages/rest/src/session-replay-router.ts:7,48,78,141,155`.

When you pick this up: the mechanical fix is to route the listed queries through `workspaceRoleProcedure(WORKSPACE_ROLE.MEMBER)` (same pattern used by the mutations). The larger design question is whether to split `workspaceProcedure` into two explicit variants (`workspaceSessionProcedure` for user-UI reads, `workspaceApiKeyProcedure` for SDK/ingest endpoints with a scope check) so the "API keys can't read operator data" invariant is enforced structurally rather than procedure-by-procedure.

**Effort:** S (human: ~2 hr / CC: ~20 min)
**Priority:** P1 — actively exposed read path in a pre-product auth model.
**Depends on:** None.

### Stale role cache after workspace membership demotion

**What:** `ctx.role` is captured once at context build from `resolveWorkspaceContext`. A user demoted ADMIN→MEMBER or removed from a workspace mid-session keeps operating at the old role until the session cookie expires.

**Why:** Flagged by Claude adversarial review on 2026-04-19. Not a currently-exploitable hole (demotion requires an admin action and the user has to still have a session), but it's a silent privilege persistence bug that matters when a workspace rotates staff. `packages/rest/src/context.ts:31-42` reads membership per-request — actually confirmed by Codex to be read every request. Re-validate this claim before shipping a fix; if per-request, the risk is lower than Claude's finding implied.

**Effort:** S (human: ~1 hr / CC: ~15 min)
**Priority:** P2
**Depends on:** Verifying the per-request membership read claim.

## Code Indexing

### Unified Escalation Timeline Panel

**What:** Build a single timeline that stitches Slack messages, in-product SDK session events, Linear updates, Git activity, and index freshness into one chronological view.

**Why:** On-call engineers currently context-switch across tools; this deferred expansion unlocks faster root-cause analysis and safer PR intent decisions.

**Context:** Deferred from `/plan-ceo-review` for GitHub indexing so v1 can focus on core repo connect, indexing, hybrid retrieval, explainability, freshness guardrails, PR intent contract, and relevance feedback. Start by defining a normalized event schema and read model for workspace-scoped escalations.

**Effort:** L
**Priority:** P2
**Depends on:** Shipping the v1 indexing/search foundation and event ingestion contracts (Slack/SDK session events/Linear/GitHub)

### No-Flag Rollout Runbook + Rollback Drill

**What:** Define and validate an explicit no-feature-flag rollout and rollback runbook for indexing/search deployments.

**Why:** The plan intentionally skips feature flags, so deployment safety depends on strict migration/deploy/smoke-check sequencing and rehearsed rollback steps.

**Context:** Added from `/plan-eng-review` after choosing no flags in architecture decisions. Include: migration-first order, worker dark-run checks, read-only search smoke script, rollback trigger thresholds, and owner/on-call responsibilities.

**Effort:** M
**Priority:** P1
**Depends on:** Initial indexing/search implementation branch reaching deployable state

## Prompting

### Migrate `renderThreadSnapshotPrompt` from JSON pretty-print to TOON

**What:** Swap `JSON.stringify(snapshot, null, 2)` in `apps/agents/src/prompts/thread-snapshot.ts` for the TOON serializer in `packages/prompting`. Gate with an output-parity eval against the current prompt surface.

**Why:** CLAUDE.md's "TOON in, Positional JSON out" rule. The structured boundary that 0.2.10.0 introduced is the prerequisite; now the renderer can actually exercise TOON's token savings.

**Context:** Deferred at plan approval on 2026-04-23 to keep the structured-payload PR narrow and measurable. Switching serializer + output shape at the same time would make LLM quality regressions impossible to attribute.

**Effort:** S (human) / S (CC)
**Priority:** P2
**Depends on:** Nothing — 0.2.10.0 already established `ThreadSnapshot` as the single input shape.

### Extract prompt renderer to a shared package after a second real consumer exists

**What:** Move the prompt document model and serializer helpers out of `apps/agents` into a dedicated shared package once another runtime or a second materially different agent prompt needs the same rendering layer.

**Why:** Shared abstractions are worth it when reuse is real. Doing it earlier turns one prompt refactor into a mini-platform project with extra maintenance surface and weaker local clarity.

**Context:** Deferred during TOON prompt foundation work on 2026-04-19. The review explicitly narrowed scope away from `packages/types` for renderer-local concerns.

**Effort:** S (human) / S (CC)
**Priority:** P3
**Depends on:** A second prompt/runtime proving reuse.

## Slack Ingestion

### Session-ingest upsert race retry

**What:** `apps/web/src/server/http/rest/sessions/ingest.ts:120-156` replaced Prisma's `upsert()` with a manual `findFirst → update | create` because `upsert()` can't target the partial unique index on `(workspaceId, sessionId) WHERE deletedAt IS NULL`. The manual version introduces a race: two concurrent flushes for the same sessionId can both see "not found" and both try to create, leading to a unique-constraint violation on the second one.

**Why:** Currently caught in the `console.error` path at line 191 and logged as `[session-ingest] Async write failed`. The SDK will retry on next flush (10s later) so session data converges eventually. This is acceptable for now — the worst case is a 10-second delay on new session creation under extreme concurrency. But in production under load, this will fill the logs with unique-violation errors.

**Context:** Landed from `/plan-eng-review` on 2026-04-11. The original Prisma `upsert()` was broken (ON CONFLICT doesn't target partial unique indexes — see CLAUDE.md → Soft Delete Rules). The replacement is correct for the soft-delete case but loses Prisma's atomic upsert semantics.

When you pick this up: wrap the `tx.sessionRecord.create(...)` in a try/catch on `Prisma.PrismaClientKnownRequestError` with code `P2002`, and on that specific error, retry the entire transaction from the `findFirst`. Two attempts max. Alternative: use a Postgres advisory lock keyed on `(workspaceId, sessionId)` to serialize concurrent creates. The retry approach is simpler and matches the rest of the codebase's conflict handling.

**Effort:** S (human: ~1 hour / CC: ~10 min)
**Priority:** P2 — not blocking, but will surface as log noise under production load.
**Depends on:** None.

### Projection Replay and Backfill Tooling

**What:** Build scoped replay tooling to rebuild conversation projections from immutable event logs with dry-run support.

**Why:** Prevent manual database intervention when projection drift or schema evolution issues appear in production.

**Context:** The approved Slack ingestion/event-sourced design includes projection health visibility, but replay operations are not fully specified for operators.

**Effort:** M
**Priority:** P1
**Depends on:** Event schema/versioning finalized and projection table shape stabilized.

### Slack Connect Diagnostics and Repair Console

**What:** Add diagnostics tooling to inspect Slack team/channel identity mappings and support controlled remap/repair actions.

**Why:** Reduce time-to-recovery for cross-org Slack Connect identity edge cases that can break deterministic grouping.

**Context:** The plan adopts canonical team-aware conversation identity, but does not yet include dedicated operational diagnostics.

**Effort:** M
**Priority:** P1
**Depends on:** Base installation mapping tables/events and operator permission model.

### Synthetic Load and Chaos Harness for Ingestion Pipeline

**What:** Create a test harness for duplicate event storms, Slack rate-limit bursts, and projection lag spikes.

**Why:** Validate retry/idempotency behavior under realistic failure pressure before broader rollout.

**Context:** The engineering review mandates complete unit/integration/E2E coverage, but stress and chaos behavior needs a dedicated harness.

**Effort:** M
**Priority:** P2
**Depends on:** Core ingest/group/projection/retry pipeline implemented.

### Handoff Brief Panel (Post-Summary Phase)

**What:** Add a conversation handoff brief panel that summarizes open asks, latest owner action, latest customer message, and suggested next step.

**Why:** Reduce on-call context-switch cost when threads change hands and prevent missed follow-up after ownership changes.

**Context:** Explicitly deferred in CEO selective expansion to avoid low-signal summaries before chat summarization and code indexing are production-stable.

**Effort:** M
**Priority:** P1
**Depends on:** Summary pipeline + code index context availability.

### Linear Integration After Context Quality Gate

**What:** Integrate conversation records with Linear tickets (link, status sync, blocked/stuck signal propagation) once context quality gates pass.

**Why:** Improve triage accuracy and stale detection by tying thread state to real ticket lifecycle without forcing premature integration complexity.

**Context:** CEO review accepted phased ticket-status plumbing now, but deferred direct Linear integration until summary and code-index context are reliable.

**Effort:** M
**Priority:** P1
**Depends on:** Summary pipeline + code index context + stable ticket-link schema.

### Canonical Replay Fixture Pack for Slack Ingestion

**What:** Create a reusable fixture pack for ingestion and grouping tests (duplicate storms, out-of-order events, attachment-only events, Slack Connect identity edges, retry envelopes).

**Why:** Make regressions deterministic and reduce debugging time when idempotency/grouping behavior changes.

**Context:** Added during eng delta review to support Wave-1/Wave-2 quality gates and avoid ad-hoc fixture drift across test suites.

**Effort:** M
**Priority:** P1
**Depends on:** Core normalized event schema and canonical idempotency key format locked.

### On-Call Runbook Pack for Ingestion Controls

**What:** Publish operator runbooks for Slack ingress pause/resume procedures, dead-letter triage, replay execution, and customer-notification recovery checklist.

**Why:** Ensure incidents can be handled quickly and consistently under pressure, including after-hours support.

**Context:** Accepted in eng delta review as low-cost reliability leverage after choosing CI-first rollout with minimal emergency controls.

**Effort:** S
**Priority:** P1
**Depends on:** Operational pause/resume controls + dead-letter/replay command surface implemented.

## Design System

### Keyboard-accessible connection fallback for agent-team graph

**What:** Keep a keyboard-accessible fallback for creating agent-team connections after drag-to-connect becomes the primary interaction in the React Flow graph.

**Why:** Prevent the new graph editor from regressing accessibility for users who cannot rely on pointer-driven drag interactions.

**Context:** The reduced React Flow migration plan for `duc/agent-team-builder` replaces the custom SVG graph with direct connect/delete interactions on the settings page. That makes the UI easier for mouse users, but it risks removing the current modal-based connection path (`AddEdgeDialog`) before keyboard-only graph editing is verified. When you pick this up: either retain `AddEdgeDialog` as a fallback path or add an equivalent keyboard-first connection flow before fully removing the dialog from the page.

**Effort:** S
**Priority:** P2
**Depends on:** Constrained React Flow migration landing on the agent-team settings page.

### Create Canonical DESIGN.md for TrustLoop

**What:** Run design-system definition and publish a repo-wide `DESIGN.md` that supersedes per-feature local token appendices.

**Why:** Prevent UI drift and repeated design debates as new inbox/settings surfaces are added.

**Context:** The Slack ingestion plan currently carries local design tokens because `DESIGN.md` does not exist yet.

**Effort:** M
**Priority:** P1
**Depends on:** None.

### Mobile Inbox Ergonomics Audit

**What:** Execute a focused mobile usability pass for inbox detail flow (pinned composer + action drawer + keyboard overlap behavior).

**Why:** Reduce reply friction and accidental actions in high-pressure operator workflows on smaller screens.

**Context:** The plan specifies mobile behavior, but ergonomic validation is deferred until UI implementation exists.

**Effort:** M
**Priority:** P1
**Depends on:** Initial inbox mobile UI implementation.

### Accessibility Validation Suite for Inbox Surfaces

**What:** Add dedicated a11y validation coverage for queue/timeline/action surfaces (keyboard-only journey, live-region announcements, status contrast checks).

**Why:** Ensure accessibility requirements become verifiable done criteria rather than undocumented intent.

**Context:** The design review added explicit accessibility requirements, but test coverage for these checks is not yet planned as a separate work item.

**Effort:** M
**Priority:** P1
**Depends on:** Core inbox UI and interaction states implemented.

## Soft Delete

### Purge Job Scheduling

**What:** Wire `purgeDeletedRecords()` to a Temporal scheduled workflow or cron task.

**Why:** Without scheduling, soft-deleted records accumulate forever. The purge function exists but has no caller.

**Context:** Function exists at `packages/database/src/purge.ts` with 90-day retention and dependency-ordered deletion using `prismaRaw` (non-extended client). Needs a Temporal workflow that calls it on a daily/weekly schedule. The purge deletes in child-first order to respect `onDelete: Restrict` constraints.

**Effort:** S
**Priority:** P2
**Depends on:** Soft delete implementation landed.

### Document Partial Unique Index / Prisma Schema Divergence

**What:** Add comprehensive documentation explaining that `@@unique` in `schema.prisma` drives TypeScript type generation only, while actual DB constraints are partial unique indexes managed in raw SQL migrations.

**Why:** Prevents accidental full unique index recreation on next `prisma migrate dev`. Prisma 7 schema DSL doesn't support partial indexes. Future schema changes on soft-deletable models must write raw SQL migrations for unique constraint changes.

**Context:** Schema comments have been added to each affected model. CLAUDE.md has a soft delete rules section. This TODO covers creating a dedicated `docs/soft-delete-guide.md` with full operational procedures for adding new soft-deletable models, modifying unique constraints, and running introspection safely.

**Effort:** S
**Priority:** P1
**Depends on:** Soft delete migration landed.

## Storage

### Migrate attachment storage from BYTEA to S3/R2

**What:** Move support file attachments from the PostgreSQL `fileData` BYTEA column to object storage (Cloudflare R2 or AWS S3). Keep only a `storageKey` reference in the database row.

**Why:** BYTEA works for low volume but causes database bloat, slow backups, and per-request memory pressure at scale. A 25MB upload costs 25MB+ in WAL + TOAST storage. Concurrent downloads load full files into Node.js memory.

**Context:** The service boundary is already designed for this swap. All callers go through `supportAttachments.store()` and `supportAttachments.readFileData()` in `packages/rest/src/services/support/support-attachment-service.ts`. The `storageKey` column already exists on `SupportMessageAttachment`. Implementation: (1) set up R2/S3 bucket + presigned URL helpers, (2) update `store()` to write to object storage and save the key, (3) update `readFileData()` to stream from object storage (or return a redirect URL), (4) backfill existing BYTEA rows to object storage, (5) drop the `fileData` column after backfill.

**Effort:** M (human) / S (CC)
**Priority:** P2
**Depends on:** File attachment feature stable in production. Trigger: DB size growth from attachments becomes noticeable.

## Agent Team Observability

### Payload S3 offload for large tool results

**What:** When an `AgentTeamRunEvent.payload` exceeds the 64KB truncation cap, store the full payload in S3 and put a pointer in the event row (`{ s3Key, truncated: true }`).

**Why:** Truncation-with-flag is fine for v1, but once operators start regularly debugging runs where a `tool_returned` event got cut (large code-search results, diff blobs), they'll want the full payload. S3 is the right tier — cheap, durable, already in the stack if archival ships.

**Context:** Added from `/plan-eng-review` of agent-team observability on 2026-04-14. Rejected inline in the design doc because no operator has asked for it yet and it's premature optimization. Revisit when a specific operator says "I needed the full tool output and only had the truncation flag."

When you pick this up: the `AgentTeamRunEvent` table already supports JSONB payload. Add an optional `payloadS3Key String?` column, update `recordEvent` to offload when `JSON.stringify(payload).length > 65536`, and add a resolver helper `loadFullPayload(event)` for consumers. Depends on: S3 credentials in `@shared/env` (already set up if archival workflow ships in the same PR).

**Effort:** S (human) / XS (CC)
**Priority:** P3
**Depends on:** `AgentTeamRunEvent` table shipped, S3 credentials configured.

## Completed

### Promote `threadSnapshot` from pre-rendered string to typed prompt context

**What:** `threadSnapshot` now travels the queue → agents `/analyze` HTTP boundary as a structured `ThreadSnapshot` Zod object instead of a pre-rendered pretty-printed JSON string. The prompt renderer moved to `apps/agents/src/prompts/thread-snapshot.ts` (agent-local, not `packages/prompting`), following the `apps/agents/src/prompts/*` convention. The Prisma persist path casts at the library boundary via `as Prisma.InputJsonValue`, matching the pattern at `support-ingress-service.ts:175`.

**Implementation:** `packages/types/src/support/support-analysis.schema.ts` — `threadSnapshotSchema` with shared enums (`supportConversationStatusSchema`, `supportConversationEventSourceSchema`), non-nullable `channelId`, `.strict()` on both objects, recursive JSON `details`. `analyzeRequestSchema.threadSnapshot = threadSnapshotSchema` — clean break, no compat union. `apps/queue/src/domains/support/support-analysis.activity.ts` — drops `JSON.stringify(snapshot, null, 2)` on the wire and the `JSON.parse(JSON.stringify(snapshot))` defensive clone on DB persist. `apps/agents/src/prompts/thread-snapshot.ts` + `apps/agents/src/agent.ts:81` — the renderer is a one-line `JSON.stringify(snapshot, null, 2)`. 13 new tests: 11 schema tests cover `.strict()` rejection, shared-enum gating, structured-payload acceptance, stringified-payload rejection, recursive JSON; 2 renderer tests cover JSON round-trip and key coverage. `packages/rest/test/session-prompt-integration.test.ts` fixtures updated to use object payloads.

**Tests:** `@shared/types` 147 tests pass. `@trustloop/agents` 30 tests pass. `@apps/queue` 52 pass. `@shared/rest` 192 pass. Full monorepo type-check + biome lint clean.

**Deploy note:** Pause queue workers for one `AGENT_TIMEOUT_MS` window (5 min) before the deploy so in-flight analyses drain cleanly. Any remaining in-flight workflow that replays onto the new agent with an old stringified payload fails via the existing `handleAnalysisFailure` path — DB analysis row marked `FAILED`, user can re-trigger.

**Completed:** 2026-04-23 (v0.2.10.0). Both CEO dual voices flagged the original plan as oversized; user kept the full-refactor direction and folded in 4 of 5 Eng dual-voice findings (Prisma `InputJsonValue` cast, shared enums + `.strict()`, expanded test suite, renderer at `apps/agents/src/prompts/` not `packages/prompting`). Skipped the 5th (compat union) — at pre-product scale, in-flight workflow volume at deploy is 0-2 and `handleAnalysisFailure` catches the worst case cleanly; the union was CYA for a production-scale system.

### Lock operator mutations + remove unauthenticated `dispatchWorkflow` tRPC procedure

**What:** Two related auth holes closed in one PR:

1. **Operator mutation role-gate.** `supportInboxRouter` (6 mutations: `assignConversation`, `updateConversationStatus`, `markDoneWithOverrideReason`, `retryDelivery`, `sendReply`, `toggleReaction`) and `supportAnalysisRouter` (3 mutations: `triggerAnalysis`, `approveDraft`, `dismissDraft`) moved from `workspaceProcedure` to `workspaceRoleProcedure(WORKSPACE_ROLE.MEMBER)`. `workspaceRoleProcedure` now explicitly rejects non-session actors with `UNAUTHORIZED`.

2. **Removed unauthenticated workflow dispatch from tRPC.** `dispatchWorkflow` was mounted on `publicProcedure` in `packages/rest/src/router.ts`, letting any unauthenticated caller enqueue support, support-analysis, send-draft-to-slack, codex, and repository-index workflows (including posting arbitrary messages into customer Slack channels via send-draft-to-slack). Zero callers used the tRPC procedure. Removed it entirely; internal dispatch now lives exclusively at the authenticated REST endpoint `/api/rest/workflows/dispatch` (protected by `withServiceAuth`).

**Implementation:** `packages/rest/src/trpc.ts` — `workspaceRoleProcedure` asserts `ctx.session && ctx.user` and narrows downstream ctx. `packages/rest/src/support-inbox-router.ts` + `packages/rest/src/support-analysis-router.ts` — `operatorProcedure = workspaceRoleProcedure(WORKSPACE_ROLE.MEMBER)` alias, dropped `ctx.apiKeyAuth?.keyId ?? "system"` fallback. `packages/rest/src/router.ts` — removed the `dispatchWorkflow` procedure. `packages/rest/test/procedure-auth.test.ts` — 6 regression tests.

**Tests:** 178 tests in rest package still pass. Full monorepo type-check clean.

**Completed:** 2026-04-19. Mutation hole flagged by Codex during /autoplan eng review of the SupportConversation FSM plan; `dispatchWorkflow` hole flagged by Codex during /ship adversarial pass (on the same day, scope expanded by user at the /ship gate).

### Tighten bot-message filter to installation.botUserId

**What:** Replaced the blanket `authorRoleBucket === bot` drop in `apps/queue/src/domains/support/support.activity.ts` with a targeted filter that only drops messages whose `slackUserId` matches `installation.botUserId`. Other-integration bot messages (e.g. a GitHub app posting a PR screenshot) now pass through the ingress boundary so Pillar A file mirroring can process them.

**Implementation:** Extracted `shouldDropIngressEvent` into a pure helper at `apps/queue/src/domains/support/ingress-drop-rules.ts` so it has no aliased imports and can be unit tested in isolation. The helper takes `authorRoleBucket`, `slackUserId`, and `installationBotUserId` and returns `true` when the event is our own echo or Slack system noise. Legacy installs where `installation.botUserId` is null fall back to the old blanket-bot-drop behavior (safe default). OAuth install was already populating `botUserId` from Slack's `oauth.v2.access` response — no OAuth changes needed. Seed file now reads `SLACK_DEV_BOT_USER_ID` from env so developers connected to a real Slack workspace can persist their real bot user ID without editing code.

**Tests:** 8 new unit tests in `apps/queue/test/should-drop-ingress-event.test.ts` cover SYSTEM / BOT-is-ours / BOT-is-other / legacy-null / customer / internal / edge cases.

**Completed:** v0.1.2.0 (2026-04-12)
