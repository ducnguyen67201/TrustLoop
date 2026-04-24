import { prisma } from "@shared/database";
import type { WorkflowDispatcher } from "@shared/rest/temporal-dispatcher";
import {
  AGENT_TEAM_RUN_STATUS,
  type AgentTeamRunSummary,
  ValidationError,
  agentTeamRunSummarySchema,
  agentTeamSnapshotSchema,
  getAgentTeamRunInputSchema,
  getLatestAgentTeamRunInputSchema,
  startAgentTeamRunInputSchema,
} from "@shared/types";

interface StartRunArgs {
  workspaceId: string;
  conversationId: string;
  teamId?: string;
  analysisId?: string;
}

interface GetRunArgs {
  workspaceId: string;
  runId: string;
}

interface GetLatestRunArgs {
  workspaceId: string;
  conversationId: string;
}

export async function start(
  input: StartRunArgs,
  dispatcher: WorkflowDispatcher
): Promise<AgentTeamRunSummary> {
  const parsed = startAgentTeamRunInputSchema.parse(input);
  const team = await findTeam(input.workspaceId, parsed.teamId);
  const conversation = await prisma.supportConversation.findUnique({
    where: { id: parsed.conversationId },
    select: {
      id: true,
      channelId: true,
      threadTs: true,
      status: true,
      events: {
        orderBy: { createdAt: "asc" },
        select: {
          eventType: true,
          eventSource: true,
          summary: true,
          detailsJson: true,
          createdAt: true,
        },
      },
    },
  });

  if (!conversation || !team) {
    throw new ValidationError("A default agent team and support conversation are required");
  }

  const teamSnapshot = agentTeamSnapshotSchema.parse({
    roles: team.roles,
    edges: team.edges,
  });

  const created = await prisma.agentTeamRun.create({
    data: {
      workspaceId: input.workspaceId,
      teamId: team.id,
      conversationId: conversation.id,
      analysisId: parsed.analysisId ?? null,
      status: AGENT_TEAM_RUN_STATUS.queued,
      teamSnapshot: JSON.parse(JSON.stringify(teamSnapshot)),
    },
    include: runInclude,
  });

  const dispatch = await dispatcher.startAgentTeamRunWorkflow({
    workspaceId: input.workspaceId,
    runId: created.id,
    teamId: team.id,
    conversationId: conversation.id,
    analysisId: parsed.analysisId,
    teamSnapshot,
    threadSnapshot: JSON.stringify(buildConversationSnapshot(conversation), null, 2),
  });

  const updated = await prisma.agentTeamRun.update({
    where: { id: created.id },
    data: {
      workflowId: dispatch.workflowId,
    },
    include: runInclude,
  });

  return mapRun(updated);
}

export async function getRun(input: GetRunArgs): Promise<AgentTeamRunSummary> {
  const parsed = getAgentTeamRunInputSchema.parse(input);
  const run = await prisma.agentTeamRun.findFirst({
    where: {
      id: parsed.runId,
      workspaceId: input.workspaceId,
    },
    include: runInclude,
  });

  if (!run) {
    throw new ValidationError("Agent team run not found");
  }

  return mapRun(run);
}

export async function getLatestRunForConversation(
  input: GetLatestRunArgs
): Promise<AgentTeamRunSummary | null> {
  const parsed = getLatestAgentTeamRunInputSchema.parse(input);
  const run = await prisma.agentTeamRun.findFirst({
    where: {
      workspaceId: input.workspaceId,
      conversationId: parsed.conversationId,
    },
    orderBy: { createdAt: "desc" },
    include: runInclude,
  });

  return run ? mapRun(run) : null;
}

async function findTeam(workspaceId: string, teamId?: string) {
  return prisma.agentTeam.findFirst({
    where: {
      workspaceId,
      deletedAt: null,
      ...(teamId ? { id: teamId } : { isDefault: true }),
    },
    include: {
      roles: {
        orderBy: { sortOrder: "asc" },
      },
      edges: {
        orderBy: { sortOrder: "asc" },
      },
    },
  });
}

const runInclude = {
  messages: {
    orderBy: { createdAt: "asc" },
  },
  roleInboxes: {
    orderBy: { createdAt: "asc" },
  },
  facts: {
    orderBy: { createdAt: "asc" },
  },
  openQuestions: {
    orderBy: { createdAt: "asc" },
  },
} as const;

function buildConversationSnapshot(conversation: {
  id: string;
  channelId: string;
  threadTs: string;
  status: string;
  events: Array<{
    eventType: string;
    eventSource: string;
    summary: string | null;
    detailsJson: unknown;
    createdAt: Date;
  }>;
}) {
  return {
    conversationId: conversation.id,
    channelId: conversation.channelId,
    threadTs: conversation.threadTs,
    status: conversation.status,
    events: conversation.events.map((event) => ({
      type: event.eventType,
      source: event.eventSource,
      summary: event.summary,
      details: event.detailsJson as Record<string, unknown> | null,
      at: event.createdAt.toISOString(),
    })),
  };
}

