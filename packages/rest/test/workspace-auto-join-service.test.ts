import {
  PERSONAL_EMAIL_DOMAINS,
  type WorkspaceAutoJoinTx,
  ensureMembership,
  extractDomain,
  resolveWorkspaceFromVerifiedEmail,
} from "@shared/rest/services/auth/workspace-auto-join-service";
import { WORKSPACE_ROLE } from "@shared/types";
import { describe, expect, it, vi } from "vitest";

// The service imports findWorkspaceByEmailDomain from workspace-service.ts,
// which imports { prisma } from @shared/database at module-load time and
// triggers env validation. Empty mock is enough — the tests pass mock
// transaction clients to the functions directly, never through real prisma.
// Vitest hoists vi.mock above the imports so this takes effect at load time.
vi.mock("@shared/database", () => ({
  prisma: {},
}));

// ---------------------------------------------------------------------------
// extractDomain
// ---------------------------------------------------------------------------

describe("extractDomain", () => {
  it("extracts a lowercased domain from a well-formed email", () => {
    expect(extractDomain("alice@acme.com")).toBe("acme.com");
  });

  it("normalizes uppercase to lowercase", () => {
    expect(extractDomain("Alice@ACME.COM")).toBe("acme.com");
  });

  it("trims surrounding whitespace", () => {
    expect(extractDomain("  alice@acme.com  ")).toBe("acme.com");
  });

  it("returns null for email with no @", () => {
    expect(extractDomain("alice")).toBeNull();
  });

  it("returns null for email with empty local part", () => {
    expect(extractDomain("@acme.com")).toBeNull();
  });

  it("returns null for email with empty domain", () => {
    expect(extractDomain("alice@")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(extractDomain("")).toBeNull();
  });

  it("returns null for domain without a dot (bare hostname)", () => {
    expect(extractDomain("alice@localhost")).toBeNull();
  });

  it("handles sub-domains correctly", () => {
    expect(extractDomain("alice@eng.acme.co.uk")).toBe("eng.acme.co.uk");
  });
});

// ---------------------------------------------------------------------------
// resolveWorkspaceFromVerifiedEmail
// ---------------------------------------------------------------------------

describe("resolveWorkspaceFromVerifiedEmail", () => {
  function createMockTx(workspaceResult: { id: string } | null): {
    tx: WorkspaceAutoJoinTx;
    workspaceFindFirst: ReturnType<typeof vi.fn>;
  } {
    const workspaceFindFirst = vi.fn(async () => workspaceResult);
    const tx: WorkspaceAutoJoinTx = {
      workspace: { findFirst: workspaceFindFirst },
      workspaceMembership: {
        findFirst: async () => null,
        create: async () => null,
      },
    };
    return { tx, workspaceFindFirst };
  }

  it("returns null when emailVerified is false (defense in depth)", async () => {
    const { tx, workspaceFindFirst } = createMockTx({ id: "ws-acme" });

    const result = await resolveWorkspaceFromVerifiedEmail(tx, {
      email: "alice@acme.com",
      emailVerified: false,
    });

    expect(result).toBeNull();
    // Critical: the workspace lookup must not even run for unverified emails
    expect(workspaceFindFirst).not.toHaveBeenCalled();
  });

  it("returns null when extractDomain returns null (malformed email)", async () => {
    const { tx, workspaceFindFirst } = createMockTx({ id: "ws-acme" });

    const result = await resolveWorkspaceFromVerifiedEmail(tx, {
      email: "not-an-email",
      emailVerified: true,
    });

    expect(result).toBeNull();
    expect(workspaceFindFirst).not.toHaveBeenCalled();
  });

  // Parameterized: every personal-domain entry must reject auto-join.
  for (const domain of PERSONAL_EMAIL_DOMAINS) {
    it(`returns null for personal domain ${domain}`, async () => {
      const { tx, workspaceFindFirst } = createMockTx({ id: "ws-fake" });

      const result = await resolveWorkspaceFromVerifiedEmail(tx, {
        email: `alice@${domain}`,
        emailVerified: true,
      });

      expect(result).toBeNull();
      expect(workspaceFindFirst).not.toHaveBeenCalled();
    });
  }

  it("returns { workspaceId, role: MEMBER } when the domain matches an active workspace", async () => {
    const { tx, workspaceFindFirst } = createMockTx({ id: "ws-acme" });

    const result = await resolveWorkspaceFromVerifiedEmail(tx, {
      email: "alice@acme.com",
      emailVerified: true,
    });

    expect(result).toEqual({ workspaceId: "ws-acme", role: WORKSPACE_ROLE.MEMBER });
    expect(workspaceFindFirst).toHaveBeenCalledOnce();
    // Verify the query filters on deletedAt: null — soft-deleted workspaces
    // must NOT match.
    expect(workspaceFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ emailDomain: "acme.com", deletedAt: null }),
      })
    );
  });

  it("returns null when no matching workspace exists", async () => {
    const { tx, workspaceFindFirst } = createMockTx(null);

    const result = await resolveWorkspaceFromVerifiedEmail(tx, {
      email: "alice@acme.com",
      emailVerified: true,
    });

    expect(result).toBeNull();
    expect(workspaceFindFirst).toHaveBeenCalledOnce();
  });

  it("uses the tx client, not any global prisma singleton", async () => {
    const { tx, workspaceFindFirst } = createMockTx({ id: "ws-acme" });
    await resolveWorkspaceFromVerifiedEmail(tx, {
      email: "alice@acme.com",
      emailVerified: true,
    });
    // Structural check: the only way resolveWorkspace reads workspaces is
    // through the tx we passed. If someone refactored the helper to reach
    // for the global `prisma` client, this mock would never be called.
    expect(workspaceFindFirst).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// ensureMembership
// ---------------------------------------------------------------------------

describe("ensureMembership", () => {
  function createMockTx(options: {
    existing?: { id: string } | null;
    createThrows?: unknown;
  }): {
    tx: WorkspaceAutoJoinTx;
    findFirst: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  } {
    const findFirst = vi.fn(async () => options.existing ?? null);
    const create = vi.fn(async () => {
      if (options.createThrows !== undefined) {
        throw options.createThrows;
      }
      return { id: "membership-new" };
    });
    const tx: WorkspaceAutoJoinTx = {
      workspace: { findFirst: async () => null },
      workspaceMembership: { findFirst, create },
    };
    return { tx, findFirst, create };
  }

  it("creates a membership when no active row exists", async () => {
    const { tx, findFirst, create } = createMockTx({ existing: null });

    await ensureMembership(tx, {
      workspaceId: "ws-acme",
      userId: "user-alice",
      role: WORKSPACE_ROLE.MEMBER,
    });

    expect(findFirst).toHaveBeenCalledOnce();
    expect(create).toHaveBeenCalledOnce();
    expect(create).toHaveBeenCalledWith({
      data: {
        workspaceId: "ws-acme",
        userId: "user-alice",
        role: WORKSPACE_ROLE.MEMBER,
      },
    });
  });

  it("is a no-op when an active membership already exists", async () => {
    const { tx, findFirst, create } = createMockTx({
      existing: { id: "membership-existing" },
    });

    await ensureMembership(tx, {
      workspaceId: "ws-acme",
      userId: "user-alice",
      role: WORKSPACE_ROLE.MEMBER,
    });

    expect(findFirst).toHaveBeenCalledOnce();
    expect(create).not.toHaveBeenCalled();
  });

  it("filters findFirst on deletedAt: null so soft-deleted memberships do NOT block create", async () => {
    const { tx, findFirst, create } = createMockTx({ existing: null });

    await ensureMembership(tx, {
      workspaceId: "ws-acme",
      userId: "user-alice",
      role: WORKSPACE_ROLE.MEMBER,
    });

    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          workspaceId: "ws-acme",
          userId: "user-alice",
          deletedAt: null,
        }),
      })
    );
    expect(create).toHaveBeenCalledOnce();
  });

  it("swallows P2002 unique-constraint errors (concurrent race)", async () => {
    const prismaConflict = Object.assign(new Error("unique constraint violation"), {
      code: "P2002",
    });
    const { tx, create } = createMockTx({
      existing: null,
      createThrows: prismaConflict,
    });

    // Should resolve without throwing — the other request won the race
    // and the membership is already in the DB.
    await expect(
      ensureMembership(tx, {
        workspaceId: "ws-acme",
        userId: "user-alice",
        role: WORKSPACE_ROLE.MEMBER,
      })
    ).resolves.toBeUndefined();

    expect(create).toHaveBeenCalledOnce();
  });

  it("rethrows non-P2002 errors from create", async () => {
    const unexpectedError = new Error("database is on fire");
    const { tx } = createMockTx({
      existing: null,
      createThrows: unexpectedError,
    });

    await expect(
      ensureMembership(tx, {
        workspaceId: "ws-acme",
        userId: "user-alice",
        role: WORKSPACE_ROLE.MEMBER,
      })
    ).rejects.toBe(unexpectedError);
  });
});
