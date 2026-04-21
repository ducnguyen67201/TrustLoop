export const PROMPT_INPUT_FORMAT = {
  json: "json",
  toon: "toon",
  auto: "auto",
} as const;

export type PromptInputFormat = (typeof PROMPT_INPUT_FORMAT)[keyof typeof PROMPT_INPUT_FORMAT];

export type ResolvedPromptInputFormat = Exclude<PromptInputFormat, typeof PROMPT_INPUT_FORMAT.auto>;

export type PromptSerializer = (payload: unknown) => string;

export type PromptSerializers = {
  json: PromptSerializer;
  toon: PromptSerializer;
};

export type PromptSerializationResult = {
  content: string;
  format: ResolvedPromptInputFormat;
};
