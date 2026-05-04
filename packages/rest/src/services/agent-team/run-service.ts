import { prisma } from "@shared/database";
import type { WorkflowDispatcher } from "@shared/rest/temporal-dispatcher";
import {
  AGENT_PROVIDER,
  AGENT_TEAM_CONFIG,
  AGENT_TEAM_ROLE_SLUG,
  AGENT_TEAM_RUN_STATUS,
  type AgentTeamConfig,
  type AgentTeamRole,
  type AgentTeamRunSummary,
  type AgentTeamSnapshot,
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
  teamConfig?: AgentTeamConfig;
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
  const teamConfig = parsed.teamConfig ?? AGENT_TEAM_CONFIG.FAST;

  // Dedupe: a queued or running run for this (workspace, conversation) wins.
  // Mirrors the GATHERING_CONTEXT|ANALYZING dedupe in supportAnalysis. Race on
  // two near-simultaneous calls is a sub-100ms window — accept rare double-runs.
  const inFlight = await prisma.agentTeamRun.findFirst({
    where: {
      workspaceId: input.workspaceId,
      conversationId: parsed.conversationId,
      status: { in: [AGENT_TEAM_RUN_STATUS.queued, AGENT_TEAM_RUN_STATUS.running] },
    },
    include: runInclude,
    orderBy: { createdAt: "desc" },
  });
  if (inFlight) {
    return mapRun(inFlight);
  }

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

  // teamConfig drives which roles are seeded for this run. The team in the DB
  // is the workspace's blueprint (typically all roles). For FAST runs we
  // synthesize a single-drafter snapshot regardless of blueprint, so existing
  // workspaces don't need a teams-table migration to start using the FAST path.
  const teamSnapshot = buildTeamSnapshotForConfig({
    teamId: team.id,
    teamConfig,
    teamRoles: team.roles,
    teamEdges: team.edges,
  });

  const created = await prisma.agentTeamRun.create({
    data: {
      workspaceId: input.workspaceId,
      teamId: team.id,
      conversationId: conversation.id,
      analysisId: parsed.analysisId ?? null,
      teamConfig,
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
    teamConfig,
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
    // Customer email is required by ThreadSnapshot.strict() for the FAST drafter
    // delegation. We don't currently track customer email at this layer; null
    // is the honest answer until support-conversation surfaces it.
    customer: { email: null },
    events: conversation.events.map((event) => ({
      type: event.eventType,
      source: event.eventSource,
      summary: event.summary,
      details: event.detailsJson as Record<string, unknown> | null,
      at: event.createdAt.toISOString(),
    })),
  };
}

// Build the snapshot of roles + edges for this run based on teamConfig.
// FAST: single synthetic drafter (replaces the legacy single-agent analysis).
// STANDARD: drafter + reviewer (drafts go through a review gate before exposure).
// DEEP: all roles from the workspace's team blueprint (full multi-agent).
function buildTeamSnapshotForConfig(args: {
  teamId: string;
  teamConfig: AgentTeamConfig;
  teamRoles: Array<{
    id: string;
    teamId: string;
    roleKey: string;
    slug: string;
    label: string;
    description: string | null;
    provider: string;
    model: string | null;
    toolIds: string[];
    systemPromptOverride: string | null;
    maxSteps: number;
    sortOrder: number;
    metadata: unknown;
  }>;
  teamEdges: Array<{
    id: string;
    teamId: string;
    sourceRoleId: string;
    targetRoleId: string;
    condition: string | null;
    sortOrder: number;
  }>;
}): AgentTeamSnapshot {
  if (args.teamConfig === AGENT_TEAM_CONFIG.DEEP) {
    return agentTeamSnapshotSchema.parse({
      roles: args.teamRoles,
      edges: args.teamEdges,
    });
  }

  const drafter = synthesizeDrafterRole(args.teamId);
  if (args.teamConfig === AGENT_TEAM_CONFIG.FAST) {
    return agentTeamSnapshotSchema.parse({ roles: [drafter], edges: [] });
  }

  // STANDARD: drafter + first reviewer if the blueprint has one.
  const reviewerRow = args.teamRoles.find((role) => role.slug === AGENT_TEAM_ROLE_SLUG.reviewer);
  if (!reviewerRow) {
    return agentTeamSnapshotSchema.parse({ roles: [drafter], edges: [] });
  }
  return agentTeamSnapshotSchema.parse({ roles: [drafter, reviewerRow], edges: [] });
}

function synthesizeDrafterRole(teamId: string): AgentTeamRole {
  return {
    id: `${teamId}-synthetic-drafter`,
    teamId,
    roleKey: AGENT_TEAM_ROLE_SLUG.drafter,
    slug: AGENT_TEAM_ROLE_SLUG.drafter,
    label: "Drafter",
    description: null,
    provider: AGENT_PROVIDER.openai,
    model: null,
    toolIds: [],
    systemPromptOverride: null,
    maxSteps: 6,
    sortOrder: 0,
    metadata: null,
  };
}

function mapRun(run: {
  id: string;
  workspaceId: string;
  teamId: string;
  conversationId: string | null;
  analysisId: string | null;
  teamConfig: string;
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
    teamConfig: run.teamConfig,
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
