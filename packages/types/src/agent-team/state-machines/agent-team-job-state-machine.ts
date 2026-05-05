import { AGENT_TEAM_JOB_STATUS } from "@shared/types/agent-team/agent-team-job.schema";
import { defineFsm } from "@shared/types/fsm";

type AgentTeamJobStatusValue = (typeof AGENT_TEAM_JOB_STATUS)[keyof typeof AGENT_TEAM_JOB_STATUS];

export interface AgentTeamJobContext {
  jobId: string;
  status: AgentTeamJobStatusValue;
  attempt: number;
  leaseUntil: string | null;
  errorMessage: string | null;
  blockedReason: string | null;
}

export type AgentTeamJobEvent =
  | { type: "enqueue" }
  | { type: "claim"; workerId: string; leaseUntil: string }
  | { type: "heartbeat"; leaseUntil: string }
  | { type: "complete"; completedAt: string }
  | { type: "block"; reason: string }
  | { type: "retry"; reason: string; nextAttemptAt: string }
  | { type: "fail"; errorMessage: string }
  | { type: "skip"; reason: string }
  | { type: "cancel"; reason: string };

type AgentTeamJobEventType = AgentTeamJobEvent["type"];

export class InvalidAgentTeamJobTransitionError extends Error {
  constructor(from: AgentTeamJobStatusValue, event: AgentTeamJobEventType) {
    super(`Invalid transition: cannot handle "${event}" in agent-team job state "${from}"`);
    this.name = "InvalidAgentTeamJobTransitionError";
  }
}

const agentTeamJobFsm = defineFsm<AgentTeamJobStatusValue, AgentTeamJobEvent, AgentTeamJobContext>({
  name: "AgentTeamJob",
  initial: AGENT_TEAM_JOB_STATUS.queued,
  errorFactory: (_fsm, from, event) =>
    new InvalidAgentTeamJobTransitionError(
      from as AgentTeamJobStatusValue,
      event as AgentTeamJobEventType
    ),
  states: {
    [AGENT_TEAM_JOB_STATUS.queued]: {
      on: {
        enqueue: (ctx) => ctx,
        claim: (ctx, event) => ({
          ...ctx,
          status: AGENT_TEAM_JOB_STATUS.running,
          leaseUntil: event.leaseUntil,
          blockedReason: null,
        }),
        skip: (ctx) => ({
          ...ctx,
          status: AGENT_TEAM_JOB_STATUS.skipped,
          leaseUntil: null,
        }),
        cancel: (ctx) => ({
          ...ctx,
          status: AGENT_TEAM_JOB_STATUS.skipped,
          leaseUntil: null,
        }),
        fail: (ctx, event) => ({
          ...ctx,
          status: AGENT_TEAM_JOB_STATUS.failed,
          leaseUntil: null,
          errorMessage: event.errorMessage,
        }),
      },
    },

    [AGENT_TEAM_JOB_STATUS.running]: {
      on: {
        heartbeat: (ctx, event) => ({
          ...ctx,
          leaseUntil: event.leaseUntil,
        }),
        complete: (ctx) => ({
          ...ctx,
          status: AGENT_TEAM_JOB_STATUS.completed,
          leaseUntil: null,
          errorMessage: null,
          blockedReason: null,
        }),
        block: (ctx, event) => ({
          ...ctx,
          status: AGENT_TEAM_JOB_STATUS.blocked,
          leaseUntil: null,
          blockedReason: event.reason,
        }),
        retry: (ctx) => ({
          ...ctx,
          status: AGENT_TEAM_JOB_STATUS.queued,
          attempt: ctx.attempt + 1,
          leaseUntil: null,
          blockedReason: null,
        }),
        fail: (ctx, event) => ({
          ...ctx,
          status: AGENT_TEAM_JOB_STATUS.failed,
          leaseUntil: null,
          errorMessage: event.errorMessage,
        }),
        cancel: (ctx) => ({
          ...ctx,
          status: AGENT_TEAM_JOB_STATUS.skipped,
          leaseUntil: null,
        }),
      },
    },

    [AGENT_TEAM_JOB_STATUS.blocked]: {
      on: {
        retry: (ctx) => ({
          ...ctx,
          status: AGENT_TEAM_JOB_STATUS.queued,
          attempt: ctx.attempt + 1,
          leaseUntil: null,
          blockedReason: null,
        }),
        fail: (ctx, event) => ({
          ...ctx,
          status: AGENT_TEAM_JOB_STATUS.failed,
          leaseUntil: null,
          errorMessage: event.errorMessage,
        }),
        cancel: (ctx) => ({
          ...ctx,
          status: AGENT_TEAM_JOB_STATUS.skipped,
          leaseUntil: null,
        }),
      },
    },

    [AGENT_TEAM_JOB_STATUS.completed]: { on: {} },
    [AGENT_TEAM_JOB_STATUS.failed]: { on: {} },
    [AGENT_TEAM_JOB_STATUS.skipped]: { on: {} },
  },
});

export function createAgentTeamJobContext(jobId: string): AgentTeamJobContext {
  return {
    jobId,
    status: AGENT_TEAM_JOB_STATUS.queued,
    attempt: 1,
    leaseUntil: null,
    errorMessage: null,
    blockedReason: null,
  };
}

export function restoreAgentTeamJobContext(input: AgentTeamJobContext): AgentTeamJobContext {
  return input;
}

export function transitionAgentTeamJob(
  context: AgentTeamJobContext,
  event: AgentTeamJobEvent
): AgentTeamJobContext {
  return agentTeamJobFsm.transition(context, event);
}

export function getAllowedAgentTeamJobEvents(
  context: AgentTeamJobContext
): readonly AgentTeamJobEventType[] {
  return agentTeamJobFsm.allowedEvents(context);
}
