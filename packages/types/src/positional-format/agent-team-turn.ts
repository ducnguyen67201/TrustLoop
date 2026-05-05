import { z } from "zod";

import {
  type QuestionToResolve,
  RESOLUTION_PROMPT_INSTRUCTIONS,
  RESOLUTION_RECOMMENDED_CLOSE,
  RESOLUTION_STATUS,
  RESOLUTION_TARGET,
  type ResolutionRecommendedClose,
  type ResolutionStatus,
  type ResolutionTarget,
  type TurnResolution,
} from "@shared/types/agent-team/agent-team-dialogue.schema";

export const AGENT_TEAM_MESSAGE_KIND_CODES = {
  question: 0,
  answer: 1,
  request_evidence: 2,
  evidence: 3,
  hypothesis: 4,
  challenge: 5,
  decision: 6,
  proposal: 7,
  approval: 8,
  blocked: 9,
  status: 10,
} as const;

const kindCodeSchema = z.union(
  Object.values(AGENT_TEAM_MESSAGE_KIND_CODES).map((value) => z.literal(value)) as [
    z.ZodLiteral<number>,
    ...z.ZodLiteral<number>[],
  ]
);

// Resolution code maps. Server <-> LLM contract for the structured "questions
// to resolve" output. These mirror RESOLUTION_TARGET / RESOLUTION_STATUS /
// RESOLUTION_RECOMMENDED_CLOSE in agent-team-dialogue.schema.ts. Adding a new
// enum value requires updating BOTH places (table-driven test enforces this).
export const RESOLUTION_TARGET_CODES = {
  customer: 0,
  operator: 1,
  internal: 2,
} as const;

export const RESOLUTION_STATUS_CODES = {
  complete: 0,
  needs_input: 1,
  no_action_needed: 2,
} as const;

export const RESOLUTION_RECOMMENDED_CLOSE_CODES = {
  no_action_taken: 0,
} as const;

const targetCodeSchema = z.union(
  Object.values(RESOLUTION_TARGET_CODES).map((value) => z.literal(value)) as [
    z.ZodLiteral<number>,
    ...z.ZodLiteral<number>[],
  ]
);

const statusCodeSchema = z.union(
  Object.values(RESOLUTION_STATUS_CODES).map((value) => z.literal(value)) as [
    z.ZodLiteral<number>,
    ...z.ZodLiteral<number>[],
  ]
);

const recommendedCloseCodeSchema = z.union(
  Object.values(RESOLUTION_RECOMMENDED_CLOSE_CODES).map((value) => z.literal(value)) as [
    z.ZodLiteral<number>,
    ...z.ZodLiteral<number>[],
  ]
);

const messageTargetSchema = z.union([z.string().min(1), z.number().int().positive()]);

export const compressedQuestionToResolveSchema = z.object({
  t: targetCodeSchema,
  q: z.string().min(1),
  // Suggested reply for target=customer. Operator/company voice.
  sr: z.string().nullable().optional(),
  // Assigned role for target=internal.
  ar: z.string().nullable().optional(),
});

export const compressedTurnResolutionSchema = z.object({
  s: statusCodeSchema,
  w: z.string().nullable().optional(),
  qs: z.array(compressedQuestionToResolveSchema).default([]),
  c: recommendedCloseCodeSchema.nullable().optional(),
});

export const compressedAgentTeamTurnMessageSchema = z.object({
  k: kindCodeSchema,
  t: messageTargetSchema,
  s: z.string().min(1),
  b: z.string().min(1),
  p: z.string().nullable().optional(),
  r: z.array(z.string().min(1)).default([]),
});

export const compressedAgentTeamTurnFactSchema = z.object({
  s: z.string().min(1),
  c: z.number().min(0).max(1),
  r: z.array(z.string().min(1)).default([]),
});

export const compressedAgentTeamTurnOutputSchema = z.object({
  m: z.array(compressedAgentTeamTurnMessageSchema).default([]),
  f: z.array(compressedAgentTeamTurnFactSchema).default([]),
  q: z.array(z.string().min(1)).default([]),
  n: z.array(z.string().min(1)).default([]),
  d: z.union([z.literal(0), z.literal(1)]),
  r: compressedTurnResolutionSchema.nullable(),
});

