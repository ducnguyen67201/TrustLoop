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

// Resolution: the structured "what does the architect need to make progress?" output.
// Each blocked turn maps to a resolution with a status and a list of questions to
// resolve. Each question has a target (who can answer it: customer, operator, or
// internal role) and the question text. Server assigns deterministic IDs at parse
// time (runId-turnIndex-questionIndex); LLM does not emit ids.
export const RESOLUTION_TARGET = {
  customer: "customer",
  operator: "operator",
  internal: "internal",
} as const;

export const resolutionTargetValues = [
  RESOLUTION_TARGET.customer,
  RESOLUTION_TARGET.operator,
  RESOLUTION_TARGET.internal,
] as const;

export const resolutionTargetSchema = z.enum(resolutionTargetValues);

export const RESOLUTION_STATUS = {
  complete: "complete",
  needsInput: "needs_input",
  noActionNeeded: "no_action_needed",
} as const;

export const resolutionStatusValues = [
  RESOLUTION_STATUS.complete,
  RESOLUTION_STATUS.needsInput,
  RESOLUTION_STATUS.noActionNeeded,
] as const;

export const resolutionStatusSchema = z.enum(resolutionStatusValues);

export const RESOLUTION_RECOMMENDED_CLOSE = {
  noActionTaken: "no_action_taken",
} as const;

export const resolutionRecommendedCloseValues = [
  RESOLUTION_RECOMMENDED_CLOSE.noActionTaken,
] as const;

export const resolutionRecommendedCloseSchema = z.enum(resolutionRecommendedCloseValues);

// Input shape: what the LLM emits inside the compressed turn output. Server
// assigns IDs at parse time; LLM does not supply them. Keeping the input shape
// and the post-parse shape distinct prevents the LLM from polluting question
// identity.
export const questionToResolveInputSchema = z.object({
  target: resolutionTargetSchema,
  question: z.string().trim().min(1),
  // For target=customer only. Written in operator/company voice TO the customer
  // (NOT in the customer's voice). Empty for non-customer targets.
  suggestedReply: z.string().nullable().optional(),
  // For target=internal only. The role key that should answer this question.
  // Architect SHOULD use existing role keys (rca_analyst, code_reader, etc.).
  assignedRole: z.string().nullable().optional(),
});

export const turnResolutionInputSchema = z.object({
  status: resolutionStatusSchema,
  whyStuck: z.string().nullable().optional(),
  questionsToResolve: z.array(questionToResolveInputSchema).default([]),
  recommendedClose: resolutionRecommendedCloseSchema.nullable().optional(),
});

// Post-parse shape: server has assigned deterministic IDs to each question.
// Downstream code (activity, UI projections) consumes this shape.
export const questionToResolveSchema = questionToResolveInputSchema.extend({
  id: z.string().min(1),
});

export const turnResolutionSchema = turnResolutionInputSchema.extend({
  questionsToResolve: z.array(questionToResolveSchema).default([]),
});

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
  // Stable per-run counter incremented by the workflow loop on each turn it
  // dispatches. The agent combines it with runId to derive deterministic
  // question ids in resolution output: `${runId}-${turnIndex}-${questionIndex}`.
  turnIndex: z.number().int().nonnegative().default(0),
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

// Consumers derive blocked-state semantics from `resolution.status`
// (`needs_input` → role is blocked) and surface text via `resolution.whyStuck`.
export const agentTeamRoleTurnOutputSchema = z.object({
  messages: z.array(agentTeamDialogueMessageDraftSchema).default([]),
  proposedFacts: z.array(agentTeamFactDraftSchema).default([]),
  resolvedQuestionIds: z.array(z.string().min(1)).default([]),
  nextSuggestedRoleKeys: z.array(z.string().min(1)).default([]),
  done: z.boolean().default(false),
  resolution: turnResolutionSchema.nullable().optional(),
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
export type ResolutionTarget = z.infer<typeof resolutionTargetSchema>;
export type ResolutionStatus = z.infer<typeof resolutionStatusSchema>;
export type ResolutionRecommendedClose = z.infer<typeof resolutionRecommendedCloseSchema>;
export type QuestionToResolveInput = z.infer<typeof questionToResolveInputSchema>;
export type QuestionToResolve = z.infer<typeof questionToResolveSchema>;
export type TurnResolutionInput = z.infer<typeof turnResolutionInputSchema>;
export type TurnResolution = z.infer<typeof turnResolutionSchema>;

// Single source of truth for the architect's resolution-output contract.
// The architect prompt imports this directly so adding a new target/status
// requires updating exactly one place. Table-driven enum tests assert that
// every RESOLUTION_TARGET and RESOLUTION_STATUS value appears here.
export const RESOLUTION_PROMPT_INSTRUCTIONS = `
Resolution output (the "r" field):

When you cannot complete the analysis in this turn, populate "r" with a
structured list of questions you need to resolve. Each question has a target
(who can answer it) and the question text. Do NOT emit ids — the server
assigns deterministic ids at parse time.

Status codes (s):
  0=complete           → analysis done; no questions needed
  1=needs_input        → cannot proceed without resolving the listed questions
  2=no_action_needed   → conversation should be closed (e.g. customer
                         acknowledgement); set c=0 to recommend close

Question target codes (t):
  0=customer   → ask the customer; provide sr (suggested reply written in
                 OPERATOR/COMPANY voice TO the customer, NOT in customer's voice)
  1=operator   → ask the human operator; sr/ar omitted
  2=internal   → ask another agent role (rca_analyst, code_reader, reviewer,
                 pr_creator); set ar=role key. Exhaust internal options FIRST
                 before bubbling to customer/operator.

Recommended close codes (c, only when s=2):
  0=no_action_taken    → conversation can be closed without further action

Fields per question:
  t  = target code (0|1|2)
  q  = question text (in agent's voice)
  sr = suggested reply (target=customer only; operator/company voice)
  ar = assigned role key (target=internal only)

Compressed shape:
  r = { s: status, w: whyStuck or null, qs: [questions], c: recommended close or null }
  qs entry = { t: target, q: question, sr: optional, ar: optional }

Example (needs_input with one customer question + one internal question):
  "r":{"s":1,"w":"Customer mentioned billing but no specific charge.","qs":[{"t":0,"q":"Which charge looks wrong?","sr":"Hey! Could you share the date or amount of the charge that doesn't look right?"},{"t":2,"q":"Pull last 30 days of invoices for this workspace","ar":"rca_analyst"}],"c":null}

Example (no_action_needed for an acknowledgement):
  "r":{"s":2,"w":"Customer is acknowledging a previous reply.","qs":[],"c":0}

Example (complete — no resolution needed; r is null):
  "r":null

If "r" is null, the role is not blocked and produced complete output. If "r"
is present with s=1 (needs_input), the role is blocked pending resolution.
`;
