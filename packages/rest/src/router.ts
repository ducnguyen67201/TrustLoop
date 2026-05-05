import { createAgentTeamRouter } from "@shared/rest/agent-team-router";
import { authRouter } from "@shared/rest/auth-router";
import { sessionReplayRouter } from "@shared/rest/session-replay-router";
import { createSupportAnalysisRouter } from "@shared/rest/support-analysis-router";
import { supportInboxRouter } from "@shared/rest/support-inbox-router";
import { supportInstallationRouter } from "@shared/rest/support-installation-router";
import {
  type WorkflowDispatcher,
  temporalWorkflowDispatcher,
} from "@shared/rest/temporal-dispatcher";
import { publicProcedure, router } from "@shared/rest/trpc";
import { workspaceAiSettingsRouter } from "@shared/rest/workspace-ai-settings-router";
import { workspaceApiKeyRouter } from "@shared/rest/workspace-api-key-router";
import { createWorkspaceKnowledgeRouter } from "@shared/rest/workspace-knowledge-router";
import { workspaceRouter } from "@shared/rest/workspace-router";
import { healthResponseSchema } from "@shared/types";

// Internal workflow dispatch is served exclusively by the authenticated REST
// endpoint at /api/rest/workflows/dispatch (withServiceAuth). It is NOT exposed
// via tRPC — the public tRPC router was an unauthenticated path that would let
// any caller enqueue support, support-analysis, send-draft-to-slack, codex, and
// repository-index workflows. See docs/domains/support/impl-slack-ingestion-thread-grouping-p0-checklist.md
// and packages/rest/src/security/rest-auth.ts.

export function createAppRouter(dispatcher: WorkflowDispatcher = temporalWorkflowDispatcher) {
  return router({
    auth: authRouter,
    agentTeam: createAgentTeamRouter(dispatcher),
    supportAnalysis: createSupportAnalysisRouter(dispatcher),
    sessionReplay: sessionReplayRouter,
    supportInbox: supportInboxRouter,
    supportInstallation: supportInstallationRouter,
    workspace: workspaceRouter,
    workspaceAiSettings: workspaceAiSettingsRouter,
    workspaceApiKey: workspaceApiKeyRouter,
    workspaceKnowledge: createWorkspaceKnowledgeRouter(dispatcher),
    health: publicProcedure.query(() =>
      healthResponseSchema.parse({
        ok: true,
        service: "web",
        timestamp: new Date().toISOString(),
      })
    ),
  });
}

export const appRouter = createAppRouter();
export type AppRouter = typeof appRouter;
