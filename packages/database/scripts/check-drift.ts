import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const PREFIX = "[db:check-drift]";

const AUTH_MARKERS = [
  "P1000",
  "P1001",
  "P1002",
  "P1003",
  "P1017",
  "ECONNREFUSED",
  "Authentication failed",
  "Can't reach database server",
  "getaddrinfo",
];

const CLEAN_MARKERS = ["Database schema is up to date", "No pending migrations to apply"];

const AUTH_REMEDIATION = `${PREFIX} Cannot reach the database.

Fix:
  - Check DATABASE_URL in your .env (or run via: npm run doppler:dev).
  - Start local Postgres: docker compose up -d postgres
  - Verify the database exists and credentials are correct.

Then re-run your command.`;

const DRIFT_REMEDIATION = `${PREFIX} Database schema drift or pending migrations detected.

Fix:
  npm run db:migrate
  npm run db:generate

Then re-run your command.`;

const UNKNOWN_REMEDIATION = `${PREFIX} prisma migrate status failed with an unrecognized error (see above).

Fix:
  - Inspect the stderr above for the underlying cause.
  - Common causes: missing prisma client, broken schema, unreadable prisma.config.ts.`;

function maskDatabaseUrl(): string {
  const raw = process.env.DATABASE_URL;
  if (!raw) {
    return "DATABASE_URL: <not set in process.env; prisma will fall back to its own .env resolution>";
  }
  try {
    const parsed = new URL(raw);
    const user = parsed.username ?? "";
    const maskedUser = user ? `${user.slice(0, 3)}***` : "***";
    return `DATABASE_URL: ${parsed.protocol}//${maskedUser}:***@${parsed.hostname}:${parsed.port}${parsed.pathname}`;
  } catch {
    return "DATABASE_URL: <set, unparseable>";
  }
}

function runPrismaStatus(databaseDir: string): {
  status: number | null;
  stdout: string;
  stderr: string;
} {
  const result = spawnSync("npx", ["prisma", "migrate", "status"], {
    cwd: databaseDir,
    env: process.env,
    encoding: "utf8",
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function containsAny(haystack: string, needles: readonly string[]): boolean {
  return needles.some((needle) => haystack.includes(needle));
}

function firstLines(text: string, count: number): string {
  return text.split("\n").slice(0, count).join("\n");
}

function main(): void {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const databaseDir = path.resolve(scriptDir, "..");

  console.log(`${PREFIX} ${maskDatabaseUrl()}`);

  const { status, stdout, stderr } = runPrismaStatus(databaseDir);
  const combined = `${stdout}\n${stderr}`;

  if (status === 0 && containsAny(stdout, CLEAN_MARKERS)) {
    console.log(`${PREFIX} schema is up to date.`);
    process.exit(0);
  }

  if (containsAny(combined, AUTH_MARKERS)) {
    console.error(AUTH_REMEDIATION);
    process.exit(1);
  }

  if (status !== 0) {
    console.error(firstLines(combined.trim(), 20));
    console.error("");
    console.error(DRIFT_REMEDIATION);
    process.exit(1);
  }

  console.error(combined);
  console.error(UNKNOWN_REMEDIATION);
  process.exit(1);
}

main();
