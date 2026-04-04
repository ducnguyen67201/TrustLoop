import { describe, expect, it, vi } from "vitest";
import { findIncludingDeleted, resurrectOrUpsert } from "../src/soft-delete-helpers";

function createMockDelegate(findResult: any = null) {
  return {
    findFirst: vi.fn().mockResolvedValue(findResult),
    update: vi.fn().mockImplementation(async (args: any) => ({
      id: findResult?.id ?? "new_id",
      ...args.data,
    })),
  };
}

describe("findIncludingDeleted", () => {
  it("passes includeDeleted: true to findFirst", async () => {
    const delegate = createMockDelegate();
    await findIncludingDeleted(delegate, {
      where: { provider: "SLACK", providerInstallationId: "app_1" },
    });

    expect(delegate.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ includeDeleted: true })
    );
  });

  it("forwards where clause and select", async () => {
    const delegate = createMockDelegate();
    await findIncludingDeleted(delegate, {
      where: { id: "test_id" },
      select: { id: true },
    });

    expect(delegate.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "test_id" },
        select: { id: true },
      })
    );
  });

  it("returns null when no record found", async () => {
    const delegate = createMockDelegate(null);
    const result = await findIncludingDeleted(delegate, { where: { id: "missing" } });
    expect(result).toBeNull();
  });

  it("returns the soft-deleted record when found", async () => {
    const deleted = { id: "del_1", deletedAt: new Date() };
    const delegate = createMockDelegate(deleted);
    const result = await findIncludingDeleted(delegate, { where: { id: "del_1" } });
    expect(result).toEqual(deleted);
  });
});

describe("resurrectOrUpsert", () => {
  it("resurrects a soft-deleted record by clearing deletedAt", async () => {
    const deleted = { id: "del_1" };
    const delegate = createMockDelegate(deleted);

    await resurrectOrUpsert(
      delegate,
      { workspaceId: "ws_1", userId: "u_1" },
      { role: "ADMIN" },
      async () => ({ id: "new_id", role: "ADMIN" })
    );

    expect(delegate.update).toHaveBeenCalledWith({
      where: { id: "del_1" },
      data: { deletedAt: null, role: "ADMIN" },
    });
  });

  it("calls fallback when no soft-deleted record exists", async () => {
    const delegate = createMockDelegate(null);
    const fallback = vi.fn().mockResolvedValue({ id: "new_id", role: "MEMBER" });

    const result = await resurrectOrUpsert(
      delegate,
      { workspaceId: "ws_1", userId: "u_1" },
      { role: "MEMBER" },
      fallback
    );

    expect(delegate.update).not.toHaveBeenCalled();
    expect(fallback).toHaveBeenCalled();
    expect(result).toEqual({ id: "new_id", role: "MEMBER" });
  });

  it("queries with deletedAt: { not: null } to find only soft-deleted records", async () => {
    const delegate = createMockDelegate(null);
    await resurrectOrUpsert(
      delegate,
      { provider: "SLACK" },
      { teamId: "T123" },
      async () => ({ id: "new" })
    );

    expect(delegate.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          provider: "SLACK",
          deletedAt: { not: null },
        }),
      })
    );
  });
});
