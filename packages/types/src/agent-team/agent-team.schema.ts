import { sessionDigestSchema } from "@shared/types/session-replay/session-digest.schema";
import { z } from "zod";
import {
  AGENT_TEAM_CONFIG,
  AGENT_TEAM_RUN_STATUS,
  addAgentTeamEdgeInputSchema,
  addAgentTeamRoleInputSchema,
  agentTeamConfigSchema,
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
  agentTeamThreadSnapshotInputSchema,
} from "./agent-team-dialogue.schema";

export const agentTeamRunWorkflowInputSchema = z.object({
  workspaceId: z.string().min(1),
  runId: z.string().min(1),
  teamId: z.string().min(1),
  teamSnapshot: agentTeamSnapshotSchema,
  teamConfig: agentTeamConfigSchema.default(AGENT_TEAM_CONFIG.DEEP),
  conversationId: z.string().min(1).optional(),
  analysisId: z.string().min(1).optional(),
  threadSnapshot: agentTeamThreadSnapshotInputSchema,
  sessionDigest: sessionDigestSchema.nullish(),
  // True when an operator triggered this workflow as a resume of an earlier
  // run that exited in `waiting`. Skips initializeRunState (which would
  // reset the architect's role-inbox to "initial-seed") and goes straight
  // into the claim loop. The synthetic message + inbox state were already
  // written by recordOperatorAnswer (or another resume primitive) before
  // dispatch.
  isResume: z.boolean().optional(),
  // Monotonic suffix for the Temporal workflow id on resumes; lets the same
  // runId be re-dispatched without colliding with the original execution.
  resumeNonce: z.string().min(1).optional(),
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
  teamConfig: agentTeamConfigSchema.default(AGENT_TEAM_CONFIG.DEEP),
  force: z.boolean().default(false),
});

export const getAgentTeamRunInputSchema = z.object({
  runId: z.string().min(1),
});

// Operator answers a question the architect routed to target=operator. Writes a
// synthetic answer message into the architect's inbox and flips its role-inbox
// state from blocked to queued. Does NOT restart the workflow — that is a
// separate explicit operator action via resumeAgentTeamRunInputSchema.
export const recordOperatorAnswerInputSchema = z.object({
  runId: z.string().min(1),
  questionId: z.string().min(1),
  answer: z.string().trim().min(1).max(4000),
});

// Operator-triggered re-dispatch of an agent-team run that exited in `waiting`.
// The workflow restarts with isResume=true so it skips initializeRunState and
// goes straight to the claim loop; it picks up the queued architect inbox left
// behind by recordOperatorAnswer.
export const resumeAgentTeamRunInputSchema = z.object({
  runId: z.string().min(1),
});

// Pending question = a question the architect dispatched that has not yet been
// answered. Computed server-side from the question_dispatched / question_answered
// event pair so the operator UI can render the resolution panel without parsing
// raw events. `askedByRoleKey` is the actor of the dispatched event (almost
// always the architect, but the schema doesn't hard-code that — any role can
// emit a resolution).
export const getPendingResolutionQuestionsInputSchema = z.object({
  runId: z.string().min(1),
});

export const pendingResolutionQuestionSchema = z.object({
  questionId: z.string().min(1),
  askedByRoleKey: z.string().min(1),
  target: z.enum(["customer", "operator", "internal"]),
  question: z.string().min(1),
  // For target=customer: operator/company-voice draft the architect prepared.
  suggestedReply: z.string().nullable(),
  // For target=internal: role key the question was routed to.
  assignedRole: z.string().nullable(),
  dispatchedAt: z.iso.datetime(),
});

export const getPendingResolutionQuestionsResponseSchema = z.array(pendingResolutionQuestionSchema);

export const agentTeamRunSummarySchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  teamId: z.string().min(1),
  conversationId: z.string().nullable(),
  analysisId: z.string().nullable(),
  teamConfig: agentTeamConfigSchema,
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
export type RecordOperatorAnswerInput = z.infer<typeof recordOperatorAnswerInputSchema>;
export type ResumeAgentTeamRunInput = z.infer<typeof resumeAgentTeamRunInputSchema>;
export type GetPendingResolutionQuestionsInput = z.infer<
  typeof getPendingResolutionQuestionsInputSchema
>;
export type PendingResolutionQuestion = z.infer<typeof pendingResolutionQuestionSchema>;
export type GetPendingResolutionQuestionsResponse = z.infer<
  typeof getPendingResolutionQuestionsResponseSchema
>;
export type AgentTeamRunSummary = z.infer<typeof agentTeamRunSummarySchema>;
