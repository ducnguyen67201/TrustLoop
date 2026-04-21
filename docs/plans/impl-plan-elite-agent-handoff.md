<!-- /autoplan restore point: /Users/ducng/.gstack/projects/trustloop/feat-rrweb-into-agent-prompt-autoplan-restore-20260419-184008.md -->
<!-- /autoplan status: APPROVED 2026-04-19 (user overrode unanimous CEO reduce-scope at premise gate; eng revisions R1-R10 applied) -->
# Implementation Plan: Elite Agent Handoff

Status: DRAFT (pre-review). Branch: `feat/rrweb-into-agent-prompt` (will likely cut a new branch for implementation).

## Problem

TrustLoop's support flow today is a single Mastra agent called once via HTTP with two tools (`searchCode`, `createPullRequest`). That's tier 1 on any agent-framework maturity curve. For a first paying customer to believe the product actually fixes their bugs, tier 1 isn't enough. Concretely:

1. **The draft reply never reaches Slack.** `approveDraft()` in `packages/rest/src/services/support/support-analysis-service.ts:122` flips draft status to `APPROVED` and stops. No delivery activity runs, no transition to `SENT`, no `sentAt`. The entire customer-visible happy path dead-ends at approval.
2. **Code fixes fire inline during analysis.** The agent's `createPullRequest` tool runs from inside the same LLM loop that's diagnosing. No verification, no test run, no gate. A hallucinated fix becomes a real GitHub draft PR.
3. **No codex workflow handoff exists.** The `CODEX` Temporal queue is registered (`apps/queue/src/domains/codex/fix-pr.workflow.ts`), `runFixPrPipeline` is a stub returning `{status:"queued"}`. Post-approval heavy fixing has nowhere to live.
4. **One agent, one context.** Triage, investigation, drafting, code-fixing, and PR opening all share one prompt, one model, one reasoning trace. No role separation, no evaluator, no fixer → test → retry loop.

## Who this is for

The first paying customer, and the three promises they need to believe:

- "When I Slack a bug, you reply accurately with what happened." → requires the reply to actually ship.
- "When you say you've opened a PR, the fix is real and tested." → requires verification before PR creation.
- "When the AI is wrong, it says so instead of inventing a fix." → requires confidence gating and human escalation.

Without these, the demo works and the product doesn't.

## Goals

- Close the draft → Slack delivery gap. End-to-end happy path must work on day one of this plan shipping.
- Split the monolithic analysis agent into role-scoped agents, each a Temporal activity with typed input/output.
- Introduce an evaluator agent that grades the draft reply before persistence.
- Move PR creation out of analysis and into a separate codex workflow that runs after human approval, with sandboxed fix → test → verify before the PR opens.
- Add confidence gates at every role boundary so low-confidence outcomes escalate to humans instead of producing bad artifacts.

## Non-goals

- Full migration off Mastra. Stay on the current agent framework.
- Production-grade sandbox (per-run VM, firecracker, etc.). V1 uses a docker-compose service with the repo mounted.
- Multi-model voting / ensembles.
- Autonomous PR merge. Humans still click merge.
- Reworking Slack ingress or session correlation.

## Current state (tier 1)

```
SUPPORT queue                                 AGENTS service (HTTP)
─────────────                                 ─────────────────────
supportAnalysisWorkflow
  1. buildThreadSnapshotActivity
  2. renderFailureFramesActivity
  3. captionFailureFramesActivity
  4. markAnalyzingActivity
  5. runAnalysisAgentActivity ──────────────> POST /analyze
                                              ┌──────────────────────┐
                                              │ Mastra Agent         │
                                              │  tools:              │
                                              │   - searchCode       │
                                              │   - createPullRequest│──► codex.createDraftPullRequest()
                                              │  maxSteps: 8         │      (synchronous, inside LLM loop)
                                              │  one reasoning loop  │
                                              └──────────────────────┘
  6. persistAnalysisResult
  7. persistDraft (AWAITING_APPROVAL)

approveDraft()
  → status = APPROVED
  → DEAD END (nothing sends the reply, nothing handles PR follow-up)
```

## Target state (tier 3)

Six role-scoped agents behind five Temporal activities, orchestrated across SUPPORT and CODEX queues. Every boundary is an activity, typed, retryable, observable.

```
SUPPORT queue                                            CODEX queue
─────────────                                            ────────────
supportAnalysisWorkflow
  ├─ buildThreadSnapshot  (unchanged)
  ├─ renderFailureFrames  (unchanged)
  ├─ captionFailureFrames (unchanged)
  ├─ triageActivity ─────────> intent: REPLY_ONLY | INVESTIGATE | ESCALATE
  │                            output: {intent, confidence, rationale}
  │                            confidence < 0.5 → ESCALATE (skip rest)
  ├─ investigateActivity ────> tools: searchCode, readFile, getGitBlame, getSessionEvents
  │                            output: {findings[], rootCause, affectedFiles[], confidence}
  ├─ draftReplyActivity ─────> tools: none (pure composition)
  │                            output: {draft: {subject, body}, confidence}
  ├─ evaluateDraftActivity ──> grades draft against session digest + findings
  │                            output: {verdict: PASS | REVISE | ESCALATE, reasons[]}
  │                            REVISE → retry draftReply once; 2nd REVISE → ESCALATE
  └─ persistAnalysis + persistDraft (AWAITING_APPROVAL)

approveDraft()
  ├─ dispatch sendDraftToSlackWorkflow (SUPPORT queue)
  │   ├─ sendDraftActivity → slackDelivery.sendThreadReply
  │   └─ markDraftSent (SENT + deliveredAt + DRAFT_SENT event)
  │
  └─ if triage.intent == INVESTIGATE AND evaluator.verdict == PASS AND affectedFiles.length > 0:
       dispatch startCodexWorkflow(fixPrWorkflow) ──────────────────────┐
                                                                        ▼
                                                         fixPrWorkflow (CODEX queue)
                                                          ├─ prepareSandboxActivity
                                                          ├─ loop (max 3 iterations):
                                                          │   ├─ fixerAgentActivity (sandboxed)
                                                          │   └─ runTestsActivity
                                                          │   if tests green → break
                                                          ├─ if tests still red → HOLD_FOR_HUMAN
                                                          ├─ verifierAgentActivity
                                                          │   asserts patch matches root cause
                                                          │   verdict: OPEN_PR | HOLD_FOR_HUMAN
                                                          └─ if OPEN_PR → createDraftPullRequest
```

## Architecture decisions

### 1. Temporal activities as handoff boundaries

Each role is a Temporal activity, not an internal function call inside the agent service. Reasons:

- **Observability**: one span per role, independent latency, tokens, cost.
- **Retries**: transient LLM failures retried per role, not across the whole pipeline.
- **Deterministic ordering**: workflow code owns the sequence. Agent service stays stateless.
- **Partial completion**: if `evaluateDraftActivity` fails hard, the workflow can still persist the draft with an `ESCALATED` annotation instead of discarding everything upstream.

Trade-off: 5-6 HTTP round trips to the agents service instead of 1. Mitigated by keepalive and regional colocation. Agent service is a thin Mastra wrapper — no cold start.

### 2. Agent service exposes one endpoint per role

`apps/agents/src/server.ts` adds:

- `POST /agents/triage`
- `POST /agents/investigate`
- `POST /agents/draft`
- `POST /agents/evaluate`
- `POST /agents/fix` (sandbox-aware)
- `POST /agents/verify`

Each route calls a role-specific function in `apps/agents/src/roles/<role>.ts`. Shared helpers (model resolution, provider config, output parsing) live in `apps/agents/src/lib/`. The current `/analyze` endpoint becomes a compatibility shim that internally calls triage → investigate → draft → evaluate during the rollout window, deleted once Temporal workflow is migrated.

### 3. Per-role prompts, per-role tool sets

| Role | Tools | Prompt focus |
|------|-------|--------------|
| triage | none | Classify: does this need code investigation, is it a how-to, is it too ambiguous? |
| investigate | searchCode, readFile, getGitBlame, getSessionEvents | Find root cause. Cite specific lines. |
| draft | none | Write the customer-facing reply. Tone, accuracy, length. |
| evaluate | none | Grade draft against findings and session digest. Reject hallucinations. |
| fix | readFile, writeFile (sandbox), runTests (sandbox) | Produce minimal patch. Iterate until tests pass. |
| verify | readFile (sandbox), readDiff (sandbox) | Assert patch addresses root cause, nothing else. |

Reply-facing roles (triage, draft, evaluate) never touch code. Code-facing roles (investigate, fix, verify) never touch reply drafting. Clean separation reduces prompt size and cross-concern reasoning.

### 4. Confidence as a first-class output

Every role's Zod output schema includes `confidence: number().min(0).max(1)`. Gates:

- `triage.confidence < 0.5` → ESCALATE. No further agents run.
- `evaluate.verdict == REVISE` → draft retried once. Second REVISE → ESCALATE.
- `verify.verdict == HOLD_FOR_HUMAN` → no PR. Draft reply gets appended with "we have a candidate fix but held it for human review."

