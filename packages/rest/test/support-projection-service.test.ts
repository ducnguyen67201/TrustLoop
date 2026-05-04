import * as supportProjection from "@shared/rest/services/support/support-projection-service";
import { beforeEach, describe, expect, it, vi } from "vitest";

const databaseMocks = vi.hoisted(() => ({
  supportConversationFindMany: vi.fn(),
}));

vi.mock("@shared/database", () => ({
  prisma: {
    supportConversation: {
      findMany: databaseMocks.supportConversationFindMany,
    },
  },
}));

describe("supportProjection.listConversations", () => {
  beforeEach(() => {
    databaseMocks.supportConversationFindMany.mockReset();
  });

  it("loads board conversations newest first", async () => {
    databaseMocks.supportConversationFindMany.mockResolvedValue([]);

    await supportProjection.listConversations({
      workspaceId: "ws_test",
      limit: 50,
    });

    expect(databaseMocks.supportConversationFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [
          { staleAt: { sort: "desc", nulls: "last" } },
          { customerWaitingSince: { sort: "desc", nulls: "last" } },
          { retryCount: "desc" },
          { lastActivityAt: "desc" },
        ],
      })
    );
  });
});
