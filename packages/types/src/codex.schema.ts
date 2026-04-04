import { z } from "zod";

export const GITHUB_CONNECTION_STATUS = {
  disconnected: "disconnected",
  connected: "connected",
  permissionGap: "permission_gap",
} as const;

export const REPOSITORY_HEALTH_STATUS = {
  needsSetup: "needs_setup",
  ready: "ready",
  syncing: "syncing",
  stale: "stale",
  error: "error",
} as const;

export const REPOSITORY_SYNC_REQUEST_STATUS = {
  pending: "pending",
  running: "running",
  completed: "completed",
  failed: "failed",
} as const;

export const REPOSITORY_SYNC_TRIGGER = {
  manual: "manual",
  webhook: "webhook",
} as const;

export const REPOSITORY_INDEX_STATUS = {
  building: "building",
  active: "active",
  failed: "failed",
} as const;

export const REPOSITORY_BRANCH_POLICY = {
  defaultBranchOnly: "default_branch_only",
  workspaceSelected: "workspace_selected",
} as const;

export const SEARCH_FEEDBACK_LABEL = {
  useful: "useful",
  offTarget: "off_target",
} as const;

export const PR_INTENT_STATUS = {
  validated: "validated",
} as const;

export const githubConnectionStatusSchema = z.enum([
  GITHUB_CONNECTION_STATUS.disconnected,
  GITHUB_CONNECTION_STATUS.connected,
  GITHUB_CONNECTION_STATUS.permissionGap,
]);

export const repositoryHealthStatusSchema = z.enum([
  REPOSITORY_HEALTH_STATUS.needsSetup,
  REPOSITORY_HEALTH_STATUS.ready,
  REPOSITORY_HEALTH_STATUS.syncing,
  REPOSITORY_HEALTH_STATUS.stale,
  REPOSITORY_HEALTH_STATUS.error,
]);

export const repositorySyncRequestStatusSchema = z.enum([
  REPOSITORY_SYNC_REQUEST_STATUS.pending,
  REPOSITORY_SYNC_REQUEST_STATUS.running,
  REPOSITORY_SYNC_REQUEST_STATUS.completed,
  REPOSITORY_SYNC_REQUEST_STATUS.failed,
]);

export const repositorySyncTriggerSchema = z.enum([
  REPOSITORY_SYNC_TRIGGER.manual,
  REPOSITORY_SYNC_TRIGGER.webhook,
]);

export const repositoryIndexStatusSchema = z.enum([
  REPOSITORY_INDEX_STATUS.building,
  REPOSITORY_INDEX_STATUS.active,
  REPOSITORY_INDEX_STATUS.failed,
]);

export const repositoryBranchPolicySchema = z.enum([
  REPOSITORY_BRANCH_POLICY.defaultBranchOnly,
  REPOSITORY_BRANCH_POLICY.workspaceSelected,
]);

export const searchFeedbackLabelSchema = z.enum([
  SEARCH_FEEDBACK_LABEL.useful,
  SEARCH_FEEDBACK_LABEL.offTarget,
]);

export const prIntentStatusSchema = z.enum([PR_INTENT_STATUS.validated]);

export const workspaceSummarySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
});

export const githubConnectionSummarySchema = z.object({
  status: githubConnectionStatusSchema,
  installationOwner: z.string().nullable(),
  connectedAt: z.iso.datetime().nullable(),
  missingPermissions: z.array(z.string()),
});

export const repositoryIndexHealthSchema = z.object({
  status: repositoryHealthStatusSchema,
  staleAfterMinutes: z.number().int().positive(),
  lastSyncRequestedAt: z.iso.datetime().nullable(),
  lastCompletedAt: z.iso.datetime().nullable(),
  activeCommitSha: z.string().nullable(),
  activeVersionId: z.string().nullable(),
  lastErrorMessage: z.string().nullable(),
  syncStageLabel: z.string().nullable(),
});

export const repositorySummarySchema = z.object({
  id: z.string().min(1),
  owner: z.string().min(1),
  name: z.string().min(1),
  fullName: z.string().min(1),
  selected: z.boolean(),
  defaultBranch: z.string().min(1),
  branchPolicy: repositoryBranchPolicySchema,
  indexHealth: repositoryIndexHealthSchema,
});

export const codexSettingsResponseSchema = z.object({
  workspace: workspaceSummarySchema,
  githubConnection: githubConnectionSummarySchema,
  repositories: z.array(repositorySummarySchema),
});

export const GITHUB_OAUTH_STATUS = {
  CONNECTED: "connected",
  DENIED: "denied",
  ERROR: "error",
} as const;
export type GithubOAuthStatus = (typeof GITHUB_OAUTH_STATUS)[keyof typeof GITHUB_OAUTH_STATUS];

export const githubOAuthStatePayloadSchema = z.object({
  workspaceId: z.string(),
  nonce: z.string(),
  expiresAt: z.number(),
});
export type GithubOAuthStatePayload = z.infer<typeof githubOAuthStatePayloadSchema>;

export const connectGithubInstallationRequestSchema = z.object({
  workspaceId: z.string().min(1),
  githubInstallationId: z.number().int().positive(),
  installationOwner: z.string().min(1),
});

export const connectGithubInstallationResponseSchema = z.object({
  connection: githubConnectionSummarySchema,
  repositories: z.array(repositorySummarySchema),
});

export const updateRepositorySelectionRequestSchema = z.object({
  workspaceId: z.string().min(1),
  repositoryId: z.string().min(1),
  selected: z.boolean(),
});

