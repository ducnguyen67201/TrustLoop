import {
  MAX_AGENT_TEAM_MESSAGES,
  assertValidMessageRouting,
  collectQueuedTargets,
  selectInitialRole,
  shouldCreateOpenQuestion,
} from "@/domains/agent-team/agent-team-run-routing";
import { type Prisma, prisma } from "@shared/database";
import { env } from "@shared/env";
import {
  AGENT_TEAM_FACT_STATUS,
  AGENT_TEAM_MESSAGE_KIND,
  AGENT_TEAM_OPEN_QUESTION_STATUS,
  AGENT_TEAM_ROLE_INBOX_STATE,
  AGENT_TEAM_ROLE_SLUG,
  AGENT_TEAM_RUN_STATUS,
  AGENT_TEAM_TARGET,
  type AgentTeamDialogueMessage,
  type AgentTeamDialogueMessageDraft,
  type AgentTeamFact,
  type AgentTeamOpenQuestion,
  type AgentTeamRole,
  type AgentTeamRoleInbox,
  type AgentTeamRoleSlug,
  type AgentTeamRoleTurnInput,
  type AgentTeamRoleTurnOutput,
  type AgentTeamRunWorkflowInput,
  agentTeamDialogueMessageSchema,
  agentTeamFactSchema,
  agentTeamOpenQuestionSchema,
  agentTeamRoleInboxSchema,
  agentTeamRoleSlugSchema,
  agentTeamRoleTurnInputSchema,
  agentTeamRoleTurnOutputSchema,
} from "@shared/types";
import { heartbeat } from "@temporalio/activity";

interface ClaimNextQueuedInboxResult {
  roleSlug: AgentTeamRoleSlug;
}

interface TurnContextPayload {
  inbox: AgentTeamDialogueMessage[];
  acceptedFacts: AgentTeamFact[];
  openQuestions: AgentTeamOpenQuestion[];
  recentThread: AgentTeamDialogueMessage[];
}

interface PersistRoleTurnResultInput {
  runId: string;
  role: AgentTeamRole;
  result: AgentTeamRoleTurnOutput;
}

interface RunProgressSnapshot {
  messageCount: number;
  completedRoleSlugs: AgentTeamRoleSlug[];
  queuedInboxCount: number;
  blockedInboxCount: number;
  openQuestionCount: number;
}

interface MessageCountClient {
  agentTeamMessage: {
    count: typeof prisma.agentTeamMessage.count;
  };
}

interface RunProgressClient extends MessageCountClient {
  agentTeamRoleInbox: {
    findMany: typeof prisma.agentTeamRoleInbox.findMany;
  };
  agentTeamOpenQuestion: {
    count: typeof prisma.agentTeamOpenQuestion.count;
  };
}

const AGENT_TIMEOUT_MS = 4 * 60 * 1000;
const RECENT_THREAD_LIMIT = 12;

export async function initializeRunState(
  input: Pick<AgentTeamRunWorkflowInput, "runId" | "teamSnapshot">
): Promise<ClaimNextQueuedInboxResult> {
  const initialRole = selectInitialRole(input.teamSnapshot);

  await prisma.$transaction(async (tx) => {
    await tx.agentTeamRun.update({
      where: { id: input.runId },
      data: {
        status: AGENT_TEAM_RUN_STATUS.running,
        startedAt: new Date(),
        completedAt: null,
        errorMessage: null,
      },
    });

    await tx.agentTeamRoleInbox.createMany({
      data: input.teamSnapshot.roles.map((role) => ({
        runId: input.runId,
        roleSlug: role.slug,
        state:
          role.slug === initialRole.slug
            ? AGENT_TEAM_ROLE_INBOX_STATE.queued
            : AGENT_TEAM_ROLE_INBOX_STATE.idle,
        wakeReason: role.slug === initialRole.slug ? "initial-seed" : null,
        unreadCount: 0,
      })),
      skipDuplicates: true,
    });

    await tx.agentTeamRoleInbox.update({
      where: {
        runId_roleSlug: {
          runId: input.runId,
          roleSlug: initialRole.slug,
        },
      },
      data: {
        state: AGENT_TEAM_ROLE_INBOX_STATE.queued,
        wakeReason: "initial-seed",
        unreadCount: 0,
      },
    });
  });

  return { roleSlug: initialRole.slug };
}

