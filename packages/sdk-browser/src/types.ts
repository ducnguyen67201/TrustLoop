/** SDK configuration provided by the customer at init time. */
export interface TrustLoopConfig {
  apiKey: string;
  ingestUrl?: string;
  userId?: string;
  userEmail?: string;
  release?: string;
  /** Mask all text content in rrweb recordings (default: true) */
  maskAllText?: boolean;
  /** Mask all input values in rrweb recordings (default: true) */
  maskAllInputs?: boolean;
  /** Ring buffer retention window in minutes (default: 5, range 1-15) */
  bufferMinutes?: number;
  /** Interval between automatic flushes in milliseconds (default: 10000) */
  flushIntervalMs?: number;
  /** Maximum compressed payload size in bytes (default: 524288 = 512KB) */
  maxPayloadBytes?: number;
  /** Enable debug logging to console (default: false) */
  debug?: boolean;
}

export interface UserInfo {
  email?: string;
  name?: string;
  id?: string;
}

export interface StructuredEvent {
  /** Event type: CLICK, ROUTE, NETWORK_ERROR, CONSOLE_ERROR, EXCEPTION */
  t: string;
  /** Timestamp in ms since epoch */
  ts: number;
  /** Current URL at time of event */
  u?: string;
  /** Type-specific payload */
  p: unknown;
}

export interface FlushPayload {
  sessionId: string;
  workspaceId: string;
  userId?: string;
  userEmail?: string;
  timestamp: number;
  structuredEvents: StructuredEvent[];
  rrwebEvents?: string;
}

export interface ResolvedConfig {
  apiKey: string;
  ingestUrl: string;
  userId?: string;
  userEmail?: string;
  release?: string;
  maskAllText: boolean;
  maskAllInputs: boolean;
  bufferMinutes: number;
  flushIntervalMs: number;
  maxPayloadBytes: number;
  debug: boolean;
}
