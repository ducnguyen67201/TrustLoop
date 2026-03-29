import { handleRestHealth } from "@/server/http/rest/system/health";

export async function GET() {
  return handleRestHealth();
}
