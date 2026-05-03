import { env } from "@shared/env";
import * as analysisFrames from "@shared/rest/services/support/analysis-frames-service";
import type { FailureFrame, FailureFrameCaption } from "@shared/types";

export interface CaptionFailureFramesInput {
  analysisId: string;
  frames: FailureFrame[];
}

export interface CaptionFailureFramesResult {
  captions: FailureFrameCaption[];
}

const CAPTIONER_MODEL = "gpt-4o-mini";
const CAPTIONER_MAX_TOKENS = 200;
const CAPTION_PROMPT = `You are describing one screenshot of a customer's screen at the moment of a software failure.
Describe what is visible in the image in 2-3 sentences. Focus on UI elements that suggest the failure cause:
- Visible text in error messages, toasts, banners
- Button states (greyed out, disabled, missing)
- Form completion state (filled, empty, validation errors)
- Modals, dialogs, overlays
- Anything obscuring the primary action (cookie banner, popup)
Be specific. Do not invent details. If the screen is blank or unloadable, say so.`;

/**
 * Caption rendered frames using a fixed shared vision model. Used when the
 * workspace's analyzing model is text-only and cannot consume image input
 * directly. The captions are written to the persisted `SupportAnalysisFrame`
 * rows so the human reviewer can later see both the image and the caption.
 *
 * Fail-soft: any per-frame error becomes an empty caption, never throws.
 * Returns only successfully-captioned frames so the workflow can proceed
 * with whatever it got.
 */
export async function captionFailureFramesActivity(
  input: CaptionFailureFramesInput
): Promise<CaptionFailureFramesResult> {
  if (input.frames.length === 0) return { captions: [] };
  if (!env.OPENAI_API_KEY) {
    console.warn("[frames] OPENAI_API_KEY missing — skipping captioner");
    return { captions: [] };
  }

  const captions: FailureFrameCaption[] = [];
  for (const frame of input.frames) {
    try {
      const captionText = await captionOneFrame(frame.base64Png);
      if (captionText) {
        captions.push({
          timestamp: frame.timestamp,
          offsetMs: frame.offsetMs,
          captionHint: frame.captionHint,
          captionText,
        });
      }
    } catch (error) {
      console.warn("[frames] caption failed for one frame, continuing:", error);
    }
  }

  if (captions.length > 0) {
    await analysisFrames.attachCaptions(input.analysisId, captions);
  }

  return { captions };
}

async function captionOneFrame(base64Png: string): Promise<string | null> {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: CAPTIONER_MODEL,
      max_tokens: CAPTIONER_MAX_TOKENS,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: CAPTION_PROMPT },
            { type: "image_url", image_url: { url: `data:image/png;base64,${base64Png}` } },
          ],
        },
      ],
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    throw new Error(`captioner HTTP ${response.status}`);
  }

  const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const text = data.choices?.[0]?.message?.content?.trim();
  return text || null;
}
