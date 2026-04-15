import { z } from "zod";

import { AGENT_TEAM_RUN_STATUS } from "./agent-team-core.schema";
import { agentTeamRunSummarySchema } from "./agent-team.schema";

export const AGENT_TEAM_RUN_STREAM_EVENT_TYPE = {
  snapshot: "snapshot",
  complete: "complete",
  error: "error",
} as const;

export const agentTeamRunStreamEventTypeValues = [
  AGENT_TEAM_RUN_STREAM_EVENT_TYPE.snapshot,
  AGENT_TEAM_RUN_STREAM_EVENT_TYPE.complete,
  AGENT_TEAM_RUN_STREAM_EVENT_TYPE.error,
] as const;

export const agentTeamRunStreamEventTypeSchema = z.enum(agentTeamRunStreamEventTypeValues);

export const agentTeamRunStreamEventSchema = z.object({
  runId: z.string().min(1),
  type: agentTeamRunStreamEventTypeSchema,
  run: agentTeamRunSummarySchema.nullable(),
  errorMessage: z.string().nullable().optional(),
  timestamp: z.iso.datetime(),
});

export const getLatestAgentTeamRunInputSchema = z.object({
  conversationId: z.string().min(1),
});

export const activeAgentTeamRunStatusSchema = z.union([
  z.literal(AGENT_TEAM_RUN_STATUS.queued),
  z.literal(AGENT_TEAM_RUN_STATUS.running),
]);

export type AgentTeamRunStreamEventType = z.infer<typeof agentTeamRunStreamEventTypeSchema>;
export type AgentTeamRunStreamEvent = z.infer<typeof agentTeamRunStreamEventSchema>;
export type GetLatestAgentTeamRunInput = z.infer<typeof getLatestAgentTeamRunInputSchema>;
