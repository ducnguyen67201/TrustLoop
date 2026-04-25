import { z } from "zod";

import {
  agentTeamMessageKindSchema,
  agentTeamTargetSchema,
  resolutionStatusSchema,
  resolutionTargetSchema,
} from "@shared/types/agent-team/agent-team-dialogue.schema";

// Append-only event log kinds. Adding a new kind is a one-way door once prod
// data exists (cannot rename, can only deprecate). Keep this list tight and
// name each kind for what HAPPENED, not what the consumer DOES with it.
export const AGENT_TEAM_EVENT_KIND = {
  runStarted: "run_started",
  runSucceeded: "run_succeeded",
  runFailed: "run_failed",
  roleQueued: "role_queued",
  roleStarted: "role_started",
  roleBlocked: "role_blocked",
  roleCompleted: "role_completed",
  messageSent: "message_sent",
  factProposed: "fact_proposed",
  questionOpened: "question_opened",
  toolCalled: "tool_called",
  toolReturned: "tool_returned",
  error: "error",
  // Resolution lifecycle. UI status badges derive from these events, not from
  // message metadata.
  questionDispatched: "question_dispatched",
  questionAnswered: "question_answered",
  questionSuperseded: "question_superseded",
} as const;

export const agentTeamEventKindValues = [
  AGENT_TEAM_EVENT_KIND.runStarted,
  AGENT_TEAM_EVENT_KIND.runSucceeded,
  AGENT_TEAM_EVENT_KIND.runFailed,
  AGENT_TEAM_EVENT_KIND.roleQueued,
  AGENT_TEAM_EVENT_KIND.roleStarted,
  AGENT_TEAM_EVENT_KIND.roleBlocked,
  AGENT_TEAM_EVENT_KIND.roleCompleted,
  AGENT_TEAM_EVENT_KIND.messageSent,
  AGENT_TEAM_EVENT_KIND.factProposed,
  AGENT_TEAM_EVENT_KIND.questionOpened,
  AGENT_TEAM_EVENT_KIND.toolCalled,
  AGENT_TEAM_EVENT_KIND.toolReturned,
  AGENT_TEAM_EVENT_KIND.error,
  AGENT_TEAM_EVENT_KIND.questionDispatched,
  AGENT_TEAM_EVENT_KIND.questionAnswered,
  AGENT_TEAM_EVENT_KIND.questionSuperseded,
] as const;

export const agentTeamEventKindSchema = z.enum(agentTeamEventKindValues);

// The actor is who emitted the event: a role key, "system" for orchestrator
// bookkeeping, or "orchestrator" for workflow-level transitions.
export const AGENT_TEAM_EVENT_ACTOR_SYSTEM = {
  system: "system",
  orchestrator: "orchestrator",
} as const;

export const agentTeamEventActorSchema = z.union([
  z.literal(AGENT_TEAM_EVENT_ACTOR_SYSTEM.system),
  z.literal(AGENT_TEAM_EVENT_ACTOR_SYSTEM.orchestrator),
  z.string().min(1),
]);

// Payload shapes per kind. Max 2 levels of nesting per positional-format spec.
const runStartedPayload = z.object({
  teamId: z.string().min(1),
  conversationId: z.string().nullable().optional(),
  analysisId: z.string().nullable().optional(),
});

const runTerminalPayload = z.object({
  durationMs: z.number().int().nonnegative(),
  messageCount: z.number().int().nonnegative(),
  errorMessage: z.string().nullable().optional(),
});

const roleStatePayload = z.object({
  roleKey: z.string().min(1),
  wakeReason: z.string().nullable().optional(),
  blockingRoleKeys: z.array(z.string()).optional(),
});

const messageSentPayload = z.preprocess(
  (value) => {
    if (value === null || typeof value !== "object") {
      return value;
    }

    const candidate = value as {
      fromRoleKey?: unknown;
      fromRoleSlug?: unknown;
      toRoleKey?: unknown;
      toRoleSlug?: unknown;
    };

    return {
      ...candidate,
      fromRoleKey:
        typeof candidate.fromRoleKey === "string" ? candidate.fromRoleKey : candidate.fromRoleSlug,
      toRoleKey:
        typeof candidate.toRoleKey === "string" ? candidate.toRoleKey : candidate.toRoleSlug,
    };
  },
  z.object({
    messageId: z.string().min(1),
    fromRoleKey: z.string().min(1),
    toRoleKey: agentTeamTargetSchema,
    kind: agentTeamMessageKindSchema,
    subject: z.string(),
    contentPreview: z.string().max(280),
  })
);

