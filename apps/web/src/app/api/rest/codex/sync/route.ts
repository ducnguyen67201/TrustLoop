import { handleRepositorySync } from "@/server/http/rest/codex/sync";

export async function POST(request: Request) {
  return handleRepositorySync(request);
}
