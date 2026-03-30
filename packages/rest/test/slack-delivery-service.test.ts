import { sendSlackThreadReply } from "@shared/rest/services/support/adapters/slack/slack-delivery-service";
import { PermanentExternalError, TransientExternalError } from "@shared/types";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("sendSlackThreadReply", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts a thread reply and appends attachment URLs into the Slack text body", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        ok: true,
        ts: "1710000000.100200",
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendSlackThreadReply({
      provider: "SLACK",
      workspaceId: "ws_1",
      installationId: "inst_1",
      installationMetadata: {
        botToken: "xoxb-test-token",
      },
      thread: {
        teamId: "T1",
        channelId: "C1",
        threadTs: "1700000000.000100",
      },
      messageText: "Reply body",
      attachments: [
        {
          title: "Screenshot",
          url: "https://example.com/screenshot.png",
        },
      ],
    });

    expect(result.providerMessageId).toBe("1710000000.100200");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
    const [url, init] = calls[0]!;
    expect(url).toBe("https://slack.com/api/chat.postMessage");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      Authorization: "Bearer xoxb-test-token",
    });
    expect(init.body).toContain('"channel":"C1"');
    expect(init.body).toContain('"thread_ts":"1700000000.000100"');
    expect(init.body).toContain("Reply body");
    expect(init.body).toContain("Attachments:");
    expect(init.body).toContain("Screenshot: https://example.com/screenshot.png");
  });

  it("classifies Slack rate limits as transient failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          ok: false,
          error: "ratelimited",
        })
      )
    );

    await expect(
      sendSlackThreadReply({
        provider: "SLACK",
        workspaceId: "ws_1",
        installationId: "inst_1",
        installationMetadata: {
          botToken: "xoxb-test-token",
        },
        thread: {
          teamId: "T1",
          channelId: "C1",
          threadTs: "1700000000.000100",
        },
        messageText: "Reply body",
        attachments: [],
      })
    ).rejects.toBeInstanceOf(TransientExternalError);
  });

  it("classifies invalid channel responses as permanent failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          ok: false,
          error: "channel_not_found",
        })
      )
    );

    await expect(
      sendSlackThreadReply({
        provider: "SLACK",
        workspaceId: "ws_1",
        installationId: "inst_1",
        installationMetadata: {
          botToken: "xoxb-test-token",
        },
        thread: {
          teamId: "T1",
          channelId: "C1",
          threadTs: "1700000000.000100",
        },
        messageText: "Reply body",
        attachments: [],
      })
    ).rejects.toBeInstanceOf(PermanentExternalError);
  });
});
