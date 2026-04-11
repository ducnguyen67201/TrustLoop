import { handleGoogleOAuthStart } from "@/server/http/rest/auth/google-oauth-handlers";

export async function GET(request: Request) {
  return handleGoogleOAuthStart(request);
}