const factProposedPayload = z.object({
  factId: z.string().min(1),
  statement: z.string(),
  confidence: z.number().min(0).max(1),
});

const questionOpenedPayload = z.preprocess(
  (value) => {
    if (value === null || typeof value !== "object") {
      return value;
    }

    const candidate = value as { ownerRoleKey?: unknown; ownerRoleSlug?: unknown };
    return {
      ...candidate,
      ownerRoleKey:
        typeof candidate.ownerRoleKey === "string"
          ? candidate.ownerRoleKey
          : candidate.ownerRoleSlug,
    };
  },
  z.object({
    questionId: z.string().min(1),
    question: z.string(),
    ownerRoleKey: z.string().min(1),
  })
);

const toolCalledPayload = z.object({
  toolName: z.string().min(1),
  argsPreview: z.string().max(1024),
});

const toolReturnedPayload = z.object({
  toolName: z.string().min(1),
  ok: z.boolean(),
  resultSummary: z.string().max(2048),
});

const errorPayload = z.object({
  message: z.string(),
  recoverable: z.boolean().default(false),
  stack: z.string().nullable().optional(),
});

// Resolution lifecycle payloads. Each payload includes target+status so
// dashboard filters and log search don't need to join back to the
// originating turn output.
const questionDispatchedPayload = z.object({
  questionId: z.string().min(1),
  target: resolutionTargetSchema,
  status: resolutionStatusSchema,
  question: z.string().min(1),
  // For target=customer; suggestion the architect drafted, in operator/company voice.
  suggestedReply: z.string().nullable().optional(),
  // For target=internal; role key the question was routed to.
  assignedRole: z.string().nullable().optional(),
});

const questionAnsweredPayload = z.object({
  questionId: z.string().min(1),
  target: resolutionTargetSchema,
  // Where the answer came from. customer = synthetic from a customer reply,
  // operator = operator typed answer in UI, internal_role = a peer role
  // posted an answer message.
  source: z.enum(["customer", "operator", "internal_role"]),
  answer: z.string().nullable().optional(),
});

const questionSupersededPayload = z.object({
  questionId: z.string().min(1),
  target: resolutionTargetSchema,
  reason: z.string().min(1),
});

// Base shape shared by every event. `id` and `ts` are DB-assigned on write.
const agentTeamRunEventBase = z.object({
  id: z.string().min(1),
  runId: z.string().min(1),
  workspaceId: z.string().min(1),
  ts: z.coerce.date(),
  actor: agentTeamEventActorSchema,
  target: z.string().nullable().optional(),
  messageKind: agentTeamMessageKindSchema.nullable().optional(),
  latencyMs: z.number().int().nonnegative().nullable().optional(),
  tokensIn: z.number().int().nonnegative().nullable().optional(),
  tokensOut: z.number().int().nonnegative().nullable().optional(),
  truncated: z.boolean().default(false),
});

