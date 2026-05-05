import type { KnowledgeHit } from "@shared/types";
import type { PromptSection } from "../prompt-document";

// ---------------------------------------------------------------------------
// workspace-knowledge prompt blocks
//
// Convert KnowledgeHit[] (from the umbrella searcher) into PromptSection[]
// ready to be added to a PromptDocument. Three distinct sections per the
// codex outside-voice synthesis: code, manual notes, and past resolutions
// have different trust levels and must be framed differently in the prompt.
//
// Anti-stale framing on PAST_RESOLUTION blocks closes the codex finding that
// past replies may contain customer-specific promises, fixed bugs, or wrong
// answers approved under pressure. The block tells the model to use them as
// examples for tone/structure, not as authoritative policy.
//
//   import { buildKnowledgeSections } from "@shared/prompting";
//   const sections = buildKnowledgeSections({ code, notes, pastResolutions });
//   doc.sections.push(...sections);
// ---------------------------------------------------------------------------

const RATIONALE = {
  code: "Indexed source-code snippets relevant to the customer question. Treat as factual implementation context.",
  notes:
    "Operator-curated knowledge notes. Treat as authoritative company policy, runbook, or product truth.",
  pastResolutions:
    "Examples of previously-approved replies to similar questions. Use for tone and structure ONLY — verify current policy still applies before reusing language. Past replies may contain customer-specific promises, bugs since fixed, pricing changes, or one-off concessions.",
} as const;

type CodeKnowledgePayload = {
  filePath: string;
  lineStart: number;
  lineEnd: number;
  language: string | null;
  snippet: string;
};

type NotePayload = {
  noteId: string;
  title: string;
  content: string;
};

type PastResolutionPayload = {
  conversationId: string;
  approvedAt: string;
  qaPair: string;
};

export type KnowledgeSectionInput = {
  code?: KnowledgeHit[];
  notes?: KnowledgeHit[];
  pastResolutions?: KnowledgeHit[];
};

/// Build up to three PromptSection objects, one per source. Empty inputs
/// produce no section (so the prompt isn't padded with empty headers).
export function buildKnowledgeSections(input: KnowledgeSectionInput): PromptSection[] {
  const sections: PromptSection[] = [];

  const code = (input.code ?? []).filter((h) => h.metadata.source === "CODE");
  if (code.length > 0) {
    sections.push({
      type: "structured",
      title: "Related code",
      preferredFormat: "toon",
      fallbackFormat: "json",
      rationale: RATIONALE.code,
      payload: code.map((hit): CodeKnowledgePayload => {
        if (hit.metadata.source !== "CODE") {
          // Defensive: filter above should make this unreachable. Keeping the
          // narrow check so TypeScript narrows the discriminated union.
          throw new Error("buildKnowledgeSections: non-CODE hit reached CODE section");
        }
        return {
          filePath: hit.metadata.filePath,
          lineStart: hit.metadata.lineStart,
          lineEnd: hit.metadata.lineEnd,
          language: hit.metadata.language,
          snippet: hit.content,
        };
      }),
    });
  }

  const notes = (input.notes ?? []).filter((h) => h.metadata.source === "MANUAL_NOTE");
  if (notes.length > 0) {
    sections.push({
      type: "structured",
      title: "Knowledge notes",
      preferredFormat: "toon",
      fallbackFormat: "json",
      rationale: RATIONALE.notes,
      payload: notes.map((hit): NotePayload => {
        if (hit.metadata.source !== "MANUAL_NOTE") {
          throw new Error("buildKnowledgeSections: non-MANUAL_NOTE hit reached notes section");
        }
        return {
          noteId: hit.metadata.noteId,
          title: hit.metadata.title,
          content: hit.content,
        };
      }),
    });
  }

  const pastResolutions = (input.pastResolutions ?? []).filter(
    (h) => h.metadata.source === "PAST_RESOLUTION"
  );
  if (pastResolutions.length > 0) {
    sections.push({
      type: "structured",
      title: "Similar past resolutions",
      preferredFormat: "toon",
      fallbackFormat: "json",
      rationale: RATIONALE.pastResolutions,
      payload: pastResolutions.map((hit): PastResolutionPayload => {
        if (hit.metadata.source !== "PAST_RESOLUTION") {
          throw new Error(
            "buildKnowledgeSections: non-PAST_RESOLUTION hit reached past-resolution section"
          );
        }
        return {
          conversationId: hit.metadata.conversationId,
          approvedAt: hit.metadata.approvedAt,
          qaPair: hit.content,
        };
      }),
    });
  }

  return sections;
}
