# Changelog

All notable changes to TrustLoop will be documented in this file.

## [1.0.0.0] - 2026-05-04

### Added
- **MCP tool access for the RCA sub-agent.** The agent team's RCA analyst can now
  call out to a customer-hosted MCP (Model Context Protocol) server during a run
  and read live state (Postgres first; Redis, Signoz, and other sources extend
  via the same interface). Every call is recorded in `WorkspaceMcpCall` as an
  append-only audit row, surfaced in the run-detail UI's new "MCP" tab.
- **Customer-hosted model.** Customers run the MCP server inside their network
  with a read-only DB role and expose a single bearer-authenticated endpoint;
  TrustLoop never sees connection strings. v1 dogfoods against TrustLoop's own
  Postgres.
- **Per-server suggest mode.** `WorkspaceMcpServer.mode = SUGGEST` makes the RCA
  agent propose tool calls without invoking them, writing `PENDING_APPROVAL`
  audit rows instead. Default is `EXECUTE`. The flag exists in v1 so the
  design-partner negotiation is "flip a flag" rather than "wait for v2."
- **Encryption helper for server-side secrets.**
  `packages/rest/src/security/secret-encryption.ts` (AES-256-GCM, key from
  `SECRET_ENCRYPTION_KEY`, key-versioned blob format) is the canonical pattern
  for encrypting customer-supplied secrets. Used today for MCP bearer tokens;
  existing Slack/GitHub OAuth tokens migrate to it in a follow-up PR.
- **Bearer-token log scrubber.** Global console wrapper in the agents service
  entrypoint redacts `Authorization: Bearer ...` and inline bearer tokens from
  all log output before they leave the process.
- **`mcp:register` CLI.** `npm --workspace @trustloop/agents run mcp:register`
  registers, probes, lists, disables, or rotates MCP servers per workspace.
  Inline `--auth-token` is rejected (shell-history risk); use
  `--auth-token-stdin` or `--auth-token-env`. Pre-flight handshake validates
  the bearer + tool allowlist before any DB write.
- **Concept doc.** `docs/concepts/agent-mcp-tools.md` covers the customer-host
  model, the audit log, the `mcp:<serverId>:*` allowlist convention, the
  suggest-vs-execute mechanism, error-string contracts, and a 5-minute
  Quickstart for internal dogfood.

### Changed
- **`agentTeamToolIdSchema` relaxed** from a closed enum to a regex string so
  per-workspace MCP tool IDs (`mcp:<serverId>:<toolName>` and
  `mcp:<serverId>:*` wildcard) flow through `AgentTeamRole.toolIds[]` without
  an enum migration each time a new server is registered.
- **`buildToolsForAgent` is async.** MCP tool discovery is network I/O; the
  factory now awaits per-workspace MCP servers before agent construction.
  `pickToolsForRole` expands `mcp:<id>:*` wildcards against the live tool key
  set at construction time. Existing built-in tools are unchanged.
- **`AgentTeamRun` gains `mcpCalls` back-relation** for joined run-detail
  reads. New `agentTeam.listRunMcpCalls` tRPC procedure powers the UI.

## [0.2.17.6] - 2026-05-04

### Added
- **Debugger MCP for Doppler-backed staging RCA.** Adds
  `@trustloop/debugger-mcp`, a local MCP server intended to run as
  `doppler run -- npm --workspace @trustloop/debugger-mcp start`. The server
  exposes redacted environment/config snapshots, read-only Temporal workflow
  history, agent-team run diagnosis, and a paste-first `diagnose_from_text`
  tool that extracts workflow IDs/run IDs/activity names from Temporal UI or
  log text before choosing the right diagnostic path.
- **Agent-team `fetch failed` diagnosis.** The first classifier recognizes
  `runTeamTurnActivity` raw `TypeError: fetch failed` failures as
  queue-to-agents connectivity/configuration issues and points operators at
  queue `AGENT_SERVICE_URL`, agents service health, and Railway private
  networking checks.
- **Debugger MCP docs.** Documents the local-first Doppler execution model,
  no-secret-output invariant, read-only Temporal boundary, and keep-honest
  triggers in `docs/concepts/debugger-mcp.md`.
- **Detach + Re-attach (AI) operator buttons on the support-evidence capsule.**
  Operators can now drop a session that the auto-matcher (or a teammate) pinned
  to the wrong conversation, and ask the heuristic to take another swing without
  reopening the conversation.
  - **Detach** flips `isPrimary: false` on the match row — works for auto-confirmed,
    fuzzy, and manual matches alike. The match row stays as audit history, so a
    future auto-correlation can still rediscover that session if its signals win
    again. New tRPC mutation: `sessionReplay.detachFromConversation`.
  - **Re-attach (AI)** clears any current primary, then re-runs the auto-matcher
    bypassing the manual short-circuit so heuristics can pick a fresh session
    candidate. Renders in the empty state next to "Browse sessions". New tRPC
    mutation: `sessionReplay.recorrelateForConversation`.
  - Both mutations piggyback on the existing skeleton/loading state so the panel
    feels responsive during in-flight work, and surface failures via a new
    `sessionActionError` field in the capsule.

### Changed
- **`docs/concepts/session-replay-capture.md` updated** to describe the new
  detach + re-attach affordances and clarify that detach is audit-preserving
  rather than destructive.

## [0.2.17.5] - 2026-05-04

