import { handleRepositorySelection } from "@/server/http/rest/codex/repositories";

export async function POST(request: Request) {
  return handleRepositorySelection(request);
}
