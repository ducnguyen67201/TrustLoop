import type { PromptStructuredSection } from "../prompt-document";
import {
  PROMPT_INPUT_FORMAT,
  type PromptSerializationResult,
  type PromptSerializers,
  type ResolvedPromptInputFormat,
} from "../prompt-format";
import { serializeAsJson } from "./json-serializer";
import { serializeAsToon } from "./toon-serializer";

const DEFAULT_SERIALIZERS: PromptSerializers = {
  json: serializeAsJson,
  toon: serializeAsToon,
};

export function resolveStructuredSectionFormat(
  section: PromptStructuredSection
): ResolvedPromptInputFormat {
  if (section.preferredFormat === PROMPT_INPUT_FORMAT.auto) {
    return shouldPreferToon(section.payload) ? PROMPT_INPUT_FORMAT.toon : PROMPT_INPUT_FORMAT.json;
  }

  return section.preferredFormat;
}

export function serializeStructuredSection(
  section: PromptStructuredSection,
  serializers: PromptSerializers = DEFAULT_SERIALIZERS
): PromptSerializationResult {
  const selectedFormat = resolveStructuredSectionFormat(section);

  if (selectedFormat === PROMPT_INPUT_FORMAT.json) {
    return {
      content: serializers.json(section.payload),
      format: PROMPT_INPUT_FORMAT.json,
    };
  }

  try {
    return {
      content: serializers.toon(section.payload),
      format: PROMPT_INPUT_FORMAT.toon,
    };
  } catch {
    return {
      content: serializers.json(section.payload),
      format: section.fallbackFormat,
    };
  }
}

export function renderStructuredSection(
  section: PromptStructuredSection,
  serializers: PromptSerializers = DEFAULT_SERIALIZERS
): string {
  const serialized = serializeStructuredSection(section, serializers);
  const language = serialized.format === PROMPT_INPUT_FORMAT.toon ? "toon" : "json";

  return `## ${section.title}\n\nFormat: ${serialized.format.toUpperCase()}\n\n\`\`\`${language}\n${serialized.content}\n\`\`\``;
}

function shouldPreferToon(payload: unknown): boolean {
  if (hasUniformPrimitiveArray(payload)) {
    return true;
  }

  if (hasUniformPrimitiveObjectArray(payload)) {
    return true;
  }

  return isShallowPrimitiveObject(payload);
}

function hasUniformPrimitiveArray(payload: unknown): boolean {
  return Array.isArray(payload) && payload.length > 0 && payload.every(isPrimitive);
}

function hasUniformPrimitiveObjectArray(payload: unknown): boolean {
  if (!Array.isArray(payload) || payload.length === 0) {
    return false;
  }

  if (!payload.every(isRecord)) {
    return false;
  }

  const firstEntry = payload[0];
  if (!isRecord(firstEntry)) {
    return false;
  }

  const keys = Object.keys(firstEntry);
  if (keys.length === 0) {
    return false;
  }

  return payload.every((entry) => {
    const entryKeys = Object.keys(entry);
    if (entryKeys.length !== keys.length) {
      return false;
    }

    if (!keys.every((key) => entryKeys.includes(key))) {
      return false;
    }

    return Object.values(entry).every(isPrimitive);
  });
}

function isShallowPrimitiveObject(payload: unknown): boolean {
  if (!isRecord(payload)) {
    return false;
  }

  return Object.values(payload).every((value) => {
    if (isPrimitive(value)) {
      return true;
    }

    return hasUniformPrimitiveArray(value) || hasUniformPrimitiveObjectArray(value);
  });
}

function isPrimitive(value: unknown): value is string | number | boolean | null {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
