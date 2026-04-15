import { env } from "@shared/env";
import {
  type AgentTeamRunWorkflowInput,
  type CodexWorkflowInput,
  type RepositoryIndexWorkflowInput,
  type SupportAnalysisWorkflowInput,
  type SupportWorkflowInput,
  type WorkflowDispatchResponse,
  workflowDispatchResponseSchema,
  workflowNames,
} from "@shared/types";
import { Client, Connection } from "@temporalio/client";

export interface WorkflowDispatcher {
  startSupportWorkflow(input: SupportWorkflowInput): Promise<WorkflowDispatchResponse>;
  startSupportAnalysisWorkflow(
    input: SupportAnalysisWorkflowInput
  ): Promise<WorkflowDispatchResponse>;
  startAgentTeamRunWorkflow(input: AgentTeamRunWorkflowInput): Promise<WorkflowDispatchResponse>;
  startRepositoryIndexWorkflow(
    input: RepositoryIndexWorkflowInput
  ): Promise<WorkflowDispatchResponse>;
  startCodexWorkflow(input: CodexWorkflowInput): Promise<WorkflowDispatchResponse>;
}

let temporalClient: Client | undefined;

async function getClient(): Promise<Client> {
  if (temporalClient) {
    return temporalClient;
  }

  const connection = await Connection.connect({ address: env.TEMPORAL_ADDRESS });
  temporalClient = new Client({ connection, namespace: env.TEMPORAL_NAMESPACE });
  return temporalClient;
}

export const temporalWorkflowDispatcher: WorkflowDispatcher = {
  async startSupportWorkflow(input) {
    const client = await getClient();
    const workflowId = `support-ingress-${input.canonicalIdempotencyKey}`;
    const handle = await client.workflow.start(workflowNames.supportInbox, {
      args: [input],
      taskQueue: env.TEMPORAL_TASK_QUEUE,
      workflowId,
    });

    return workflowDispatchResponseSchema.parse({
      workflowId,
      runId: handle.firstExecutionRunId,
      queue: env.TEMPORAL_TASK_QUEUE,
    });
  },
  async startSupportAnalysisWorkflow(input) {
    const client = await getClient();
    const workflowId = `support-analysis-${input.conversationId}-${Date.now()}`;
    const handle = await client.workflow.start(workflowNames.supportAnalysis, {
      args: [input],
      taskQueue: env.TEMPORAL_TASK_QUEUE,
      workflowId,
    });

    return workflowDispatchResponseSchema.parse({
      workflowId,
      runId: handle.firstExecutionRunId,
      queue: env.TEMPORAL_TASK_QUEUE,
    });
  },
  async startRepositoryIndexWorkflow(input) {
    const client = await getClient();
    const workflowId = `repository-index-${input.syncRequestId}`;
    const handle = await client.workflow.start(workflowNames.repositoryIndex, {
      args: [input],
      taskQueue: env.CODEX_TASK_QUEUE,
      workflowId,
    });

    return workflowDispatchResponseSchema.parse({
      workflowId,
      runId: handle.firstExecutionRunId,
      queue: env.CODEX_TASK_QUEUE,
    });
  },
  async startAgentTeamRunWorkflow(input) {
    const client = await getClient();
    const workflowId = `agent-team-run-${input.runId}`;
    const handle = await client.workflow.start(workflowNames.agentTeamRun, {
      args: [input],
      taskQueue: env.CODEX_TASK_QUEUE,
      workflowId,
    });

    return workflowDispatchResponseSchema.parse({
      workflowId,
      runId: handle.firstExecutionRunId,
      queue: env.CODEX_TASK_QUEUE,
    });
  },
  async startCodexWorkflow(input) {
    const client = await getClient();
    const workflowId = `fix-pr-${input.analysisId}`;
    const handle = await client.workflow.start(workflowNames.fixPr, {
      args: [input],
      taskQueue: env.CODEX_TASK_QUEUE,
      workflowId,
    });

    return workflowDispatchResponseSchema.parse({
      workflowId,
      runId: handle.firstExecutionRunId,
      queue: env.CODEX_TASK_QUEUE,
    });
  },
};
