import { handleSearchFeedback } from "@/server/http/rest/codex/search";

export async function POST(request: Request) {
  return handleSearchFeedback(request);
}
