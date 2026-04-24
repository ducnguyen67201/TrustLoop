import { sessionDigestSchema } from "@shared/types/session-replay/session-digest.schema";
import { z } from "zod";

import { agentTeamRoleSchema } from "./agent-team-core.schema";

export const AGENT_TEAM_MESSAGE_KIND = {
  question: "question",
  answer: "answer",
  requestEvidence: "request_evidence",
  evidence: "evidence",
  hypothesis: "hypothesis",
  challenge: "challenge",
  decision: "decision",
  proposal: "proposal",
  approval: "approval",
  blocked: "blocked",
  toolCall: "tool_call",
  toolResult: "tool_result",
  status: "status",
} as const;

export const agentTeamMessageKindValues = [
  AGENT_TEAM_MESSAGE_KIND.question,
  AGENT_TEAM_MESSAGE_KIND.answer,
  AGENT_TEAM_MESSAGE_KIND.requestEvidence,
  AGENT_TEAM_MESSAGE_KIND.evidence,
  AGENT_TEAM_MESSAGE_KIND.hypothesis,
  AGENT_TEAM_MESSAGE_KIND.challenge,
  AGENT_TEAM_MESSAGE_KIND.decision,
  AGENT_TEAM_MESSAGE_KIND.proposal,
  AGENT_TEAM_MESSAGE_KIND.approval,
  AGENT_TEAM_MESSAGE_KIND.blocked,
  AGENT_TEAM_MESSAGE_KIND.toolCall,
  AGENT_TEAM_MESSAGE_KIND.toolResult,
  AGENT_TEAM_MESSAGE_KIND.status,
] as const;

export const agentTeamMessageKindSchema = z.enum(agentTeamMessageKindValues);

export const AGENT_TEAM_TARGET = {
  broadcast: "broadcast",
  orchestrator: "orchestrator",
} as const;

export const agentTeamTargetValues = [
  AGENT_TEAM_TARGET.broadcast,
  AGENT_TEAM_TARGET.orchestrator,
] as const;

export const agentTeamTargetSchema = z.string().min(1);

export const AGENT_TEAM_MESSAGE_SENDER = {
  system: "system",
} as const;

export const agentTeamMessageSenderSchema = z.string().min(1);

export const AGENT_TEAM_ROLE_INBOX_STATE = {
  idle: "idle",
  queued: "queued",
  running: "running",
  blocked: "blocked",
  done: "done",
} as const;

export const agentTeamRoleInboxStateValues = [
  AGENT_TEAM_ROLE_INBOX_STATE.idle,
  AGENT_TEAM_ROLE_INBOX_STATE.queued,
  AGENT_TEAM_ROLE_INBOX_STATE.running,
  AGENT_TEAM_ROLE_INBOX_STATE.blocked,
  AGENT_TEAM_ROLE_INBOX_STATE.done,
] as const;

export const agentTeamRoleInboxStateSchema = z.enum(agentTeamRoleInboxStateValues);

export const AGENT_TEAM_FACT_STATUS = {
  proposed: "proposed",
  accepted: "accepted",
  rejected: "rejected",
} as const;

export const agentTeamFactStatusValues = [
  AGENT_TEAM_FACT_STATUS.proposed,
  AGENT_TEAM_FACT_STATUS.accepted,
  AGENT_TEAM_FACT_STATUS.rejected,
] as const;

export const agentTeamFactStatusSchema = z.enum(agentTeamFactStatusValues);

export const AGENT_TEAM_OPEN_QUESTION_STATUS = {
  open: "open",
  answered: "answered",
  dropped: "dropped",
} as const;

export const agentTeamOpenQuestionStatusValues = [
  AGENT_TEAM_OPEN_QUESTION_STATUS.open,
  AGENT_TEAM_OPEN_QUESTION_STATUS.answered,
  AGENT_TEAM_OPEN_QUESTION_STATUS.dropped,
] as const;

