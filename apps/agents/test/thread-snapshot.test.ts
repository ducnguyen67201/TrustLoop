import type { ThreadSnapshot } from "@shared/types";
import { describe, expect, it } from "vitest";
import { renderThreadSnapshotPrompt } from "../src/prompts/thread-snapshot";

const snapshot: ThreadSnapshot = {
  conversationId: "conv-1",
  channelId: "C0ABCDEF",
  threadTs: "1776616233.348399",
  status: "IN_PROGRESS",
  customer: { email: "user@example.com" },
  events: [
    {
      type: "MESSAGE_RECEIVED",
      source: "CUSTOMER",
      summary: "hi",
      details: { rawText: "hi" },
      at: "2026-04-19T16:30:34.672Z",
    },
  ],
};

describe("renderThreadSnapshotPrompt", () => {
  it("renders the snapshot as pretty-printed JSON", () => {
    const rendered = renderThreadSnapshotPrompt(snapshot);
    expect(rendered).toContain('"conversationId": "conv-1"');
    expect(rendered).toContain('"channelId": "C0ABCDEF"');
    expect(rendered).toContain('"type": "MESSAGE_RECEIVED"');
  });

  it("produces valid JSON that round-trips", () => {
    const rendered = renderThreadSnapshotPrompt(snapshot);
    const parsed = JSON.parse(rendered);
    expect(parsed).toEqual(snapshot);
  });
});
