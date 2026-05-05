import { AGENT_PROVIDER, agentProviderSchema } from "@shared/types/support/agent-provider.schema";
import { z } from "zod";

export const AGENT_TEAM_RUN_STATUS = {
  queued: "queued",
  running: "running",
  waiting: "waiting",
  completed: "completed",
  failed: "failed",
} as const;

export const agentTeamRunStatusValues = [
  AGENT_TEAM_RUN_STATUS.queued,
  AGENT_TEAM_RUN_STATUS.running,
  AGENT_TEAM_RUN_STATUS.waiting,
  AGENT_TEAM_RUN_STATUS.completed,
  AGENT_TEAM_RUN_STATUS.failed,
] as const;

export const agentTeamRunStatusSchema = z.enum(agentTeamRunStatusValues);

export const AGENT_TEAM_ROLE_SLUG = {
  drafter: "drafter",
  architect: "architect",
  reviewer: "reviewer",
  codeReader: "code_reader",
  prCreator: "pr_creator",
  rcaAnalyst: "rca_analyst",
} as const;

export const agentTeamRoleSlugValues = [
  AGENT_TEAM_ROLE_SLUG.drafter,
  AGENT_TEAM_ROLE_SLUG.architect,
  AGENT_TEAM_ROLE_SLUG.reviewer,
  AGENT_TEAM_ROLE_SLUG.codeReader,
  AGENT_TEAM_ROLE_SLUG.prCreator,
  AGENT_TEAM_ROLE_SLUG.rcaAnalyst,
] as const;

export const agentTeamRoleSlugSchema = z.enum(agentTeamRoleSlugValues);

export const AGENT_TEAM_CONFIG = {
  FAST: "FAST",
  STANDARD: "STANDARD",
  DEEP: "DEEP",
} as const;

export const agentTeamConfigValues = [
  AGENT_TEAM_CONFIG.FAST,
  AGENT_TEAM_CONFIG.STANDARD,
  AGENT_TEAM_CONFIG.DEEP,
] as const;

export const agentTeamConfigSchema = z.enum(agentTeamConfigValues);

export const AGENT_TEAM_TOOL_ID = {
  searchCode: "searchCode",
  searchSentry: "searchSentry",
  readRepositoryFile: "readRepositoryFile",
  createPullRequest: "createPullRequest",
} as const;

export const agentTeamToolIdValues = [
  AGENT_TEAM_TOOL_ID.searchCode,
  AGENT_TEAM_TOOL_ID.searchSentry,
  AGENT_TEAM_TOOL_ID.readRepositoryFile,
  AGENT_TEAM_TOOL_ID.createPullRequest,
] as const;

export const agentTeamToolIdSchema = z.enum(agentTeamToolIdValues);

export const agentTeamRoleCanvasPositionSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
});

export const agentTeamRoleMetadataSchema = z
  .object({
    canvas: z
      .object({
        position: agentTeamRoleCanvasPositionSchema.optional(),
      })
      .optional(),
  })
  .catchall(z.unknown());

export const agentTeamRoleSchema = z.preprocess(
  (value) => {
    if (value === null || typeof value !== "object") {
      return value;
    }

    const candidate = value as { roleKey?: unknown; slug?: unknown };
    return {
      ...candidate,
      roleKey: typeof candidate.roleKey === "string" ? candidate.roleKey : candidate.slug,
    };
  },
  z.object({
    id: z.string().min(1),
    teamId: z.string().min(1),
    roleKey: z.string().min(1),
    slug: agentTeamRoleSlugSchema,
    label: z.string().min(1),
    description: z.string().nullable().optional(),
    provider: agentProviderSchema.default(AGENT_PROVIDER.openai),
    model: z.string().nullable().optional(),
    toolIds: z.array(agentTeamToolIdSchema).default([]),
    systemPromptOverride: z.string().nullable().optional(),
    maxSteps: z.number().int().positive().max(32).default(8),
    sortOrder: z.number().int().min(0).default(0),
    metadata: agentTeamRoleMetadataSchema.nullable().optional(),
  })
);

export const agentTeamEdgeSchema = z.object({
  id: z.string().min(1),
  teamId: z.string().min(1),
  sourceRoleId: z.string().min(1),
  targetRoleId: z.string().min(1),
  condition: z.string().nullable().optional(),
  sortOrder: z.number().int().min(0).default(0),
});

export const agentTeamSnapshotSchema = z.object({
  roles: z.array(agentTeamRoleSchema).min(1),
  edges: z.array(agentTeamEdgeSchema).default([]),
});

