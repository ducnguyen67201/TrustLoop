"use client";

import { SessionEventTimeline } from "@/components/session-replay/session-event-timeline";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import type { ReplayChunkResponse, SessionTimelineEvent } from "@shared/types";
import { useCallback, useEffect, useRef, useState } from "react";

interface SessionReplayModalProps {
  isOpen: boolean;
  onClose: () => void;
  sessionId: string;
  events: SessionTimelineEvent[];
  failurePointId: string | null;
  selectedEventId: string | null;
  selectedEventTimestamp: string | null;
  chunks: ReplayChunkResponse[];
  totalChunks: number;
  isLoadingChunks: boolean;
  loadError: string | null;
  onRetryLoad: () => void;
}

interface ReplayMeta {
  startTime: number;
  endTime: number;
  totalTime: number;
}

interface RrwebPlayerInstance {
  $destroy?: () => void;
  $set?: (props: { width: number; height: number }) => void;
  addEventListener: (event: string, handler: (payload: unknown) => void) => void;
  getMetaData: () => ReplayMeta;
  goto: (timeOffset: number, play?: boolean) => void;
  pause: () => void;
  play: (timeOffset?: number) => void;
  setSpeed?: (speed: number) => void;
  triggerResize?: () => void;
}

/**
 * Full-width modal for rrweb session replay.
 * Layout: rrweb player left (~70%), event timeline sidebar right (~30%).
 * Per design review: full-width modal gives replay room to show DOM reconstruction.
 */
