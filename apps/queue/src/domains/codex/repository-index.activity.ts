import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import { promisify } from "node:util";
import { prisma } from "@shared/database";
import {
  type RepositoryIndexWorkflowInput,
  type RepositoryIndexWorkflowResult,
  WORKFLOW_PROCESSING_STATUS,
} from "@shared/types";

const execFileAsync = promisify(execFile);
const SUPPORTED_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".md", ".json"]);
const IGNORED_DIRECTORIES = new Set([".git", ".next", "node_modules", "dist", "coverage"]);
const SYMBOL_PATTERN =
  /^(?:export\s+)?(?:async\s+)?(?:function|class|interface|type|const)\s+([A-Za-z0-9_]+)/;

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

async function gitCommitSha(sourceRoot: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", [
      "-C",
      sourceRoot,
      "rev-parse",
      "--short",
      "HEAD",
    ]);
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

async function collectFiles(root: string, current = root): Promise<string[]> {
  const entries = await readdir(current, { withFileTypes: true });
  const collected: string[] = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!IGNORED_DIRECTORIES.has(entry.name)) {
        collected.push(...(await collectFiles(root, join(current, entry.name))));
      }

      continue;
    }

    const absolutePath = join(current, entry.name);
    if (SUPPORTED_EXTENSIONS.has(extname(absolutePath))) {
      collected.push(absolutePath);
    }
  }

  return collected;
}

function buildChunkContent(lines: string[], start: number, end: number): string {
  return lines.slice(start, end).join("\n").trim();
}

function chunkFile(filePath: string, sourceRoot: string, content: string): ChunkRecord[] {
  const lines = content.split(/\r?\n/);
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
    const fixedChunks: ChunkRecord[] = [];

    for (let start = 0; start < lines.length; start += 40) {
      const end = Math.min(start + 40, lines.length);
      const chunkContent = buildChunkContent(lines, start, end);
      if (chunkContent.length === 0) {
        continue;
      }

      fixedChunks.push({
        filePath: relative(sourceRoot, filePath),
        language: languageFromFilePath(filePath),
        symbolName: null,
        lineStart: start + 1,
        lineEnd: end,
        contentHash: hashContent(chunkContent),
        content: chunkContent,
      });
    }

    return fixedChunks;
  }

  return symbolStarts.flatMap((symbol, index) => {
    const nextStart = symbolStarts[index + 1]?.lineIndex ?? lines.length;
    const chunkContent = buildChunkContent(lines, symbol.lineIndex, nextStart);

    if (chunkContent.length === 0) {
      return [];
    }

    return [
      {
        filePath: relative(sourceRoot, filePath),
        language: languageFromFilePath(filePath),
        symbolName: symbol.symbolName,
        lineStart: symbol.lineIndex + 1,
        lineEnd: nextStart,
        contentHash: hashContent(chunkContent),
        content: chunkContent,
      },
    ];
  });
}

/**
 * Read the selected repository, build a new snapshot version, and atomically flip it active.
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

  await prisma.repositorySyncRequest.update({
    where: { id: syncRequest.id },
    data: {
      status: "running",
      startedAt: new Date(),
    },
  });

  const indexVersion = await prisma.repositoryIndexVersion.create({
    data: {
      workspaceId: input.workspaceId,
      repositoryId: input.repositoryId,
      syncRequestId: syncRequest.id,
      status: "building",
    },
  });

  try {
    const files = await collectFiles(syncRequest.repository.sourceRoot);
    const chunks = (
      await Promise.all(
        files.map(async (filePath) => {
          const content = await readFile(filePath, "utf8");
          return chunkFile(filePath, syncRequest.repository.sourceRoot, content);
        })
      )
    ).flat();
    const commitSha = await gitCommitSha(syncRequest.repository.sourceRoot);
    const completedAt = new Date();

    if (chunks.length > 0) {
      await prisma.repositoryIndexChunk.createMany({
        data: chunks.map((chunk) => ({
          indexVersionId: indexVersion.id,
          filePath: chunk.filePath,
          language: chunk.language,
          symbolName: chunk.symbolName,
          lineStart: chunk.lineStart,
          lineEnd: chunk.lineEnd,
          contentHash: chunk.contentHash,
          content: chunk.content,
        })),
      });
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
          fileCount: files.length,
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