Thresholds live on the `Workspace` row (new columns: `triageConfidenceThreshold`, `fixerMaxIterations`) so customers can tune.

### 5. Inline PR tool is removed

The `createPullRequestTool` comes off the investigator agent entirely. PRs are only created by the codex workflow's `createDraftPullRequest` activity, which only runs after verifier PASS.

Alternative considered: keep the tool behind a "fast path" feature flag for very-high-confidence cases. Rejected in V1 because it reintroduces the unsafe path we're trying to close. Can revisit after we have eval data.

## Data model changes

### Prisma schema additions

```prisma
// packages/database/prisma/schema/support.prisma
model SupportDraft {
  // ... existing fields
  deliveredAt    DateTime?
  deliveryError  String?
  sendAttempts   Int       @default(0)
}

model SupportAnalysis {
  // ... existing fields
  triageIntent       String?  // TRIAGE_INTENT enum as string
  triageConfidence   Float?
  evaluatorVerdict   String?  // EVALUATOR_VERDICT enum as string
  evaluatorReasons   String[]
  escalationReason   String?
}

// packages/database/prisma/schema/codex.prisma
model CodexFixRun {
  id                String   @id @default(cuid())
  workspaceId       String
  analysisId        String
  workflowId        String   @unique
  status            String   // CODEX_FIX_STATUS enum
  iterations        Int      @default(0)
  testOutput        String?
  patchDiff         String?
  verifierVerdict   String?
  verifierReasons   String[]
  prUrl             String?
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
  completedAt       DateTime?

  workspace Workspace       @relation(fields: [workspaceId], references: [id])
  analysis  SupportAnalysis @relation(fields: [analysisId], references: [id])

  @@index([analysisId])
  @@index([workspaceId, status])
}
```

### State machines

Draft FSM extended:
- `APPROVED` → `SENDING` → `SENT` (happy path)
- `APPROVED` → `SENDING` → `SEND_FAILED` → `SENDING` (retry, max 3) → `SEND_FAILED` (terminal) → `ESCALATED`

New `CodexFixRun` FSM:
- `QUEUED` → `RUNNING` → `TESTS_GREEN` → `VERIFIED` → `PR_OPENED`
- Rejection branches: `TESTS_RED` (max iterations exhausted) → `HOLD_FOR_HUMAN`; `VERIFIER_REJECTED` → `HOLD_FOR_HUMAN`

All new enums as const objects in `packages/types/src/support/` and `packages/types/src/codex/` per CLAUDE.md rules.

## Temporal workflow changes

### New workflow: `sendDraftToSlackWorkflow`

File: `apps/queue/src/domains/support/send-draft-to-slack.workflow.ts`
Queue: `TASK_QUEUES.SUPPORT`

Activities:
- `sendDraftActivity(draftId)` → calls `slackDelivery.sendThreadReply`, returns message TS
- `markDraftSentActivity(draftId, slackTs)` → FSM transition `APPROVED → SENDING → SENT`, write `deliveredAt`, emit `DRAFT_SENT`

Retry policy: 3 attempts, exponential backoff 1s → 5s → 30s. Non-retryable errors: `ChannelNotFound`, `ChannelArchived`. On final failure: FSM transition to `SEND_FAILED`, emit `DRAFT_SEND_FAILED` event.

### Refactored workflow: `supportAnalysisWorkflow`

Replace the single `runAnalysisAgentActivity` with five activities:

```ts
const triage      = await triageActivity(snapshot)
if (triage.intent === "ESCALATE") return escalate(analysisId, triage.rationale)

const investigation = await investigateActivity(snapshot, triage)
const draft        = await draftReplyActivity(snapshot, investigation)
let evaluation     = await evaluateDraftActivity(snapshot, investigation, draft)

if (evaluation.verdict === "REVISE") {
  const draft2 = await draftReplyActivity(snapshot, investigation, { feedback: evaluation.reasons })
  evaluation = await evaluateDraftActivity(snapshot, investigation, draft2)
  if (evaluation.verdict !== "PASS") return escalate(analysisId, "evaluator rejected twice")
}

await persistAnalysisResult(analysisId, { investigation, draft, evaluation, triage })
await persistDraft(analysisId, draft)
```

### New workflow: `fixPrWorkflow` (replaces the stub)

File: `apps/queue/src/domains/codex/fix-pr.workflow.ts` (existing but stubbed)
Queue: `TASK_QUEUES.CODEX`

Activities:
- `prepareSandboxActivity(workspaceId, repositoryFullName, baseBranch)` → returns sandbox handle + branch name
- `fixerAgentActivity(sandboxHandle, analysisId, previousAttempt?)` → returns `{patchDiff, confidence}`
- `runTestsActivity(sandboxHandle)` → returns `{passed: boolean, output: string, exitCode: number}`
- `verifierAgentActivity(sandboxHandle, analysisId, patchDiff)` → returns `{verdict, reasons[]}`
- `createPrActivity(sandboxHandle, title, description)` → existing `codex.createDraftPullRequest` wrapped

Loop (max iterations from workspace config, default 3):
```
for attempt in 1..N:
  fix = fixerAgentActivity(handle, analysisId, previousAttempt)
  tests = runTestsActivity(handle)
  if tests.passed: break
  previousAttempt = { patchDiff: fix.patchDiff, testOutput: tests.output }

if not tests.passed:
  return holdForHuman("tests never passed")

verify = verifierAgentActivity(handle, analysisId, fix.patchDiff)
if verify.verdict != "OPEN_PR":
  return holdForHuman(verify.reasons)

pr = createPrActivity(handle, ...)
```

### Dispatch wiring

`approveDraft()` in `packages/rest/src/services/support/support-analysis-service.ts` gains a dispatcher parameter and:

1. Always dispatches `sendDraftToSlackWorkflow(draftId)`.
2. Conditionally dispatches `startCodexWorkflow({ type: "fix-pr", analysisId })` when:
   - `analysis.triageIntent === "INVESTIGATE"`
   - `analysis.evaluatorVerdict === "PASS"`
   - `investigation.affectedFiles.length > 0`
   - Workspace has a ready repository index (existing check in `pr-intent.ts`)

## Sandbox design (V1)

A single long-running `trustloop-fix-sandbox` docker-compose service. Responsibilities:

- Holds a shallow clone of each tracked repository (lazy-cloned on first use)
- Exposes HTTP API: `POST /runs` (creates branch, returns handle), `POST /runs/:id/patch`, `POST /runs/:id/test`, `GET /runs/:id/diff`, `DELETE /runs/:id`
- Enforces time + memory limits on test execution (default 5 min, 2GB)
- Egress: blocked except to package registries (npm, pypi) — `--dns-opt` and iptables rules in compose

Trade-offs vs per-run containers:
- V1 simpler (one container, one registry of runs, one clone cache)
- Weaker isolation (runs share filesystem — mitigated by per-run git worktrees)
- V2 moves to per-run containers once we have customer-run volume.

Trade-offs vs running tests in the queue worker:
- Rejected. The queue worker shouldn't arbitrarily execute customer code. Sandbox is explicit and auditable.

## Agent service changes

### File layout

```
apps/agents/src/
  roles/
    triage.ts             # runTriage(request) -> TriageResponse
    investigate.ts        # runInvestigation(...) -> InvestigationResponse
    draft.ts              # runDraft(...) -> DraftResponse
    evaluate.ts           # runEvaluation(...) -> EvaluatorResponse
    fix.ts                # runFixer(...) -> FixerResponse (sandbox-aware)
    verify.ts             # runVerifier(...) -> VerifierResponse
  prompts/
    triage.prompt.ts
    investigate.prompt.ts
    draft.prompt.ts
    evaluate.prompt.ts
    fix.prompt.ts
    verify.prompt.ts
  tools/
    search-code.ts        # existing, used by investigate
    read-file.ts          # new, used by investigate + fix + verify
    write-file.ts         # new, sandbox-only, used by fix
    run-tests.ts          # new, sandbox-only, used by fix
    get-git-blame.ts      # new, used by investigate
    (create-pr.ts deleted)
  lib/
    agent-factory.ts      # shared Mastra agent creation
    output-parser.ts      # shared compressed JSON handling
    provider-resolver.ts  # shared provider/model selection
  server.ts               # adds /agents/<role> routes
```

### Shared contracts (packages/types)

`packages/types/src/agent-roles/`:
- `triage.schema.ts` — TriageRequest, TriageResponse, TRIAGE_INTENT
- `investigate.schema.ts` — InvestigationRequest, InvestigationResponse
- `draft.schema.ts` — DraftRequest, DraftResponse
- `evaluate.schema.ts` — EvaluateRequest, EvaluateResponse, EVALUATOR_VERDICT
- `fix.schema.ts` — FixRequest, FixResponse
- `verify.schema.ts` — VerifyRequest, VerifyResponse, VERIFIER_VERDICT