### Removed
- **Legacy single-agent `support-analysis` workflow rollback artifacts.**
  After three releases of the agent-team-only pipeline (v0.2.17.1 cutover,
  v0.2.17.3 FSM hardening, v0.2.17.4 idempotency fixes) running in
  production without rollback, the legacy code is deleted.
  - `apps/queue/src/domains/support/support-analysis.workflow.ts` and
    `support-analysis.activity.ts` — the orchestrator + activities. Not
    reached by the live code path since v0.2.17.1.
  - `apps/queue/test/support-analysis.activity.test.ts` — tested the
    deleted activity.
  - `WorkflowDispatcher.startSupportAnalysisWorkflow` method and its
    Temporal binding in `temporal-dispatcher.ts`.
  - `support-analysis` discriminator branch from `workflow-router.ts` and
    the matching `workflowDispatchSchema` member.
  - `supportAnalysisWorkflowInputSchema` /
    `supportAnalysisWorkflowResultSchema` and the `supportAnalysis`
    workflow name from `workflow.schema.ts`.
  - `supportAnalysis.triggerAnalysis` tRPC mutation and its
    `supportAnalysis.trigger` service backing.
  - `triggerAnalysisInputSchema` / `triggerAnalysisResultSchema` from
    support-analysis schema (frontend renamed its input to
    `getLatestAnalysisInputSchema` to match its only remaining caller).
  - `POST /analyze` HTTP route on the agents service. The `runAnalysis`
    function stays — it's still called as a function by `runTeamTurn`'s
    drafter short-circuit.
  - Worker registration entries for the deleted workflow + activities in
    `apps/queue/src/runtime/{workflows,activities}.ts`.
  - Test mocks of `startSupportAnalysisWorkflow` removed from
    `agent-team-run-service.test.ts`, `agent-team-resume-run.test.ts`,
    `workflow-router.test.ts`, and `procedure-auth.test.ts`.

### Notes
- `SupportAnalysis` and `SupportDraft` Prisma models stay — they're now
  derived projections written by `markRunCompleted` from drafter output.
  The right-rail UI reads them unchanged via
  `supportAnalysis.getLatestAnalysis` and approve/dismiss still operate on
  `SupportDraft` rows.
- The `runAnalysis` function in `apps/agents/src/agent.ts` and the
  `support-analysis*.ts` prompt files stay — they're still the LLM call
  the drafter delegates to. Quality unchanged.
- Rollback path: the prior cutover commits would need to be reverted
  along with this one. After three stable releases, that's not a path
  worth keeping the dead code for.

## [0.2.17.4] - 2026-05-04

### Fixed
- **AgentTeamRun status mutators are now idempotent under Temporal retries.**
  After v0.2.17.3 introduced the FSM, `markRunCompleted` / `markRunFailed` /
  `markRunWaiting` / `initializeRunState` would throw
  `InvalidAgentTeamRunTransitionError` if Temporal retried the activity after
  a successful DB commit (e.g. a network blip between commit and ack). The
  retry would treat the activity as failed and could trigger a cascade. Each
  function now early-returns when the run is already in the target state — no
  FSM call, no double-emit of terminal events.
- **Replaces `current.status as never` casts with
  `agentTeamRunStatusSchema.parse(current.status)`** at all 5 FSM-driven write
  sites (4 in `agent-team-run.activity.ts`, 1 in `resume-run.ts`). Per
  CLAUDE.md "no `any`, no `as unknown as`" rule. The cast bypassed Zod
  validation on the way in; the parse catches a malformed status at the
  boundary with a typed error instead of letting an invalid value reach the
  FSM as "unknown status".
- **`markRunWaiting` now writes `errorMessage: next.errorMessage`** for
  consistency with the other four FSM-driven update sites. Runtime effect
  was a no-op (the `waitForResolution` handler preserves errorMessage), but
  the inconsistency read as a bug.

### Notes
- Activity-level idempotency tests are not included in this PR. The
  FSM-rejection tests in `state-machines.test.ts` already cover the
  underlying transition rules; the activity-layer guards are best validated
  by integration tests against a real DB. Worth a follow-up.

## [0.2.17.3] - 2026-05-04

### Changed
- **AgentTeamRun status now driven by a finite-state machine.** Mirrors the
  existing `draft-state-machine.ts` pattern using the shared `defineFsm`
  helper. Replaces five scattered `status: AGENT_TEAM_RUN_STATUS.*` direct
  writes (in `run-service.start`, `initializeRunState`, `markRunCompleted`,
  `markRunWaiting`, `markRunFailed`, and the resume path in `resume-run.ts`)
  with `transitionAgentTeamRun(ctx, event)` calls. Illegal transitions
  (e.g. completed → resume, queued → complete) now throw
  `InvalidAgentTeamRunTransitionError` at the call site instead of
  silently corrupting state.

### Added
- **`packages/types/src/agent-team/state-machines/agent-team-run-state-machine.ts`.**
  States: `queued | running | waiting | completed | failed`. Events:
  `start | complete | waitForResolution | fail | resume`. Terminal:
  `completed`, `failed`. Public API: `createAgentTeamRunContext`,
  `restoreAgentTeamRunContext`, `transitionAgentTeamRun`,
  `getAllowedAgentTeamRunEvents`, plus the
  `InvalidAgentTeamRunTransitionError` class for `instanceof` checks at
  service-layer error translation boundaries.
- **15 new unit tests** in `packages/types/test/state-machines.test.ts`
  covering every valid transition, every terminal-state rejection, and
  the `getAllowedAgentTeamRunEvents` reflection of current state.

### Notes
- The FSM event type is named `AgentTeamRunFsmEvent` (not
  `AgentTeamRunEvent`) to avoid colliding with the existing event-log
  `AgentTeamRunEvent` discriminated union — they live in adjacent
  modules and are conceptually different layers.
- Test fixtures across `packages/rest/test/*` still use string literals
  for `AgentTeamRun.status` (e.g. `status: "queued"` instead of
  `AGENT_TEAM_RUN_STATUS.queued`). The literal-to-enum sweep is a
  separate housekeeping refactor — not blocking.

