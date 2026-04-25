import { normalizeJsonModelOutput, parseJsonModelOutput } from "@shared/types";
import { describe, expect, it } from "vitest";

describe("normalizeJsonModelOutput", () => {
  it("returns trimmed raw JSON unchanged", () => {
    expect(normalizeJsonModelOutput('  {"s":"Customer asking for help"}  ')).toBe(
      '{"s":"Customer asking for help"}'
    );
  });

  it("unwraps a full Markdown JSON fence", () => {
    expect(
      normalizeJsonModelOutput(`\`\`\`json
{"s":"Customer asking for help"}
\`\`\``)
    ).toBe('{"s":"Customer asking for help"}');
  });

  it("uses the final outer fence when JSON string content contains a Markdown fence", () => {
    const payload = JSON.stringify({
      m: [
        {
          b: "Use:\n```ts\nconst ok = true;\n```",
          k: 10,
          p: null,
          r: [],
          s: "Code sample",
          t: "broadcast",
        },
      ],
      f: [],
      q: [],
      n: [],
      d: 1,
      b: null,
    });

    expect(
      normalizeJsonModelOutput(`\`\`\`json
${payload}
\`\`\``)
    ).toBe(payload);
  });

  it("does not unwrap fenced text with prose outside the final fence", () => {
    const raw = `\`\`\`json
{"s":"Customer asking for help"}
\`\`\`
extra`;

    expect(normalizeJsonModelOutput(raw)).toBe(raw);
  });
});

describe("parseJsonModelOutput", () => {
  it("parses normalized JSON output", () => {
    expect(
      parseJsonModelOutput(
        `\`\`\`json
{"s":"Customer asking for help"}
\`\`\``,
        "Model returned non-JSON response"
      )
    ).toEqual({ s: "Customer asking for help" });
  });

  it("throws with the caller prefix when output is not JSON", () => {
    expect(() => parseJsonModelOutput("not json", "Model returned non-JSON response")).toThrow(
      "Model returned non-JSON response: not json"
    );
  });
});
