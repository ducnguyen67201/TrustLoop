// ---------------------------------------------------------------------------
// googleOauth — re-export shim for the folder-based service.
//
// The @shared/rest package.json uses `"./*": "./src/*"` for subpath exports,
// which does NOT fall back to `<dir>/index.ts` for directory imports. This
// shim gives callers a stable file path that re-exports everything from the
// real folder layout.
//
// Callers:
//   import * as googleOauth from "@shared/rest/services/auth/google-oauth";
//
// The real files live under ./google-oauth/. See
// docs/service-layer-conventions.md rule 7 ("size budget: ~300 lines,
// then split by concern") — this file was 417 lines before the split.
// ---------------------------------------------------------------------------

export * from "./google-oauth/authorize";
export * from "./google-oauth/token";
export * from "./google-oauth/verify";
export * from "./google-oauth/identity";
