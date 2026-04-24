import {
  AGENT_TEAM_EVENT_KIND,
  AGENT_TEAM_MESSAGE_KIND,
  AGENT_TEAM_ROLE_SLUG,
  AGENT_TEAM_TARGET,
  type AgentTeamDialogueMessageDraft,
} from "@shared/types";
import { beforeAll, describe, expect, it } from "vitest";

let buildMessageSentDraft: typeof import(
  "../src/domains/agent-team/agent-team-run.activity"
).buildMessageSentDraft;

beforeAll(async () => {
  process.env.APP_BASE_URL ??= "http://localhost:3000";
  process.env.SESSION_COOKIE_NAME ??= "trustloop_session";
  process.env.SESSION_TTL_HOURS ??= "24";
  process.env.SESSION_SECRET ??= "test-session-secret-value";
  process.env.API_KEY_PEPPER ??= "test-api-pepper-1234";
  process.env.INTERNAL_SERVICE_KEY ??= "tli_test_service_key_value";
  process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/trustloop";
  process.env.TEMPORAL_ADDRESS ??= "localhost:7233";
  process.env.TEMPORAL_NAMESPACE ??= "default";

  ({ buildMessageSentDraft } = await import("../src/domains/agent-team/agent-team-run.activity"));
});

describe("buildMessageSentDraft — event-projection parity", () => {
  it("mirrors every persisted message field into the event payload", () => {
    const message: AgentTeamDialogueMessageDraft = {
      toRoleKey: "reviewer",
      kind: AGENT_TEAM_MESSAGE_KIND.hypothesis,
      subject: "root cause of the null deref",
      content: "checkout.ts:47 reads session.userId assuming presence.",
      refs: ["checkout.ts:47"],
    };
    const draft = buildMessageSentDraft({
      runId: "run_1",
      workspaceId: "ws_1",
      senderRole: {
        id: "role_architect",
        teamId: "team_1",
        roleKey: AGENT_TEAM_ROLE_SLUG.architect,
        slug: AGENT_TEAM_ROLE_SLUG.architect,
        label: "Architect",
        description: null,
        provider: "openai",
        model: null,
        toolIds: [],
        systemPromptOverride: null,
        maxSteps: 8,
        sortOrder: 0,
        metadata: null,
      },
      messageId: "msg_1",
      message,
    });
    expect(draft.kind).toBe(AGENT_TEAM_EVENT_KIND.messageSent);
    expect(draft.runId).toBe("run_1");
    expect(draft.workspaceId).toBe("ws_1");
    expect(draft.actor).toBe(AGENT_TEAM_ROLE_SLUG.architect);
    expect(draft.target).toBe("reviewer");
    expect(draft.messageKind).toBe(AGENT_TEAM_MESSAGE_KIND.hypothesis);
    if (draft.kind !== AGENT_TEAM_EVENT_KIND.messageSent) throw new Error("unreachable");
    expect(draft.payload.messageId).toBe("msg_1");
    expect(draft.payload.fromRoleKey).toBe(AGENT_TEAM_ROLE_SLUG.architect);
    expect(draft.payload.toRoleKey).toBe("reviewer");
    expect(draft.payload.kind).toBe(AGENT_TEAM_MESSAGE_KIND.hypothesis);
    expect(draft.payload.subject).toBe(message.subject);
    expect(draft.payload.contentPreview).toBe(message.content);
  });

  it("truncates contentPreview to 280 characters without losing the event", () => {
    const longContent = "x".repeat(1000);
    const draft = buildMessageSentDraft({
      runId: "run_1",
      workspaceId: "ws_1",
      senderRole: {
        id: "role_architect",
        teamId: "team_1",
        roleKey: AGENT_TEAM_ROLE_SLUG.architect,
        slug: AGENT_TEAM_ROLE_SLUG.architect,
        label: "Architect",
        description: null,
        provider: "openai",
        model: null,
        toolIds: [],
        systemPromptOverride: null,
        maxSteps: 8,
        sortOrder: 0,
        metadata: null,
      },
      messageId: "msg_1",
      message: {
        toRoleKey: AGENT_TEAM_TARGET.broadcast,
        kind: AGENT_TEAM_MESSAGE_KIND.status,
        subject: "long blob",
        content: longContent,
        refs: [],
      },
    });
    if (draft.kind !== AGENT_TEAM_EVENT_KIND.messageSent) throw new Error("unreachable");
    expect(draft.payload.contentPreview).toHaveLength(280);
  });

  it("preserves broadcast target unchanged", () => {
    const draft = buildMessageSentDraft({
      runId: "run_1",
      workspaceId: "ws_1",
      senderRole: {
        id: "role_pr_creator",
        teamId: "team_1",
        roleKey: AGENT_TEAM_ROLE_SLUG.prCreator,
        slug: AGENT_TEAM_ROLE_SLUG.prCreator,
        label: "PR Creator",
        description: null,
        provider: "openai",
        model: null,
        toolIds: [],
        systemPromptOverride: null,
        maxSteps: 8,
        sortOrder: 0,
        metadata: null,
      },
      messageId: "msg_42",
      message: {
        toRoleKey: AGENT_TEAM_TARGET.broadcast,
        kind: AGENT_TEAM_MESSAGE_KIND.decision,
        subject: "opening PR",
        content: "PR #284 drafted",
        refs: [],
      },
    });
    expect(draft.target).toBe(AGENT_TEAM_TARGET.broadcast);
  });
});
