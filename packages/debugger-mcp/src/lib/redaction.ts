const SECRET_NAME_PATTERN = /(TOKEN|SECRET|KEY|PASSWORD|PRIVATE|PEPPER|DATABASE_URL)/i;
const SECRET_VALUE_PATTERNS = [
  /\btli_[A-Za-z0-9_=-]{8,}\b/g,
  /\btlk_[A-Za-z0-9_=-]{8,}\b/g,
  /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g,
  /\bsk-[A-Za-z0-9_-]{20,}\b/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}\b/gi,
  /\b(postgresql|postgres|mysql|redis):\/\/[^\s"']+/gi,
] as const;

export function redactValue(key: string, value: string | undefined): string | null {
  if (!value) return null;
  if (SECRET_NAME_PATTERN.test(key)) return "<redacted>";
  if (key.endsWith("_URL")) return redactUrl(value);
  return value;
}

export function redactUrl(value: string): string {
  try {
    const url = new URL(value);
    url.username = url.username ? "<redacted>" : "";
    url.password = url.password ? "<redacted>" : "";
    return url.toString();
  } catch {
    return "<invalid-url>";
  }
}

export function getUrlHostPort(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.port ? `${url.hostname}:${url.port}` : url.hostname;
  } catch {
    return "<invalid-url>";
  }
}

export function redactFreeformText(value: string): string {
  return SECRET_VALUE_PATTERNS.reduce(
    (redacted, pattern) => redacted.replace(pattern, "<redacted>"),
    value
  );
}