## [0.2.17.2] - 2026-05-03

### Changed
- **Drafter projects to SupportAnalysis + SupportDraft on completion.**
  When a FAST agent-team run completes, `markRunCompleted` writes a
  `SupportAnalysis` row (with the new `agentTeamRunId` link) and a
  `SupportDraft` row driven through the draft FSM
  (`generating → awaitingApproval`). The right-rail panel and the existing
  approve/dismiss flow read from `SupportAnalysis` unchanged. The
  `useAnalysis` hook reverts to its pre-cutover read path; only its trigger
  call was swapped to `agentTeam.startRun({ teamConfig: 'FAST' })`.
- **Removed `AGENT_TEAM_AS_DEFAULT_PIPELINE` flag.** Agent team is the only
  pipeline. Rollback is via `git revert` of the cutover commits — no flag
  flip required.

### Added
- **`SupportAnalysis.agentTeamRunId` column** with migration. Indexed and
  used for projection idempotency (re-running `markRunCompleted` for the
  same run does not double-write).
- **PR-creator + reviewer prompt hardening.** `pr-creator.prompt.ts` now
  spells out hard preconditions before `createPullRequest` (reviewer
  approval present, file located + read first, full file content
  reconstructed not blind-edited, size self-checked). `reviewer.prompt.ts`
  now defines the explicit approval contract — five conditions that must
  all be true before emitting `kind: approval`.
- **Unit tests for `DraftProjection` service** in
  `packages/rest/test/draft-projection-service.test.ts`. Status-mapping
  parametrized tests, missing-conversation handling, empty-message handling.
- **`docs/concepts/agent-team.md` updated** with the new trigger paths,
  team configurations table, drafter delegation flow, and SupportAnalysis
  projection mechanics.

### Notes
- The legacy `support-analysis.workflow.ts` and `supportAnalysis.*` router
  remain in the tree for one release as a rollback artifact. Not reached
  by the live code path. Physical deletion ships in a follow-up.
- AgentTeamRun status is currently set via direct writes; a finite-state
  machine (matching the existing `draft-state-machine.ts` pattern) is on
  the project's stated FSM follow-up list and is its own refactor. Test
  fixtures still use string literals for `AgentTeamRun.status`; cleanup to
  the typed `AGENT_TEAM_RUN_STATUS` enum constants is a sweep follow-up.
- Pre-existing apps/queue env-validation failures
  (`agent-team-archive.test.ts`, `agent-team-metrics-rollup.test.ts`)
  require server env vars not in the local `.env`. Unrelated to this
  change; CI provisions them.

## [0.2.17.1] - 2026-05-03

### Changed
- **Agent team is the only AI pipeline now.** The single-agent
  `support-analysis` pipeline is retired in favor of the agent team running
  in a sized configuration (FAST | STANDARD | DEEP). Auto-trigger always
  dispatches the agent-team FAST run. The right-rail draft panel reads from
  the new `DraftProjection` service via the existing `useAnalysis` hook
  (adapter pattern: hook surface unchanged, data source swapped underneath).
- **New `drafter` role** in the agent team. The FAST configuration runs the
  drafter only — it replaces the legacy single-agent analysis. The drafter
  role at the agent service layer delegates to `runAnalysis()` so the prompt,
  tools, and model are identical to the old `/analyze` path. Quality is
  unchanged by construction; the wrapper just maps the analysis output onto
  one team-event-log proposal message + facts.

### Added
- **`AGENT_TEAM_CONFIG` enum** (FAST | STANDARD | DEEP) and the matching
  `AgentTeamRun.teamConfig` column with migration. Existing runs are
  backfilled to DEEP since they were created via the manual full-team button.
- **`DraftProjection` service** that reads an agent-team run's drafter
  output and shapes it as `{ insights, draftBody, references, status }`. New
  tRPC procedure `agentTeam.getLatestDraftForConversation`. The right-rail
  panel hook (`useAnalysis`) reads through this projection.
- **Idempotent `agentTeam.startRun`.** A queued or running run for the same
  `(workspaceId, conversationId)` returns the existing run instead of
  starting a duplicate. Mirrors the GATHERING_CONTEXT|ANALYZING dedupe in
  the legacy supportAnalysis service.

### Notes
- The legacy `support-analysis.workflow` and the `supportAnalysis.*` tRPC
  procedures stay in the codebase for one release as a rollback path. The
  auto-trigger no longer reaches them. Approve/dismiss flows on
  pre-cutover SupportDraft rows continue to work via
  `supportAnalysis.approveDraft` / `dismissDraft`.
- Post-cutover drafts produced by the agent team are read-only in the UI
  until a follow-up wires SupportDraft writes (or an equivalent) into the
  agent-team event log.

## [0.2.16.5] - 2026-05-03

### Changed
- **API key creation dialog is now hard to close accidentally.** While the
  request is in flight or the one-time secret is on screen, the dialog blocks
  outside-click, Escape, and the X close button. The only way out during the
  reveal is the explicit "I've saved my key" button. This prevents the most
  common way to lose a one-time secret.
- **The new key defaults to visible on first reveal.** This is the only chance
  the user has to read it; making them click "show" first added friction
  without protection.
- **The reveal panel uses the destructive Alert variant** with stronger copy
  warning that the secret cannot be recovered after closing.

### Fixed
- **Rapid double-click on "Create" no longer creates duplicate API keys.** A
  synchronous in-flight ref rejects the second submission before React
  re-renders the disabled button.

### Added
- **API keys settings page now explains the `tlk_<prefix>.<secret>` format**
  with a persistent alert showing the exact bearer-token shape, so the auth
  format is discoverable without reading docs.

