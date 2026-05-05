import { createHash } from "node:crypto";

import { prisma } from "@shared/database";
import {
  type AgentTeamArtifact,
  type AgentTeamArtifactContent,
  type AgentTeamArtifactType,
  type AgentTeamEvidenceRef,
  agentTeamArtifactContentSchema,
  agentTeamArtifactSchema,
} from "@shared/types";

export interface WriteArtifactInput {
  workspaceId: string;
  runId: string;
  jobId: string;
  type: AgentTeamArtifactType;
  artifactKey?: string;
  content: AgentTeamArtifactContent;
  contentRef?: string | null;
  evidenceRefs?: AgentTeamEvidenceRef[];
  confidence: number;
}

type ArtifactRow = Awaited<ReturnType<typeof prisma.agentTeamArtifact.findUniqueOrThrow>>;

export async function write(input: WriteArtifactInput): Promise<AgentTeamArtifact> {
  const content = agentTeamArtifactContentSchema.parse(input.content);
  if (content.type !== input.type) {
    throw new ArtifactTypeMismatchError(input.type, content.type);
  }

  const row = await prisma.agentTeamArtifact.upsert({
    where: {
      jobId_type_artifactKey: {
        jobId: input.jobId,
        type: input.type,
        artifactKey: input.artifactKey ?? "default",
      },
    },
    create: {
      workspaceId: input.workspaceId,
      runId: input.runId,
      jobId: input.jobId,
      type: input.type,
      artifactKey: input.artifactKey ?? "default",
      content,
      contentRef: input.contentRef ?? null,
      contentHash: hashContent(content),
      evidenceRefs: input.evidenceRefs ?? [],
      confidence: input.confidence,
    },
    update: {
      content,
      contentRef: input.contentRef ?? null,
      contentHash: hashContent(content),
      evidenceRefs: input.evidenceRefs ?? [],
      confidence: input.confidence,
    },
  });

  return mapArtifact(row);
}

export async function get(artifactId: string): Promise<AgentTeamArtifact> {
  const row = await prisma.agentTeamArtifact.findUniqueOrThrow({ where: { id: artifactId } });
  return mapArtifact(row);
}

export async function listForRun(runId: string): Promise<AgentTeamArtifact[]> {
  const rows = await prisma.agentTeamArtifact.findMany({
    where: { runId },
    orderBy: { createdAt: "asc" },
  });

  return rows.map(mapArtifact);
}

function mapArtifact(row: ArtifactRow): AgentTeamArtifact {
  return agentTeamArtifactSchema.parse({
    ...row,
    createdAt: row.createdAt.toISOString(),
  });
}

function hashContent(content: AgentTeamArtifactContent): string {
  const serialized = JSON.stringify(content);
  return `sha256:${createHash("sha256").update(serialized).digest("hex")}`;
}

export class ArtifactTypeMismatchError extends Error {
  constructor(expected: AgentTeamArtifactType, actual: AgentTeamArtifactType) {
    super(`Artifact type mismatch: expected ${expected}, received ${actual}`);
    this.name = "ArtifactTypeMismatchError";
  }
}
