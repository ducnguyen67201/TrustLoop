import { processSlackWebhook } from "@shared/rest/services/support/support-ingress-service";
import { temporalWorkflowDispatcher } from "@shared/rest/temporal-dispatcher";
import { dispatchWorkflow } from "@shared/rest/workflow-router";
import {
  type HealthResponse,
  type WorkflowDispatchResponse,
  healthResponseSchema,
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

export async function processSlackWebhookFromHttpRequest(
  rawBody: string,
  headers: {
    signature: string | null;
    timestamp: string | null;
  }
) {
  return processSlackWebhook(rawBody, headers);
}
