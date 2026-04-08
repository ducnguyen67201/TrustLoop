import { handleStripeWebhook } from "@/server/http/rest/billing/stripe-webhook";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return handleStripeWebhook(request);
}
