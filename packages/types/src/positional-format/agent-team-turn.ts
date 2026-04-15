import { z } from "zod";

import { agentTeamRoleSlugSchema } from "../agent-team/agent-team-core.schema";

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

export const compressedAgentTeamTurnMessageSchema = z.object({
  k: kindCodeSchema,
  t: z.string().min(1),
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
  n: z.array(agentTeamRoleSlugSchema).default([]),
  d: z.union([z.literal(0), z.literal(1)]),
  b: z.string().nullable(),
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
    toRoleSlug: string;
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
  nextSuggestedRoles: string[];
  done: boolean;
  blockedReason: string | null;
};

export function reconstructAgentTeamTurnOutput(
  compressed: CompressedAgentTeamTurnOutput
): ReconstructedAgentTeamTurnOutput {
  return {
    messages: compressed.m.map((message) => ({
      kind: mapKindCodeToKind(message.k),
      toRoleSlug: message.t,
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
    nextSuggestedRoles: compressed.n,
    done: compressed.d === 1,
    blockedReason: compressed.b,
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

export const POSITIONAL_AGENT_TEAM_TURN_FORMAT_INSTRUCTIONS = `
Return ONLY compressed JSON using this format:
  m = messages array
  f = proposed facts array
  q = resolved question ids
  n = next suggested role slugs
  d = done flag (1=yes, 0=no)
  b = blocked reason or null

Each message object:
  k = message kind code
  t = target role slug or "broadcast" or "orchestrator"
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

Allowed role slugs:
  architect, reviewer, code_reader, pr_creator, rca_analyst

Example with messages, facts, and follow-up:
{"m":[{"k":0,"t":"rca_analyst","s":"Prod confirmation","b":"Do Sentry traces show the Slack reply threading failure in production?","p":null,"r":[]},{"k":4,"t":"broadcast","s":"Likely fault line","b":"The strongest hypothesis is a null path in the reply resolver before parent-thread lookup.","p":null,"r":["msg_architect_1"]}],"f":[{"s":"The report centers on Slack reply threading, not message delivery.","c":0.88,"r":["msg_architect_1"]}],"q":[],"n":["rca_analyst"],"d":0,"b":null}

Minimal example with no follow-up:
{"m":[{"k":8,"t":"pr_creator","s":"Approved to draft PR","b":"Evidence is sufficient if the PR includes regression coverage for canonical and alias thread paths.","p":"msg_review_4","r":["msg_review_4","msg_code_7"]}],"f":[],"q":["question_2"],"n":["pr_creator"],"d":1,"b":null}`;
