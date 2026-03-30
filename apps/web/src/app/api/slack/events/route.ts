import { handleSlackEventsWebhook } from "@/server/http/rest/support/slack-events";

export async function POST(request: Request) {
  return handleSlackEventsWebhook(request);
}
