import { type Prisma, prisma } from "@shared/database";
import { env } from "@shared/env";
import * as harness from "@shared/rest/services/agent-team/harness";
import {
  AGENT_MODEL_CAPABILITY,
  AGENT_TEAM_ARTIFACT_TYPE,
  AGENT_TEAM_JOB_CLASS,
  AGENT_TEAM_JOB_STATUS,
  AGENT_TEAM_JOB_TYPE,
  AGENT_TEAM_MESSAGE_KIND,
  AGENT_TEAM_ROLE_SLUG,
  AGENT_TEAM_RUN_STATUS,
  AGENT_WORK_LEDGER_OUTCOME,
  ANALYSIS_CATEGORY,
  ANALYSIS_SEVERITY,
  ANALYSIS_STATUS,
  ANALYSIS_TRIGGER_TYPE,
  type AgentTeamArtifactType,
  type AgentTeamJob,
  type AgentTeamRole,
  type AgentTeamRoleTurnInput,
  type AgentTeamRoleTurnOutput,
  type AgentTeamRunWorkflowInput,
  type AgentTeamRunWorkflowResult,
  DRAFT_STATUS,
  type DraftResponseArtifactContent,
  type FinalSummaryArtifactContent,
  LLM_PROVIDER,
  type LlmProvider,
  type TriageSummaryArtifactContent,
  agentTeamRoleTurnOutputSchema,
  agentTeamRunStatusSchema,
  llmProviderSchema,
  restoreAgentTeamRunContext,
  transitionAgentTeamRun,
} from "@shared/types";
import { heartbeat } from "@temporalio/activity";

const AGENT_TIMEOUT_MS = 120_000;
const HEARTBEAT_INTERVAL_MS = 10_000;
const MAX_HARNESS_ATTEMPTS = 3;

interface CompletedHarnessJob {
  job: AgentTeamJob;
  artifactId: string;
}

export async function executeHarnessRun(
  input: AgentTeamRunWorkflowInput
): Promise<AgentTeamRunWorkflowResult> {
  if (!input.conversationId) {
    throw new Error("Harness agent-team run requires conversationId");
  }

  try {
    await markRunStarted(input.runId);

    const triageJob = await runTriageJob(input);
    const draftJob = await runDraftReplyJob(input, triageJob.artifactId);
    const finalJob = await runSynthesisJob(input, draftJob.artifactId);

    await projectHarnessRunToSupportAnalysis({
      input,
      draftJobId: draftJob.job.id,
    });

    await markRunCompleted(input.runId, AGENT_WORK_LEDGER_OUTCOME.replyReady);

    return {
      runId: input.runId,
      status: AGENT_TEAM_RUN_STATUS.completed,
      messageCount: 0,
      completedRoleKeys: [triageJob.job.type, draftJob.job.type, finalJob.type],
    };
  } catch (error) {
    if (isRetryableHarnessRunError(error)) {
      throw error;
    }

    const errorMessage = error instanceof Error ? error.message : String(error);
    await markRunFailed(input.runId, errorMessage);

    return {
      runId: input.runId,
      status: AGENT_TEAM_RUN_STATUS.failed,
      messageCount: 0,
      completedRoleKeys: [],
    };
  }
}

