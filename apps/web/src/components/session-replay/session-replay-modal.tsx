"use client";

import { SessionEventTimeline } from "@/components/session-replay/session-event-timeline";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useCallback, useEffect, useRef, useState } from "react";

interface ReplayChunk {
  sequenceNumber: number;
  compressedData: Uint8Array;
  startTimestamp: string;
  endTimestamp: string;
}

interface SessionTimelineEvent {
  id: string;
  eventType: string;
  timestamp: string;
  url: string | null;
  payload: Record<string, unknown>;
}

interface SessionReplayModalProps {
  isOpen: boolean;
  onClose: () => void;
  sessionId: string;
  events: SessionTimelineEvent[];
  failurePointId: string | null;
  chunks: ReplayChunk[];
  totalChunks: number;
  isLoadingChunks: boolean;
  loadError: string | null;
  onRetryLoad: () => void;
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
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const playerRef = useRef<unknown>(null);

  // Close on Escape
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      if (e.key === " ") {
        e.preventDefault();
        setIsPlaying((prev) => !prev);
      }
    }
    if (isOpen) {
      document.addEventListener("keydown", handleKeyDown);
      return () => document.removeEventListener("keydown", handleKeyDown);
    }
  }, [isOpen, onClose]);

  // Initialize rrweb player when chunks are loaded
  useEffect(() => {
    if (!isOpen || chunks.length === 0 || !playerContainerRef.current) return;

    async function initPlayer() {
      try {
        // Dynamic import of rrweb-player (only load when needed)
        // @ts-expect-error rrweb-player may not have types installed
        const { default: rrwebPlayer } = await import("rrweb-player");
        const container = playerContainerRef.current;
        if (!container) return;

        // Decompress and parse all chunks into rrweb events
        const allEvents: unknown[] = [];
        for (const chunk of chunks) {
          try {
            const decompressed = await decompressChunk(chunk.compressedData);
            const parsed = JSON.parse(decompressed) as unknown[];
            allEvents.push(...parsed);
          } catch {
            // Skip corrupt chunks
          }
        }

        if (allEvents.length === 0) return;

        // Clear previous player
        container.innerHTML = "";

        const player = new rrwebPlayer({
          target: container,
          props: {
            events: allEvents,
            width: container.clientWidth,
            height: container.clientHeight - 48, // room for controls
            autoPlay: false,
            showController: false, // we build our own controls
            speed: playbackSpeed,
          },
        });

        playerRef.current = player;

        const meta = player.getMetaData();
        setDuration(meta.totalTime);
        setCurrentTime(0);
      } catch (error) {
        console.error("[TrustLoop] Failed to initialize replay player:", error);
      }
    }

    void initPlayer();
  }, [isOpen, chunks, playbackSpeed]);

  const handleEventClick = useCallback((_eventId: string, timestamp: string) => {
    setSelectedEventId(_eventId);
    // Jump replay to this timestamp
    const player = playerRef.current;
    if (player && typeof (player as { goto: (t: number) => void }).goto === "function") {
      const eventTime = new Date(timestamp).getTime();
      (player as { goto: (t: number) => void }).goto(eventTime);
    }
  }, []);

  function togglePlayback() {
    const player = playerRef.current;
    if (!player) return;
    if (isPlaying) {
      (player as { pause: () => void }).pause();
    } else {
      (player as { play: () => void }).play();
    }
    setIsPlaying(!isPlaying);
  }

  function cycleSpeed() {
    const speeds = [1, 2, 4, 8];
    const nextIndex = (speeds.indexOf(playbackSpeed) + 1) % speeds.length;
    setPlaybackSpeed(speeds[nextIndex] ?? 1);
  }

  function formatDuration(ms: number): string {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
  }

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-background/95"
      role="dialog"
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
            <div ref={playerContainerRef} className="flex-1 overflow-hidden" />
          )}

          {/* Playback controls */}
          {chunks.length > 0 && !isLoadingChunks && !loadError ? (
            <div className="flex h-12 items-center gap-3 border-t px-4">
              <Button
                variant="outline"
                size="sm"
                onClick={togglePlayback}
                aria-label={isPlaying ? "Pause" : "Play"}
              >
                {isPlaying ? "⏸" : "▶"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={cycleSpeed}
                aria-label={`Speed: ${playbackSpeed}x`}
              >
                {playbackSpeed}x
              </Button>
              <div className="flex-1">
                <Progress value={duration > 0 ? (currentTime / duration) * 100 : 0} />
              </div>
              <span className="font-mono text-xs text-muted-foreground">
                {formatDuration(currentTime)} / {formatDuration(duration)}
              </span>
            </div>
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
            selectedEventId={selectedEventId}
          />
        </div>
      </div>
    </div>
  );
}

async function decompressChunk(data: Uint8Array): Promise<string> {
  // Try DecompressionStream (modern browsers)
  if (typeof DecompressionStream !== "undefined") {
    const stream = new Blob([data as BlobPart])
      .stream()
      .pipeThrough(new DecompressionStream("gzip"));
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    let done = false;
    while (!done) {
      const result = await reader.read();
      if (result.value) chunks.push(result.value);
      done = result.done;
    }
    const merged = new Uint8Array(chunks.reduce((acc, c) => acc + c.length, 0));
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }
    return new TextDecoder().decode(merged);
  }

  // Fallback: assume uncompressed
  return new TextDecoder().decode(data);
}