## [0.2.16.4] - 2026-05-03

### Added
- **Inbox now shows "Draft PR opened: #N →" pills when the AI agent files a PR.**
  Every successful `createDraftPullRequest` writes an `AgentPullRequest`
  audit row that links back to the originating conversation and analysis.
  The analysis panel renders one link per PR, so multi-PR analyses
  (e.g. fix + tests in separate PRs) are all surfaced.

### Changed
- **Agent tools no longer accept `workspaceId` from the LLM.** Each tool
  ships as a factory (`buildSearchCodeTool`, `buildCreatePullRequestTool`,
  `buildSearchSentryTool`) that closes over the per-request workspaceId.
  The analyze and team-turn prompts no longer include a `WORKSPACE_ID:`
  line. A hallucinated workspaceId in tool args can no longer cross
  tenants.
- **Agent service `/analyze` and `/team-turn` now require `INTERNAL_SERVICE_KEY`.**
  The closure-bound workspaceId is only safe if the body it comes from
  is trusted; without auth the trust boundary just moved upstream. The
  queue worker forwards the key in both call sites; the agent service
  rejects unauthenticated calls with 401.
- **PR creation is idempotent on Temporal activity retry.** If the
  agent opens a PR but the activity throws after the response, the
  retry now returns the existing PR URL instead of opening a duplicate
  draft PR in the customer's repo.
- **Drops unused `SupportDraft.prUrl`/`prNumber` columns.** Replaced by
  `AgentPullRequest`; no writers remained.

### Fixed
- **`createDraftPullRequest` tenant-verifies `conversationId` and
  `analysisId` against `workspaceId` before persisting** the audit row.
  Defense-in-depth: rows whose linkages don't belong to the workspace
  drop the linkage and log; rows with no linkage at all skip persistence
  rather than becoming invisible to the inbox queries.
- **Inbox PR-list keeps previously-rendered pills on transient fetch
  error** instead of silently emptying the panel. Cap of 25 rows per
  conversation prevents unbounded growth.

## [0.2.16.3] - 2026-05-03

### Tests
- **Adds an integration test for the operator session-tab composition.**
  Renders the real `SessionTab` + `SupportEvidenceCapsule` together,
  mocks only the heavy children (timeline, replay modal, manual-attach
  dialog), and exercises the full client-side happy path: empty-state
  rendering, populated capsule, copy-to-clipboard, "View proof" →
  replay-modal-open + chunk-load callback, in-flight loading early
  return, and the "no DOM replay" sub-state. Catches breakage in the
  composition that the capsule unit test can't see.

## [0.2.16.2] - 2026-05-03

### Fixed
- **Clicking "attach session" now feels acknowledged.** When the operator
  picked a session from the picker, the capsule kept showing the old
  "No browser session matched" copy until the mutation returned —
  `isAttachingSession` set the spinner on the picker dialog but never
  reached the capsule, so the click felt dropped. The capsule now
  treats `isAttachingSession` the same as `isLoading` and shows the
  skeleton with an `aria-live="polite"` "Attaching session" label, then
  flips to the populated capsule when the mutation lands. Same for the
  initial-load path: `aria-live` "Loading session evidence" so screen
  readers get a status update.
- Adds 6 capsule unit tests covering loading, attaching, no-match,
  populated, error, and "loading wins over stale error" — the last is
  a regression guard for retry-after-error flicker.

## [0.2.16.1] - 2026-05-02

### Security
- **PII and credentials are now redacted at SDK capture time, before they
  ever leave the customer's browser.** Schema-side `sanitizeText` /
  `sanitizeUrl` only ran when building operator-facing evidence; the raw
  `SessionEvent` rows in the database still carried unredacted click
  text, route URLs, console messages, network URLs, exception messages
  and stack traces. Anyone with DB access could see them. The new
  `redactText` / `redactUrl` in `packages/sdk-browser/src/redact.ts`
  applies the same email / Bearer / Basic / `token=` / `secret=` /
  `password=` / `authorization=` / `api[_-]?key=` / 32+ char hex
  patterns at capture time, so the data hits the wire pre-scrubbed.
- Adds 9 SDK redaction tests and 5 adversarial schema-side tests
  covering naming-convention variants (`apiKey` / `api-key` / `api_key`),
  Bearer/Basic auth, plus-aliased emails, 32+ char hex, and the 220-char
  per-field cap. SDK and schema patterns are documented as a parity
  contract — divergence means a leak slips one net.

## [0.2.16.0] - 2026-05-02

### Added
- **Operators see a redacted Support Evidence Capsule on every conversation
  that has session-replay attached.** A new card in the conversation sidebar
  ranks the session's signals (uncaught exception > 5xx fetch > 4xx fetch >
  console error) and shows the primary failure, the last route, the last 3
  user actions, the last 8 failed fetches, and the last 8 console/exception
  entries. Two pre-rendered copy strings ship with the capsule: a `repro`
  block for engineering handoff and an `escalation` block for a customer
  reply, both auto-redacted before they reach the operator.
- **Customer-safe redaction is enforced at the schema layer.** Emails become
  `[email]`, `Bearer`/`Basic` tokens become `[redacted]`, query params
  matching `token=`/`secret=`/`password=`/`authorization=`/`api_key=` get
  their values redacted, any 32+ char hex string gets stripped, and URLs
  drop their query string. Operators can paste evidence into a customer
  reply without manually scrubbing PII.
- **Session-evidence schema unit tests** covering severity ranking, the
  redaction rules, the `repro`/`escalation` copy generation, and the
  truncation behavior of the events window.

