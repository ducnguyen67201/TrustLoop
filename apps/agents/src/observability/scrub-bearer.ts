// Bearer-token scrubber. The agents service speaks to customer-supplied MCP
// servers via HTTP+SSE with `Authorization: Bearer <token>` headers. Without
// this scrubber, a logged request body or error message can leak the token.
//
// Strategy: monkey-patch the global console at agents-service entrypoint
// before any other code runs. Scrub two patterns:
//   1. Authorization headers ("Authorization: Bearer abc.def" → "Bearer [redacted]")
//   2. Inline bearer-shaped tokens ("Bearer abc.def" → "Bearer [redacted]")
//
// This is the minimal v1 path. v2 should adopt a real logger (pino) with
// structured redaction rules; track as a deferred TODO. See plan
// docs/concepts/agent-mcp-tools.md for context.

const AUTH_HEADER_PATTERN = /(authorization\s*[:=]\s*"?)bearer\s+[A-Za-z0-9._\-+/=]+/gi;
const INLINE_BEARER_PATTERN = /\bbearer\s+[A-Za-z0-9._\-+/=]+/gi;
const REDACTED = "[redacted]";

export function scrubString(value: string): string {
  return value
    .replace(AUTH_HEADER_PATTERN, (_match, prefix) => `${prefix}Bearer ${REDACTED}`)
    .replace(INLINE_BEARER_PATTERN, `Bearer ${REDACTED}`);
}

function scrubValue(value: unknown, depth = 0): unknown {
  if (depth > 4) return value;
  if (typeof value === "string") return scrubString(value);
  if (Array.isArray(value)) return value.map((item) => scrubValue(item, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = scrubValue(v, depth + 1);
    }
    return out;
  }
  return value;
}

export function scrubArgs(args: unknown[]): unknown[] {
  return args.map((arg) => scrubValue(arg));
}

let installed = false;

export function installConsoleScrubber(): void {
  if (installed) return;
  installed = true;

  const originalLog = console.log.bind(console);
  const originalWarn = console.warn.bind(console);
  const originalError = console.error.bind(console);
  const originalInfo = console.info.bind(console);
  const originalDebug = console.debug.bind(console);

  console.log = (...args: unknown[]) => originalLog(...scrubArgs(args));
  console.warn = (...args: unknown[]) => originalWarn(...scrubArgs(args));
  console.error = (...args: unknown[]) => originalError(...scrubArgs(args));
  console.info = (...args: unknown[]) => originalInfo(...scrubArgs(args));
  console.debug = (...args: unknown[]) => originalDebug(...scrubArgs(args));
}
