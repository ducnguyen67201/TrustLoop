import { handleSystemHealth } from "@/server/http/system/health";

export async function GET() {
  return handleSystemHealth();
}
