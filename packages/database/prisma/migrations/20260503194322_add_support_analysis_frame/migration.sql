-- Rendered visual keyframes from rrweb session replay shown to the support
-- agent at analysis time. One row per frame. Persisted so the human reviewer
-- can see exactly what the agent saw.
CREATE TABLE "SupportAnalysisFrame" (
  "id"           TEXT NOT NULL,
  "analysisId"   TEXT NOT NULL,
  "timestamp"    TIMESTAMP(3) NOT NULL,
  "offsetMs"     INTEGER NOT NULL,
  "base64Png"    TEXT NOT NULL,
  "captionHint"  TEXT NOT NULL,
  "captionText"  TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "SupportAnalysisFrame_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SupportAnalysisFrame_analysisId_offsetMs_idx"
  ON "SupportAnalysisFrame"("analysisId", "offsetMs");

ALTER TABLE "SupportAnalysisFrame"
  ADD CONSTRAINT "SupportAnalysisFrame_analysisId_fkey"
  FOREIGN KEY ("analysisId") REFERENCES "SupportAnalysis"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