Every Zod schema uses the positional JSON format per existing CLAUDE.md convention.

## Observability

Stable log keys per role (extend current `workspaceId`, `analysisId`):
- `role`: one of triage, investigate, draft, evaluate, fix, verify
- `tokens.prompt`, `tokens.completion`, `tokens.total`
- `latencyMs`
- `confidence`
- `verdict` (where applicable)
- `toolCallCount`
- `iterationCount` (fixer only)

Per-analysis rollup persisted on `SupportAnalysis`:
- `totalTokens`, `totalCostUsd`, `totalDurationMs`

SSE stream events (`/api/support/analysis/:id/stream`): one event per role start and completion so the UI renders "Triaging... → Investigating... → Drafting..." live.

## Rollout plan

Phases land on a new branch off `main` after this one merges. Each phase is behind a workspace-level feature flag (`agentHandoffV2Enabled`) so we can dark-launch per customer.

### Phase 0 — close the delivery gap (1-2 days)

**Scope:**
- `sendDraftToSlackWorkflow` + two new activities
- `approveDraft` dispatches it
- `SupportDraft.deliveredAt`, `deliveryError`, `sendAttempts`
- FSM transitions: `APPROVED → SENDING → SENT | SEND_FAILED`
- One integration test: approve draft → assert Slack `chat.postMessage` called with correct thread ts

**Exit criteria:** first customer's happy path closes. Message in → reply out, end to end.

### Phase 1 — split analysis agent (3-5 days)

**Scope:**
- Role-scoped agents (triage, investigate, draft, evaluate) with own prompts
- `supportAnalysisWorkflow` refactored to 5 activities
- Compatibility shim: old `/analyze` endpoint internally calls new roles during transition
- Confidence field on every response
- Evaluator single-retry loop

**Exit criteria:** existing tests pass. Eval suite shows evaluator catches ≥ 80% of injected hallucinations on a seed dataset.

### Phase 2 — codex handoff + sandbox (5-7 days)

**Scope:**
- `trustloop-fix-sandbox` docker-compose service
- `fixPrWorkflow` proper implementation (was stub)
- `approveDraft` conditionally dispatches codex workflow
- `CodexFixRun` table + FSM
- `createPullRequestTool` removed from investigator
- Verifier agent

**Exit criteria:** on a seed set of 10 known bugs, fixer produces a passing patch for ≥ 5 and verifier approves ≥ 4 of those. Zero inline PR creations from the investigator.

### Phase 3 — confidence gating + human escalation UX (2-3 days)

**Scope:**
- Workspace-level thresholds
- Escalation path: conversation marked `ESCALATED`, Slack message posted with "needs human attention"
- UI: analysis detail page shows triage/evaluator/verifier verdicts

**Exit criteria:** ESCALATE paths exercised in eval and manual tests. No customer-visible artifact gets produced when confidence is below threshold.

## Test plan (placeholder — eng review will expand)

Unit tests:
- Role output parsing (Zod schema coverage)
- FSM transitions (draft, CodexFixRun)
- Confidence gate logic

Integration:
- Webhook → analysis → draft → approve → Slack reply received
- Full PR flow: analysis → evaluator PASS → codex workflow → verifier PASS → draft PR visible on GitHub
- Escalation: low-confidence triage → ESCALATED + no draft, no PR

Eval (new directory `apps/agents/evals/`):
- Triage accuracy on 50-item golden set (balanced across REPLY_ONLY / INVESTIGATE / ESCALATE)
- Evaluator catches hallucinations on 30-item injected dataset
- Verifier false-negative rate on 20-item patch dataset

Load:
- One workspace, 10 concurrent analyses, measure p95 latency and token cost.

## Open questions

1. **Sandbox isolation**: docker-compose V1 good enough, or does safety require per-run firecracker VMs from day one?
2. **Confidence calibration**: trust the model's self-reported confidence, or derive from logprobs + evaluator agreement?
3. **Evaluator model**: same family as drafter (cheap, correlated errors) or different family (expensive, less correlated)?
4. **Fixer max iterations**: hard 3 or token-budget-bounded?
5. **Fast path**: keep a "high-confidence inline PR" path behind a flag, or fully commit to post-approval workflow?
6. **Cost ceiling**: should we budget-cap per analysis and abort mid-pipeline if exceeded?

## Risks

- **Cost blow-up.** ~5-6x token cost per analysis. Needs cost monitoring before we ship phase 2.
- **Latency.** 5-6 sequential agents + tests = minutes. UX must reflect progress; otherwise users will assume it's broken.
- **Prompt drift.** Six prompts to maintain. Must have per-role eval suite or they rot.
- **Sandbox escape / customer code egress.** Running customer code in any form is a security surface. Compose-level egress rules are table stakes.
- **Verifier false negatives.** Over-rejection kills the feature. Calibration needs continuous eval.
- **Feature-flag drift.** Workspaces stuck on V1 accumulate tech debt; need a hard cutover date.

## What already exists (leverage map)

- `slackDelivery.sendThreadReply` — already implemented, used by manual operator replies. Reuse as-is in Phase 0.
- `codex.createDraftPullRequest` — already implemented. Reuse in `createPrActivity` of `fixPrWorkflow`.
- `startCodexWorkflow` dispatcher — already wired in `temporal-dispatcher.ts:99-113`. Reuse.
- Existing analysis Zod schemas and positional JSON format — extend, don't replace.
- SSE stream `/api/support/analysis/:id/stream` — extend event types, don't rebuild transport.

## Not in scope

- Slack ingress, thread grouping, session correlation, rrweb rendering — all remain as-is.
- Codex indexing workflows — separate.
- Multi-tenant sandboxing across customers — V1 is single-sandbox shared, V2 revisits.
- Operator UI redesign — reuse existing analysis detail page with added verdict fields.
- LLM provider switching during rollout — keep OpenAI defaults.

---

# CEO REVIEW (Phase 1 of /autoplan — SELECTIVE EXPANSION mode)

## 0A. Premise Challenge

| # | Premise (stated or implied) | Stated? | Challenge | Severity |
|---|------|---------|-----------|----------|
| P1 | First paying customer will not pay without tier-3 handoff | Implied | Unvalidated. No customer has signed. The gap might be "reply never sends" alone. | **Critical** |
| P2 | Inline PR creation from investigator is unsafe enough to fully remove pre-PMF | Stated (arch decision §5) | No evidence of it having produced bad PRs. Single "inline PR fired from analysis" is an unfalsified fear. | **High** |
| P3 | 6 role-scoped prompts beat 1 monolithic prompt on accuracy and reliability | Stated (architecture §3) | Plausible but unmeasured. Could be worse — more hops = more places for compressed context to drop signal. | **High** |
| P4 | Confidence-gating is load-bearing for safety | Stated (arch §4) | Self-reported LLM confidence is famously uncalibrated. Gating on it may produce theatrical safety, not real safety. | **Medium** |
| P5 | Sandboxed fixer that runs tests before PR is needed for customer trust | Implied | Customers may care more about "PR opens in 60s" than "tests pass in the sandbox first". Speed can beat verification at pre-PMF. | **High** |
| P6 | Draft-send gap is the only V1 blocker | Implied (Phase 0 framing) | Solid premise. Reply not shipping = demo is a lie. | **Accepted** |
| P7 | CODEX queue needs to be populated now | Stated (Phase 2) | Could stay empty until we have PR volume that justifies it. | **Medium** |

## 0B. Existing Code Leverage Map

| Sub-problem | Existing code | Reuse? | Gap |
|------|----------|--------|-----|
| Send Slack reply | `slackDelivery.sendThreadReply` (`packages/rest/src/services/support/adapters/slack/slack-delivery-service.ts:90-128`) | ✅ direct reuse | No caller wired |
| Approve draft → transition state | `approveDraft` (`support-analysis-service.ts:122-157`), `tryDraftTransition` | ✅ extend | No post-approval dispatch |
| Dispatch codex workflow | `dispatcher.startCodexWorkflow` (`packages/rest/src/temporal-dispatcher.ts:99-113`) | ✅ direct reuse | Not called by support side |
| Open GitHub PR | `codex.createDraftPullRequest` (`packages/rest/src/codex/github/draft-pr.ts:43-132`) | ✅ direct reuse | — |
| Analyze thread + produce structured output | `runAnalysis` (`apps/agents/src/agent.ts:69-128`) | Split, don't rebuild | Monolithic today |
| Stream status to UI | `analysis-stream-service.ts` SSE | ✅ extend events | No per-role events |
| Session digest + rrweb frames | `buildThreadSnapshotActivity` + new frame activities on this branch | ✅ unchanged | — |

## 0C. Dream State Delta

- **CURRENT**: Message in → analysis produces draft → dead end.
- **THIS PLAN**: Message in → multi-role analysis → draft → approved → Slack + (optional) verified PR.
- **12-MONTH IDEAL**: Self-tuning agent team (evaluator feedback retrains prompts), per-customer tone and domain, opaque fix pipeline behind a policy gate, measurable per-role accuracy with continuous eval, autonomous merge for "trusted" patch classes.

