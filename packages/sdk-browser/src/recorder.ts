import { debugLog, warnLog } from "./logger.js";

interface RrwebRecordOptions {
  maskAllText?: boolean;
  maskAllInputs?: boolean;
  emit: (event: Record<string, unknown>) => void;
}

type RrwebStopFn = () => void;

interface RrwebModule {
  record: (options: RrwebRecordOptions) => RrwebStopFn | undefined;
}

export interface RecorderHandle {
  getEvents(): Record<string, unknown>[];
  clearEvents(): void;
  pause(): void;
  resume(): void;
  stop(): void;
}

export async function createRecorder(
  maskAllText: boolean,
  maskAllInputs: boolean
): Promise<RecorderHandle | null> {
  let events: Record<string, unknown>[] = [];
  let stopFn: RrwebStopFn | null | undefined = null;
  let paused = false;

  try {
    const rrwebModule: RrwebModule = await import("rrweb");
    const record = rrwebModule.record;

    stopFn = record({
      maskAllText,
      maskAllInputs,
      emit(event: Record<string, unknown>) {
        if (!paused) {
          events.push(event);
        }
      },
    });

    debugLog("rrweb recorder started");
  } catch (err) {
    warnLog(
      "rrweb not available or failed to initialize. Structured events will still be captured.",
      err
    );
    return null;
  }

  function handleVisibilityChange(): void {
    try {
      if (globalThis.document?.visibilityState === "hidden") {
        paused = true;
        debugLog("Recorder paused (page hidden)");
      } else {
        paused = false;
        debugLog("Recorder resumed (page visible)");
      }
    } catch {
      // Fault isolation
    }
  }

  globalThis.document?.addEventListener("visibilitychange", handleVisibilityChange);

  return {
    getEvents(): Record<string, unknown>[] {
      return events;
    },

    clearEvents(): void {
      events = [];
    },

    pause(): void {
      paused = true;
    },

    resume(): void {
      paused = false;
    },

    stop(): void {
      try {
        stopFn?.();
        globalThis.document?.removeEventListener("visibilitychange", handleVisibilityChange);
        debugLog("rrweb recorder stopped");
      } catch (err) {
        warnLog("Error stopping rrweb recorder", err);
      }
    },
  };
}
