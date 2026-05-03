import { prisma } from "@shared/database";
import type { FailureFrame, FailureFrameCaption } from "@shared/types";

// ---------------------------------------------------------------------------
// analysis frames service
//
// Persistence for rendered keyframes shown to the support agent at analysis
// time. Frames live one row per `(analysisId, offsetMs)` so the human reviewer
// can later see exactly what the agent saw.
//
// Imported as a namespace:
//   import * as analysisFrames from "@shared/rest/services/support/analysis-frames-service";
//   await analysisFrames.persist(analysisId, frames);
//   const rows = await analysisFrames.findByAnalysisId(analysisId);
//
// Captions written by the captioner pipeline land via `attachCaptions` after
// the initial persist, so the row's createdAt reflects when the frame was
// rendered, not when it was captioned.
// ---------------------------------------------------------------------------

interface PersistedFrame extends FailureFrame {
  id: string;
  captionText: string | null;
}

export async function persist(analysisId: string, frames: FailureFrame[]): Promise<void> {
  if (frames.length === 0) return;

  await prisma.supportAnalysisFrame.createMany({
    data: frames.map((frame) => ({
      analysisId,
      timestamp: new Date(frame.timestamp),
      offsetMs: frame.offsetMs,
      base64Png: frame.base64Png,
      captionHint: frame.captionHint,
    })),
  });
}

export async function attachCaptions(
  analysisId: string,
  captions: FailureFrameCaption[]
): Promise<void> {
  if (captions.length === 0) return;

  // Captions arrive after frames are persisted. Match by offsetMs (stable per
  // analysisId) since we don't carry the row id through the captioner pipeline.
  await prisma.$transaction(
    captions.map((caption) =>
      prisma.supportAnalysisFrame.updateMany({
        where: { analysisId, offsetMs: caption.offsetMs },
        data: { captionText: caption.captionText },
      })
    )
  );
}

export async function findByAnalysisId(analysisId: string): Promise<PersistedFrame[]> {
  const rows = await prisma.supportAnalysisFrame.findMany({
    where: { analysisId },
    orderBy: { offsetMs: "asc" },
  });
  return rows.map((row) => ({
    id: row.id,
    timestamp: row.timestamp.toISOString(),
    offsetMs: row.offsetMs,
    base64Png: row.base64Png,
    captionHint: row.captionHint,
    captionText: row.captionText,
  }));
}
