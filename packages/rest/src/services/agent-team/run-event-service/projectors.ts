import type { Prisma } from "@shared/database";
import type { prisma } from "@shared/database";
import {
  AGENT_TEAM_EVENT_KIND,
  AGENT_TEAM_FACT_STATUS,
  AGENT_TEAM_OPEN_QUESTION_STATUS,
  AGENT_TEAM_ROLE_INBOX_STATE,
  type AgentTeamRunEvent,
} from "@shared/types";

// Projection extra: fields that are too large to live in every event payload
// but MUST be persisted atomically alongside the event row. The activity
// supplies these when calling the projector inside the same $transaction.
export interface MessageProjectionExtra {
  fromRoleLabel: string;
  threadId: string;
  content: string;
  parentMessageId: string | null;
  refs: string[];
  toolName: string | null;
  metadata: Record<string, unknown> | null;
}

// Structural client usable both outside and inside $transaction. Matches the
// service-layer convention (no Prisma.TransactionClient in signatures).
export interface ProjectionClient {
  agentTeamMessage: {
    create: (args: {
      data: Prisma.AgentTeamMessageCreateInput;
    }) => Promise<Awaited<ReturnType<typeof prisma.agentTeamMessage.create>>>;
  };
  agentTeamFact: {
    create: (args: {
      data: Prisma.AgentTeamFactCreateInput;
    }) => Promise<Awaited<ReturnType<typeof prisma.agentTeamFact.create>>>;
  };
  agentTeamOpenQuestion: {
    create: (args: {
      data: Prisma.AgentTeamOpenQuestionCreateInput;
    }) => Promise<Awaited<ReturnType<typeof prisma.agentTeamOpenQuestion.create>>>;
  };
  agentTeamRoleInbox: {
    upsert: (args: {
      where: Prisma.AgentTeamRoleInboxWhereUniqueInput;
      update: Prisma.AgentTeamRoleInboxUpdateInput;
      create: Prisma.AgentTeamRoleInboxCreateInput;
    }) => Promise<Awaited<ReturnType<typeof prisma.agentTeamRoleInbox.upsert>>>;
  };
}

/**
 * Project a message_sent event into AgentTeamMessage. Caller supplies fields
 * that are too large or verbose to stuff into every event payload (full
 * content, thread id, refs array, metadata). Event + projection must share
 * the same $transaction; the caller owns that boundary.
 */
export async function projectMessage(
  client: ProjectionClient,
  event: AgentTeamRunEvent,
  extra: MessageProjectionExtra
): Promise<void> {
  if (event.kind !== AGENT_TEAM_EVENT_KIND.messageSent) {
    throw new Error(`projectMessage called with wrong event kind: ${event.kind}`);
  }
  if (!event.messageKind) {
    throw new Error("projectMessage requires event.messageKind to be set");
  }

  await client.agentTeamMessage.create({
    data: {
      run: { connect: { id: event.runId } },
      threadId: extra.threadId,
      fromRoleSlug: event.payload.fromRoleSlug,
      fromRoleLabel: extra.fromRoleLabel,
      toRoleSlug: event.payload.toRoleSlug,
      kind: event.messageKind,
      subject: event.payload.subject,
      content: extra.content,
      parent: extra.parentMessageId ? { connect: { id: extra.parentMessageId } } : undefined,
      refs: extra.refs as Prisma.InputJsonValue,
      toolName: extra.toolName,
      metadata: extra.metadata ? (extra.metadata as unknown as Prisma.InputJsonValue) : undefined,
    },
  });
}

/**
 * Project a fact_proposed event into AgentTeamFact. Confidence >= 0.75 enters
 * the accepted state immediately with the proposer logged in acceptedBy.
 * Below that, proposed and waiting for peer acceptance.
 */