Delta gap after this plan ships: no self-tuning, no per-customer eval data pipeline, no policy gate on autonomous merge. Those are explicitly later.

## 0C-bis. Implementation Alternatives

| # | Approach | Effort (CC) | Risk | Completeness | Pros | Cons |
|---|---------|------|------|-------|------|------|
| **A** | **Plan as-written (6 roles + sandbox + codex)** | **10-15d** | Med-High | 9/10 | Full tier-3, eval-ready, defensible story | Cost 5-6x per analysis, 2 weeks before ship |
| B | Phase 0 only (close Slack gap) + keep single agent | 1-2d | Low | 5/10 | Customer-visible fix fastest, cheapest | No verification, inline PR stays |
| C | Phase 0 + evaluator agent only (no fix-pr split, no sandbox) | 3-4d | Low-Med | 7/10 | Catches hallucinations cheaply, no sandbox risk | PR verification still inline |
| D | Phase 0 + remove `createPullRequestTool` (no PR creation at all in V1) | 2-3d | Low | 6/10 | Eliminates worst-case hallucinated PR, keeps reply flow | Loses "AI opens PRs" story for now |
| E | Phase 0 + hire a senior model (GPT-4.1 or Opus) + bigger prompt | 1-2d + $$ | Low | 6/10 | Buys capability without architectural change | Provider-locked, can't verify, cost unknown |

**Auto-pick per principle P1 (completeness) + P2 (boil lakes)**: **A** wins on completeness. But `C` wins on effort/risk ratio pre-PMF. This is a **TASTE DECISION** surfaced at the final gate.

## 0D. Mode-Specific Analysis: SELECTIVE EXPANSION

- **Hold scope on Phase 0** (draft send). Unambiguously in the blast radius, <1 day CC, fully leverages existing code. Auto-approve.
- **Hold scope on removing inline PR tool**. Small surgical change, eliminates the worst failure mode cheaply. Auto-approve if the inline path hasn't produced proven value.
- **Cherry-pick expansions**: evaluator agent (high value/effort ratio, catches hallucinations). Defer: fixer sandbox, verifier agent.
- **Defer to TODOS.md**: Phase 2 sandbox + fixer + verifier + CodexFixRun table. Revisit after first 5 real customer analyses ship.

## 0E. Temporal Interrogation

- **HOUR 1** after ship: customer Slacks a bug. Plan must ensure reply actually sends. Today it doesn't.
- **DAY 1**: customer sees a draft reply with claimed root cause. Accuracy matters more than the promise of a PR.
- **WEEK 1**: customer says "the AI hallucinated on message 3." Without evaluator, we have no defense.
- **MONTH 1**: customer asks "why didn't you just open the PR?" If answer is "we're building tier-3", they churn.
- **MONTH 6**: we have eval data and know whether 6-role beats 1-role. Today we're guessing.

Implication: **Phase 0 must ship this week. Phase 1 (partial — evaluator only) should ship next. Phase 2 (sandbox+fixer+verifier) should wait for real analysis volume.**

## 0F. Mode Selection

**SELECTIVE EXPANSION.** Accept Phase 0 as-is. Accept removing `createPullRequestTool` from investigator. Accept evaluator agent. Defer triage / fix / verify / sandbox to post-first-customer-signal.

Rationale: engineering framing of "elite handoff" is premature optimization pre-PMF. User memory already calls this out: *"Duc defaults to engineering framing; redirect to user/demand before deep technical answer."* The plan will get significantly better input from a real customer than from a speculative tier-3 buildout.

## Review Sections 1-10 (condensed — auto-decided)

### §1 Architecture
- **ASCII dependency graph** — see "Target state (tier 3)" in plan body. Sound at the component level. Concern: one `fixPrWorkflow` + sandbox introduces a new failure domain (sandbox up/down) that the current system lacks.
- **Coupling**: agent service goes from 1 HTTP surface to 6. Needs a thin shared client. Flagged — plan doesn't specify it.
- **Decision**: auto-approved for Phase 0 + evaluator only. Sandbox deferred.

### §2 Error & Rescue Registry

| Failure | Probability | Blast | Rescue | Status in plan |
|---------|-------------|-------|--------|----------------|
| Slack `chat.postMessage` fails (403, channel archived) | Med | Single conversation | Retry 3x, FSM → SEND_FAILED, escalate | ✅ covered |
| Draft approved but workflow dispatch fails | Low | Single conversation | Store pending, retry on next poll | ❌ missing |
| Sandbox container down | Med (V1) | All fix-PR workflows stuck | Health check + workflow fails fast with HOLD_FOR_HUMAN | Partially covered |
| Evaluator rejects twice | Med | Draft not persisted | Escalate, keep investigation for human | ✅ covered |
| Verifier over-rejects | High initially | PRs never open | Eval suite + manual override | ❌ missing |
| Fixer infinite loop within sandbox | Med | Wasted tokens | Iteration cap + token budget | Iteration cap only |
| Cost blow-up on a single analysis | Med | $$$ | Per-analysis budget cap, abort mid-pipeline | ❌ missing |

### §3 Security & Threat Model
- Sandbox runs customer code. `docker-compose` + iptables is V1. Multi-tenant risk (customer A's test leaks into customer B's sandbox) if sandbox is shared. Plan says "single-sandbox shared" — flagged as a real risk.
- **Decision**: defer sandbox entirely; ship without fixer/verifier until we have a customer actually demanding PR automation.

### §4 Data Flow & Edge Cases
- **Missing**: what happens when approval fires twice (race)? Plan doesn't specify idempotency on `sendDraftToSlackWorkflow` dispatch. Semantic workflow ID should be `draft-send-${draftId}` — implicit but not stated.
- **Missing**: what if session correlation was absent (no frames, no digest)? Triage must still work. Plan doesn't enumerate this path.

### §5 Code Quality
- 6 prompts, 6 schemas, 6 HTTP routes = maintenance surface. Plan has a reasonable file layout but no eval suite cadence.
- New convention: `apps/agents/src/roles/<role>.ts` — aligns with feature-qualified naming rules. ✅
- Positional JSON format extension for each schema — stated. ✅

### §6 Test Plan
- Present as placeholder. Autoplan Phase 3 (eng review) must expand.
- **Critical gap**: no eval suite for evaluator calibration. Evaluator false-negative rate is the linchpin of the "PR safety" story. If evaluator is weak, the whole tier-3 argument collapses.

### §7 Performance
- 5-6 sequential HTTP roundtrips + sandbox + tests = minutes per analysis. Plan acknowledges this.
- **Gap**: no latency target. Is 2 minutes OK? 5 minutes? Customer will have an opinion; we don't.

### §8 Observability
- Per-role logs + SSE per-role events — good.
- **Missing**: cost observability per analysis. Needs `tokens.prompt`, `tokens.completion`, `totalCostUsd` persisted on SupportAnalysis. Plan mentions; requires schema add.

### §9 Deployment & Rollout
- Feature flag `agentHandoffV2Enabled` per workspace. ✅
- **Missing**: cutover deadline. Without it V1 lingers forever. 90-day deprecation stated? No. Add.

### §10 Long-Term Trajectory
- This plan positions for self-tuning agent team in 12 months. Reasonable.
- **Risk**: six prompts without per-role eval suites will rot within 3 releases. Plan must make eval suites a Phase 1 requirement, not an afterthought.

## Error & Rescue Registry (rolled up)

See §2 table above. Gaps: approve-dispatch failure, verifier over-rejection, cost blow-up.

## Failure Modes Registry

| Mode | Likelihood | Impact | Mitigation | Gap |
|------|-----------|--------|-----------|-----|
| Hallucinated reply reaches customer | Med | Customer churns | Evaluator agent | ✅ covered (Phase 1 partial) |
| Hallucinated PR opens on customer repo | Low (eval catches) | Reputation damage | Verifier + sandbox tests | ⚠️ deferred in SELECTIVE EXPANSION |
| Approved draft never sent | **High today** | Demo is a lie | Phase 0 send workflow | ✅ covered |
| Cost overrun per analysis | Med | Burn rate | Budget cap | ❌ missing |
| Sandbox escape / customer code egress | Low (V1) | Security incident | iptables + egress allowlist | ⚠️ deferred |

## Completion Summary

| Phase | Scope (this CEO pass) | Decision | Principle |
|-------|-----------------------|----------|-----------|
| Phase 0 | Slack send + FSM transitions | **ACCEPT** | P1 (completeness), P6 (bias toward action) |
| Phase 1 | Role split (full) | **REDUCE** → evaluator only | P3 (pragmatic), P6 (bias toward action) |
| Phase 1b | Remove `createPullRequestTool` from investigator | **ACCEPT** | P5 (explicit over clever) |
| Phase 2 | Sandbox + fixer + verifier + codex workflow | **DEFER** to TODOS.md | P3, pre-PMF reality |
| Phase 3 | Confidence thresholds per workspace | **DEFER** (no data to tune with yet) | P3 |

