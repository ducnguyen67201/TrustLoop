import {
  cascadeSoftDeleteConversation,
  cascadeSoftDeleteInstallation,
  cascadeSoftDeleteWorkspace,
} from "@shared/rest/services/soft-delete-cascade";
import { describe, expect, it, vi } from "vitest";

function createMockTx() {
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
  } as any;
}

describe("cascadeSoftDeleteWorkspace", () => {
  it("soft-deletes all Tier 1 children of a workspace", async () => {
    const tx = createMockTx();
    await cascadeSoftDeleteWorkspace("ws_1", tx);

    expect(tx.supportTicketLink.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ workspaceId: "ws_1", deletedAt: null }),
        data: expect.objectContaining({ deletedAt: expect.any(Date) }),
      })
    );
    expect(tx.supportDeliveryAttempt.updateMany).toHaveBeenCalled();
    expect(tx.supportConversation.updateMany).toHaveBeenCalled();
    expect(tx.supportInstallation.updateMany).toHaveBeenCalled();
    expect(tx.workspaceApiKey.updateMany).toHaveBeenCalled();
    expect(tx.workspaceMembership.updateMany).toHaveBeenCalled();
  });

  it("uses the same timestamp for all children", async () => {
    const tx = createMockTx();
    await cascadeSoftDeleteWorkspace("ws_1", tx);

    const timestamps = [
      tx.supportTicketLink.updateMany.mock.calls[0][0].data.deletedAt,
      tx.supportDeliveryAttempt.updateMany.mock.calls[0][0].data.deletedAt,
      tx.supportConversation.updateMany.mock.calls[0][0].data.deletedAt,
      tx.supportInstallation.updateMany.mock.calls[0][0].data.deletedAt,
      tx.workspaceApiKey.updateMany.mock.calls[0][0].data.deletedAt,
      tx.workspaceMembership.updateMany.mock.calls[0][0].data.deletedAt,
    ];

    const first = timestamps[0].getTime();
    for (const ts of timestamps) {
      expect(ts.getTime()).toBe(first);
    }
  });
});

describe("cascadeSoftDeleteInstallation", () => {
  it("soft-deletes conversations and their children", async () => {
    const tx = createMockTx();
    tx.supportConversation.findMany.mockResolvedValue([
      { id: "conv_1" },
      { id: "conv_2" },
    ]);

    await cascadeSoftDeleteInstallation("inst_1", "ws_1", tx);

    expect(tx.supportConversation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          installationId: "inst_1",
          workspaceId: "ws_1",
          deletedAt: null,
        }),
      })
    );
    expect(tx.supportDeliveryAttempt.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          conversationId: { in: ["conv_1", "conv_2"] },
        }),
      })
    );
    expect(tx.supportTicketLink.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          conversationId: { in: ["conv_1", "conv_2"] },
        }),
      })
    );
  });

  it("skips child deletes when no conversations exist", async () => {
    const tx = createMockTx();
    tx.supportConversation.findMany.mockResolvedValue([]);

    await cascadeSoftDeleteInstallation("inst_1", "ws_1", tx);

    expect(tx.supportConversation.updateMany).toHaveBeenCalled();
    expect(tx.supportDeliveryAttempt.updateMany).not.toHaveBeenCalled();
    expect(tx.supportTicketLink.updateMany).not.toHaveBeenCalled();
  });
});

describe("cascadeSoftDeleteConversation", () => {
  it("soft-deletes delivery attempts and ticket links", async () => {
    const tx = createMockTx();
    await cascadeSoftDeleteConversation("conv_1", tx);

    expect(tx.supportDeliveryAttempt.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ conversationId: "conv_1", deletedAt: null }),
        data: expect.objectContaining({ deletedAt: expect.any(Date) }),
      })
    );
    expect(tx.supportTicketLink.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ conversationId: "conv_1", deletedAt: null }),
        data: expect.objectContaining({ deletedAt: expect.any(Date) }),
      })
    );
  });
});
