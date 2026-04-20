import { describe, expect, it } from "vitest";

import type { PromptDocument } from "../src/prompt-document";
import { PROMPT_INPUT_FORMAT } from "../src/prompt-format";
import { renderPromptDocument } from "../src/renderers/prompt-document-renderer";

describe("renderPromptDocument", () => {
  it("renders prose-only documents with section spacing", () => {
    const document: PromptDocument = {
      sections: [
        { body: "Intro paragraph", type: "prose" },
        { body: "Body copy", title: "Context", type: "prose" },
      ],
    };

    expect(renderPromptDocument(document)).toBe("Intro paragraph\n\n## Context\n\nBody copy");
  });

  it("renders structured sections with serializer metadata", () => {
    const document: PromptDocument = {
      sections: [
        {
          body: "Base prompt",
          type: "prose",
        },
        {
          fallbackFormat: PROMPT_INPUT_FORMAT.json,
          payload: [{ id: 1, role: "admin" }],
          preferredFormat: PROMPT_INPUT_FORMAT.auto,
          rationale: "Benchmark candidate",
          title: "Structured Data",
          type: "structured",
        },
      ],
    };

    const rendered = renderPromptDocument(document);

    expect(rendered).toContain("Base prompt");
    expect(rendered).toContain("## Structured Data");
    expect(rendered).toContain("Format:");
  });
});