export function SessionReplayModal({
  isOpen,
  onClose,
  sessionId,
  events,
  failurePointId,
  selectedEventId,
  selectedEventTimestamp,
  chunks,
  totalChunks,
  isLoadingChunks,
  loadError,
  onRetryLoad,
}: SessionReplayModalProps) {
  const playerContainerRef = useRef<HTMLDivElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [activeEventId, setActiveEventId] = useState<string | null>(selectedEventId);
  const [jumpHint, setJumpHint] = useState<string | null>(null);
  const [replayMeta, setReplayMeta] = useState<ReplayMeta | null>(null);
  const currentTimeRef = useRef(currentTime);
  const isPlayingRef = useRef(isPlaying);
  const replayEventTimestampsRef = useRef<number[]>([]);
  const playerRef = useRef<RrwebPlayerInstance | null>(null);
  currentTimeRef.current = currentTime;
  isPlayingRef.current = isPlaying;

  // Close on Escape
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      if (e.key === " ") {
        e.preventDefault();
        const player = playerRef.current;
        if (!player) {
          return;
        }

        if (isPlayingRef.current) {
          player.pause();
        } else {
          player.play(currentTimeRef.current);
        }
        setIsPlaying((prev) => !prev);
      }
    }
    if (isOpen) {
      document.addEventListener("keydown", handleKeyDown);
      return () => document.removeEventListener("keydown", handleKeyDown);
    }
  }, [isOpen, onClose]);

  // Initialize rrweb player when chunks are loaded. playbackSpeed is intentionally
  // omitted — a dedicated effect below propagates speed changes via setSpeed so we
  // don't tear down and rebuild the player every time the user changes speed.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see comment above
  useEffect(() => {
    if (!isOpen || chunks.length === 0 || !playerContainerRef.current) return;

    let cancelled = false;
    let resizeObserver: ResizeObserver | null = null;
    let player: RrwebPlayerInstance | null = null;

    async function initPlayer() {
      try {
        const { default: rrwebPlayer } = await import("rrweb-player");
        const container = playerContainerRef.current;
        if (!container || cancelled) return;

        const allEvents: unknown[] = [];
        for (const chunk of chunks) {
          try {
            const decoded = decodeBase64Chunk(chunk.compressedData);
            const parsed = JSON.parse(decoded) as unknown[];
            allEvents.push(...parsed);
          } catch {
            // Skip corrupt chunks
          }
        }

        if (allEvents.length === 0) return;
        replayEventTimestampsRef.current = allEvents
          .map((event) => extractReplayTimestamp(event))
          .filter((timestamp): timestamp is number => timestamp !== null)
          .sort((left, right) => left - right);

        const { width: origWidth, height: origHeight } = extractOriginalViewport(allEvents);
        const fit = fitInside(origWidth, origHeight, container.clientWidth, container.clientHeight);

        container.innerHTML = "";

        player = new rrwebPlayer({
          target: container,
          props: {
            events: allEvents,
            width: fit.width,
            height: fit.height,
            autoPlay: false,
            showController: false,
            speed: playbackSpeed,
          },
        });

        playerRef.current = player;

        player.addEventListener("ui-update-current-time", (payload) => {
          if (typeof payload === "number") {
            setCurrentTime(payload);
          }
        });
        player.addEventListener("ui-update-player-state", (payload) => {
          setIsPlaying(payload === "playing");
        });

        const meta = player.getMetaData();
        setReplayMeta(meta);
        setDuration(meta.totalTime);
        setCurrentTime(0);
        setJumpHint(null);

        resizeObserver = new ResizeObserver(() => {
          const p = playerRef.current;
          if (!p || !container) return;
          const next = fitInside(
            origWidth,
            origHeight,
            container.clientWidth,
            container.clientHeight
          );
          p.$set?.({ width: next.width, height: next.height });
          p.triggerResize?.();
        });
        resizeObserver.observe(container);
      } catch (error) {
        console.error("[TrustLoop] Failed to initialize replay player:", error);
      }
    }

    void initPlayer();

    return () => {
      cancelled = true;
      resizeObserver?.disconnect();
      player?.$destroy?.();
      playerRef.current = null;
      replayEventTimestampsRef.current = [];
      if (playerContainerRef.current) {
        playerContainerRef.current.innerHTML = "";
      }
      setReplayMeta(null);
      setCurrentTime(0);
      setDuration(0);
      setIsPlaying(false);
    };
  }, [isOpen, chunks]);

  // Update speed without reinitializing the player
  useEffect(() => {
    playerRef.current?.setSpeed?.(playbackSpeed);
  }, [playbackSpeed]);

  useEffect(() => {
    setActiveEventId(selectedEventId);
  }, [selectedEventId]);

  useEffect(() => {
    if (!replayMeta) {
      return;
    }

    const activeEvent = findActiveEventId(events, replayMeta.startTime + currentTime);
    setActiveEventId(activeEvent ?? selectedEventId);
  }, [currentTime, events, replayMeta, selectedEventId]);

  const jumpToTimestamp = useCallback(
    (timestamp: string | null, eventId?: string | null) => {
      if (!timestamp || !replayMeta || !playerRef.current) {
        return;
      }

      const targetTime = new Date(timestamp).getTime();
      if (Number.isNaN(targetTime)) {
        return;
      }

      const jump = resolveReplayJump(targetTime, replayMeta, replayEventTimestampsRef.current);
      playerRef.current.goto(jump.offsetMs, isPlaying);
      setCurrentTime(jump.offsetMs);
      setActiveEventId(eventId ?? findActiveEventId(events, jump.absoluteTimeMs) ?? null);
      setJumpHint(jump.hint);
    },
    [events, isPlaying, replayMeta]
  );

  useEffect(() => {
    jumpToTimestamp(selectedEventTimestamp, selectedEventId);
  }, [jumpToTimestamp, selectedEventId, selectedEventTimestamp]);

  const handleEventClick = useCallback(
    (eventId: string, timestamp: string) => {
      jumpToTimestamp(timestamp, eventId);
    },
    [jumpToTimestamp]
  );

  function togglePlayback() {
    const player = playerRef.current;
    if (!player) return;
    if (isPlaying) {
      player.pause();
    } else {
      player.play(currentTime);
    }
    setIsPlaying(!isPlaying);
  }

  function cycleSpeed() {
    const speeds = [1, 2, 4, 8];
    const nextIndex = (speeds.indexOf(playbackSpeed) + 1) % speeds.length;
    setPlaybackSpeed(speeds[nextIndex] ?? 1);
  }

  function seekRelative(deltaMs: number) {
    if (!replayMeta || !playerRef.current) {
      return;
    }

    const nextOffset = clamp(currentTime + deltaMs, 0, replayMeta.totalTime);
    playerRef.current.goto(nextOffset, isPlaying);
    setCurrentTime(nextOffset);
  }

  function jumpToFailure() {
    const failureEvent = events.find((event) => event.id === failurePointId) ?? null;
    if (!failureEvent) {
      return;
    }

    jumpToTimestamp(failureEvent.timestamp, failureEvent.id);
  }

  function formatDuration(ms: number): string {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
  }

  if (!isOpen) return null;

  return (
    <dialog
      open
      className="fixed inset-0 z-50 block h-full w-full max-w-none bg-background/95 p-0"
      aria-label="Session replay player"
      aria-modal="true"
    >
      {/* Header */}
      <div className="flex h-12 items-center justify-between border-b px-4">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-medium">Session Replay</h2>
          <span className="text-muted-foreground font-mono text-xs">{sessionId}</span>
        </div>
        <Button variant="outline" size="sm" onClick={onClose}>
          Close
        </Button>
      </div>

      {/* Main content */}
      <div className="flex h-[calc(100vh-48px)]">
        {/* Replay viewport (70%) */}
        <div className="flex flex-1 flex-col border-r">
          {isLoadingChunks ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3">
              <p className="text-muted-foreground text-sm">
                Loading replay... chunk {chunks.length} of {totalChunks}
              </p>
              <Progress
                value={totalChunks > 0 ? (chunks.length / totalChunks) * 100 : 0}
                className="w-48"
              />
            </div>
          ) : loadError ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3">
              <p className="text-sm text-destructive">
                This recording couldn't be loaded. It may have expired or the data was corrupted.
              </p>
              <Button variant="outline" size="sm" onClick={onRetryLoad}>
                Retry
              </Button>
            </div>
          ) : chunks.length === 0 ? (
            <div className="flex flex-1 items-center justify-center">
              <p className="text-muted-foreground text-sm">
                No replay data available. Only structured events were captured.
              </p>
            </div>
          ) : (
            <div
              ref={playerContainerRef}
              className="flex flex-1 items-center justify-center overflow-hidden bg-muted/40 p-4"
            />
          )}

          {/* Playback controls */}
          {chunks.length > 0 && !isLoadingChunks && !loadError ? (
            <div className="flex h-14 items-center gap-2 border-t px-4">
              <Button
                variant="outline"
                size="sm"
                onClick={togglePlayback}
                aria-label={isPlaying ? "Pause" : "Play"}
              >
                {isPlaying ? "⏸" : "▶"}
              </Button>
              <Button variant="outline" size="sm" onClick={() => seekRelative(-5_000)}>
                -5s
              </Button>
              <Button variant="outline" size="sm" onClick={() => seekRelative(5_000)}>
                +5s
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={cycleSpeed}
                aria-label={`Speed: ${playbackSpeed}x`}
              >
                {playbackSpeed}x
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={jumpToFailure}
                disabled={!failurePointId}
              >
                Jump to failure
              </Button>
              <div className="flex-1">
                <Progress value={duration > 0 ? (currentTime / duration) * 100 : 0} />
              </div>
              <span className="font-mono text-xs text-muted-foreground">
                {formatDuration(currentTime)} / {formatDuration(duration)}
              </span>
            </div>
          ) : null}
          {jumpHint ? (
            <div className="border-t px-4 py-2 text-xs text-muted-foreground">{jumpHint}</div>
          ) : null}
        </div>

        {/* Timeline sidebar (30%) */}
        <div className="w-80 shrink-0 overflow-hidden">
          <div className="border-b px-3 py-2">
            <h3 className="text-xs font-medium text-muted-foreground">Events</h3>
          </div>
          <SessionEventTimeline
            events={events}
            isLoading={false}
            failurePointId={failurePointId}
            onEventClick={handleEventClick}
            selectedEventId={activeEventId}
          />
        </div>
      </div>
    </dialog>
  );
}

