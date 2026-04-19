import { prisma } from "@shared/database";
import { env } from "@shared/env";
import { MODEL_CONFIG } from "@shared/types";
import OpenAI from "openai";

// ---------------------------------------------------------------------------
// embeddings service
//
// Domain-focused service for OpenAI embedding generation and pgvector
// encode/decode. Import as a namespace (plural — matches the pgvector
// collection mental model and avoids shadowing the ubiquitous `embedding`
// loop variable):
//
//   import * as embeddings from "@shared/rest/services/codex/embedding";
//   const vectors = await embeddings.generate(texts);
//   const cache = await embeddings.getCached(hashes);
//
// See docs/conventions/service-layer-conventions.md.
// ---------------------------------------------------------------------------

export const MODEL = MODEL_CONFIG.embedding;
export const DIMENSIONS = MODEL_CONFIG.embeddingDimensions;
const MAX_BATCH_SIZE = 100;

let openaiClient: OpenAI | null = null;

function getOpenAIClient(): OpenAI {
  if (!openaiClient) {
    if (!env.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY is not configured.");
    }
    openaiClient = new OpenAI({ apiKey: env.OPENAI_API_KEY });
  }
  return openaiClient;
}

export async function generate(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  const client = getOpenAIClient();
  const results: number[][] = [];

  for (let i = 0; i < texts.length; i += MAX_BATCH_SIZE) {
    const batch = texts.slice(i, i + MAX_BATCH_SIZE);
    const response = await client.embeddings.create({
      model: MODEL,
      input: batch,
      dimensions: DIMENSIONS,
    });

    for (const item of response.data) {
      results.push(item.embedding);
    }
  }

  return results;
}

export async function getCached(contentHashes: string[]): Promise<Map<string, number[]>> {
  if (contentHashes.length === 0) return new Map();

  const placeholders = contentHashes.map((_, i) => `$${i + 1}`).join(", ");
  const rows = await prisma.$queryRawUnsafe<Array<{ contentHash: string; embedding: string }>>(
    `SELECT DISTINCT ON ("contentHash") "contentHash", "embedding"::text
     FROM "RepositoryIndexChunk"
     WHERE "contentHash" IN (${placeholders})
       AND "embedding" IS NOT NULL`,
    ...contentHashes
  );

  const cache = new Map<string, number[]>();
  for (const row of rows) {
    cache.set(row.contentHash, parseVector(row.embedding));
  }
  return cache;
}

export function splitIdentifiers(text: string): string {
  return text
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/[_-]+/g, " ");
}

export function parseVector(pgVector: string): number[] {
  return pgVector
    .replace(/^\[|\]$/g, "")
    .split(",")
    .map(Number);
}

export function formatVector(vector: number[]): string {
  return `[${vector.join(",")}]`;
}