export const agentTeamOpenQuestionStatusSchema = z.enum(agentTeamOpenQuestionStatusValues);

const jsonRecordSchema = z.record(z.string(), z.unknown());

export const agentTeamDialogueMessageDraftSchema = z.object({
  toRoleKey: agentTeamTargetSchema,
  kind: agentTeamMessageKindSchema,
  subject: z.string().trim().min(1).max(160),
  content: z.string().min(1),
  parentMessageId: z.string().min(1).nullable().optional(),
  refs: z.array(z.string().min(1)).default([]),
  toolName: z.string().min(1).nullable().optional(),
  metadata: jsonRecordSchema.nullable().optional(),
});

export const agentTeamDialogueMessageSchema = z.preprocess(
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
    id: z.string().min(1),
    runId: z.string().min(1),
    threadId: z.string().min(1),
    fromRoleKey: agentTeamMessageSenderSchema,
    fromRoleSlug: z.string().min(1),
    fromRoleLabel: z.string().min(1),
    toRoleKey: agentTeamTargetSchema,
    kind: agentTeamMessageKindSchema,
    subject: z.string().min(1),
    content: z.string(),
    parentMessageId: z.string().min(1).nullable(),
    refs: z.array(z.string().min(1)).default([]),
    toolName: z.string().min(1).nullable(),
    metadata: jsonRecordSchema.nullable(),
    createdAt: z.iso.datetime(),
  })
);

