import * as supportDrafts from "@shared/rest/services/support/support-draft-service";
import { describe, expect, it, vi } from "vitest";

const VALID_PR_URL = "https://github.com/acme/repo/pull/42";

function makeClient(candidates: Array<Record<string, unknown>>) {
  const findMany = vi.fn(async () => candidates);
  const update = vi.fn(async () => ({}));
  return {
    client: { supportDraft: { findMany, update } },
    findMany,
    update,
  };
}

describe("supportDrafts.linkPullRequest", () => {
  it("picks AWAITING_APPROVAL over APPROVED over SENT", async () => {
    const { client, update } = makeClient([
      {
        id: "draft_sent",
        status: "SENT",
        prUrl: null,
        createdAt: new Date("2026-04-21T10:00:00Z"),
      },
      {
        id: "draft_approved",
        status: "APPROVED",
        prUrl: null,
        createdAt: new Date("2026-04-21T10:01:00Z"),
      },
      {
        id: "draft_awaiting",
        status: "AWAITING_APPROVAL",
        prUrl: null,
        createdAt: new Date("2026-04-21T09:00:00Z"),
      },
    ]);

    const result = await supportDrafts.linkPullRequest(client, {
      workspaceId: "ws_1",
      conversationId: "conv_1",
      prUrl: VALID_PR_URL,
      prNumber: 42,
    });

    expect(result.linked).toBe(true);
    expect(result.draftId).toBe("draft_awaiting");
    expect(update).toHaveBeenCalledWith({
      where: { id: "draft_awaiting" },
      data: { prUrl: VALID_PR_URL, prNumber: 42 },
    });
  });

  it("breaks priority ties on createdAt DESC", async () => {
    const { client, update } = makeClient([
      {
        id: "draft_old_sent",
        status: "SENT",
        prUrl: null,
        createdAt: new Date("2026-04-20T10:00:00Z"),
      },
      {
        id: "draft_new_sent",
        status: "SENT",
        prUrl: null,
        createdAt: new Date("2026-04-21T10:00:00Z"),
      },
    ]);

    const result = await supportDrafts.linkPullRequest(client, {
      workspaceId: "ws_1",
      conversationId: "conv_1",
      prUrl: VALID_PR_URL,
      prNumber: 42,
    });

    expect(result.draftId).toBe("draft_new_sent");
    expect(update).toHaveBeenCalled();
  });

  it("is idempotent when the same prUrl is already linked", async () => {
    const { client, update } = makeClient([
      {
        id: "draft_1",
        status: "AWAITING_APPROVAL",
        prUrl: VALID_PR_URL,
        createdAt: new Date("2026-04-21T10:00:00Z"),
      },
    ]);

    const result = await supportDrafts.linkPullRequest(client, {
      workspaceId: "ws_1",
      conversationId: "conv_1",
      prUrl: VALID_PR_URL,
      prNumber: 42,
    });

    expect(result.linked).toBe(true);
    expect(result.alreadyLinked).toBe(true);
    expect(update).not.toHaveBeenCalled();
  });

  it("returns linked: false when no eligible draft exists", async () => {
    const { client, update } = makeClient([]);

    const result = await supportDrafts.linkPullRequest(client, {
      workspaceId: "ws_1",
      conversationId: "conv_1",
      prUrl: VALID_PR_URL,
      prNumber: 42,
    });

    expect(result.linked).toBe(false);
    expect(result.draftId).toBeNull();
    expect(update).not.toHaveBeenCalled();
  });

  it("scopes the query to both workspaceId AND conversationId", async () => {
    const { client, findMany } = makeClient([]);

    await supportDrafts.linkPullRequest(client, {
      workspaceId: "ws_1",
      conversationId: "conv_1",
      prUrl: VALID_PR_URL,
      prNumber: 42,
    });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          workspaceId: "ws_1",
          conversationId: "conv_1",
          deletedAt: null,
        }),
      })
    );
  });

  it("rejects a malformed prUrl before any DB call", async () => {
    const { client, findMany } = makeClient([]);

    await expect(
      supportDrafts.linkPullRequest(client, {
        workspaceId: "ws_1",
        conversationId: "conv_1",
        prUrl: "not-a-pr-url",
        prNumber: 42,
      })
    ).rejects.toThrow();

    expect(findMany).not.toHaveBeenCalled();
  });

  it("rejects a non-positive prNumber before any DB call", async () => {
    const { client, findMany } = makeClient([]);

    await expect(
      supportDrafts.linkPullRequest(client, {
        workspaceId: "ws_1",
        conversationId: "conv_1",
        prUrl: VALID_PR_URL,
        prNumber: 0,
      })
    ).rejects.toThrow();

    expect(findMany).not.toHaveBeenCalled();
  });
});
