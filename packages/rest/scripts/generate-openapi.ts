import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  codexWorkflowInputSchema,
  healthResponseSchema,
  supportWorkflowInputSchema,
  workflowDispatchResponseSchema,
} from "@shared/types";
import { z } from "zod";

const workflowDispatchRequestSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("support"),
    payload: supportWorkflowInputSchema,
  }),
  z.object({
    type: z.literal("codex"),
    payload: codexWorkflowInputSchema,
  }),
]);

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const outputPath = resolve(__dirname, "../../../docs/contracts/openapi.json");

const document = {
  openapi: "3.1.0",
  info: {
    title: "TrustLoop API",
    version: "0.1.0",
  },
  paths: {
    "/api/rest/health": {
      get: {
        responses: {
          "200": {
            description: "Health check",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/HealthResponse" },
              },
            },
          },
        },
      },
    },
    "/api/rest/workflows/dispatch": {
      post: {
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/WorkflowDispatchRequest" },
            },
          },
        },
        responses: {
          "202": {
            description: "Workflow accepted",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/WorkflowDispatchResponse" },
              },
            },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      HealthResponse: z.toJSONSchema(healthResponseSchema),
      SupportWorkflowInput: z.toJSONSchema(supportWorkflowInputSchema),
      CodexWorkflowInput: z.toJSONSchema(codexWorkflowInputSchema),
      WorkflowDispatchRequest: z.toJSONSchema(workflowDispatchRequestSchema),
      WorkflowDispatchResponse: z.toJSONSchema(workflowDispatchResponseSchema),
    },
  },
};

const rendered = `${JSON.stringify(document, null, 2)}\n`;
const checkOnly = process.argv.includes("--check");

await mkdir(dirname(outputPath), { recursive: true });

if (checkOnly) {
  const existing = await readFile(outputPath, "utf8").catch(() => "");
  if (existing !== rendered) {
    console.error("OpenAPI artifact is stale. Run: npm run openapi:generate");
    process.exit(1);
  }
} else {
  await writeFile(outputPath, rendered);
  console.log(`OpenAPI generated at ${outputPath}`);
}
