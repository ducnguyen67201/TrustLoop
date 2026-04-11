// ---------------------------------------------------------------------------
// codex/github — GitHub App integration barrel
//
// Internal barrel for the github folder split. External callers reach these
// exports via the top-level `codex` namespace (through codex/index.ts which
// re-exports from `./github` via the codex/github.ts shim).
//
// File layout (split from a single 418-line file during the codex rollout —
// see docs/service-layer-conventions.md rule 7 on the 300-line budget):
//
//   _shared.ts       — authenticated Octokit factory (used by installation + content)
//   install-url.ts   — HMAC-signed install URL + state verification
//   installation.ts  — connect, disconnect, refresh, callback handling
//   content.ts       — tree, file contents, latest commit SHA
// ---------------------------------------------------------------------------

export * from "./install-url";
export * from "./installation";
export * from "./content";