### Changed
- Conversation properties sidebar and support conversation sheet now mount
  the Support Evidence Capsule above the existing replay timeline so the
  failure signal is the first thing operators see.
- `useSessionReplay` and the session-replay router expose the evidence
  payload alongside the timeline events so the capsule renders without an
  extra fetch.
- `session-thread-match-service` and the support-analysis activity test get
  the new evidence shape so backend and queue-side flows stay coherent.
- `apps/agents/src/server.ts` binds to `::` for IPv6 dual-stack so the
  agent service is reachable on every interface in dev.
- `apps/web/next.config.ts` sets `devIndicators: false` to hide Next's
  bottom-left dev badge during demo recordings.
- `.skills/gstack` submodule pointer rolls forward from v1.12.2.0 to
  v1.26.0.0 so the canonical and project-local gstack copies match.
- `resolveProviderConfig` (apps/agents) finishes the centralized LLM
  routing migration started in #68: it now returns `LlmOverride |
  undefined` (was `AgentProviderConfig` with a hardcoded openai fallback)
  so the route's default policy applies when the caller doesn't override.
  Adds focused vitest coverage for the empty-override and explicit-override
  paths.

## [0.2.15.3] - 2026-05-02

### Fixed
- **Session ingest no longer spams unique-violation errors under concurrent
  flushes.** Two parallel flushes from the same browser session would both
  see `findFirst` → null and both attempt `create`, raising `P2002` on the
  loser. The transaction now retries once on `P2002`; the retry's
  `findFirst` finds the winner's row and converges to the update branch.
  Customer-visible noise in logs goes away; data convergence is unchanged
  (the SDK's flush retry was already covering the eventual case).

## [0.2.15.2] - 2026-04-26

### Changed
- Tracked the deferred session replay evidence follow-ups from the approved
  Support Evidence Capsule plan, including standalone sessions-page
  convergence, reply-composer evidence insertion, and future full
  console/network capture.

## [0.2.15.1] - 2026-04-25

### Fixed
- **Copy reply button now confirms the click even when the browser blocks
  the Clipboard API.** Surfaced by /qa: in restricted-clipboard
  environments (corporate policy, headless contexts, sandboxed iframes)
  the button silently failed and the operator had no idea whether their
  click registered. The label now flips to "Copied" optimistically before
  the async write so the click always feels responsive; if the underlying
  Clipboard API rejects, the visible draft text is still selectable as a
  manual fallback.

## [0.2.15.0] - 2026-04-25

### Added
- **Operators can now answer the architect's questions and resume an agent-team
  run from the inbox.** A new "Resolve" tab on the agent-team panel lights up
  the moment a run exits to `waiting`. It groups the architect's open questions
  by who can answer them: operator-target questions get an inline textarea that
  posts the answer back to the architect's inbox without restarting the
  workflow; customer-target questions show the architect's draft reply with a
  one-click copy so the operator can paste it into Slack; internal-target
  questions are listed as informational so the operator can see what peer
  roles still owe an answer. A single "Resume run" button at the bottom is the
  one explicit gate that re-dispatches the workflow — every restart stays
  operator-driven.
- `agentTeam.getPendingResolutionQuestions` tRPC query: returns every
  `question_dispatched` event without a matching `question_answered`,
  carrying `target`, `question`, `suggestedReply`, `assignedRole`, and
  `askedByRoleKey` so the panel renders without parsing the raw event log.

## [0.2.14.0] - 2026-04-25

### Added
- Operator resume flow for agent-team runs that exited in `waiting`. Two new
  tRPC mutations on `agentTeam`: `recordOperatorAnswer` writes the operator's
  answer into the architect's inbox as a synthetic message, flips the role
  inbox from `blocked` → `queued`, and emits a `question_answered` event
  without restarting the workflow. `resumeRun` is the explicit follow-up
  action: it dispatches a fresh Temporal execution of the same `runId` with
  `isResume: true` and a unique `resumeNonce` suffix on the workflow id, so
  Temporal accepts the restart without colliding with the completed
  execution.
- `agentTeamRunWorkflowInputSchema` gains optional `isResume` + `resumeNonce`
  fields. The workflow skips `initializeRunState` when `isResume === true`,
  preserving the architect's queued role-inbox + `wakeReason: "operator-answer"`
  that `recordOperatorAnswer` wrote before dispatch.
- `WorkflowDispatcher.startAgentTeamRunResumeWorkflow` — dedicated dispatcher
  method so the resume-only workflowId convention
  (`agent-team-run-{runId}-resume-{nonce}`) is enforced in one place.

## [0.2.13.0] - 2026-04-25

### Added
- **Operators can now close a conversation as "no action needed."** When the
  agent team produces a blocked turn for a greeting, acknowledgement, or
  off-topic customer message, the operator can mark the conversation done
  without sending a reply. The action is rejected with a 409 conflict if the
  customer sent a follow-up after the agent run finished, so an operator
  can't accidentally close a conversation while the customer's actual reply
  is sitting in the queue.

## [0.2.12.0] - 2026-04-25

### Changed
- Architect role now emits structured "questions to resolve" output instead of
  freeform blocked-reason strings. Each blocked turn lists the specific
  questions the architect needs answered, with explicit targets (customer,
  operator, or another internal role) and a deterministic question id of the
  form `{runId}-{turnIndex}-{questionIndex}`. Sets up the operator-facing
  resolution panel (UI lands in a follow-up PR).
- Agent-team event log gains three new kinds: `question_dispatched`,
  `question_answered`, `question_superseded`. Each dispatched question is now
  persisted to the event log with target/status payload so dashboards and
  resume flows can address questions by id.

### Added
- `parentRunId` column on `AgentTeamRun` for resume chains. Operator-resume
  flows in a follow-up PR set this to chain a resumed run to its parent.
- New positional-format compressed schemas (`compressedTurnResolutionSchema`,
  `compressedQuestionToResolveSchema`) with target / status / recommended-close
  code maps.

### Fixed
- `no_action_needed` resolution status no longer marks the role as blocked.
  Would have stranded acknowledgement-only conversations indefinitely; only
  `needs_input` blocks the role's inbox now.

## [0.2.11.0] - 2026-04-25

### Added
- **Staging and production migrations now have dedicated release gates.** `Run Migrations Staging` and `Run Migrations Production` wait for CI on their matching deployment branch, serialize runs per environment, verify Doppler database access, generate Prisma, apply committed migrations with transient retry, and require a clean post-migration Prisma status before services are deployed.
- **Migration PRs now get a destructive-SQL safety scan.** Changed `migration.sql` files fail CI when they include table/column drops, truncates, broad deletes, or risky column rewrites unless they carry an explicit reviewed destructive-change marker.
- **The migration safety scanner now catches Prisma's multiline `ALTER TABLE ... ALTER COLUMN ... SET NOT NULL` output.** A CI self-test covers the exact statement shape so the guard cannot drift back to line-only matching.

### Changed
- **The old migration workflow is manual recovery only.** Automatic release migrations no longer share one branch-switching workflow; manual reruns still use the same hardened migration script for staging or production.
- **Drift checks now assert raw SQL database objects before Prisma comparison.** CI verifies the pgvector HNSW index exists with the expected method and opclass before dropping it in the ephemeral database for Prisma's drift diff, so raw SQL coverage is checked instead of silently skipped.
- **Migration drift detection now matches Prisma 7's supported command surface.** The check applies committed migrations from scratch, verifies the raw pgvector index, removes that known Prisma-unmodelable index in the ephemeral database, then runs the schema drift diff.
- **Deployment docs now require the migration gate before Railway service deploys.** The staging and production runbooks describe CI, migration gates, required production environment approval, and the manual recovery path.

## [0.2.10.0] - 2026-04-23

### Changed
- **Queue → agents `/analyze` payload is a structured object, not a pre-stringified JSON blob.** `threadSnapshot` now travels the wire as a typed `ThreadSnapshot` object instead of `JSON.stringify(snapshot, null, 2)`. Eliminates the double-encoded `\"` escape noise in logs, drops ~20-30% of pretty-print overhead from the HTTP body, and collapses the parse path from two `JSON.parse` calls to one. Clean break at the schema (`analyzeRequestSchema.threadSnapshot = threadSnapshotSchema`) — no compat union. Pre-deploy drain is the plan: pause queue workers, wait one `AGENT_TIMEOUT_MS` (5 min) for in-flight analyses to finish or fail, deploy, resume. Any workflow that still lands on the new agent with an old string payload fails cleanly via the existing `handleAnalysisFailure` path (DB row marked `FAILED`, user re-triggers).
- **Prompt rendering moved to `apps/agents/src/prompts/thread-snapshot.ts`.** The queue activity no longer decides how the snapshot is shown to the LLM — the agent service owns its own prompt surface. Pretty-print preserved for parity; TOON migration deferred behind a token-saving + output parity eval.
- **`ThreadSnapshot` Zod schema uses shared enums and rejects drift.** `status` and event `source` reuse `supportConversationStatusSchema` / `supportConversationEventSourceSchema`; `channelId` is non-nullable (matching Prisma); both objects are `.strict()` so unknown fields from future `buildSnapshot` additions fail validation instead of silently slipping through.

