#!/usr/bin/env node
// Validate that every docs/concepts/*.md has required YAML frontmatter:
//   summary: non-empty string
//   read_when: list with at least one entry
//   title: non-empty string
//
// Also validate that every concept doc has an "## Invariants" section — matches
// the openclaw convention and the rule in AGENTS.md "Doc Philosophy".
//
// Exits non-zero on any missing field. Runs in CI on docs changes.

import { readFile, readdir } from "node:fs/promises";
import { join, resolve, relative } from "node:path";
import { existsSync } from "node:fs";

const ROOT = resolve(process.cwd());
const CONCEPTS_DIR = resolve(ROOT, "docs/concepts");

const REQUIRED_FIELDS = ["summary", "read_when", "title"];
const REQUIRED_SECTIONS = ["## Invariants", "## Keep this doc honest"];

function parseFrontmatter(body) {
  if (!body.startsWith("---\n")) return null;
  const end = body.indexOf("\n---\n", 4);
  if (end === -1) return null;
  const block = body.slice(4, end);
  // Tiny YAML parser that handles the subset we actually use: string fields and
  // list-of-strings (read_when). Avoids adding a yaml dep for a one-script check.
  const fields = {};
  let currentListKey = null;
  for (const rawLine of block.split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    if (!line.trim()) continue;
    if (/^[a-zA-Z_][\w-]*:/.test(line)) {
      currentListKey = null;
      const idx = line.indexOf(":");
      const key = line.slice(0, idx).trim();
      const value = line.slice(idx + 1).trim();
      if (value === "") {
        fields[key] = [];
        currentListKey = key;
      } else {
        fields[key] = stripQuotes(value);
      }
    } else if (/^\s*-\s+/.test(line) && currentListKey) {
      const item = line.replace(/^\s*-\s+/, "").trim();
      fields[currentListKey].push(stripQuotes(item));
    }
  }
  return { fields, bodyAfter: body.slice(end + 5) };
}

function stripQuotes(v) {
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1);
  }
  return v;
}

async function main() {
  if (!existsSync(CONCEPTS_DIR)) {
    console.log("check-docs-frontmatter: no docs/concepts directory, skipping.");
    return;
  }
  const entries = await readdir(CONCEPTS_DIR, { withFileTypes: true });
  const files = entries
    .filter((e) => e.isFile() && e.name.endsWith(".md"))
    .map((e) => join(CONCEPTS_DIR, e.name));

  if (files.length === 0) {
    console.log("check-docs-frontmatter: no concept docs found, skipping.");
    return;
  }

  const errors = [];

  for (const file of files) {
    const body = await readFile(file, "utf8");
    const parsed = parseFrontmatter(body);
    const rel = relative(ROOT, file);

    if (!parsed) {
      errors.push(`${rel}: missing YAML frontmatter (must start with --- and close with ---)`);
      continue;
    }

    for (const field of REQUIRED_FIELDS) {
      if (!(field in parsed.fields)) {
        errors.push(`${rel}: missing frontmatter field '${field}'`);
        continue;
      }
      const value = parsed.fields[field];
      if (field === "read_when") {
        if (!Array.isArray(value) || value.length === 0) {
          errors.push(`${rel}: 'read_when' must be a non-empty list`);
        }
      } else {
        if (typeof value !== "string" || value.trim() === "") {
          errors.push(`${rel}: '${field}' must be a non-empty string`);
        }
      }
    }

    for (const section of REQUIRED_SECTIONS) {
      if (!parsed.bodyAfter.includes(`\n${section}`)) {
        errors.push(`${rel}: missing required section '${section}'`);
      }
    }
  }

  if (errors.length > 0) {
    console.error(
      `check-docs-frontmatter: ${errors.length} issue${errors.length === 1 ? "" : "s"} found`,
    );
    for (const err of errors) console.error(`  ${err}`);
    process.exit(1);
  }
  console.log(
    `check-docs-frontmatter: scanned ${files.length} concept docs, all have required frontmatter + sections.`,
  );
}

main().catch((err) => {
  console.error("check-docs-frontmatter: unexpected failure");
  console.error(err);
  process.exit(2);
});
