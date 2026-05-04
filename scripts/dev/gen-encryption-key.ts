#!/usr/bin/env tsx
import { randomBytes } from "node:crypto";

const key = randomBytes(32).toString("base64");

console.log("Generated 32-byte AES-256 key (base64):\n");
console.log(`  ${key}\n`);
console.log("Add to .env (or your secret manager):\n");
console.log(`  SECRET_ENCRYPTION_KEY=${key}\n`);
console.log("Run with: npx tsx scripts/dev/gen-encryption-key.ts");
