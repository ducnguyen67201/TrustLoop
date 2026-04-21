import { encode } from "@toon-format/toon";

export function serializeAsToon(payload: unknown): string {
  return encode(payload, { keyFolding: "safe" });
}
