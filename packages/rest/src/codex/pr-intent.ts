import { prisma } from "@shared/database";
import { requireRepositorySnapshot } from "@shared/rest/codex/shared";
import {
  ConflictError,
  type PreparePrIntentRequest,
  type PreparePrIntentResponse,
  REPOSITORY_HEALTH_STATUS,
  preparePrIntentRequestSchema,
  preparePrIntentResponseSchema,
} from "@shared/types";

/**
 * Validate and persist a human-approved PR intent. Stale or unindexed repos are blocked here.
 */
export async function preparePullRequestIntent(
  input: PreparePrIntentRequest
): Promise<PreparePrIntentResponse> {
  const parsed = preparePrIntentRequestSchema.parse(input);
  const { repository, summary } = await requireRepositorySnapshot(
    parsed.workspaceId,
    parsed.repositoryId
  );

  if (summary.indexHealth.status !== REPOSITORY_HEALTH_STATUS.ready) {
    throw new ConflictError("PR prep is blocked until the repository index is ready and fresh.");
  }

  const intent = await prisma.pullRequestIntent.create({
    data: {
      workspaceId: parsed.workspaceId,
      repositoryId: repository.id,
      title: parsed.title,
      targetBranch: parsed.targetBranch,
      problemStatement: parsed.problemStatement,
      riskSummary: parsed.riskSummary,
      validationChecklist: parsed.validationChecklist,
      status: "validated",
      repositoryHealthStatus: summary.indexHealth.status,
      humanApproval: parsed.humanApproval,
    },
  });

  return preparePrIntentResponseSchema.parse({
    intentId: intent.id,
    status: intent.status,
    repositoryHealthStatus: intent.repositoryHealthStatus,
    acceptedAt: intent.createdAt.toISOString(),
  });
}

/**
 * Load a previously prepared intent so the UI can show confirmation after redirect.
 */
export async function getPreparedPrIntent(intentId: string) {
  return prisma.pullRequestIntent.findUnique({
    where: { id: intentId },
    include: {
      repository: true,
    },
  });
}