export async function claimNextQueuedInbox(
  runId: string
): Promise<ClaimNextQueuedInboxResult | null> {
  heartbeat();

  for (;;) {
    const nextInbox = await prisma.agentTeamRoleInbox.findFirst({
      where: {
        runId,
        state: AGENT_TEAM_ROLE_INBOX_STATE.queued,
      },
      orderBy: [{ updatedAt: "asc" }, { roleSlug: "asc" }],
    });

    if (!nextInbox) {
      return null;
    }

    const claimed = await prisma.agentTeamRoleInbox.updateMany({
      where: {
        id: nextInbox.id,
        state: AGENT_TEAM_ROLE_INBOX_STATE.queued,
      },
      data: {
        state: AGENT_TEAM_ROLE_INBOX_STATE.running,
        lastWokenAt: new Date(),
      },
    });

    if (claimed.count === 1) {
      return {
        roleSlug: agentTeamRoleSlugSchema.parse(nextInbox.roleSlug),
      };
    }
  }
}

export async function loadTurnContext(
  input: Pick<AgentTeamRoleTurnInput, "runId"> & { roleSlug: AgentTeamRoleSlug }
): Promise<TurnContextPayload> {
  heartbeat();

  const [inboxRows, factRows, questionRows, recentThreadRows] = await Promise.all([
    prisma.agentTeamMessage.findMany({
      where: {
        runId: input.runId,
        OR: [{ toRoleSlug: input.roleSlug }, { toRoleSlug: AGENT_TEAM_TARGET.broadcast }],
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.agentTeamFact.findMany({
      where: {
        runId: input.runId,
        status: AGENT_TEAM_FACT_STATUS.accepted,
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.agentTeamOpenQuestion.findMany({
      where: {
        runId: input.runId,
        ownerRoleSlug: input.roleSlug,
        status: AGENT_TEAM_OPEN_QUESTION_STATUS.open,
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.agentTeamMessage.findMany({
      where: { runId: input.runId },
      orderBy: { createdAt: "desc" },
      take: RECENT_THREAD_LIMIT,
    }),
  ]);

  return {
    inbox: inboxRows.map(mapMessageRow),
    acceptedFacts: factRows.map(mapFactRow),
    openQuestions: questionRows.map(mapOpenQuestionRow),
    recentThread: recentThreadRows.reverse().map(mapMessageRow),
  };
}

export async function runTeamTurnActivity(
  input: AgentTeamRoleTurnInput
): Promise<AgentTeamRoleTurnOutput> {
  heartbeat();

  const response = await fetch(`${resolveAgentServiceUrl()}/team-turn`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(AGENT_TIMEOUT_MS),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `Agent team turn failed for ${input.role.slug}: ${response.status} ${errorBody.slice(0, 400)}`
    );
  }

  const parsed = agentTeamRoleTurnOutputSchema.parse(await response.json());
  heartbeat();

  return parsed;
}

export async function persistRoleTurnResult(
  input: PersistRoleTurnResultInput
): Promise<RunProgressSnapshot> {
  heartbeat();

  const normalizedMessages = normalizeTurnMessages(input.role, input.result);
  assertValidMessageRouting({
    senderRoleSlug: input.role.slug,
    messages: normalizedMessages,
  });

  return prisma.$transaction(async (tx) => {
    const messageCount = await tx.agentTeamMessage.count({
      where: { runId: input.runId },
    });
    if (messageCount + normalizedMessages.length > MAX_AGENT_TEAM_MESSAGES) {
      throw new Error(
        `Agent team run exceeded the ${MAX_AGENT_TEAM_MESSAGES} message budget for run ${input.runId}`
      );
    }

    const createdMessages: AgentTeamDialogueMessage[] = [];
    for (const message of normalizedMessages) {
      const created = await tx.agentTeamMessage.create({
        data: {
          runId: input.runId,
          threadId: message.parentMessageId ?? `thread:${input.role.slug}`,
          fromRoleSlug: input.role.slug,
          fromRoleLabel: input.role.label,
          toRoleSlug: message.toRoleSlug,
          kind: message.kind,
          subject: message.subject,
          content: message.content,
          parentMessageId: message.parentMessageId ?? null,
          refs: message.refs,
          toolName: message.toolName ?? null,
          metadata: toNullableJsonValue(message.metadata),
        },
      });
      createdMessages.push(mapMessageRow(created));
    }

    for (const fact of input.result.proposedFacts) {
      await tx.agentTeamFact.create({
        data: {
          runId: input.runId,
          statement: fact.statement,
          confidence: fact.confidence,
          sourceMessageIds: fact.sourceMessageIds,
          acceptedBy: fact.confidence >= 0.75 ? [input.role.slug] : [],
          status:
            fact.confidence >= 0.75
              ? AGENT_TEAM_FACT_STATUS.accepted
              : AGENT_TEAM_FACT_STATUS.proposed,
        },
      });
    }

    if (input.result.resolvedQuestionIds.length > 0) {
      await tx.agentTeamOpenQuestion.updateMany({
        where: {
          runId: input.runId,
          id: { in: input.result.resolvedQuestionIds },
        },
        data: {
          status: AGENT_TEAM_OPEN_QUESTION_STATUS.answered,
        },
      });
    }

    const openQuestionsToCreate = createdMessages
      .filter((message) => shouldCreateOpenQuestion(message.kind))
      .map((message) => buildOpenQuestionRow(message, input.role.slug));

    if (openQuestionsToCreate.length > 0) {
      await tx.agentTeamOpenQuestion.createMany({
        data: openQuestionsToCreate,
      });
    }

    const hasReviewerApproval = await reviewerApprovalExists(tx, input.runId, createdMessages);
    const queueTargets = collectQueuedTargets({
      senderRoleSlug: input.role.slug,
      messages: normalizedMessages,
      nextSuggestedRoles: input.result.nextSuggestedRoles,
      hasReviewerApproval,
    });

    for (const roleSlug of queueTargets) {
      const wakeReason = buildWakeReason(input.role.slug, normalizedMessages);
      await tx.agentTeamRoleInbox.upsert({
        where: {
          runId_roleSlug: {
            runId: input.runId,
            roleSlug,
          },
        },
        create: {
          runId: input.runId,
          roleSlug,
          state: AGENT_TEAM_ROLE_INBOX_STATE.queued,
          unreadCount: 1,
          wakeReason,
        },
        update: {
          state: AGENT_TEAM_ROLE_INBOX_STATE.queued,
          unreadCount: { increment: 1 },
          wakeReason,
        },
      });
    }

    await tx.agentTeamRoleInbox.update({
      where: {
        runId_roleSlug: {
          runId: input.runId,
          roleSlug: input.role.slug,
        },
      },
      data: {
        state: input.result.done
          ? AGENT_TEAM_ROLE_INBOX_STATE.done
          : input.result.blockedReason
            ? AGENT_TEAM_ROLE_INBOX_STATE.blocked
            : AGENT_TEAM_ROLE_INBOX_STATE.idle,
        lastReadMessageId: createdMessages.at(-1)?.id ?? null,
        unreadCount: 0,
        wakeReason: input.result.blockedReason ?? null,
      },
    });

    return getRunProgressSnapshot(tx, input.runId);
  });
}

export async function getRunProgress(runId: string): Promise<RunProgressSnapshot> {
  return getRunProgressSnapshot(prisma, runId);
}

export async function markRunCompleted(runId: string): Promise<void> {
  await prisma.agentTeamRun.update({
    where: { id: runId },
    data: {
      status: AGENT_TEAM_RUN_STATUS.completed,
      completedAt: new Date(),
      errorMessage: null,
    },
  });
}

export async function markRunWaiting(runId: string): Promise<void> {
  await prisma.agentTeamRun.update({
    where: { id: runId },
    data: {
      status: AGENT_TEAM_RUN_STATUS.waiting,
      completedAt: null,
    },
  });
}

export async function markRunFailed(input: { runId: string; errorMessage: string }): Promise<void> {
  await prisma.agentTeamRun.update({
    where: { id: input.runId },
    data: {
      status: AGENT_TEAM_RUN_STATUS.failed,
      completedAt: new Date(),
      errorMessage: input.errorMessage,
    },
  });
}

function normalizeTurnMessages(
  role: AgentTeamRole,
  result: AgentTeamRoleTurnOutput
): AgentTeamDialogueMessageDraft[] {
  const messages = [...result.messages];
  const alreadyBlocked = messages.some(
    (message) => message.kind === AGENT_TEAM_MESSAGE_KIND.blocked
  );

  if (result.blockedReason && !alreadyBlocked) {
    messages.push({
      toRoleSlug:
        role.slug === AGENT_TEAM_ROLE_SLUG.architect
          ? AGENT_TEAM_TARGET.orchestrator
          : AGENT_TEAM_ROLE_SLUG.architect,
      kind: AGENT_TEAM_MESSAGE_KIND.blocked,
      subject: `${role.label} blocked`,
      content: result.blockedReason,
      refs: [],
    });
  }

  return messages;
}

function buildOpenQuestionRow(
  message: AgentTeamDialogueMessage,
  askedByRoleSlug: AgentTeamRoleSlug
) {
  const ownerRoleSlug =
    message.toRoleSlug === AGENT_TEAM_TARGET.orchestrator
      ? AGENT_TEAM_ROLE_SLUG.architect
      : agentTeamRoleSlugSchema.parse(message.toRoleSlug);

  return {
    runId: message.runId,
    askedByRoleSlug,
    ownerRoleSlug,
    question: message.content,
    blockingRoles:
      message.kind === AGENT_TEAM_MESSAGE_KIND.blocked ? [askedByRoleSlug] : [ownerRoleSlug],
    status: AGENT_TEAM_OPEN_QUESTION_STATUS.open,
    sourceMessageId: message.id,
  };
}

async function reviewerApprovalExists(
  tx: MessageCountClient,
  runId: string,
  createdMessages: AgentTeamDialogueMessage[]
): Promise<boolean> {
  if (
    createdMessages.some(
      (message) =>
        message.fromRoleSlug === AGENT_TEAM_ROLE_SLUG.reviewer &&
        message.kind === AGENT_TEAM_MESSAGE_KIND.approval
    )
  ) {
    return true;
  }

  const approvalCount = await tx.agentTeamMessage.count({
    where: {
      runId,
      fromRoleSlug: AGENT_TEAM_ROLE_SLUG.reviewer,
      kind: AGENT_TEAM_MESSAGE_KIND.approval,
    },
  });

  return approvalCount > 0;
}

async function getRunProgressSnapshot(
  client: RunProgressClient,
  runId: string
): Promise<RunProgressSnapshot> {
  const [messageCount, inboxRows, openQuestionCount] = await Promise.all([
    client.agentTeamMessage.count({ where: { runId } }),
    client.agentTeamRoleInbox.findMany({ where: { runId } }),
    client.agentTeamOpenQuestion.count({
      where: {
        runId,
        status: AGENT_TEAM_OPEN_QUESTION_STATUS.open,
      },
    }),
  ]);

  const parsedInboxes = inboxRows.map((row) =>
    agentTeamRoleInboxSchema.parse({
      id: row.id,
      runId: row.runId,
      roleSlug: row.roleSlug,
      state: row.state,
      lastReadMessageId: row.lastReadMessageId,
      wakeReason: row.wakeReason,
      unreadCount: row.unreadCount,
      lastWokenAt: row.lastWokenAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    })
  );

  return {
    messageCount,
    completedRoleSlugs: parsedInboxes
      .filter((inbox) => inbox.state === AGENT_TEAM_ROLE_INBOX_STATE.done)
      .map((inbox) => inbox.roleSlug),
    queuedInboxCount: parsedInboxes.filter(
      (inbox) => inbox.state === AGENT_TEAM_ROLE_INBOX_STATE.queued
    ).length,
    blockedInboxCount: parsedInboxes.filter(
      (inbox) => inbox.state === AGENT_TEAM_ROLE_INBOX_STATE.blocked
    ).length,
    openQuestionCount,
  };
}

function buildWakeReason(
  senderRoleSlug: AgentTeamRoleSlug,
  messages: AgentTeamDialogueMessageDraft[]
): string {
  const [firstMessage] = messages;
  if (!firstMessage) {
    return `follow-up requested by ${senderRoleSlug}`;
  }

  return `${senderRoleSlug}:${firstMessage.kind}:${firstMessage.subject}`;
}

function mapMessageRow(row: {
  id: string;
  runId: string;
  threadId: string;
  fromRoleSlug: string;
  fromRoleLabel: string;
  toRoleSlug: string;
  kind: string;
  subject: string;
  content: string;
  parentMessageId: string | null;
  refs: Prisma.JsonValue | null;
  toolName: string | null;
  metadata: Prisma.JsonValue | null;
  createdAt: Date;
}): AgentTeamDialogueMessage {
  return agentTeamDialogueMessageSchema.parse({
    id: row.id,
    runId: row.runId,
    threadId: row.threadId,
    fromRoleSlug: row.fromRoleSlug,
    fromRoleLabel: row.fromRoleLabel,
    toRoleSlug: row.toRoleSlug,
    kind: row.kind,
    subject: row.subject,
    content: row.content,
    parentMessageId: row.parentMessageId,
    refs: parseJsonStringArray(row.refs),
    toolName: row.toolName,
    metadata: parseJsonRecord(row.metadata),
    createdAt: row.createdAt.toISOString(),
  });
}

function mapFactRow(row: {
  id: string;
  runId: string;
  statement: string;
  confidence: number;
  sourceMessageIds: Prisma.JsonValue;
  acceptedBy: Prisma.JsonValue;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}): AgentTeamFact {
  return agentTeamFactSchema.parse({
    id: row.id,
    runId: row.runId,
    statement: row.statement,
    confidence: row.confidence,
    sourceMessageIds: parseJsonStringArray(row.sourceMessageIds),
    acceptedBy: parseJsonRoleSlugArray(row.acceptedBy),
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

function mapOpenQuestionRow(row: {
  id: string;
  runId: string;
  askedByRoleSlug: string;
  ownerRoleSlug: string;
  question: string;
  blockingRoles: Prisma.JsonValue;
  status: string;
  sourceMessageId: string;
  createdAt: Date;
  updatedAt: Date;
}): AgentTeamOpenQuestion {
  return agentTeamOpenQuestionSchema.parse({
    id: row.id,
    runId: row.runId,
    askedByRoleSlug: row.askedByRoleSlug,
    ownerRoleSlug: row.ownerRoleSlug,
    question: row.question,
    blockingRoles: parseJsonRoleSlugArray(row.blockingRoles),
    status: row.status,
    sourceMessageId: row.sourceMessageId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

function parseJsonStringArray(value: Prisma.JsonValue | null): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function parseJsonRoleSlugArray(value: Prisma.JsonValue | null): AgentTeamRoleSlug[] {
  return parseJsonStringArray(value).map((item) => agentTeamRoleSlugSchema.parse(item));
}

function parseJsonRecord(value: Prisma.JsonValue | null): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function toNullableJsonValue(
  value: Record<string, unknown> | null | undefined
): Prisma.InputJsonValue | undefined {
  if (!value) {
    return undefined;
  }

  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function resolveAgentServiceUrl(): string {
  return env.AGENT_SERVICE_URL ?? "http://localhost:3100";
}
