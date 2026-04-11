// ---------------------------------------------------------------------------
// codex — re-export shim for the folder-based service root.
//
// The @shared/rest package.json uses `"./*": "./src/*"` for subpath exports,
// which does NOT fall back to `<dir>/index.ts` for directory imports the way
// TypeScript's module resolver does. This shim gives callers a stable file
// path that re-exports the `codex/index.ts` barrel.
//
// Callers:
//   import * as codex from "@shared/rest/codex";
//   await codex.searchRepositoryCode(input);
//   await codex.fetchRepoTree(...);
//   await codex.getSettings(workspaceId);
//
// The real files live under ./codex/. See docs/service-layer-conventions.md.
// ---------------------------------------------------------------------------

export * from "./codex/index";