export const agentTeamRunEventSchema = z.discriminatedUnion("kind", [
  agentTeamRunEventBase.extend({
    kind: z.literal(AGENT_TEAM_EVENT_KIND.runStarted),
    payload: runStartedPayload,
  }),
  agentTeamRunEventBase.extend({
    kind: z.literal(AGENT_TEAM_EVENT_KIND.runSucceeded),
    payload: runTerminalPayload,
  }),
  agentTeamRunEventBase.extend({
    kind: z.literal(AGENT_TEAM_EVENT_KIND.runFailed),
    payload: runTerminalPayload,
  }),
  agentTeamRunEventBase.extend({
    kind: z.literal(AGENT_TEAM_EVENT_KIND.roleQueued),
    payload: roleStatePayload,
  }),
  agentTeamRunEventBase.extend({
    kind: z.literal(AGENT_TEAM_EVENT_KIND.roleStarted),
    payload: roleStatePayload,
  }),
  agentTeamRunEventBase.extend({
    kind: z.literal(AGENT_TEAM_EVENT_KIND.roleBlocked),
    payload: roleStatePayload,
  }),
  agentTeamRunEventBase.extend({
    kind: z.literal(AGENT_TEAM_EVENT_KIND.roleCompleted),
    payload: roleStatePayload,
  }),
  agentTeamRunEventBase.extend({
    kind: z.literal(AGENT_TEAM_EVENT_KIND.messageSent),
    payload: messageSentPayload,
  }),
  agentTeamRunEventBase.extend({
    kind: z.literal(AGENT_TEAM_EVENT_KIND.factProposed),
    payload: factProposedPayload,
  }),
  agentTeamRunEventBase.extend({
    kind: z.literal(AGENT_TEAM_EVENT_KIND.questionOpened),
    payload: questionOpenedPayload,
  }),
  agentTeamRunEventBase.extend({
    kind: z.literal(AGENT_TEAM_EVENT_KIND.toolCalled),
    payload: toolCalledPayload,
  }),
  agentTeamRunEventBase.extend({
    kind: z.literal(AGENT_TEAM_EVENT_KIND.toolReturned),
    payload: toolReturnedPayload,
  }),
  agentTeamRunEventBase.extend({
    kind: z.literal(AGENT_TEAM_EVENT_KIND.error),
    payload: errorPayload,
  }),
  agentTeamRunEventBase.extend({
    kind: z.literal(AGENT_TEAM_EVENT_KIND.questionDispatched),
    payload: questionDispatchedPayload,
  }),
  agentTeamRunEventBase.extend({
    kind: z.literal(AGENT_TEAM_EVENT_KIND.questionAnswered),
    payload: questionAnsweredPayload,
  }),
  agentTeamRunEventBase.extend({
    kind: z.literal(AGENT_TEAM_EVENT_KIND.questionSuperseded),
    payload: questionSupersededPayload,
  }),
]);

export type AgentTeamRunEvent = z.infer<typeof agentTeamRunEventSchema>;

