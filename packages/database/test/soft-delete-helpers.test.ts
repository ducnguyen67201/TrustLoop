import { describe, expect, it, vi } from "vitest";
import { findIncludingDeleted, softUpsert } from "../src/soft-delete-helpers";

type MockResult = Record<string, unknown> | null;

function createMockDelegate(findFirstResult: MockResult = null) {
  return {
    findFirst: vi.fn().mockResolvedValue(findFirstResult),
    update: vi.fn().mockImplementation(async (args: Record<string, unknown>) => ({
      id: (findFirstResult as Record<string, unknown>)?.id ?? "new_id",
      ...(args.data as Record<string, unknown>),
    })),
    create: vi.fn().mockImplementation(async (args: Record<string, unknown>) => ({
      id: "created_id",
      ...(args.data as Record<string, unknown>),
    })),
  };
}

describe("findIncludingDeleted", () => {
  it("passes includeDeleted: true to findFirst", async () => {
    const delegate = createMockDelegate();

    await findIncludingDeleted(delegate, { where: { id: "test" } });

    expect(delegate.findFirst).toHaveBeenCalledWith({
      where: { id: "test" },
      includeDeleted: true,
    });
  });

  it("returns the record if found", async () => {
    const record = { id: "found_id", deletedAt: new Date() };
    const delegate = createMockDelegate(record);

    const result = await findIncludingDeleted(delegate, { where: { id: "found_id" } });
    expect(result).toEqual(record);
  });

  it("returns null if no record found", async () => {
    const delegate = createMockDelegate(null);

    const result = await findIncludingDeleted(delegate, { where: { id: "missing" } });
    expect(result).toBeNull();
  });

  it("passes select option to findFirst", async () => {
    const delegate = createMockDelegate();

    await findIncludingDeleted(delegate, {
      where: { id: "test" },
      select: { id: true },
    });

    expect(delegate.findFirst).toHaveBeenCalledWith({
      where: { id: "test" },
      select: { id: true },
      includeDeleted: true,
    });
  });
});

describe("softUpsert", () => {
  it("updates existing active record", async () => {
    const existing = { id: "active_id", name: "old" };
    const delegate = createMockDelegate(existing);

    await softUpsert(delegate, {
      where: { id: "active_id" },
      create: { id: "active_id", name: "new" },
      update: { name: "updated" },
    });

    expect(delegate.update).toHaveBeenCalledWith({
      where: { id: "active_id" },
      data: { name: "updated" },
    });
    expect(delegate.create).not.toHaveBeenCalled();
  });

  it("creates new record when nothing exists", async () => {
    const delegate = createMockDelegate(null);

    await softUpsert(delegate, {
      where: { id: "test" },
      create: { id: "test", name: "new" },
      update: { name: "updated" },
    });

    expect(delegate.create).toHaveBeenCalledWith({
      data: { id: "test", name: "new" },
    });
  });

  it("resurrects soft-deleted record", async () => {
    const delegate = createMockDelegate(null);
    // First findFirst returns null (no active), second returns soft-deleted
    delegate.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "deleted_id", deletedAt: new Date() });

    await softUpsert(delegate, {
      where: { id: "test" },
      create: { id: "test", name: "resurrected" },
      update: { name: "updated" },
    });

    expect(delegate.update).toHaveBeenCalledWith({
      where: { id: "deleted_id" },
      data: { deletedAt: null, id: "test", name: "resurrected" },
    });
  });

  it("passes include option through to all operations", async () => {
    const existing = { id: "active_id", name: "old" };
    const delegate = createMockDelegate(existing);

    await softUpsert(delegate, {
      where: { id: "active_id" },
      create: { id: "active_id", name: "new" },
      update: { name: "updated" },
      include: { user: true },
    });

    expect(delegate.findFirst).toHaveBeenCalledWith({
      where: { id: "active_id" },
      include: { user: true },
    });
    expect(delegate.update).toHaveBeenCalledWith({
      where: { id: "active_id" },
      data: { name: "updated" },
      include: { user: true },
    });
  });

  it("never calls Prisma upsert", async () => {
    const delegate = {
      ...createMockDelegate(null),
      upsert: vi.fn(),
    };

    await softUpsert(delegate, {
      where: { id: "test" },
      create: { id: "test", name: "new" },
      update: { name: "updated" },
    });

    expect(delegate.upsert).not.toHaveBeenCalled();
  });
});
