import { describe, expect, it, vi } from "vitest";

const NINETY_DAYS_AGO = new Date(Date.now() - 91 * 24 * 60 * 60 * 1000);
const YESTERDAY = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000);

interface MockRecord {
  id: string;
  deletedAt: Date | null;
  workspaceId?: string;
}

function createRealisticDelegate(records: MockRecord[]) {
  return {
    deleteMany: vi
      .fn()
      .mockImplementation(({ where }: { where: { deletedAt: { not: null; lt: Date } } }) => {
        const cutoff = where.deletedAt.lt;
        const toDelete = records.filter((r) => r.deletedAt !== null && r.deletedAt < cutoff);
        const remaining = records.filter((r) => !(r.deletedAt !== null && r.deletedAt < cutoff));
        records.length = 0;
        records.push(...remaining);
        return Promise.resolve({ count: toDelete.length });
      }),
    count: vi
      .fn()
      .mockImplementation(({ where }: { where: { deletedAt: { not: null; lt: Date } } }) => {
        const cutoff = where.deletedAt.lt;
        return Promise.resolve(
          records.filter((r) => r.deletedAt !== null && r.deletedAt < cutoff).length
        );
      }),
    findFirst: vi
      .fn()
      .mockImplementation(({ where }: { where: { id: string; deletedAt: { not: null } } }) => {
        return Promise.resolve(
          records.find((r) => r.id === where.id && r.deletedAt !== null) ?? null
        );
      }),
    delete: vi.fn().mockImplementation(({ where }: { where: { id: string } }) => {
      const idx = records.findIndex((r) => r.id === where.id);
      if (idx === -1) throw new Error("Record not found");
      return Promise.resolve(records.splice(idx, 1)[0]);
    }),
  };
}

function createMockClient(
  overrides: Record<string, ReturnType<typeof createRealisticDelegate>> = {}
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
  const client: Record<string, ReturnType<typeof createRealisticDelegate>> = {};
  for (const m of models) client[m] = overrides[m] ?? createRealisticDelegate([]);
  return client;
}

async function load() {
  return import("../src/hard-delete");
}

describe("purge: retention window", () => {
  it("purges old records, keeps recent soft-deletes and active records", async () => {
    const { purgeDeletedRecords } = await load();
    const records: MockRecord[] = [
      { id: "u1", deletedAt: NINETY_DAYS_AGO },
      { id: "u2", deletedAt: YESTERDAY },
      { id: "u3", deletedAt: null },
    ];
    const client = createMockClient({ user: createRealisticDelegate(records) });

    await purgeDeletedRecords(client as never, { retentionDays: 90 });

    expect(records.find((r) => r.id === "u1")).toBeUndefined();
    expect(records.find((r) => r.id === "u2")).toBeDefined();
    expect(records.find((r) => r.id === "u3")).toBeDefined();
  });

  it("does not purge active records", async () => {
    const { purgeDeletedRecords } = await load();
    const records: MockRecord[] = [
      { id: "w1", deletedAt: null },
      { id: "w2", deletedAt: null },
    ];
    const client = createMockClient({ workspace: createRealisticDelegate(records) });

    await purgeDeletedRecords(client as never, { retentionDays: 1 });

    expect(records).toHaveLength(2);
  });
});

describe("purge: dependency ordering", () => {
  it("deletes children before parents", async () => {
    const { purgeDeletedRecords } = await load();
    const callOrder: string[] = [];
    const client = createMockClient();
    for (const [key, delegate] of Object.entries(client)) {
      delegate.deleteMany.mockImplementation(() => {
        callOrder.push(key);
        return Promise.resolve({ count: 0 });
      });
    }

    await purgeDeletedRecords(client as never);

    expect(callOrder.indexOf("supportTicketLink")).toBeLessThan(
      callOrder.indexOf("supportConversation")
    );
    expect(callOrder.indexOf("supportConversation")).toBeLessThan(
      callOrder.indexOf("supportInstallation")
    );
    expect(callOrder.indexOf("workspaceMembership")).toBeLessThan(callOrder.indexOf("workspace"));
    expect(callOrder.indexOf("workspace")).toBeLessThan(callOrder.indexOf("user"));
  });
});

