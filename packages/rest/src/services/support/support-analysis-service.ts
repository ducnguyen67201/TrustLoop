import { prisma } from "@shared/database";
import type { WorkflowDispatcher } from "@shared/rest/temporal-dispatcher";
import {
  type ApproveDraftInput,
  ConflictError,
  DRAFT_DISPATCH_KIND,
  DRAFT_DISPATCH_STATUS,
  DRAFT_STATUS,
  type DismissDraftInput,
  type DraftStatus,
  InvalidDraftTransitionError,
  SUPPORT_RESOLUTION_KNOWLEDGE_WORKFLOW_MODE,
  ValidationError,
  restoreDraftContext,
  transitionDraft,
} from "@shared/types";

// ---------------------------------------------------------------------------
// supportAnalysis service
//
// Read + approve/dismiss path for SupportAnalysis / SupportDraft rows. The
// trigger function was removed when the agent-team-only pipeline took over —
// SupportAnalysis is now a derived projection of agent-team runs, written by
// markRunCompleted from the drafter's proposal. The router still exposes
// approveDraft, dismissDraft, and getLatestAnalysis as the operator UI's
// public API.
//
//   import * as supportAnalysis from "@shared/rest/services/support/support-analysis-service";
//   await supportAnalysis.approveDraft(input, dispatcher);
//   await supportAnalysis.dismissDraft(input);
//   const latest = await supportAnalysis.getLatest(conversationId, workspaceId);
//
// See docs/conventions/service-layer-conventions.md.
// ---------------------------------------------------------------------------

/**
 * Route a draft state change through the draft state machine, translating
 * its InvalidDraftTransitionError into the service-layer ConflictError that
 * tRPC callers already expect. Centralizes the "what do we do when the
 * transition isn't allowed" decision so every mutation uses the same guard.
 */
function tryDraftTransition(
  draft: { id: string; status: string; errorMessage: string | null },
  event: Parameters<typeof transitionDraft>[1]
) {
  const ctx = restoreDraftContext(draft.id, draft.status as DraftStatus, draft.errorMessage);
  try {
    return transitionDraft(ctx, event);
  } catch (err) {
    if (err instanceof InvalidDraftTransitionError) {
      throw new ConflictError(`Cannot ${event.type} draft with status '${draft.status}'.`);
    }
    throw err;
  }
}

