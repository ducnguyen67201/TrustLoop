import { prisma } from "@shared/database";
import { recordEvent } from "@shared/rest/services/agent-team/run-event-service";
import type { WorkflowDispatcher } from "@shared/rest/temporal-dispatcher";
import {
  AGENT_TEAM_EVENT_KIND,
  AGENT_TEAM_MESSAGE_KIND,
  AGENT_TEAM_ROLE_INBOX_STATE,
  AGENT_TEAM_RUN_STATUS,
  ConflictError,
  ValidationError,
  type WorkflowDispatchResponse,
  agentTeamSnapshotSchema,
  recordOperatorAnswerInputSchema,
  resumeAgentTeamRunInputSchema,
} from "@shared/types";

interface RecordOperatorAnswerArgs {
  workspaceId: string;
  runId: string;
  questionId: string;
  answer: string;
  actorUserId: string;
}

interface ResumeRunArgs {
  workspaceId: string;
  runId: string;
}

/**
 * Operator answers a question the architect routed to target=operator. Inside a
 * single transaction this writes the synthetic answer message into the
 * architect's inbox, emits a question_answered event, and flips the architect
 * role-inbox from blocked → queued. The caller (operator UI) is expected to
 * follow up with resumeRun() if they want the workflow to consume the answer
 * — Option C: every operator-driven restart is explicit, never automatic.
 */
export async function recordOperatorAnswer(
  args: RecordOperatorAnswerArgs
): Promise<{ messageId: string }> {
  const parsed = recordOperatorAnswerInputSchema.parse({
    runId: args.runId,
    questionId: args.questionId,
    answer: args.answer,
  });

  return prisma.$transaction(async (tx) => {
    const run = await tx.agentTeamRun.findFirst({
      where: { id: parsed.runId, workspaceId: args.workspaceId },
      select: {
        id: true,
        workspaceId: true,
        status: true,
        teamSnapshot: true,
      },
    });
    if (!run) {
      throw new ValidationError(`Agent team run ${parsed.runId} not found`);
    }
    if (run.status !== AGENT_TEAM_RUN_STATUS.waiting) {
      throw new ConflictError(
        `Agent team run is in status "${run.status}" — operator answers are only accepted while the run is "waiting".`
      );
    }

    // Find the role that asked the question by replaying the question_dispatched
    // event. Avoids needing the operator UI to know the architect's roleKey and
    // also rejects answers to questions that were never dispatched.
    const dispatchedEvent = await tx.agentTeamRunEvent.findFirst({
      where: {
        runId: run.id,
        kind: AGENT_TEAM_EVENT_KIND.questionDispatched,
        // payload->>'questionId' = questionId. Postgres JSON path filter so we
        // don't have to load every event into memory.
        payload: { path: ["questionId"], equals: parsed.questionId },
      },
      orderBy: { ts: "desc" },
      select: { actor: true, payload: true },
    });
    if (!dispatchedEvent) {
      throw new ValidationError(
        `Question ${parsed.questionId} was never dispatched on run ${run.id}`
      );
    }
    const dispatchedRoleKey = dispatchedEvent.actor;

    // Reject double-answers — once a question is answered, the operator must
    // resume the run before the architect can ask another question with the
    // same id (which won't happen because ids are deterministic per turnIndex).
    const existingAnswer = await tx.agentTeamRunEvent.findFirst({
      where: {
        runId: run.id,
        kind: AGENT_TEAM_EVENT_KIND.questionAnswered,
        payload: { path: ["questionId"], equals: parsed.questionId },
      },
      select: { id: true },
    });
    if (existingAnswer) {
      throw new ConflictError(`Question ${parsed.questionId} has already been answered`);
    }

    const teamSnapshot = agentTeamSnapshotSchema.parse(run.teamSnapshot);
    const targetRole = teamSnapshot.roles.find((role) => role.roleKey === dispatchedRoleKey);
    if (!targetRole) {
      throw new ValidationError(
        `Role ${dispatchedRoleKey} (asker of question ${parsed.questionId}) is missing from the run's team snapshot`
      );
    }

    const message = await tx.agentTeamMessage.create({
      data: {
        runId: run.id,
        threadId: run.id,
        fromRoleKey: "operator",
        fromRoleSlug: "operator",
        fromRoleLabel: "Operator",
        toRoleKey: dispatchedRoleKey,
        kind: AGENT_TEAM_MESSAGE_KIND.answer,
        subject: `Answer to ${parsed.questionId}`,
        content: parsed.answer,
        parentMessageId: null,
        refs: [parsed.questionId],
        metadata: {
          source: "operator",
          questionId: parsed.questionId,
          actorUserId: args.actorUserId,
        },
      },
      select: { id: true },
    });

    await tx.agentTeamRoleInbox.update({
      where: {
        runId_roleKey: {
          runId: run.id,
          roleKey: dispatchedRoleKey,
        },
      },
      data: {
        state: AGENT_TEAM_ROLE_INBOX_STATE.queued,
        wakeReason: "operator-answer",
        unreadCount: { increment: 1 },
      },
    });

    await recordEvent(tx, {
      kind: AGENT_TEAM_EVENT_KIND.questionAnswered,
      runId: run.id,
      workspaceId: run.workspaceId,
      actor: "operator",
      target: dispatchedRoleKey,
      payload: {
        questionId: parsed.questionId,
        target: "operator",
        source: "operator",
        answer: parsed.answer,
      },
    });

    return { messageId: message.id };
  });
}

