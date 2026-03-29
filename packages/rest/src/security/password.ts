import { hash, verify } from "@node-rs/argon2";

const PASSWORD_HASH_OPTIONS = {
  algorithm: 2,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

/**
 * Hash a plaintext password with Argon2id for at-rest credential security.
 */
export async function hashPassword(password: string): Promise<string> {
  return hash(password, PASSWORD_HASH_OPTIONS);
}

/**
 * Verify a plaintext password against a previously generated Argon2id hash.
 */
export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  return verify(passwordHash, password, PASSWORD_HASH_OPTIONS);
}
