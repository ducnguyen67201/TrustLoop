import type { WorkflowDispatcher } from "@shared/rest/temporal-dispatcher";
import { router, workspaceRoleProcedure } from "@shared/rest/trpc";
import { TASK_QUEUES, WORKSPACE_ROLE } from "@shared/types";
import type { TRPCError } from "@trpc/server";
import { describe, expect, it } from "vitest";

// Regression coverage for the operator authorization boundary.
// Issue: before this fix, every supportInbox mutation rode workspaceProcedure,
// which accepts either a user session OR a workspace API key (tlk_*). Role was
// only populated on the session path, so any valid API key could drive
// operator mutations (send reply, mark done, assign). The same boundary also
// protects support read endpoints that expose operator/private data. The fix
// routes those procedures through workspaceRoleProcedure(MEMBER), and the
// middleware now rejects non-session actors explicitly.

const buildRouter = () =>
  router({
    protected: workspaceRoleProcedure(WORKSPACE_ROLE.MEMBER).query(() => "ok"),
  });

function buildCtx(overrides: {
  session?: unknown;
  user?: unknown;
  role?: string | null;
  apiKeyAuth?: { keyId: string; workspaceId: string } | null;
  activeWorkspaceId?: string | null;
}) {
  return {
    req: new Request("http://example.test/trpc"),
    resHeaders: new Headers(),
    session: (overrides.session ?? null) as never,
    user: (overrides.user ?? null) as never,
    activeWorkspaceId: overrides.activeWorkspaceId ?? null,
    role: (overrides.role ?? null) as never,
    apiKeyAuth: overrides.apiKeyAuth ?? null,
  };
}

const noopDispatcher = {
  async startSupportWorkflow() {
    return { workflowId: "wf", runId: "run", queue: TASK_QUEUES.SUPPORT };
  },
  async startSupportAnalysisWorkflow() {
    return { workflowId: "wf", runId: "run", queue: TASK_QUEUES.SUPPORT };
  },
  async startAgentTeamRunWorkflow() {
    return { workflowId: "wf", runId: "run", queue: TASK_QUEUES.SUPPORT };
  },
  async startAgentTeamRunResumeWorkflow() {
    return { workflowId: "wf", runId: "run", queue: TASK_QUEUES.SUPPORT };
  },
  async startSupportSummaryWorkflow() {
    return { workflowId: "wf", runId: "run", queue: TASK_QUEUES.SUPPORT };
  },
  async startRepositoryIndexWorkflow() {
    return { workflowId: "wf", runId: "run", queue: TASK_QUEUES.CODEX };
  },
  async startSendDraftToSlackWorkflow() {
    return { workflowId: "wf", runId: "run", queue: TASK_QUEUES.SUPPORT };
  },
} satisfies WorkflowDispatcher;

describe("workspaceRoleProcedure", () => {
  it("rejects workspace API key actors with UNAUTHORIZED", async () => {
    const caller = buildRouter().createCaller(
      buildCtx({
        apiKeyAuth: { keyId: "tlk_test_key_id", workspaceId: "ws_test" },
        activeWorkspaceId: "ws_test",
      })
    );

    await expect(caller.protected()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    } satisfies Partial<TRPCError>);
  });

  it("rejects unauthenticated (no session, no api key) actors", async () => {
    // workspaceProcedure's authenticatedActorMiddleware rejects this path first.
    const caller = buildRouter().createCaller(buildCtx({}));

    await expect(caller.protected()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    } satisfies Partial<TRPCError>);
  });

  it("rejects a session with null role (workspace membership lookup returned nothing)", async () => {
    const caller = buildRouter().createCaller(
      buildCtx({
        session: { id: "sess1", userId: "u1", csrfToken: "csrf", activeWorkspaceId: "ws_test" },
        user: { id: "u1", email: "u1@example.test", name: "u1" },
        role: null,
        activeWorkspaceId: "ws_test",
      })
    );

    // The explicit session+user gate passes, but the role check fails.
    await expect(caller.protected()).rejects.toMatchObject({
      code: "FORBIDDEN",
    } satisfies Partial<TRPCError>);
  });

  it("accepts a MEMBER session", async () => {
    const caller = buildRouter().createCaller(
      buildCtx({
        session: { id: "sess1", userId: "u1", csrfToken: "csrf", activeWorkspaceId: "ws_test" },
        user: { id: "u1", email: "u1@example.test", name: "u1" },
        role: WORKSPACE_ROLE.MEMBER,
        activeWorkspaceId: "ws_test",
      })
    );

    await expect(caller.protected()).resolves.toBe("ok");
  });
});

