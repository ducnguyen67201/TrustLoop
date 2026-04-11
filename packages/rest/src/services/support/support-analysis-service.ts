import { prisma } from "@shared/database";
import { env } from "@shared/env";
import type { WorkflowDispatcher } from "@shared/rest/temporal-dispatcher";
import {
  ANALYSIS_STATUS,
  type ApproveDraftInput,
  ConflictError,
  DRAFT_STATUS,
  type DismissDraftInput,
  type TriggerAnalysisInput,
  ValidationError,
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
  input: ApproveDraftInput & { workspaceId: string; actorUserId: string }
) {
  const draft = await prisma.supportDraft.findFirst({
    where: { id: input.draftId, workspaceId: input.workspaceId },
  });
  if (!draft) {
    throw new ConflictError("Draft not found in this workspace.");
  }
  if (draft.status !== DRAFT_STATUS.awaitingApproval) {
    throw new ConflictError(`Cannot approve draft with status '${draft.status}'.`);
  }

  const updatedDraft = await prisma.supportDraft.update({
    where: { id: input.draftId },
    data: {
      status: DRAFT_STATUS.approved,
      approvedBy: input.actorUserId,
      approvedAt: new Date(),
      editedBody: input.editedBody ?? null,
    },
  });

  // Emit conversation event
  await prisma.supportConversationEvent.create({
    data: {
      workspaceId: input.workspaceId,
      conversationId: draft.conversationId,
      eventType: "DRAFT_APPROVED",
      eventSource: "OPERATOR",
      summary: input.editedBody ? "Draft edited and approved" : "Draft approved as-is",
      detailsJson: { draftId: draft.id, editedByHuman: !!input.editedBody },
    },
  });

  return updatedDraft;
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
  if (draft.status !== DRAFT_STATUS.awaitingApproval) {
    throw new ConflictError(`Cannot dismiss draft with status '${draft.status}'.`);
  }

  const updatedDraft = await prisma.supportDraft.update({
    where: { id: input.draftId },
    data: { status: DRAFT_STATUS.dismissed },
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
