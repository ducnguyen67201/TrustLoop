import { handleRepositorySearch } from "@/server/http/rest/codex/search";

export async function POST(request: Request) {
  return handleRepositorySearch(request);
}
