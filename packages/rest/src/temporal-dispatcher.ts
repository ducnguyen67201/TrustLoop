import { env } from "@shared/env";
import {
  type AgentTeamRunWorkflowInput,
  type RepositoryIndexWorkflowInput,
  type SendDraftToSlackInput,
  type SupportSummaryWorkflowInput,
  type SupportWorkflowInput,
  TASK_QUEUES,
  type WorkflowDispatchResponse,
  workflowDispatchResponseSchema,
  workflowNames,
} from "@shared/types";
import { Client, Connection, WorkflowIdReusePolicy } from "@temporalio/client";
import { buildTemporalConnectionOptions } from "./temporal-connection";

export interface WorkflowDispatcher {
  startSupportWorkflow(input: SupportWorkflowInput): Promise<WorkflowDispatchResponse>;
  startAgentTeamRunWorkflow(input: AgentTeamRunWorkflowInput): Promise<WorkflowDispatchResponse>;
  startAgentTeamRunResumeWorkflow(
    input: AgentTeamRunWorkflowInput & { resumeNonce: string }
  ): Promise<WorkflowDispatchResponse>;
  startSupportSummaryWorkflow(
    input: SupportSummaryWorkflowInput
  ): Promise<WorkflowDispatchResponse>;
  startRepositoryIndexWorkflow(
    input: RepositoryIndexWorkflowInput
  ): Promise<WorkflowDispatchResponse>;
  startSendDraftToSlackWorkflow(input: SendDraftToSlackInput): Promise<WorkflowDispatchResponse>;
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
  async startSupportSummaryWorkflow(input) {
    const client = await getClient();
    // Deterministic workflow ID scoped to the conversation. Temporal rejects
    // a start while another run with the same ID is still in-flight, so burst
    // signals from ingress (several customer messages arriving back-to-back)
    // collapse to one in-flight summary instead of fanning out per-message.
    // After completion the ID becomes reusable, which is what we want for
    // future regeneration passes.
    const workflowId = `support-summary-${input.conversationId}`;
    const handle = await client.workflow.start(workflowNames.supportSummary, {
      args: [input],
      taskQueue: TASK_QUEUES.SUPPORT,
      workflowId,
      workflowIdReusePolicy: WorkflowIdReusePolicy.ALLOW_DUPLICATE,
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
  async startAgentTeamRunWorkflow(input) {
    const client = await getClient();
    const workflowId = `agent-team-run-${input.runId}`;
    const handle = await client.workflow.start(workflowNames.agentTeamRun, {
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
  async startAgentTeamRunResumeWorkflow(input) {
    const client = await getClient();
    // Same runId, new workflowId. Temporal rejects starting a workflow whose
    // id collides with a previously-completed execution, so the resume nonce
    // suffix gives every operator-triggered restart a fresh execution slot.
    const workflowId = `agent-team-run-${input.runId}-resume-${input.resumeNonce}`;
    const handle = await client.workflow.start(workflowNames.agentTeamRun, {
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
  async startSendDraftToSlackWorkflow(input) {
    const client = await getClient();
    // Semantic, deterministic workflow ID so a double-approved draft can never
    // post twice: Temporal rejects duplicates via REJECT_DUPLICATE policy.
    const workflowId = `send-draft-${input.draftId}`;
    const handle = await client.workflow.start(workflowNames.sendDraftToSlack, {
      args: [input],
      taskQueue: TASK_QUEUES.SUPPORT,
      workflowId,
      workflowIdReusePolicy: WorkflowIdReusePolicy.REJECT_DUPLICATE,
    });

    return workflowDispatchResponseSchema.parse({
      workflowId,
      runId: handle.firstExecutionRunId,
      queue: TASK_QUEUES.SUPPORT,
    });
  },
};