export async function projectFact(
  client: ProjectionClient,
  event: AgentTeamRunEvent,
  extra: { sourceMessageIds: string[] }
): Promise<void> {
  if (event.kind !== AGENT_TEAM_EVENT_KIND.factProposed) {
    throw new Error(`projectFact called with wrong event kind: ${event.kind}`);
  }

  const proposerActor = typeof event.actor === "string" ? event.actor : "system";
  const accepted = event.payload.confidence >= 0.75;

  await client.agentTeamFact.create({
    data: {
      run: { connect: { id: event.runId } },
      statement: event.payload.statement,
      confidence: event.payload.confidence,
      sourceMessageIds: extra.sourceMessageIds as Prisma.InputJsonValue,
      acceptedBy: (accepted ? [proposerActor] : []) as Prisma.InputJsonValue,
      status: accepted ? AGENT_TEAM_FACT_STATUS.accepted : AGENT_TEAM_FACT_STATUS.proposed,
    },
  });
}

/**
 * Project a question_opened event into AgentTeamOpenQuestion. The asking role,
 * the owner, and the blocking set come from the event payload; sourceMessageId
 * ties the question back to the turn that raised it.
 */
export async function projectQuestion(
  client: ProjectionClient,
  event: AgentTeamRunEvent,
  extra: { sourceMessageId: string; blockingRoles: string[] }
): Promise<void> {
  if (event.kind !== AGENT_TEAM_EVENT_KIND.questionOpened) {
    throw new Error(`projectQuestion called with wrong event kind: ${event.kind}`);
  }

  const askedBy = typeof event.actor === "string" ? event.actor : "system";

  await client.agentTeamOpenQuestion.create({
    data: {
      run: { connect: { id: event.runId } },
      askedByRoleSlug: askedBy,
      ownerRoleSlug: event.payload.ownerRoleSlug,
      question: event.payload.question,
      blockingRoles: extra.blockingRoles as Prisma.InputJsonValue,
      status: AGENT_TEAM_OPEN_QUESTION_STATUS.open,
      sourceMessageId: extra.sourceMessageId,
    },
  });
}

/**
 * Project role state transitions (role_queued / role_started / role_blocked /
 * role_completed) into AgentTeamRoleInbox. Idempotent via upsert on
 * (runId, roleSlug) so re-delivered events from a retried activity are safe.
 */
export async function projectInboxTransition(
  client: ProjectionClient,
  event: AgentTeamRunEvent
): Promise<void> {
  const state = roleStateForEventKind(event.kind);
  if (!state) {
    throw new Error(`projectInboxTransition called with non-transition kind: ${event.kind}`);
  }
  if (
    event.kind !== AGENT_TEAM_EVENT_KIND.roleQueued &&
    event.kind !== AGENT_TEAM_EVENT_KIND.roleStarted &&
    event.kind !== AGENT_TEAM_EVENT_KIND.roleBlocked &&
    event.kind !== AGENT_TEAM_EVENT_KIND.roleCompleted
  ) {
    throw new Error("projectInboxTransition guard unreachable");
  }

  await client.agentTeamRoleInbox.upsert({
    where: {
      runId_roleSlug: { runId: event.runId, roleSlug: event.payload.roleSlug },
    },
    update: {
      state,
      wakeReason: event.payload.wakeReason ?? null,
      lastWokenAt: state === AGENT_TEAM_ROLE_INBOX_STATE.running ? event.ts : undefined,
    },
    create: {
      run: { connect: { id: event.runId } },
      roleSlug: event.payload.roleSlug,
      state,
      wakeReason: event.payload.wakeReason ?? null,
      lastWokenAt: state === AGENT_TEAM_ROLE_INBOX_STATE.running ? event.ts : null,
      unreadCount: 0,
    },
  });
}

function roleStateForEventKind(kind: AgentTeamRunEvent["kind"]): string | null {
  switch (kind) {
    case AGENT_TEAM_EVENT_KIND.roleQueued:
      return AGENT_TEAM_ROLE_INBOX_STATE.queued;
    case AGENT_TEAM_EVENT_KIND.roleStarted:
      return AGENT_TEAM_ROLE_INBOX_STATE.running;
    case AGENT_TEAM_EVENT_KIND.roleBlocked:
      return AGENT_TEAM_ROLE_INBOX_STATE.blocked;
    case AGENT_TEAM_EVENT_KIND.roleCompleted:
      return AGENT_TEAM_ROLE_INBOX_STATE.done;
    default:
      return null;
  }
}
