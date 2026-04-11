import { z } from "zod";

export const TONE_PRESET = {
  professional: "professional",
  casual: "casual",
  technical: "technical",
  empathetic: "empathetic",
} as const;

export const tonePresetValues = [
  TONE_PRESET.professional,
  TONE_PRESET.casual,
  TONE_PRESET.technical,
  TONE_PRESET.empathetic,
] as const;

export const tonePresetSchema = z.enum(tonePresetValues);

export const toneConfigSchema = z.object({
  defaultTone: tonePresetSchema.default("professional"),
  responseStyle: z.string().nullable().default(null),
  signatureLine: z.string().nullable().default(null),
  maxDraftLength: z.number().int().positive().default(500),
  includeCodeRefs: z.boolean().default(true),
});

export type TonePreset = z.infer<typeof tonePresetSchema>;
export type ToneConfig = z.infer<typeof toneConfigSchema>;
