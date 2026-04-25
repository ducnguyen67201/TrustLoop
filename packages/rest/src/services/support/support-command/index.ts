// ---------------------------------------------------------------------------
// supportCommand — support conversation command service
//
// Barrel index. Import via the shim at the parent level:
//
//   import * as supportCommand from "@shared/rest/services/support/support-command";
//
//   await supportCommand.assign(input);
//   await supportCommand.sendReply(input);
//   await supportCommand.updateStatus(input);
//   await supportCommand.markDoneWithOverride(input);
//   await supportCommand.retryDelivery(input);
//
// File layout (split from a single 637-line file — 2x the 300-line budget —
// during Stage E of the service-layer rollout. See
// docs/conventions/service-layer-conventions.md):
//
//   _shared.ts  — requireConversation, buildCommandResponse
//   assign.ts   — assign (conversation ownership change)
//   reply.ts    — sendReply + retryDelivery (share sendReplyWithRecordedAttempt)
//   status.ts   — updateStatus + markDoneWithOverride + hasDeliveryEvidence (private)
//
// Command files never import from each other; all shared code lives in
// _shared.ts to keep the coupling graph flat.
// ---------------------------------------------------------------------------

export * from "./assign";
export * from "./close-as-no-action";
export * from "./reply";
export * from "./status";
