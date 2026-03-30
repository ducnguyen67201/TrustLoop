import {
  connectGithubInstallation,
  getCodexSettings,
  preparePullRequestIntent,
  recordSearchFeedback,
  requestRepositorySync,
  searchRepositoryCode,
  updateRepositorySelection,
} from "@shared/rest/codex";
import { temporalWorkflowDispatcher } from "@shared/rest/temporal-dispatcher";
import { dispatchWorkflow } from "@shared/rest/workflow-router";
import {
  type CodexSettingsResponse,
  type ConnectGithubInstallationResponse,
  type HealthResponse,
  type PreparePrIntentResponse,
  type RequestRepositorySyncResponse,
  type SearchCodeResponse,
  type SearchFeedbackResponse,
  type UpdateRepositorySelectionResponse,
  type WorkflowDispatchResponse,
  connectGithubInstallationRequestSchema,
  healthResponseSchema,
  preparePrIntentRequestSchema,
  requestRepositorySyncSchema,
  searchCodeRequestSchema,
  searchFeedbackRequestSchema,
  updateRepositorySelectionRequestSchema,
  workflowDispatchSchema,
} from "@shared/types";

export function getHealthResponse(): HealthResponse {
  return healthResponseSchema.parse({
    ok: true,
    service: "web",
    timestamp: new Date().toISOString(),
  });
}

export async function dispatchWorkflowFromHttpBody(
  body: unknown
): Promise<WorkflowDispatchResponse> {
  const request = workflowDispatchSchema.parse(body);
  return dispatchWorkflow(temporalWorkflowDispatcher, request);
}

export async function getCodexSettingsResponse(
  workspaceId?: string
): Promise<CodexSettingsResponse> {
  return getCodexSettings(workspaceId);
}

export async function connectGithubInstallationFromHttpBody(
  body: unknown
): Promise<ConnectGithubInstallationResponse> {
  return connectGithubInstallation(connectGithubInstallationRequestSchema.parse(body));
}

export async function updateRepositorySelectionFromHttpBody(
  body: unknown
): Promise<UpdateRepositorySelectionResponse> {
  return updateRepositorySelection(updateRepositorySelectionRequestSchema.parse(body));
}

export async function requestRepositorySyncFromHttpBody(
  body: unknown
): Promise<RequestRepositorySyncResponse> {
  return requestRepositorySync(requestRepositorySyncSchema.parse(body));
}

export async function searchRepositoryCodeFromHttpBody(body: unknown): Promise<SearchCodeResponse> {
  return searchRepositoryCode(searchCodeRequestSchema.parse(body));
}

export async function recordSearchFeedbackFromHttpBody(
  body: unknown
): Promise<SearchFeedbackResponse> {
  return recordSearchFeedback(searchFeedbackRequestSchema.parse(body));
}

export async function preparePrIntentFromHttpBody(body: unknown): Promise<PreparePrIntentResponse> {
  return preparePullRequestIntent(preparePrIntentRequestSchema.parse(body));
}