**CEO verdict (my voice, pending consensus):** plan is architecturally sound but strategically premature past Phase 0 and evaluator. Ship the smaller cut, keep the full vision as the 6-month roadmap.

---

## Dual Voices

### CODEX SAYS (CEO — strategy challenge)

1. **Critical** — Not the right problem to solve now. Real failure is Slack dead-end + unsafe inline PR. Smaller reframing: ship reply delivery, keep one analysis agent, post-approval PR with tests. Defer role-splitting.
2. **Critical** — Plan treats key premises as facts (autonomous fixing needed, role separation improves outcomes, model self-confidence useful, small eval sets predict production). Rewrite around falsifiable hypotheses with kill criteria.
3. **High** — 6-month ship-it regret: built orchestration nobody uses. 6-month don't-ship regret: broken happy path + unsafe PR path. Eliminate the second now, avoid the first by refusing Phases 2/3 until customer usage proves need.
4. **High** — Removing inline PR pre-PMF is paranoid, not wise. Draft PRs behind approval + repo allowlist are reversible and teach us things. Keep a tightly gated fast path for design partners.
5. **High** — This doesn't create defensibility. Competitors copy "six-role pipeline" in a sprint. Defensibility = proprietary context, integrations, trust, resolution quality. Not agent architecture.
6. **Medium** — Phase 0 vs Phase 1-3 delta unjustified. Recut: Phase 0 (delivery + safe PR handoff), Phase 0.5 (evaluator on current agent). Require paying customer usage before any sandbox/fixer work.

**Codex verdict: REDUCE SCOPE**

### CLAUDE SUBAGENT (CEO — strategic independence)

1. **Critical** — Phase 0 is the entire product. Phases 1-3 are aspirational infra for a customer you don't have. First customers buy "it replied accurately," not "tier 3 architecture." Ship Phase 0 this week. Stop. Wait for customer to name the failure mode.
2. **High** — Premises mostly assumed. "First customer needs tier-3" (no evidence), "inline PR unsafe" (theoretical until a bad PR ships), "6 roles beats 1" (no eval data). Plan's own Phase 1 exit criterion ("evaluator catches ≥ 80% hallucinations") is listed as *future evidence* for the premise it's built on. Backwards. Build a 20-case eval against the current single agent first.
3. **High** — Alternatives dismissed. Bigger model (Opus / GPT-5) with structured output, 2-agent split, or inline-PR-behind-feature-flag are all cheaper and testable in 2 days. Try the smallest thing first.
4. **Medium** — Complexity ≠ defensibility. Session data, feedback loops, integrations are the moat. Not six LLM roles.
5. **Critical** — Scope calibration. Phase 0 is 1-2 days, obvious. Phases 1-3 are ~12 days of speculative work whose own risk section lists "5-6x cost, minutes of latency, 6 prompts to maintain, sandbox escape, verifier false negatives, flag drift." Shipping a plan whose listed risks dominate its stated benefits.

**Subagent verdict: REDUCE SCOPE**

### CEO DUAL VOICES — CONSENSUS TABLE

```
═══════════════════════════════════════════════════════════════════════════
  Dimension                              Claude   Codex    Consensus
  ────────────────────────────────────── ──────── ──────── ──────────────
  1. Premises valid?                     NO       NO       CONFIRMED (no)
  2. Right problem to solve NOW?         NO       NO       CONFIRMED (no)
  3. Scope calibration correct?          NO       NO       CONFIRMED (no)
  4. Alternatives sufficiently explored? NO       NO       CONFIRMED (no)
  5. Creates defensibility?              NO       NO       CONFIRMED (no)
  6. 6-month trajectory sound if shipped NO       NO       CONFIRMED (no)
═══════════════════════════════════════════════════════════════════════════
```

**Full consensus (6/6 confirmed against the plan as written).** This is a strong independent signal — no contamination between voices. Both independently produced the same verdict via different reasoning paths.

### ⚠️ USER CHALLENGE — elevated from Phase 1

Both models disagree with the stated direction of the plan. This is not auto-decided. Autoplan flags it for the user gate.

- **What the user said:** build tier-3 multi-agent handoff (6 roles, sandbox, verifier, codex workflow) because "tier-1 isn't enough for a first paying customer."
- **What both models recommend:** ship Phase 0 (delivery gap + safe PR handoff) only. Keep current single agent. Add evaluator on top before any role-splitting. Defer sandbox, fixer, verifier, confidence gating, and role-split until paying customer names a failure mode.
- **Why:** no customer has validated the premise. The plan's own Phase 1 exit criterion is listed as "future evidence" for the premise the whole plan is built on. The risks the plan acknowledges (cost 5-6x, latency in minutes, 6-prompt drift, sandbox escape, verifier over-rejection, flag drift) dominate the stated benefits. Architecture isn't a moat — context and integrations are.
- **What we might be missing:** Duc may have customer conversations or strategic context the models don't see. The "elite handoff" framing may be investor/narrative work, not product work. A specific customer may already have asked for PR automation.
- **If we're wrong, the cost is:** ~10-12 days of implementation that a customer later tells us was the right call. Recoverable — the plan is well-documented and reusable.

The user's original direction stands unless they explicitly change it.

### PREMISE GATE OUTCOME (2026-04-19)

**User decision: B) KEEP PLAN AS-WRITTEN.**

Rationale: Duc has customer context and strategic framing the review models do not see. The unanimous 6/6 model recommendation to REDUCE SCOPE is acknowledged and overridden by founder judgment. Phase 3 eng review proceeds against the full plan.

Audit-trail note: this is one of exactly two non-auto-decided gates in /autoplan. The user's override is binding. If the plan ships and any of the recommended-against risks materialize (cost blow-up, 6-prompt drift, verifier over-rejection, feature-flag drift), cross-reference this gate outcome.

---

# ENG REVIEW (Phase 3 of /autoplan)

## Scope Challenge (real code analysis)

Grounding against the current codebase:

| Evidence | File:line | Implication for plan |
|----------|-----------|----------------------|
| `supportAnalysisWorkflow` uses two activity profiles (fast 30s, agent 5min+heartbeat 45s) | `apps/queue/src/domains/support/support-analysis.workflow.ts:5-14` | Plan's 5 new role activities need an explicit timeout profile per role. Fixer (sandbox) must define `heartbeatTimeout` or Temporal kills it mid-test. |
| Draft FSM already has `send` event defined but no code fires it | `packages/types/src/support/state-machines/draft-state-machine.ts:74-91` | Plan can extend the existing FSM rather than rewrite. Add `SENDING` + `SEND_FAILED` states between `APPROVED` and `SENT`. |
| `approveDraft` is not guarded against concurrent approvals | `packages/rest/src/services/support/support-analysis-service.ts:122-157` | **Double-approval race is a real bug** unless we wrap the status flip + dispatch in a single Prisma transaction with a `where: { status: AWAITING_APPROVAL }` guard. |
| `startCodexWorkflow` uses workflow ID `fix-pr-${analysisId}` | `packages/rest/src/temporal-dispatcher.ts:99-113` | Already idempotent by analysis. Plan benefits from `WorkflowIdReusePolicy.REJECT_DUPLICATE`. |
| `runFixPrPipeline` is literally `return { status: "queued" }` | `apps/queue/src/domains/codex/fix-pr.activity.ts:7-13` | Plan must replace this stub entirely. No existing logic to preserve. |
| `createDraftPullRequest` already does branch create → file writes → draft PR | `packages/rest/src/codex/github/draft-pr.ts:43-132` | Plan's `createPrActivity` is a one-line wrapper. Reuse as-is. |

**What this means for the plan:** the "what already exists" section is accurate but undercounts existing leverage. Draft FSM "send" transition already exists; plan should clarify "extend existing states" vs "add new states." Double-approval race is a latent bug in today's code that the plan's dispatch path will amplify — fix must land in Phase 0.

## Target Architecture — ASCII Dependency Graph

