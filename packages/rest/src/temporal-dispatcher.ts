import { env } from "@shared/env";
import {
  type CodexWorkflowInput,
  type RepositoryIndexWorkflowInput,
  type SupportAnalysisWorkflowInput,
  type SupportWorkflowInput,
  TASK_QUEUES,
  type WorkflowDispatchResponse,
  workflowDispatchResponseSchema,
  workflowNames,
} from "@shared/types";
import { Client, Connection } from "@temporalio/client";
import { buildTemporalConnectionOptions } from "./temporal-connection";

export interface WorkflowDispatcher {
  startSupportWorkflow(input: SupportWorkflowInput): Promise<WorkflowDispatchResponse>;
  startSupportAnalysisWorkflow(
    input: SupportAnalysisWorkflowInput
  ): Promise<WorkflowDispatchResponse>;
  startRepositoryIndexWorkflow(
    input: RepositoryIndexWorkflowInput
  ): Promise<WorkflowDispatchResponse>;
  startCodexWorkflow(input: CodexWorkflowInput): Promise<WorkflowDispatchResponse>;
}

let temporalClient: Client | undefined;

const CONNECT_TIMEOUT_MS = 5_000;

async function getClient(): Promise<Client> {
  if (temporalClient) {
    return temporalClient;
  }

  const connection = await Promise.race([
    Connection.connect(buildTemporalConnectionOptions()),
    new Promise<never>((_, reject) => {
      setTimeout(
        () =>
          reject(
            new Error(
              `Temporal Connection.connect() timed out after ${CONNECT_TIMEOUT_MS}ms (address=${env.TEMPORAL_ADDRESS}, namespace=${env.TEMPORAL_NAMESPACE})`
            )
          ),
        CONNECT_TIMEOUT_MS
      );
    }),
  ]);
  temporalClient = new Client({ connection, namespace: env.TEMPORAL_NAMESPACE });
  return temporalClient;
}

export const temporalWorkflowDispatcher: WorkflowDispatcher = {
  async startSupportWorkflow(input) {
    const client = await getClient();
    const workflowId = `support-ingress-${input.canonicalIdempotencyKey}`;
    const handle = await client.workflow.start(workflowNames.supportInbox, {
      args: [input],
      taskQueue: TASK_QUEUES.SUPPORT,
      workflowId,
    });

    return workflowDispatchResponseSchema.parse({
      workflowId,
      runId: handle.firstExecutionRunId,
      queue: TASK_QUEUES.SUPPORT,
    });
  },
  async startSupportAnalysisWorkflow(input) {
    const client = await getClient();
    const workflowId = `support-analysis-${input.conversationId}-${Date.now()}`;
    const handle = await client.workflow.start(workflowNames.supportAnalysis, {
      args: [input],
      taskQueue: TASK_QUEUES.SUPPORT,
      workflowId,
    });

    return workflowDispatchResponseSchema.parse({
      workflowId,
      runId: handle.firstExecutionRunId,
      queue: TASK_QUEUES.SUPPORT,
    });
  },
  async startRepositoryIndexWorkflow(input) {
    const client = await getClient();
    const workflowId = `repository-index-${input.syncRequestId}`;
    const handle = await client.workflow.start(workflowNames.repositoryIndex, {
      args: [input],
      taskQueue: TASK_QUEUES.CODEX,
      workflowId,
    });

    return workflowDispatchResponseSchema.parse({
      workflowId,
      runId: handle.firstExecutionRunId,
      queue: TASK_QUEUES.CODEX,
    });
  },
  async startCodexWorkflow(input) {
    const client = await getClient();
    const workflowId = `fix-pr-${input.analysisId}`;
    const handle = await client.workflow.start(workflowNames.fixPr, {
      args: [input],
      taskQueue: TASK_QUEUES.CODEX,
      workflowId,
    });

    return workflowDispatchResponseSchema.parse({
      workflowId,
      runId: handle.firstExecutionRunId,
      queue: TASK_QUEUES.CODEX,
    });
  },
};
