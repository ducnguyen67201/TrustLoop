import { describe, expect, it } from "vitest";
import { normalizeSlackMessageEvent } from "../src/domains/support/adapters/slack/event-normalizer";

function envelope(event: Record<string, unknown>) {
  return {
    team_id: "T0TEST",
    event_ts: "1775956046.034129",
    event: {
      type: "message",
      channel: "C0TEST",
      ts: "1775956046.034129",
      ...event,
    },
  };
}

describe("normalizeSlackMessageEvent", () => {
  it("classifies customer messages when a user id is present", () => {
    const result = normalizeSlackMessageEvent(
      envelope({ user: "U0CUSTOMER", text: "hi please help" })
    );
    expect(result?.authorRoleBucket).toBe("CUSTOMER");
    expect(result?.slackUserId).toBe("U0CUSTOMER");
  });

  it("classifies our own chat.postMessage echoes as bot via bot_id", () => {
    const result = normalizeSlackMessageEvent(
      envelope({ bot_id: "B0TRUSTLOOP", user: "U0BOTUSER", text: "operator reply" })
    );
    expect(result?.authorRoleBucket).toBe("BOT");
  });

  it("classifies bot_message subtype without bot_id as bot", () => {
    const result = normalizeSlackMessageEvent(
      envelope({ subtype: "bot_message", text: "from an app" })
    );
    expect(result?.authorRoleBucket).toBe("BOT");
  });

  it("classifies Slack noise subtypes as system", () => {
    for (const subtype of [
      "message_changed",
      "message_deleted",
      "channel_join",
      "channel_leave",
      "pinned_item",
      "channel_topic",
    ]) {
      const result = normalizeSlackMessageEvent(envelope({ subtype }));
      expect(result?.authorRoleBucket, `subtype=${subtype}`).toBe("SYSTEM");
    }
  });

  it("preserves threadTs when replying in a thread", () => {
    const result = normalizeSlackMessageEvent(
      envelope({
        user: "U0CUSTOMER",
        thread_ts: "1775956000.000000",
        ts: "1775956046.034129",
      })
    );
    expect(result?.threadTs).toBe("1775956000.000000");
    expect(result?.messageTs).toBe("1775956046.034129");
  });

  it("falls back to messageTs when thread_ts is absent (standalone message)", () => {
    const result = normalizeSlackMessageEvent(
      envelope({ user: "U0CUSTOMER", ts: "1775956046.034129" })
    );
    expect(result?.threadTs).toBe("1775956046.034129");
  });

  it("returns null when required envelope fields are missing", () => {
    expect(normalizeSlackMessageEvent(null)).toBeNull();
    expect(normalizeSlackMessageEvent({ event: null })).toBeNull();
    expect(
      normalizeSlackMessageEvent({
        team_id: "T0",
        event: { channel: "C0", type: "message" },
      })
    ).toBeNull();
  });

  it("defaults to system when no user and no bot identifiers are present", () => {
    const result = normalizeSlackMessageEvent(envelope({ text: "mystery message" }));
    expect(result?.authorRoleBucket).toBe("SYSTEM");
  });
});
