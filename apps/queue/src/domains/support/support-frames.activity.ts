import { prisma } from "@shared/database";
import * as analysisFrames from "@shared/rest/services/support/analysis-frames-service";
import { computeFrameTimestamps } from "@shared/rest/services/support/session-correlation/frame-timestamps";
import type { FailureFrame } from "@shared/types";

export interface RenderFailureFramesInput {
  workspaceId: string;
  analysisId: string;
  sessionRecordId: string;
  failurePointTimestamp: string; // ISO
  precedingActionsCount: number;
}

export interface RenderFailureFramesResult {
  frames: FailureFrame[];
}

const VIEWPORT_WIDTH = 1024;
const VIEWPORT_HEIGHT = 768;
const SCREENSHOT_TYPE = "png" as const;

/**
 * Render N PNG keyframes around the failure point of a captured rrweb session.
 *
 * Pipeline:
 *   1. Load all SessionReplayChunk rows for the session, decode the JSON event
 *      payloads (chunks are stored as utf-8 JSON strings in `compressedData`,
 *      see `apps/web/src/server/http/rest/sessions/ingest.ts` for the writer).
 *   2. Compute target timestamps via `computeFrameTimestamps` — adaptive 3-7
 *      based on `precedingActionsCount`, clamped to the recorded window.
 *   3. Spawn headless Chromium via Playwright. Mount rrweb-player on a tiny
 *      inline HTML page, feed the events, seek to each timestamp, screenshot.
 *   4. Persist all rendered frames to `SupportAnalysisFrame` so the human
 *      reviewer can later see exactly what the agent saw.
 *   5. Return the frames for the workflow to attach to the agent request.
 *
 * Fail-soft at every step: if chunks are missing, decoding throws, Playwright
 * fails to launch, or the render times out, return `{ frames: [] }`. The
 * workflow continues with the text digest as today.
 *
 * Playwright + rrweb-player are dynamic-imported so the worker can boot even
 * when those deps are not yet installed in a given environment (CI/dev).
 */
export async function renderFailureFramesActivity(
  input: RenderFailureFramesInput
): Promise<RenderFailureFramesResult> {
  try {
    const failurePointMs = new Date(input.failurePointTimestamp).getTime();
    if (Number.isNaN(failurePointMs)) return { frames: [] };

    const chunks = await loadOrderedChunks(input.sessionRecordId);
    const firstChunk = chunks[0];
    const lastChunk = chunks[chunks.length - 1];
    if (!firstChunk || !lastChunk) return { frames: [] };

    const events = decodeEvents(chunks);
    if (events.length === 0) return { frames: [] };

    const recordStartMs = firstChunk.startTimestamp.getTime();
    const recordEndMs = lastChunk.endTimestamp.getTime();

    const timestamps = computeFrameTimestamps({
      failurePointMs,
      precedingActionsCount: input.precedingActionsCount,
      recordStartMs,
      recordEndMs,
    });
    if (timestamps.length === 0) return { frames: [] };

    const frames = await renderFramesViaPlaywright(events, timestamps, failurePointMs);
    if (frames.length === 0) return { frames: [] };

    await analysisFrames.persist(input.analysisId, frames);
    return { frames };
  } catch (error) {
    console.warn("[frames] renderFailureFramesActivity failed, continuing without frames:", error);
    return { frames: [] };
  }
}

// ── Internals ────────────────────────────────────────────────────────

async function loadOrderedChunks(sessionRecordId: string) {
  return prisma.sessionReplayChunk.findMany({
    where: { sessionRecordId },
    orderBy: { sequenceNumber: "asc" },
    select: {
      compressedData: true,
      startTimestamp: true,
      endTimestamp: true,
    },
  });
}

interface RrwebEvent {
  timestamp: number;
  type: number;
  data: unknown;
}

function decodeEvents(chunks: Array<{ compressedData: Uint8Array | Buffer }>): RrwebEvent[] {
  const all: RrwebEvent[] = [];
  for (const chunk of chunks) {
    const json = Buffer.from(chunk.compressedData).toString("utf-8");
    const parsed = JSON.parse(json) as unknown;
    if (Array.isArray(parsed)) {
      for (const evt of parsed) {
        if (isRrwebEvent(evt)) all.push(evt);
      }
    }
  }
  return all.sort((a, b) => a.timestamp - b.timestamp);
}

function isRrwebEvent(value: unknown): value is RrwebEvent {
  if (typeof value !== "object" || value === null) return false;
  const v = value as { timestamp?: unknown; type?: unknown };
  return typeof v.timestamp === "number" && typeof v.type === "number";
}

