import type { PromptInputFormat } from "./prompt-format";

export type PromptProseSection = {
  body: string;
  title?: string;
  type: "prose";
};

export type PromptStructuredSection = {
  fallbackFormat: "json";
  payload: unknown;
  preferredFormat: PromptInputFormat;
  rationale: string;
  title: string;
  type: "structured";
};

export type PromptSection = PromptProseSection | PromptStructuredSection;

export type PromptDocument = {
  sections: PromptSection[];
};