export const agentTeamSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  isDefault: z.boolean().default(false),
  roles: z.array(agentTeamRoleSchema).default([]),
  edges: z.array(agentTeamEdgeSchema).default([]),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const listAgentTeamsResponseSchema = z.object({
  teams: z.array(agentTeamSchema),
});

export const getAgentTeamInputSchema = z.object({
  teamId: z.string().min(1),
});

export const createAgentTeamInputSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).optional(),
});

export const updateAgentTeamInputSchema = z.object({
  teamId: z.string().min(1),
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).optional(),
});

export const deleteAgentTeamInputSchema = z.object({
  teamId: z.string().min(1),
});

export const setDefaultAgentTeamInputSchema = z.object({
  teamId: z.string().min(1),
});

export const addAgentTeamRoleInputSchema = z.object({
  teamId: z.string().min(1),
  slug: agentTeamRoleSlugSchema,
  roleKey: z.string().trim().min(1).max(80).optional(),
  label: z.string().trim().min(1).max(80),
  description: z.string().trim().max(300).optional(),
  provider: agentProviderSchema.default(AGENT_PROVIDER.openai),
  model: z.string().trim().max(120).optional(),
  toolIds: z.array(agentTeamToolIdSchema).default([]),
  systemPromptOverride: z.string().trim().max(5000).optional(),
  maxSteps: z.number().int().positive().max(32).default(8),
});

export const updateAgentTeamRoleInputSchema = z.object({
  roleId: z.string().min(1),
  label: z.string().trim().min(1).max(80),
  description: z.string().trim().max(300).optional(),
  provider: agentProviderSchema.default(AGENT_PROVIDER.openai),
  model: z.string().trim().max(120).optional(),
  toolIds: z.array(agentTeamToolIdSchema).default([]),
  systemPromptOverride: z.string().trim().max(5000).optional(),
  maxSteps: z.number().int().positive().max(32).default(8),
});

export const removeAgentTeamRoleInputSchema = z.object({
  roleId: z.string().min(1),
});

export const addAgentTeamEdgeInputSchema = z.object({
  teamId: z.string().min(1),
  sourceRoleId: z.string().min(1),
  targetRoleId: z.string().min(1),
});

export const removeAgentTeamEdgeInputSchema = z.object({
  edgeId: z.string().min(1),
});

export const updateAgentTeamLayoutInputSchema = z.object({
  teamId: z.string().min(1),
  expectedUpdatedAt: z.iso.datetime(),
  positions: z
    .array(
      z.object({
        roleId: z.string().min(1),
        x: z.number().finite(),
        y: z.number().finite(),
      })
    )
    .min(1),
});

export type AgentTeamRunStatus = z.infer<typeof agentTeamRunStatusSchema>;
export type AgentTeamRoleSlug = z.infer<typeof agentTeamRoleSlugSchema>;
export type AgentTeamConfig = z.infer<typeof agentTeamConfigSchema>;
export type AgentTeamToolId = z.infer<typeof agentTeamToolIdSchema>;
export type AgentTeamRoleCanvasPosition = z.infer<typeof agentTeamRoleCanvasPositionSchema>;
export type AgentTeamRoleMetadata = z.infer<typeof agentTeamRoleMetadataSchema>;
export type AgentTeam = z.infer<typeof agentTeamSchema>;
export type ListAgentTeamsResponse = z.infer<typeof listAgentTeamsResponseSchema>;
export type AgentTeamRole = z.infer<typeof agentTeamRoleSchema>;
export type AgentTeamEdge = z.infer<typeof agentTeamEdgeSchema>;
export type AgentTeamSnapshot = z.infer<typeof agentTeamSnapshotSchema>;
export type GetAgentTeamInput = z.infer<typeof getAgentTeamInputSchema>;
export type CreateAgentTeamInput = z.infer<typeof createAgentTeamInputSchema>;
export type UpdateAgentTeamInput = z.infer<typeof updateAgentTeamInputSchema>;
export type DeleteAgentTeamInput = z.infer<typeof deleteAgentTeamInputSchema>;
export type SetDefaultAgentTeamInput = z.infer<typeof setDefaultAgentTeamInputSchema>;
export type AddAgentTeamRoleInput = z.infer<typeof addAgentTeamRoleInputSchema>;
export type UpdateAgentTeamRoleInput = z.infer<typeof updateAgentTeamRoleInputSchema>;
export type RemoveAgentTeamRoleInput = z.infer<typeof removeAgentTeamRoleInputSchema>;
export type AddAgentTeamEdgeInput = z.infer<typeof addAgentTeamEdgeInputSchema>;
export type RemoveAgentTeamEdgeInput = z.infer<typeof removeAgentTeamEdgeInputSchema>;
export type UpdateAgentTeamLayoutInput = z.infer<typeof updateAgentTeamLayoutInputSchema>;