async function runTriageJob(input: AgentTeamRunWorkflowInput): Promise<CompletedHarnessJob> {
  const job = await createAndClaimJob(input, {
    type: AGENT_TEAM_JOB_TYPE.triage,
    jobClass: AGENT_TEAM_JOB_CLASS.control,
    objective: "Classify the support thread and choose the next harness job.",
    requiredArtifactTypes: [AGENT_TEAM_ARTIFACT_TYPE.triageSummary],
    controllerReason: "hard-cutover FAST harness starts with deterministic triage",
    plannedTransitionKey: `${input.runId}:triage`,
  });
  if (job.status === AGENT_TEAM_JOB_STATUS.completed) {
    return {
      job,
      artifactId: await findJobArtifactId(
        input.runId,
        job.id,
        AGENT_TEAM_ARTIFACT_TYPE.triageSummary
      ),
    };
  }

  const summary = summarizeThread(input);
  const content: TriageSummaryArtifactContent = {
    type: AGENT_TEAM_ARTIFACT_TYPE.triageSummary,
    issueType: "reply_only",
    summary,
    recommendedNextJob: "draft_reply",
    evidenceRefs: input.threadSnapshot.events.map((event) => event.at),
    missingEvidence: [],
  };

  const artifact = await harness.artifacts.write({
    workspaceId: input.workspaceId,
    runId: input.runId,
    jobId: job.id,
    type: AGENT_TEAM_ARTIFACT_TYPE.triageSummary,
    content,
    confidence: 0.72,
  });

  return {
    job: await harness.jobs.complete({ jobId: job.id, completedAt: new Date() }),
    artifactId: artifact.id,
  };
}

async function runDraftReplyJob(
  input: AgentTeamRunWorkflowInput,
  triageArtifactId: string
): Promise<CompletedHarnessJob> {
  const role = selectDrafterRole(input.teamSnapshot.roles);
  const providerPreference = resolveProviderPreference(role.provider);
  const job = await createAndClaimJob(input, {
    type: AGENT_TEAM_JOB_TYPE.draftReply,
    jobClass: AGENT_TEAM_JOB_CLASS.model,
    assignedRoleKey: role.roleKey,
    objective: "Produce a customer-ready draft reply from the compiled thread context.",
    inputArtifactIds: [triageArtifactId],
    requiredArtifactTypes: [AGENT_TEAM_ARTIFACT_TYPE.draftResponse],
    modelProviderPreference: providerPreference,
    controllerReason: "triage recommended draft_reply",
    plannedTransitionKey: `${input.runId}:draft_reply`,
  });
  if (job.status === AGENT_TEAM_JOB_STATUS.completed) {
    return {
      job,
      artifactId: await findJobArtifactId(
        input.runId,
        job.id,
        AGENT_TEAM_ARTIFACT_TYPE.draftResponse
      ),
    };
  }

  const { result, draftBody } = await runDraftModelTurn(input, role, job);
  const content: DraftResponseArtifactContent = {
    type: AGENT_TEAM_ARTIFACT_TYPE.draftResponse,
    body: draftBody,
    toneNotes: [],
    evidenceRefs: [],
    riskFlags: [],
  };

  const artifact = await harness.artifacts.write({
    workspaceId: input.workspaceId,
    runId: input.runId,
    jobId: job.id,
    type: AGENT_TEAM_ARTIFACT_TYPE.draftResponse,
    content,
    confidence: deriveDraftConfidence(result),
  });

  await harness.receipts.write({
    workspaceId: input.workspaceId,
    runId: input.runId,
    jobId: job.id,
    jobType: AGENT_TEAM_JOB_TYPE.draftReply,
    attempt: job.attempt,
    provider: resolveProvider(result.meta.provider),
    model: result.meta.model,
    apiModel: result.meta.model,
    totalDurationMs: result.meta.totalDurationMs,
    controllerDecision: "draft_reply emitted draft_response artifact",
    contextSections: [
      {
        name: "threadSnapshot",
        tokenEstimate: null,
        sourceRefs: input.threadSnapshot.events.map((event) => event.at),
      },
    ],
    resolvedRoute: {
      requestedProviderPreference: providerPreference,
      requestedModelPreference: role.model ?? null,
      requiredCapabilities: [AGENT_MODEL_CAPABILITY.jsonSchemaOutput],
      costTier: "balanced",
      resolvedProvider: resolveProvider(result.meta.provider),
      resolvedModel: result.meta.model,
      resolvedApiModel: result.meta.model,
      fallbackIndex: 0,
    },
  });

  return {
    job: await harness.jobs.complete({ jobId: job.id, completedAt: new Date() }),
    artifactId: artifact.id,
  };
}

