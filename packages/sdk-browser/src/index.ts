import { startCapture } from "./capture";
import type { CaptureHandle } from "./capture";
import { extractWorkspaceId, resolveConfig } from "./config";
import { createConsentManager } from "./consent";
import type { ConsentManager } from "./consent";
import {
  didConcreteIdentityChange,
  hasConcreteIdentity,
  normalizeSessionIdentity,
} from "./identity";
import { debugLog, setDebug, warnLog } from "./logger";
import { createRecorder } from "./recorder";
import type { RecorderHandle } from "./recorder";
import { createRingBuffer } from "./ring-buffer";
import type { RingBuffer } from "./ring-buffer";
import { createSessionManager } from "./session";
import type { SessionManager } from "./session";
import { createTransport } from "./transport";
import type { TransportHandle } from "./transport";
import type { FlushPayload, ResolvedConfig, TrustLoopConfig, UserInfo } from "./types";

// ── Internal SDK State ───────────────────────────────────────────────

let initialized = false;
let resolvedConfig: ResolvedConfig | null = null;
let sessionManager: SessionManager | null = null;
let ringBuffer: RingBuffer | null = null;
let captureHandle: CaptureHandle | null = null;
let recorderHandle: RecorderHandle | null = null;
let transportHandle: TransportHandle | null = null;
let consentManager: ConsentManager | null = null;
let flushTimer: ReturnType<typeof setInterval> | null = null;
let userId: string | undefined;
let userEmail: string | undefined;

// ── Flush Logic ──────────────────────────────────────────────────────

function buildFlushPayload(): FlushPayload | null {
  if (!ringBuffer || !sessionManager || !resolvedConfig) return null;

  const structuredEvents = ringBuffer.flush();
  let rrwebEventsEncoded: string | undefined;

  if (recorderHandle) {
    const rrwebEvents = recorderHandle.getEvents();
    if (rrwebEvents.length > 0) {
      try {
        rrwebEventsEncoded = JSON.stringify(rrwebEvents);
        recorderHandle.clearEvents();
      } catch (err) {
        warnLog("Failed to serialize rrweb events", err);
      }
    }
  }

  if (structuredEvents.length === 0 && !rrwebEventsEncoded) {
    return null;
  }

  const workspaceId = extractWorkspaceId(resolvedConfig.apiKey);

  return {
    sessionId: sessionManager.getSessionId(),
    workspaceId,
    userId,
    userEmail,
    timestamp: Date.now(),
    structuredEvents,
    rrwebEvents: rrwebEventsEncoded,
  };
}

let identityWarningLogged = false;

function performFlush(): void {
  try {
    if (!consentManager?.isRecording()) return;

    const payload = buildFlushPayload();
    if (!payload || !transportHandle) return;

    if (!identityWarningLogged && !userId && !userEmail) {
      warnLog(
        "No user identity set. Session replay cannot be matched to support conversations. " +
          "Call TrustLoop.setUser({ id, email }) after authentication."
      );
      identityWarningLogged = true;
    }

    void transportHandle.flush(payload);
    debugLog("Flush triggered", payload.structuredEvents.length, "events");
  } catch (err) {
    warnLog("Flush error", err);
  }
}

function performBeaconFlush(): void {
  try {
    if (!consentManager?.isRecording()) return;

    const payload = buildFlushPayload();
    if (!payload || !transportHandle) return;

    transportHandle.flushBeacon(payload);
  } catch (err) {
    warnLog("Beacon flush error", err);
  }
}

// ── Lifecycle Handlers ───────────────────────────────────────────────

function handleBeforeUnload(): void {
  performBeaconFlush();
}

function handleVisibilityChange(): void {
  try {
    if (globalThis.document?.visibilityState === "hidden") {
      performFlush();
    }
  } catch {
    // Fault isolation
  }
}

// ── Teardown ─────────────────────────────────────────────────────────

function teardown(): void {
  if (flushTimer !== null) {
    clearInterval(flushTimer);
    flushTimer = null;
  }

  captureHandle?.destroy();
  captureHandle = null;

  recorderHandle?.stop();
  recorderHandle = null;

  transportHandle?.destroy();
  transportHandle = null;

  consentManager?.destroy();
  consentManager = null;

  sessionManager?.destroy();
  sessionManager = null;

  ringBuffer?.clear();
  ringBuffer = null;

  resolvedConfig = null;
  initialized = false;
  identityWarningLogged = false;

  globalThis.removeEventListener?.("beforeunload", handleBeforeUnload);
  globalThis.document?.removeEventListener("visibilitychange", handleVisibilityChange);
}

