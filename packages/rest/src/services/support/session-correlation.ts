// ---------------------------------------------------------------------------
// sessionCorrelation — re-export shim for the folder-based service.
//
// The @shared/rest package.json uses `"./*": "./src/*"` for subpath exports,
// which does NOT fall back to `<dir>/index.ts` for directory imports (unlike
// TypeScript's module resolution). This shim gives callers a stable file
// path that re-exports everything from the real folder layout.
//
// Callers:
//   import * as sessionCorrelation from "@shared/rest/services/support/session-correlation";
//
// See docs/conventions/service-layer-conventions.md — rule 7, "size budget: ~300 lines,
// then split by concern". The real files live under ./session-correlation/.
// ---------------------------------------------------------------------------

export * from "./session-correlation/extract";
export * from "./session-correlation/digest";
export * from "./session-correlation/find";
