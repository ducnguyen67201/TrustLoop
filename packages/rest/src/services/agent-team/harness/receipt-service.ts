import { type Prisma, prisma } from "@shared/database";
import {
  type AgentApprovalReceipt,
  type AgentDecisionGateResult,
  type AgentTeamJobReceipt,
  type AgentTeamJobType,
  type AgentTeamReceiptContextSection,
  type AgentTeamReceiptToolCall,
  type AgentTeamResolvedModelRoute,
  type ProviderCircuitBreakerSnapshot,
  agentTeamJobReceiptSchema,
} from "@shared/types";

export interface WriteReceiptInput {
  workspaceId: string;
  runId: string;
  jobId: string;
  jobType: AgentTeamJobType;
  attempt: number;
  provider: string;
  model: string;
  apiModel: string;
  inputTokenEstimate?: number | null;
  outputTokenEstimate?: number | null;
  totalDurationMs: number;
  compiledContextRef?: string | null;
  rawModelOutputRef?: string | null;
  rawModelOutputHash?: string | null;
  toolCalls?: AgentTeamReceiptToolCall[];
  contextSections?: AgentTeamReceiptContextSection[];
  controllerDecision: string;
  gateResults?: AgentDecisionGateResult[];
  approval?: AgentApprovalReceipt | null;
  resolvedRoute: AgentTeamResolvedModelRoute;
  circuitBreakerStateBeforeCall?: ProviderCircuitBreakerSnapshot | null;
  fallbackAttempted?: boolean;
  fallbackIndex?: number | null;
  fallbackBudgetRemaining?: Prisma.InputJsonObject | null;
}

type ReceiptRow = Awaited<ReturnType<typeof prisma.agentTeamJobReceipt.findUniqueOrThrow>>;

export async function write(input: WriteReceiptInput): Promise<AgentTeamJobReceipt> {
  const row = await prisma.agentTeamJobReceipt.upsert({
    where: {
      jobId_attempt: {
        jobId: input.jobId,
        attempt: input.attempt,
      },
    },
    create: {
      workspaceId: input.workspaceId,
      runId: input.runId,
      jobId: input.jobId,
      jobType: input.jobType,
      attempt: input.attempt,
      provider: input.provider,
      model: input.model,
      apiModel: input.apiModel,
      inputTokenEstimate: input.inputTokenEstimate ?? null,
      outputTokenEstimate: input.outputTokenEstimate ?? null,
      totalDurationMs: input.totalDurationMs,
      compiledContextRef: input.compiledContextRef ?? null,
      rawModelOutputRef: input.rawModelOutputRef ?? null,
      rawModelOutputHash: input.rawModelOutputHash ?? null,
      toolCalls: input.toolCalls ?? [],
      contextSections: input.contextSections ?? [],
      controllerDecision: input.controllerDecision,
      gateResults: input.gateResults ?? [],
      resolvedRoute: input.resolvedRoute,
      fallbackAttempted: input.fallbackAttempted ?? false,
      fallbackIndex: input.fallbackIndex ?? null,
      ...optionalJson("approval", input.approval),
      ...optionalJson("circuitBreakerStateBeforeCall", input.circuitBreakerStateBeforeCall),
      ...optionalJson("fallbackBudgetRemaining", input.fallbackBudgetRemaining),
    },
    update: {
      provider: input.provider,
      model: input.model,
      apiModel: input.apiModel,
      inputTokenEstimate: input.inputTokenEstimate ?? null,
      outputTokenEstimate: input.outputTokenEstimate ?? null,
      totalDurationMs: input.totalDurationMs,
      compiledContextRef: input.compiledContextRef ?? null,
      rawModelOutputRef: input.rawModelOutputRef ?? null,
      rawModelOutputHash: input.rawModelOutputHash ?? null,
      toolCalls: input.toolCalls ?? [],
      contextSections: input.contextSections ?? [],
      controllerDecision: input.controllerDecision,
      gateResults: input.gateResults ?? [],
      resolvedRoute: input.resolvedRoute,
      fallbackAttempted: input.fallbackAttempted ?? false,
      fallbackIndex: input.fallbackIndex ?? null,
      ...optionalJson("approval", input.approval),
      ...optionalJson("circuitBreakerStateBeforeCall", input.circuitBreakerStateBeforeCall),
      ...optionalJson("fallbackBudgetRemaining", input.fallbackBudgetRemaining),
    },
  });

  return mapReceipt(row);
}

export async function get(receiptId: string): Promise<AgentTeamJobReceipt> {
  const row = await prisma.agentTeamJobReceipt.findUniqueOrThrow({ where: { id: receiptId } });
  return mapReceipt(row);
}

export async function listForRun(runId: string): Promise<AgentTeamJobReceipt[]> {
  const rows = await prisma.agentTeamJobReceipt.findMany({
    where: { runId },
    orderBy: { createdAt: "asc" },
  });

  return rows.map(mapReceipt);
}

function mapReceipt(row: ReceiptRow): AgentTeamJobReceipt {
  return agentTeamJobReceiptSchema.parse({
    ...row,
    createdAt: row.createdAt.toISOString(),
  });
}

function optionalJson<const TKey extends string, TValue>(
  key: TKey,
  value: TValue | null | undefined
): Record<TKey, TValue> | Record<string, never> {
  if (value == null) {
    return {};
  }

  return { [key]: value } as Record<TKey, TValue>;
}