describe("supportInboxRouter operator mutations — API-key actor rejection", () => {
  it("updateConversationStatus rejects an api-key-only actor before touching the service layer", async () => {
    // Import here so the middleware chain fails fast at the boundary, never
    // reaching supportCommand.updateStatus. If the mutation is ever regressed
    // to workspaceProcedure, this test will fail (the call reaches the service
    // layer and blows up on the unmocked prisma import, or worse, succeeds).
    const { supportInboxRouter } = await import("@shared/rest/support-inbox-router");

    const caller = supportInboxRouter.createCaller(
      buildCtx({
        apiKeyAuth: { keyId: "tlk_test_key_id", workspaceId: "ws_test" },
        activeWorkspaceId: "ws_test",
      })
    );

    await expect(
      caller.updateConversationStatus({
        conversationId: "c1",
        status: "DONE",
      })
    ).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    } satisfies Partial<TRPCError>);
  });
});

describe("support read endpoints — API-key actor rejection", () => {
  it("listConversations rejects an api-key-only actor before reading inbox data", async () => {
    const { supportInboxRouter } = await import("@shared/rest/support-inbox-router");

    const caller = supportInboxRouter.createCaller(
      buildCtx({
        apiKeyAuth: { keyId: "tlk_test_key_id", workspaceId: "ws_test" },
        activeWorkspaceId: "ws_test",
      })
    );

    await expect(caller.listConversations({ limit: 1 })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    } satisfies Partial<TRPCError>);
  });

  it("getConversationTimeline rejects an api-key-only actor before reading timeline data", async () => {
    const { supportInboxRouter } = await import("@shared/rest/support-inbox-router");

    const caller = supportInboxRouter.createCaller(
      buildCtx({
        apiKeyAuth: { keyId: "tlk_test_key_id", workspaceId: "ws_test" },
        activeWorkspaceId: "ws_test",
      })
    );

    await expect(caller.getConversationTimeline({ conversationId: "c1" })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    } satisfies Partial<TRPCError>);
  });

  it("getLatestAnalysis rejects an api-key-only actor before reading analysis data", async () => {
    const { createSupportAnalysisRouter } = await import("@shared/rest/support-analysis-router");

    const caller = createSupportAnalysisRouter(noopDispatcher).createCaller(
      buildCtx({
        apiKeyAuth: { keyId: "tlk_test_key_id", workspaceId: "ws_test" },
        activeWorkspaceId: "ws_test",
      })
    );

    await expect(caller.getLatestAnalysis({ conversationId: "c1" })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    } satisfies Partial<TRPCError>);
  });
});

describe("sessionReplayRouter operator reads — API-key actor rejection", () => {
  it("getForConversation rejects an api-key-only actor before reading replay data", async () => {
    const { sessionReplayRouter } = await import("@shared/rest/session-replay-router");

    const caller = sessionReplayRouter.createCaller(
      buildCtx({
        apiKeyAuth: { keyId: "tlk_test_key_id", workspaceId: "ws_test" },
        activeWorkspaceId: "ws_test",
      })
    );

    await expect(caller.getForConversation({ conversationId: "c1" })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    } satisfies Partial<TRPCError>);
  });
});

describe("appRouter surface", () => {
  // Regression test for the pre-existing critical bug: dispatchWorkflow was mounted
  // on publicProcedure in createAppRouter, letting any unauthenticated caller enqueue
  // support / support-analysis / send-draft-to-slack / codex / repository-index
  // workflows via /api/trpc/dispatchWorkflow. Internal workflow dispatch now lives
  // exclusively at /api/rest/workflows/dispatch (withServiceAuth).
  it("does not expose dispatchWorkflow via tRPC", async () => {
    const { appRouter } = await import("@shared/rest");

    // Runtime assertion on the tRPC router's procedure registry. The type
    // system already enforces this at the client side, but a runtime check
    // fails loudly if anyone re-adds the procedure to appRouter and pushes
    // past the compile gate (e.g., via a dynamic key assignment).
    const procedureNames = Object.keys(appRouter._def.procedures);
    expect(procedureNames).not.toContain("dispatchWorkflow");
  });
});
