import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  codexSettingsResponseSchema,
  codexWorkflowInputSchema,
  connectGithubInstallationRequestSchema,
  connectGithubInstallationResponseSchema,
  healthResponseSchema,
  preparePrIntentRequestSchema,
  preparePrIntentResponseSchema,
  repositoryIndexWorkflowInputSchema,
  requestRepositorySyncResponseSchema,
  requestRepositorySyncSchema,
  searchCodeRequestSchema,
  searchCodeResponseSchema,
  searchFeedbackRequestSchema,
  searchFeedbackResponseSchema,
  supportWorkflowInputSchema,
  updateRepositorySelectionRequestSchema,
  updateRepositorySelectionResponseSchema,
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
  z.object({
    type: z.literal("repository-index"),
    payload: repositoryIndexWorkflowInputSchema,
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
    "/api/rest/codex/settings": {
      get: {
        responses: {
          "200": {
            description: "Codex integration state",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/CodexSettingsResponse" },
              },
            },
          },
        },
      },
    },
    "/api/rest/codex/connect": {
      post: {
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ConnectGithubInstallationRequest" },
            },
          },
        },
        responses: {
          "200": {
            description: "GitHub integration connected",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ConnectGithubInstallationResponse" },
              },
            },
          },
        },
      },
    },
    "/api/rest/codex/repositories/select": {
      post: {
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/UpdateRepositorySelectionRequest" },
            },
          },
        },
        responses: {
          "200": {
            description: "Repository selection updated",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/UpdateRepositorySelectionResponse" },
              },
            },
          },
        },
      },
    },
    "/api/rest/codex/sync": {
      post: {
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/RequestRepositorySyncRequest" },
            },
          },
        },
        responses: {
          "202": {
            description: "Repository sync accepted",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/RequestRepositorySyncResponse" },
              },
            },
          },
        },
      },
    },
    "/api/rest/codex/search": {
      post: {
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/SearchCodeRequest" },
            },
          },
        },
        responses: {
          "200": {
            description: "Ranked repository evidence",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/SearchCodeResponse" },
              },
            },
          },
        },
      },
    },
    "/api/rest/codex/feedback": {
      post: {
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/SearchFeedbackRequest" },
            },
          },
        },
        responses: {
          "201": {
            description: "Feedback stored",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/SearchFeedbackResponse" },
              },
            },
          },
        },
      },
    },
    "/api/rest/codex/pr-intent": {
      post: {
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/PreparePrIntentRequest" },
            },
          },
        },
        responses: {
          "201": {
            description: "PR intent validated",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/PreparePrIntentResponse" },
              },
            },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      CodexSettingsResponse: z.toJSONSchema(codexSettingsResponseSchema),
      ConnectGithubInstallationRequest: z.toJSONSchema(connectGithubInstallationRequestSchema),
      ConnectGithubInstallationResponse: z.toJSONSchema(connectGithubInstallationResponseSchema),
      HealthResponse: z.toJSONSchema(healthResponseSchema),
      PreparePrIntentRequest: z.toJSONSchema(preparePrIntentRequestSchema),
      PreparePrIntentResponse: z.toJSONSchema(preparePrIntentResponseSchema),
      RepositoryIndexWorkflowInput: z.toJSONSchema(repositoryIndexWorkflowInputSchema),
      RequestRepositorySyncRequest: z.toJSONSchema(requestRepositorySyncSchema),
      RequestRepositorySyncResponse: z.toJSONSchema(requestRepositorySyncResponseSchema),
      SearchCodeRequest: z.toJSONSchema(searchCodeRequestSchema),
      SearchCodeResponse: z.toJSONSchema(searchCodeResponseSchema),
      SearchFeedbackRequest: z.toJSONSchema(searchFeedbackRequestSchema),
      SearchFeedbackResponse: z.toJSONSchema(searchFeedbackResponseSchema),
      SupportWorkflowInput: z.toJSONSchema(supportWorkflowInputSchema),
      UpdateRepositorySelectionRequest: z.toJSONSchema(updateRepositorySelectionRequestSchema),
      UpdateRepositorySelectionResponse: z.toJSONSchema(updateRepositorySelectionResponseSchema),
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
