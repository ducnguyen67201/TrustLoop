import { describe, expect, it } from "vitest";
import { resolveProviderConfig } from "../src/agent-config";

describe("resolveProviderConfig", () => {
  it("uses route defaults when the request has no explicit provider or model", () => {
    expect(resolveProviderConfig()).toBeUndefined();
    expect(resolveProviderConfig({})).toBeUndefined();
  });

  it("preserves explicit model/provider overrides", () => {
    expect(resolveProviderConfig({ provider: "openrouter" })).toEqual({
      provider: "openrouter",
    });
    expect(resolveProviderConfig({ model: "gpt-4o-mini" })).toEqual({
      model: "gpt-4o-mini",
    });
  });
});