// ── Public API ───────────────────────────────────────────────────────

export const TrustLoop = {
  init(config: TrustLoopConfig): void {
    try {
      if (initialized) {
        warnLog("Already initialized, call destroy() first to reinitialize");
        return;
      }

      resolvedConfig = resolveConfig(config);
      setDebug(resolvedConfig.debug);
      debugLog("Initializing with config", {
        ingestUrl: resolvedConfig.ingestUrl,
        bufferMinutes: resolvedConfig.bufferMinutes,
        flushIntervalMs: resolvedConfig.flushIntervalMs,
      });

      const initialIdentity = normalizeSessionIdentity({
        id: config.userId,
        email: config.userEmail,
      });
      userId = initialIdentity.userId;
      userEmail = initialIdentity.userEmail;

      // Session management
      sessionManager = createSessionManager();

      // Ring buffer for structured events
      const bufferWindowMs = resolvedConfig.bufferMinutes * 60 * 1000;
      ringBuffer = createRingBuffer(bufferWindowMs);

      // Structured event capture
      captureHandle = startCapture(ringBuffer, resolvedConfig.ingestUrl);

      // rrweb recorder (async, non-blocking)
      void createRecorder(resolvedConfig.maskAllText, resolvedConfig.maskAllInputs).then(
        (handle) => {
          recorderHandle = handle;
        }
      );

      // Transport
      transportHandle = createTransport({
        ingestUrl: resolvedConfig.ingestUrl,
        apiKey: resolvedConfig.apiKey,
        maxPayloadBytes: resolvedConfig.maxPayloadBytes,
      });

      // Consent manager
      consentManager = createConsentManager();

      // Flush timer
      flushTimer = setInterval(performFlush, resolvedConfig.flushIntervalMs);

      // Page lifecycle
      globalThis.addEventListener?.("beforeunload", handleBeforeUnload);
      globalThis.document?.addEventListener("visibilitychange", handleVisibilityChange);

      initialized = true;
      debugLog("Initialization complete");
    } catch (err) {
      warnLog("Initialization failed", err);
      teardown();
    }
  },

  setUser(user: UserInfo): void {
    try {
      const nextIdentity = normalizeSessionIdentity(user);
      const previousIdentity = { userId, userEmail };

      if (sessionManager && didConcreteIdentityChange(previousIdentity, nextIdentity)) {
        sessionManager.rotate("after identity change");
      }

      userId = nextIdentity.userId;
      userEmail = nextIdentity.userEmail;
      identityWarningLogged = false;
      debugLog("User set", nextIdentity.userId ?? nextIdentity.userEmail ?? "anonymous");
    } catch (err) {
      warnLog("setUser error", err);
    }
  },

  clearUser(): void {
    try {
      if (sessionManager && hasConcreteIdentity({ userId, userEmail })) {
        sessionManager.rotate("after identity clear");
      }

      userId = undefined;
      userEmail = undefined;
      identityWarningLogged = false;
      debugLog("User cleared");
    } catch (err) {
      warnLog("clearUser error", err);
    }
  },

  startRecording(): void {
    try {
      if (!initialized) {
        warnLog("SDK not initialized, call init() first");
        return;
      }
      consentManager?.startRecording();
      recorderHandle?.resume();
    } catch (err) {
      warnLog("startRecording error", err);
    }
  },

  stopRecording(): void {
    try {
      if (!initialized) return;
      consentManager?.stopRecording();
      recorderHandle?.pause();
      performFlush();
    } catch (err) {
      warnLog("stopRecording error", err);
    }
  },

  isRecording(): boolean {
    try {
      return consentManager?.isRecording() ?? false;
    } catch {
      return false;
    }
  },

  destroy(): void {
    try {
      performBeaconFlush();
      teardown();
      debugLog("SDK destroyed");
    } catch (err) {
      warnLog("destroy error", err);
    }
  },
};

export type { TrustLoopConfig, UserInfo };
