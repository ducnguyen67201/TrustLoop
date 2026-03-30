import { handleCodexSettings } from "@/server/http/rest/codex/settings";

export async function GET(request: Request) {
  return handleCodexSettings(request);
}
