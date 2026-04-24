import { expect, test } from "@playwright/test";

const now = "2026-04-12T12:00:00.000Z";

test("streams addressed agent-team dialogue in the preview panel", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("trustloop_csrf", "test-csrf-token");
  });

  await page.route("**/api/trpc/agentTeam.getLatestRunForConversation*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        result: {
          data: {
            json: null,
          },
        },
      }),
    });
  });

  await page.route("**/api/trpc/agentTeam.startRun", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        result: {
          data: {
            json: {
              id: "run_preview",
              workspaceId: "workspace_preview",
              teamId: "team_preview",
              conversationId: "conversation_preview",
              analysisId: null,
              status: "running",
              workflowId: "workflow_preview",
              startedAt: now,
              completedAt: null,
              errorMessage: null,
              createdAt: now,
              updatedAt: now,
              teamSnapshot: {
                roles: [
                  {
                    id: "role_architect",
                    teamId: "team_preview",
                    roleKey: "architect",
                    slug: "architect",
                    label: "Architect",
                    provider: "openai",
                    toolIds: ["searchCode"],
                    maxSteps: 6,
                    sortOrder: 0,
                  },
                ],
                edges: [],
              },
              messages: [],
              roleInboxes: [],
              facts: [],
              openQuestions: [],
            },
          },
        },
      }),
    });
  });

  await page.route("**/api/workspace_preview/agent-team-runs/run_preview/stream", async (route) => {
    const streamBody = [
      {
        runId: "run_preview",
        type: "snapshot",
        run: {
          id: "run_preview",
          workspaceId: "workspace_preview",
          teamId: "team_preview",
          conversationId: "conversation_preview",
          analysisId: null,
          status: "running",
          workflowId: "workflow_preview",
          startedAt: now,
          completedAt: null,
          errorMessage: null,
          createdAt: now,
          updatedAt: now,
          teamSnapshot: {
            roles: [
              {
                id: "role_architect",
                teamId: "team_preview",
                roleKey: "architect",
                slug: "architect",
                label: "Architect",
                provider: "openai",
                toolIds: ["searchCode"],
                maxSteps: 6,
                sortOrder: 0,
              },
            ],
            edges: [],
          },
          messages: [
            {
              id: "msg_1",
              runId: "run_preview",
              threadId: "thread_architect",
              fromRoleKey: "architect",
              fromRoleSlug: "architect",
              fromRoleLabel: "Architect",
              toRoleKey: "reviewer",
              kind: "proposal",
              subject: "Review the fix shape",
              content: "Challenge the null-guard proposal before PR creation.",
              parentMessageId: null,
              refs: [],
              toolName: null,
              metadata: null,
              createdAt: now,
            },
          ],
          roleInboxes: [
            {
              id: "inbox_1",
              runId: "run_preview",
              roleKey: "reviewer",
              state: "queued",
              lastReadMessageId: null,
              wakeReason: "architect:proposal:Review the fix shape",
              unreadCount: 1,
              lastWokenAt: null,
              createdAt: now,
              updatedAt: now,
            },
          ],
          facts: [
            {
              id: "fact_1",
              runId: "run_preview",
              statement: "Slack reply threading fails before parent lookup.",
              confidence: 0.94,
              sourceMessageIds: ["msg_1"],
              acceptedByRoleKeys: ["architect"],
              status: "accepted",
              createdAt: now,
              updatedAt: now,
            },
          ],
          openQuestions: [
            {
              id: "question_1",
              runId: "run_preview",
              askedByRoleKey: "architect",
              ownerRoleKey: "reviewer",
              question: "Can reviewer confirm regression coverage?",
              blockingRoleKeys: ["reviewer"],
              status: "open",
              sourceMessageId: "msg_1",
              createdAt: now,
              updatedAt: now,
            },
          ],
        },
        errorMessage: null,
        timestamp: now,
      },
      {
        runId: "run_preview",
        type: "complete",
        run: {
          id: "run_preview",
          workspaceId: "workspace_preview",
          teamId: "team_preview",
          conversationId: "conversation_preview",
          analysisId: null,
          status: "completed",
          workflowId: "workflow_preview",
          startedAt: now,
          completedAt: now,
          errorMessage: null,
          createdAt: now,
          updatedAt: now,
          teamSnapshot: {
            roles: [
              {
                id: "role_architect",
                teamId: "team_preview",
                roleKey: "architect",
                slug: "architect",
                label: "Architect",
                provider: "openai",
                toolIds: ["searchCode"],
                maxSteps: 6,
                sortOrder: 0,
              },
            ],
            edges: [],
          },
          messages: [
            {
              id: "msg_1",
              runId: "run_preview",
              threadId: "thread_architect",
              fromRoleKey: "architect",
              fromRoleSlug: "architect",
              fromRoleLabel: "Architect",
              toRoleKey: "reviewer",
              kind: "proposal",
              subject: "Review the fix shape",
              content: "Challenge the null-guard proposal before PR creation.",
              parentMessageId: null,
              refs: [],
              toolName: null,
              metadata: null,
              createdAt: now,
            },
          ],
          roleInboxes: [
            {
              id: "inbox_1",
              runId: "run_preview",
              roleKey: "reviewer",
              state: "done",
              lastReadMessageId: "msg_1",
              wakeReason: null,
              unreadCount: 0,
              lastWokenAt: now,
              createdAt: now,
              updatedAt: now,
            },
          ],
          facts: [
            {
              id: "fact_1",
              runId: "run_preview",
              statement: "Slack reply threading fails before parent lookup.",
              confidence: 0.94,
              sourceMessageIds: ["msg_1"],
              acceptedByRoleKeys: ["architect"],
              status: "accepted",
              createdAt: now,
              updatedAt: now,
            },
          ],
          openQuestions: [
            {
              id: "question_1",
              runId: "run_preview",
              askedByRoleKey: "architect",
              ownerRoleKey: "reviewer",
              question: "Can reviewer confirm regression coverage?",
              blockingRoleKeys: ["reviewer"],
              status: "answered",
              sourceMessageId: "msg_1",
              createdAt: now,
              updatedAt: now,
            },
          ],
        },
        errorMessage: null,
        timestamp: now,
      },
    ]
      .map((event) => `data: ${JSON.stringify(event)}\n\n`)
      .join("");

    await route.fulfill({
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
      body: streamBody,
    });
  });

  await page.goto("/dev/agent-team-panel");

  await expect(page.getByRole("button", { name: "Run default team" })).toBeVisible();
  await page.getByRole("button", { name: "Run default team" }).click();

  await expect(page.getByTestId("agent-team-run-panel")).toBeVisible();
  await expect(page.getByText("completed")).toBeVisible();
  await expect(page.getByText("Review the fix shape")).toBeVisible();

  await page.getByRole("tab", { name: "Facts" }).click();
  await expect(page.getByText("Slack reply threading fails before parent lookup.")).toBeVisible();

  await page.getByRole("tab", { name: "Questions" }).click();
  await expect(page.getByText("Can reviewer confirm regression coverage?")).toBeVisible();

  await page.getByRole("tab", { name: "Inboxes" }).click();
  await expect(page.getByText("reviewer")).toBeVisible();
});
