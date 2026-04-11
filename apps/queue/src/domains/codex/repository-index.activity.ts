import { createHash } from "node:crypto";
import { extname, relative } from "node:path";
import { prisma } from "@shared/database";
import * as codex from "@shared/rest/codex";
import * as embeddings from "@shared/rest/services/codex/embedding";
import {
  type RepositoryIndexWorkflowInput,
  type RepositoryIndexWorkflowResult,
  WORKFLOW_PROCESSING_STATUS,
} from "@shared/types";
import { ApplicationFailure } from "@temporalio/activity";
const SUPPORTED_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".md", ".json"]);
const IGNORED_DIRECTORIES = new Set([".git", ".next", "node_modules", "dist", "coverage"]);
const SYMBOL_PATTERN =
  /^(?:export\s+)?(?:async\s+)?(?:function|class|interface|type|const)\s+([A-Za-z0-9_]+)/;
const IMPORT_PATTERN = /^(?:import\s|export\s+\{|export\s+\*|export\s+type\s+\{)/;
const CONFIG_EXTENSIONS = new Set([".json", ".prisma"]);
const OVERSIZED_THRESHOLD = 100;
const UNDERSIZED_THRESHOLD = 5;
const OVERLAP_LINES = 20;
const WINDOW_SIZE = 60;
const CONFIG_WINDOW_SIZE = 80;

type ChunkRecord = {
  filePath: string;
  language: string;
  symbolName: string | null;
  lineStart: number;
  lineEnd: number;
  contentHash: string;
  content: string;
};

function languageFromFilePath(filePath: string): string {
  return extname(filePath).replace(".", "") || "text";
}

function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function isPathAllowed(filePath: string): boolean {
  if (!SUPPORTED_EXTENSIONS.has(extname(filePath))) return false;
  for (const dir of IGNORED_DIRECTORIES) {
    if (filePath.includes(`/${dir}/`) || filePath.startsWith(`${dir}/`)) return false;
  }
  return true;
}

function buildChunkContent(lines: string[], start: number, end: number): string {
  return lines.slice(start, end).join("\n").trim();
}

export function computeQualityScore(chunk: ChunkRecord): number {
  let score = 0.5;
  const lines = chunk.content.split(/\r?\n/);
  const nonEmptyLines = lines.filter((l) => l.trim().length > 0);
  const importLines = lines.filter((l) => IMPORT_PATTERN.test(l.trim()));

  if (nonEmptyLines.length > 0 && importLines.length / nonEmptyLines.length > 0.8) {
    score -= 0.4;
  }

  const isBarrelFile =
    chunk.filePath.endsWith("index.ts") &&
    nonEmptyLines.length > 0 &&
    nonEmptyLines.every((l) => /^export\s/.test(l.trim()));
  if (isBarrelFile) score -= 0.3;

  if (/\.(test|spec)\.[jt]sx?$/.test(chunk.filePath)) score -= 0.2;
  if (nonEmptyLines.length < 3) score -= 0.3;
  if (chunk.symbolName) score += 0.2;
  if (nonEmptyLines.length >= 10 && nonEmptyLines.length <= 80) score += 0.1;

  const hasComments = lines.some((l) => /^\s*(\/\/|\/\*|\*|#)/.test(l) || /\*\/\s*$/.test(l));
  if (hasComments) score += 0.1;

  const projectImports = importLines.filter(
    (l) => l.includes("@/") || l.includes("@shared/") || l.includes("./") || l.includes("../")
  );
  if (projectImports.length > 0) score += 0.1;

  return Math.max(0, Math.min(1, score));
}

function windowChunks(
  filePath: string,
  sourceRoot: string,
  lines: string[],
  windowSize: number,
  overlap: number,
  baseSymbolName: string | null
): ChunkRecord[] {
  const chunks: ChunkRecord[] = [];
  const step = windowSize - overlap;
  let partIndex = 1;

  for (let start = 0; start < lines.length; start += step) {
    const end = Math.min(start + windowSize, lines.length);
    const chunkContent = buildChunkContent(lines, start, end);
    if (chunkContent.length === 0) continue;

    const suffix = lines.length > windowSize ? `_part${partIndex++}` : "";
    chunks.push({
      filePath: relative(sourceRoot, filePath),
      language: languageFromFilePath(filePath),
      symbolName: baseSymbolName ? `${baseSymbolName}${suffix}` : null,
      lineStart: start + 1,
      lineEnd: end,
      contentHash: hashContent(chunkContent),
      content: chunkContent,
    });

    if (end >= lines.length) break;
  }

  return chunks;
}

function chunkFile(filePath: string, sourceRoot: string, content: string): ChunkRecord[] {
  const lines = content.split(/\r?\n/);

  if (CONFIG_EXTENSIONS.has(extname(filePath))) {
    return windowChunks(filePath, sourceRoot, lines, CONFIG_WINDOW_SIZE, OVERLAP_LINES, null);
  }

  const symbolStarts: Array<{ lineIndex: number; symbolName: string | null }> = [];

  lines.forEach((line, index) => {
    const match = line.match(SYMBOL_PATTERN);
    if (match) {
      symbolStarts.push({
        lineIndex: index,
        symbolName: match[1] ?? null,
      });
    }
  });

  if (symbolStarts.length === 0) {
    return windowChunks(filePath, sourceRoot, lines, 40, 0, null);
  }

  const rawChunks: ChunkRecord[] = [];

  for (let i = 0; i < symbolStarts.length; i++) {
    const symbol = symbolStarts[i]!;
    const nextStart = symbolStarts[i + 1]?.lineIndex ?? lines.length;
    const chunkLines = lines.slice(symbol.lineIndex, nextStart);
    const chunkContent = chunkLines.join("\n").trim();

    if (chunkContent.length === 0) continue;

    const lineCount = nextStart - symbol.lineIndex;

    if (lineCount > OVERSIZED_THRESHOLD) {
      rawChunks.push(
        ...windowChunks(
          filePath,
          sourceRoot,
          chunkLines,
          WINDOW_SIZE,
          OVERLAP_LINES,
          symbol.symbolName
        ).map((c) => ({
          ...c,
          lineStart: c.lineStart + symbol.lineIndex,
          lineEnd: Math.min(c.lineEnd + symbol.lineIndex, nextStart),
        }))
      );
      continue;
    }

    rawChunks.push({
      filePath: relative(sourceRoot, filePath),
      language: languageFromFilePath(filePath),
      symbolName: symbol.symbolName,
      lineStart: symbol.lineIndex + 1,
      lineEnd: nextStart,
      contentHash: hashContent(chunkContent),
      content: chunkContent,
    });
  }

  const merged: ChunkRecord[] = [];
  for (let i = 0; i < rawChunks.length; i++) {
    const chunk = rawChunks[i]!;
    const lineCount = chunk.lineEnd - chunk.lineStart + 1;

    if (lineCount < UNDERSIZED_THRESHOLD && i + 1 < rawChunks.length) {
      const next = rawChunks[i + 1]!;
      const combinedContent = `${chunk.content}\n${next.content}`.trim();
      merged.push({
        ...chunk,
        lineEnd: next.lineEnd,
        content: combinedContent,
        contentHash: hashContent(combinedContent),
        symbolName: chunk.symbolName ?? next.symbolName,
      });
      i++;
      continue;
    }

    merged.push(chunk);
  }

  return merged;
}

/**
 * Read the selected repository via GitHub API, build a new snapshot version, and atomically flip it active.
 */
export async function runRepositoryIndexPipeline(
  input: RepositoryIndexWorkflowInput
): Promise<RepositoryIndexWorkflowResult> {
  const syncRequest = await prisma.repositorySyncRequest.findUnique({
    where: { id: input.syncRequestId },
    include: {
      repository: true,
    },
  });

  if (!syncRequest) {
    throw new Error(`Sync request ${input.syncRequestId} was not found.`);
  }

  const installation = await prisma.gitHubInstallation.findUnique({
    where: { workspaceId: input.workspaceId },
  });

  if (!installation?.githubInstallationId) {
    await prisma.repositorySyncRequest.update({
      where: { id: syncRequest.id },
      data: {
        status: "failed",
        completedAt: new Date(),
        errorMessage: `No GitHub installation found for workspace ${input.workspaceId}.`,
      },
    });
    throw ApplicationFailure.nonRetryable(
      `No GitHub installation found for workspace ${input.workspaceId}. Cannot index.`,
      "ValidationError"
    );
  }

  const { owner, name, defaultBranch } = syncRequest.repository;
  const installationId = installation.githubInstallationId;

  await prisma.repositorySyncRequest.update({
    where: { id: syncRequest.id },
    data: {
      status: "running",
      startedAt: new Date(),
    },
  });

  const indexVersion = await prisma.repositoryIndexVersion.upsert({
    where: { syncRequestId: syncRequest.id },
    update: { status: "building" },
    create: {
      workspaceId: input.workspaceId,
      repositoryId: input.repositoryId,
      syncRequestId: syncRequest.id,
      status: "building",
    },
  });

  try {
    const tree = await codex.fetchRepoTree(installationId, owner, name, defaultBranch);
    const allowedPaths = tree.filter((entry) => isPathAllowed(entry.path)).map((e) => e.path);

    const fileContents = await codex.fetchFileContents(
      installationId,
      owner,
      name,
      defaultBranch,
      allowedPaths
    );

    const chunks = fileContents.flatMap((file) => chunkFile(file.path, "", file.content));
    const commitSha = await codex.fetchLatestCommitSha(installationId, owner, name, defaultBranch);
    const completedAt = new Date();

    if (chunks.length > 0) {
      const scoredChunks = chunks.map((chunk) => ({
        ...chunk,
        qualityScore: computeQualityScore(chunk),
      }));

      const hashes = scoredChunks.map((c) => c.contentHash);
      const embeddingCache = await embeddings.getCached(hashes);

      const BATCH_SIZE = 100;
      for (let i = 0; i < scoredChunks.length; i += BATCH_SIZE) {
        const batch = scoredChunks.slice(i, i + BATCH_SIZE);

        const uncachedIndexes: number[] = [];
        const chunkEmbeddings: (number[] | null)[] = batch.map((chunk, idx) => {
          const cached = embeddingCache.get(chunk.contentHash);
          if (cached) return cached;
          uncachedIndexes.push(idx);
          return null;
        });

        if (uncachedIndexes.length > 0) {
          const textsToEmbed = uncachedIndexes.map((idx) => batch[idx]!.content);
          const newEmbeddings = await embeddings.generate(textsToEmbed);
          uncachedIndexes.forEach((batchIdx, resultIdx) => {
            chunkEmbeddings[batchIdx] = newEmbeddings[resultIdx]!;
          });
        }

        const params: unknown[] = [];
        const rows = batch.map((chunk, idx) => {
          const embedding = chunkEmbeddings[idx];
          const preprocessed = embeddings.splitIdentifiers(chunk.content);
          const o = params.length;
          params.push(
            indexVersion.id,
            chunk.filePath,
            chunk.language,
            chunk.symbolName,
            chunk.lineStart,
            chunk.lineEnd,
            chunk.contentHash,
            chunk.content,
            embedding ? embeddings.formatVector(embedding) : null,
            preprocessed,
            chunk.qualityScore,
            embedding ? embeddings.MODEL : null
          );
          return `(
            gen_random_uuid(),
            $${o + 1}, $${o + 2}, $${o + 3}, $${o + 4}, $${o + 5}, $${o + 6},
            $${o + 7}, $${o + 8}, $${o + 9}::vector, to_tsvector('english', $${o + 10}),
            $${o + 11}, $${o + 12}, NOW()
          )`;
        });

        await prisma.$executeRawUnsafe(
          `INSERT INTO "RepositoryIndexChunk" (
            "id", "indexVersionId", "filePath", "language", "symbolName",
            "lineStart", "lineEnd", "contentHash", "content",
            "embedding", "tsv", "qualityScore", "embeddingModel", "createdAt"
          ) VALUES ${rows.join(",")}`,
          ...params
        );
      }
    }

    await prisma.$transaction([
      prisma.repositoryIndexVersion.updateMany({
        where: {
          repositoryId: input.repositoryId,
          active: true,
          NOT: {
            id: indexVersion.id,
          },
        },
        data: {
          active: false,
        },
      }),
      prisma.repositoryIndexVersion.update({
        where: { id: indexVersion.id },
        data: {
          status: "active",
          active: true,
          commitSha,
          completedAt,
          activatedAt: completedAt,
          fileCount: fileContents.length,
          chunkCount: chunks.length,
        },
      }),
      prisma.repositorySyncRequest.update({
        where: { id: syncRequest.id },
        data: {
          status: "completed",
          completedAt,
          errorMessage: null,
        },
      }),
    ]);

    return {
      syncRequestId: syncRequest.id,
      repositoryId: input.repositoryId,
      status: WORKFLOW_PROCESSING_STATUS.processed,
      queuedAt: syncRequest.requestedAt.toISOString(),
    };
  } catch (error) {
    const completedAt = new Date();
    const message = error instanceof Error ? error.message : "Repository indexing failed.";

    await prisma.$transaction([
      prisma.repositoryIndexVersion.update({
        where: { id: indexVersion.id },
        data: {
          status: "failed",
          completedAt,
          errorMessage: message,
        },
      }),
      prisma.repositorySyncRequest.update({
        where: { id: syncRequest.id },
        data: {
          status: "failed",
          completedAt,
          errorMessage: message,
        },
      }),
    ]);

    throw error;
  }
}

/**
 * Mark a sync request as failed when the workflow itself fails (e.g. activity retries exhausted).
 * Called from the workflow catch block to prevent sync requests stuck in "running".
 */
export async function markSyncRequestFailed(input: {
  syncRequestId: string;
  errorMessage: string;
}): Promise<void> {
  await prisma.repositorySyncRequest.updateMany({
    where: {
      id: input.syncRequestId,
      status: { in: ["pending", "running"] },
    },
    data: {
      status: "failed",
      completedAt: new Date(),
      errorMessage: input.errorMessage,
    },
  });
}