## [0.2.9.0] - 2026-04-21

### Added
- **`docs/concepts/` — 9 architecture explainers describing how the system works right now.** `architecture.md` (big picture: three services, two Temporal queues, master data flow), `slack-ingestion.md` (webhook → signature → dedup → dispatch), `thread-grouping.md` (3-tier grouping algorithm + merge/reassign/undo), `support-conversation-fsm.md` (states, events, transitions, guards), `ai-analysis-pipeline.md` (trigger → workflow → agent → positional JSON → SSE), `ai-draft-generation.md` (draft FSM + `slackClientMsgId` idempotent delivery + reconciliation), `session-replay-capture.md` (SDK → ingest → storage → SessionDigest correlation), `auth-and-workspaces.md` (Google OAuth + auto-join + role hierarchy + the three auth surfaces), `codex-search.md` (indexing + hybrid search + RRF + LLM reranker). Every concept doc follows the openclaw convention: YAML frontmatter (`summary`, `read_when`, `title`) for agent-friendly scanning, an `## Invariants` section listing load-bearing rules agents must never violate, and a "Keep this doc honest" checklist at the bottom listing what to update when code changes.

### Changed
- **Engineering docs reorganized around three pillars.** Dropped `docs/plans/`, `docs/domains/`, and `docs/specs/` (23 forward-looking `impl-plan-*`, `spec-*`, `impl-*`, `design-*` files). New structure: `docs/concepts/` (architecture explainers, current reality), `docs/conventions/` (stable contracts and operating rules — unchanged), `docs/contracts/` (generated schemas — unchanged). Planning artifacts belong in PR descriptions, GitHub issues, or local `~/.gstack/` scratch, not in the repo. Added a "Doc Philosophy" section to `AGENTS.md` codifying the rule, including the requirement to update concept docs in the same PR when behavior changes. In-flight plans (MVP roadmap, elite-agent-handoff) preserved in `~/.gstack/projects/ducnguyen67201-TrustLoop/`; all removed files remain in git history.
- **Code comments no longer link to committed plan docs.** Swept 12 `// Plan: docs/plans/...` and `// See docs/plans/...` references from production code (hooks, components, services, Prisma schema, migration SQL). Comments that explained surrounding behavior kept; comments that were only pointers to plan sections removed. Rationale now lives in the code itself, in the new concept docs, or in commit history.