function mapRun(run: {
  id: string;
  workspaceId: string;
  teamId: string;
  conversationId: string | null;
  analysisId: string | null;
  status: string;
  workflowId: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
  teamSnapshot: unknown;
  messages: Array<{
    id: string;
    runId: string;
    threadId: string;
    fromRoleKey: string;
    fromRoleSlug: string;
    fromRoleLabel: string;
    toRoleKey: string;
    kind: string;
    subject: string;
    content: string;
    parentMessageId: string | null;
    refs: unknown;
    toolName: string | null;
    metadata: unknown;
    createdAt: Date;
  }>;
  roleInboxes: Array<{
    id: string;
    runId: string;
    roleKey: string;
    state: string;
    lastReadMessageId: string | null;
    wakeReason: string | null;
    unreadCount: number;
    lastWokenAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }>;
  facts: Array<{
    id: string;
    runId: string;
    statement: string;
    confidence: number;
    sourceMessageIds: unknown;
    acceptedByRoleKeys: unknown;
    status: string;
    createdAt: Date;
    updatedAt: Date;
  }>;
  openQuestions: Array<{
    id: string;
    runId: string;
    askedByRoleKey: string;
    ownerRoleKey: string;
    question: string;
    blockingRoleKeys: unknown;
    status: string;
    sourceMessageId: string;
    createdAt: Date;
    updatedAt: Date;
  }>;
}): AgentTeamRunSummary {
  return agentTeamRunSummarySchema.parse({
    id: run.id,
    workspaceId: run.workspaceId,
    teamId: run.teamId,
    conversationId: run.conversationId,
    analysisId: run.analysisId,
    status: run.status,
    workflowId: run.workflowId,
    startedAt: run.startedAt?.toISOString() ?? null,
    completedAt: run.completedAt?.toISOString() ?? null,
    errorMessage: run.errorMessage,
    createdAt: run.createdAt.toISOString(),
    updatedAt: run.updatedAt.toISOString(),
    teamSnapshot: run.teamSnapshot,
    messages: run.messages.map((message) => ({
      id: message.id,
      runId: message.runId,
      threadId: message.threadId,
      fromRoleKey: message.fromRoleKey,
      fromRoleSlug: message.fromRoleSlug,
      fromRoleLabel: message.fromRoleLabel,
      toRoleKey: message.toRoleKey,
      kind: message.kind,
      subject: message.subject,
      content: message.content,
      parentMessageId: message.parentMessageId,
      refs: Array.isArray(message.refs)
        ? message.refs.filter((value): value is string => typeof value === "string")
        : [],
      toolName: message.toolName,
      metadata: (message.metadata ?? null) as Record<string, unknown> | null,
      createdAt: message.createdAt.toISOString(),
    })),
    roleInboxes: run.roleInboxes.map((inbox) => ({
      id: inbox.id,
      runId: inbox.runId,
      roleKey: inbox.roleKey,
      state: inbox.state,
      lastReadMessageId: inbox.lastReadMessageId,
      wakeReason: inbox.wakeReason,
      unreadCount: inbox.unreadCount,
      lastWokenAt: inbox.lastWokenAt?.toISOString() ?? null,
      createdAt: inbox.createdAt.toISOString(),
      updatedAt: inbox.updatedAt.toISOString(),
    })),
    facts: run.facts.map((fact) => ({
      id: fact.id,
      runId: fact.runId,
      statement: fact.statement,
      confidence: fact.confidence,
      sourceMessageIds: Array.isArray(fact.sourceMessageIds)
        ? fact.sourceMessageIds.filter((value): value is string => typeof value === "string")
        : [],
      acceptedByRoleKeys: Array.isArray(fact.acceptedByRoleKeys)
        ? fact.acceptedByRoleKeys.filter((value): value is string => typeof value === "string")
        : [],
      status: fact.status,
      createdAt: fact.createdAt.toISOString(),
      updatedAt: fact.updatedAt.toISOString(),
    })),
    openQuestions: run.openQuestions.map((question) => ({
      id: question.id,
      runId: question.runId,
      askedByRoleKey: question.askedByRoleKey,
      ownerRoleKey: question.ownerRoleKey,
      question: question.question,
      blockingRoleKeys: Array.isArray(question.blockingRoleKeys)
        ? question.blockingRoleKeys.filter((value): value is string => typeof value === "string")
        : [],
      status: question.status,
      sourceMessageId: question.sourceMessageId,
      createdAt: question.createdAt.toISOString(),
      updatedAt: question.updatedAt.toISOString(),
    })),
  });
}
