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
- screen aggressively before drafting: real company, active product, good ICP
- do not blast generic DMs
- do not invent facts
- keep outreach notes under 200 characters unless the active UI says otherwise
- preserve the user's tone: casual, direct, curious, not salesy
- label weak evidence or inferences in Twenty notes
- skip fakes, parked domains, broken LinkedIn profiles, weak-fit companies, and
  likely competitors for the active buyer-outreach lane
- treat every send as a learning datapoint, not just a completed task

## Batch Commands

Interpret user requests like these:

- "find me next one": process the next viable research task.
- "find 5 founders": work through five companies, adding founders to Twenty.
- "research 10": research ten open tasks and convert them to send-ready tasks.
- "work through all 72": keep iterating until all viable Twenty tasks are
  handled, using checkpoints every 5-10 targets.
- "work through 200": run a long continuous pass up to the requested count,
  stopping if Twenty runs out first.
- "open chrome for the next one": open the next founder LinkedIn profile in Chrome.
- "paste the note": copy the Twenty draft and paste it into the LinkedIn note modal.
- "sent X": mark sent in Twenty and create the follow-up.
- "sent all 5": mark every target from the last reported batch as sent and
  create follow-ups.
- "skip/remove X": mark the active task done, add a skip note, and do not send.
- "make this scientific", "learning machine", "group by hook": create or update
  a Twenty learning log that groups outreach by pain hook, message variant, fit
  score, reply status, and next follow-up.

For large numbers, the batch size is only a progress checkpoint, not the total
limit. Keep going until the requested count is reached, the user stops the run,
LinkedIn/Computer Use hits a safety blocker, or Twenty has no more viable open
tasks.

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
2. Prefer already send-ready `Send ...` tasks if they pass the quality filter,
   then open `Research + draft ...` tasks, then `Find founder ...` tasks.
3. If the task is `Find founder ...`, research founder/CEO/co-founder and add
   the person to Twenty before drafting.
4. Research the company/founder from current sources:
   - official site/docs
   - YC profile or credible startup directory
   - founder LinkedIn/profile
   - product changelog/blog/docs
5. Apply the quality filter before drafting:
   - skip if the domain is parked, for sale, dead, or clearly inactive
   - skip if the LinkedIn profile is broken or cannot be verified
   - skip if the company is fake/low-confidence
   - skip if the company is mostly physical ops or otherwise far from software
     and B2B SaaS workflows
   - skip likely competitors in the AI helpdesk/support-agent lane for active
     buyer outreach; mark them as peer-learning only if useful
   - prefer founder-led B2B SaaS, devtools, workflow, data, auth, ops, billing,
     integration, or AI infrastructure companies
6. Write a concise Twenty research note:
   - what the product does
   - where messy customer/support/workflow exceptions likely happen
   - why the founder may still decide routing/ownership for messy customer issues
   - which parts are inference
7. Draft a note under 200 characters in the user's tone.
8. Run `researched` so the task becomes `Send ...`.
9. If the user wants browser execution, use Computer Use with Chrome:
   - open the founder LinkedIn URL in a Chrome tab
   - click `Connect`
   - click `Add a note`
   - paste the copied note
   - pause if send approval is unclear
   - click send only when the user already approved this named target
10. After send, run `sent` with the exact message and a default follow-up four
   business days later.

## Continuous Run Mode

When the user asks for a large run such as "do 50", "do 100", "do 1-200", or
"keep going until Twenty is empty":

1. Treat the requested number as the target number of handled records, where
   handled means sent, send-ready, skipped, or blocked.
2. Work in checkpoints of 5-10 so the user gets progress reports, but resume
   immediately unless the user asked to pause.
3. If Twenty has enough open tasks, keep cycling through them.
4. If Twenty runs out of viable open tasks, stop there. Do not source new leads
   from the web, the Google Sheet, or repo docs unless the user explicitly asks
   to refill Twenty.
5. Maintain counts in the report:
   - send-ready created
   - LinkedIn notes pasted
   - sent and follow-ups created
   - skipped with reason
   - blocked with reason
   - remaining count toward the user's target

Do not stop just because a checkpoint batch completed. Stop only when the
requested run is complete, the user interrupts, the available data is exhausted,
Twenty runs out of viable open tasks, or a safety/LinkedIn blocker appears.

## Learning Machine Mode

Every outreach run should produce learning, not just activity.

Track these fields for every sent DM in Twenty notes or fields:

- name
- company
- role
- channel (`LinkedIn connect note`, `LinkedIn DM`, `email`, etc.)
- message variant
- pain hook
- date sent
- reply status (`no_reply`, `positive`, `not_me`, `not_now`, `wrong_icp`,
  `call_booked`, `pilot_candidate`)
- fit score from 1-5

Default pain-hook groups:

- `founder_support_router`: founder still decides where customer issues go
- `slack_threads_falling`: Slack support threads fall through cracks
- `bug_handoff_to_engineering`: customer issue needs product/engineering context
- `lost_followup_no_owner`: no clear owner or follow-up path
- `billing_payments`: billing, invoice, dunning, failed payment issues
- `auth_permissions`: auth, roles, access, permissions
- `integrations_data_sync`: integrations, data sync, webhooks, systems of record
- `docs_knowledge`: docs, knowledge base, AI answers, onboarding confusion
- `workflow_ops`: workflow automation, long-running jobs, approvals, ops
- `peer_competitor`: useful learning target but not buyer outreach
- `skip_weak_fit`: fake, dead, broken link, weak ICP, unrelated, or competitor

Default message variants:

- `router_v1`: asks if the founder is still deciding where messy issues go
- `slack_v1`: asks about Slack/customer threads falling through cracks
- `bug_handoff_v1`: asks about product/engineering context and bug handoff
- `followup_owner_v1`: asks about lost follow-up/no owner
- `vertical_specific_v1`: adapts the noun to billing/auth/docs/integration/etc.

For scientific batches, intentionally split by hook:

```text
10 founder_support_router
10 bug_handoff_to_engineering
10 lost_followup_no_owner
```

Do not send one random message 30 times. Keep the message human and specific,
but make the hook/variant explicit in Twenty so replies can be compared later.

Reply handling:

- If they say "yeah this happens", do not jump to demo.
- Ask:

```text
interesting. what usually happens when a customer issue needs product or engineering context?
```

- Then ask:

```text
what part is most annoying: routing, context, bug handoff, or follow-up?
```

Pilot conversion ask:

```text
would you be open to trying this on one real Slack support thread this week? I can do the setup manually.
```

Follow-ups:

- create one follow-up 3-5 days after send, not tomorrow
- keep it short:

```text
wanted to bump this in case it's relevant. i'm trying to understand how small B2B SaaS teams handle support before they have a real support team, especially when customer issues mostly live in Slack.
```

Reporting should include:

- sent count
- hook distribution
- reply counts by hook
- exact pain quotes
- calls booked
- pilot candidates
- what to change in ICP/message/pain thesis next

## Skip/Remove Handling

When the user says a target is fake, weak, unrelated, competitor, broken, or
otherwise not worth sending:

- do not debate unless the user asks for judgment
- add a short Twenty note explaining the skip reason
- mark open `Find founder ...`, `Research + draft ...`, or `Send ...` tasks for
  that opportunity as `DONE`
- keep the opportunity in `NEW` unless the user asks for a different stage
- move immediately to the next viable target

The local helper may not have a `skip` command. If so, update Twenty directly
through the local Twenty Postgres database, following the existing script's
schema patterns. Keep the note plain and specific, for example:

```text
2026-05-05: Skipped for active buyer outreach. Likely competitor/peer-learning, not a design-partner buyer for the current TrustLoop lane.
```

## Batch Sent Handling

When the user says "sent all five" or similar:

- use the last reported batch as the source of truth
- run `sent` for each named target with the exact drafted message
- create default follow-ups four business days later
- if a target was excluded in the user's message, skip/remove it instead
- do not mark older send-ready targets as sent unless the user names them

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

For batch work, adapt the noun to the company:

```text
hey {firstName} - saw {specific product/workflow detail}. curious: when a {billing/auth/integration/docs/workflow/customer} issue gets messy, are you still deciding where it goes?
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

## Night Run Prompt

If the user wants to trigger this later, a good instruction is:

```text
Use gtm-twenty-automate. Work through up to 200 real non-competitor B2B SaaS/devtool targets from Twenty. Twenty is the source of truth; if Twenty runs out of viable open tasks, stop there. Use 5-10 target checkpoints for progress, but do not stop at the checkpoint. Skip fake/dead/weak-fit/broken LinkedIn/competitor records with notes. For each good target, research, update Twenty to Send, open LinkedIn in Chrome with Computer Use, paste the note, pause before final send unless I explicitly approve sending. After I say sent, mark sent and create follow-ups.
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