```
                        ┌─────────────────────────────────────────────┐
                        │  apps/web                                   │
                        │  - tRPC: supportAnalysis.approveDraft       │
                        │  - SSE: /api/support/analysis/:id/stream    │
                        └───────────┬─────────────────────────────────┘
                                    │
                                    ▼
                ┌────────────────────────────────────────────┐
                │  packages/rest (service layer)             │
                │  - approveDraft()  ◄── FSM + dispatchers   │
                │  - slackDelivery.sendThreadReply           │
                │  - codex.createDraftPullRequest            │
                │  - dispatcher.startCodexWorkflow           │
                └───────────┬─────────────────────┬──────────┘
                            │                     │
             (SUPPORT q)    ▼                     ▼  (CODEX q)
       ┌────────────────────────────┐      ┌────────────────────────────┐
       │ apps/queue                 │      │ apps/queue                 │
       │ supportAnalysisWorkflow    │      │ fixPrWorkflow (NEW impl)   │
       │ ├─ buildThreadSnapshot     │      │ ├─ prepareSandbox          │
       │ ├─ renderFailureFrames     │      │ ├─ loop(N):                │
       │ ├─ captionFailureFrames    │      │ │   fixer → runTests       │
       │ ├─ markAnalyzing           │      │ ├─ verifier                │
       │ ├─ triage                  │◄─┐   │ └─ createPr                │
       │ ├─ investigate             │  │   └────────────┬───────────────┘
       │ ├─ draftReply              │  │                │
       │ ├─ evaluateDraft           │  │                ▼
       │ ├─ persistAnalysis+Draft   │  │       ┌─────────────────┐
       │                            │  │       │ fix-sandbox svc │
       │ sendDraftToSlackWorkflow   │  │       │ (docker-compose)│
       │ ├─ sendDraft               │  │       └─────────────────┘
       │ └─ markDraftSent           │  │                │
       └────────────┬───────────────┘  │                │
                    │ HTTP             │                │ HTTP
                    ▼                  │                ▼
             ┌────────────────────────────────────────────┐
             │ apps/agents                                │
             │   /agents/triage       /agents/fix         │
             │   /agents/investigate  /agents/verify      │
             │   /agents/draft                            │
             │   /agents/evaluate                         │
             │   shared: agent-factory, output-parser     │
             └────────────────────────────────────────────┘
```

New failure domains introduced: (1) sandbox service up/down, (2) agent-service 6-route surface, (3) codex queue populated for first time. Each needs a health check.

## Eng Review Sections

### §1 Architecture

**Sound at component level.** Concerns:
- Agent service goes from 1 route to 6. Needs a typed client (`packages/rest/src/clients/agents-client.ts`) with shared timeout/retry config. Plan doesn't specify — add.
- Activity timeout profiles: fixer call shells out to sandbox + runs tests = up to 10 min per iteration × 3 iterations. Temporal defaults will kill it. Plan needs explicit per-role timeout table. **Add to Phase 1 scope.**
- One Node event loop for 6 routes will head-of-line-block during long fixer runs. Run fixer on a separate agent-service pod or behind a bounded queue.

### §2 Error & Rescue — critical gaps flagged

| Gap | Severity | Fix |
|-----|----------|-----|
| Double-approval race | **Critical** | Wrap approve in Prisma `$transaction` + `updateMany({where:{status: AWAITING_APPROVAL}})`. Use `WorkflowIdReusePolicy.REJECT_DUPLICATE` on dispatch. |
| Approve → dispatch failure leaves draft orphaned | **Critical** | Outbox pattern: insert `DraftDispatch` row in same tx as status change; Temporal cron sweeps undispatched. |
| Late Slack 200 after FSM → SEND_FAILED | **High** | Pre-generate nonce stored on `SupportDraft.slackClientMsgId`; Slack de-dupes via `client_msg_id`. |
| Token/cost blow-up mid-pipeline | **High** | `Workspace.maxAnalysisCostUsd` (default $0.50). Workflow tracks cumulative cost, escalates on overrun with reason `COST_CEILING`. |
| Verifier over-rejection tanks feature | **High** | Per-workspace eval dashboard + manual "force open PR" operator action. |

### §3 Security — sandbox isolation

V1 "single-container shared" is a **critical footgun** if customer A has a malicious `postinstall` in their test script. Even pre-PMF, this must be fixed before any customer code runs.

- **Per-workspace sandbox profile** (docker-compose profile per `workspaceId`). Cheap, eliminates cross-tenant risk.
- **GitHub App installation tokens scoped per-run** with `repository_ids` + TTL ≤ 10min. Injected via env var, not file.
- Container hardening: `--cap-drop=ALL`, read-only root, tmpfs `/tmp`, non-root user.
- Egress allowlist at iptables: `registry.npmjs.org`, `pypi.org`, `api.github.com`. Block RFC1918, link-local, IMDS (`169.254.169.254`).
- Sandbox HTTP API rejects paths outside `$WORKTREE`, normalizes, blocks symlink traversal.

### §4 Data Flow & Edge Cases

- **Double-approval race** (covered §2).
- **Parallel fix-PR runs on same repo** collide on `node_modules`, test cache, npm cache. Serialize per-repo via Temporal mutex (SignalWithStart queue) until per-run isolation V2.
- **Session correlation absent** (no frames, no digest) path: triage must still emit valid output. Plan doesn't enumerate — add test case P1.x.

### §5 Code Quality

- 6 prompts + 6 schemas + 6 routes = 18-surface maintenance cost. Plan's file layout is fine but missing: an FSM helper (`packages/types/src/fsm.ts`) to avoid hand-rolling `tryXTransition` helpers per state machine. **Build the helper before writing the second FSM.**
- `/analyze` compatibility shim needs a deletion date in its file header + CI lint gate.
- Feature flag `agentHandoffV2Enabled` needs a dated cutover in the flag definition (90 days).

### §6 Tests — see artifact on disk

Test plan written to `~/.gstack/projects/trustloop/duc-feat-rrweb-into-agent-prompt-test-plan-20260419-184008.md`.

**Critical additions** beyond plan's placeholder:
- Contract tests at agent-service boundary (Zod schema round-trip on both sides)
- FSM property tests (fast-check) for `SupportDraft` and `CodexFixRun`
- Slack 5xx/429 fault injection (nock)
- Eval suites scheduled in CI with locked baselines (path-filter triggers on `apps/agents/src/prompts/**` and `/roles/**`)

### §7 Performance

- Triage + renderFailureFrames can run in parallel today. Plan has them sequential. Save 5-10s.
- p95 budget per role (gap in plan): triage 3s, investigate 15s, draft 8s, evaluate 5s, full analysis excluding fixer < 45s p95.
- `maxSteps` caps per role (investigate default 6, others 1-2). Uncapped retries on tool calls can produce 20+ LLM calls per run.

### §8 Observability

- Per-role logs already specced. Add `costUsd` and `model` fields.
- Cost rollup alerting: cron activity rolls p95 cost/day per workspace; page on 2x baseline.
- SSE events per role transition — add explicit event names in plan (`role:triage:started`, `role:triage:completed`).

### §9 Deployment

- Feature flag per workspace ✅.
- Sandbox rollout: off by default, one internal workspace for first week. CODEX queue remains idle for other workspaces.
- Cutover date for `/analyze` compat shim: 90 days post-phase-1-ship.

### §10 Long-Term Trajectory

- Eval suite-as-gate is the load-bearing story. Without CI running evals, 6-prompt drift eats the architecture.
- Per-customer tone/memory (not in plan) will be the next push. Plan positions for it but doesn't wire.

## Dual Voices

### CLAUDE SUBAGENT (eng — independent review)

**Architecture (HIGH)**
- **H1**: No shared HTTP client spec for agent-service. Six routes × retries × timeouts × auth will drift. Fix: `packages/rest/src/clients/agents-client.ts` with per-role typed methods, Zod-validated responses, keepalive agent, timeout budget.
- **H2**: Activity-timeout math undefined. Fixer shells out to sandbox (LLM + tests up to 5 min). Fix: explicit per-role timeouts: triage 30s, investigate/draft/evaluate 90s, fixer 10m, verify 60s. `heartbeatTimeout` on fixer + runTests.
- **M1**: One process, 6 routes, single event loop will head-of-line-block on long fixer runs. Fix: separate worker pool or bounded queue per role.

**Edge Cases (CRITICAL)**
- **C1**: Double-approval race in `approveDraft()`. Fix: `WorkflowIdReusePolicy.REJECT_DUPLICATE` on `draft-send-${draftId}` and `codex-fix-${analysisId}`. Prisma transaction wrapping flip+dispatch with `updateMany({where:{status: AWAITING_APPROVAL}})`.
- **C2**: Approve → dispatch failure leaves draft stuck. Fix: outbox pattern.
- **H3**: Slack late-success after SEND_FAILED duplicates reply. Fix: pre-generated `client_msg_id` nonce.
- **H4**: Sandbox state across parallel runs races on filesystem/node_modules/test cache. Fix: per-run worktree + tmp npm cache dir + Temporal mutex per-repo.

**Test Coverage (HIGH)**
- **H5**: No contract tests at agent-service boundary. Fix: `apps/agents/test/contract.test.ts` round-trips Zod fixtures.
- **H6**: No FSM property tests. Fix: fast-check random event sequences with invariants (no SENT without deliveredAt, no PR_OPENED without verifier PASS, terminal sticky).
- **H7**: No Slack 5xx / 429 fault injection. Fix: nock-based test.
- **H8**: Eval suites named but not scheduled. Fix: `npm run eval:agents` in CI on PR touching prompts/roles.

