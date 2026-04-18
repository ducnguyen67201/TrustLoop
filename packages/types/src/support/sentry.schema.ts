import { z } from "zod";

export const sentryIssueLevelValues = ["fatal", "error", "warning", "info"] as const;

export const sentryIssueSchema = z.object({
  id: z.string(),
  title: z.string(),
  culprit: z.string(),
  level: z.enum(sentryIssueLevelValues),
  count: z.string(),
  firstSeen: z.string(),
  lastSeen: z.string(),
  shortId: z.string(),
  metadata: z.object({
    type: z.string().optional(),
    value: z.string().optional(),
  }),
});

export const sentryExceptionFrameSchema = z.object({
  filename: z.string().optional(),
  function: z.string().optional(),
  lineNo: z.number().nullable().optional(),
  colNo: z.number().nullable().optional(),
  context: z.array(z.tuple([z.number(), z.string()])).optional(),
});

export const sentryEventSchema = z.object({
  eventID: z.string(),
  title: z.string(),
  entries: z.array(
    z.object({
      type: z.string(),
      data: z.unknown(),
    })
  ),
  tags: z.array(z.object({ key: z.string(), value: z.string() })),
  context: z.record(z.string(), z.unknown()).optional(),
});

export const sentryContextSchema = z.object({
  issues: z.array(sentryIssueSchema),
  latestEvents: z.record(z.string(), sentryEventSchema),
  userEmail: z.string(),
  fetchedAt: z.string(),
});

export type SentryIssueLevel = (typeof sentryIssueLevelValues)[number];
export type SentryIssue = z.infer<typeof sentryIssueSchema>;
export type SentryExceptionFrame = z.infer<typeof sentryExceptionFrameSchema>;
export type SentryEvent = z.infer<typeof sentryEventSchema>;
export type SentryContext = z.infer<typeof sentryContextSchema>;
