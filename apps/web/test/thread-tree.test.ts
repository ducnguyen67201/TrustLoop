import { describe, expect, it } from "vitest";
import { buildThreadTree } from "../src/components/support/thread-tree";
import type { SupportConversationTimelineEvent } from "@shared/types";

/**
 * Unit tests for buildThreadTree — groups support timeline events into
 * Slack-thread-shaped trees for the conversation view.
 *
 * Fixture helpers below construct minimal events matching the shape
 * buildThreadTree reads (id, eventType, eventSource, createdAt,
 * detailsJson with messageTs/threadTs/replyToEventId).
 */

type Event = SupportConversationTimelineEvent;

function customerMessage(opts: {
  id: string;
  messageTs: string;
  threadTs?: string;
  rawText?: string;
}): Event {
  return {
    id: opts.id,
    conversationId: "conv-1",
    workspaceId: "ws-1",
    eventType: "MESSAGE_RECEIVED",
    eventSource: "CUSTOMER",
    summary: opts.rawText ?? null,
    createdAt: new Date().toISOString(),
    detailsJson: {
      messageTs: opts.messageTs,
      threadTs: opts.threadTs ?? opts.messageTs,
      rawText: opts.rawText,
    },
  } as Event;
}

function operatorReply(opts: {
  id: string;
  threadTs: string;
  messageText: string;
  replyToEventId?: string;
}): Event {
  return {
    id: opts.id,
    conversationId: "conv-1",
    workspaceId: "ws-1",
    eventType: "DELIVERY_ATTEMPTED",
    eventSource: "OPERATOR",
    summary: "Reply send requested",
    createdAt: new Date().toISOString(),
    detailsJson: {
      messageText: opts.messageText,
      threadTs: opts.threadTs,
      replyToEventId: opts.replyToEventId,
    },
  } as Event;
}

describe("buildThreadTree", () => {
  it("puts a single standalone message at top-level with no children", () => {
    const events = [customerMessage({ id: "a", messageTs: "100", rawText: "hello" })];

    const { topLevel, childrenByParent } = buildThreadTree(events);

    expect(topLevel).toHaveLength(1);
    expect(topLevel[0].id).toBe("a");
    expect(childrenByParent.size).toBe(0);
  });

  it("nests an operator reply under the thread parent via threadTs", () => {
    const events = [
      customerMessage({ id: "parent", messageTs: "100", rawText: "hello" }),
      operatorReply({ id: "op1", threadTs: "100", messageText: "heyy what was it" }),
    ];

    const { topLevel, childrenByParent } = buildThreadTree(events);

    expect(topLevel.map((e) => e.id)).toEqual(["parent"]);
    expect(childrenByParent.get("parent")?.map((e) => e.id)).toEqual(["op1"]);
  });

  it("nests a customer thread reply under the parent via threadTs", () => {
    const events = [
      customerMessage({ id: "parent", messageTs: "100", rawText: "hello" }),
      customerMessage({
        id: "child",
        messageTs: "200",
        threadTs: "100",
        rawText: "follow up",
      }),
    ];

    const { topLevel, childrenByParent } = buildThreadTree(events);

    expect(topLevel.map((e) => e.id)).toEqual(["parent"]);
    expect(childrenByParent.get("parent")?.map((e) => e.id)).toEqual(["child"]);
  });

  it("groups multiple thread replies under the same parent as flat siblings", () => {
    const events = [
      customerMessage({ id: "parent", messageTs: "100", rawText: "hello" }),
      operatorReply({ id: "op1", threadTs: "100", messageText: "heyy what was it" }),
      customerMessage({ id: "c1", messageTs: "200", threadTs: "100", rawText: "i reply" }),
      operatorReply({ id: "op2", threadTs: "100", messageText: "got it" }),
    ];

    const { topLevel, childrenByParent } = buildThreadTree(events);

    expect(topLevel.map((e) => e.id)).toEqual(["parent"]);
    expect(childrenByParent.get("parent")?.map((e) => e.id)).toEqual(["op1", "c1", "op2"]);
  });

  it("separates multiple top-level threads (each customer burst in its own)", () => {
    const events = [
      customerMessage({ id: "hallo", messageTs: "100", rawText: "hallo i need help" }),
      customerMessage({ id: "hello", messageTs: "200", rawText: "hello" }),
      operatorReply({ id: "op1", threadTs: "200", messageText: "heyy what was it" }),
      customerMessage({ id: "yea", messageTs: "300", rawText: "yea it was auth" }),
      operatorReply({ id: "op2", threadTs: "300", messageText: "ko" }),
    ];

    const { topLevel, childrenByParent } = buildThreadTree(events);

    expect(topLevel.map((e) => e.id)).toEqual(["hallo", "hello", "yea"]);
    expect(childrenByParent.get("hello")?.map((e) => e.id)).toEqual(["op1"]);
    expect(childrenByParent.get("yea")?.map((e) => e.id)).toEqual(["op2"]);
    expect(childrenByParent.has("hallo")).toBe(false);
  });

  it("normalizes replyToEventId pointing at a thread child to the thread root", () => {
    // Operator clicked "reply" on a thread reply ("c1") instead of the
    // parent ("parent"). The delivery's threadTs is whatever the resolver
    // picked (could be c1's messageTs because of Rule 1), but Slack will
    // auto-normalize up to the parent. The UI should render the delivery
    // as a flat sibling in the parent's thread, not as a grandchild under
    // c1 (which wouldn't render at all).
    const events = [
      customerMessage({ id: "parent", messageTs: "100", rawText: "hello" }),
      customerMessage({ id: "c1", messageTs: "200", threadTs: "100", rawText: "i reply" }),
      operatorReply({
        id: "op",
        threadTs: "200",
        messageText: "got it",
        replyToEventId: "c1",
      }),
    ];

    const { topLevel, childrenByParent } = buildThreadTree(events);

    expect(topLevel.map((e) => e.id)).toEqual(["parent"]);
    expect(childrenByParent.get("parent")?.map((e) => e.id)).toEqual(["c1", "op"]);
    expect(childrenByParent.has("c1")).toBe(false);
  });

  it("treats events with unknown threadTs as top-level (orphans)", () => {
    // threadTs points to a messageTs that isn't in the timeline (parent
    // message outside the current view, or corrupted state). Render as
    // top-level rather than silently dropping.
    const events = [
      operatorReply({ id: "orphan", threadTs: "999", messageText: "lost" }),
    ];

    const { topLevel, childrenByParent } = buildThreadTree(events);

    expect(topLevel.map((e) => e.id)).toEqual(["orphan"]);
    expect(childrenByParent.size).toBe(0);
  });

  it("preserves event order within each bucket (top-level + children)", () => {
    const events = [
      customerMessage({ id: "a", messageTs: "100", rawText: "first" }),
      customerMessage({ id: "b", messageTs: "200", rawText: "second" }),
      operatorReply({ id: "r1", threadTs: "100", messageText: "reply a-1" }),
      operatorReply({ id: "r2", threadTs: "100", messageText: "reply a-2" }),
      operatorReply({ id: "r3", threadTs: "200", messageText: "reply b-1" }),
    ];

    const { topLevel, childrenByParent } = buildThreadTree(events);

    expect(topLevel.map((e) => e.id)).toEqual(["a", "b"]);
    expect(childrenByParent.get("a")?.map((e) => e.id)).toEqual(["r1", "r2"]);
    expect(childrenByParent.get("b")?.map((e) => e.id)).toEqual(["r3"]);
  });
});