**Security (CRITICAL)**
- **C2 (same ID as edge)**: Multi-tenant sandbox footgun. Malicious postinstall reads other tenant's worktree + GitHub token. Fix: per-workspace sandbox, per-run GitHub App tokens with `repository_ids` + TTL ≤ 10min, `--cap-drop=ALL`, read-only root, non-root user, strict egress.
- **H9**: `writeFile(sandbox)` has no path validation. Fix: sandbox rejects paths outside `$WORKTREE`, normalizes, blocks symlink traversal.
- **H10**: Egress doesn't cover transitive fetchers. Fix: block RFC1918 + link-local + IMDS, allow only registries.

**Performance (MEDIUM)**
- **M2**: Triage + frames can parallelize. Fix: `Promise.all([triageActivity, renderFailureFrames])`.
- **M3**: No p95 target. Fix: budgets (triage 3s, investigate 15s, draft 8s, evaluate 5s, full < 45s p95).
- **M4**: Tool-call retries multiply cost. Fix: explicit `maxSteps` per role.

**Hidden Complexity (HIGH)**
- **H11**: `/analyze` shim lives forever. Fix: `@deprecated` + remove-by date + CI lint.
- **H12**: No cutover for V2 feature flag. Fix: dated TODO in flag definition.
- **H13**: Two new FSMs, no framework. Fix: `packages/types/src/fsm.ts` helper before writing the second FSM.

**Cost / Observability (HIGH)**
- **H14**: No per-analysis budget cap. Fix: `Workspace.maxAnalysisCostUsd` (default $0.50), cumulative tracker, escalate on overrun with `COST_CEILING`.
- **H15**: No alerting thresholds. Fix: cron rollup, alert on 2x baseline.

**Subagent verdict: NEEDS FIXES.** Phase 0 ships as-is. C1/C2/H3/H4 + sandbox isolation are non-negotiable before Phase 2.

### CODEX SAYS (eng — architecture challenge)

- **Critical**: V1 sandbox is a cross-tenant code-exec surface, not "weaker isolation." Malicious repo/test can read clone caches, poison state, or exfiltrate via allowed registries. Fix: per-run container/worktree, non-root UID, ephemeral FS, outbound allowlist enforced outside the container, no shared mutable cache across workspaces.
- **Critical**: Approval/send dispatch is race-prone. `approveDraft()` is read-then-update with no compare-and-swap. Fix: wrap approval + outbox write in one transaction, `updateMany({ where: { id, status: AWAITING_APPROVAL } })`, semantic workflow IDs (`send-draft-${draftId}`, `fix-pr-${analysisId}`), treat `WorkflowExecutionAlreadyStarted` as success.
- **High**: Draft FSM underspecified for Slack ambiguity. `SEND_FAILED` terminal conflicts with retries; no handling for "Slack succeeded but caller timed out, retry lands after FSM moved to failed." Fix: add `DELIVERY_UNKNOWN` reconciliation state, persist provider idempotency key + returned Slack ts, dedupe against existing message ts before retry.
- **High**: Temporal timeout model not credible for sandboxed test execution. 5-min start-to-close will blow up on real install/test loops, and activity retries duplicate mutating patch/test side effects. Fix: model sandbox ops as async jobs with heartbeat/poll, cancellation, per-run leases; only retry transport failures.
- **CRITICAL-NEW**: **Plan's codex dispatch contract does not match the existing shared schema.** `codexWorkflowInputSchema` at `packages/types/src/workflow.schema.ts:49-53` requires `{ analysisId, repositoryId, pullRequestNumber }`. The plan dispatches only `analysisId`. `pullRequestNumber` doesn't even exist pre-creation — the existing schema was designed for a "fix existing PR" flow, not "create new PR from analysis." Fix: **redesign the shared workflow contract first**, including repository resolution and idempotency key, before any workflow wiring.
- **High**: One `agents` process with six routes is the right deployment; six processes would be operational theater. Real problem is `/analyze` shim + per-workspace flag creating two orchestration graphs + prompt drift. Fix: time-box the shim, forbid new features on `/analyze`, hard cutover date, emit a metric for any legacy-path execution.
- **Medium**: Test/cost coverage too soft for the blast radius. Missing: agent-service contract tests, FSM property tests (×2), Slack 5xx/timeout injection, duplicate-approval concurrency, sandbox timeout/cancel, enforced eval cadence. No budget cap or alert threshold. Fix: per-analysis $ ceilings that abort downstream roles, weekly eval job + drift alerts, contract tests on every `/agents/*` boundary.

**Codex verdict: REJECT.** Strongest severity of the two voices — cites an existing shared schema incompatibility as a hard blocker.

---

## ENG DUAL VOICES — CONSENSUS TABLE

```
═══════════════════════════════════════════════════════════════════════════
  Dimension                              Claude     Codex      Consensus
  ────────────────────────────────────── ────────── ────────── ──────────────
  1. Architecture sound?                 PARTIAL    PARTIAL    CONFIRMED (partial)
  2. Test coverage sufficient?           NO         NO         CONFIRMED (no)
  3. Performance risks addressed?        NO         PARTIAL    DISAGREE
  4. Security threats covered?           NO         NO         CONFIRMED (no)
  5. Error paths handled?                NO         NO         CONFIRMED (no)
  6. Deployment risk manageable?         PARTIAL    PARTIAL    CONFIRMED (partial)
═══════════════════════════════════════════════════════════════════════════
CONSENSUS SUMMARY: 5/6 confirmed, 1 disagreement (perf specifics).
Codex surfaces one issue Claude missed: existing codexWorkflowInputSchema is
incompatible with the plan's dispatch signature. That is a hard blocker.
```

## Decision Audit Trail

| # | Phase | Decision | Classification | Principle | Rationale |
|---|-------|----------|----------------|-----------|-----------|
| 1 | 0 | Skip Phase 2 (Design review) | Mechanical | N/A | Only 4 UI-term matches, all false positives (File layout, format, in any form). No real UI scope. |
| 2 | 1 | Auto-select SELECTIVE EXPANSION mode | Mechanical | Per /autoplan override | Plan is SELECTIVE by nature (Phase 0 hold-scope, later phases expandable). |
| 3 | 1 | Accept Phase 0 (Slack send gap) | Mechanical | P1 + P6 | Unambiguously in blast radius, <1 day CC, reuses existing `slackDelivery.sendThreadReply`. |
| 4 | 1 | Premise gate: USER CHALLENGE surfaced | Taste → User | N/A | Both voices unanimously recommended REDUCE SCOPE. Non-auto-decided. |
| 5 | 1 | PREMISE GATE OUTCOME: keep plan as-written | User decision | N/A | Duc overrode unanimous 6/6 model recommendation. Binding. |
| 6 | 3 | Architecture ASCII: new failure domains flagged (sandbox, agents 6-route surface, CODEX queue) | Auto-decided | P5 (explicit) | Add health checks as Phase-0-parallel work. |
| 7 | 3 | Double-approval race: add compare-and-swap + WorkflowIdReusePolicy | Auto-decided | P5, P2 | Both voices Critical. Must land in Phase 0. |
| 8 | 3 | Outbox pattern for approve→dispatch | Auto-decided | P2 (boil lake), P5 | Both voices Critical. Must land in Phase 0. |
| 9 | 3 | `DELIVERY_UNKNOWN` reconciliation state + client_msg_id nonce | Auto-decided | P5 (explicit), P6 | Codex identified late-success-after-failed path Claude missed. Accept in Phase 0. |
| 10 | 3 | Sandbox V1: per-workspace minimum (not shared) | Auto-decided | P1 (completeness), P5 | Both voices Critical. Raises Phase 2 scope. |
| 11 | 3 | Sandbox V1: per-run containers (codex stronger recommendation) | **Taste** | — | Codex wants per-run; Claude subagent OK with per-workspace. Surface at final gate. |
| 12 | 3 | Existing `codexWorkflowInputSchema` incompatibility | **Critical — plan revision required** | P5 | Schema requires `pullRequestNumber` which doesn't exist pre-creation. Plan must redesign dispatch contract. |
| 13 | 3 | Budget cap: `Workspace.maxAnalysisCostUsd` default $0.50 | Auto-decided | P1, P5 | Codex + Claude both called this out. Default open to user override. |
| 14 | 3 | Compat shim `/analyze`: 90-day cutover deadline | Auto-decided | P3 (pragmatic) | Both voices demand dated deadline. |
| 15 | 3 | Triage + renderFailureFrames in parallel | Auto-decided | P5 | Claude M2 finding. Free perf win. |
| 16 | 3 | FSM helper (`packages/types/src/fsm.ts`) before 2nd FSM | Auto-decided | P4 (DRY), P5 | Claude H13 finding. Prevents hand-rolled drift. |
| 17 | 3 | Per-role `maxSteps` caps explicit in plan | Auto-decided | P5 | Claude M4 finding. Caps cost blast radius. |
| 18 | 3 | Retain inline `createPullRequestTool` as "design-partner" flag | **Taste / User Challenge echo** | — | Codex-CEO + Codex-Eng both recommend preserving behind flag. CEO voice unanimously agreed. Claude-subagent didn't push as hard. Surface at final gate. |

## Revisions from /autoplan (Phase 3 auto-accepted + user-confirmed)

