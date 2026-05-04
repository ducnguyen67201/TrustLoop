import { describe, expect, it } from "vitest";
import { scrubArgs, scrubString } from "../src/observability/scrub-bearer";

describe("scrub-bearer", () => {
  it("redacts inline bearer tokens", () => {
    expect(scrubString("Bearer abc.def.ghi")).toBe("Bearer [redacted]");
    expect(scrubString("foo Bearer eyJhbGciOiJIUzI1NiJ9 baz")).toBe("foo Bearer [redacted] baz");
  });

  it("redacts Authorization headers (header-style and quoted)", () => {
    expect(scrubString("Authorization: Bearer secret-1234")).toBe(
      "Authorization: Bearer [redacted]"
    );
    expect(scrubString('Authorization="Bearer secret-1234"')).toBe(
      'Authorization="Bearer [redacted]"'
    );
  });

  it("preserves non-bearer content", () => {
    expect(scrubString("This is fine.")).toBe("This is fine.");
    expect(scrubString("user.name=Bear")).toBe("user.name=Bear");
    expect(scrubString("My word: bearable.")).toBe("My word: bearable.");
  });

  it("scrubArgs handles nested objects, arrays, and primitives", () => {
    const args = [
      "Bearer abc",
      { headers: { Authorization: "Bearer xyz" }, count: 3, nested: { tip: "Bearer secret" } },
      ["Bearer one", "no-bear", { Authorization: "Bearer two" }],
      42,
      null,
    ];
    const scrubbed = scrubArgs(args);
    expect(scrubbed[0]).toBe("Bearer [redacted]");
    const obj = scrubbed[1] as {
      headers: { Authorization: string };
      count: number;
      nested: { tip: string };
    };
    expect(obj.headers.Authorization).toBe("Bearer [redacted]");
    expect(obj.count).toBe(3);
    expect(obj.nested.tip).toBe("Bearer [redacted]");
    const arr = scrubbed[2] as Array<string | { Authorization: string }>;
    expect(arr[0]).toBe("Bearer [redacted]");
    expect(arr[1]).toBe("no-bear");
    expect((arr[2] as { Authorization: string }).Authorization).toBe("Bearer [redacted]");
    expect(scrubbed[3]).toBe(42);
    expect(scrubbed[4]).toBe(null);
  });
});
