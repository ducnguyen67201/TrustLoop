import {
  type CascadeTx,
  cascadeDeactivateUser,
  cascadeSoftDeleteConversation,
  cascadeSoftDeleteInstallation,
  cascadeSoftDeleteWorkspace,
} from "@shared/rest/services/soft-delete-cascade";
import { describe, expect, it, vi } from "vitest";

function createMockTx(): CascadeTx {
  return {
    supportTicketLink: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    supportDeliveryAttempt: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    supportConversation: {
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      findMany: vi.fn().mockResolvedValue([]),
    },
    supportInstallation: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    workspaceApiKey: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    workspaceMembership: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    user: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    session: { deleteMany: vi.fn().mockResolvedValue({ count: 3 }) },
  };
}

describe("cascadeSoftDeleteWorkspace", () => {
  it("soft-deletes all Tier 1 children of a workspace", async () => {
    const tx = createMockTx();
    await cascadeSoftDeleteWorkspace("ws_1", tx);

    expect(tx.supportTicketLink.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ workspaceId: "ws_1", deletedAt: null }),
      })
    );
    expect(tx.supportConversation.updateMany).toHaveBeenCalled();
    expect(tx.supportInstallation.updateMany).toHaveBeenCalled();
    expect(tx.workspaceApiKey.updateMany).toHaveBeenCalled();
    expect(tx.workspaceMembership.updateMany).toHaveBeenCalled();
  });

  it("uses the same timestamp for all children", async () => {
    const tx = createMockTx();
    await cascadeSoftDeleteWorkspace("ws_1", tx);

    const timestamps = [
      tx.supportTicketLink.updateMany,
      tx.supportDeliveryAttempt.updateMany,
      tx.supportConversation.updateMany,
      tx.supportInstallation.updateMany,
      tx.workspaceApiKey.updateMany,
      tx.workspaceMembership.updateMany,
    ].map((fn) => (fn as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]?.data?.deletedAt);

    const unique = new Set(timestamps.map((d: Date) => d?.getTime()));
    expect(unique.size).toBe(1);
  });
});

describe("cascadeSoftDeleteInstallation", () => {
  it("soft-deletes conversations and their children", async () => {
    const tx = createMockTx();
    tx.supportConversation.findMany = vi
      .fn()
      .mockResolvedValue([{ id: "conv_1" }, { id: "conv_2" }]);

    await cascadeSoftDeleteInstallation("ws_1", "inst_1", tx);

    expect(tx.supportConversation.findMany).toHaveBeenCalled();
    expect(tx.supportTicketLink.updateMany).toHaveBeenCalled();
    expect(tx.supportDeliveryAttempt.updateMany).toHaveBeenCalled();
    expect(tx.supportConversation.updateMany).toHaveBeenCalled();
  });

  it("skips child deletes when no conversations exist", async () => {
    const tx = createMockTx();
    tx.supportConversation.findMany = vi.fn().mockResolvedValue([]);

    await cascadeSoftDeleteInstallation("ws_1", "inst_1", tx);

    expect(tx.supportTicketLink.updateMany).not.toHaveBeenCalled();
    expect(tx.supportConversation.updateMany).toHaveBeenCalled();
  });
});

describe("cascadeSoftDeleteConversation", () => {
  it("soft-deletes delivery attempts and ticket links", async () => {
    const tx = createMockTx();
    await cascadeSoftDeleteConversation("conv_1", tx);

    expect(tx.supportTicketLink.updateMany).toHaveBeenCalled();
    expect(tx.supportDeliveryAttempt.updateMany).toHaveBeenCalled();
  });
});

describe("cascadeDeactivateUser", () => {
  it("soft-deletes user and hard-deletes their sessions", async () => {
    const tx = createMockTx();
    await cascadeDeactivateUser("user_1", tx);

    expect(tx.user.updateMany).toHaveBeenCalled();
    expect(tx.session.deleteMany).toHaveBeenCalled();
  });

  it("uses the same timestamp for user and memberships", async () => {
    const tx = createMockTx();
    await cascadeDeactivateUser("user_1", tx);

    const userTs = (tx.user.updateMany as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]?.data
      ?.deletedAt;
    const memberTs = (tx.workspaceMembership.updateMany as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0]?.data?.deletedAt;

    expect(userTs).toEqual(memberTs);
  });
});
