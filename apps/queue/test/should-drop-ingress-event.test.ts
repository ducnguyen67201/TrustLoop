import { describe, expect, it } from "vitest";
import { shouldDropIngressEvent } from "../src/domains/support/ingress-drop-rules";

/**
 * Unit tests for shouldDropIngressEvent — the pure helper that decides
 * whether a Slack ingress event should be dropped at the boundary.
 *
 * Cases:
 *   - SYSTEM (edits, pins, channel joins)    → always drop
 *   - BOT + slackUserId === botUserId        → drop (our own echo)
 *   - BOT + slackUserId !== botUserId        → let through (other integration)
 *   - BOT + installationBotUserId null       → drop (legacy install, safe default)
 *   - CUSTOMER                                → let through
 *   - INTERNAL                                → let through
 */

describe("shouldDropIngressEvent", () => {
  describe("system role", () => {
    it("drops system events regardless of user or installation state", () => {
      expect(
        shouldDropIngressEvent({
          authorRoleBucket: "SYSTEM",
          slackUserId: null,
          installationBotUserId: "U0BOT",
        })
      ).toBe(true);

      expect(
        shouldDropIngressEvent({
          authorRoleBucket: "SYSTEM",
          slackUserId: "U0CUSTOMER",
          installationBotUserId: null,
        })
      ).toBe(true);
    });
  });

  describe("bot role", () => {
    it("drops when slackUserId matches the installation's botUserId (our own echo)", () => {
      expect(
        shouldDropIngressEvent({
          authorRoleBucket: "BOT",
          slackUserId: "U0TRUSTLOOP",
          installationBotUserId: "U0TRUSTLOOP",
        })
      ).toBe(true);
    });

    it("lets through bot messages from OTHER integrations (design doc §3)", () => {
      // A GitHub app posts a PR diff screenshot — different bot user ID.
      expect(
        shouldDropIngressEvent({
          authorRoleBucket: "BOT",
          slackUserId: "U0GITHUBAPP",
          installationBotUserId: "U0TRUSTLOOP",
        })
      ).toBe(false);
    });

    it("falls back to blanket drop when installation.botUserId is null (legacy install)", () => {
      // Safe default: without a known bot user ID, we can't distinguish our
      // echoes from other bots, so we drop all to keep the inbox clean.
      expect(
        shouldDropIngressEvent({
          authorRoleBucket: "BOT",
          slackUserId: "U0ANYBOT",
          installationBotUserId: null,
        })
      ).toBe(true);
    });

    it("drops when slackUserId is null and installation.botUserId is null", () => {
      // Defensive: null slackUserId shouldn't leak through either. Falls
      // under the legacy-install blanket-drop path.
      expect(
        shouldDropIngressEvent({
          authorRoleBucket: "BOT",
          slackUserId: null,
          installationBotUserId: null,
        })
      ).toBe(true);
    });

    it("drops bot messages with null slackUserId even when botUserId is set", () => {
      // Bot-authored message with no user ID. This happens when our own
      // chat.postMessage uses chat:write.customize (username/icon_url) —
      // Slack's echo event omits the user field. Real external bots always
      // have a user/bot_id. Drop as our own echo.
      expect(
        shouldDropIngressEvent({
          authorRoleBucket: "BOT",
          slackUserId: null,
          installationBotUserId: "U0TRUSTLOOP",
        })
      ).toBe(true);
    });
  });

  describe("customer and internal roles", () => {
    it("never drops customer messages", () => {
      expect(
        shouldDropIngressEvent({
          authorRoleBucket: "CUSTOMER",
          slackUserId: "U0CUSTOMER",
          installationBotUserId: "U0TRUSTLOOP",
        })
      ).toBe(false);
    });

    it("never drops internal (workspace member) messages", () => {
      expect(
        shouldDropIngressEvent({
          authorRoleBucket: "INTERNAL",
          slackUserId: "U0OPERATOR",
          installationBotUserId: "U0TRUSTLOOP",
        })
      ).toBe(false);
    });
  });
});
