// ---------------------------------------------------------------------------
// sessionCorrelation — support session correlation service
//
// Barrel index. Import as a namespace:
//
//   import * as sessionCorrelation from "@shared/rest/services/support/session-correlation";
//
//   const emails = sessionCorrelation.extractEmails(events);
//   const match = await sessionCorrelation.findByEmails({ workspaceId, emails });
//   const digest = sessionCorrelation.compileDigest(match.record, match.events);
//
// File layout (split from a single 333-line file during Stage E of the
// service-layer rollout — see docs/conventions/service-layer-conventions.md):
//
//   extract.ts  — pure email extraction (no DB)
//   digest.ts   — session digest compilation (pure)
//   find.ts     — DB correlation query
// ---------------------------------------------------------------------------

export * from "./extract";
export * from "./digest";
export * from "./find";
