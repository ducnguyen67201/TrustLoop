import { handleGithubOAuthCallback } from "@/server/http/rest/codex/github-oauth-callback";

export async function GET(request: Request) {
  return handleGithubOAuthCallback(request);
}
