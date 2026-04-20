# Implementation Plan — Remove the External Sentry Integration

<!-- /autoplan restore point: ~/.gstack/projects/trustloop/main-autoplan-restore-20260419-170654.md -->

**Author:** Duc · **Date:** 2026-04-19 · **Branch:** main · **Status:** APPROVED (autoplan, hard-delete direction held over dual-voice REJECT, all eng fixes applied)

## 1. TL;DR

The Sentry integration shipped in the AI analysis flow reads a single global env credential (`SENTRY_AUTH_TOKEN/ORG/PROJECT/BASE_URL`), is therefore broken for multi-tenant B2B, and duplicates signals that TrustLoop's own browser SDK already captures and writes to `sessionEvent` / `sessionReplayChunk`. We are pulling it out completely. The SDK becomes the sole observability input for analysis. A future per-workspace adapter (if a customer asks) will be a separate effort, not this one.

## 2. Why

Product thesis: **TrustLoop is the observability layer for support.** Customers ship our SDK, we ingest their session telemetry, our agent reasons over it. The Sentry integration contradicts that:

| Signal the agent needs | TrustLoop SDK | Sentry tool today |
|---|---|---|
| JS exceptions | ✅ `EXCEPTION` event | ✅ duplicate |
| Network failures | ✅ `NETWORK_ERROR` | ⚠ partial (breadcrumbs) |
| Console errors | ✅ `CONSOLE_ERROR` | ⚠ partial (breadcrumbs) |
| Page navigations | ✅ `ROUTE` | ❌ |
| Clicks / user actions | ✅ `CLICK` | ❌ |
| Sourcemap-resolved stacks | ❌ | ✅ only real add |
| Visual replay | ✅ rrweb chunks | ❌ |

Plus three concrete bugs from the env-based design:
1. Every workspace queries the same Sentry project → wrong tenant data leaks into prompts the moment a second customer onboards.
2. `getConfig()` has no `workspaceId` parameter — there is no path to fix this without a rewrite.
3. The agent prompt currently *instructs* the LLM to use `searchSentry` "early" — that's wasted tool calls when the data is already in the digest.

## 3. In Scope / Out of Scope

**In scope:**
- Delete the `searchSentry` agent tool, `sentry-service.ts`, `sentry.schema.ts`, the `SENTRY_*` env vars.
- Strip the `fetchSentryContextActivity` from the support-analysis workflow.
- Drop the `sentryContext Json?` column on `SupportAnalysis` via a new migration.
- Remove the Sentry badge from `analysis-panel.tsx`.
- Update agent prompt to stop describing Sentry as a tool/context source.
- Update deploy docs (`deploy/README.md`, `spec-railway-deployment.md`) and the foundation conventions doc.
- Update the AI-analysis spec (`docs/domains/ai-analysis/spec-ai-analysis-draft-generation.md`) — replace Sentry sections with "removed; superseded by SDK session digest" pointers.

**Out of scope (call out, do not do):**
- Building a per-workspace Sentry OAuth adapter. Future ticket only — write to `TODOS.md`.
- Wiring rrweb chunks (frames at failure point) into the agent prompt. Natural follow-up. Future ticket only.
- Any change to the SDK itself.

## 4. What Already Exists (Reused, Not Re-Built)

| Sub-problem | Existing code |
|---|---|
| User session signals (clicks, routes, errors, network, console, exceptions) | `packages/sdk-browser/src/capture.ts` → `POST /sessions/ingest` → `sessionRecord` / `sessionEvent` |
| Visual replay capture | `packages/sdk-browser/src/recorder.ts` (rrweb) → `sessionReplayChunk` |
| Session digest fed to agent | `packages/rest/src/services/support/session-correlation/digest.ts` |
| Agent prompt assembly | `apps/agents/src/prompts/support-analysis.ts` (already injects digest) |

After this cleanup, the agent's **only** observability input is the digest assembled from the SDK. No external dependency.

## 5. File-by-File Changes

### 5.1 Delete entirely

