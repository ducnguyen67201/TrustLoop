import type { SupportConversationTimelineEvent } from "@shared/types";
import { describe, expect, it } from "vitest";
import { buildThreadTree } from "../src/components/support/thread-tree";

/**
 * Unit tests for buildThreadTree — groups timeline events into
 * Slack-thread-shaped trees using the server-resolved parentEventId
 * field.
 *
 * Ingress and reply paths set parentEventId when an event belongs to
 * an existing thread. Thread roots and standalones have parentEventId
 * === null. The UI never re-derives the hierarchy.
 */

type Event = SupportConversationTimelineEvent;

function event(opts: {
  id: string;
  eventType?: string;
  eventSource?: "CUSTOMER" | "OPERATOR";
  parentEventId?: string | null;
  text?: string;
}): Event {
  return {
    id: opts.id,
    conversationId: "conv-1",
    workspaceId: "ws-1",
    eventType: opts.eventType ?? "MESSAGE_RECEIVED",
    eventSource: opts.eventSource ?? "CUSTOMER",
    summary: opts.text ?? null,
    parentEventId: opts.parentEventId ?? null,
    createdAt: new Date().toISOString(),
    detailsJson: {
      rawText: opts.text,
    },
  } as Event;
}

describe("buildThreadTree", () => {
  it("puts a single event with no parent at top-level", () => {
    const events = [event({ id: "a", text: "hello" })];

    const { topLevel, childrenByParent } = buildThreadTree(events);

    expect(topLevel).toHaveLength(1);
    expect(topLevel[0].id).toBe("a");
    expect(childrenByParent.size).toBe(0);
  });

  it("nests a child event under its parent via parentEventId", () => {
    const events = [
      event({ id: "parent", text: "hello" }),
      event({ id: "child", parentEventId: "parent", text: "reply" }),
    ];

    const { topLevel, childrenByParent } = buildThreadTree(events);

    expect(topLevel.map((e) => e.id)).toEqual(["parent"]);
    expect(childrenByParent.get("parent")?.map((e) => e.id)).toEqual(["child"]);
  });

  it("groups multiple replies under the same parent as flat siblings", () => {
    const events = [
      event({ id: "parent", text: "hello" }),
      event({
        id: "r1",
        parentEventId: "parent",
        eventType: "DELIVERY_ATTEMPTED",
        eventSource: "OPERATOR",
        text: "what was it",
      }),
      event({ id: "r2", parentEventId: "parent", text: "i reply" }),
      event({
        id: "r3",
        parentEventId: "parent",
        eventType: "DELIVERY_ATTEMPTED",
        eventSource: "OPERATOR",
        text: "got it",
      }),
    ];

    const { topLevel, childrenByParent } = buildThreadTree(events);

    expect(topLevel.map((e) => e.id)).toEqual(["parent"]);
    expect(childrenByParent.get("parent")?.map((e) => e.id)).toEqual(["r1", "r2", "r3"]);
  });

  it("separates multiple top-level threads (each customer burst in its own)", () => {
    const events = [
      event({ id: "hallo", text: "hallo i need help" }),
      event({ id: "hello", text: "hello" }),
      event({
        id: "op1",
        parentEventId: "hello",
        eventType: "DELIVERY_ATTEMPTED",
        eventSource: "OPERATOR",
        text: "heyy what was it",
      }),
      event({ id: "yea", text: "yea it was auth" }),
      event({
        id: "op2",
        parentEventId: "yea",
        eventType: "DELIVERY_ATTEMPTED",
        eventSource: "OPERATOR",
        text: "ko",
      }),
    ];

    const { topLevel, childrenByParent } = buildThreadTree(events);

    expect(topLevel.map((e) => e.id)).toEqual(["hallo", "hello", "yea"]);
    expect(childrenByParent.get("hello")?.map((e) => e.id)).toEqual(["op1"]);
    expect(childrenByParent.get("yea")?.map((e) => e.id)).toEqual(["op2"]);
    expect(childrenByParent.has("hallo")).toBe(false);
  });

  it("treats events whose parentEventId points outside the current slice as top-level", () => {
    // Orphan child: parentEventId references an event not in the timeline
    // (e.g., deleted parent, pagination gap). Render at top-level rather
    // than silently dropping.
    const events = [event({ id: "orphan", parentEventId: "missing-parent", text: "stranded" })];

    const { topLevel, childrenByParent } = buildThreadTree(events);

    expect(topLevel.map((e) => e.id)).toEqual(["orphan"]);
    expect(childrenByParent.size).toBe(0);
  });

  it("preserves event order within each bucket", () => {
    const events = [
      event({ id: "a", text: "first" }),
      event({ id: "b", text: "second" }),
      event({
        id: "r1",
        parentEventId: "a",
        eventType: "DELIVERY_ATTEMPTED",
        eventSource: "OPERATOR",
        text: "reply a-1",
      }),
      event({
        id: "r2",
        parentEventId: "a",
        eventType: "DELIVERY_ATTEMPTED",
        eventSource: "OPERATOR",
        text: "reply a-2",
      }),
      event({
        id: "r3",
        parentEventId: "b",
        eventType: "DELIVERY_ATTEMPTED",
        eventSource: "OPERATOR",
        text: "reply b-1",
      }),
    ];

    const { topLevel, childrenByParent } = buildThreadTree(events);

    expect(topLevel.map((e) => e.id)).toEqual(["a", "b"]);
    expect(childrenByParent.get("a")?.map((e) => e.id)).toEqual(["r1", "r2"]);
    expect(childrenByParent.get("b")?.map((e) => e.id)).toEqual(["r3"]);
  });

  it("ignores null parentEventId (treats as top-level)", () => {
    const events = [
      event({ id: "a", parentEventId: null, text: "first" }),
      event({ id: "b", parentEventId: null, text: "second" }),
    ];

    const { topLevel } = buildThreadTree(events);

    expect(topLevel.map((e) => e.id)).toEqual(["a", "b"]);
  });
});
