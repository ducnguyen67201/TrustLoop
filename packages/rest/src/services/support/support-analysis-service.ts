import { prisma } from "@shared/database";
import { env } from "@shared/env";
import type { WorkflowDispatcher } from "@shared/rest/temporal-dispatcher";
import {
  ANALYSIS_STATUS,
  type ApproveDraftInput,
  ConflictError,
  DRAFT_DISPATCH_KIND,
  DRAFT_DISPATCH_STATUS,
  DRAFT_STATUS,
  type DismissDraftInput,
  type DraftStatus,
  InvalidDraftTransitionError,
  type TriggerAnalysisInput,
  ValidationError,
  restoreDraftContext,
  transitionDraft,
} from "@shared/types";

// ---------------------------------------------------------------------------
// supportAnalysis service
//
// Commands over SupportAnalysis / SupportDraft: trigger a new analysis,
// approve or dismiss a drafted reply, read the latest analysis for a
// conversation. Import as a namespace:
//
//   import * as supportAnalysis from "@shared/rest/services/support/support-analysis-service";
//   await supportAnalysis.trigger(input, dispatcher);
//   await supportAnalysis.approveDraft(input);
//   await supportAnalysis.dismissDraft(input);
//   const latest = await supportAnalysis.getLatest(conversationId, workspaceId);
//
// Note: tRPC procedure names in support-analysis-router.ts stay unchanged
// (they're the public API the frontend calls). Only the internal function
// names are migrated here.
//
// See docs/conventions/service-layer-conventions.md.
// ---------------------------------------------------------------------------

export interface TriggerAnalysisResult {
  analysisId: string | null;
  workflowId: string;
  alreadyInProgress: boolean;
}

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

export async function trigger(
  input: TriggerAnalysisInput & { workspaceId: string },
  dispatcher: WorkflowDispatcher
): Promise<TriggerAnalysisResult> {
  // Capability check: fail early if OpenAI key is not configured
  if (!env.OPENAI_API_KEY) {
    throw new ValidationError(
      "AI analysis is not configured. Set OPENAI_API_KEY in environment variables."
    );
  }

  // Verify conversation exists in this workspace
  const conversation = await prisma.supportConversation.findFirst({
    where: { id: input.conversationId, workspaceId: input.workspaceId },
  });
  if (!conversation) {
    throw new ConflictError("Conversation not found in this workspace.");
  }

  // Check for at least one indexed repository
  const indexedRepo = await prisma.repositoryIndexVersion.findFirst({
    where: { workspaceId: input.workspaceId, status: "active" },
  });
  if (!indexedRepo) {
    throw new ConflictError(
      "No indexed repositories found. Connect and sync a GitHub repository first."
    );
  }

  // Check for in-progress analysis (dedup)
  const existingAnalysis = await prisma.supportAnalysis.findFirst({
    where: {
      conversationId: input.conversationId,
      status: { in: [ANALYSIS_STATUS.gatheringContext, ANALYSIS_STATUS.analyzing] },
    },
  });
  if (existingAnalysis) {
    return {
      analysisId: existingAnalysis.id,
      workflowId: "",
      alreadyInProgress: true,
    };
  }

  // Dispatch workflow
  const dispatchResult = await dispatcher.startSupportAnalysisWorkflow({
    workspaceId: input.workspaceId,
    conversationId: input.conversationId,
    triggerType: "MANUAL",
  });

  return {
    analysisId: null,
    workflowId: dispatchResult.workflowId,
    alreadyInProgress: false,
  };
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

    await tx.supportConversationEvent.create({
      data: {
        workspaceId: input.workspaceId,
        conversationId: draft.conversationId,
        eventType: "DRAFT_APPROVED",
        eventSource: "OPERATOR",
        summary: input.editedBody ? "Draft edited and approved" : "Draft approved as-is",
        detailsJson: { draftId: input.draftId, editedByHuman: !!input.editedBody },
      },
    });

    return { draft, dispatchId: dispatch.id };
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
