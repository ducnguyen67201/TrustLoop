"use server";

import { createCheckoutSession, createPortalSession } from "@shared/rest";

export async function startCheckout(
  workspaceId: string,
  tier: "STARTER" | "PRO",
  returnUrl: string
): Promise<{ url?: string; error?: string }> {
  try {
    const url = await createCheckoutSession(workspaceId, tier, returnUrl);
    return { url };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to start checkout";
    console.error("[billing] Checkout error:", message);
    return { error: message };
  }
}

export async function startPortalSession(
  workspaceId: string,
  returnUrl: string
): Promise<{ url?: string; error?: string }> {
  try {
    const url = await createPortalSession(workspaceId, returnUrl);
    return { url };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to open billing portal";
    console.error("[billing] Portal error:", message);
    return { error: message };
  }
}
