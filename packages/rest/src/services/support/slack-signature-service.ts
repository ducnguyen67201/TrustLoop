import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@shared/env";
import { ValidationError } from "@shared/types";

// ---------------------------------------------------------------------------
// slackSignature service
//
// Verifies inbound Slack HTTP request signatures (HMAC-SHA256) and replay
// window. Import as a namespace:
//
//   import * as slackSignature from "@shared/rest/services/support/slack-signature-service";
//   slackSignature.verifyRequest(rawBody, sig, ts);
//
// See docs/service-layer-conventions.md.
// ---------------------------------------------------------------------------

function toBuffer(value: string): Buffer {
  return Buffer.from(value, "utf8");
}

function buildSlackBaseString(timestamp: string, rawBody: string): string {
  return `v0:${timestamp}:${rawBody}`;
}

function getSlackSigningSecret(): string {
  const signingSecret = env.SLACK_SIGNING_SECRET;
  if (!signingSecret) {
    throw new ValidationError("Slack signing secret is not configured");
  }

  return signingSecret;
}

function computeSlackSignature(timestamp: string, rawBody: string): string {
  const digest = createHmac("sha256", getSlackSigningSecret())
    .update(buildSlackBaseString(timestamp, rawBody))
    .digest("hex");

  return `v0=${digest}`;
}

function assertReplayWindow(timestamp: string): void {
  const timestampSeconds = Number.parseInt(timestamp, 10);
  if (!Number.isFinite(timestampSeconds)) {
    throw new ValidationError("Slack request timestamp is invalid");
  }

  const ageSeconds = Math.abs(Math.floor(Date.now() / 1000) - timestampSeconds);
  if (ageSeconds > env.SLACK_REPLAY_WINDOW_SECONDS) {
    throw new ValidationError("Slack request timestamp is outside replay window");
  }
}

/**
 * Verify the Slack request signature and replay window against the raw body.
 */
export function verifyRequest(
  rawBody: string,
  signature: string | null,
  timestamp: string | null
): void {
  if (!signature || !timestamp) {
    throw new ValidationError("Missing Slack signature headers");
  }

  assertReplayWindow(timestamp);

  const expected = computeSlackSignature(timestamp, rawBody);
  const actualBuffer = toBuffer(signature);
  const expectedBuffer = toBuffer(expected);

  if (
    actualBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(actualBuffer, expectedBuffer)
  ) {
    throw new ValidationError("Slack signature verification failed");
  }
}