## [0.2.8.0] - 2026-04-20

### Added
- **Undo a merge or a message move with one click.** Every successful merge or reassign now surfaces a 10-second toast with an Undo button. Click it and the operation reverses via `supportInbox.undoCorrection` — the secondary conversation is unarchived, the thread alias is removed, the moved message returns to its origin. Undo works within a 24-hour window and rejects if a later correction depends on the one you're trying to reverse.
- **Structured correction logs.** Every merge, reassign, and undo emits a `[grouping-correction]` log line with `workspaceId`, `correctionId`, and `kind`. This is the signal that powers the Part B per-workspace grouping-threshold tuning in the plan (§9) — without changing the hot path, a nightly aggregation can compute correction rates from logs alone.

## [0.2.7.0] - 2026-04-20

### Added
- **Operators can move a single message to a different conversation.** Hover any customer message in the conversation view and click "Move to thread…" — a searchable picker opens listing other open conversations (filtered to the same channel by default; toggle widens to other channels with a warning that the server blocks cross-channel moves). Picking a target and hitting Enter routes through the `supportInbox.reassignEvent` procedure shipped in PR #48, stamps a `REASSIGNED_EVENT` breadcrumb on both sides of the move, and refreshes the timeline.

## [0.2.6.0] - 2026-04-20

### Added
- **Operators can merge conversations directly from the inbox UI.** New "Select threads" button on the board header puts the inbox into explicit select mode — checkboxes appear on every card, drag-drop is suppressed for the duration, and clicking a card toggles selection instead of opening the thread. Once ≥2 threads are selected, a "Merge" button in the toolbar opens a chip-based primary picker with a "Recommended" badge on the best candidate (assignee-first, then oldest). Hitting Enter confirms, submitting to the tRPC merge procedure shipped in PR #48. The inbox refreshes to reflect the archived secondaries.
- **Merged conversations now show the full combined timeline.** Opening a primary conversation unions events from every conversation that was merged into it, sorted by timestamp. Secondaries are archived but their messages still render under the primary.

## [0.2.5.0] - 2026-04-20

### Added
- **Operators can now merge two or more support conversations into one and reassign individual messages to a different conversation.** Backend wiring only — the inbox UI lands in PR 3. New tRPC procedures on `supportInbox`: `mergeConversations`, `reassignEvent`, `undoCorrection` (all operator-role). Every correction is idempotent via a `(workspaceId, idempotencyKey)` unique so a double-clicked submit returns the same correction id instead of a duplicate. Undo works within 24 hours and rejects if a later correction depends on the one being undone (formal dependency check over source/target conversations and the reassigned event).
- **Merge uses a two-phase commit that closes the ingress race.** Thread-alias rows are written in a dedicated transaction committed BEFORE the merge transaction starts, so a Slack webhook arriving for the secondary's `threadTs` during the merge still finds the alias and routes to the primary instead of spawning a phantom conversation.
- **Reassigned messages get a timeline breadcrumb on both sides.** Source and target conversations each get a `REASSIGNED_EVENT` row pointing at each other. Undo produces matching `REASSIGN_UNDONE` breadcrumbs. Merges get `MERGED` + `MERGE_UNDONE` the same way.
- **Three new realtime reasons** (`GROUPING_MERGED`, `GROUPING_REASSIGNED`, `GROUPING_UNDONE`) so the inbox SSE stream invalidates the right workspace view after every correction.

### Fixed
- **Ingress no longer spawns a phantom conversation when a Slack reply lands on a merged thread chain.** Previously the alias lookup ignored aliases where the target conversation was soft-deleted, which broke A→B→C merge chains (the A-alias still pointed at B, which was deleted). The lookup now follows `mergedIntoConversationId` up to 5 hops until it finds an active target.

## [0.2.4.0] - 2026-04-20

### Added
- **Schema foundations for thread merge / reassign.** New `SupportGroupingCorrection` table (8 columns, 3 indexes) captures every operator-driven grouping correction as an immutable audit row, with `@@unique([workspaceId, idempotencyKey])` so duplicate submissions return the existing correction instead of writing a second row. New nullable self-FK on `SupportConversation.mergedIntoConversationId` (with `@@index`) is the breadcrumb for merged conversations — Slack routing still uses `SupportConversationThreadAlias`, this column is for the merged-view UNION query. New `SupportConversationEvent.reassignedFromConversationId` records where a reassigned message originally lived. Three new `SupportConversationEventType` enum values — `REASSIGNED_EVENT`, `MERGE_UNDONE`, `REASSIGN_UNDONE` — and the new `SupportGroupingCorrectionKind` enum (`MERGE`, `REASSIGN_EVENT`) round out the schema.
- **No behavior changes.** This PR is schema-only. The service layer that writes into these tables lands in PR 2. See `docs/plans/impl-plan-thread-merge-split-reassign.md` §5 for the spec and §10 for the 5-PR rollout.

## [0.2.3.0] - 2026-04-20

### Added
- **Implementation plan: thread merge / split / reassign (B7).** Shipped `docs/plans/impl-plan-thread-merge-split-reassign.md` covering the manual correction primitives for the support grouper (merge + reassign; split deferred post-MVP), a `SupportGroupingCorrection` log that feeds future per-workspace learning, and the UX spec (explicit inbox select mode, chip-based merge dialog, layered 24h undo). Includes full `/autoplan` review (CEO/Design/Eng) with dual voices, two blockers caught (phantom `SupportMessage` model + soft-delete-in-transaction violations), and 10 literal error-copy strings.

