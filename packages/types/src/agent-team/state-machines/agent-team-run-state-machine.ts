import { defineFsm } from "@shared/types/fsm";
import { AGENT_TEAM_RUN_STATUS } from "../agent-team-core.schema";

// ── Types ────────────────────────────────────────────────────────────

type AgentTeamRunStatusValue = (typeof AGENT_TEAM_RUN_STATUS)[keyof typeof AGENT_TEAM_RUN_STATUS];

export interface AgentTeamRunContext {
  runId: string;
  status: AgentTeamRunStatusValue;
  errorMessage: string | null;
}

// Events that drive an AgentTeamRun's status.
//
// `start`              — workflow began claiming inboxes (initializeRunState).
// `complete`           — terminal state: no queued inboxes, no open questions,
//                        no blocked inboxes remain.
// `waitForResolution`  — pause: open questions or blocked inboxes remain;
//                        operator must resume.
// `fail`               — any non-terminal can fail (dispatch error,
//                        activity error past the retry budget).
// `resume`             — operator-triggered resume from a `waiting` run.
export type AgentTeamRunFsmEvent =
  | { type: "start" }
  | { type: "complete" }
  | { type: "waitForResolution" }
  | { type: "fail"; error: string }
  | { type: "resume" };

type AgentTeamRunFsmEventType = AgentTeamRunFsmEvent["type"];

// Preserved for back-compat with the existing service-layer error pattern:
// callers use `err instanceof InvalidAgentTeamRunTransitionError` to translate
// invalid transitions into ConflictError at the tRPC boundary.
export class InvalidAgentTeamRunTransitionError extends Error {
  constructor(from: AgentTeamRunStatusValue, event: AgentTeamRunFsmEventType) {
    super(`Invalid transition: cannot handle "${event}" in state "${from}"`);
    this.name = "InvalidAgentTeamRunTransitionError";
  }
}

// ── FSM Definition ───────────────────────────────────────────────────

const agentTeamRunFsm = defineFsm<
  AgentTeamRunStatusValue,
  AgentTeamRunFsmEvent,
  AgentTeamRunContext
>({
  name: "AgentTeamRun",
  initial: AGENT_TEAM_RUN_STATUS.queued,
  errorFactory: (_fsm, from, event) =>
    new InvalidAgentTeamRunTransitionError(
      from as AgentTeamRunStatusValue,
      event as AgentTeamRunFsmEventType
    ),
  states: {
    [AGENT_TEAM_RUN_STATUS.queued]: {
      on: {
        start: (ctx) => ({ ...ctx, status: AGENT_TEAM_RUN_STATUS.running, errorMessage: null }),
        fail: (ctx, event) => ({
          ...ctx,
          status: AGENT_TEAM_RUN_STATUS.failed,
          errorMessage: event.error,
        }),
      },
    },

    [AGENT_TEAM_RUN_STATUS.running]: {
      on: {
        complete: (ctx) => ({
          ...ctx,
          status: AGENT_TEAM_RUN_STATUS.completed,
          errorMessage: null,
        }),
        waitForResolution: (ctx) => ({
          ...ctx,
          status: AGENT_TEAM_RUN_STATUS.waiting,
        }),
        fail: (ctx, event) => ({
          ...ctx,
          status: AGENT_TEAM_RUN_STATUS.failed,
          errorMessage: event.error,
        }),
      },
    },

    // Operator-resumable pause. `resume` is the explicit resume primitive that
    // matches recordOperatorAnswer + startAgentTeamRunResumeWorkflow upstream.
    // `fail` covers the case where the run cannot be resumed (operator chose
    // to abandon, or upstream resource is gone).
    [AGENT_TEAM_RUN_STATUS.waiting]: {
      on: {
        resume: (ctx) => ({ ...ctx, status: AGENT_TEAM_RUN_STATUS.running, errorMessage: null }),
        fail: (ctx, event) => ({
          ...ctx,
          status: AGENT_TEAM_RUN_STATUS.failed,
          errorMessage: event.error,
        }),
      },
    },

    [AGENT_TEAM_RUN_STATUS.completed]: { on: {} },
    [AGENT_TEAM_RUN_STATUS.failed]: { on: {} },
  },
});

// ── Public API ───────────────────────────────────────────────────────

export function createAgentTeamRunContext(runId: string): AgentTeamRunContext {
  return {
    runId,
    status: AGENT_TEAM_RUN_STATUS.queued,
    errorMessage: null,
  };
}

export function restoreAgentTeamRunContext(
  runId: string,
  status: AgentTeamRunStatusValue,
  errorMessage: string | null
): AgentTeamRunContext {
  return { runId, status, errorMessage };
}

export function transitionAgentTeamRun(
  context: AgentTeamRunContext,
  event: AgentTeamRunFsmEvent
): AgentTeamRunContext {
  return agentTeamRunFsm.transition(context, event);
}

export function getAllowedAgentTeamRunEvents(
  context: AgentTeamRunContext
): readonly AgentTeamRunFsmEventType[] {
  return agentTeamRunFsm.allowedEvents(context);
}
