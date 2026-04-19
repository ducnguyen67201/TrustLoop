import { processSlackWebhookFromHttpRequest } from "@shared/rest";
import { NextResponse } from "next/server";

/**
 * Slack requires signature verification against the raw body, so this handler
 * reads text first and only parses through the shared service layer.
 */
export async function handleSlackEventsWebhook(request: Request): Promise<NextResponse> {
  const rawBody = await request.text();

  try {
    const result = await processSlackWebhookFromHttpRequest(rawBody, {
      signature: request.headers.get("x-slack-signature"),
      timestamp: request.headers.get("x-slack-request-timestamp"),
    });

    if (result.kind === "challenge") {
      return NextResponse.json({ challenge: result.challenge });
    }

    return NextResponse.json(result.ack, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Slack webhook processing failed";
    const status = error instanceof Error && error.name === "ValidationError" ? 400 : 500;
    console.error("[slack-events] webhook processing failed", {
      status,
      message,
      stack: error instanceof Error ? error.stack : undefined,
    });
    return NextResponse.json(
      {
        error: message,
      },
      { status }
    );
  }
}
