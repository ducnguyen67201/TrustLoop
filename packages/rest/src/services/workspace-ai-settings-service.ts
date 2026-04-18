import { prisma } from "@shared/database";
import { type ToneConfig, toneConfigSchema } from "@shared/types";

// ---------------------------------------------------------------------------
// workspaceAiSettings service
//
// Domain-focused service module for the per-workspace AI tone configuration
// used by the support-analysis agent. Import this file as a namespace so
// call sites read as `aiSettings.getToneConfig(id)` rather than
// `getWorkspaceAiToneConfig(id)`:
//
//   import * as aiSettings from "@shared/rest/services/workspace-ai-settings-service";
//   const tone = await aiSettings.getToneConfig(workspaceId);
//   const updated = await aiSettings.updateToneConfig(workspaceId, input);
//
// The Zod default-fill in `toneConfigSchema` means `getToneConfig` always
// returns a fully-populated `ToneConfig`, even when no row exists yet.
//
// See docs/conventions/service-layer-conventions.md.
// ---------------------------------------------------------------------------

type AiSettingsRow = {
  defaultTone: string;
  responseStyle: string | null;
  signatureLine: string | null;
  maxDraftLength: number;
  includeCodeRefs: boolean;
};

function toToneConfig(row: AiSettingsRow): ToneConfig {
  return toneConfigSchema.parse({
    defaultTone: row.defaultTone,
    responseStyle: row.responseStyle,
    signatureLine: row.signatureLine,
    maxDraftLength: row.maxDraftLength,
    includeCodeRefs: row.includeCodeRefs,
  });
}

export async function getToneConfig(workspaceId: string): Promise<ToneConfig> {
  const row = await prisma.workspaceAiSettings.findUnique({
    where: { workspaceId },
  });
  return row ? toToneConfig(row) : toneConfigSchema.parse({});
}

export async function updateToneConfig(
  workspaceId: string,
  input: ToneConfig
): Promise<ToneConfig> {
  const row = await prisma.workspaceAiSettings.upsert({
    where: { workspaceId },
    update: input,
    create: { workspaceId, ...input },
  });
  return toToneConfig(row);
}
