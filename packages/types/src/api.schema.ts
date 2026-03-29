import { z } from "zod";

export const healthResponseSchema = z.object({
  ok: z.literal(true),
  service: z.string(),
  timestamp: z.iso.datetime(),
});

export const workflowDispatchResponseSchema = z.object({
  workflowId: z.string(),
  runId: z.string(),
  queue: z.string(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
export type WorkflowDispatchResponse = z.infer<typeof workflowDispatchResponseSchema>;
