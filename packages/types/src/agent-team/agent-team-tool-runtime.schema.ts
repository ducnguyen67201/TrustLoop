import { z } from "zod";

export const TOOL_EXECUTION_MODE = {
  directRead: "direct_read",
  sandboxRead: "sandbox_read",
  sandboxMutation: "sandbox_mutation",
  externalWrite: "external_write",
} as const;

export const toolExecutionModeValues = [
  TOOL_EXECUTION_MODE.directRead,
  TOOL_EXECUTION_MODE.sandboxRead,
  TOOL_EXECUTION_MODE.sandboxMutation,
  TOOL_EXECUTION_MODE.externalWrite,
] as const;

export const toolExecutionModeSchema = z.enum(toolExecutionModeValues);

export const SANDBOX_POLICY = {
  none: "none",
  readOnlyRepo: "read_only_repo",
  mutableWorktree: "mutable_worktree",
  browser: "browser",
  networkRestricted: "network_restricted",
} as const;

export const sandboxPolicyValues = [
  SANDBOX_POLICY.none,
  SANDBOX_POLICY.readOnlyRepo,
  SANDBOX_POLICY.mutableWorktree,
  SANDBOX_POLICY.browser,
  SANDBOX_POLICY.networkRestricted,
] as const;

export const sandboxPolicySchema = z.enum(sandboxPolicyValues);

export const TOOL_RUNTIME_ERROR_CODE = {
  sandboxRequired: "SANDBOX_REQUIRED",
  permissionDenied: "PERMISSION_DENIED",
  invalidArguments: "INVALID_ARGUMENTS",
  timeout: "TIMEOUT",
  externalWriteApprovalRequired: "EXTERNAL_WRITE_APPROVAL_REQUIRED",
} as const;

export const toolRuntimeErrorCodeValues = [
  TOOL_RUNTIME_ERROR_CODE.sandboxRequired,
  TOOL_RUNTIME_ERROR_CODE.permissionDenied,
  TOOL_RUNTIME_ERROR_CODE.invalidArguments,
  TOOL_RUNTIME_ERROR_CODE.timeout,
  TOOL_RUNTIME_ERROR_CODE.externalWriteApprovalRequired,
] as const;

export const toolRuntimeErrorCodeSchema = z.enum(toolRuntimeErrorCodeValues);

export const harnessToolDefinitionSchema = z.object({
  id: z.string().min(1),
  executionMode: toolExecutionModeSchema,
  requiresSandbox: z.boolean(),
  allowedSandboxPolicies: z.array(sandboxPolicySchema).default([]),
  idempotencyKeyFields: z.array(z.string().min(1)).default([]),
});

export const toolRuntimeSuccessSchema = z.object({
  ok: z.literal(true),
  toolCallId: z.string().min(1),
  resultArtifactId: z.string().min(1).nullable(),
  resultHash: z.string().min(1).nullable(),
  summary: z.string().min(1).nullable(),
});

export const toolRuntimeDeniedSchema = z.object({
  ok: z.literal(false),
  code: toolRuntimeErrorCodeSchema,
  message: z.string().min(1),
  recommendedNextJob: z.string().min(1).nullable().optional(),
});

export const toolRuntimeResultSchema = z.discriminatedUnion("ok", [
  toolRuntimeSuccessSchema,
  toolRuntimeDeniedSchema,
]);

export type ToolExecutionMode = z.infer<typeof toolExecutionModeSchema>;
export type SandboxPolicy = z.infer<typeof sandboxPolicySchema>;
export type ToolRuntimeErrorCode = z.infer<typeof toolRuntimeErrorCodeSchema>;
export type HarnessToolDefinition = z.infer<typeof harnessToolDefinitionSchema>;
export type ToolRuntimeSuccess = z.infer<typeof toolRuntimeSuccessSchema>;
export type ToolRuntimeDenied = z.infer<typeof toolRuntimeDeniedSchema>;
export type ToolRuntimeResult = z.infer<typeof toolRuntimeResultSchema>;