The following revisions amend the plan body above. In case of conflict between plan body and this section, **this section wins**.

### R1. Codex dispatch contract — REDESIGN REQUIRED (blocker)

Existing `codexWorkflowInputSchema` (`packages/types/src/workflow.schema.ts:49-53`) requires `{analysisId, repositoryId, pullRequestNumber}`. `pullRequestNumber` does not exist at dispatch time — we are creating a PR, not fixing one. Before any Phase 2 wiring:

- Rename existing schema to `fixExistingPrWorkflowInputSchema` (if still needed) and add a NEW `createFixPrWorkflowInputSchema`:
  ```ts
  export const createFixPrWorkflowInputSchema = z.object({
    analysisId: z.string().min(1),
    workspaceId: z.string().min(1),
    repositoryId: z.string().min(1),          // resolved during approveDraft
    rootCauseSummary: z.string().min(1),      // from investigator output
    affectedFiles: z.array(z.string()).min(1),
    idempotencyKey: z.string().min(1),        // `fix-pr-${analysisId}` by default
  });
  ```
- Add a `repositoryId` resolution step in `approveDraft`: pick the target repo from `investigation.affectedFiles` against workspace's indexed repositories. If ambiguous, escalate (don't dispatch).
- Update `dispatcher.startCodexWorkflow` to accept the new shape.
- Update `fixPrWorkflow` signature.

### R2. Phase 0 scope expansion — critical eng fixes land WITH Phase 0

Moves the following from "implicit" to "in Phase 0 scope":

- **R2a. Double-approval race fix**: wrap `approveDraft` status flip + workflow dispatch in a single Prisma `$transaction`. Use `updateMany({ where: { id, status: AWAITING_APPROVAL }, data: { status: APPROVED_PENDING_DISPATCH } })`. Treat 0 rows updated as "already approved" and return idempotently. Use semantic workflow IDs (`send-draft-${draftId}`, `fix-pr-${analysisId}`) with `WorkflowIdReusePolicy.REJECT_DUPLICATE`. Treat `WorkflowExecutionAlreadyStarted` as success.
- **R2b. Approve-dispatch outbox**: inside the same transaction, insert a `DraftDispatch` row. A Temporal scheduled workflow (`draftDispatchSweepWorkflow`, hourly) picks up rows older than N minutes still in `PENDING` and retries dispatch. Prevents orphaned APPROVED drafts.
- **R2c. DELIVERY_UNKNOWN reconciliation + `slackClientMsgId`**: generate a nonce per draft, store on `SupportDraft.slackClientMsgId`, pass to `chat.postMessage` as `client_msg_id`. Extend FSM with `DELIVERY_UNKNOWN` state entered on network error or timeout; reconciler calls `conversations.history` filtered by `client_msg_id` to detect late success; transitions to SENT if found, retries if not.

### R3. Sandbox hardening — Phase 2 updates

- **Taste resolved: per-workspace sandbox V1** (user-confirmed at final gate). One docker-compose profile per `workspaceId`. Cross-tenant footgun eliminated. V2 moves to per-run.
- **Security baseline**: non-root UID, `--cap-drop=ALL`, read-only root, tmpfs `/tmp`, ephemeral per-run worktree + per-run tmp npm cache.
- **Egress**: iptables allowlist — `registry.npmjs.org`, `pypi.org`, `api.github.com`. Block RFC1918, link-local, IMDS (`169.254.169.254`).
- **GitHub App token**: mint per-run with `repository_ids` scope + TTL ≤ 10min, inject via env (not file).
- **Sandbox HTTP API path validation**: reject paths outside `$WORKTREE`, normalize, block symlink traversal.
- **Parallel fix-PR runs on same repo**: serialize per-repo via Temporal mutex (SignalWithStart queue) in V1.

### R4. Agent service client — explicit

Add `packages/rest/src/clients/agents-client.ts` as a typed Zod-validated wrapper over the 6 `/agents/*` routes. Per-role timeout config: triage 30s, investigate/draft/evaluate 90s, fixer 10m, verify 60s. Heartbeat on fixer + runTests. Keepalive agent.

### R5. Cost ceiling

- `Workspace.maxAnalysisCostUsd` (default `0.50`, nullable for unlimited).
- Workflow tracks cumulative token cost across roles.
- On overrun: transition analysis to ESCALATED with reason `COST_CEILING`, halt downstream roles.

### R6. FSM helper

Before writing `CodexFixRun` state machine: land `packages/types/src/fsm.ts` — a small `defineFsm({states, transitions})` helper. Refactor `draft-state-machine.ts` to use it as the canary migration. Then build `codex-fix-run-state-machine.ts` on top.

### R7. Test + eval CI

- New CI actions:
  - `agents-contract-test` (matrix across 6 roles, Zod schema round-trip)
  - `agents-eval-smoke` (5-case smoke per role on PRs touching prompts/roles)
  - `agents-eval-full` (nightly all 5 eval suites, metrics persisted)
  - `sandbox-integration` (docker-compose + one end-to-end fix-PR flow)
- FSM property tests for `SupportDraft` and `CodexFixRun` using fast-check.
- Slack 5xx/429 fault injection with nock (Phase 0).
- Duplicate-approval concurrency test (Phase 0).

### R8. Compat shim deadline

File header on `apps/agents/src/server.ts` `/analyze` route: `@deprecated — remove by 2026-07-19 (90 days)`. CI lint fails after date.

### R9. Perf + parallelism

- Run `triageActivity` and `renderFailureFrames` concurrently with `Promise.all`.
- Per-role `maxSteps` caps: triage 1, investigate 6, draft 1, evaluate 1, fixer (per iteration) 8, verify 2.
- p95 budgets: triage 3s, investigate 15s, draft 8s, evaluate 5s. Full analysis excluding fixer < 45s p95.

### R10. Inline PR tool — REMOVED (taste resolved)

User-confirmed at final gate. Plan §5 stands. `createPullRequestTool` comes off the investigator agent entirely. No "design-partner fast path" flag. Rationale: every agreed eng fix (outbox, per-workspace sandbox, verifier) presupposes the codex workflow path. Fast path reintroduces the unsafe path those fixes are closing.

---

## Cross-Phase Themes (CEO ∩ Eng)

Concerns raised independently by voices across BOTH phases (high-confidence signal):

1. **Scope calibration (CEO all 4 voices + Eng cost-cap findings)**: plan's own risks dominate its own benefits. CEO voices unanimously said REDUCE SCOPE; Eng voices added cost-ceiling and eval-cadence concerns that amplify the cost narrative. *Premise gate overrode — still tracked.*
2. **Premise validation gap (CEO) → test coverage gap (Eng)**: CEO flagged that evaluator's pass bar is "future evidence" for a present premise. Eng flagged no eval suites scheduled, no contract tests, no property tests. Same underlying issue: no mechanism to falsify the plan's claims before shipping.
3. **Sandbox risk (CEO → Eng)**: CEO flagged "sandbox escape" as a listed risk the plan ships anyway. Eng elevated to **Critical**: V1 "shared container" is a cross-tenant code-exec surface, not weak isolation. Both voices demand per-workspace / per-run containers.
4. **Inline PR tool removal (CEO) + codex dispatch contract mismatch (Eng-codex)**: CEO said removing inline tool is premature. Eng-codex noted the post-approval codex workflow contract doesn't even match the existing schema. Together: the "move PR creation to codex workflow" design isn't ready to cut the inline tool.

## Failure Modes Registry (Eng roll-up)

| Mode | Likelihood | Impact | Mitigation in plan | Gap |
|------|-----------|--------|--------------------|-----|
| Double-approve race | **High** (UI double-click) | Duplicate Slack reply + duplicate PR | NONE | **Critical — add to Phase 0** |
| Orphaned APPROVED draft after dispatch fail | **Med** | Draft stuck forever | NONE | **Critical — outbox pattern** |
| Late Slack 200 after SEND_FAILED | Low-Med | Duplicate reply | NONE | **High — add client_msg_id** |
| Sandbox cross-tenant read | Low | Security incident | "single sandbox shared" | **Critical — per-workspace sandbox** |
| LLM writeFile to `/etc/hosts` or `..` | Med | Sandbox compromise | NONE | **High — path validation in sandbox API** |
| Cost blow-up mid-analysis | Med | $$$ | None explicit | **High — budget cap** |
| Parallel fix-PR runs race | Med | Broken fixes | NONE | **High — per-repo mutex** |
| Eval suite never runs in CI | High | Prompt drift | Mentioned, not wired | **High — CI job required** |
| Feature flag drift | Med | Split-brain code | Mentioned | **Medium — dated cutover** |

## Completion Summary (Eng)

- ✅ Scope challenge with real code reads
- ✅ Architecture ASCII graph
- ✅ Test diagram + test plan artifact on disk
- ✅ §1-10 reviewed, findings logged
- ✅ Failure Modes Registry with critical flags
- ✅ Claude eng subagent inlined
- ⏳ Codex eng voice pending

---



---

