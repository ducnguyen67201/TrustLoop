# First Customer Happy Path MVP

## 1) Goal

Ship a paid-pilot-ready MVP that can handle one complete support loop for Slack:

1. Inbound Slack messages are ingested.
2. Messages are grouped into focused support threads.
3. AI analyzes using code index + Sentry context.
4. Agent reviews/approves draft response.
5. Response is sent back to Slack.
6. Usage is metered and billable per workspace.

## 2) MVP Scope (Core Features)

- Slack auto message grouping into issue-focused threads
- Code indexing + searchable code context
- AI summary/draft response using thread context + code index + Sentry
- Workspace auth + tenant isolation
- Billing + usage metering

## 3) Deliver Order (What To Ship First)

## Deliverable A (Ship first)

Secure multi-workspace auth + Slack ingestion + thread inbox baseline.

Why first:
- Without trust and ingestion, nothing else matters.
- You can already start private pilots and validate data quality.

## Deliverable B

Code indexing + retrieval quality for relevant file/chunk evidence.

Why second:
- This is your core technical differentiation.

## Deliverable C

AI summary + draft reply with human approval path.

Why third:
- Turns raw inbox into measurable time savings.

## Deliverable D

Billing + metering + plan limits.

Why fourth:
- Required to convert pilots into paying customers.

## 4) Detailed Checklist

## A. Auth, Workspace Isolation, and Security (P0)

- [ ] Replace unsigned session cookie with signed/encrypted server session.
- [ ] Enforce authenticated procedures for sensitive mutations.
- [ ] Remove caller-controlled `userId` trust pattern in server routes.
- [ ] Enforce role checks (`OWNER/ADMIN/MEMBER`) for workspace actions.
- [ ] Verify Slack webhook signatures and reject invalid requests.
- [ ] Add idempotency protection for inbound events.
- [ ] Add secret management/rotation policy for workspace integrations.
- [ ] Add audit logging for connection changes and admin actions.

Definition of done:
- Unauthorized user cannot read/write data across workspaces.
- Forged webhook payloads are rejected.
- Sensitive endpoints are no longer publicly mutable.

## B. Slack Ingestion + Thread Grouping (P0)

- [ ] Slack app + events wiring (message events, thread replies, retries).
- [ ] Inbound message normalization schema.
- [ ] Deterministic grouping heuristics (external thread id, reply chain, recency, fingerprint).
- [ ] Manual controls to merge/split/reassign grouped threads.
- [ ] Inbox UI with status, assignee, and thread timeline.
- [ ] Outbound send path from app back to Slack thread/channel.
- [ ] Retry queue for transient Slack API errors.

Definition of done:
- >95% ingestion success in pilot period.
- Thread grouping is stable enough that agents need only occasional manual corrections.

## C. Code Indexing System (P0)

- [ ] Repository connection setup + sync trigger (manual first, webhook optional).
- [ ] Parser/chunker pipeline and metadata extraction.
- [ ] Embedding + keyword index generation.
- [ ] Search endpoint (semantic + keyword + rerank).
- [ ] Basic relevance QA set from real support tickets.
- [ ] Index freshness status visible per repo.

Definition of done:
- For pilot tickets, system returns actionable code context in top results.

## D. AI Analysis + Draft Generation (P0)

- [ ] Thread analysis prompt pipeline (severity, category, component, summary).
- [ ] Sentry context fetch and attach to analysis input.
- [ ] Code search findings attached to analysis input.
- [ ] Draft reply generator with workspace-level prompt/tone controls.
- [ ] Human approval mode (required for MVP).
- [ ] Draft status lifecycle (`GENERATED`, `APPROVED`, `SENT`, `DISMISSED`, `FAILED`).
- [ ] Failure fallback path (escalate to manual handling).

Definition of done:
- Drafts are consistently useful enough that agents keep rather than rewrite at least ~40-60% during pilot.

## E. Billing + Metering (P0 for paid rollout)

- [ ] Choose billing provider (Stripe recommended).
- [ ] Workspace plan model (Starter/Pro/etc) with limits.
- [ ] Meter usage events:
  - [ ] AI analysis runs
  - [ ] AI-generated drafts
  - [ ] Resolved threads (or chosen billing unit)
  - [ ] Optional code-indexed repository count
- [ ] Enforce limits in product.
- [ ] Invoice and payment failure handling.
- [ ] Billing page: usage, current plan, projected cost.

Definition of done:
- You can run a paid pilot invoice cycle with auditable usage data.

## F. Reliability and Operations (P0)

- [ ] Structured logs for ingestion, grouping, analysis, outbound send.
- [ ] Error tracking + alerts for failed workflows.
- [ ] Dead-letter/retry handling for failed jobs.
- [ ] Basic runbook for incidents (Slack down, model timeout, billing webhook failure).
- [ ] Data retention and backup policy for production DB.

Definition of done:
- Team can detect, diagnose, and recover from common failures without ad-hoc debugging.

## 5) Non-Goals For First Customer MVP

- Multi-channel inbox beyond Slack (Discord/in-app/email can be phase 2).
- Fully autonomous customer replies by default.
- Advanced analytics dashboards and executive reporting.
- Enterprise features (SSO/SAML, SOC2 package, advanced SLAs) before first paid pilots.

## 6) Pilot Readiness Gate (Must Pass Before Charging)

- [ ] Security gate passed (authz, webhook verification, tenant isolation).
- [ ] Reliability gate passed (>95% ingest success, stable send/retry behavior).
- [ ] Value gate passed (clear measurable time saved for support/engineering).
- [ ] Billing gate passed (accurate metering and invoice generation).

## 7) Suggested 8-Week Rollout

## Weeks 1-2

- Auth/security hardening + workspace isolation fixes.

## Weeks 3-4

- Slack ingestion, grouping, inbox operations, outbound send.

## Weeks 5-6

- Code indexing quality + AI analysis/draft workflow.

## Weeks 7-8

- Billing/metering + paid design partner onboarding.

## 8) First Customer Success Metrics

- First response time reduced vs baseline.
- Mean time to resolution reduced vs baseline.
- Draft acceptance/edit rate tracked weekly.
- Number of tickets where code evidence was useful.
- Hours saved per week for support + engineering.

---

Use this as the execution source of truth for the first paying customer rollout. If scope expands, update this file and explicitly mark anything moved out of MVP.
