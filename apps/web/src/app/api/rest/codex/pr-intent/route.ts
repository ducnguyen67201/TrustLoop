import { handlePrIntent } from "@/server/http/rest/codex/pr-intent";

export async function POST(request: Request) {
  return handlePrIntent(request);
}
