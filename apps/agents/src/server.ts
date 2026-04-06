import { serve } from "@hono/node-server";
import { analyzeRequestSchema } from "@shared/types";
import { Hono } from "hono";

import { runAnalysis } from "./agent";
import { listProviders } from "./providers";

const app = new Hono();

app.get("/health", (c) => c.json({ ok: true, service: "agents" }));

app.get("/providers", (c) => c.json(listProviders()));

app.post("/analyze", async (c) => {
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

const PORT = Number(process.env.AGENT_SERVICE_PORT ?? 3100);

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`[agents] Agent service running on http://localhost:${info.port}`);
});
