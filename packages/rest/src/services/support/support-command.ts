// ---------------------------------------------------------------------------
// supportCommand — re-export shim for the folder-based service.
//
// The @shared/rest package.json uses `"./*": "./src/*"` for subpath exports,
// which does NOT fall back to `<dir>/index.ts` for directory imports. This
// shim gives callers a stable file path that re-exports everything from the
// real folder layout.
//
// Callers:
//   import * as supportCommand from "@shared/rest/services/support/support-command";
//
// The real files live under ./support-command/. See
// docs/conventions/service-layer-conventions.md rule 7 — this file was 637 lines
// before the split (2x the 300-line budget).
// ---------------------------------------------------------------------------

export * from "./support-command/assign";
export * from "./support-command/reply";
export * from "./support-command/status";
