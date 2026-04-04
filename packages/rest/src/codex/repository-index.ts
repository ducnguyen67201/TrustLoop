import { prisma } from "@shared/database";
import {
  buildRepositoryHealth,
  requireRepositorySnapshot,
} from "@shared/rest/codex/shared";
import type { WorkflowDispatcher } from "@shared/rest/temporal-dispatcher";
import { temporalWorkflowDispatcher } from "@shared/rest/temporal-dispatcher";
import {
  ConflictError,
  type RequestRepositorySyncRequest,
  type RequestRepositorySyncResponse,
  type UpdateRepositorySelectionRequest,
  type UpdateRepositorySelectionResponse,
  requestRepositorySyncResponseSchema,
  requestRepositorySyncSchema,
  updateRepositorySelectionRequestSchema,
  updateRepositorySelectionResponseSchema,
} from "@shared/types";

/**
 * Toggle whether a repository participates in indexing for the current workspace.
 */
export async function updateRepositorySelection(
  input: UpdateRepositorySelectionRequest
): Promise<UpdateRepositorySelectionResponse> {
  const parsed = updateRepositorySelectionRequestSchema.parse(input);
  const { repository } = await requireRepositorySnapshot(parsed.workspaceId, parsed.repositoryId);

  const updated = await prisma.repository.update({
    where: { id: repository.id },
    data: {
      selected: parsed.selected,
      updatedAt: new Date(),
    },
    include: {
      syncRequests: {
        orderBy: { requestedAt: "desc" },
        take: 1,
      },
      indexVersions: {
        where: { active: true },
        orderBy: { activatedAt: "desc" },
        take: 1,
      },
    },
  });

  return updateRepositorySelectionResponseSchema.parse({
    repository: {
      id: updated.id,
      owner: updated.owner,
      name: updated.name,
      fullName: updated.fullName,
      selected: updated.selected,
      defaultBranch: updated.defaultBranch,
      branchPolicy: updated.branchPolicy,
      indexHealth: buildRepositoryHealth({
        latestSyncRequest: updated.syncRequests[0] ?? null,
        activeVersion: updated.indexVersions[0] ?? null,
      }),
    },
  });
}

/**
 * Create a sync ingress record and enqueue the repository-index workflow on the codex queue.
 */
export async function requestRepositorySync(
  input: RequestRepositorySyncRequest,
  dispatcher: WorkflowDispatcher = temporalWorkflowDispatcher
): Promise<RequestRepositorySyncResponse> {
  const parsed = requestRepositorySyncSchema.parse(input);
  const { repository } = await requireRepositorySnapshot(parsed.workspaceId, parsed.repositoryId);

  if (!repository.selected) {
    throw new ConflictError("Select a repository before requesting sync.");
  }

  const syncRequest = await prisma.repositorySyncRequest.create({
    data: {
      workspaceId: parsed.workspaceId,
      repositoryId: parsed.repositoryId,
      triggerSource: parsed.triggerSource,
    },
  });

  const workflow = await dispatcher.startRepositoryIndexWorkflow({
    syncRequestId: syncRequest.id,
    workspaceId: parsed.workspaceId,
    repositoryId: parsed.repositoryId,
  });

  await prisma.repositorySyncRequest.update({
    where: { id: syncRequest.id },
    data: {
      workflowId: workflow.workflowId,
    },
  });

  return requestRepositorySyncResponseSchema.parse({
    syncRequestId: syncRequest.id,
    workflowId: workflow.workflowId,
    runId: workflow.runId,
    queue: workflow.queue,
  });
}
