import {
  type ThreadSnapshot,
  analyzeRequestSchema,
  threadSnapshotEventSchema,
  threadSnapshotSchema,
} from "@shared/types";
import { describe, expect, it } from "vitest";

const validSnapshot: ThreadSnapshot = {
  conversationId: "conv-1",
  channelId: "C0ABCDEF",
  threadTs: "1776616233.348399",
  status: "IN_PROGRESS",
  customer: { email: null },
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

describe("threadSnapshotSchema", () => {
  it("accepts a minimal valid snapshot", () => {
    expect(threadSnapshotSchema.safeParse(validSnapshot).success).toBe(true);
  });

  it("accepts an empty events array", () => {
    const result = threadSnapshotSchema.safeParse({ ...validSnapshot, events: [] });
    expect(result.success).toBe(true);
  });

  it("rejects an unknown top-level field (.strict)", () => {
    const result = threadSnapshotSchema.safeParse({
      ...validSnapshot,
      extraField: "nope",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a missing channelId (non-nullable)", () => {
    const { channelId: _channelId, ...rest } = validSnapshot;
    const result = threadSnapshotSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects a null channelId", () => {
    const result = threadSnapshotSchema.safeParse({ ...validSnapshot, channelId: null });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown event source (shared enum gate)", () => {
    const result = threadSnapshotSchema.safeParse({
      ...validSnapshot,
      events: [{ ...validSnapshot.events[0], source: "BOT" }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown status", () => {
    const result = threadSnapshotSchema.safeParse({ ...validSnapshot, status: "PAUSED" });
    expect(result.success).toBe(false);
  });

  it("accepts nested JSON values in details (recursive)", () => {
    const result = threadSnapshotEventSchema.safeParse({
      ...validSnapshot.events[0],
      details: {
        nested: { inner: [1, 2, { deepString: "ok" }] },
        scalar: 42,
        nullable: null,
      },
    });
    expect(result.success).toBe(true);
  });
});

describe("analyzeRequestSchema", () => {
  it("accepts a structured snapshot", () => {
    const result = analyzeRequestSchema.safeParse({
      workspaceId: "ws-1",
      conversationId: "conv-1",
      threadSnapshot: validSnapshot,
    });
    expect(result.success).toBe(true);
  });

  it("rejects a stringified snapshot (no compat path)", () => {
    const result = analyzeRequestSchema.safeParse({
      workspaceId: "ws-1",
      conversationId: "conv-1",
      threadSnapshot: JSON.stringify(validSnapshot),
    });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid object threadSnapshot (unknown event source)", () => {
    const result = analyzeRequestSchema.safeParse({
      workspaceId: "ws-1",
      conversationId: "conv-1",
      threadSnapshot: {
        ...validSnapshot,
        events: [{ ...validSnapshot.events[0], source: "BOT" }],
      },
    });
    expect(result.success).toBe(false);
  });
});
