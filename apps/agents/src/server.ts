import { timingSafeEqual } from "node:crypto";
import { serve } from "@hono/node-server";
import { env } from "@shared/env";
import { agentTeamRoleTurnInputSchema, analyzeRequestSchema } from "@shared/types";
import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";

import { runAnalysis, runTeamTurn } from "./agent";
import { listProviders } from "./providers";

export const app = new Hono();

// Service-key auth for the agent service. The /analyze and /team-turn
// endpoints accept workspaceId, conversationId, and analysisId from the
// request body — those values flow into Octokit calls and DB writes
// scoped to that workspace, so the body must come from a trusted caller.
// Mirrors withServiceAuth in packages/rest/src/security/rest-auth.ts but
// implemented for Hono. The queue worker is the only legitimate caller;
// it forwards INTERNAL_SERVICE_KEY in the Authorization header.
const SERVICE_KEY_PREFIX = "tli_";

function isServiceKeyFormat(token: string): boolean {
  return token.startsWith(SERVICE_KEY_PREFIX);
}

function verifyServiceKey(presented: string, expected: string): boolean {
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function extractBearerToken(req: Request): string | null {
  const authorization = req.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return null;
  const token = authorization.slice("Bearer ".length).trim();
  return token || null;
}

const requireServiceKey: MiddlewareHandler = async (c, next) => {
  const token = extractBearerToken(c.req.raw);
  if (!token || !isServiceKeyFormat(token) || !verifyServiceKey(token, env.INTERNAL_SERVICE_KEY)) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  await next();
};

app.get("/health", (c) => c.json({ ok: true, service: "agents" }));

app.get("/providers", (c) => c.json(listProviders()));

app.post("/analyze", requireServiceKey, async (c) => {
  try {
    const body = analyzeRequestSchema.parse(await c.req.json());
    const result = await runAnalysis(body);
    return c.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    console.error("[agents] Analysis failed:", message);
    if (stack) console.error("[agents] Stack:", stack);
    return c.json({ error: message }, 500);
  }
});

app.post("/team-turn", requireServiceKey, async (c) => {
  try {
    const body = agentTeamRoleTurnInputSchema.parse(await c.req.json());
    const result = await runTeamTurn(body);
    return c.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    console.error("[agents] Team turn failed:", message);
    if (stack) console.error("[agents] Stack:", stack);
    return c.json({ error: message }, 500);
  }
});

const PORT = Number(process.env.PORT ?? process.env.AGENT_SERVICE_PORT ?? 3100);

if (process.env.VITEST !== "true") {
  serve({ fetch: app.fetch, port: PORT, hostname: "::" }, (info) => {
    console.log(`[agents] Agent service running on http://localhost:${info.port}`);
  });
}