| Path | Reason |
|---|---|
| `apps/agents/src/tools/search-sentry.ts` | Tool removed |
| `packages/rest/src/services/sentry/sentry-service.ts` | Service removed (and the empty `services/sentry/` folder) |
| `packages/types/src/support/sentry.schema.ts` | All `SentryIssue*` / `SentryEvent*` / `SentryContext` schemas + types |

### 5.2 Edit

**`apps/agents/src/agent.ts`**
- Drop `import { searchSentryTool } from "./tools/search-sentry";` (line 23)
- Drop `searchSentry: searchSentryTool,` from the tools map (line 60)

**`apps/agents/src/prompts/support-analysis.ts`**
- Lines 11, 25, 31–32, 40, 43, 49: rewrite. Remove every reference to "Sentry", "searchSentry", "error tracking". Update the tool list and investigation playbook so the agent reasons from the **session digest** for error/crash signals instead.
- Add a one-liner: "All error, network, console, and click signals you need are already in the session digest. Do not look outside it."

**`apps/queue/src/domains/support/support-analysis.activity.ts`**
- Remove `import * as sentry from "@shared/rest/services/sentry/sentry-service";` (line 3)
- Remove `SentryContext` type import (line 17)
- Delete `FetchSentryContextInput` / `FetchSentryContextResult` interfaces (lines 40–48)
- Delete the entire `fetchSentryContextActivity` function (lines 172–189)
- Remove any other reference to `sentryContext` in `buildThreadSnapshot` and the activity-level snapshot persistence

**`apps/queue/src/domains/support/support-analysis.workflow.ts`**
- Remove the `fetchSentryContextActivity` call (lines 26–27 and any state-transition logic that references it). The `GATHERING_CONTEXT` state stays — it still gathers the SDK digest — but the Sentry hop drops out.

**`apps/queue/src/runtime/activities.ts`**
- Drop `fetchSentryContextActivity,` from the imports + activity registration (line 15)

**`packages/types/src/support/index.ts`**
- Remove `export * from "@shared/types/support/sentry.schema";` (line 10)

**`packages/types/src/support/support-analysis.schema.ts`**
- Drop `import { sentryContextSchema } from "./sentry.schema";` (line 3)
- Drop `sentryContext: sentryContextSchema.nullable().optional(),` from the snapshot schema (line 144)

**`packages/env/src/shared.ts`**
- Delete the `// Sentry (AI Analysis context)` block (lines 56–60). Four env vars: `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_BASE_URL`.

**`packages/env/src/web.ts`**
- Delete the four `SENTRY_*` mappings (lines 32–35).

**`apps/web/src/components/support/analysis-panel.tsx`**
- Remove the Sentry badge render (line 121–122)
- Delete the `SentryBadge` component (lines 240–250)

### 5.3 Database migration

**New migration:** `packages/database/prisma/migrations/<timestamp>_drop_support_analysis_sentry_context/migration.sql`

```sql
ALTER TABLE "SupportAnalysis" DROP COLUMN "sentryContext";
```

Then in `packages/database/prisma/schema/analysis.prisma`:
- Remove `sentryContext Json?` (line 56) from `model SupportAnalysis`.

Run `npm run db:generate && npm run db:migrate` after the schema edit. Restart any running dev servers (the Prisma client is in-memory cached).

### 5.4 Docs

| File | Change |
|---|---|
| `deploy/README.md` (lines 112–113) | Remove `SENTRY_*` and `SENTRY_AUTH_TOKEN` from the env-vars-per-service tables |
| `docs/specs/spec-railway-deployment.md` (lines 186–187) | Same removal |
| `docs/conventions/foundation-setup-and-conventions.md` (lines 42, 224, 283) | Drop "Sentry for app and workflow observability" line; drop Sentry from the example adapters list; drop Sentry from the least-privilege tokens list |
| `docs/domains/ai-analysis/spec-ai-analysis-draft-generation.md` | Sections 7.x and inline references: replace with a single "Sentry integration removed — see SDK observability layer" pointer. Don't rewrite the spec; mark Sentry sections as deprecated and link to where the SDK + session digest are documented. |
| `docs/plans/impl-plan-first-customer-happy-path-mvp.md` (lines 9, 18, 104) | Strike Sentry from the happy path; mark line 104's "Sentry context fetch" checkbox as removed. |
| `TODOS.md` (lines 61, 69) | Remove Sentry from the unified-timeline TODO list. Add a new TODO: "Per-workspace Sentry adapter (OAuth) — only build if a paying customer asks for it." |
| `.env.example` (if present) | Strip `SENTRY_*` |

