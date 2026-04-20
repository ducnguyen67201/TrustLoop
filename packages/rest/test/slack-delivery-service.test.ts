import * as slackDelivery from "@shared/rest/services/support/adapters/slack/slack-delivery-service";
import { PermanentExternalError, TransientExternalError } from "@shared/types";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("slackDelivery.sendThreadReply", () => {
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

    const result = await slackDelivery.sendThreadReply({
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
      slackDelivery.sendThreadReply({
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
      slackDelivery.sendThreadReply({
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

  it("forwards clientMsgId as chat.postMessage.client_msg_id for native Slack de-dup", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        ok: true,
        ts: "1710000000.100200",
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await slackDelivery.sendThreadReply({
      provider: "SLACK",
      workspaceId: "ws_1",
      installationId: "inst_1",
      installationMetadata: { botToken: "xoxb-test-token" },
      thread: { teamId: "T1", channelId: "C1", threadTs: "1700000000.000100" },
      messageText: "Reply body",
      attachments: [],
      clientMsgId: "msg-nonce-abc-123",
    });

    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
    const body = calls[0]?.[1]?.body;
    expect(body).toContain('"client_msg_id":"msg-nonce-abc-123"');
  });

  it("classifies HTTP 5xx from Slack as transient (retryable)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("upstream down", { status: 503 }))
    );

    await expect(
      slackDelivery.sendThreadReply({
        provider: "SLACK",
        workspaceId: "ws_1",
        installationId: "inst_1",
        installationMetadata: { botToken: "xoxb-test-token" },
        thread: { teamId: "T1", channelId: "C1", threadTs: "1700000000.000100" },
        messageText: "Reply body",
        attachments: [],
      })
    ).rejects.toBeInstanceOf(TransientExternalError);
  });
});

describe("slackDelivery.findReplyByClientMsgId (reconciler)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // Happy path for the DELIVERY_UNKNOWN reconciliation loop: the send appeared
  // to fail locally (timeout, 5xx after Slack accepted) but conversations.replies
  // shows our nonce landed — so we can transition SENT with the recovered ts.
  it("returns the ts when a thread reply matches the clientMsgId", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        ok: true,
        messages: [
          { ts: "1700000000.000100", client_msg_id: "other" },
          { ts: "1700000001.200300", client_msg_id: "msg-nonce-abc-123" },
        ],
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const ts = await slackDelivery.findReplyByClientMsgId({
      installationMetadata: { botToken: "xoxb-test-token" },
      channelId: "C1",
      threadTs: "1700000000.000100",
      clientMsgId: "msg-nonce-abc-123",
    });

    expect(ts).toBe("1700000001.200300");
    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
    expect(calls[0]?.[0]).toContain("conversations.replies");
    expect(calls[0]?.[0]).toContain("channel=C1");
    expect(calls[0]?.[0]).toContain("ts=1700000000.000100");
  });

  // The other branch: the send truly didn't land, so nothing in the thread
  // carries our nonce. Caller must retry the send; must NOT transition SENT.
  it("returns null when the clientMsgId is not present in the thread", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          ok: true,
          messages: [{ ts: "1700000000.000100", client_msg_id: "someone-else" }],
        })
      )
    );

    const ts = await slackDelivery.findReplyByClientMsgId({
      installationMetadata: { botToken: "xoxb-test-token" },
      channelId: "C1",
      threadTs: "1700000000.000100",
      clientMsgId: "msg-nonce-not-found",
    });

    expect(ts).toBeNull();
  });

  it("throws TransientExternalError on Slack rate-limit during reconciliation", async () => {
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
      slackDelivery.findReplyByClientMsgId({
        installationMetadata: { botToken: "xoxb-test-token" },
        channelId: "C1",
        threadTs: "1700000000.000100",
        clientMsgId: "msg-nonce-xyz",
      })
    ).rejects.toBeInstanceOf(TransientExternalError);
  });
});
