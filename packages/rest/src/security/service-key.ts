import { randomBytes, timingSafeEqual } from "node:crypto";

const SERVICE_KEY_PREFIX = "tli";
const SERVICE_KEY_SECRET_BYTES = 40;

export function generateServiceKey(): string {
  const secret = randomBytes(SERVICE_KEY_SECRET_BYTES).toString("hex");
  return `${SERVICE_KEY_PREFIX}_${secret}`;
}

export function isServiceKeyFormat(token: string): boolean {
  return token.startsWith(`${SERVICE_KEY_PREFIX}_`);
}

export function verifyServiceKey(presented: string, expected: string): boolean {
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);

  if (a.length !== b.length) {
    return false;
  }

  return timingSafeEqual(a, b);
}
