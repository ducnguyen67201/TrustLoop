import {
  MAX_AGENT_TEAM_MESSAGES,
  collectQueuedTargets,
  isHumanResolutionTarget,
  partitionMessagesByRouting,
  resolveSelfTurnState,
  selectInitialRole,
  shouldCreateOpenQuestion,
} from "@/domains/agent-team/agent-team-run-routing";
import { type Prisma, prisma } from "@shared/database";
import { env } from "@shared/env";
import {
  computeRunRollup,
  logRecordedEvents,
  recordEvent,
  recordEvents,
  serializeRunRollup,
} from "@shared/rest/services/agent-team/run-event-service";
import type { AgentTeamRunEventDraft } from "@shared/types";
import {
  AGENT_TEAM_EVENT_ACTOR_SYSTEM,
  AGENT_TEAM_EVENT_KIND,
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
  type AgentTeamRoleTurnInput,
  type AgentTeamRoleTurnOutput,
  type AgentTeamRunWorkflowInput,
  RESOLUTION_STATUS,
  RESOLUTION_TARGET,
  agentTeamDialogueMessageSchema,
  agentTeamFactSchema,
  agentTeamOpenQuestionSchema,
  agentTeamRoleInboxSchema,
  agentTeamRoleTurnInputSchema,
  agentTeamRoleTurnOutputSchema,
  restoreDraftContext,
  transitionDraft,
} from "@shared/types";
import { heartbeat } from "@temporalio/activity";

interface ClaimNextQueuedInboxResult {
  roleKey: string;
}

interface TurnContextPayload {
  inbox: AgentTeamDialogueMessage[];
  acceptedFacts: AgentTeamFact[];
  openQuestions: AgentTeamOpenQuestion[];
  recentThread: AgentTeamDialogueMessage[];
}

interface PersistRoleTurnResultInput {
  runId: string;
  turnIndex: number;
  role: AgentTeamRole;
  teamRoles: AgentTeamRole[];
  result: AgentTeamRoleTurnOutput;
}

interface RunProgressSnapshot {
  messageCount: number;
  completedRoleKeys: string[];
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

  const recordedEvent = await prisma.$transaction(async (tx) => {
    const run = await tx.agentTeamRun.update({
      where: { id: input.runId },
      data: {
        status: AGENT_TEAM_RUN_STATUS.running,
        startedAt: new Date(),
        completedAt: null,
        errorMessage: null,
      },
      select: {
        id: true,
        workspaceId: true,
        teamId: true,
        conversationId: true,
        analysisId: true,
      },
    });

    await tx.agentTeamRoleInbox.createMany({
      data: input.teamSnapshot.roles.map((role) => ({
        runId: input.runId,
        roleKey: role.roleKey,
        state:
          role.roleKey === initialRole.roleKey
            ? AGENT_TEAM_ROLE_INBOX_STATE.queued
            : AGENT_TEAM_ROLE_INBOX_STATE.idle,
        wakeReason: role.roleKey === initialRole.roleKey ? "initial-seed" : null,
        unreadCount: 0,
      })),
      skipDuplicates: true,
    });

    await tx.agentTeamRoleInbox.update({
      where: {
        runId_roleKey: {
          runId: input.runId,
          roleKey: initialRole.roleKey,
        },
      },
      data: {
        state: AGENT_TEAM_ROLE_INBOX_STATE.queued,
        wakeReason: "initial-seed",
        unreadCount: 0,
      },
    });

    return recordEvent(tx, {
      kind: AGENT_TEAM_EVENT_KIND.runStarted,
      runId: run.id,
      workspaceId: run.workspaceId,
      actor: AGENT_TEAM_EVENT_ACTOR_SYSTEM.orchestrator,
      payload: {
        teamId: run.teamId,
        conversationId: run.conversationId,
        analysisId: run.analysisId,
      },
    });
  });

  logRecordedEvents([recordedEvent]);