async function runSynthesisJob(
  input: AgentTeamRunWorkflowInput,
  draftArtifactId: string
): Promise<AgentTeamJob> {
  const job = await createAndClaimJob(input, {
    type: AGENT_TEAM_JOB_TYPE.synthesize,
    jobClass: AGENT_TEAM_JOB_CLASS.projection,
    objective: "Commit final ledger summary and projection artifacts.",
    inputArtifactIds: [draftArtifactId],
    requiredArtifactTypes: [AGENT_TEAM_ARTIFACT_TYPE.finalSummary],
    controllerReason: "draft_response is ready for projection",
    plannedTransitionKey: `${input.runId}:synthesize`,
  });
  if (job.status === AGENT_TEAM_JOB_STATUS.completed) {
    return job;
  }

  const draftArtifact = (await harness.artifacts.listForRun(input.runId)).find(
    (artifact) => artifact.id === draftArtifactId
  );
  if (!draftArtifact) {
    throw new PermanentHarnessRunError(`Missing draft artifact ${draftArtifactId} for synthesis`);
  }
  const customerFacingSummary =
    draftArtifact?.content.type === AGENT_TEAM_ARTIFACT_TYPE.draftResponse
      ? draftArtifact.content.body
      : null;
  const content: FinalSummaryArtifactContent = {
    type: AGENT_TEAM_ARTIFACT_TYPE.finalSummary,
    outcome: "completed",
    operatorSummary: "Harness FAST path produced a draft reply and support-analysis projection.",
    customerFacingSummary,
    outputArtifactIds: [draftArtifact.id],
  };

  await harness.artifacts.write({
    workspaceId: input.workspaceId,
    runId: input.runId,
    jobId: job.id,
    type: AGENT_TEAM_ARTIFACT_TYPE.finalSummary,
    content,
    confidence: 0.8,
  });

  return harness.jobs.complete({ jobId: job.id, completedAt: new Date() });
}

async function createAndClaimJob(
  input: AgentTeamRunWorkflowInput,
  args: {
    type: (typeof AGENT_TEAM_JOB_TYPE)[keyof typeof AGENT_TEAM_JOB_TYPE];
    jobClass: (typeof AGENT_TEAM_JOB_CLASS)[keyof typeof AGENT_TEAM_JOB_CLASS];
    assignedRoleKey?: string;
    objective: string;
    inputArtifactIds?: string[];
    requiredArtifactTypes: string[];
    modelProviderPreference?: LlmProvider | null;
    controllerReason: string;
    plannedTransitionKey: string;
  }
): Promise<AgentTeamJob> {
  const existing = await harness.jobs.findByPlannedTransitionKey(
    input.runId,
    args.plannedTransitionKey
  );
  const job =
    existing ??
    (await harness.jobs.create({
      workspaceId: input.workspaceId,
      runId: input.runId,
      type: args.type,
      jobClass: args.jobClass,
      assignedRoleKey: args.assignedRoleKey ?? null,
      objective: args.objective,
      inputArtifactIds: args.inputArtifactIds ?? [],
      allowedToolIds: [],
      requiredArtifactTypes: args.requiredArtifactTypes,
      modelPolicy: {
        providerPreference: args.modelProviderPreference ?? null,
        requiredCapabilities: [AGENT_MODEL_CAPABILITY.jsonSchemaOutput],
        costTier: "balanced",
        fallbackAllowed: true,
      },
      budget: {
        maxModelCalls: args.jobClass === AGENT_TEAM_JOB_CLASS.model ? 1 : 0,
        maxToolCalls: 0,
        maxTokens: 8000,
        timeoutMs: AGENT_TIMEOUT_MS,
      },
      stopCondition: `${args.type} emitted required artifacts`,
      controllerReason: args.controllerReason,
      plannedTransitionKey: args.plannedTransitionKey,
    }));

  if (job.status === AGENT_TEAM_JOB_STATUS.completed) {
    return job;
  }
  if (job.status === AGENT_TEAM_JOB_STATUS.running) {
    return job;
  }
  if (job.status !== AGENT_TEAM_JOB_STATUS.queued) {
    throw new PermanentHarnessRunError(
      `Harness job ${job.id} is in non-runnable status "${job.status}"`
    );
  }

  const claimed = await harness.jobs.claim({
    jobId: job.id,
    workerId: "queue-harness-fast",
    leaseUntil: new Date(Date.now() + AGENT_TIMEOUT_MS),
  });

  if (!claimed) {
    throw new RetryableHarnessRunError(`Could not claim harness job ${job.id}`);
  }

  return claimed;
}

