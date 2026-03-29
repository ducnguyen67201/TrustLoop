import { handleWorkflowDispatch } from "@/server/http/rest/workflows/dispatch";

export async function POST(request: Request) {
  return handleWorkflowDispatch(request);
}
