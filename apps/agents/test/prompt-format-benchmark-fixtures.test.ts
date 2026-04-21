import { describe, expect, it } from "vitest";

import {
  PROMPT_INPUT_FORMAT,
  renderPromptDocument,
  renderStructuredSection,
  serializeAsJson,
  serializeAsToon,
  serializeStructuredSection,
} from "@shared/prompting";
import type { PromptStructuredSection } from "@shared/prompting";
import { reconstructSessionDigest } from "@shared/types/positional-format/session-digest";

describe("prompt format benchmark fixtures", () => {
  it("prefers TOON for the route history list from a real session digest fixture", () => {
    const sessionDigest = buildSessionDigestFixture();
    const section: PromptStructuredSection = {
      fallbackFormat: PROMPT_INPUT_FORMAT.json,
      payload: sessionDigest.routeHistory,
      preferredFormat: PROMPT_INPUT_FORMAT.auto,
      rationale: "Route history is a uniform string list from the real session digest shape",
      title: "Route History",
      type: "structured",
    };

    const rendered = renderStructuredSection(section);
    const serialized = serializeStructuredSection(section);

    expect(serialized.format).toBe(PROMPT_INPUT_FORMAT.toon);
    expect(rendered).toContain("Format: TOON");
    expect(serializeAsToon(sessionDigest.routeHistory).length).toBeLessThan(
      serializeAsJson(sessionDigest.routeHistory).length
    );
  });

  it("captures JSON and TOON sizes for the actual session digest shape", () => {
    const sessionDigest = buildSessionDigestFixture();
    const jsonOutput = serializeAsJson(sessionDigest);
    const toonOutput = serializeAsToon(sessionDigest);

    expect(toonOutput.length).toBeLessThan(jsonOutput.length);
    expect(toonOutput.length).toBeGreaterThan(0);
  });

  it("renders a representative prompt document made from real TrustLoop shapes", () => {
    const sessionDigest = buildSessionDigestFixture();
    const document = {
      sections: [
        {
          body: "Prompt instructions",
          type: "prose" as const,
        },
        {
          fallbackFormat: PROMPT_INPUT_FORMAT.json,
          payload: sessionDigest,
          preferredFormat: PROMPT_INPUT_FORMAT.json,
          rationale: "Full session digest remains JSON until its structure is benchmarked further",
          title: "Session Digest",
          type: "structured" as const,
        },
      ],
    };

    const rendered = renderPromptDocument(document);

    expect(rendered).toContain("## Session Digest");
    expect(rendered).toContain("Format: JSON");
  });
});

function buildSessionDigestFixture() {
  return reconstructSessionDigest({
    s: "sess_abc123",
    u: "user_42",
    d: "3m 42s",
    p: 4,
    r: ["/", "/settings", "/settings/billing", "/settings/billing/upgrade"],
    l: [
      "12:00:01|1|/settings",
      "12:00:05|0|Clicked billing tab",
      "12:00:08|1|/settings/billing",
      "12:00:12|0|Clicked upgrade button",
      "12:00:13|2|POST /api/checkout failed 500",
    ],
    e: ["12:00:13|1|POST /api/checkout 500|1"],
    f: {
      t: "12:00:13",
      y: 1,
      d: "Checkout API returned 500 after clicking upgrade",
      p: [
        "12:00:01|1|/",
        "12:00:05|0|Clicked billing tab",
        "12:00:08|1|/settings/billing",
        "12:00:12|0|Clicked upgrade button",
        "12:00:13|2|POST /api/checkout failed 500",
      ],
    },
    n: ["POST /api/checkout|500|1200|12:00:13"],
    c: ["ERROR|Uncaught TypeError|12:00:13|2"],
    v: {
      u: "https://app.example.com/settings/billing/upgrade",
      a: "Mozilla/5.0 Chrome/120",
      w: "1920x1080",
      r: "v2.3.1",
    },
  });
}
