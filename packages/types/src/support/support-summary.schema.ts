import { z } from "zod";

// Kept in sync with the LLM prompt cap in
// packages/types/src/positional-format/support-summary.ts. Both places hard-
// cap the string so a runaway model response can't push past the card.
export const THREAD_SUMMARY_MAX_CHARS = 120;

export const SUMMARY_TRIGGER_REASON = {
  ingress: "INGRESS",
  manual: "MANUAL",
} as const;

export const summaryTriggerReasonValues = [
  SUMMARY_TRIGGER_REASON.ingress,
  SUMMARY_TRIGGER_REASON.manual,
] as const;

export const summaryTriggerReasonSchema = z.enum(summaryTriggerReasonValues);

export const supportSummaryWorkflowInputSchema = z.object({
  workspaceId: z.string().min(1),
  conversationId: z.string().min(1),
  triggerReason: summaryTriggerReasonSchema.default(SUMMARY_TRIGGER_REASON.ingress),
});

export const supportSummaryWorkflowResultSchema = z.object({
  conversationId: z.string().min(1),
  summary: z.string().trim().min(1).max(THREAD_SUMMARY_MAX_CHARS).nullable(),
  generatedAt: z.iso.datetime().nullable(),
  sourceEventId: z.string().min(1).nullable(),
});

export const supportSummaryMessageSchema = z.object({
  id: z.string().min(1),
  text: z.string().trim().min(1),
  at: z.iso.datetime(),
});

export type SummaryTriggerReason = z.infer<typeof summaryTriggerReasonSchema>;
export type SupportSummaryMessage = z.infer<typeof supportSummaryMessageSchema>;
