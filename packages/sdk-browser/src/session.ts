import { debugLog } from "./logger.js";

const INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

function generateSessionId(): string {
  try {
    return globalThis.crypto.randomUUID();
  } catch {
    // Fallback for environments without crypto.randomUUID
    const segment = () =>
      Math.floor(Math.random() * 0x10000)
        .toString(16)
        .padStart(4, "0");
    return `${segment()}${segment()}-${segment()}-4${segment().slice(1)}-${segment()}-${segment()}${segment()}${segment()}`;
  }
}

export interface SessionManager {
  getSessionId(): string;
  trackActivity(): void;
  destroy(): void;
}

export function createSessionManager(): SessionManager {
  let sessionId = generateSessionId();
  let lastActivity = Date.now();

  debugLog("Session created", sessionId);

  function maybeRotate(): void {
    const now = Date.now();
    if (now - lastActivity > INACTIVITY_TIMEOUT_MS) {
      sessionId = generateSessionId();
      debugLog("Session rotated due to inactivity", sessionId);
    }
    lastActivity = now;
  }

  return {
    getSessionId(): string {
      maybeRotate();
      return sessionId;
    },

    trackActivity(): void {
      lastActivity = Date.now();
    },

    destroy(): void {
      debugLog("Session destroyed", sessionId);
    },
  };
}
