#!/usr/bin/env node
// Scan docs/**/*.md and AGENTS.md. For every relative markdown link, verify the
// target file (and optional #anchor) exists. Exits non-zero on any broken link.
//
// Runs in CI via `.github/workflows/check-docs.yml` on any docs/* change.

import { readFile, readdir, stat } from "node:fs/promises";
import { join, resolve, dirname, normalize, relative } from "node:path";
import { existsSync } from "node:fs";

const ROOT = resolve(process.cwd());
const DOC_ROOTS = ["docs", "AGENTS.md", "CLAUDE.md", "CHANGELOG.md", "TODOS.md", "README.md"];

// Matches [text](target) but not ![image](...). Target captured as group 1.
const LINK_RE = /(?<!\!)\[[^\]]*\]\(([^)]+)\)/g;

async function walk(dir) {
  const out = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await walk(p)));
    } else if (entry.isFile() && p.endsWith(".md")) {
      out.push(p);
    }
  }
  return out;
}

async function collectMarkdownFiles() {
  const files = [];
  for (const root of DOC_ROOTS) {
    const abs = resolve(ROOT, root);
    if (!existsSync(abs)) continue;
    const info = await stat(abs);
    if (info.isDirectory()) {
      files.push(...(await walk(abs)));
    } else if (abs.endsWith(".md")) {
      files.push(abs);
    }
  }
  return files;
}

function anchorize(heading) {
  // GitHub-flavored anchor generation: lowercase, spaces → hyphens,
  // strip anything that isn't alphanumeric / hyphen / underscore.
  return heading
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-");
}

async function extractAnchors(path) {
  const body = await readFile(path, "utf8");
  const anchors = new Set();
  for (const line of body.split("\n")) {
    const match = line.match(/^#{1,6}\s+(.+?)\s*$/);
    if (match) anchors.add(anchorize(match[1]));
  }
  return anchors;
}

function isExternal(target) {
  return /^(https?:|mailto:|tel:|ftp:)/i.test(target);
}

function splitAnchor(target) {
  const idx = target.indexOf("#");
  if (idx === -1) return { path: target, anchor: null };
  return { path: target.slice(0, idx), anchor: target.slice(idx + 1) };
}

async function main() {
  const files = await collectMarkdownFiles();
  const errors = [];
  const anchorCache = new Map();

  for (const file of files) {
    const body = await readFile(file, "utf8");
    const fileDir = dirname(file);

    for (const match of body.matchAll(LINK_RE)) {
      const raw = match[1].trim();
      if (!raw || isExternal(raw)) continue;
      if (raw.startsWith("<") && raw.endsWith(">")) continue; // autolink

      const { path: targetPath, anchor } = splitAnchor(raw);

      // Pure anchor (same-file): validate against own anchors
      if (targetPath === "") {
        if (!anchor) continue;
        let anchors = anchorCache.get(file);
        if (!anchors) {
          anchors = await extractAnchors(file);
          anchorCache.set(file, anchors);
        }
        if (!anchors.has(anchor)) {
          errors.push(`${relative(ROOT, file)}: missing anchor #${anchor}`);
        }
        continue;
      }

      // Resolve relative or absolute-to-repo-root paths
      let resolved;
      if (targetPath.startsWith("/")) {
        resolved = resolve(ROOT, "." + targetPath);
      } else {
        resolved = resolve(fileDir, targetPath);
      }

      if (!existsSync(resolved)) {
        errors.push(
          `${relative(ROOT, file)}: broken link → ${raw} (resolved to ${relative(ROOT, resolved)})`,
        );
        continue;
      }

      // If linking to a markdown file with an anchor, validate the anchor
      if (anchor && resolved.endsWith(".md")) {
        let anchors = anchorCache.get(resolved);
        if (!anchors) {
          anchors = await extractAnchors(resolved);
          anchorCache.set(resolved, anchors);
        }
        if (!anchors.has(anchor)) {
          errors.push(
            `${relative(ROOT, file)}: broken anchor → ${raw} (${relative(ROOT, resolved)} has no #${anchor})`,
          );
        }
      }
    }
  }

  if (errors.length > 0) {
    console.error(`check-docs-links: ${errors.length} broken link${errors.length === 1 ? "" : "s"} found`);
    for (const err of errors) console.error(`  ${err}`);
    process.exit(1);
  }
  console.log(`check-docs-links: scanned ${files.length} files, no broken links.`);
}

main().catch((err) => {
  console.error("check-docs-links: unexpected failure");
  console.error(err);
  process.exit(2);
});