/**
 * Operator-triggered re-dispatch of a run that exited in `waiting`. Loads the
 * run's stored teamSnapshot, rebuilds the conversation thread snapshot, and
 * starts a fresh workflow execution with isResume=true and a unique
 * resumeNonce so Temporal doesn't reject the workflow id as a duplicate.
 *
 * Caller is expected to have already written the operator answer (or other
 * un-blocking signal) via recordOperatorAnswer / a peer-role message — this
 * function does not validate that the architect's inbox is queued, only that
 * the run itself is `waiting`. The workflow is resilient to "no queued inbox"
 * — it will exit back to `waiting` on the first claim attempt.
 */
export async function resumeRun(
  args: ResumeRunArgs,
  dispatcher: WorkflowDispatcher
): Promise<WorkflowDispatchResponse> {
  const parsed = resumeAgentTeamRunInputSchema.parse({ runId: args.runId });

  const run = await prisma.agentTeamRun.findFirst({
    where: { id: parsed.runId, workspaceId: args.workspaceId },
    select: {
      id: true,
      workspaceId: true,
      teamId: true,
      conversationId: true,
      analysisId: true,
      status: true,
      teamSnapshot: true,
    },
  });
  if (!run) {
    throw new ValidationError(`Agent team run ${parsed.runId} not found`);
  }
  if (run.status !== AGENT_TEAM_RUN_STATUS.waiting) {
    throw new ConflictError(
      `Agent team run is in status "${run.status}" — only "waiting" runs can be resumed.`
    );
  }

  const teamSnapshot = agentTeamSnapshotSchema.parse(run.teamSnapshot);

  // Re-fetch the conversation events so the architect sees any messages that
  // arrived while the run was paused (e.g. the customer wrote back, even if
  // the operator hasn't typed an answer yet).
  const threadSnapshot = await buildThreadSnapshot(run.conversationId);

  // Monotonic-enough nonce: Date.now() in ms is collision-safe for human-paced
  // operator clicks (you cannot hit "Resume" twice within the same millisecond
  // through the UI).
  const resumeNonce = String(Date.now());

  const dispatch = await dispatcher.startAgentTeamRunResumeWorkflow({
    workspaceId: run.workspaceId,
    runId: run.id,
    teamId: run.teamId,
    conversationId: run.conversationId ?? undefined,
    analysisId: run.analysisId ?? undefined,
    teamSnapshot,
    threadSnapshot,
    isResume: true,
    resumeNonce,
  });

  // Flip status back to running and record the new workflowId so the run row
  // points at the live execution. Done after dispatch succeeded so a Temporal
  // failure leaves the row in `waiting` for retry.
  await prisma.$transaction(async (tx) => {
    await tx.agentTeamRun.update({
      where: { id: run.id },
      data: {
        status: AGENT_TEAM_RUN_STATUS.running,
        workflowId: dispatch.workflowId,
      },
    });
    await recordEvent(tx, {
      kind: AGENT_TEAM_EVENT_KIND.runStarted,
      runId: run.id,
      workspaceId: run.workspaceId,
      actor: "orchestrator",
      payload: {
        teamId: run.teamId,
        conversationId: run.conversationId ?? null,
        analysisId: run.analysisId ?? null,
      },
    });
  });

  return dispatch;
}

async function buildThreadSnapshot(conversationId: string | null): Promise<string> {
  if (!conversationId) {
    return JSON.stringify({ events: [] }, null, 2);
  }

  const conversation = await prisma.supportConversation.findUnique({
    where: { id: conversationId },
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

  if (!conversation) {
    return JSON.stringify({ events: [] }, null, 2);
  }

  return JSON.stringify(
    {
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
    },
    null,
    2
  );
}