export type CompressedAgentTeamTurnOutput = z.infer<typeof compressedAgentTeamTurnOutputSchema>;

export type ReconstructedAgentTeamTurnOutput = {
  messages: Array<{
    kind:
      | "question"
      | "answer"
      | "request_evidence"
      | "evidence"
      | "hypothesis"
      | "challenge"
      | "decision"
      | "proposal"
      | "approval"
      | "blocked"
      | "status";
    toRoleKey: string;
    subject: string;
    content: string;
    parentMessageId: string | null;
    refs: string[];
  }>;
  proposedFacts: Array<{
    statement: string;
    confidence: number;
    sourceMessageIds: string[];
  }>;
  resolvedQuestionIds: string[];
  nextSuggestedRoleKeys: string[];
  done: boolean;
  resolution: TurnResolution | null;
};

// Run id and a stable per-turn index so reconstructed question ids are
// deterministic (idempotent across activity retries). Format:
// `${runId}-${turnIndex}-${questionIndex}`.
export interface ReconstructAgentTeamTurnOutputContext {
  runId: string;
  turnIndex: number;
  addressableRoleKeys?: readonly string[];
}

export function reconstructAgentTeamTurnOutput(
  compressed: CompressedAgentTeamTurnOutput,
  context: ReconstructAgentTeamTurnOutputContext
): ReconstructedAgentTeamTurnOutput {
  return {
    messages: compressed.m.map((message) => ({
      kind: mapKindCodeToKind(message.k),
      toRoleKey: mapMessageTargetToRoleKey(message.t, context),
      subject: message.s,
      content: message.b,
      parentMessageId: message.p ?? null,
      refs: message.r,
    })),
    proposedFacts: compressed.f.map((fact) => ({
      statement: fact.s,
      confidence: fact.c,
      sourceMessageIds: fact.r,
    })),
    resolvedQuestionIds: compressed.q,
    nextSuggestedRoleKeys: compressed.n,
    done: compressed.d === 1,
    resolution: compressed.r === null ? null : reconstructResolution(compressed.r, context),
  };
}

function mapMessageTargetToRoleKey(
  target: z.infer<typeof messageTargetSchema>,
  context: ReconstructAgentTeamTurnOutputContext
): string {
  if (typeof target === "string") {
    return target;
  }

  const roleKey = context.addressableRoleKeys?.[target - 1];
  if (!roleKey) {
    throw new Error(`Unsupported agent-team message target index: ${target}`);
  }

  return roleKey;
}

function reconstructResolution(
  compressed: z.infer<typeof compressedTurnResolutionSchema>,
  context: ReconstructAgentTeamTurnOutputContext
): TurnResolution {
  return {
    status: mapStatusCodeToStatus(compressed.s),
    whyStuck: compressed.w ?? null,
    questionsToResolve: compressed.qs.map(
      (question, questionIndex): QuestionToResolve => ({
        // Server-generated deterministic id; LLM-supplied ids are not accepted.
        id: `${context.runId}-${context.turnIndex}-${questionIndex}`,
        target: mapTargetCodeToTarget(question.t),
        question: question.q,
        suggestedReply: question.sr ?? null,
        assignedRole: question.ar ?? null,
      })
    ),
    recommendedClose:
      compressed.c === null || compressed.c === undefined
        ? null
        : mapRecommendedCloseCode(compressed.c),
  };
}