  return { roleKey: initialRole.roleKey };
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
      orderBy: [{ updatedAt: "asc" }, { roleKey: "asc" }],
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
        roleKey: nextInbox.roleKey,
      };
    }
  }
}

export async function loadTurnContext(
  input: Pick<AgentTeamRoleTurnInput, "runId"> & { roleKey: string }
): Promise<TurnContextPayload> {
  heartbeat();

  const [inboxRows, factRows, questionRows, recentThreadRows] = await Promise.all([
    prisma.agentTeamMessage.findMany({
      where: {
        runId: input.runId,
        OR: [{ toRoleKey: input.roleKey }, { toRoleKey: AGENT_TEAM_TARGET.broadcast }],
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
        ownerRoleKey: input.roleKey,
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

  const normalizedMessages = normalizeTurnMessages(input.role, input.result, input.teamRoles);
  const { valid: routedMessages, dropped: droppedMessages } = partitionMessagesByRouting({
    senderRole: input.role,
    teamRoles: input.teamRoles,
    messages: normalizedMessages,
  });
  if (droppedMessages.length > 0) {
    console.warn("[agent-team] Dropped invalidly routed LLM messages", {
      runId: input.runId,
      turnIndex: input.turnIndex,
      senderRoleKey: input.role.roleKey,
      senderSlug: input.role.slug,
      droppedCount: droppedMessages.length,
      dropped: droppedMessages.map((entry) => ({
        toRoleKey: entry.message.toRoleKey,
        kind: entry.message.kind,
        reason: entry.reason,
      })),
    });
  }

  const { snapshot, recordedEvents } = await prisma.$transaction(async (tx) => {
    // workspaceId is required on every event. Fetch once per turn so callers
    // don't need to thread it through the activity input.
    const run = await tx.agentTeamRun.findUniqueOrThrow({
      where: { id: input.runId },
      select: { workspaceId: true },
    });
    const parentMessageIds = routedMessages.flatMap((message) =>
      message.parentMessageId ? [message.parentMessageId] : []
    );
    const existingParentMessageRows =
      parentMessageIds.length === 0
        ? []
        : await tx.agentTeamMessage.findMany({
            where: {
              runId: input.runId,
              id: { in: parentMessageIds },
            },
            select: { id: true },
          });
    const persistableMessages = clearUnknownParentMessageIds(
      routedMessages,
      new Set(existingParentMessageRows.map((message) => message.id))
    );

    const messageCount = await tx.agentTeamMessage.count({
      where: { runId: input.runId },
    });
    if (messageCount + persistableMessages.length > MAX_AGENT_TEAM_MESSAGES) {
      throw new Error(
        `Agent team run exceeded the ${MAX_AGENT_TEAM_MESSAGES} message budget for run ${input.runId}`
      );
    }

    // Collect event drafts as we project; flush in one batch at the end of
    // the transaction so the event log + its projections share atomicity.
    const eventDrafts: AgentTeamRunEventDraft[] = [];

    const createdMessages: AgentTeamDialogueMessage[] = [];
    for (const message of persistableMessages) {
      const created = await tx.agentTeamMessage.create({
        data: {
          runId: input.runId,
          threadId: message.parentMessageId ?? `thread:${input.role.roleKey}`,
          fromRoleKey: input.role.roleKey,
          fromRoleSlug: input.role.slug,
          fromRoleLabel: input.role.label,
          toRoleKey: message.toRoleKey,
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

      eventDrafts.push(
        buildMessageSentDraft({
          runId: input.runId,
          workspaceId: run.workspaceId,
          senderRole: input.role,
          messageId: created.id,
          message,
        })
      );

      // Tool calls/results arrive as regular dialogue messages with kind =
      // tool_call | tool_result and a toolName. Mirror them to the event log
      // as tool_called / tool_returned so the observability layer has
      // first-class timing + latency data per tool invocation.
      if (message.kind === AGENT_TEAM_MESSAGE_KIND.toolCall && message.toolName) {
        eventDrafts.push({
          kind: AGENT_TEAM_EVENT_KIND.toolCalled,
          runId: input.runId,
          workspaceId: run.workspaceId,
          actor: input.role.roleKey,
          payload: {
            toolName: message.toolName,
            argsPreview: message.content.slice(0, 1024),
          },
        });
      } else if (message.kind === AGENT_TEAM_MESSAGE_KIND.toolResult && message.toolName) {
        eventDrafts.push({
          kind: AGENT_TEAM_EVENT_KIND.toolReturned,
          runId: input.runId,
          workspaceId: run.workspaceId,
          actor: input.role.roleKey,
          payload: {
            toolName: message.toolName,
            ok: message.kind === AGENT_TEAM_MESSAGE_KIND.toolResult,
            resultSummary: message.content.slice(0, 2048),
          },
        });
      }
    }

    for (const fact of input.result.proposedFacts) {
      const factRow = await tx.agentTeamFact.create({
        data: {
          runId: input.runId,
          statement: fact.statement,
          confidence: fact.confidence,
          sourceMessageIds: fact.sourceMessageIds,
          acceptedByRoleKeys: fact.confidence >= 0.75 ? [input.role.roleKey] : [],
          status:
            fact.confidence >= 0.75
              ? AGENT_TEAM_FACT_STATUS.accepted
              : AGENT_TEAM_FACT_STATUS.proposed,
        },
        select: { id: true },
      });
      eventDrafts.push({
        kind: AGENT_TEAM_EVENT_KIND.factProposed,
        runId: input.runId,
        workspaceId: run.workspaceId,
        actor: input.role.roleKey,
        payload: {
          factId: factRow.id,
          statement: fact.statement,
          confidence: fact.confidence,
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
      .filter((message) => shouldCreateOpenQuestionForMessage(message, input.teamRoles))
      .map((message) => buildOpenQuestionRow(message, input.role.roleKey, input.teamRoles));

    if (openQuestionsToCreate.length > 0) {
      // Use createManyAndReturn so we have row ids for the matching events;
      // old path was createMany which doesn't return rows.
      const createdQuestions = await tx.agentTeamOpenQuestion.createManyAndReturn({
        data: openQuestionsToCreate,
      });
      for (const question of createdQuestions) {
        eventDrafts.push({
          kind: AGENT_TEAM_EVENT_KIND.questionOpened,
          runId: input.runId,
          workspaceId: run.workspaceId,
          actor: input.role.roleKey,
          target: question.ownerRoleKey,
          payload: {
            questionId: question.id,
            question: question.question,
            ownerRoleKey: question.ownerRoleKey,
          },
        });
      }
    }

    const hasReviewerApproval = await reviewerApprovalExists(tx, input.runId, createdMessages);
    const queueTargets = collectQueuedTargets({
      senderRole: input.role,
      teamRoles: input.teamRoles,
      messages: persistableMessages,
      nextSuggestedRoleKeys: input.result.nextSuggestedRoleKeys,
      hasReviewerApproval,
    });

    for (const roleKey of queueTargets) {
      const wakeReason = buildWakeReason(input.role.roleKey, persistableMessages);
      await tx.agentTeamRoleInbox.upsert({
        where: {
          runId_roleKey: {
            runId: input.runId,
            roleKey,
          },
        },
        create: {
          runId: input.runId,
          roleKey,
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
      eventDrafts.push({
        kind: AGENT_TEAM_EVENT_KIND.roleQueued,
        runId: input.runId,
        workspaceId: run.workspaceId,
        actor: input.role.roleKey,
        target: roleKey,
        payload: { roleKey, wakeReason },
      });
    }

    // Self-role terminal state.
    //   done                              → role_completed
    //   resolution.status == needs_input  → role_blocked (waiting for input)
    //   resolution.status == no_action_needed OR complete OR null → idle
    //
    // `no_action_needed` is a close-recommendation, not a blocked state —
    // treating it as blocked would strand acknowledgement cases. Closure
    // happens via the operator's Close-as-no-action action.
    const messageResolutionQuestions = buildResolutionQuestionsFromMessages({
      runId: input.runId,
      turnIndex: input.turnIndex,
      messages: persistableMessages,
      teamRoles: input.teamRoles,
    });

    const { state: selfState, hallucinatedBlock } = resolveSelfTurnState({
      resolution: input.result.resolution,
      messageResolutionQuestionCount: messageResolutionQuestions.length,
      done: input.result.done,
    });
    if (hallucinatedBlock) {
      console.warn("[agent-team] Downgraded blocked-without-questions to idle", {
        runId: input.runId,
        turnIndex: input.turnIndex,
        roleKey: input.role.roleKey,
        roleSlug: input.role.slug,
        resolutionStatus: input.result.resolution?.status ?? null,
        whyStuck: input.result.resolution?.whyStuck ?? null,
      });
    }

    const wakeReasonText =
      input.result.resolution?.whyStuck ?? messageResolutionQuestions.at(0)?.question ?? null;

    await tx.agentTeamRoleInbox.update({
      where: {
        runId_roleKey: {
          runId: input.runId,
          roleKey: input.role.roleKey,
        },
      },
      data: {
        state: selfState,
        lastReadMessageId: createdMessages.at(-1)?.id ?? null,
        unreadCount: 0,
        wakeReason: wakeReasonText,
      },
    });

    if (selfState === AGENT_TEAM_ROLE_INBOX_STATE.done) {
      eventDrafts.push({
        kind: AGENT_TEAM_EVENT_KIND.roleCompleted,
        runId: input.runId,
        workspaceId: run.workspaceId,
        actor: input.role.roleKey,
        payload: { roleKey: input.role.roleKey },
      });
    } else if (selfState === AGENT_TEAM_ROLE_INBOX_STATE.blocked) {
      eventDrafts.push({
        kind: AGENT_TEAM_EVENT_KIND.roleBlocked,
        runId: input.runId,
        workspaceId: run.workspaceId,
        actor: input.role.roleKey,
        payload: {
          roleKey: input.role.roleKey,
          wakeReason: wakeReasonText,
        },
      });
    }

    // Persist each question in the architect's resolution as a
    // question_dispatched event. Question ids are deterministic
    // (assigned at parse time from runId+turnIndex+questionIndex), so
    // activity retries produce the same ids and the event log records
    // each question exactly once across replays.
    if (input.result.resolution && input.result.resolution.questionsToResolve.length > 0) {
      const resolutionStatus = input.result.resolution.status;
      for (const question of input.result.resolution.questionsToResolve) {
        eventDrafts.push({
          kind: AGENT_TEAM_EVENT_KIND.questionDispatched,
          runId: input.runId,
          workspaceId: run.workspaceId,
          actor: input.role.roleKey,
          target: question.target,
          payload: {
            questionId: question.id,
            target: question.target,
            status: resolutionStatus,
            question: question.question,
            suggestedReply: question.suggestedReply ?? null,
            assignedRole: question.assignedRole ?? null,
          },
        });
      }
    }

    for (const question of messageResolutionQuestions) {
      eventDrafts.push({
        kind: AGENT_TEAM_EVENT_KIND.questionDispatched,
        runId: input.runId,
        workspaceId: run.workspaceId,
        actor: input.role.roleKey,
        target: question.target,
        payload: {
          questionId: question.id,
          target: question.target,
          status: RESOLUTION_STATUS.needsInput,
          question: question.question,
          suggestedReply: question.suggestedReply,
          assignedRole: null,
        },
      });
    }

    // Flush accumulated event drafts inside the same transaction. Projections
    // and the event log share atomicity: if any write fails, the turn rolls
    // back as a whole.
    const recordedEvents = await recordEvents(tx, eventDrafts);

    const snapshot = await getRunProgressSnapshot(tx, input.runId);
    return { snapshot, recordedEvents };
  });

  logRecordedEvents(recordedEvents);
  return snapshot;
}

export async function getRunProgress(runId: string): Promise<RunProgressSnapshot> {
  return getRunProgressSnapshot(prisma, runId);
}

export async function markRunCompleted(runId: string): Promise<void> {
  const event = await prisma.$transaction(async (tx) => {
    const run = await tx.agentTeamRun.update({
      where: { id: runId },
      data: {
        status: AGENT_TEAM_RUN_STATUS.completed,
        completedAt: new Date(),
        errorMessage: null,
      },
      select: {
        id: true,
        workspaceId: true,
        conversationId: true,
        startedAt: true,
        completedAt: true,
      },
    });
    const messageCount = await tx.agentTeamMessage.count({ where: { runId } });

    const recordedEvent = await recordEvent(tx, {
      kind: AGENT_TEAM_EVENT_KIND.runSucceeded,
      runId: run.id,
      workspaceId: run.workspaceId,
      actor: AGENT_TEAM_EVENT_ACTOR_SYSTEM.orchestrator,
      payload: {
        durationMs: computeDurationMs(run.startedAt, run.completedAt),
        messageCount,
      },
    });

    // Cache the per-role rollup on AgentTeamRun.summary so the UI summary card
    // can render in O(1) without aggregating events on every request. Computed
    // after the run_succeeded event so its own row is counted.
    const rollup = await computeRunRollup(tx, {
      runId: run.id,
      status: AGENT_TEAM_RUN_STATUS.completed,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
    });
    await tx.agentTeamRun.update({
      where: { id: run.id },
      data: { summary: serializeRunRollup(rollup) },
    });

    // Project the drafter's proposal onto the SupportAnalysis + SupportDraft
    // tables so the existing approve/dismiss flow keeps working. Pre-cutover
    // these rows came from the standalone support-analysis workflow; post-
    // cutover they're a derived projection of the agent-team event log.
    if (run.conversationId) {
      await projectFastRunToSupportAnalysis(tx, {
        runId: run.id,
        workspaceId: run.workspaceId,
        conversationId: run.conversationId,
      });
    }

    return recordedEvent;
  });
  logRecordedEvents([event]);
}

// Project a completed agent-team run onto the legacy SupportAnalysis +
// SupportDraft tables. Idempotent: if a SupportAnalysis row already exists for
// this conversation that points back at this run, skip.
async function projectFastRunToSupportAnalysis(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  args: { runId: string; workspaceId: string; conversationId: string }
): Promise<void> {
  const drafterMessage = await tx.agentTeamMessage.findFirst({
    where: {
      runId: args.runId,
      fromRoleSlug: AGENT_TEAM_ROLE_SLUG.drafter,
      kind: AGENT_TEAM_MESSAGE_KIND.proposal,
    },
    orderBy: { createdAt: "asc" },
    select: { id: true, subject: true, content: true, refs: true },
  });
  if (!drafterMessage) {
    return;
  }

  const facts = await tx.agentTeamFact.findMany({
    where: { runId: args.runId },
    orderBy: { createdAt: "asc" },
    select: { statement: true, confidence: true },
  });

  const problemStatement = facts[0]?.statement ?? "Drafted by agent team.";
  const likelySubsystem = facts[1]?.statement ?? "agent-team-FAST";
  const confidence = facts[0]?.confidence ?? 0.5;
  const hasDraft = drafterMessage.content.trim().length > 0;
  const isNoDraftMarker = drafterMessage.subject?.includes("Analysis only") ?? false;

  // Idempotency: skip if we've already projected this run.
  const existing = await tx.supportAnalysis.findFirst({
    where: { conversationId: args.conversationId, agentTeamRunId: args.runId },
    select: { id: true },
  });
  if (existing) {
    return;
  }

  const analysis = await tx.supportAnalysis.create({
    data: {
      workspaceId: args.workspaceId,
      conversationId: args.conversationId,
      agentTeamRunId: args.runId,
      status: "ANALYZED",
      triggerType: "AUTO",
      problemStatement,
      likelySubsystem,
      confidence,
      reasoningTrace: facts.map((fact) => `- ${fact.statement}`).join("\n"),
      toolCallCount: 0,
      llmModel: null,
    },
    select: { id: true },
  });

  if (hasDraft && !isNoDraftMarker) {
    // Drive the SupportDraft status through the draft FSM rather than writing
    // a literal status string. The drafter's proposal is the equivalent of
    // the legacy single-agent "generated" event, so we create at the default
    // GENERATING state and immediately transition to AWAITING_APPROVAL.
    const created = await tx.supportDraft.create({
      data: {
        analysisId: analysis.id,
        conversationId: args.conversationId,
        workspaceId: args.workspaceId,
        draftBody: drafterMessage.content,
        citations: Array.isArray(drafterMessage.refs) ? drafterMessage.refs : [],
      },
      select: { id: true, status: true, errorMessage: true },
    });
    const next = transitionDraft(
      restoreDraftContext(created.id, created.status, created.errorMessage),
      { type: "generated" }
    );
    await tx.supportDraft.update({
      where: { id: created.id },
      data: { status: next.status, errorMessage: next.errorMessage },
    });
  }
}

export async function markRunWaiting(runId: string): Promise<void> {
  // Waiting is a re-entrant pause, not a terminal state. No event emitted;
  // the next initializeRunState/claimNext cycle will emit role_queued events.
  await prisma.agentTeamRun.update({
    where: { id: runId },
    data: {
      status: AGENT_TEAM_RUN_STATUS.waiting,
      completedAt: null,
    },
  });
}

export async function markRunFailed(input: { runId: string; errorMessage: string }): Promise<void> {
  const event = await prisma.$transaction(async (tx) => {
    const run = await tx.agentTeamRun.update({
      where: { id: input.runId },
      data: {
        status: AGENT_TEAM_RUN_STATUS.failed,
        completedAt: new Date(),
        errorMessage: input.errorMessage,
      },
      select: { id: true, workspaceId: true, startedAt: true, completedAt: true },
    });
    const messageCount = await tx.agentTeamMessage.count({ where: { runId: input.runId } });

    const recordedEvent = await recordEvent(tx, {
      kind: AGENT_TEAM_EVENT_KIND.runFailed,
      runId: run.id,
      workspaceId: run.workspaceId,
      actor: AGENT_TEAM_EVENT_ACTOR_SYSTEM.orchestrator,
      payload: {
        durationMs: computeDurationMs(run.startedAt, run.completedAt),
        messageCount,
        errorMessage: input.errorMessage,
      },
    });

    const rollup = await computeRunRollup(tx, {
      runId: run.id,
      status: AGENT_TEAM_RUN_STATUS.failed,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
    });
    await tx.agentTeamRun.update({
      where: { id: run.id },
      data: { summary: serializeRunRollup(rollup) },
    });

    return recordedEvent;
  });
  logRecordedEvents([event]);
}

function computeDurationMs(startedAt: Date | null, completedAt: Date | null): number {
  if (!startedAt || !completedAt) return 0;
  const delta = completedAt.getTime() - startedAt.getTime();
  return delta < 0 ? 0 : delta;
}

/**
 * Translate a persisted message + its source draft into a `message_sent` event.
 * Pure function, trivially testable. The contentPreview is capped at 280 chars
 * so the event payload never carries a multi-KB blob — callers rely on the
 * AgentTeamMessage projection for the full body.
 */
export function buildMessageSentDraft(input: {
  runId: string;
  workspaceId: string;
  senderRole: AgentTeamRole;
  messageId: string;
  message: AgentTeamDialogueMessageDraft;
}): AgentTeamRunEventDraft {
  return {
    kind: AGENT_TEAM_EVENT_KIND.messageSent,
    runId: input.runId,
    workspaceId: input.workspaceId,
    actor: input.senderRole.roleKey,
    target: input.message.toRoleKey,
    messageKind: input.message.kind,
    payload: {
      messageId: input.messageId,
      fromRoleKey: input.senderRole.roleKey,
      toRoleKey: input.message.toRoleKey,
      kind: input.message.kind,
      subject: input.message.subject,
      contentPreview: input.message.content.slice(0, 280),
    },
  };
}

export function clearUnknownParentMessageIds(
  messages: AgentTeamDialogueMessageDraft[],
  knownParentMessageIds: ReadonlySet<string>
): AgentTeamDialogueMessageDraft[] {
  return messages.map((message) => {
    if (!message.parentMessageId || knownParentMessageIds.has(message.parentMessageId)) {
      return message;
    }

    return { ...message, parentMessageId: null };
  });
}

function normalizeTurnMessages(
  role: AgentTeamRole,
  result: AgentTeamRoleTurnOutput,
  teamRoles: AgentTeamRole[] = [role]
): AgentTeamDialogueMessageDraft[] {
  const messages = [...result.messages];
  const alreadyBlocked = messages.some(
    (message) => message.kind === AGENT_TEAM_MESSAGE_KIND.blocked
  );

  // Synthesize a `kind=blocked` transcript message when the architect emits
  // a non-complete resolution and didn't already include an explicit blocked
  // message. Body uses `resolution.whyStuck`; structured questions live on
  // `question_dispatched` events, not on this synthetic message.
  const isResolutionBlocked =
    result.resolution !== null &&
    result.resolution !== undefined &&
    result.resolution.status !== "complete";
  if (isResolutionBlocked && !alreadyBlocked) {
    const whyStuck = result.resolution?.whyStuck ?? "Agent stopped without a stated reason";
    messages.push({
      toRoleKey:
        role.slug === AGENT_TEAM_ROLE_SLUG.architect
          ? AGENT_TEAM_TARGET.orchestrator
          : (resolvePrimaryRoleKey(teamRoles, AGENT_TEAM_ROLE_SLUG.architect) ??
            AGENT_TEAM_TARGET.orchestrator),
      kind: AGENT_TEAM_MESSAGE_KIND.blocked,
      subject: `${role.label} blocked`,
      content: whyStuck,
      refs: [],
    });
  }

  return messages;
}

interface MessageResolutionQuestion {
  id: string;
  target: typeof RESOLUTION_TARGET.customer | typeof RESOLUTION_TARGET.operator;
  question: string;
  suggestedReply: string | null;
}

function buildResolutionQuestionsFromMessages(input: {
  runId: string;
  turnIndex: number;
  messages: AgentTeamDialogueMessageDraft[];
  teamRoles: AgentTeamRole[];
}): MessageResolutionQuestion[] {
  const roleKeys = new Set(input.teamRoles.map((role) => role.roleKey));

  return input.messages.flatMap((message, messageIndex) => {
    if (!isHumanResolutionMessage(message, roleKeys)) {
      return [];
    }

    return [
      {
        id: `${input.runId}-${input.turnIndex}-message-${messageIndex}`,
        target: message.toRoleKey,
        question: message.content,
        suggestedReply: message.toRoleKey === RESOLUTION_TARGET.customer ? message.content : null,
      },
    ];
  });
}

function isHumanResolutionMessage(
  message: AgentTeamDialogueMessageDraft,
  roleKeys: ReadonlySet<string>
): message is AgentTeamDialogueMessageDraft & {
  toRoleKey: typeof RESOLUTION_TARGET.customer | typeof RESOLUTION_TARGET.operator;
} {
  if (roleKeys.has(message.toRoleKey)) {
    return false;
  }

  if (
    message.toRoleKey !== RESOLUTION_TARGET.customer &&
    message.toRoleKey !== RESOLUTION_TARGET.operator
  ) {
    return false;
  }

  return shouldCreateOpenQuestion(message.kind);
}

function shouldCreateOpenQuestionForMessage(
  message: AgentTeamDialogueMessage,
  teamRoles: AgentTeamRole[]
): boolean {
  if (!shouldCreateOpenQuestion(message.kind)) {
    return false;
  }

  const targetsExistingRole = teamRoles.some((role) => role.roleKey === message.toRoleKey);
  return targetsExistingRole || !isHumanResolutionTarget(message.toRoleKey);
}

function buildOpenQuestionRow(
  message: AgentTeamDialogueMessage,
  askedByRoleKey: string,
  teamRoles: AgentTeamRole[]
) {
  const ownerRoleKey =
    message.toRoleKey === AGENT_TEAM_TARGET.orchestrator
      ? (resolvePrimaryRoleKey(teamRoles, AGENT_TEAM_ROLE_SLUG.architect) ?? askedByRoleKey)
      : message.toRoleKey;

  return {
    runId: message.runId,
    askedByRoleKey,
    ownerRoleKey,
    question: message.content,
    blockingRoleKeys:
      message.kind === AGENT_TEAM_MESSAGE_KIND.blocked ? [askedByRoleKey] : [ownerRoleKey],
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
      roleKey: row.roleKey,
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
    completedRoleKeys: parsedInboxes
      .filter((inbox) => inbox.state === AGENT_TEAM_ROLE_INBOX_STATE.done)
      .map((inbox) => inbox.roleKey),
    queuedInboxCount: parsedInboxes.filter(
      (inbox) => inbox.state === AGENT_TEAM_ROLE_INBOX_STATE.queued
    ).length,
    blockedInboxCount: parsedInboxes.filter(
      (inbox) => inbox.state === AGENT_TEAM_ROLE_INBOX_STATE.blocked
    ).length,
    openQuestionCount,
  };
}

function buildWakeReason(senderRoleKey: string, messages: AgentTeamDialogueMessageDraft[]): string {
  const [firstMessage] = messages;
  if (!firstMessage) {
    return `follow-up requested by ${senderRoleKey}`;
  }

  return `${senderRoleKey}:${firstMessage.kind}:${firstMessage.subject}`;
}

function mapMessageRow(row: {
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
  refs: Prisma.JsonValue | null;
  toolName: string | null;
  metadata: Prisma.JsonValue | null;
  createdAt: Date;
}): AgentTeamDialogueMessage {
  return agentTeamDialogueMessageSchema.parse({
    id: row.id,
    runId: row.runId,
    threadId: row.threadId,
    fromRoleKey: row.fromRoleKey,
    fromRoleSlug: row.fromRoleSlug,
    fromRoleLabel: row.fromRoleLabel,
    toRoleKey: row.toRoleKey,
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
  acceptedByRoleKeys: Prisma.JsonValue;
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
    acceptedByRoleKeys: parseJsonStringArray(row.acceptedByRoleKeys),
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

function mapOpenQuestionRow(row: {
  id: string;
  runId: string;
  askedByRoleKey: string;
  ownerRoleKey: string;
  question: string;
  blockingRoleKeys: Prisma.JsonValue;
  status: string;
  sourceMessageId: string;
  createdAt: Date;
  updatedAt: Date;
}): AgentTeamOpenQuestion {
  return agentTeamOpenQuestionSchema.parse({
    id: row.id,
    runId: row.runId,
    askedByRoleKey: row.askedByRoleKey,
    ownerRoleKey: row.ownerRoleKey,
    question: row.question,
    blockingRoleKeys: parseJsonStringArray(row.blockingRoleKeys),
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

function resolvePrimaryRoleKey(
  teamRoles: AgentTeamRole[],
  slug: AgentTeamRole["slug"]
): string | null {
  const match = [...teamRoles]
    .filter((role) => role.slug === slug)
    .sort((left, right) =>
      left.sortOrder === right.sortOrder
        ? left.roleKey.localeCompare(right.roleKey)
        : left.sortOrder - right.sortOrder
    )[0];

  return match?.roleKey ?? null;
}

function resolveAgentServiceUrl(): string {
  return env.AGENT_SERVICE_URL ?? "http://localhost:3100";
}
