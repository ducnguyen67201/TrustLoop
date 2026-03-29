interface AttemptBucket {
  attempts: number[];
}

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 8;

const loginBuckets = new Map<string, AttemptBucket>();

function nowMs(): number {
  return Date.now();
}

/**
 * Check and consume a login attempt from an in-memory rate-limit bucket.
 */
export function consumeLoginAttempt(bucketKey: string): {
  allowed: boolean;
  retryAfterSeconds: number;
} {
  const current = nowMs();
  const cutoff = current - LOGIN_WINDOW_MS;
  const bucket = loginBuckets.get(bucketKey) ?? { attempts: [] };

  bucket.attempts = bucket.attempts.filter((stamp) => stamp > cutoff);

  if (bucket.attempts.length >= LOGIN_MAX_ATTEMPTS) {
    const oldest = bucket.attempts[0] ?? current;
    const retryAfterSeconds = Math.max(1, Math.ceil((oldest + LOGIN_WINDOW_MS - current) / 1000));

    loginBuckets.set(bucketKey, bucket);
    return {
      allowed: false,
      retryAfterSeconds,
    };
  }

  bucket.attempts.push(current);
  loginBuckets.set(bucketKey, bucket);

  return {
    allowed: true,
    retryAfterSeconds: 0,
  };
}
