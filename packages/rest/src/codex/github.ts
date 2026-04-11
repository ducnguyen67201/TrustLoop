// ---------------------------------------------------------------------------
// codex/github — re-export shim for the folder-based split.
//
// The @shared/rest package.json uses `"./*": "./src/*"` for subpath exports,
// which doesn't fall back to `<dir>/index.ts` for directory imports. This
// shim gives callers (including the codex/index.ts barrel) a stable file
// path that resolves to the folder layout.
//
// The real files live under ./github/. See
// docs/service-layer-conventions.md — this file was 418 lines before the
// split, over the 300-line budget.
// ---------------------------------------------------------------------------

export * from "./github/_shared";
export * from "./github/install-url";
export * from "./github/installation";
export * from "./github/content";