// Draft shape for writing: id and ts are omitted (DB assigns them). Other fields
// match the persisted row. Discriminated on kind so callers get payload inference.
export const agentTeamRunEventDraftSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal(AGENT_TEAM_EVENT_KIND.runStarted),
    runId: z.string().min(1),
    workspaceId: z.string().min(1),
    actor: agentTeamEventActorSchema,
    target: z.string().nullable().optional(),
    payload: runStartedPayload,
  }),
  z.object({
    kind: z.literal(AGENT_TEAM_EVENT_KIND.runSucceeded),
    runId: z.string().min(1),
    workspaceId: z.string().min(1),
    actor: agentTeamEventActorSchema,
    payload: runTerminalPayload,
  }),
  z.object({
    kind: z.literal(AGENT_TEAM_EVENT_KIND.runFailed),
    runId: z.string().min(1),
    workspaceId: z.string().min(1),
    actor: agentTeamEventActorSchema,
    payload: runTerminalPayload,
  }),
  z.object({
    kind: z.literal(AGENT_TEAM_EVENT_KIND.roleQueued),
    runId: z.string().min(1),
    workspaceId: z.string().min(1),
    actor: agentTeamEventActorSchema,
    target: z.string().nullable().optional(),
    payload: roleStatePayload,
  }),
  z.object({
    kind: z.literal(AGENT_TEAM_EVENT_KIND.roleStarted),
    runId: z.string().min(1),
    workspaceId: z.string().min(1),
    actor: agentTeamEventActorSchema,
    payload: roleStatePayload,
  }),
  z.object({
    kind: z.literal(AGENT_TEAM_EVENT_KIND.roleBlocked),
    runId: z.string().min(1),
    workspaceId: z.string().min(1),
    actor: agentTeamEventActorSchema,
    payload: roleStatePayload,
  }),
  z.object({
    kind: z.literal(AGENT_TEAM_EVENT_KIND.roleCompleted),
    runId: z.string().min(1),
    workspaceId: z.string().min(1),
    actor: agentTeamEventActorSchema,
    latencyMs: z.number().int().nonnegative().nullable().optional(),
    tokensIn: z.number().int().nonnegative().nullable().optional(),
    tokensOut: z.number().int().nonnegative().nullable().optional(),
    payload: roleStatePayload,
  }),
  z.object({
    kind: z.literal(AGENT_TEAM_EVENT_KIND.messageSent),
    runId: z.string().min(1),
    workspaceId: z.string().min(1),
    actor: agentTeamEventActorSchema,
    target: z.string().nullable().optional(),
    messageKind: agentTeamMessageKindSchema,
    payload: messageSentPayload,
  }),
  z.object({
    kind: z.literal(AGENT_TEAM_EVENT_KIND.factProposed),
    runId: z.string().min(1),
    workspaceId: z.string().min(1),
    actor: agentTeamEventActorSchema,
    payload: factProposedPayload,
  }),
  z.object({
    kind: z.literal(AGENT_TEAM_EVENT_KIND.questionOpened),
    runId: z.string().min(1),
    workspaceId: z.string().min(1),
    actor: agentTeamEventActorSchema,
    target: z.string().nullable().optional(),
    payload: questionOpenedPayload,
  }),
  z.object({
    kind: z.literal(AGENT_TEAM_EVENT_KIND.toolCalled),
    runId: z.string().min(1),
    workspaceId: z.string().min(1),
    actor: agentTeamEventActorSchema,
    payload: toolCalledPayload,
    truncated: z.boolean().optional(),
  }),
  z.object({
    kind: z.literal(AGENT_TEAM_EVENT_KIND.toolReturned),
    runId: z.string().min(1),
    workspaceId: z.string().min(1),
    actor: agentTeamEventActorSchema,
    latencyMs: z.number().int().nonnegative().nullable().optional(),
    payload: toolReturnedPayload,
    truncated: z.boolean().optional(),
  }),
  z.object({
    kind: z.literal(AGENT_TEAM_EVENT_KIND.error),
    runId: z.string().min(1),
    workspaceId: z.string().min(1),
    actor: agentTeamEventActorSchema,
    payload: errorPayload,
  }),
  z.object({
    kind: z.literal(AGENT_TEAM_EVENT_KIND.questionDispatched),
    runId: z.string().min(1),
    workspaceId: z.string().min(1),
    actor: agentTeamEventActorSchema,
    target: z.string().nullable().optional(),
    payload: questionDispatchedPayload,
  }),
  z.object({
    kind: z.literal(AGENT_TEAM_EVENT_KIND.questionAnswered),
    runId: z.string().min(1),
    workspaceId: z.string().min(1),
    actor: agentTeamEventActorSchema,
    target: z.string().nullable().optional(),
    payload: questionAnsweredPayload,
  }),
  z.object({
    kind: z.literal(AGENT_TEAM_EVENT_KIND.questionSuperseded),
    runId: z.string().min(1),
    workspaceId: z.string().min(1),
    actor: agentTeamEventActorSchema,
    payload: questionSupersededPayload,
  }),
]);

export type AgentTeamRunEventDraft = z.infer<typeof agentTeamRunEventDraftSchema>;

// Per-role rollup cached on AgentTeamRun.summary at terminal state. Also used
// by the UI summary card and the nightly metrics workflow.
export const agentTeamRunRoleRollupSchema = z.object({
  roleKey: z.string().min(1),
  turns: z.number().int().nonnegative(),
  toolCalls: z.number().int().nonnegative(),
  tokensIn: z.number().int().nonnegative(),
  tokensOut: z.number().int().nonnegative(),
  wallTimeMs: z.number().int().nonnegative(),
});

export type AgentTeamRunRoleRollup = z.infer<typeof agentTeamRunRoleRollupSchema>;

// Rollup cached on AgentTeamRun.summary at terminal state. Distinct from
// AgentTeamRunSummary (the live SSE snapshot in agent-team.schema.ts).
export const agentTeamRunRollupSchema = z.object({
  runId: z.string().min(1),
  status: z.string().min(1),
  startedAt: z.coerce.date().nullable(),
  completedAt: z.coerce.date().nullable(),
  durationMs: z.number().int().nonnegative(),
  messageCount: z.number().int().nonnegative(),
  toolCallCount: z.number().int().nonnegative(),
  tokensInTotal: z.number().int().nonnegative(),
  tokensOutTotal: z.number().int().nonnegative(),
  perRole: z.array(agentTeamRunRoleRollupSchema),
  computedAt: z.coerce.date(),
});

export type AgentTeamRunRollup = z.infer<typeof agentTeamRunRollupSchema>;
