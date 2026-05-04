import { z } from "zod";

// Single source of truth for the lifecycle states of an agent-opened
// draft PR. The values mirror the Postgres enum AgentPullRequestStatus
// declared in packages/database/prisma/schema/codex.prisma. Use the
// const-enum object — never inline the string literals — so renames
// are a one-line change.
export const AGENT_PR_STATUS = {
  OPEN: "open",
  MERGED: "merged",
  CLOSED: "closed",
} as const;

export const agentPrStatusSchema = z.enum([
  AGENT_PR_STATUS.OPEN,
  AGENT_PR_STATUS.MERGED,
  AGENT_PR_STATUS.CLOSED,
]);

export type AgentPrStatus = z.infer<typeof agentPrStatusSchema>;
