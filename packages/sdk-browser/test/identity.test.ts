import { describe, expect, it } from "vitest";
import { resolveConfig } from "../src/config.js";
import {
  didConcreteIdentityChange,
  hasConcreteIdentity,
  normalizeSessionIdentity,
} from "../src/identity.js";

describe("session replay identity normalization", () => {
  it("normalizes email with trim and lowercase", () => {
    const identity = normalizeSessionIdentity({
      email: "  User@Example.COM  ",
      id: " user-123 ",
    });

    expect(identity).toEqual({
      userEmail: "user@example.com",
      userId: "user-123",
    });
  });

  it("treats empty strings as missing identity", () => {
    const identity = normalizeSessionIdentity({
      email: "   ",
      id: "",
    });

    expect(identity).toEqual({});
    expect(hasConcreteIdentity(identity)).toBe(false);
  });

  it("detects concrete identity changes only when both sides are identified", () => {
    expect(
      didConcreteIdentityChange(
        { userId: "user-1", userEmail: "alice@example.com" },
        { userId: "user-2", userEmail: "bob@example.com" }
      )
    ).toBe(true);

    expect(
      didConcreteIdentityChange({ userId: "user-1", userEmail: "alice@example.com" }, {})
    ).toBe(false);
  });
});

describe("session replay config", () => {
  it("uses the real sessions ingest route by default", () => {
    const originalLocation = globalThis.location;
    Object.defineProperty(globalThis, "location", {
      value: { origin: "https://app.trustloop.ai" },
      configurable: true,
    });

    try {
      const config = resolveConfig({
        apiKey: "tlk_test.secret",
      });

      expect(config.ingestUrl).toBe("https://app.trustloop.ai/api/rest/sessions/ingest");
    } finally {
      Object.defineProperty(globalThis, "location", {
        value: originalLocation,
        configurable: true,
      });
    }
  });
});