### Fixed
- **`package.json` version synced to match `VERSION`.** Pre-existing drift: `package.json` had been stuck at `0.1.0` while the `VERSION` file advanced. Now both track together at `0.2.3.0`.

## [0.2.2.0] - 2026-04-20

### Added
- **`SupportConversation` now has a finite-state machine** (`packages/types/src/support/state-machines/conversation-state-machine.ts`). Every writer — ingress, operator reply, status update, override-done, analysis-failure escalation — goes through a pure `transitionConversation(ctx, event)` function instead of writing `status` directly. The transition table faithfully preserves current product behavior: operators can still drag-drop between any states, DONE still requires delivery evidence, reply-on-DONE preserves DONE, and customer messages still reopen DONE to UNREAD. 69 pure-FSM tests (40 existing + 29 new) cover every legal transition, every illegal transition, and both regression cases below.
- **`softUpsert` has a new `transformUpdate` callback.** Lets callers derive the update payload from the currently-persisted row atomically. Used by the ingress activity so the FSM transition runs inside the same operation as the write, preserving `softUpsert`'s three-branch shape (update / resurrect / create) without duplicating logic at the call site.
- **`tryConversationTransition` service helper** translates `InvalidConversationTransitionError` into a tRPC `CONFLICT` response at the API boundary.

### Fixed
- **Race bug: a late operator reply could silently demote `DONE` to `IN_PROGRESS`.** The previous code read `conversation.status` outside the write transaction and then wrote `IN_PROGRESS` if the pre-read value wasn't `DONE`. Under Postgres `READ COMMITTED` a concurrent `markDoneWithOverride` that committed after the read but before the write would be silently overwritten. Fixed by routing the write through a conditional `updateMany` with `where: { status: { not: DONE } }` so the atomic check replaces the stale pre-read. If the row is already `DONE` at write time the reply still posts but status stays `DONE` (matches the FSM's idempotent DONE+operatorReplied rule).
- **Analysis-failure escalation could overwrite a `DONE` conversation back to `IN_PROGRESS`.** `escalateToManualHandling` wrote `status: "IN_PROGRESS"` unconditionally — bypassing the delivery-evidence audit and reopening a deliberately-closed conversation. The activity now routes through the FSM which rejects `analysisEscalated` from DONE; the activity catches the typed error and returns cleanly. Any *other* invalid transition surfaces as `ApplicationFailure.nonRetryable` so Temporal treats it as terminal rather than retrying a permanent error forever.
- **`hasDeliveryEvidence` now queries inside the status-write transaction** (previously it ran outside, allowing a TOCTOU gap) and filters `deletedAt: null` (soft-deleted attempts no longer satisfy the DONE guard).

### Changed
- **Status writers are now consistent in shape.** Both `updateStatus` (drag-drop / dropdown) and `markDoneWithOverride` load the current row, dispatch a per-target FSM event, and let the FSM write `next.status` — no more scattered branching on `input.status === DONE` at the caller. Per-target events (`operatorSetUnread`, `operatorSetInProgress`, `operatorSetStale`, `operatorSetDone`) preserve compile-time exhaustiveness and let a future UI query `getAllowedConversationEvents(ctx)` to decide which drop targets to enable.
- **Implementation plan doc shipped at `docs/plans/impl-plan-support-conversation-state-machine.md`** — includes the `/autoplan` review report, 16 audit-trail decisions, and the final design notes reconciling per-target events + conditional-updateMany race fix.

## [0.2.1.0] - 2026-04-19

### Fixed
- **Operator commands now require a human operator.** Every support-inbox and support-analysis mutation (assign, reply, mark done, override, retry delivery, toggle reaction, trigger/approve/dismiss analysis) previously accepted workspace API keys (`tlk_*`) in addition to user sessions. Anyone holding a valid workspace key could send replies, close tickets, or trigger analysis runs without ever being a human operator. Those mutations now route through a role-gated procedure that requires a user session plus at least MEMBER role, and the middleware rejects API-key actors explicitly.
- **Workflow dispatch is no longer callable unauthenticated.** An unauthenticated tRPC procedure at `dispatchWorkflow` would let any caller enqueue support, support-analysis, repository-index, send-draft-to-slack, and codex workflows via `/api/trpc/dispatchWorkflow`. Most severely, `send-draft-to-slack` could post arbitrary content into customer Slack channels. The procedure had zero callers in the codebase. Removed entirely; internal workflow dispatch now lives only at the authenticated REST endpoint `/api/rest/workflows/dispatch` (behind `withServiceAuth`).

### Changed
- **`workspaceRoleProcedure` now fails closed on non-session actors.** The middleware used to rely on API-key contexts having a `null` role, which caused `hasRequiredRole` to return `false` and throw `FORBIDDEN`. That was a brittle contract implied by unrelated code. The middleware now asserts `ctx.session && ctx.user` up front and returns `UNAUTHORIZED`, then checks role. Downstream `ctx.user` is narrowed to non-nullable in role-gated handlers, so routers no longer need the `ctx.user?.id ?? ctx.apiKeyAuth?.keyId ?? "system"` fallback.

## [0.2.0.1] - 2026-04-19

### Added
- **First live TOON section in the support-analysis prompt.** Browser session route history now renders as its own structured prompt block, letting the agent receive the ordered URL trail in TOON format when the payload shape is eligible instead of burying it inside prose formatting.

### Changed
- **Support-analysis prompt rollout has moved from foundation-only to first measured usage.** The browser session appendix stays readable prose for environment, failure, network, console, and exception context, while the uniform `routeHistory` list becomes the first live TOON-powered section with the existing JSON fallback still intact.

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
