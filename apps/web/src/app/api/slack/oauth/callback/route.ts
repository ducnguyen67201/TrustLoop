import { handleSlackOAuthCallback } from "@/server/http/rest/support/slack-oauth-callback";

export async function GET(request: Request) {
  return handleSlackOAuthCallback(request);
}