interface ViewportSize {
  width: number;
  height: number;
}

/**
 * Pulls the captured viewport size from the first rrweb Meta event (type === 4).
 * Falls back to a laptop-ish default so the player never renders at zero.
 */
function extractOriginalViewport(events: unknown[]): ViewportSize {
  for (const event of events) {
    const typed = event as { type?: number; data?: { width?: number; height?: number } };
    if (typed.type === 4 && typed.data?.width && typed.data?.height) {
      return { width: typed.data.width, height: typed.data.height };
    }
  }
  return { width: 1280, height: 800 };
}

/**
 * Aspect-fit a source box inside a container box — preserves the original
 * capture aspect ratio so the player never stretches or letterboxes unevenly.
 */
function fitInside(
  srcWidth: number,
  srcHeight: number,
  maxWidth: number,
  maxHeight: number
): ViewportSize {
  if (srcWidth <= 0 || srcHeight <= 0 || maxWidth <= 0 || maxHeight <= 0) {
    return { width: Math.max(1, maxWidth), height: Math.max(1, maxHeight) };
  }
  const scale = Math.min(maxWidth / srcWidth, maxHeight / srcHeight);
  return {
    width: Math.floor(srcWidth * scale),
    height: Math.floor(srcHeight * scale),
  };
}

function decodeBase64Chunk(base64: string): string {
  const binaryStr = atob(base64);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) {
    bytes[i] = binaryStr.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

function extractReplayTimestamp(event: unknown): number | null {
  const typed = event as { timestamp?: number };
  return typeof typed.timestamp === "number" ? typed.timestamp : null;
}

function resolveReplayJump(
  targetTime: number,
  replayMeta: ReplayMeta,
  replayTimestamps: number[]
): { absoluteTimeMs: number; offsetMs: number; hint: string | null } {
  if (replayTimestamps.length === 0) {
    const offsetMs = clamp(targetTime - replayMeta.startTime, 0, replayMeta.totalTime);
    return {
      absoluteTimeMs: replayMeta.startTime + offsetMs,
      offsetMs,
      hint: null,
    };
  }

  if (targetTime <= replayTimestamps[0]!) {
    return {
      absoluteTimeMs: replayTimestamps[0]!,
      offsetMs: 0,
      hint: "Jumped to the start of the replay because the event happened before replay coverage began.",
    };
  }

  const lastReplayTimestamp = replayTimestamps.at(-1)!;
  if (targetTime >= lastReplayTimestamp) {
    return {
      absoluteTimeMs: lastReplayTimestamp,
      offsetMs: replayMeta.totalTime,
      hint: "Jumped to the end of the replay because the event happened after replay coverage ended.",
    };
  }

  let boundedTimestamp = replayTimestamps[0]!;
  for (const replayTimestamp of replayTimestamps) {
    if (replayTimestamp > targetTime) {
      break;
    }
    boundedTimestamp = replayTimestamp;
  }

  return {
    absoluteTimeMs: boundedTimestamp,
    offsetMs: clamp(boundedTimestamp - replayMeta.startTime, 0, replayMeta.totalTime),
    hint: null,
  };
}

function findActiveEventId(events: SessionTimelineEvent[], absoluteTimeMs: number): string | null {
  let activeEventId: string | null = null;

  for (const event of events) {
    const eventTime = new Date(event.timestamp).getTime();
    if (Number.isNaN(eventTime) || eventTime > absoluteTimeMs) {
      break;
    }
    activeEventId = event.id;
  }

  return activeEventId;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