describe("hardDeleteById: safety", () => {
  it("deletes a soft-deleted record", async () => {
    const { hardDeleteById } = await load();
    const records: MockRecord[] = [
      { id: "u1", deletedAt: YESTERDAY },
      { id: "u2", deletedAt: null },
    ];
    const client = createMockClient({ user: createRealisticDelegate(records) });

    await hardDeleteById(client as never, "User", "u1");

    expect(records).toHaveLength(1);
    expect(records[0].id).toBe("u2");
  });

  it("refuses active records", async () => {
    const { hardDeleteById } = await load();
    const records: MockRecord[] = [{ id: "u1", deletedAt: null }];
    const client = createMockClient({ user: createRealisticDelegate(records) });

    await expect(hardDeleteById(client as never, "User", "u1")).rejects.toThrow(
      "not found or not soft-deleted"
    );
    expect(records).toHaveLength(1);
  });

  it("refuses nonexistent records", async () => {
    const { hardDeleteById } = await load();
    const client = createMockClient();

    await expect(hardDeleteById(client as never, "User", "ghost")).rejects.toThrow(
      "not found or not soft-deleted"
    );
  });
});

describe("cascade purge scenario", () => {
  it("purges workspace and all children past retention", async () => {
    const { purgeDeletedRecords } = await load();
    const ws: MockRecord[] = [{ id: "ws1", deletedAt: NINETY_DAYS_AGO }];
    const members: MockRecord[] = [
      { id: "m1", deletedAt: NINETY_DAYS_AGO, workspaceId: "ws1" },
      { id: "m2", deletedAt: NINETY_DAYS_AGO, workspaceId: "ws1" },
    ];
    const convos: MockRecord[] = [{ id: "c1", deletedAt: NINETY_DAYS_AGO }];
    const tickets: MockRecord[] = [{ id: "t1", deletedAt: NINETY_DAYS_AGO }];

    const client = createMockClient({
      workspace: createRealisticDelegate(ws),
      workspaceMembership: createRealisticDelegate(members),
      supportConversation: createRealisticDelegate(convos),
      supportTicketLink: createRealisticDelegate(tickets),
    });

    const results = await purgeDeletedRecords(client as never, { retentionDays: 90 });
    const total = results.reduce((sum, r) => sum + r.deletedCount, 0);

    expect(total).toBe(5);
    expect(ws).toHaveLength(0);
    expect(members).toHaveLength(0);
    expect(convos).toHaveLength(0);
    expect(tickets).toHaveLength(0);
  });

  it("keeps recently soft-deleted workspace and children", async () => {
    const { purgeDeletedRecords } = await load();
    const ws: MockRecord[] = [{ id: "ws1", deletedAt: YESTERDAY }];
    const members: MockRecord[] = [{ id: "m1", deletedAt: YESTERDAY }];
    const client = createMockClient({
      workspace: createRealisticDelegate(ws),
      workspaceMembership: createRealisticDelegate(members),
    });

    await purgeDeletedRecords(client as never, { retentionDays: 90 });

    expect(ws).toHaveLength(1);
    expect(members).toHaveLength(1);
  });
});

describe("dry run vs real purge", () => {
  it("dry run counts without modifying, real purge removes", async () => {
    const { purgeDeletedRecords } = await load();
    const records: MockRecord[] = [
      { id: "u1", deletedAt: NINETY_DAYS_AGO },
      { id: "u2", deletedAt: NINETY_DAYS_AGO },
    ];
    const client = createMockClient({ user: createRealisticDelegate(records) });

    const dry = await purgeDeletedRecords(client as never, { retentionDays: 90, dryRun: true });
    expect(dry.find((r) => r.model === "User")?.deletedCount).toBe(2);
    expect(records).toHaveLength(2);

    const real = await purgeDeletedRecords(client as never, { retentionDays: 90 });
    expect(real.find((r) => r.model === "User")?.deletedCount).toBe(2);
    expect(records).toHaveLength(0);
  });
});