export const agentTeamRoleInboxSchema = z.preprocess(
  (value) => {
    if (value === null || typeof value !== "object") {
      return value;
    }

    const candidate = value as { roleKey?: unknown; roleSlug?: unknown };
    return {
      ...candidate,
      roleKey: typeof candidate.roleKey === "string" ? candidate.roleKey : candidate.roleSlug,
    };
  },
  z.object({
    id: z.string().min(1),
    runId: z.string().min(1),
    roleKey: z.string().min(1),
    state: agentTeamRoleInboxStateSchema,
    lastReadMessageId: z.string().min(1).nullable(),
    wakeReason: z.string().nullable(),
    unreadCount: z.number().int().nonnegative(),
    lastWokenAt: z.iso.datetime().nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
);

export const agentTeamFactSchema = z.preprocess(
  (value) => {
    if (value === null || typeof value !== "object") {
      return value;
    }

    const candidate = value as { acceptedByRoleKeys?: unknown; acceptedBy?: unknown };
    return {
      ...candidate,
      acceptedByRoleKeys: Array.isArray(candidate.acceptedByRoleKeys)
        ? candidate.acceptedByRoleKeys
        : candidate.acceptedBy,
    };
  },
  z.object({
    id: z.string().min(1),
    runId: z.string().min(1),
    statement: z.string().min(1),
    confidence: z.number().min(0).max(1),
    sourceMessageIds: z.array(z.string().min(1)).default([]),
    acceptedByRoleKeys: z.array(z.string().min(1)).default([]),
    status: agentTeamFactStatusSchema,
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
);

export const agentTeamFactDraftSchema = z.object({
  statement: z.string().trim().min(1).max(1000),
  confidence: z.number().min(0).max(1),
  sourceMessageIds: z.array(z.string().min(1)).default([]),
});

export const agentTeamOpenQuestionSchema = z.preprocess(
  (value) => {
    if (value === null || typeof value !== "object") {
      return value;
    }

    const candidate = value as {
      askedByRoleKey?: unknown;
      askedByRoleSlug?: unknown;
      ownerRoleKey?: unknown;
      ownerRoleSlug?: unknown;
      blockingRoleKeys?: unknown;
      blockingRoles?: unknown;
    };

    return {
      ...candidate,
      askedByRoleKey:
        typeof candidate.askedByRoleKey === "string"
          ? candidate.askedByRoleKey
          : candidate.askedByRoleSlug,
      ownerRoleKey:
        typeof candidate.ownerRoleKey === "string"
          ? candidate.ownerRoleKey
          : candidate.ownerRoleSlug,
      blockingRoleKeys: Array.isArray(candidate.blockingRoleKeys)
        ? candidate.blockingRoleKeys
        : candidate.blockingRoles,
    };
  },
  z.object({
    id: z.string().min(1),
    runId: z.string().min(1),
    askedByRoleKey: z.string().min(1),
    ownerRoleKey: z.string().min(1),
    question: z.string().min(1),
    blockingRoleKeys: z.array(z.string().min(1)).default([]),
    status: agentTeamOpenQuestionStatusSchema,
    sourceMessageId: z.string().min(1),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
);

export const agentTeamRoleTurnInputSchema = z.object({
  workspaceId: z.string().min(1),
  conversationId: z.string().min(1).optional(),
  runId: z.string().min(1),
  teamRoles: z.array(agentTeamRoleSchema).min(1),
  role: agentTeamRoleSchema,
  requestSummary: z.string().min(1),
  inbox: z.array(agentTeamDialogueMessageSchema).default([]),
  acceptedFacts: z.array(agentTeamFactSchema).default([]),
  openQuestions: z.array(agentTeamOpenQuestionSchema).default([]),
  recentThread: z.array(agentTeamDialogueMessageSchema).default([]),
  sessionDigest: sessionDigestSchema.nullish(),
});

export const agentTeamTurnMetaSchema = z.object({
  provider: z.string(),
  model: z.string(),
  totalDurationMs: z.number().int().nonnegative(),
  turnCount: z.number().int().nonnegative(),
});

export const agentTeamRoleTurnOutputSchema = z.object({
  messages: z.array(agentTeamDialogueMessageDraftSchema).default([]),
  proposedFacts: z.array(agentTeamFactDraftSchema).default([]),
  resolvedQuestionIds: z.array(z.string().min(1)).default([]),
  nextSuggestedRoleKeys: z.array(z.string().min(1)).default([]),
  done: z.boolean().default(false),
  blockedReason: z.string().nullable().optional(),
  meta: agentTeamTurnMetaSchema,
});

export function isRoleTarget(target: z.infer<typeof agentTeamTargetSchema>): boolean {
  return target !== AGENT_TEAM_TARGET.broadcast && target !== AGENT_TEAM_TARGET.orchestrator;
}

export type AgentTeamMessageKind = z.infer<typeof agentTeamMessageKindSchema>;
export type AgentTeamTarget = z.infer<typeof agentTeamTargetSchema>;
export type AgentTeamMessageSender = z.infer<typeof agentTeamMessageSenderSchema>;
export type AgentTeamDialogueMessageDraft = z.infer<typeof agentTeamDialogueMessageDraftSchema>;
export type AgentTeamDialogueMessage = z.infer<typeof agentTeamDialogueMessageSchema>;
export type AgentTeamRoleInboxState = z.infer<typeof agentTeamRoleInboxStateSchema>;
export type AgentTeamRoleInbox = z.infer<typeof agentTeamRoleInboxSchema>;
export type AgentTeamFactStatus = z.infer<typeof agentTeamFactStatusSchema>;
export type AgentTeamFact = z.infer<typeof agentTeamFactSchema>;
export type AgentTeamFactDraft = z.infer<typeof agentTeamFactDraftSchema>;
export type AgentTeamOpenQuestionStatus = z.infer<typeof agentTeamOpenQuestionStatusSchema>;
export type AgentTeamOpenQuestion = z.infer<typeof agentTeamOpenQuestionSchema>;
export type AgentTeamRoleTurnInput = z.infer<typeof agentTeamRoleTurnInputSchema>;
export type AgentTeamTurnMeta = z.infer<typeof agentTeamTurnMetaSchema>;
export type AgentTeamRoleTurnOutput = z.infer<typeof agentTeamRoleTurnOutputSchema>;