interface PlaywrightLike {
  chromium: {
    launch(opts: { headless: true }): Promise<{
      newContext(opts: { viewport: { width: number; height: number } }): Promise<{
        newPage(): Promise<{
          goto(url: string): Promise<unknown>;
          setContent(html: string, opts?: { waitUntil?: string }): Promise<void>;
          evaluate<T>(fn: (arg: unknown) => T, arg: unknown): Promise<T>;
          waitForFunction(fn: () => boolean, opts?: { timeout?: number }): Promise<void>;
          screenshot(opts: { type: typeof SCREENSHOT_TYPE }): Promise<Uint8Array>;
        }>;
        close(): Promise<void>;
      }>;
      close(): Promise<void>;
    }>;
  };
}

async function renderFramesViaPlaywright(
  events: RrwebEvent[],
  timestamps: number[],
  failurePointMs: number
): Promise<FailureFrame[]> {
  // Dynamic import so the worker can boot in environments where playwright is
  // not installed (CI minimal, dev). Type assertion at the boundary because we
  // only model the surface we use.
  let playwright: PlaywrightLike;
  try {
    playwright = (await import("playwright")) as unknown as PlaywrightLike;
  } catch (importError) {
    console.warn("[frames] playwright not installed, skipping render:", importError);
    return [];
  }

  const browser = await playwright.chromium.launch({ headless: true });
  const frames: FailureFrame[] = [];

  try {
    const context = await browser.newContext({
      viewport: { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT },
    });
    const page = await context.newPage();

    // Self-contained HTML loads rrweb-player from a CDN, exposes a global
    // `__renderAt(ms)` function that seeks the player and resolves once the
    // frame is settled. CDN keeps the queue Docker image lean (no rrweb-player
    // npm dep needed in apps/queue).
    await page.setContent(buildPlayerHtml(events), { waitUntil: "networkidle" });
    await page.waitForFunction(
      () =>
        typeof (globalThis as unknown as { __playerReady?: boolean }).__playerReady === "boolean" &&
        (globalThis as unknown as { __playerReady: boolean }).__playerReady,
      { timeout: 10_000 }
    );

    const firstEvent = events[0];
    if (!firstEvent) return [];
    for (const ts of timestamps) {
      const offsetFromStart = Math.max(0, ts - firstEvent.timestamp);
      await page.evaluate((ms: unknown) => {
        const fn = (globalThis as unknown as { __renderAt?: (ms: number) => Promise<void> })
          .__renderAt;
        if (fn) return fn(ms as number);
      }, offsetFromStart);

      const buffer = await page.screenshot({ type: SCREENSHOT_TYPE });
      frames.push({
        timestamp: new Date(ts).toISOString(),
        offsetMs: ts - failurePointMs,
        base64Png: Buffer.from(buffer).toString("base64"),
        captionHint: buildCaptionHint(events, ts, failurePointMs),
      });
    }

    await context.close();
  } finally {
    await browser.close();
  }

  return frames;
}

function buildPlayerHtml(events: RrwebEvent[]): string {
  // Embed events directly into the page via JSON.stringify. Using a script tag
  // with type=application/json + parse-on-load avoids HTML-escape issues with
  // the events JSON (which contains arbitrary strings, attributes, etc).
  const eventsJson = JSON.stringify(events);
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/rrweb-player@1.0.0-alpha.4/dist/style.css">
  <script src="https://cdn.jsdelivr.net/npm/rrweb-player@1.0.0-alpha.4/dist/index.js"></script>
  <style>
    body { margin: 0; padding: 0; }
    #player { width: ${VIEWPORT_WIDTH}px; height: ${VIEWPORT_HEIGHT}px; }
    #player .rr-controller { display: none !important; }
  </style>
</head>
<body>
  <div id="player"></div>
  <script id="events" type="application/json">${eventsJson.replace(/</g, "\\u003c")}</script>
  <script>
    (async () => {
      const events = JSON.parse(document.getElementById("events").textContent);
      const Player = window.rrwebPlayer;
      const player = new Player({
        target: document.getElementById("player"),
        props: { events, width: ${VIEWPORT_WIDTH}, height: ${VIEWPORT_HEIGHT}, autoPlay: false, showController: false },
      });
      window.__renderAt = async (ms) => {
        player.goto(ms, true);
        await new Promise((r) => setTimeout(r, 150));
      };
      window.__playerReady = true;
    })();
  </script>
</body>
</html>`;
}

/**
 * Pick the rrweb event closest to the target timestamp and turn it into a
 * one-line caption hint. The agent uses these hints to anchor each frame to
 * the digest entry it corresponds to.
 */
function buildCaptionHint(events: RrwebEvent[], targetMs: number, failurePointMs: number): string {
  const nearest = events.reduce((best, evt) =>
    Math.abs(evt.timestamp - targetMs) < Math.abs(best.timestamp - targetMs) ? evt : best
  );
  const offset = targetMs - failurePointMs;
  const offsetLabel =
    offset === 0
      ? "at failure"
      : offset < 0
        ? `${offset}ms before failure`
        : `${offset}ms after failure`;
  return `Frame ${offsetLabel} (rrweb event type=${nearest.type})`;
}
