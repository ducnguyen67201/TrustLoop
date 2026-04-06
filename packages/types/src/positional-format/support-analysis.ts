import { z } from "zod";

/**
 * Positional JSON format for support analysis LLM output compression.
 *
 * Reduces output tokens by ~70-80% using short field names and numeric codes.
 * Used by apps/agents (primary) and apps/queue (future workflows).
 *
 * COMPRESSED → EXPANDED mapping:
 *
 *   { "a": { "p", "s", "v", "c", "f", "m", "t" }, "d": { "b", "n", "x", "o" } | null }
 *       ↓
 *   { "analysis": { "problemStatement", ... }, "draft": { "body", ... } | null }
 */

// ── Code Mappings ───────────────────────────────────────────────────

export const SEVERITY_CODES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export const CATEGORY_CODES = [
  "BUG",
  "QUESTION",
  "FEATURE_REQUEST",
  "CONFIGURATION",
  "UNKNOWN",
] as const;
export const TONE_CODES = ["professional", "empathetic", "technical"] as const;

// ── Compressed Schema (what the LLM returns) ────────────────────────

// Citations as flat strings: "filepath:line|snippet" or "filepath|snippet"
const compressedCitationSchema = z.string();

const compressedAnalysisSchema = z.object({
  p: z.string(),
  s: z.string(),
  v: z.number().int().min(0).max(3),
  c: z.number().int().min(0).max(4),
  f: z.number().min(0).max(1),
  m: z.array(z.string()),
  t: z.string(),
});

const compressedDraftSchema = z.object({
  b: z.string(),
  n: z.string(),
  x: z.array(compressedCitationSchema),
  o: z.number().int().min(0).max(2),
});

export const compressedAnalysisOutputSchema = z.object({
  a: compressedAnalysisSchema,
  d: compressedDraftSchema.nullable(),
});

export type CompressedAnalysisOutput = z.infer<typeof compressedAnalysisOutputSchema>;

// ── Reconstruction (compressed → full schema) ───────────────────────

type Severity = (typeof SEVERITY_CODES)[number];
type Category = (typeof CATEGORY_CODES)[number];
type Tone = (typeof TONE_CODES)[number];

export type ReconstructedAnalysisOutput = {
  analysis: {
    problemStatement: string;
    likelySubsystem: string;
    severity: Severity;
    category: Category;
    confidence: number;
    missingInfo: string[];
    reasoningTrace: string;
  };
  draft: {
    body: string;
    internalNotes: string;
    citations: Array<{ file: string; line?: number; text: string }>;
    tone: Tone;
  } | null;
};

function parseCitation(raw: string): { file: string; line?: number; text: string } {
  const pipeIdx = raw.indexOf("|");
  if (pipeIdx === -1) return { file: raw, text: "" };

  const filePart = raw.slice(0, pipeIdx);
  const text = raw.slice(pipeIdx + 1);

  const colonIdx = filePart.lastIndexOf(":");
  if (colonIdx > 0) {
    const maybeLine = Number(filePart.slice(colonIdx + 1));
    if (!Number.isNaN(maybeLine) && maybeLine > 0) {
      return { file: filePart.slice(0, colonIdx), line: maybeLine, text };
    }
  }

  return { file: filePart, text };
}

export function reconstructAnalysisOutput(
  compressed: CompressedAnalysisOutput
): ReconstructedAnalysisOutput {
  return {
    analysis: {
      problemStatement: compressed.a.p,
      likelySubsystem: compressed.a.s,
      severity: SEVERITY_CODES[compressed.a.v] ?? "LOW",
      category: CATEGORY_CODES[compressed.a.c] ?? "UNKNOWN",
      confidence: compressed.a.f,
      missingInfo: compressed.a.m,
      reasoningTrace: compressed.a.t,
    },
    draft: compressed.d
      ? {
          body: compressed.d.b,
          internalNotes: compressed.d.n,
          citations: compressed.d.x.map(parseCitation),
          tone: TONE_CODES[compressed.d.o] ?? "professional",
        }
      : null,
  };
}

// ── Prompt Instructions ─────────────────────────────────────────────

export const POSITIONAL_ANALYSIS_FORMAT_INSTRUCTIONS = `
Field reference:
  a = analysis
    p = problem statement (1-2 sentences)
    s = likely subsystem (e.g. "auth", "billing", "inbox")
    v = severity: 0=LOW, 1=MEDIUM, 2=HIGH, 3=CRITICAL
    c = category: 0=BUG, 1=QUESTION, 2=FEATURE_REQUEST, 3=CONFIGURATION, 4=UNKNOWN
    f = confidence: 0.0 to 1.0
    m = missing info array
    t = reasoning trace (brief investigation summary)
  d = draft response (null if not confident enough)
    b = body (the customer-facing response)
    n = internal notes (for support team only)
    x = citations array, each as flat string: "filepath:line|snippet" (e.g. "src/auth/reset.ts:42|clearTokens()")
    o = tone: 0=professional, 1=empathetic, 2=technical

Example with draft:
{"a":{"p":"Login fails after password reset","s":"auth","v":2,"c":0,"f":0.85,"m":[],"t":"Found token invalidation bug in auth/reset.ts:42"},"d":{"b":"We found the issue...","n":"Bug in token refresh logic","x":["src/auth/reset.ts:42|clearTokens()"],"o":0}}

Example without draft:
{"a":{"p":"Unclear error on checkout","s":"payments","v":1,"c":4,"f":0.3,"m":["Need error logs","Which payment method"],"t":"Searched checkout flow, no obvious bug found"},"d":null}`;
