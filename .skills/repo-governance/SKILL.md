---
name: repo-governance
description: |
  Repository governance workflow for TrustLoop. Use when the task involves
  repository-level conventions, skill management, keeping AGENTS/CLAUDE context
  tidy, or cleaning up canonical skill mirrors and symlinks.
---

# Repo Governance Skill

Use this skill when the task involves repository-level conventions, skill management, or keeping foundational docs tidy.

## Purpose

- Keep architecture and boundaries consistent over time.
- Keep skills canonical and deduplicated.
- Keep `AGENTS.md` concise and maintainable.

## Canonical Sources

- Canonical skills live in `.skills/`.
- `.codex/skills/` and `.claude/skills/` should contain symlinks to canonical skill folders.
- `AGENTS.md` is canonical for repo-wide agent rules.
- `CLAUDE.md` should be a symlink to `AGENTS.md`.

## When To Apply

Apply this skill when asked to:

- update a skill
- clean up skills
- reorganize AGENTS/CLAUDE context docs
- keep repo conventions tidy

## Skill Update Workflow

1. Locate canonical skill(s) in `.skills/`.
2. Apply edits only in canonical location.
3. Verify `.codex/skills/` and `.claude/skills/` symlinks point to canonical folders.
4. Remove stale duplicate skill copies.
5. Keep naming stable unless user requests renaming.

## AGENTS.md Hygiene Workflow

1. Keep `AGENTS.md` as policy summary, not full implementation spec.
2. If content gets too long, move deep detail into `docs/*.md`.
3. Add/maintain links in `AGENTS.md` to those docs.
4. Remove duplicated guidance and obsolete sections.
5. Keep deployment boundaries and code boundaries explicit and up to date.

## Tidy Rules

- Prefer one canonical source per rule set.
- Prefer links over repeated paragraphs.
- Prefer small, focused docs over one giant catch-all file.
- Keep examples and command snippets minimal and current.

## Completion Checklist

- Canonical skill updated in `.skills/`.
- Symlinks valid in both `.codex/skills/` and `.claude/skills/`.
- `AGENTS.md` clean and linked to supporting docs.
- No redundant copies of the same policy in multiple files.
