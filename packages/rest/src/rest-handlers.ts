import * as codex from "@shared/rest/codex";
import * as supportIngress from "@shared/rest/services/support/support-ingress-service";
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
  return codex.getSettings(workspaceId);
}

export async function connectGithubInstallationFromHttpBody(
  body: unknown
): Promise<ConnectGithubInstallationResponse> {
  return codex.connectGithubInstallation(connectGithubInstallationRequestSchema.parse(body));
}

export async function updateRepositorySelectionFromHttpBody(
  body: unknown
): Promise<UpdateRepositorySelectionResponse> {
  return codex.updateRepositorySelection(updateRepositorySelectionRequestSchema.parse(body));
}

export async function requestRepositorySyncFromHttpBody(
  body: unknown
): Promise<RequestRepositorySyncResponse> {
  return codex.requestRepositorySync(requestRepositorySyncSchema.parse(body));
}

export async function searchRepositoryCodeFromHttpBody(body: unknown): Promise<SearchCodeResponse> {
  return codex.searchRepositoryCode(searchCodeRequestSchema.parse(body));
}

export async function recordSearchFeedbackFromHttpBody(
  body: unknown
): Promise<SearchFeedbackResponse> {
  return codex.recordSearchFeedback(searchFeedbackRequestSchema.parse(body));
}

export async function preparePrIntentFromHttpBody(body: unknown): Promise<PreparePrIntentResponse> {
  return codex.preparePullRequestIntent(preparePrIntentRequestSchema.parse(body));
}

export async function processSlackWebhookFromHttpRequest(
  rawBody: string,
  headers: {
    signature: string | null;
    timestamp: string | null;
  }
) {
  return supportIngress.processWebhook(rawBody, headers);
}
