import { handleCodexConnect } from "@/server/http/rest/codex/connect";

export async function POST(request: Request) {
  return handleCodexConnect(request);
}
