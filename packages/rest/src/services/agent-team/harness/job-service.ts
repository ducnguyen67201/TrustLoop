import { prisma } from "@shared/database";
import {
  AGENT_TEAM_JOB_STATUS,
  type AgentTeamJob,
  type AgentTeamJobBudget,
  type AgentTeamJobClass,
  type AgentTeamJobType,
  type AgentTeamModelPolicy,
  InvalidAgentTeamJobTransitionError,
  agentTeamJobSchema,
  agentTeamJobStatusSchema,
  restoreAgentTeamJobContext,
  transitionAgentTeamJob,
} from "@shared/types";

export interface CreateJobInput {
  workspaceId: string;
  runId: string;
  type: AgentTeamJobType;
  jobClass: AgentTeamJobClass;
  assignedRoleKey?: string | null;
  objective: string;
  inputArtifactIds?: string[];
  allowedToolIds?: string[];
  requiredArtifactTypes?: string[];
  modelPolicy: AgentTeamModelPolicy;
  budget: AgentTeamJobBudget;
  stopCondition: string;
  controllerReason: string;
  plannedTransitionKey?: string | null;
}

export interface ClaimJobInput {
  jobId: string;
  workerId: string;
  leaseUntil: Date;
}

export interface HeartbeatJobInput {
  jobId: string;
  leaseUntil: Date;
}

export interface RetryJobInput {
  jobId: string;
  reason: string;
  nextAttemptAt: Date;
}

export interface CompleteJobInput {
  jobId: string;
  completedAt: Date;
}

export interface BlockJobInput {
  jobId: string;
  reason: string;
}

export interface FailJobInput {
  jobId: string;
  errorMessage: string;
}

export interface SkipJobInput {
  jobId: string;
  reason: string;
}

export interface CancelJobInput {
  jobId: string;
  reason: string;
}

type JobRow = Awaited<ReturnType<typeof prisma.agentTeamJob.findUniqueOrThrow>>;

export async function create(input: CreateJobInput): Promise<AgentTeamJob> {
  let row: JobRow;
  try {
    row = await prisma.agentTeamJob.create({
      data: {
        workspaceId: input.workspaceId,
        runId: input.runId,
        type: input.type,
        jobClass: input.jobClass,
        status: AGENT_TEAM_JOB_STATUS.queued,
        assignedRoleKey: input.assignedRoleKey ?? null,
        objective: input.objective,
        inputArtifactIds: input.inputArtifactIds ?? [],
        allowedToolIds: input.allowedToolIds ?? [],
        requiredArtifactTypes: input.requiredArtifactTypes ?? [],
        modelPolicy: input.modelPolicy,
        budget: input.budget,
        stopCondition: input.stopCondition,
        controllerReason: input.controllerReason,
        plannedTransitionKey: input.plannedTransitionKey ?? null,
        startedAt: null,
        completedAt: null,
        errorMessage: null,
      },
    });
  } catch (error) {
    const existing =
      input.plannedTransitionKey && isUniqueConstraintError(error)
        ? await findByPlannedTransitionKey(input.runId, input.plannedTransitionKey)
        : null;
    if (!existing) {
      throw error;
    }
    return existing;
  }

  return mapJob(row);
}

export async function claim(input: ClaimJobInput): Promise<AgentTeamJob | null> {
  const current = await prisma.agentTeamJob.findUniqueOrThrow({ where: { id: input.jobId } });
  const next = transitionAgentTeamJob(restoreContext(current), {
    type: "claim",
    workerId: input.workerId,
    leaseUntil: input.leaseUntil.toISOString(),
  });

  const claimed = await prisma.agentTeamJob.updateMany({
    where: {
      id: input.jobId,
      status: AGENT_TEAM_JOB_STATUS.queued,
    },
    data: {
      status: next.status,
      leaseUntil: input.leaseUntil,
      startedAt: new Date(),
      errorMessage: next.errorMessage,
    },
  });

  if (claimed.count !== 1) {
    return null;
  }

  return find(input.jobId);
}

export async function heartbeat(input: HeartbeatJobInput): Promise<AgentTeamJob> {
  const current = await prisma.agentTeamJob.findUniqueOrThrow({ where: { id: input.jobId } });
  const next = transitionAgentTeamJob(restoreContext(current), {
    type: "heartbeat",
    leaseUntil: input.leaseUntil.toISOString(),
  });

  const row = await prisma.agentTeamJob.update({
    where: { id: input.jobId },
    data: { leaseUntil: input.leaseUntil, status: next.status },
  });

  return mapJob(row);
}

