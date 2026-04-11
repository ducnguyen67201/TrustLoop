import { describe, expect, it, vi } from "vitest";

// Mock the PrismaClient delegates for each model
function createMockDelegate(records: Array<{ id: string; deletedAt: Date | null }> = []) {
  return {
    deleteMany: vi.fn().mockResolvedValue({ count: records.filter((r) => r.deletedAt).length }),
    count: vi.fn().mockResolvedValue(records.filter((r) => r.deletedAt).length),
    findFirst: vi
      .fn()
      .mockImplementation(({ where }: { where: { id: string; deletedAt: unknown } }) => {
        return Promise.resolve(
          records.find((r) => r.id === where.id && r.deletedAt !== null) ?? null
        );
      }),
    delete: vi.fn().mockResolvedValue({}),
  };
}

function createMockRawClient(
  overrides: Record<string, ReturnType<typeof createMockDelegate>> = {}
) {
  const models = [
    "user",
    "workspace",
    "workspaceMembership",
    "workspaceApiKey",
    "supportInstallation",
    "supportConversation",
    "supportDeliveryAttempt",
    "supportTicketLink",
  ];

  const client: Record<string, ReturnType<typeof createMockDelegate>> = {};
  for (const model of models) {
    client[model] = overrides[model] ?? createMockDelegate();
  }
  return client;
}

// Dynamic import to avoid env validation at import time
async function importHardDelete() {
  return import("../src/hard-delete");
}

describe("purgeDeletedRecords", () => {
  it("calls deleteMany on all models in dependency order", async () => {
    const { purgeDeletedRecords } = await importHardDelete();
    const mockClient = createMockRawClient();

    const results = await purgeDeletedRecords(mockClient as never, { retentionDays: 90 });

    expect(results).toHaveLength(8);
    expect(results[0].model).toBe("SupportTicketLink");
    expect(results[7].model).toBe("User");

    // Every model's deleteMany should have been called
    for (const key of Object.keys(mockClient)) {
      expect(mockClient[key].deleteMany).toHaveBeenCalledTimes(1);
    }
  });

  it("passes correct cutoff date to deleteMany", async () => {
    const { purgeDeletedRecords } = await importHardDelete();
    const mockClient = createMockRawClient();

    const before = Date.now();
    await purgeDeletedRecords(mockClient as never, { retentionDays: 30 });
    const after = Date.now();

    const call = mockClient.user.deleteMany.mock.calls[0][0];
    const cutoff = call.where.deletedAt.lt as Date;

    const expectedMin = before - 30 * 24 * 60 * 60 * 1000;
    const expectedMax = after - 30 * 24 * 60 * 60 * 1000;

    expect(cutoff.getTime()).toBeGreaterThanOrEqual(expectedMin);
    expect(cutoff.getTime()).toBeLessThanOrEqual(expectedMax);
  });

  it("uses default 90 days when retentionDays not specified", async () => {
    const { purgeDeletedRecords } = await importHardDelete();
    const mockClient = createMockRawClient();

    await purgeDeletedRecords(mockClient as never);

    const call = mockClient.user.deleteMany.mock.calls[0][0];
    const cutoff = call.where.deletedAt.lt as Date;
    const ninetyDaysAgo = Date.now() - 90 * 24 * 60 * 60 * 1000;

    expect(Math.abs(cutoff.getTime() - ninetyDaysAgo)).toBeLessThan(1000);
  });

  it("dryRun counts without deleting", async () => {
    const { purgeDeletedRecords } = await importHardDelete();
    const mockClient = createMockRawClient({
      user: createMockDelegate([
        { id: "u1", deletedAt: new Date("2020-01-01") },
        { id: "u2", deletedAt: new Date("2020-01-02") },
      ]),
    });

    const results = await purgeDeletedRecords(mockClient as never, { dryRun: true });

    const userResult = results.find((r) => r.model === "User");
    expect(userResult?.deletedCount).toBe(2);
    expect(mockClient.user.count).toHaveBeenCalled();
    expect(mockClient.user.deleteMany).not.toHaveBeenCalled();
  });

  it("returns correct count per model", async () => {
    const { purgeDeletedRecords } = await importHardDelete();
    const ticketDelegate = createMockDelegate([
      { id: "t1", deletedAt: new Date("2020-01-01") },
      { id: "t2", deletedAt: new Date("2020-01-02") },
      { id: "t3", deletedAt: new Date("2020-01-03") },
    ]);
    const mockClient = createMockRawClient({ supportTicketLink: ticketDelegate });

    const results = await purgeDeletedRecords(mockClient as never);

    const ticketResult = results.find((r) => r.model === "SupportTicketLink");
    expect(ticketResult?.deletedCount).toBe(3);
  });
});

describe("hardDeleteById", () => {
  it("deletes a soft-deleted record", async () => {
    const { hardDeleteById } = await importHardDelete();
    const deletedRecord = { id: "u1", deletedAt: new Date() };
    const mockClient = createMockRawClient({
      user: createMockDelegate([deletedRecord]),
    });

    await hardDeleteById(mockClient as never, "User", "u1");

    expect(mockClient.user.delete).toHaveBeenCalledWith({ where: { id: "u1" } });
  });

  it("throws when record is not soft-deleted", async () => {
    const { hardDeleteById } = await importHardDelete();
    const activeRecord = { id: "u1", deletedAt: null };
    const mockClient = createMockRawClient({
      user: createMockDelegate([activeRecord]),
    });

    await expect(hardDeleteById(mockClient as never, "User", "u1")).rejects.toThrow(
      "Cannot hard-delete User u1: record not found or not soft-deleted"
    );
    expect(mockClient.user.delete).not.toHaveBeenCalled();
  });

  it("throws when record does not exist", async () => {
    const { hardDeleteById } = await importHardDelete();
    const mockClient = createMockRawClient();

    await expect(hardDeleteById(mockClient as never, "User", "nonexistent")).rejects.toThrow(
      "Cannot hard-delete User nonexistent: record not found or not soft-deleted"
    );
  });
});

describe("countSoftDeletedRecords", () => {
  it("returns counts without deleting (delegates to dryRun)", async () => {
    const { countSoftDeletedRecords } = await importHardDelete();
    const mockClient = createMockRawClient();

    const results = await countSoftDeletedRecords(mockClient as never, 30);

    expect(results).toHaveLength(8);
    for (const key of Object.keys(mockClient)) {
      expect(mockClient[key].count).toHaveBeenCalled();
      expect(mockClient[key].deleteMany).not.toHaveBeenCalled();
    }
  });
});
