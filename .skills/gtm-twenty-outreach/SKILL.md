---
name: gtm-twenty-outreach
description: Research-first GTM outreach operator for TrustLoop using local Twenty CRM. Use when the user asks to manage founder outreach in Twenty, including "who today", "research A", "researched A", "draft for A", "sent to A", "follow up A", "reply from A", "call booked with A", "find A", auto-sorting outreach tasks, or updating the local GTM CRM from conversation.
---

# GTM Twenty Outreach

Use this skill to run the founder-outreach loop through local Twenty CRM.
Twenty is the source of truth for day-to-day outreach; the Google Sheet is raw
import/history unless the user explicitly asks to inspect it.

## Core Principle

Do not send generic DMs. The loop is:

1. Find the next task.
2. Research the founder/company.
3. Identify why they might feel TrustLoop's support-routing pain.
4. Draft a short personalized opener.
5. Log sent/reply/follow-up state in Twenty.

TrustLoop angle: help early B2B SaaS teams turn messy customer conversations
into routed, answerable support work so founders stop being the invisible
escalation layer.

## Commands

Run commands from the repo root:

```bash
npm run gtm:twenty -- today --limit 20
npm run gtm:twenty -- find "Founder Name"
npm run gtm:twenty -- researched "Founder Name" --notes "..." --draft "..."
npm run gtm:twenty -- sent "Founder Name" --message "..." --follow-up 2026-05-09
npm run gtm:twenty -- reply "Founder Name" --message "..." --next "..." --call
```

If the helper says Twenty is not running, start it with:

```bash
docker compose --profile gtm up -d twenty-server twenty-worker
```

## Natural Language Routing

- "who today", "what should I do today", "next leads": run `today`.
- "find A", "show A": run `find "A"` and summarize the matched record.
- "research A": run `find "A"`, research the founder/company online, then run
  `researched` with concise notes and a crafted opener if the angle is strong
  enough.
- "researched A: ...": treat the user's text as research notes and run
  `researched`; draft or improve the opener if the user did not provide one.
- "draft for A": research if needed, produce the opener, and log it with
  `researched` unless the user says not to update Twenty.
- "sent to A", "sent A", "messaged A": run `sent`. Include the exact message if
  the user provides it; otherwise summarize what was sent. Use a follow-up date
  4 business days later unless the user gives a date or says no follow-up.
- "reply from A": run `reply` with the reply text. If the reply implies a call,
  include `--call`; otherwise include `--next` with the next concrete action.
- "call booked with A": run `reply ... --call` and create a sensible next task
  if useful.

Prefer acting over explaining. If a target match is ambiguous, show the top
matches and ask the user to pick one.

## Research Workflow

For "research A":

1. Run `find "A"` first to get the company URL, LinkedIn URL, founder name, and
   current stage.
2. Use current web research for company/founder facts. Prefer official company
   pages, founder LinkedIn/profile pages, YC/company directories, product docs,
   changelogs, and recent posts.
3. Capture only a few useful facts:
   - what the company sells
   - who likely uses it
   - where support/onboarding/exceptions likely happen
   - why the founder might still be pulled into customer conversations
4. Draft one short opener:
   - specific first line
   - one support-routing question
   - no demo ask
   - no long pitch
5. Run `researched` to update the Twenty task from `Research + draft ...` to
   `Send ...`.

Keep notes honest. Label inferences as inferences. Do not invent customer names,
funding, team size, or product claims.

## Message Style

Default opener shape:

```text
Hey {firstName} - saw {specific product/workflow detail}.

Quick question: when {likely support/onboarding/exception event} comes in today,
are you still close to routing it yourself, or has that moved fully to the team?
```

Keep it warm, short, and founder-to-founder. The goal is insight, not a hard
sell.

## Output Back To User

After updating Twenty, respond with:

- what changed in Twenty
- the target founder/company
- the opener or next action
- any ambiguity or weak research caveat

Do not paste long command logs unless the user asks.
