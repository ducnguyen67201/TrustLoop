"use client";

import type { ReplayChunkResponse } from "@shared/types";
import { useEffect, useRef } from "react";

interface RrwebPlayerViewProps {
  chunks: ReplayChunkResponse[];
  speed: number;
}

interface RrwebPlayerInstance {
  $set?: (props: { width: number; height: number }) => void;
  $destroy?: () => void;
  triggerResize?: () => void;
  setConfig?: (config: { speed: number }) => void;
}

interface ViewportSize {
  width: number;
  height: number;
}

const RRWEB_CONTROLLER_HEIGHT = 80;

export function RrwebPlayerView({ chunks, speed }: RrwebPlayerViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<RrwebPlayerInstance | null>(null);

  // Latest speed captured without making the init effect depend on it —
  // a speed change must update the existing player via setConfig, never
  // tear it down and lose playback position.
  const speedRef = useRef(speed);
  speedRef.current = speed;

  useEffect(() => {
    if (chunks.length === 0 || !containerRef.current) return;

    let cancelled = false;
    let resizeObserver: ResizeObserver | null = null;
    let rafHandle: number | null = null;

    async function init() {
      try {
        const { default: rrwebPlayer } = await import("rrweb-player");
        const container = containerRef.current;
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

        // One frame lets sheet open transforms + flex layout settle before
        // we measure the container. Without this, clientWidth/Height can read
        // as zero on first paint and the player locks to a broken size.
        await new Promise<void>((resolve) => {
          rafHandle = requestAnimationFrame(() => {
            rafHandle = null;
            resolve();
          });
        });
        if (cancelled || !container.isConnected) return;

        const { width: originalWidth, height: originalHeight } = extractOriginalViewport(allEvents);
        const fittedViewport = fitInside(
          originalWidth,
          originalHeight,
          container.clientWidth,
          Math.max(1, container.clientHeight - RRWEB_CONTROLLER_HEIGHT)
        );

        container.innerHTML = "";
        const player: RrwebPlayerInstance = new rrwebPlayer({
          target: container,
          props: {
            events: allEvents,
            width: fittedViewport.width,
            height: fittedViewport.height,
            autoPlay: false,
            showController: true,
            speed: speedRef.current,
          },
        });
        playerRef.current = player;

        // rrweb-player internally transforms the replay iframe to fit its
        // (width × height) frame and centers it — we just need the outer
        // `.rr-player` element to fill the container and track resizes.
        resizeObserver = new ResizeObserver(() => {
          const p = playerRef.current;
          if (!p || !container) return;
          const nextViewport = fitInside(
            originalWidth,
            originalHeight,
            container.clientWidth,
            Math.max(1, container.clientHeight - RRWEB_CONTROLLER_HEIGHT)
          );
          p.$set?.({ width: nextViewport.width, height: nextViewport.height });
          p.triggerResize?.();
        });
        resizeObserver.observe(container);
      } catch (err) {
        console.error("[TrustLoop] Failed to initialize replay player", err);
      }
    }

    void init();

    return () => {
      cancelled = true;
      if (rafHandle !== null) cancelAnimationFrame(rafHandle);
      resizeObserver?.disconnect();
      // rrweb-player is a Svelte component — $destroy tears down its internal
      // playback timer and event listeners. Skipping this leaks both across
      // session switches.
      playerRef.current?.$destroy?.();
      if (containerRef.current) containerRef.current.innerHTML = "";
      playerRef.current = null;
    };
  }, [chunks]);

  useEffect(() => {
    playerRef.current?.setConfig?.({ speed });
  }, [speed]);

  return (
    <div
      ref={containerRef}
      className="flex h-full w-full items-center justify-center overflow-hidden"
    />
  );
}

function extractOriginalViewport(events: unknown[]): ViewportSize {
  for (const event of events) {
    const typed = event as { type?: number; data?: { width?: number; height?: number } };
    if (typed.type === 4 && typed.data?.width && typed.data?.height) {
      return { width: typed.data.width, height: typed.data.height };
    }
  }
  return { width: 1280, height: 800 };
}

function fitInside(
  sourceWidth: number,
  sourceHeight: number,
  maxWidth: number,
  maxHeight: number
): ViewportSize {
  if (sourceWidth <= 0 || sourceHeight <= 0 || maxWidth <= 0 || maxHeight <= 0) {
    return { width: Math.max(1, maxWidth), height: Math.max(1, maxHeight) };
  }

  const scale = Math.min(maxWidth / sourceWidth, maxHeight / sourceHeight);
  return {
    width: Math.floor(sourceWidth * scale),
    height: Math.floor(sourceHeight * scale),
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
