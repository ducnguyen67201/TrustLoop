import { z } from "zod";

/**
 * Positional JSON format for thread-summary LLM output.
 *
 * Intentionally a one-field object — reserved object shape so future
 * summaries can grow extra fields (language code, suggested topics) without
 * breaking the wire format.
 *
 *   { "s": "Customer asking for help with OAuth redirect loop" }
 *       ↓
 *   { "summary": "Customer asking for help with OAuth redirect loop" }
 */

// Keep in sync with the prompt cap below. 120 chars covers ~20 English words,
// leaving headroom for the occasional long compound noun. Hard-capped so a
// runaway model response can't push past the card's visual budget.
const SUMMARY_MAX_CHARS = 120;

export const compressedSummaryOutputSchema = z
  .object({
    s: z.string().trim().min(1).max(SUMMARY_MAX_CHARS),
  })
  .strict();

export type CompressedSummaryOutput = z.infer<typeof compressedSummaryOutputSchema>;

export type ReconstructedSummaryOutput = {
  summary: string;
};

export function reconstructSummaryOutput(
  compressed: CompressedSummaryOutput
): ReconstructedSummaryOutput {
  return { summary: compressed.s };
}

export const POSITIONAL_SUMMARY_FORMAT_INSTRUCTIONS = `
Field reference:
  s = summary (6-12 words, active voice, ${SUMMARY_MAX_CHARS} char cap)

Rules:
  - Summarize what the customer is asking for or what they are experiencing.
  - Use active voice. Start with a verb or noun phrase, not a name.
  - No greetings, no customer names, no "user". Refer to the author as "customer".
  - No quotes, no emoji, no trailing punctuation.

Examples:

{"s":"Customer asking for help fixing an OAuth redirect loop"}

{"s":"Customer reporting invoice totals off by one cent"}`;
