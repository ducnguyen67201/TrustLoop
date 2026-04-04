import { createHmac } from "node:crypto";
import {
  generateSlackOAuthUrl,
  verifyAndDecodeOAuthState,
} from "@shared/rest/services/support/slack-oauth-service";
import { ValidationError } from "@shared/types";
import { describe, expect, it } from "vitest";

const signingKey = process.env.SESSION_SECRET ?? "dev-only-trustloop-session-secret";

function base64UrlEncode(data: string): string {
  return Buffer.from(data, "utf8").toString("base64url");
}

function hmacSign(payload: string): string {
  return createHmac("sha256", signingKey).update(payload).digest("hex");
}

function buildState(
  overrides: Partial<{ workspaceId: string; nonce: string; expiresAt: number }> = {}
): string {
  const payload = {
    workspaceId: overrides.workspaceId ?? "ws_test_123",
    nonce: overrides.nonce ?? "abcdef1234567890abcdef1234567890",
    expiresAt: overrides.expiresAt ?? Date.now() + 10 * 60 * 1000,
  };
  const b64 = base64UrlEncode(JSON.stringify(payload));
  return `${b64}.${hmacSign(b64)}`;
}

describe("verifyAndDecodeOAuthState", () => {
  it("decodes a valid state and returns workspaceId", () => {
    const state = buildState({ workspaceId: "ws_abc" });
    const result = verifyAndDecodeOAuthState(state);
    expect(result.workspaceId).toBe("ws_abc");
  });

  it("rejects a tampered HMAC signature", () => {
    const state = buildState();
    const tampered = `${state.split(".")[0]}.aaaa_tampered_signature`;
    expect(() => verifyAndDecodeOAuthState(tampered)).toThrow(ValidationError);
  });

  it("rejects a tampered payload", () => {
    const original = buildState({ workspaceId: "ws_original" });
    const sig = original.split(".")[1];
    const evilPayload = base64UrlEncode(
      JSON.stringify({
        workspaceId: "ws_evil",
        nonce: "abcdef1234567890abcdef1234567890",
        expiresAt: Date.now() + 10 * 60 * 1000,
      })
    );
    expect(() => verifyAndDecodeOAuthState(`${evilPayload}.${sig}`)).toThrow(ValidationError);
  });

  it("rejects an expired state", () => {
    const state = buildState({ expiresAt: Date.now() - 1000 });
    expect(() => verifyAndDecodeOAuthState(state)).toThrow(ValidationError);
  });

  it("rejects a state without a dot separator", () => {
    expect(() => verifyAndDecodeOAuthState("no-dot-here")).toThrow(ValidationError);
  });

  it("rejects a state with invalid base64 payload", () => {
    const invalid = `not_valid_base64.${hmacSign("not_valid_base64")}`;
    expect(() => verifyAndDecodeOAuthState(invalid)).toThrow();
  });
});

describe("generateSlackOAuthUrl", () => {
  it("returns a valid Slack authorize URL when SLACK_CLIENT_ID is set", () => {
    if (!process.env.SLACK_CLIENT_ID) {
      // Skip if env not configured (CI without Slack creds)
      return;
    }
    const url = generateSlackOAuthUrl("ws_test_123");
    expect(url).toContain("https://slack.com/oauth/v2/authorize");
    expect(url).toContain("client_id=");
    expect(url).toContain("scope=chat%3Awrite%2Cchannels%3Ahistory%2Cgroups%3Ahistory");
    expect(url).toContain("state=");
    expect(url).toContain("redirect_uri=");
  });

  it("throws when SLACK_CLIENT_ID is not configured", () => {
    if (process.env.SLACK_CLIENT_ID) {
      // Can't test this when the env var is set
      return;
    }
    expect(() => generateSlackOAuthUrl("ws_test")).toThrow(ValidationError);
  });
});
