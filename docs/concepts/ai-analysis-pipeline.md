---
summary: "AI Analysis is the compact SupportAnalysis projection of an Agent Team run, not a separate execution pipeline."
read_when:
  - Working on analysis triggers (debounce or manual)
  - Changing how Agent Team runs surface in the support right rail
  - Debugging missing/stale AI Analysis summaries
  - Touching SupportAnalysis projection writes
title: "AI Analysis Projection Pipeline"
---

# AI Analysis Projection Pipeline

AI Analysis is now a **read-side summary projection** of an Agent Team run.
The model work happens in `AgentTeamRun`; `SupportAnalysis` exists so the
support right rail can show a compact status, confidence, problem statement,
reasoning trace, and draft/PR affordances without rendering the whole team
transcript.

The dedicated Agent Team tab remains the place to inspect run progress. The
current runtime is the `harness_v2` ledger path, not the old role-inbox
dialogue scheduler.

## Trigger

Two paths start the same Agent Team engine:

### AUTO: per-conversation debounce

- `apps/queue/src/domains/support/support-analysis-trigger.workflow.ts`
- Long-lived Temporal workflow per conversation: `analysis-debounce-${conversationId}`
- Each new message signal resets the debounce timer.
- When the customer stops typing, `dispatchAnalysis()` calls
  `agentTeamRuns.start({ workspaceId, conversationId, teamConfig: FAST })`.

### MANUAL: UI trigger

- `apps/web/src/hooks/use-analysis.ts`
- The AI Analysis button calls `agentTeam.startRun({ conversationId, teamConfig: FAST })`.
- `apps/web/src/hooks/use-agent-team-run.ts` uses the same `FAST` team config for
  the Agent Team tab.

`agentTeam.startRun` still accepts all shared team config values, but the live
auto/manual support paths explicitly request `FAST` while deeper harness job
paths are built out.

## Execution

The trigger creates an `AgentTeamRun` and dispatches
`agentTeamRunWorkflow`. See `docs/concepts/agent-team.md` for the current
ledger harness.

Important execution facts for AI Analysis:

- The run stores a `teamSnapshot`, so editing the live team does not change an
  already-started run.
- The current live path is `FAST`: `triage -> draft_reply -> synthesize`.
- `draft_reply` calls the agents service `/team-turn` endpoint with the drafter
  role as the model adapter.

## Projection

Projection happens inside
`apps/queue/src/domains/agent-team/agent-team-harness.activity.ts`.

| Run state | SupportAnalysis status | Projection behavior |
|---|---|---|
| `completed` | `ANALYZED` | Summarizes facts and key messages, computes confidence, records tool-call count. |
| `waiting` | `NEEDS_CONTEXT` | Reserved for future harness jobs that need operator input. |
| `failed` | `FAILED` | Records the failure as the analysis summary with confidence `0`. |

The projection is idempotent per `agentTeamRunId`. A `waiting` projection can
later be updated to `ANALYZED` when the same run resumes and completes.

`SupportDraft` creation is currently the FAST projection path: when
`draft_reply` emits a `draft_response` artifact, projection creates or updates
an awaiting-approval draft.

## UI Read Path

- `packages/rest/src/support-analysis-router.ts` exposes
  `supportAnalysis.getLatestAnalysis`.
- `packages/rest/src/services/support/support-analysis-service.ts` reads the
  latest `SupportAnalysis` projection and its newest draft, if any.
- `apps/web/src/components/support/analysis-panel.tsx` renders the compact
  summary.
- `apps/web/src/components/support/agent-team-run-view.tsx` renders the current
  run surface while the ledger UI is filled in.

While a team run is queued/running and no new projection exists yet, the AI
Analysis panel shows its analyzing state. Terminal, waiting, and failed states
write a projection so the panel can settle.

## Invariants

- **Agent Team is the execution source of truth.** Do not reintroduce a separate
  `support-analysis.workflow` dispatch path for normal analysis.
- **SupportAnalysis is a projection.** It should be written from Agent Team run
  state, not treated as the primary execution table.
- **Manual and auto analysis use `FAST`.** `DEEP`/PR paths require explicit
  harness jobs before they are re-enabled in live support analysis.
- **Failed runs must mark the ledger outcome.** Otherwise the right rail can
  spin forever or show stale analysis.
- **Draft status transitions still use the draft FSM.** If compatibility
  projection creates a `SupportDraft`, move it through `transitionDraft`.

## Related concepts

- `agent-team.md` — run workflow, role routing, event log, SSE stream
- `ai-draft-generation.md` — what happens after a projected draft is approved
- `session-replay-capture.md` — session context attached to support analysis
- `codex-search.md` — what the `searchCode` tool does
- `llm-routing-and-provider-fallback.md` — provider/model selection and fallback

## Keep this doc honest

Update when you change:

- Whether manual or auto analysis starts `FAST`, `STANDARD`, or `DEEP`
- The Agent Team terminal/waiting/failed projection logic
- The shape or meaning of `SupportAnalysis.agentTeamRunId`
- Whether `DEEP` runs create `SupportDraft` rows
- The UI read path for AI Analysis summaries
