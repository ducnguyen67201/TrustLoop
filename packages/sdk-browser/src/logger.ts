let debugEnabled = false;

export function setDebug(enabled: boolean): void {
  debugEnabled = enabled;
}

export function debugLog(message: string, ...args: unknown[]): void {
  if (debugEnabled) {
    console.log(`[TrustLoop] ${message}`, ...args);
  }
}

export function warnLog(message: string, ...args: unknown[]): void {
  console.warn(`[TrustLoop] ${message}`, ...args);
}
