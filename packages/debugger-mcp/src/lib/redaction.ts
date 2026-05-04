const SECRET_NAME_PATTERN = /(TOKEN|SECRET|KEY|PASSWORD|PRIVATE|PEPPER|DATABASE_URL)/i;

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