export async function complete(input: CompleteJobInput): Promise<AgentTeamJob> {
  const current = await prisma.agentTeamJob.findUniqueOrThrow({ where: { id: input.jobId } });
  const next = transitionAgentTeamJob(restoreContext(current), {
    type: "complete",
    completedAt: input.completedAt.toISOString(),
  });

  const row = await prisma.agentTeamJob.update({
    where: { id: input.jobId },
    data: {
      status: next.status,
      leaseUntil: null,
      completedAt: input.completedAt,
      errorMessage: next.errorMessage,
    },
  });

  return mapJob(row);
}

export async function block(input: BlockJobInput): Promise<AgentTeamJob> {
  const current = await prisma.agentTeamJob.findUniqueOrThrow({ where: { id: input.jobId } });
  const next = transitionAgentTeamJob(restoreContext(current), {
    type: "block",
    reason: input.reason,
  });

  const row = await prisma.agentTeamJob.update({
    where: { id: input.jobId },
    data: {
      status: next.status,
      leaseUntil: null,
      errorMessage: input.reason,
    },
  });

  return mapJob(row);
}

export async function retry(input: RetryJobInput): Promise<AgentTeamJob> {
  const current = await prisma.agentTeamJob.findUniqueOrThrow({ where: { id: input.jobId } });
  const next = transitionAgentTeamJob(restoreContext(current), {
    type: "retry",
    reason: input.reason,
    nextAttemptAt: input.nextAttemptAt.toISOString(),
  });

  const row = await prisma.agentTeamJob.update({
    where: { id: input.jobId },
    data: {
      status: next.status,
      attempt: next.attempt,
      leaseUntil: null,
      nextAttemptAt: input.nextAttemptAt,
      errorMessage: null,
    },
  });

  return mapJob(row);
}

export async function fail(input: FailJobInput): Promise<AgentTeamJob> {
  const current = await prisma.agentTeamJob.findUniqueOrThrow({ where: { id: input.jobId } });
  const next = transitionAgentTeamJob(restoreContext(current), {
    type: "fail",
    errorMessage: input.errorMessage,
  });

  const row = await prisma.agentTeamJob.update({
    where: { id: input.jobId },
    data: {
      status: next.status,
      leaseUntil: null,
      errorMessage: next.errorMessage,
    },
  });

  return mapJob(row);
}

export async function skip(input: SkipJobInput): Promise<AgentTeamJob> {
  return finishWithoutRunning(input.jobId, input.reason, "skip");
}

export async function cancel(input: CancelJobInput): Promise<AgentTeamJob> {
  return finishWithoutRunning(input.jobId, input.reason, "cancel");
}

export async function find(jobId: string): Promise<AgentTeamJob> {
  const row = await prisma.agentTeamJob.findUniqueOrThrow({ where: { id: jobId } });
  return mapJob(row);
}

export async function findByPlannedTransitionKey(
  runId: string,
  plannedTransitionKey: string
): Promise<AgentTeamJob | null> {
  const row = await prisma.agentTeamJob.findUnique({
    where: {
      runId_plannedTransitionKey: {
        runId,
        plannedTransitionKey,
      },
    },
  });

  return row ? mapJob(row) : null;
}

async function finishWithoutRunning(
  jobId: string,
  reason: string,
  eventType: "skip" | "cancel"
): Promise<AgentTeamJob> {
  const current = await prisma.agentTeamJob.findUniqueOrThrow({ where: { id: jobId } });
  const next = transitionAgentTeamJob(restoreContext(current), { type: eventType, reason });

  const row = await prisma.agentTeamJob.update({
    where: { id: jobId },
    data: {
      status: next.status,
      leaseUntil: null,
      errorMessage: reason,
    },
  });

  return mapJob(row);
}

function restoreContext(row: JobRow) {
  return restoreAgentTeamJobContext({
    jobId: row.id,
    status: agentTeamJobStatusSchema.parse(row.status),
    attempt: row.attempt,
    leaseUntil: row.leaseUntil?.toISOString() ?? null,
    errorMessage: row.errorMessage,
    blockedReason: row.status === AGENT_TEAM_JOB_STATUS.blocked ? row.errorMessage : null,
  });
}

function mapJob(row: JobRow): AgentTeamJob {
  return agentTeamJobSchema.parse({
    ...row,
    startedAt: row.startedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    leaseUntil: row.leaseUntil?.toISOString() ?? null,
    nextAttemptAt: row.nextAttemptAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

function isUniqueConstraintError(error: unknown): boolean {
  if (error === null || typeof error !== "object") {
    return false;
  }

  const candidate = error as { code?: unknown };
  return candidate.code === "P2002";
}

export { InvalidAgentTeamJobTransitionError };
