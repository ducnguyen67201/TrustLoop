---
name: gtm-twenty-automate
description: Batch GTM outreach operator for TrustLoop using local Twenty CRM and Computer Use in Chrome. Use when the user asks to work through many outreach tasks, find X founders, research companies, create or update Twenty people/opportunities/tasks/notes, open LinkedIn profiles in Chrome, paste connection notes, mark sent, create follow-ups, or keep moving through the queue.
---

# GTM Twenty Automate

Use this skill for batch founder outreach. It builds on `gtm-twenty-outreach`
but runs a longer loop: find founders, research companies, update Twenty, open
Chrome/LinkedIn, paste notes, mark sent, and move to the next task.

## Operating Mode

Twenty is the source of truth. Chrome is the execution surface for LinkedIn.
Keep sends human-approved unless the user explicitly says to send for a named
target.

Default posture:

- automate research, CRM updates, note copying, and browser setup
- treat cold DM as one lane in founder-led sales, not the whole GTM system
- do not blast generic DMs
- do not invent facts
- keep outreach notes under 200 characters unless the active UI says otherwise
- preserve the user's tone: casual, direct, curious, not salesy
- label weak evidence or inferences in Twenty notes

## Batch Commands

Interpret user requests like these:

- "find me next one": process the next viable research task.
- "find 5 founders": work through five companies, adding founders to Twenty.
- "research 10": research ten open tasks and convert them to send-ready tasks.
- "work through all 72": process in batches of 5-10, pausing between batches.
- "open chrome for the next one": open the next founder LinkedIn profile in Chrome.
- "paste the note": copy the Twenty draft and paste it into the LinkedIn note modal.
- "sent X": mark sent in Twenty and create the follow-up.

For large numbers, process in batches. After each batch, summarize completed,
blocked, skipped, and next suggested target.

## Local Tools

Run from the repo root:

```bash
node business/gtm/scripts/twenty-outreach.mjs today --limit 20
node business/gtm/scripts/twenty-outreach.mjs find "Founder Name"
node business/gtm/scripts/twenty-outreach.mjs copy "Founder Name"
node business/gtm/scripts/twenty-outreach.mjs researched "Founder Name" --notes "..." --draft "..."
node business/gtm/scripts/twenty-outreach.mjs sent "Founder Name" --message "..." --follow-up 2026-05-11
node business/gtm/scripts/twenty-outreach.mjs reply "Founder Name" --message "..." --next "..." --call
```

If `npm run gtm:twenty` exists locally, that wrapper is fine too. Prefer the
direct `node` command because the helper may be uncommitted local work.

If Twenty is not running:

```bash
docker compose --profile gtm up -d twenty-server twenty-worker
```

## Batch Workflow

For each target:

1. Pull the queue with `today`.
2. Prefer open `Research + draft ...` tasks over `Find founder ...` tasks.
3. If the task is `Find founder ...`, research founder/CEO/co-founder and add
   the person to Twenty before drafting.
4. Research the company/founder from current sources:
   - official site/docs
   - YC profile or credible startup directory
   - founder LinkedIn/profile
   - product changelog/blog/docs
5. Write a concise Twenty research note:
   - what the product does
   - where messy customer/support/workflow exceptions likely happen
   - why the founder may still decide routing/ownership for messy customer issues
   - which parts are inference
6. Draft a note under 200 characters in the user's tone.
7. Run `researched` so the task becomes `Send ...`.
8. If the user wants browser execution, use Computer Use with Chrome:
   - open the founder LinkedIn URL in a Chrome tab
   - click `Connect`
   - click `Add a note`
   - paste the copied note
   - pause if send approval is unclear
   - click send only when the user already approved this named target
9. After send, run `sent` with the exact message and a default follow-up four
   business days later.

## Computer Use Rules

Use the `Computer Use` plugin for Chrome UI work.

Before interacting with Chrome each turn, call `get_app_state` for
`com.google.Chrome`.

Prefer opening a new tab for LinkedIn profile work unless the current tab is
already the exact LinkedIn flow being continued.

Do not use Computer Use for Codex itself. If the active Chrome tab is not the
right page, navigate Chrome to the target LinkedIn URL.

Safe LinkedIn flow:

1. Open founder LinkedIn URL in Chrome.
2. Locate the `Connect` button.
3. If LinkedIn shows `Follow`, `More`, or another variant, inspect before
   clicking.
4. Click `Add a note`.
5. Paste the note from Twenty or from the current drafted message.
6. Check the counter is under the limit.
7. Stop before the final send unless the user said `send`, `sent`, or otherwise
   clearly approved the named target.

If a modal, captcha, login wall, ambiguity, or Premium/limit warning appears,
stop and report what is blocking.

## Founder Sourcing Into Twenty

When adding a missing founder:

- Use founder, co-founder, CEO, or founder/CEO as target.
- Prefer one high-confidence target over multiple weak guesses.
- Add or update the Twenty `Person`.
- Link the person to the company, opportunity, task target, and future notes.
- Rename task from `Find founder for Company` to
  `Research + draft Founder at Company`, then continue.

If confidence is low, leave the task as `Find founder ...`, add a note with the
candidate list, and ask the user to pick.

## Message Style

Keep it flexible, not template-locked. Sound like Duc:

- lowercase is okay
- direct and a little casual
- one real product detail
- one curious question
- no demo ask
- no pitch paragraph

The first DM should ask about their current reality, not TrustLoop. Prefer
routing/ownership language over "escalation."

Best first DM shape:

```text
hey {firstName} - saw {specific company detail}. curious: when messy customer issues come through Slack/support, are you still the person deciding where they go, or is that fully off your plate now?
```

If yes:

```text
makes sense. what usually makes an issue messy enough that it still reaches you?
```

Then:

```text
would it be useful if I helped map that flow and turn the recurring cases into something routed/answerable over a 2-week pilot?
```

If no:

```text
got it, that's helpful. who owns that flow now: support, CS, eng, or someone else?
```

Vary the wording when the research suggests a better angle, but keep the ladder:

```text
pain question -> reply -> call -> map workflow -> concierge pilot -> paid pilot -> quote/referral/investor proof
```

## Reporting

After a batch, report:

- send-ready targets created
- LinkedIn tabs opened or notes pasted
- sent targets marked in Twenty
- follow-ups created
- blocked/skipped targets and why
- next recommended batch size

Keep the report short. The user's goal is momentum.
