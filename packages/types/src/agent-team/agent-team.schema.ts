import { sessionDigestSchema } from "@shared/types/session-replay/session-digest.schema";
import { z } from "zod";
import {
  AGENT_TEAM_RUN_STATUS,
  addAgentTeamEdgeInputSchema,
  addAgentTeamRoleInputSchema,
  agentTeamEdgeSchema,
  agentTeamRoleSchema,
  agentTeamRunStatusSchema,
  agentTeamSchema,
  agentTeamSnapshotSchema,
  createAgentTeamInputSchema,
  deleteAgentTeamInputSchema,
  getAgentTeamInputSchema,
  listAgentTeamsResponseSchema,
  removeAgentTeamEdgeInputSchema,
  removeAgentTeamRoleInputSchema,
  setDefaultAgentTeamInputSchema,
  updateAgentTeamInputSchema,
  updateAgentTeamRoleInputSchema,
} from "./agent-team-core.schema";
import {
  agentTeamDialogueMessageSchema,
  agentTeamFactSchema,
  agentTeamOpenQuestionSchema,
  agentTeamRoleInboxSchema,
} from "./agent-team-dialogue.schema";

export const agentTeamRunWorkflowInputSchema = z.object({
  workspaceId: z.string().min(1),
  runId: z.string().min(1),
  teamId: z.string().min(1),
  teamSnapshot: agentTeamSnapshotSchema,
  conversationId: z.string().min(1).optional(),
  analysisId: z.string().min(1).optional(),
  threadSnapshot: z.string().min(1),
  sessionDigest: sessionDigestSchema.nullish(),
});

export const agentTeamRunWorkflowResultSchema = z.object({
  runId: z.string().min(1),
  status: agentTeamRunStatusSchema,
  messageCount: z.number().int().nonnegative(),
  completedRoleKeys: z.array(z.string().min(1)),
});

export const startAgentTeamRunInputSchema = z.object({
  conversationId: z.string().min(1),
  teamId: z.string().min(1).optional(),
  analysisId: z.string().min(1).optional(),
});

export const getAgentTeamRunInputSchema = z.object({
  runId: z.string().min(1),
});

export const agentTeamRunSummarySchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  teamId: z.string().min(1),
  conversationId: z.string().nullable(),
  analysisId: z.string().nullable(),
  status: agentTeamRunStatusSchema,
  workflowId: z.string().nullable(),
  startedAt: z.iso.datetime().nullable(),
  completedAt: z.iso.datetime().nullable(),
  errorMessage: z.string().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  teamSnapshot: agentTeamSnapshotSchema,
  messages: z.array(agentTeamDialogueMessageSchema).optional(),
  roleInboxes: z.array(agentTeamRoleInboxSchema).optional(),
  facts: z.array(agentTeamFactSchema).optional(),
  openQuestions: z.array(agentTeamOpenQuestionSchema).optional(),
});

export type AgentTeamRunWorkflowInput = z.infer<typeof agentTeamRunWorkflowInputSchema>;
export type AgentTeamRunWorkflowResult = z.infer<typeof agentTeamRunWorkflowResultSchema>;
export type StartAgentTeamRunInput = z.infer<typeof startAgentTeamRunInputSchema>;
export type GetAgentTeamRunInput = z.infer<typeof getAgentTeamRunInputSchema>;
export type AgentTeamRunSummary = z.infer<typeof agentTeamRunSummarySchema>;