export const updateRepositorySelectionResponseSchema = z.object({
  repository: repositorySummarySchema,
});

export const requestRepositorySyncSchema = z.object({
  workspaceId: z.string().min(1),
  repositoryId: z.string().min(1),
  triggerSource: repositorySyncTriggerSchema.default(REPOSITORY_SYNC_TRIGGER.manual),
});

export const requestRepositorySyncResponseSchema = z.object({
  syncRequestId: z.string().min(1),
  workflowId: z.string().min(1),
  runId: z.string().min(1),
  queue: z.string().min(1),
});

export const searchScoreBreakdownSchema = z.object({
  keywordScore: z.number(),
  semanticScore: z.number(),
  pathScore: z.number(),
  freshnessScore: z.number(),
  mergedScore: z.number(),
});

export const searchEvidenceResultSchema = z.object({
  resultId: z.string().min(1),
  filePath: z.string().min(1),
  lineStart: z.number().int().positive(),
  lineEnd: z.number().int().positive(),
  snippet: z.string().min(1),
  symbolName: z.string().nullable(),
  commitSha: z.string().nullable(),
  freshnessStatus: repositoryHealthStatusSchema,
  scoreBreakdown: searchScoreBreakdownSchema,
});

export const searchCodeRequestSchema = z.object({
  workspaceId: z.string().min(1),
  repositoryId: z.string().min(1),
  query: z.string().min(3),
  limit: z.number().int().positive().max(10).default(5),
});

export const searchCodeResponseSchema = z.object({
  queryAuditId: z.string().min(1),
  rankProfileVersion: z.string().min(1),
  repositoryHealthStatus: repositoryHealthStatusSchema,
  fallbackRankingUsed: z.boolean(),
  results: z.array(searchEvidenceResultSchema),
});

export const searchFeedbackRequestSchema = z.object({
  workspaceId: z.string().min(1),
  queryAuditId: z.string().min(1),
  searchResultId: z.string().min(1),
  label: searchFeedbackLabelSchema,
  note: z.string().trim().max(280).optional(),
});

export const searchFeedbackResponseSchema = z.object({
  feedbackId: z.string().min(1),
  storedAt: z.iso.datetime(),
});

export const preparePrIntentRequestSchema = z.object({
  workspaceId: z.string().min(1),
  repositoryId: z.string().min(1),
  title: z.string().trim().min(5).max(120),
  targetBranch: z.string().trim().min(1).max(120),
  problemStatement: z.string().trim().min(12).max(2000),
  riskSummary: z.string().trim().min(12).max(1000),
  validationChecklist: z.array(z.string().trim().min(3).max(200)).min(1).max(8),
  humanApproval: z.literal(true),
});

export const preparePrIntentResponseSchema = z.object({
  intentId: z.string().min(1),
  status: prIntentStatusSchema,
  repositoryHealthStatus: repositoryHealthStatusSchema,
  acceptedAt: z.iso.datetime(),
});

export type GithubConnectionStatus = z.infer<typeof githubConnectionStatusSchema>;
export type RepositoryHealthStatus = z.infer<typeof repositoryHealthStatusSchema>;
export type RepositorySyncRequestStatus = z.infer<typeof repositorySyncRequestStatusSchema>;
export type RepositorySyncTrigger = z.infer<typeof repositorySyncTriggerSchema>;
export type RepositoryIndexStatus = z.infer<typeof repositoryIndexStatusSchema>;
export type RepositoryBranchPolicy = z.infer<typeof repositoryBranchPolicySchema>;
export type SearchFeedbackLabel = z.infer<typeof searchFeedbackLabelSchema>;
export type PrIntentStatus = z.infer<typeof prIntentStatusSchema>;
export type WorkspaceSummary = z.infer<typeof workspaceSummarySchema>;
export type GithubConnectionSummary = z.infer<typeof githubConnectionSummarySchema>;
export type RepositoryIndexHealth = z.infer<typeof repositoryIndexHealthSchema>;
export type RepositorySummary = z.infer<typeof repositorySummarySchema>;
export type CodexSettingsResponse = z.infer<typeof codexSettingsResponseSchema>;
export type ConnectGithubInstallationRequest = z.infer<
  typeof connectGithubInstallationRequestSchema
>;
export type ConnectGithubInstallationResponse = z.infer<
  typeof connectGithubInstallationResponseSchema
>;
export type UpdateRepositorySelectionRequest = z.infer<
  typeof updateRepositorySelectionRequestSchema
>;
export type UpdateRepositorySelectionResponse = z.infer<
  typeof updateRepositorySelectionResponseSchema
>;
export type RequestRepositorySyncRequest = z.infer<typeof requestRepositorySyncSchema>;
export type RequestRepositorySyncResponse = z.infer<typeof requestRepositorySyncResponseSchema>;
export type SearchScoreBreakdown = z.infer<typeof searchScoreBreakdownSchema>;
export type SearchEvidenceResult = z.infer<typeof searchEvidenceResultSchema>;
export type SearchCodeRequest = z.infer<typeof searchCodeRequestSchema>;
export type SearchCodeResponse = z.infer<typeof searchCodeResponseSchema>;
export type SearchFeedbackRequest = z.infer<typeof searchFeedbackRequestSchema>;
export type SearchFeedbackResponse = z.infer<typeof searchFeedbackResponseSchema>;
export type PreparePrIntentRequest = z.infer<typeof preparePrIntentRequestSchema>;
export type PreparePrIntentResponse = z.infer<typeof preparePrIntentResponseSchema>;
