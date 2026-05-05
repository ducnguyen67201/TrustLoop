import { Tool } from "@mastra/core/tools";
import {
  type ReadIndexedRepositoryFileResult,
  readIndexedRepositoryFile,
} from "@shared/rest/codex/github/content";
import { z } from "zod";

export interface ReadRepositoryFileToolInput {
  repositoryFullName: string;
  filePath: string;
  ref?: string;
}

export type ReadRepositoryFileToolOutput = ReadIndexedRepositoryFileResult;

const readRepositoryFileInputSchema = z.object({
  repositoryFullName: z.string().describe('Indexed repository full name, e.g. "owner/repo"'),
  filePath: z.string().describe("File path relative to the repository root"),
  ref: z.string().optional().describe("Branch/ref to read. Defaults to the repo default branch."),
});

export interface ReadRepositoryFileToolContext {
  workspaceId: string;
}

export function buildReadRepositoryFileTool(ctx: ReadRepositoryFileToolContext) {
  return new Tool<ReadRepositoryFileToolInput, ReadRepositoryFileToolOutput>({
    id: "read_repository_file",
    description:
      "Read the full contents of a file from an indexed GitHub repository. Use this after code search identifies a repository and file path, before creating a pull request that edits that file.",
    inputSchema: readRepositoryFileInputSchema,
    execute: async (input: ReadRepositoryFileToolInput): Promise<ReadRepositoryFileToolOutput> =>
      readIndexedRepositoryFile({
        workspaceId: ctx.workspaceId,
        repositoryFullName: input.repositoryFullName,
        filePath: input.filePath,
        ref: input.ref,
      }),
  });
}