function mapKindCodeToKind(
  code: z.infer<typeof kindCodeSchema>
): ReconstructedAgentTeamTurnOutput["messages"][number]["kind"] {
  switch (code) {
    case AGENT_TEAM_MESSAGE_KIND_CODES.question:
      return "question";
    case AGENT_TEAM_MESSAGE_KIND_CODES.answer:
      return "answer";
    case AGENT_TEAM_MESSAGE_KIND_CODES.request_evidence:
      return "request_evidence";
    case AGENT_TEAM_MESSAGE_KIND_CODES.evidence:
      return "evidence";
    case AGENT_TEAM_MESSAGE_KIND_CODES.hypothesis:
      return "hypothesis";
    case AGENT_TEAM_MESSAGE_KIND_CODES.challenge:
      return "challenge";
    case AGENT_TEAM_MESSAGE_KIND_CODES.decision:
      return "decision";
    case AGENT_TEAM_MESSAGE_KIND_CODES.proposal:
      return "proposal";
    case AGENT_TEAM_MESSAGE_KIND_CODES.approval:
      return "approval";
    case AGENT_TEAM_MESSAGE_KIND_CODES.blocked:
      return "blocked";
    case AGENT_TEAM_MESSAGE_KIND_CODES.status:
      return "status";
  }

  throw new Error(`Unsupported agent-team message kind code: ${code}`);
}

function mapTargetCodeToTarget(code: z.infer<typeof targetCodeSchema>): ResolutionTarget {
  switch (code) {
    case RESOLUTION_TARGET_CODES.customer:
      return RESOLUTION_TARGET.customer;
    case RESOLUTION_TARGET_CODES.operator:
      return RESOLUTION_TARGET.operator;
    case RESOLUTION_TARGET_CODES.internal:
      return RESOLUTION_TARGET.internal;
  }

  throw new Error(`Unsupported resolution target code: ${code}`);
}

function mapStatusCodeToStatus(code: z.infer<typeof statusCodeSchema>): ResolutionStatus {
  switch (code) {
    case RESOLUTION_STATUS_CODES.complete:
      return RESOLUTION_STATUS.complete;
    case RESOLUTION_STATUS_CODES.needs_input:
      return RESOLUTION_STATUS.needsInput;
    case RESOLUTION_STATUS_CODES.no_action_needed:
      return RESOLUTION_STATUS.noActionNeeded;
  }

  throw new Error(`Unsupported resolution status code: ${code}`);
}

function mapRecommendedCloseCode(
  code: z.infer<typeof recommendedCloseCodeSchema>
): ResolutionRecommendedClose {
  switch (code) {
    case RESOLUTION_RECOMMENDED_CLOSE_CODES.no_action_taken:
      return RESOLUTION_RECOMMENDED_CLOSE.noActionTaken;
  }

  throw new Error(`Unsupported recommended close code: ${code}`);
}

export const POSITIONAL_AGENT_TEAM_TURN_FORMAT_INSTRUCTIONS = `
Return ONLY compressed JSON using this format:
Do not wrap the JSON in Markdown, code fences, prose, or comments.
  m = messages array
  f = proposed facts array
  q = resolved question ids
  n = next suggested role keys
  d = done flag (1=yes, 0=no)
  r = resolution object or null (see below)

Each message object:
  k = message kind code
  t = target role key or "broadcast" or "orchestrator"
  s = short subject
  b = message body
  p = parent message id or null
  r = reference ids

Message kind codes:
  0=question
  1=answer
  2=request_evidence
  3=evidence
  4=hypothesis
  5=challenge
  6=decision
  7=proposal
  8=approval
  9=blocked
  10=status

Allowed role keys are listed in the prompt input under Available Team Roles.
${RESOLUTION_PROMPT_INSTRUCTIONS}
Example with messages, facts, and follow-up:
{"m":[{"k":0,"t":"rca_analyst","s":"Prod confirmation","b":"Do Sentry traces show the Slack reply threading failure in production?","p":null,"r":[]},{"k":4,"t":"broadcast","s":"Likely fault line","b":"The strongest hypothesis is a null path in the reply resolver before parent-thread lookup.","p":null,"r":["msg_architect_1"]}],"f":[{"s":"The report centers on Slack reply threading, not message delivery.","c":0.88,"r":["msg_architect_1"]}],"q":[],"n":["rca_analyst"],"d":0,"r":null}

Minimal example with no follow-up:
{"m":[{"k":8,"t":"pr_creator","s":"Approved to draft PR","b":"Evidence is sufficient if the PR includes regression coverage for canonical and alias thread paths.","p":"msg_review_4","r":["msg_review_4","msg_code_7"]}],"f":[],"q":["question_2"],"n":["pr_creator"],"d":1,"r":null}`;
