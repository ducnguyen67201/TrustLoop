// PII / credential redaction applied at capture time so raw secrets never reach
// the wire or the database. The schema-side sanitizer in packages/types/src/
// session-replay/session-evidence.schema.ts (sanitizeText / sanitizeUrl) runs
// the same patterns when building operator-facing evidence — keep these two
// files in sync. Divergence here means a leak slips past the SDK net and only
// gets caught on render, by which point it has already been persisted.

const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const BEARER_BASIC_PATTERN = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi;
const SECRET_QUERY_PATTERN = /\b(token|secret|password|authorization|api[_-]?key)=([^&\s]+)/gi;
const HEX_RUN_PATTERN = /\b[A-Fa-f0-9]{32,}\b/g;

export function redactText(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .replace(EMAIL_PATTERN, "[email]")
    .replace(BEARER_BASIC_PATTERN, "$1 [redacted]")
    .replace(SECRET_QUERY_PATTERN, "$1=[redacted]")
    .replace(HEX_RUN_PATTERN, "[redacted]");
}

export function redactUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;

  try {
    if (trimmed.startsWith("/")) {
      const parsed = new URL(trimmed, "https://trustloop.local");
      return redactText(parsed.pathname);
    }
    const parsed = new URL(trimmed);
    return redactText(`${parsed.origin}${parsed.pathname}`);
  } catch {
    const withoutQuery = trimmed.split(/[?#]/, 1)[0] ?? trimmed;
    return redactText(withoutQuery);
  }
}
