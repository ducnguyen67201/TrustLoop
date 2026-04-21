export function serializeAsJson(payload: unknown): string {
  return JSON.stringify(payload, null, 2);
}
