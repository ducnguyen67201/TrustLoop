import { debugLog } from "./logger.js";

const SESSION_STORAGE_KEY = "trustloop_recording";
const INDICATOR_ATTR = "data-trustloop-indicator";

export interface ConsentManager {
  startRecording(): void;
  stopRecording(): void;
  isRecording(): boolean;
  destroy(): void;
}

function persistState(recording: boolean): void {
  try {
    globalThis.sessionStorage?.setItem(SESSION_STORAGE_KEY, recording ? "1" : "0");
  } catch {
    // sessionStorage may be unavailable in some contexts
  }
}

function readPersistedState(): boolean | null {
  try {
    const value = globalThis.sessionStorage?.getItem(SESSION_STORAGE_KEY);
    if (value === "1") return true;
    if (value === "0") return false;
    return null;
  } catch {
    return null;
  }
}

function createIndicator(): HTMLElement | null {
  try {
    if (!globalThis.document?.createElement) return null;

    const indicator = globalThis.document.createElement("div");
    indicator.setAttribute(INDICATOR_ATTR, "");
    indicator.style.cssText = [
      "position: fixed",
      "bottom: 8px",
      "right: 8px",
      "width: 8px",
      "height: 8px",
      "border-radius: 50%",
      "background-color: #ef4444",
      "z-index: 2147483647",
      "pointer-events: none",
      "opacity: 0.8",
    ].join(";");

    return indicator;
  } catch {
    return null;
  }
}

function removeIndicator(): void {
  try {
    const existing = globalThis.document?.querySelector(`[${INDICATOR_ATTR}]`);
    existing?.remove();
  } catch {
    // Fault isolation
  }
}

export function createConsentManager(): ConsentManager {
  let recording = false;
  let indicator: HTMLElement | null = null;

  // Restore persisted state from sessionStorage
  const persisted = readPersistedState();
  if (persisted === true) {
    recording = true;
    indicator = createIndicator();
    if (indicator) {
      globalThis.document?.body?.appendChild(indicator);
    }
    debugLog("Restored recording state from session");
  }

  return {
    startRecording(): void {
      if (recording) return;
      recording = true;
      persistState(true);

      indicator = createIndicator();
      if (indicator) {
        globalThis.document?.body?.appendChild(indicator);
      }

      debugLog("Recording started");
    },

    stopRecording(): void {
      if (!recording) return;
      recording = false;
      persistState(false);
      removeIndicator();
      indicator = null;

      debugLog("Recording stopped");
    },

    isRecording(): boolean {
      return recording;
    },

    destroy(): void {
      removeIndicator();
      indicator = null;
      recording = false;
      try {
        globalThis.sessionStorage?.removeItem(SESSION_STORAGE_KEY);
      } catch {
        // Fault isolation
      }
    },
  };
}
