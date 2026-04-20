import { describe, expect, it } from "vitest";

import type { PromptStructuredSection } from "../src/prompt-document";
import { PROMPT_INPUT_FORMAT } from "../src/prompt-format";
import {
  resolveStructuredSectionFormat,
  serializeStructuredSection,
} from "../src/renderers/structured-section-renderer";

describe("structured section rendering", () => {
  it("prefers TOON for uniform arrays in auto mode", () => {
    const section: PromptStructuredSection = {
      fallbackFormat: PROMPT_INPUT_FORMAT.json,
      payload: [
        { id: 1, role: "admin" },
        { id: 2, role: "user" },
      ],
      preferredFormat: PROMPT_INPUT_FORMAT.auto,
      rationale: "Uniform records",
      title: "Users",
      type: "structured",
    };

    expect(resolveStructuredSectionFormat(section)).toBe(PROMPT_INPUT_FORMAT.toon);
  });

  it("prefers JSON for deeply nested structures in auto mode", () => {
    const section: PromptStructuredSection = {
      fallbackFormat: PROMPT_INPUT_FORMAT.json,
      payload: {
        config: {
          retries: [1, 2, 3],
          service: {
            endpoint: "https://api.example.com",
            headers: {
              authorization: "masked",
            },
          },
        },
      },
      preferredFormat: PROMPT_INPUT_FORMAT.auto,
      rationale: "Nested config",
      title: "Config",
      type: "structured",
    };

    expect(resolveStructuredSectionFormat(section)).toBe(PROMPT_INPUT_FORMAT.json);
  });

  it("falls back to JSON when the TOON serializer throws", () => {
    const section: PromptStructuredSection = {
      fallbackFormat: PROMPT_INPUT_FORMAT.json,
      payload: [{ id: 1, role: "admin" }],
      preferredFormat: PROMPT_INPUT_FORMAT.toon,
      rationale: "Fallback coverage",
      title: "Users",
      type: "structured",
    };

    const result = serializeStructuredSection(section, {
      json: (payload) => JSON.stringify(payload, null, 2),
      toon: () => {
        throw new Error("boom");
      },
    });

    expect(result.format).toBe(PROMPT_INPUT_FORMAT.json);
    expect(result.content).toContain('"role": "admin"');
  });
});