### 5.5 What we do NOT touch

- `graphify-out/*` — auto-regenerated by `graphify update .` after merge.
- `.skills/gstack/cso/ACKNOWLEDGEMENTS.md` — references Sentry's *security-skills repo*, not our integration.
- `packages/sdk-browser/**` — SDK is the new source of truth, no changes.

## 6. Ordering

**Single atomic commit.** Both Eng voices flagged that splitting steps 1 and 2 produces a broken intermediate commit (the migration drops a column that the activity still writes to; orphaned Sentry imports break type-check). The five fix groups below must land together in one commit on one PR.

Order of work *within* the commit (for the author's sanity, not for git history):

1. Edit `packages/database/prisma/schema/analysis.prisma` → remove `sentryContext Json?`.
2. Add new migration `<timestamp>_drop_support_analysis_sentry_context/migration.sql` with `ALTER TABLE "SupportAnalysis" DROP COLUMN "sentryContext";`.
3. Run `npm run db:generate`.
4. Strip activity (`fetchSentryContextActivity`, type imports, `sentryContext` Prisma writes), workflow (the activity call), runtime registration.
5. Strip agent tool registration (`agent.ts`), tool file (`search-sentry.ts`), and rewrite the prompt with the literal diff in §6.1 below.
6. Strip web UI badge (`analysis-panel.tsx`).
7. Strip type schemas (`sentry.schema.ts`, the import + field in `support-analysis.schema.ts`, the barrel re-export in `support/index.ts`).
8. Strip env vars (`packages/env/src/shared.ts` + `web.ts`).
9. Delete `packages/rest/src/services/sentry/sentry-service.ts` + the empty `services/sentry/` directory.
10. Update docs (per §5.4).
11. `npm run check` at the repo root — tsgo + biome + tests must pass.
12. Single commit, single PR.

### 6.1 Prompt rewrite — literal diff

In `apps/agents/src/prompts/support-analysis.ts`, apply this diff:

```diff
- You are a senior support engineer investigating a customer's technical question.
- You have access to the team's codebase, error tracking (Sentry), and can create
- GitHub PRs for fixes.
+ You are a senior support engineer investigating a customer's technical question.
+ You have access to the team's codebase, the customer's session digest (clicks,
+ navigations, network failures, console errors, JS exceptions captured by our
+ in-product SDK), and can create GitHub PRs for fixes. The session digest is
+ your primary observability source — error, network, console, and click signals
+ are already there. Do not look outside it.

- 3. Search Sentry for related errors (searchSentry) — especially if the message
-    mentions errors, crashes, or unexpected behavior.
- 4. Cross-reference: do the Sentry stack traces point to the code you found?
+ 3. Read the session digest first — failures, network errors, console output,
+    and the user's last actions are already captured there.
+ 4. Cross-reference: do the digest's exception stack traces point to the code
+    you found?

- - Use searchSentry early: if the customer reports an error, search Sentry for
-   matching issues before diving into code.
- - Cross-reference Sentry and code: if a Sentry stack trace points to a file,
-   search for that file in code.
+ - Use the session digest early: if the customer reports an error, the
+   exception stack trace and surrounding actions are usually in the digest.
+ - Cross-reference digest and code: if a digest exception points to a file,
+   search for that file in code.

- - **searchSentry**: When the customer mentions errors, crashes, 500s, timeouts,
-   or unexpected behavior. Also useful to check if an issue is known/recurring.
+ (delete this bullet — searchSentry no longer exists)
```

Tools list section: drop the `searchSentry` entry entirely.

### 6.2 Eng fixes (applied per dual-voice consensus)

- **One atomic commit** (above). No partial commits.
- **Prompt regression assertions** in `apps/agents/test/support-analysis-prompt.test.ts`:
  ```ts
  expect(SUPPORT_AGENT_SYSTEM_PROMPT).not.toMatch(/sentry/i);
  expect(SUPPORT_AGENT_SYSTEM_PROMPT).toMatch(/session digest/i);
  ```
- **DoD grep exemptions** (see updated §10): exclude `packages/database/src/generated/` (gitignored), `packages/database/prisma/migrations/20260411200001_*` (historical, immutable), `graphify-out/`, `.skills/gstack/cso/ACKNOWLEDGEMENTS.md` (unrelated reference).
- **PR description must include** the operational notes in §7 verbatim.

## 7. Production / Deploy Migration

- **Material strength:** The `sentryContext` column is **write-only from the agent's perspective**. The agent service POST at `support-analysis.activity.ts:320-333` only sends `threadSnapshot` and `sessionDigest`. The column was never read by the agent — only by the `SentryBadge` UI, which this PR removes in the same commit. **Therefore deletion cannot regress agent output quality** — only a single UI badge disappears.
- **Env vars:** `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_BASE_URL` should be removed from Railway *after* the deploy ships. Removing early is harmless — the code becomes optional, then no-op, then absent.
- **DB column drop:** non-reversible. Existing `sentryContext` JSON blobs on historical `SupportAnalysis` rows will be lost. Acceptable — never customer-visible, only consumer is removed in this PR. Note in the migration commit message. Optional: `SELECT count(*) FROM "SupportAnalysis" WHERE "sentryContext" IS NOT NULL` on a snapshot before the migration applies; record the count in the PR description for forensic record.
- **No customer impact** — Sentry was never a documented or enabled feature for any external workspace.
- **Rollout ordering (worker → migration):** New `web` and `queue` images must complete rollout *before* the migration applies, otherwise old pods will hit `P2022 column does not exist` against the dropped column. On Railway the deploy sequence is: image push → instance restart → migration. The window is small but non-zero. If the deploy platform applies the migration before all old pods drain, expect a brief 500 spike on `web`/`queue`. Document the order in the PR description.
- **Stale Temporal tasks:** Workflows that started before the deploy and are mid-`fastActivities.fetchSentryContextActivity(...)` when the new worker boots will see "Activity type 'fetchSentryContextActivity' is not registered" and fail. The workflow's existing `maximumAttempts: 2` will then trigger the standard escalation path (`escalateToManualHandling`). Acceptable for an internal-only feature; document in the PR.
- **Post-deploy verification:**
  - Zero log lines matching `[sentry]` in worker logs over 24h.
  - SSE analysis stream still emits `analysis_completed` at the same rate (~200ms faster `GATHERING_CONTEXT → ANALYZING` due to one fewer activity hop).
  - Manual smoke: run a live Slack thread through analysis, confirm a draft is produced.

## 8. Test Plan

Eng review found that the existing test coverage is thinner than originally claimed. Updated table reflects ground truth.

| Codepath | New test? | Existing coverage | Notes |
|---|---|---|---|
| `support-analysis.workflow` GATHERING_CONTEXT → ANALYZING transition | No | **None exists for this workflow.** Pure state-machine is covered by `packages/types/test/state-machines.test.ts` (which passes regardless — `contextReady` event carries no Sentry payload). | Acceptable: state machine is pure, removing one activity in the orchestration does not change transition behavior. Honest acknowledgment, no new test required. |
| `support-analysis.activity.buildThreadSnapshot` | No | None directly. | The function still resolves customer email + builds session digest — both unchanged. |
| `support-analysis.activity.fetchSentryContextActivity` | N/A — being deleted | None | No mocks reference it. |
| Agent tool registration (`searchSentry` removed from tools map) | No | tsc covers it | If `agent.ts` still imports the deleted file, type-check fails. |
| Agent prompt does not mention Sentry (regression guard) | **Yes — add to** `apps/agents/test/support-analysis-prompt.test.ts` | n/a | Add: `expect(SUPPORT_AGENT_SYSTEM_PROMPT).not.toMatch(/sentry/i);` and `expect(SUPPORT_AGENT_SYSTEM_PROMPT).toMatch(/session digest/i);` |
| Prisma client regeneration | N/A | `db:generate` no-diff CI guard | If the schema diff exposes a stale generated client, CI catches it. |
| End-to-end analysis (Slack thread → draft) | Manual smoke | none automated | Run a live Slack thread through analysis after deploy and verify a draft is produced. Track in PR description. |

`npm run check` is the gate. If type-check fails on any orphaned `SentryContext` import, fix it.

## 9. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Orphaned import we missed → type-check fails | Medium | Caught by CI | `npm run check` locally before pushing |
| Spec doc (`docs/domains/ai-analysis/spec-ai-analysis-draft-generation.md`) becomes internally inconsistent | Medium | Confusing for future engineer | Mark Sentry sections as `[REMOVED]` rather than silently edit-around — preserves the historical "why" |
| Migration drops data on prod that someone secretly relied on | Low | Recoverable from backups | None — feature was internal-only, no customer surface |
| Agent quality drops because Sentry was carrying weight in some prompts | Low | Draft quality regression | Spot-check 5 recent threads after deploy; if regression, the fix is to enrich the SDK digest, not to bring Sentry back |

## 10. Definition of Done

- `npm run check` passes locally and in CI.
- **DoD grep:** `git grep -in sentry` returns zero hits in `apps/`, `packages/` (excluding `packages/database/src/generated/` which is gitignored, and `packages/database/prisma/migrations/20260411200001_*` which is an immutable historical migration), and `docs/specs/`. Acceptable hits anywhere:
  - `TODOS.md` — the "future adapter" note.
  - `.skills/gstack/cso/ACKNOWLEDGEMENTS.md` — references Sentry's security-skills repo, unrelated.
  - `graphify-out/` — auto-regenerated by `graphify update .` post-merge.
  - `packages/database/prisma/migrations/<new-timestamp>_drop_support_analysis_sentry_context/migration.sql` — the new drop migration itself contains `sentryContext`.
- The new drop migration applies cleanly on a fresh DB and on a snapshot of staging.
- Prompt regression assertions pass (`not.toMatch(/sentry/i)` + `toMatch(/session digest/i)`).
- A live support analysis end-to-end run still produces a draft.
- Railway env vars `SENTRY_*` removed from `web` and `queue` services after deploy ships.
- One PR, one atomic commit, merged.

## 11. Future Work (TODO, not this PR)

1. **Wire rrweb chunks into the agent prompt** — frames at the failure point become "the agent saw what the user saw". Highest-leverage next step.
2. **Per-workspace Sentry adapter** — only if a paying customer asks. Per-workspace OAuth, encrypted token in `sentryConnection`, `getConfig(workspaceId)`. Roughly mirrors the existing GitHub install pattern.

---

## CEO Phase — Dual Voices

### CODEX SAYS (CEO — strategy challenge)

> Verdict: **REJECT** — removing the broken global Sentry path is right, but this plan overclaims SDK readiness and hard-deletes too early without repo evidence of real SDK adoption.

Concrete findings (with file:line citations):
- **CRITICAL — SDK adoption unverified.** The only non-test `TrustLoop.init` is in `apps/demo-app/src/lib/sdk.ts:20`. SDK spec is "In Progress" (`docs/domains/session-replay/spec-session-replay-sdk.md:3`). Install docs unchecked (`docs/domains/session-replay/impl-session-replay-checklist.md:77`). Settings UI links to a nonexistent setup page (`apps/web/src/components/session-replay/session-tab.tsx:75`).
- **HIGH — Correlation path is narrow.** Email-only match, 30-min window, single most-recent session, capped at 200 events (`packages/rest/src/services/support/session-correlation/find.ts:27,29,46`). Digest leaves `viewport` blank (`digest.ts:66`) and carries raw stack strings, not sourcemap-resolved frames (`digest.ts:210`).
- **HIGH — SDK foundation is rough.** Default ingest path in `packages/sdk-browser/src/config.ts:3` disagrees with the documented route in `spec-session-replay-sdk.md:106`. Demo app overrides it manually.
- **HIGH — Quarantine, don't delete.** Multi-tenancy is broken; that argues "stop trusting Sentry now," not "drop the DB column today."

Strategic reframe: don't make "remove Sentry" the headline. Make `session replay + structured browser timeline + rrweb-into-prompt + reliable correlation` the product story. Removing Sentry is housekeeping in service of that story, not the story itself.

Recommended: two-phase deprecation. **Phase A:** disconnect Sentry from the agent path, gate `searchSentry`, stop writing `sentryContext`, keep the column for rollback, add metrics for digest coverage / correlation rate / draft quality. **Phase B:** drop the column and delete the code only after SDK adoption is real and the fallback is empirically unused.

### CLAUDE SUBAGENT (CEO — strategic independence)

> Verdict: **REJECT** — wrong default. The fix is not "delete because broken multi-tenant"; it's "fix multi-tenant or feature-flag." Verify SDK adoption before pulling the only working observability path.

Concrete findings:
- **CRITICAL — Premise unverified: SDK adoption may be zero.** Recommends counting active `sessionRecord` rows per workspace in prod for the last 30 days. If only TrustLoop's own workspace has events, deletion makes the agent dumber for prospect demos.
- **HIGH — False equivalence in the signal table.** Sentry provides aggregations the SDK does not: issue grouping/fingerprinting, first-seen/last-seen, regression detection, release health, affected-user counts, sourcemap-resolved stacks. The plan's table conflates *capture* with *value*.
- **HIGH — Per-workspace adapter is 80% built.** `getConfig(workspaceId)` is a 1-day refactor, not a future ticket. Choice should be conscious: refactor → BYO-Sentry as a marketed feature, or delete → accept rebuild cost. Don't default to delete because env-based is broken.
- **MEDIUM — 6-month enterprise regret.** First enterprise prospect with existing Sentry/Datadog will ask "can you correlate against our 5 years of incidents?" Pylon and similar tools market integrations as a moat.
- **MEDIUM — Migration drops data with weak justification.** Two-phase migration is safer: PR1 stops writing + removes badge, PR2 (weeks later) drops the column.

### CEO Consensus Table

```
═══════════════════════════════════════════════════════════════════
  Dimension                                Claude  Codex  Consensus
  ──────────────────────────────────────── ─────── ─────── ─────────
  1. Premises valid? (SDK ready)              ❌      ❌    DISAGREE w/ plan
  2. Right problem to solve?                  ⚠       ⚠    REFRAME (rrweb headline)
  3. Scope calibration correct?               ❌      ❌    Two-phase, not hard-delete
  4. Alternatives sufficiently explored?      ❌      ❌    Per-WS adapter / feature-flag dismissed
  5. Competitive/market risks covered?        ❌      ❌    Pylon-style BYO-observability
  6. 6-month trajectory sound?                ❌      ❌    Regret scenario unaddressed
═══════════════════════════════════════════════════════════════════
6/6 confirmed REJECT. Both models converge on the same fix:
  → Two-phase deprecation. Disconnect Sentry from agent path now,
    drop schema/code only after SDK adoption is empirically verified.
```

This is a **USER CHALLENGE** (per autoplan rules). The user's confirmed premises (P1: SDK is the source / P2: drop the column / P3: separate PR for rrweb) are now contradicted by both independent voices. Surface at the final gate; do not auto-decide.

---

## Eng Phase — Dual Voices

### CODEX SAYS (eng — architecture challenge)

> Verdict: **REJECT** — Hard-delete is mechanically possible, but this plan's rollout order, grep DoD, and claimed test coverage are wrong; disconnect-first Phase A is materially safer at the engineering level.

- **CRITICAL — Plan ordering breaks intermediate commits.** Step 1 (drop column) leaves `fetchSentryContextActivity` writing to a dropped column at `support-analysis.activity.ts:172`. Step 5/6 leaves `sentry-service.ts:1` importing types/env that step 5/6 just removed. **Mixed-version deploy after the DB migration will 500 old `web`/`queue` pods at runtime.**
- **HIGH — DoD grep is impossible as written.** The historical migration `20260411200001_ai_analysis_fields_and_settings/migration.sql:1` already contains `sentryContext` (correctly — past migrations are immutable). Generated Prisma artifacts under `packages/database/src/generated/prisma/**` also contain the field. Plan must exempt these dirs.
- **HIGH — Test plan is inaccurate.** No queue workflow/activity tests for this deletion path exist. Only nearby tests are `support-analysis-trigger.activity.test.ts` and `support-analysis-prompt.test.ts`. No tests mock `fetchSentryContextActivity`, `sentry.fetchContext`, `searchSentry`, or assert `sentryContext`. **Few tests breaking is worse than breakage** — there is no safety net.
- **MEDIUM — Confirmed write-only column.** Activity writes at `:181`, badge reads at `analysis-panel.tsx:121`, agent POST at `:320` only sends `threadSnapshot` + `sessionDigest`. Strengthens the two-phase case: Phase A can disconnect safely without touching schema.
- **MEDIUM — State machine OK.** `contextReady` event in `analysis-state-machine.ts:19` carries no Sentry payload. `markAnalyzing` at `:214` only transitions status. Removing `fetchSentryContextActivity` does not break `GATHERING_CONTEXT → ANALYZING`.

Codex's minimal Phase A diff:
1. Keep DB column + `sentry.schema.ts`.
2. `fetchSentryContextActivity` returns `{ sentryContext: null }` immediately, no HTTP call.
3. Remove `SentryBadge` from UI.
4. Update prompt: session digest is the primary observability input.
5. Gate `searchSentry` tool registration in `agent.ts` behind config (don't advertise when unusable).
6. Keep env/schema/service for rollback until Phase B proves them unused.

### CLAUDE SUBAGENT (eng — independent review)

> Verdict: **APPROVE WITH CONCERNS** — direction and surface analysis are right, but commit-staging guidance is wrong, test plan misattributes coverage, and zero-downtime + stale-task risks deserve explicit operational notes. Fix those three and ship as one atomic commit.

- **HIGH — Commit-staging is wrong.** Plan §6 says "splitting steps 1 and 2 into separate commits inside the PR is fine" — false. Step 1 alone fails type-check because `support-analysis.activity.ts:184` writes `sentryContext` against the now-missing field. **Schema edit + all TS edits must land in one commit.**
- **HIGH — Test misattribution.** Plan says "existing workflow tests in `apps/queue/test/**`" — there are none for `support-analysis.workflow.ts`. Covering test is the pure state-machine test in `packages/types/test/state-machines.test.ts`. Either add a thin workflow test or strike the row.
- **MEDIUM — Zero-downtime hazard.** Old worker pod hitting dropped column during rolling deploy → Prisma `P2022 column does not exist`. Document worker-restart-before-migration order, or take the two-phase route.
- **MEDIUM — Stale Temporal tasks.** Workflow mid-`fetchSentryContextActivity` when new worker boots → "Activity type not registered" → retries until timeout. Acceptable (auto-fail after `maximumAttempts: 2`, falls into existing escalation path), but document.
- **MEDIUM — Prompt rewrite scope under-specified.** Plan says "rewrite" without literal diff. Risks half-edit. Include literal proposed prompt diff in the PR.
- **MEDIUM — `support-analysis-prompt.test.ts` won't catch regressions.** Add `expect(SUPPORT_AGENT_SYSTEM_PROMPT).not.toMatch(/sentry/i)` and `.toMatch(/session digest/i)`.
- **LOW** — wording nit ("snapshot schema" → "row schema"); old migration SQL note for PR description.

**Material strength** (both voices agree): `sentryContext` is **write-only from the agent's perspective**. The agent never reads it. Removing it cannot regress draft quality. Plan should call this out in §7 to strengthen the case.

### Eng Consensus Table

```
═══════════════════════════════════════════════════════════════════
  Dimension                                Claude  Codex  Consensus
  ──────────────────────────────────────── ─────── ─────── ─────────
  1. Architecture sound?                      ✅      ✅    CONFIRMED
  2. State machine integrity?                 ✅      ✅    CONFIRMED (no break)
  3. Migration safety?                        ⚠       ⚠    CONFIRMED hazard (rollout race)
  4. Test coverage sufficient?                ❌      ❌    CONFIRMED inaccurate
  5. PR ordering safe?                        ❌      ❌    CONFIRMED — must be one commit
  6. Disconnect-first preferred?              ⚠       ✅    LEAN toward two-phase
  7. Column is write-only (cleaner deletion)? ✅      ✅    CONFIRMED
═══════════════════════════════════════════════════════════════════
Verdicts: Codex REJECT, Claude APPROVE WITH CONCERNS.
Both agree on the same fix list:
  → Land as ONE atomic commit (no intermediate broken state)
  → Strike or replace inaccurate test rows
  → Document worker rollout order + stale-task tolerance
  → Include literal prompt diff
  → Add prompt regression assertions
  → Exempt generated Prisma + historical migration from DoD grep
```

## Cross-Phase Themes

Both phases independently surfaced these — high-confidence signals:

1. **Disconnect-first is safer than hard-delete.** CEO: SDK adoption unverified, can't afford to lose observability. Eng: rollout race + missing tests + irreversible DB change. Both phases recommend identical Phase A scope.
2. **`sentryContext` is write-only from the agent.** CEO didn't see this; Eng confirmed. This means the deletion can't regress agent output quality — only a UI badge disappears. **This unlocks a much smaller, safer disconnect-first PR.**
3. **Plan undersells the SDK→Sentry asymmetry.** CEO flags missing capabilities (sourcemap stacks, cross-session aggregation). Eng flags unverified test coverage of the SDK side. Net: SDK is not yet a strict superset of Sentry on every dimension.

---

## Decision Audit Trail

<!-- AUTONOMOUS DECISION LOG -->

| # | Phase | Decision | Classification | Principle | Rationale | Rejected |
|---|-------|----------|----------------|-----------|-----------|----------|
| 1 | CEO | Mode = SCOPE REDUCTION (deletion plan) not SELECTIVE EXPANSION | mechanical | P5 (explicit) | Plan is subtractive; CEO mode adapts | SELECTIVE EXPANSION |
| 2 | CEO | Premise gate raised to user (P1/P2/P3) | mechanical | skill rule | Premises are non-auto-decidable | n/a |
| 3 | CEO | Both voices' REJECT raised as USER CHALLENGE at final gate | mechanical | skill rule | Both models recommend changing user-confirmed direction | auto-acceptance |
| 4 | Design | SKIP design phase | mechanical | P3 (pragmatic) | Only UI change is removing one conditional badge; no IA, hierarchy, or state changes | run design phase |
| 5 | Eng | Land as one atomic commit, not staged 1+2 | taste→auto | P5 (explicit) | Both voices agree split breaks build; explicit is safer | staged commits |
| 6 | Eng | DoD grep exempts `packages/database/src/generated/**` and historical migrations | mechanical | P3 (pragmatic) | Generated Prisma is gitignored; historical migrations are immutable | literal zero-hits grep |
| 7 | Eng | Add prompt regression test (`not.toMatch(/sentry/i)` + `.toMatch(/session digest/i)`) | mechanical | P1 (completeness) | Single-line cost, prevents silent rot | skip the assertion |
| 8 | Eng | Strike inaccurate test row claiming workflow coverage | mechanical | P5 (explicit) | Test does not exist; honesty > optimism | leave inaccurate |
| 9 | Eng | Document worker-rollout order + stale-task tolerance in PR description | mechanical | P5 (explicit) | Operational note; near-zero cost | omit |
| 10 | Eng | Two-phase (disconnect-first) raised as USER CHALLENGE at final gate | mechanical | skill rule | Both Eng voices independently reach the same fix as CEO voices | auto-decide one way |
