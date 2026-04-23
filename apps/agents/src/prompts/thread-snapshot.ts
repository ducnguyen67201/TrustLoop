import type { ThreadSnapshot } from "@shared/types";

// Render the structured thread snapshot into the LLM user-message body.
//
// Follow-up: swap the JSON pretty-print for TOON per CLAUDE.md "TOON in,
// Positional JSON out" once a token-saving + output-parity eval lands.
export function renderThreadSnapshotPrompt(snapshot: ThreadSnapshot): string {
  return JSON.stringify(snapshot, null, 2);
}
