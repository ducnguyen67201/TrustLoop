import type * as analysisActivities from "@/domains/support/support-analysis.activity";
import type * as captionerActivityTypes from "@/domains/support/support-frames-caption.activity";
import type * as renderActivityTypes from "@/domains/support/support-frames.activity";
import type {
  FailureFrame,
  FailureFrameCaption,
  SupportAnalysisWorkflowInput,
  SupportAnalysisWorkflowResult,
} from "@shared/types";
import { isVisionCapable } from "@shared/types";
import { proxyActivities } from "@temporalio/workflow";

const fastActivities = proxyActivities<typeof analysisActivities>({
  startToCloseTimeout: "30 seconds",
  retry: { maximumAttempts: 2 },
});

// Frame rendering owns Playwright cold-start (~1-3s) plus N screenshots.
// Single attempt: rendering is opportunistic and the workflow continues
// without frames if it fails, so retry cost is wasted time.
const renderActivities = proxyActivities<typeof renderActivityTypes>({
  startToCloseTimeout: "60 seconds",
  retry: { maximumAttempts: 1 },
});

// Captioning fans out one HTTP call per frame to the captioner LLM.
// Bounded by FAILURE_FRAMES_MAX (7), generous timeout for slow upstreams.
const captionerActivities = proxyActivities<typeof captionerActivityTypes>({
  startToCloseTimeout: "120 seconds",
  retry: { maximumAttempts: 1 },
});

const agentActivities = proxyActivities<typeof analysisActivities>({
  startToCloseTimeout: "5 minutes",
  heartbeatTimeout: "45 seconds",
  retry: { maximumAttempts: 2 },
});

// Default analyzing model used today (no per-workspace model picker yet).
// When the picker UI ships, replace these with values read from
// WorkspaceAiSettings via a small helper activity.
const DEFAULT_PROVIDER = "openai";
const DEFAULT_MODEL = "gpt-4o";

export async function supportAnalysisWorkflow(
  input: SupportAnalysisWorkflowInput
): Promise<SupportAnalysisWorkflowResult> {
  // 1. Build thread snapshot → GATHERING_CONTEXT
  const snapshot = await fastActivities.buildThreadSnapshot({
    workspaceId: input.workspaceId,
    conversationId: input.conversationId,
    triggerType: input.triggerType ?? "MANUAL",
  });

  // 2. (Optional) Render visual evidence from rrweb around the failure point.
  //    Skipped when no correlated session or no failurePoint exists. Failures
  //    are non-fatal — workflow continues with text digest only.
  let failureFrames: FailureFrame[] = [];
  if (snapshot.sessionRecordId && snapshot.failurePointTimestamp) {
    const renderResult = await renderActivities.renderFailureFramesActivity({
      workspaceId: input.workspaceId,
      analysisId: snapshot.analysisId,
      sessionRecordId: snapshot.sessionRecordId,
      failurePointTimestamp: snapshot.failurePointTimestamp,
      precedingActionsCount: snapshot.precedingActionsCount,
    });
    failureFrames = renderResult.frames;
  }

  // 3. (Optional) Caption frames for text-only workspace models. Skipped when
  //    the analyzing model can consume images directly. The captioner uses a
  //    fixed shared vision model regardless of workspace choice.
  let failureFrameCaptions: FailureFrameCaption[] = [];
  if (failureFrames.length > 0 && !isVisionCapable(DEFAULT_PROVIDER, DEFAULT_MODEL)) {
    const captionResult = await captionerActivities.captionFailureFramesActivity({
      analysisId: snapshot.analysisId,
      frames: failureFrames,
    });
    failureFrameCaptions = captionResult.captions;
  }

  // 4. Transition → ANALYZING
  await fastActivities.markAnalyzing(snapshot.analysisId);

  // 5. Run agent loop. Pass either frames OR captions (never both); agent.ts
  //    builds the multimodal vs text-only message accordingly.
  const result = await agentActivities.runAnalysisAgent({
    workspaceId: input.workspaceId,
    conversationId: input.conversationId,
    analysisId: snapshot.analysisId,
    threadSnapshot: snapshot.threadSnapshot,
    sessionDigest: snapshot.sessionDigest,
    failureFrames: failureFrameCaptions.length > 0 ? undefined : failureFrames,
    failureFrameCaptions: failureFrameCaptions.length > 0 ? failureFrameCaptions : undefined,
  });

  return result;
}