async function callAgentTeamTurn(input: AgentTeamRoleTurnInput): Promise<AgentTeamRoleTurnOutput> {
  heartbeat();
  const keepAlive = setInterval(() => heartbeat(), HEARTBEAT_INTERVAL_MS);

  let response: Response;
  try {
    try {
      response = await fetch(`${resolveAgentServiceUrl()}/team-turn`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${env.INTERNAL_SERVICE_KEY}`,
        },
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(AGENT_TIMEOUT_MS),
      });
    } catch (error) {
      throw new RetryableHarnessRunError(
        `Harness draft job could not reach agent service: ${formatError(error)}`
      );
    }
  } finally {
    clearInterval(keepAlive);
    heartbeat();
  }

  if (!response.ok) {
    const errorBody = await response.text();
    const message = `Harness draft job failed: ${response.status} ${errorBody.slice(0, 400)}`;
    if (response.status === 429 || response.status >= 500) {
      throw new RetryableHarnessRunError(message);
    }
    throw new PermanentHarnessRunError(message);
  }

  try {
    return agentTeamRoleTurnOutputSchema.parse(await response.json());
  } catch (error) {
    throw new RetryableHarnessRunError(
      `Harness draft job returned invalid structured output: ${formatError(error)}`
    );
  }
}

async function runDraftModelTurn(
  input: AgentTeamRunWorkflowInput,
  role: AgentTeamRole,
  job: AgentTeamJob
): Promise<{ result: AgentTeamRoleTurnOutput; draftBody: string }> {
  try {
    const result = await callAgentTeamTurn({
      workspaceId: input.workspaceId,
      conversationId: input.conversationId,
      runId: input.runId,
      turnIndex: 1,
      teamRoles: input.teamSnapshot.roles,
      role,
      requestSummary: input.threadSnapshot,
      inbox: [],
      acceptedFacts: [],
      openQuestions: [],
      recentThread: [],
      sessionDigest: input.sessionDigest ?? null,
    });

    return { result, draftBody: extractDraftBody(result) };
  } catch (error) {
    return finishDraftJobAfterError(job, error);
  }
}

async function projectHarnessRunToSupportAnalysis(args: {
  input: AgentTeamRunWorkflowInput;
  draftJobId: string;
}): Promise<void> {
  const conversationId = args.input.conversationId;
  if (!conversationId) {
    throw new Error("Harness projection requires conversationId");
  }

  const draftArtifact = (await harness.artifacts.listForRun(args.input.runId)).find(
    (artifact) => artifact.type === AGENT_TEAM_ARTIFACT_TYPE.draftResponse
  );
  const body =
    draftArtifact?.content.type === AGENT_TEAM_ARTIFACT_TYPE.draftResponse
      ? draftArtifact.content.body
      : "Harness completed without a draft body.";
  const summary = summarizeThread(args.input);

  await prisma.$transaction(async (tx) => {
    const existing = await tx.supportAnalysis.findFirst({
      where: {
        conversationId,
        agentTeamRunId: args.input.runId,
      },
      select: {
        id: true,
        drafts: { select: { id: true }, orderBy: { createdAt: "asc" }, take: 1 },
      },
    });
    const analysisData = {
      status: ANALYSIS_STATUS.analyzed,
      triggerType: ANALYSIS_TRIGGER_TYPE.auto,
      threadSnapshot: toPrismaJson(args.input.threadSnapshot),
      problemStatement: summary,
      likelySubsystem: "support",
      severity: ANALYSIS_SEVERITY.low,
      category: ANALYSIS_CATEGORY.question,
      confidence: draftArtifact?.confidence ?? 0.8,
      missingInfo: [],
      recommendedStance: "Reply with the generated support draft.",
      reasoningTrace: "Harness FAST path: triage -> draft_reply -> synthesize.",
      toolCallCount: 0,
      llmModel: null,
      errorMessage: null,
    };

    const analysis = existing
      ? await tx.supportAnalysis.update({
          where: { id: existing.id },
          data: analysisData,
          select: { id: true },
        })
      : await tx.supportAnalysis.create({
          data: {
            ...analysisData,
            workspaceId: args.input.workspaceId,
            conversationId,
            agentTeamRunId: args.input.runId,
          },
          select: { id: true },
        });

    const draftData = {
      conversationId,
      workspaceId: args.input.workspaceId,
      status: DRAFT_STATUS.awaitingApproval,
      draftBody: body,
      editedBody: null,
      internalNotes: "Generated by harness FAST path.",
      citations: [],
      tone: "supportive",
      errorMessage: null,
    };
    const draftId = existing?.drafts[0]?.id ?? null;
    if (draftId) {
      await tx.supportDraft.update({ where: { id: draftId }, data: draftData });
    } else {
      await tx.supportDraft.create({
        data: {
          ...draftData,
          analysisId: analysis.id,
        },
      });
    }
  });
}

async function markRunStarted(runId: string): Promise<void> {
  const current = await prisma.agentTeamRun.findUniqueOrThrow({ where: { id: runId } });
  const next =
    current.status === AGENT_TEAM_RUN_STATUS.waiting
      ? transitionAgentTeamRun(
          restoreAgentTeamRunContext(
            runId,
            agentTeamRunStatusSchema.parse(current.status),
            current.errorMessage
          ),
          {
            type: "resume",
          }
        )
      : current.status === AGENT_TEAM_RUN_STATUS.queued
        ? transitionAgentTeamRun(
            restoreAgentTeamRunContext(
              runId,
              agentTeamRunStatusSchema.parse(current.status),
              current.errorMessage
            ),
            { type: "start" }
          )
        : restoreAgentTeamRunContext(
            runId,
            agentTeamRunStatusSchema.parse(current.status),
            current.errorMessage
          );

  await prisma.agentTeamRun.update({
    where: { id: runId },
    data: {
      status: next.status,
      runtimeVersion: "harness_v2",
      startedAt: current.startedAt ?? new Date(),
      errorMessage: next.errorMessage,
    },
  });
}

async function markRunCompleted(
  runId: string,
  ledgerOutcome: (typeof AGENT_WORK_LEDGER_OUTCOME)[keyof typeof AGENT_WORK_LEDGER_OUTCOME]
): Promise<void> {
  const current = await prisma.agentTeamRun.findUniqueOrThrow({ where: { id: runId } });
  const next =
    current.status === AGENT_TEAM_RUN_STATUS.completed
      ? restoreAgentTeamRunContext(
          runId,
          agentTeamRunStatusSchema.parse(current.status),
          current.errorMessage
        )
      : transitionAgentTeamRun(
          restoreAgentTeamRunContext(
            runId,
            agentTeamRunStatusSchema.parse(current.status),
            current.errorMessage
          ),
          { type: "complete" }
        );

  await prisma.agentTeamRun.update({
    where: { id: runId },
    data: {
      status: next.status,
      ledgerOutcome,
      completedAt: new Date(),
      errorMessage: next.errorMessage,
    },
  });
}

async function markRunFailed(runId: string, errorMessage: string): Promise<void> {
  const current = await prisma.agentTeamRun.findUnique({ where: { id: runId } });
  if (!current || current.status === AGENT_TEAM_RUN_STATUS.failed) {
    return;
  }
  const next =
    current.status === AGENT_TEAM_RUN_STATUS.completed
      ? restoreAgentTeamRunContext(
          runId,
          agentTeamRunStatusSchema.parse(current.status),
          current.errorMessage
        )
      : transitionAgentTeamRun(
          restoreAgentTeamRunContext(
            runId,
            agentTeamRunStatusSchema.parse(current.status),
            current.errorMessage
          ),
          { type: "fail", error: errorMessage }
        );

  await prisma.agentTeamRun.update({
    where: { id: runId },
    data: {
      status: next.status,
      runtimeVersion: "harness_v2",
      ledgerOutcome: AGENT_WORK_LEDGER_OUTCOME.failed,
      completedAt: new Date(),
      errorMessage: next.errorMessage,
    },
  });
}

function selectDrafterRole(roles: AgentTeamRole[]): AgentTeamRole {
  const role = roles.find((candidate) => candidate.slug === AGENT_TEAM_ROLE_SLUG.drafter);
  if (!role) {
    throw new Error("Harness FAST path requires a drafter role in the team snapshot");
  }

  return role;
}

function extractDraftBody(result: AgentTeamRoleTurnOutput): string {
  const proposal = result.messages.find(
    (message) => message.kind === AGENT_TEAM_MESSAGE_KIND.proposal
  );
  const body = proposal?.content.trim();
  if (!body) {
    throw new RetryableHarnessRunError("Harness draft job did not emit a proposal message");
  }

  return body;
}

function deriveDraftConfidence(result: AgentTeamRoleTurnOutput): number {
  const confidence = result.proposedFacts[0]?.confidence ?? 0.72;
  return Math.max(0, Math.min(confidence, 1));
}

function resolveProvider(provider: string): LlmProvider {
  const parsed = llmProviderSchema.safeParse(provider);
  return parsed.success ? parsed.data : LLM_PROVIDER.openai;
}

function resolveProviderPreference(provider: string): LlmProvider | null {
  const parsed = llmProviderSchema.safeParse(provider);
  if (!parsed.success || parsed.data === LLM_PROVIDER.openai) {
    return null;
  }

  return parsed.data;
}

async function finishDraftJobAfterError(job: AgentTeamJob, error: unknown): Promise<never> {
  const errorMessage = formatError(error);
  if (isRetryableHarnessRunError(error) && job.attempt < MAX_HARNESS_ATTEMPTS) {
    await harness.jobs.retry({
      jobId: job.id,
      reason: errorMessage,
      nextAttemptAt: new Date(),
    });
    throw error;
  }

  await harness.jobs.fail({
    jobId: job.id,
    errorMessage,
  });
  throw error instanceof PermanentHarnessRunError
    ? error
    : new PermanentHarnessRunError(errorMessage);
}

async function findJobArtifactId(
  runId: string,
  jobId: string,
  type: AgentTeamArtifactType
): Promise<string> {
  const artifact = (await harness.artifacts.listForRun(runId)).find(
    (candidate) => candidate.jobId === jobId && candidate.type === type
  );
  if (!artifact) {
    throw new PermanentHarnessRunError(`Harness job ${jobId} completed without ${type} artifact`);
  }

  return artifact.id;
}

function isRetryableHarnessRunError(error: unknown): error is RetryableHarnessRunError {
  return error instanceof RetryableHarnessRunError;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

class RetryableHarnessRunError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RetryableHarnessRunError";
  }
}

class PermanentHarnessRunError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermanentHarnessRunError";
  }
}

function summarizeThread(input: AgentTeamRunWorkflowInput): string {
  const latestSummary = input.threadSnapshot.events
    .map((event) => event.summary)
    .filter((summary): summary is string => Boolean(summary?.trim()))
    .at(-1);

  return latestSummary ?? `Support thread ${input.threadSnapshot.threadTs} needs review.`;
}

function resolveAgentServiceUrl(): string {
  return env.AGENT_SERVICE_URL ?? "http://localhost:3100";
}

function toPrismaJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