export async function approveDraft(
  input: ApproveDraftInput & { workspaceId: string; actorUserId: string },
  dispatcher: WorkflowDispatcher
) {
  // Compare-and-swap inside a transaction so a double-click on the approve
  // button can never double-dispatch Slack. The outbox row in the same tx
  // means a Temporal outage after commit still leaves a pending dispatch
  // the sweep workflow can pick up.
  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.supportDraft.updateMany({
      where: {
        id: input.draftId,
        workspaceId: input.workspaceId,
        status: DRAFT_STATUS.awaitingApproval,
      },
      data: {
        status: DRAFT_STATUS.approved,
        approvedBy: input.actorUserId,
        approvedAt: new Date(),
        editedBody: input.editedBody ?? null,
      },
    });
    if (updated.count === 0) {
      // Either the draft doesn't exist in this workspace, or it's no longer
      // AWAITING_APPROVAL (another approval already won the race, or it's
      // been dismissed/failed). Surface a ConflictError so tRPC returns 409.
      const existing = await tx.supportDraft.findFirst({
        where: { id: input.draftId, workspaceId: input.workspaceId },
        select: { status: true },
      });
      if (!existing) {
        throw new ConflictError("Draft not found in this workspace.");
      }
      throw new ConflictError(
        `Draft is in status ${existing.status}, not AWAITING_APPROVAL. Approval skipped (already processed).`
      );
    }

    const dispatch = await tx.draftDispatch.create({
      data: {
        draftId: input.draftId,
        workspaceId: input.workspaceId,
        kind: DRAFT_DISPATCH_KIND.sendToSlack,
        status: DRAFT_DISPATCH_STATUS.pending,
      },
    });

    const draft = await tx.supportDraft.findUniqueOrThrow({
      where: { id: input.draftId },
    });

    const approvedEvent = await tx.supportConversationEvent.create({
      data: {
        workspaceId: input.workspaceId,
        conversationId: draft.conversationId,
        eventType: "DRAFT_APPROVED",
        eventSource: "OPERATOR",
        summary: input.editedBody ? "Draft edited and approved" : "Draft approved as-is",
        detailsJson: { draftId: input.draftId, editedByHuman: !!input.editedBody },
      },
    });

    return { draft, dispatchId: dispatch.id, approvedEventId: approvedEvent.id };
  });

  // Best-effort dispatch. Any failure here leaves the outbox row PENDING for
  // the sweep workflow to retry — never throw back to the caller once the
  // CAS has committed. The workflow ID is deterministic
  // (`send-draft-${draftId}`) with REJECT_DUPLICATE, so an accidental retry
  // that races the sweep is safe.
  try {
    const handle = await dispatcher.startSendDraftToSlackWorkflow({
      draftId: input.draftId,
      dispatchId: result.dispatchId,
      workspaceId: input.workspaceId,
    });
    await prisma.draftDispatch.update({
      where: { id: result.dispatchId },
      data: { workflowId: handle.workflowId },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // WorkflowExecutionAlreadyStarted means the sweep (or a duplicate caller)
    // got there first. Treat as success — idempotent dispatch.
    if (!message.includes("WorkflowExecutionAlreadyStarted")) {
      console.warn("[approveDraft] dispatch failed; outbox will retry", {
        draftId: input.draftId,
        error: message,
      });
      await prisma.draftDispatch.update({
        where: { id: result.dispatchId },
        data: { lastError: message, attempts: { increment: 1 } },
      });
    }
  }

  // Additive: dispatch the past-resolution embedding workflow if the workspace
  // has knowledge search enabled. Best-effort — failures here NEVER throw back
  // to the caller. If this dispatch fails or the flag was off, the operator
  // can still flip the flag on later and run /settings/knowledge backfill to
  // catch up. Workflow ID is deterministic (single-mode dedups on sourceEventId).
  try {
    const workspace = await prisma.workspace.findUnique({
      where: { id: input.workspaceId },
      select: { knowledgeSearchEnabled: true },
    });
    if (workspace?.knowledgeSearchEnabled) {
      await dispatcher.startSupportResolutionKnowledgeWorkflow({
        mode: SUPPORT_RESOLUTION_KNOWLEDGE_WORKFLOW_MODE.SINGLE,
        workspaceId: input.workspaceId,
        conversationId: result.draft.conversationId,
        sourceEventId: result.approvedEventId,
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!message.includes("WorkflowExecutionAlreadyStarted")) {
      console.warn("[approveDraft] knowledge embed dispatch failed (non-fatal)", {
        draftId: input.draftId,
        workspaceId: input.workspaceId,
        error: message,
      });
    }
  }

  return result.draft;
}

export async function dismissDraft(
  input: DismissDraftInput & { workspaceId: string; actorUserId: string }
) {
  const draft = await prisma.supportDraft.findFirst({
    where: { id: input.draftId, workspaceId: input.workspaceId },
  });
  if (!draft) {
    throw new ConflictError("Draft not found in this workspace.");
  }

  const next = tryDraftTransition(draft, { type: "dismiss", reason: input.reason });

  const updatedDraft = await prisma.supportDraft.update({
    where: { id: input.draftId },
    data: { status: next.status },
  });

  await prisma.supportConversationEvent.create({
    data: {
      workspaceId: input.workspaceId,
      conversationId: draft.conversationId,
      eventType: "DRAFT_DISMISSED",
      eventSource: "OPERATOR",
      summary: input.reason ? `Draft dismissed: ${input.reason}` : "Draft dismissed",
      detailsJson: { draftId: draft.id, reason: input.reason ?? null },
    },
  });

  return updatedDraft;
}

/**
 * Get the latest analysis for a conversation (ordered by createdAt DESC).
 */
export async function getLatest(conversationId: string, workspaceId: string) {
  return prisma.supportAnalysis.findFirst({
    where: { conversationId, workspaceId },
    orderBy: { createdAt: "desc" },
    include: {
      evidence: { orderBy: { createdAt: "asc" } },
      drafts: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
}
