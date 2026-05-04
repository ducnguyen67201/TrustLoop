import { prisma } from "@shared/database";
import {
  AGENT_TEAM_MESSAGE_KIND,
  AGENT_TEAM_ROLE_SLUG,
  AGENT_TEAM_RUN_STATUS,
  ValidationError,
} from "@shared/types";
import { z } from "zod";

// Status values mirror the legacy SUPPORT_ANALYSIS_STATUS so analysis-panel.tsx
// can render the same gather/analyze/ready/failed states without a migration.
export const DRAFT_PROJECTION_STATUS = {
  GATHERING_CONTEXT: "GATHERING_CONTEXT",
  ANALYZING: "ANALYZING",
  READY: "READY",
  FAILED: "FAILED",
} as const;

export const draftProjectionStatusSchema = z.enum([
  DRAFT_PROJECTION_STATUS.GATHERING_CONTEXT,
  DRAFT_PROJECTION_STATUS.ANALYZING,
  DRAFT_PROJECTION_STATUS.READY,
  DRAFT_PROJECTION_STATUS.FAILED,
]);

export type DraftProjectionStatus = z.infer<typeof draftProjectionStatusSchema>;

export interface DraftProjection {
  id: string;
  conversationId: string;
  status: DraftProjectionStatus;
  insights: Array<{ text: string }>;
  draftBody: string | null;
  references: Array<{ url: string; title?: string }>;
  errorMessage: string | null;
  createdAt: string;
}

export async function projectFromRun(runId: string): Promise<DraftProjection | null> {
  const run = await prisma.agentTeamRun.findUnique({
    where: { id: runId },
    select: {
      id: true,
      conversationId: true,
      status: true,
      errorMessage: true,
      createdAt: true,
      messages: {
        select: {
          fromRoleSlug: true,
          kind: true,
          subject: true,
          content: true,
          refs: true,
          createdAt: true,
        },
        orderBy: { createdAt: "asc" },
      },
      facts: {
        select: { statement: true },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!run || !run.conversationId) {
    return null;
  }

  return buildProjection(run);
}

export async function getLatestProjectionForConversation(
  workspaceId: string,
  conversationId: string
): Promise<DraftProjection | null> {
  if (!workspaceId || !conversationId) {
    throw new ValidationError("workspaceId and conversationId are required");
  }

  const run = await prisma.agentTeamRun.findFirst({
    where: { workspaceId, conversationId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      conversationId: true,
      status: true,
      errorMessage: true,
      createdAt: true,
      messages: {
        select: {
          fromRoleSlug: true,
          kind: true,
          subject: true,
          content: true,
          refs: true,
          createdAt: true,
        },
        orderBy: { createdAt: "asc" },
      },
      facts: {
        select: { statement: true },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  return run?.conversationId ? buildProjection(run) : null;
}

function buildProjection(run: {
  id: string;
  conversationId: string | null;
  status: string;
  errorMessage: string | null;
  createdAt: Date;
  messages: Array<{
    fromRoleSlug: string;
    kind: string;
    subject: string;
    content: string;
    refs: unknown;
    createdAt: Date;
  }>;
  facts: Array<{ statement: string }>;
}): DraftProjection {
  const drafterProposal = run.messages.find(
    (msg) =>
      msg.fromRoleSlug === AGENT_TEAM_ROLE_SLUG.drafter &&
      msg.kind === AGENT_TEAM_MESSAGE_KIND.proposal
  );

  return {
    id: run.id,
    conversationId: run.conversationId ?? "",
    status: mapRunStatusToProjectionStatus(run.status),
    insights: run.facts.map((fact) => ({ text: fact.statement })),
    draftBody: drafterProposal?.content ?? null,
    references: extractReferences(drafterProposal?.refs),
    errorMessage: run.errorMessage,
    createdAt: run.createdAt.toISOString(),
  };
}

function mapRunStatusToProjectionStatus(status: string): DraftProjectionStatus {
  switch (status) {
    case AGENT_TEAM_RUN_STATUS.queued:
      return DRAFT_PROJECTION_STATUS.GATHERING_CONTEXT;
    case AGENT_TEAM_RUN_STATUS.running:
      return DRAFT_PROJECTION_STATUS.ANALYZING;
    case AGENT_TEAM_RUN_STATUS.completed:
    case AGENT_TEAM_RUN_STATUS.waiting:
      return DRAFT_PROJECTION_STATUS.READY;
    case AGENT_TEAM_RUN_STATUS.failed:
      return DRAFT_PROJECTION_STATUS.FAILED;
    default:
      return DRAFT_PROJECTION_STATUS.GATHERING_CONTEXT;
  }
}

function extractReferences(refs: unknown): Array<{ url: string; title?: string }> {
  if (!Array.isArray(refs)) return [];
  return refs.filter((ref): ref is string => typeof ref === "string").map((url) => ({ url }));
}
