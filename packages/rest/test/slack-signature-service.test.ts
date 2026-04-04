import { createHmac } from "node:crypto";
import { env } from "@shared/env";
import { verifySlackRequestSignature } from "@shared/rest/services/support/slack-signature-service";
import { ValidationError } from "@shared/types";
import { describe, expect, it } from "vitest";

const slackSigningSecret = env.SLACK_SIGNING_SECRET ?? "dev-only-trustloop-slack-signing-secret";
const slackReplayWindowSeconds = env.SLACK_REPLAY_WINDOW_SECONDS ?? 300;

function signSlackBody(timestamp: string, rawBody: string): string {
  const digest = createHmac("sha256", slackSigningSecret)
    .update(`v0:${timestamp}:${rawBody}`)
    .digest("hex");

  return `v0=${digest}`;
}

describe("verifySlackRequestSignature", () => {
  it("accepts a valid signature within the replay window", () => {
    const rawBody = JSON.stringify({ type: "event_callback", event_id: "evt_1" });
    const timestamp = `${Math.floor(Date.now() / 1000)}`;

    expect(() =>
      verifySlackRequestSignature(rawBody, signSlackBody(timestamp, rawBody), timestamp)
    ).not.toThrow();
  });

  it("rejects an invalid signature", () => {
    const rawBody = JSON.stringify({ type: "event_callback", event_id: "evt_1" });
    const timestamp = `${Math.floor(Date.now() / 1000)}`;

    expect(() => verifySlackRequestSignature(rawBody, "v0=bad", timestamp)).toThrow(
      ValidationError
    );
  });

  it("rejects requests outside the replay window", () => {
    const rawBody = JSON.stringify({ type: "event_callback", event_id: "evt_1" });
    const timestamp = `${Math.floor(Date.now() / 1000) - slackReplayWindowSeconds - 5}`;

    expect(() =>
      verifySlackRequestSignature(rawBody, signSlackBody(timestamp, rawBody), timestamp)
    ).toThrow(ValidationError);
  });
});
