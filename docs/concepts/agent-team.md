---
summary: "Agent Work Ledger harness: AgentTeamRun executes bounded jobs, records artifacts/receipts, and projects FAST support drafts."
read_when:
  - Touching agent-team run execution or projection
  - Changing harness jobs, artifacts, receipts, or runtime cutover behavior
  - Debugging why a support analysis run did or did not produce a draft
  - Updating agent-team settings or the run UI
title: "Agent Team Harness"
---

# Agent Team Harness

Agent Team execution now runs through the **Agent Work Ledger harness**. The
queue workflow does not run the old addressed-dialogue scheduler or per-role
inbox loop. A run is a ledger of bounded jobs, typed artifacts, and receipts.

`AgentTeamRun` is still the execution root. `SupportAnalysis` is a compact
projection so the support right rail can show the latest problem statement,
confidence, and draft without rendering the whole ledger.

## Trigger

Two paths start the same harness runtime:

- AUTO: `apps/queue/src/domains/support/support-analysis-trigger.activity.ts`
  calls `agentTeamRuns.start({ workspaceId, conversationId, teamConfig: FAST })`.
- MANUAL: `apps/web/src/hooks/use-analysis.ts` and
  `apps/web/src/hooks/use-agent-team-run.ts` call `agentTeam.startRun` with
  `teamConfig: FAST`.

`packages/rest/src/services/agent-team/run-service.ts` creates the
`AgentTeamRun`, sets `runtimeVersion = "harness_v2"`, stores the run
`teamSnapshot`, and dispatches `agentTeamRunWorkflow` on `TASK_QUEUES.CODEX`.

## Execution

The Temporal workflow is intentionally thin:

- `apps/queue/src/domains/agent-team/agent-team-run.workflow.ts`
- Activity: `executeHarnessRun` in
  `apps/queue/src/domains/agent-team/agent-team-harness.activity.ts`

FAST currently executes three jobs:

| Job | Class | Output |
|---|---|---|
| `triage` | `agent-control` | `triage_summary` artifact |
| `draft_reply` | `agent-model` | `draft_response` artifact + model receipt |
| `synthesize` | `agent-projection` | `final_summary` artifact + projection |

The `draft_reply` job calls the agents service `/team-turn` endpoint with the
drafter role as the model adapter. The queue no longer persists
`AgentTeamRoleInbox` state or uses `nextSuggestedRoleKeys` to schedule turns.

## Ledger Tables

| Table | Role |
|---|---|
| `AgentTeamRun` | Execution root, runtime version, terminal ledger outcome |
| `AgentTeamJob` | Bounded unit of work with status, budget, tool/model policy |
| `AgentTeamArtifact` | Typed job output validated by shared Zod schemas |
| `AgentTeamJobReceipt` | Provider/model/context/tool receipt for each job attempt |
| `SupportAnalysis` | Compatibility projection for the support right rail |
| `SupportDraft` | Draft projection when FAST produces a customer reply |

Shared contracts live under `packages/types/src/agent-team/`. Runtime services
for ledger writes live in `packages/rest/src/services/agent-team/harness/`.

## Projection

`executeHarnessRun` projects FAST results to `SupportAnalysis` after the draft
artifact exists. Projection is idempotent per `agentTeamRunId`:

- `SupportAnalysis.status = ANALYZED`
- `SupportAnalysis.agentTeamRunId = AgentTeamRun.id`
- `SupportDraft.status = AWAITING_APPROVAL`
- `AgentTeamRun.ledgerOutcome = reply_ready`

Failed harness runs set `AgentTeamRun.status = failed` and
`ledgerOutcome = failed`. The AI Analysis panel reads the projection through
`packages/rest/src/services/support/support-analysis-service.ts`.

## Deleted Runtime

The old queue-side dialogue runtime has been removed:

- `apps/queue/src/domains/agent-team/agent-team-run.activity.ts`
- `apps/queue/src/domains/agent-team/agent-team-run-routing.ts`
- old queue tests that targeted role-inbox scheduling

The agents service can still parse `AgentTeamRoleTurnInput` because the harness
uses `/team-turn` as the model adapter for the FAST drafter job. That adapter is
not the queue scheduler.

## Invariants

- New run execution must go through `runtimeVersion = "harness_v2"`.
- Jobs must move through the `AgentTeamJob` FSM in `packages/types`.
- Artifacts and receipts must be validated through shared Zod schemas before
  persistence.
- The workflow stays orchestration-only; I/O lives in activities and services.
- Do not reintroduce the old role-inbox turn scheduler as a fallback.
- Mutable code/PR work must become explicit sandbox jobs before DEEP/PR paths
  are enabled.

## Related Concepts

- `ai-analysis-pipeline.md` — how harness runs project compact summaries back
  into the AI Analysis panel
- `architecture.md` — three-service topology and Temporal queues
- `llm-routing-and-provider-fallback.md` — provider/model selection and fallback
- `ai-draft-generation.md` — draft approval and Slack delivery after projection

## Keep This Doc Honest

Update when you change:

- Which `teamConfig` auto or manual analysis starts
- The job sequence, job FSM, artifact types, or receipt schema
- Whether `/team-turn` remains the FAST model adapter
- The `SupportAnalysis` / `SupportDraft` projection behavior
- Any runtime fallback to `dialogue_v1`
- Sandbox behavior for patch/test/PR jobs
