export async function GET() {
  return Response.json({
    plan: "Pro",
    status: "active",
    renewalDate: "2026-06-01",
  });
}
