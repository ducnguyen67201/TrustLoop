# Slack Functionality: Files + Identity (P0) Focused Engineering Spec

## 1) Purpose

Define the implementation spec for completing the Slack adapter so the TrustLoop
inbox is a real operator tool, not a notifier next to a second Slack tab:

1. mirror inbound customer files (images, PDFs, any mimetype) into TrustLoop storage
2. deliver outbound agent replies with real file uploads to Slack
3. show the human agent's name and avatar on outbound Slack messages
4. resolve and display the customer's real name and avatar in the inbox
5. survive Slack Connect edge cases, scope upgrades, and workspace reinstalls without silent degradation

This spec builds on top of `docs/domains/support/spec-slack-ingestion-thread-grouping-p0.md`
and `docs/domains/support/spec-slack-oauth-install-flow.md`. It does not change the
canonical ingestion pipeline; it extends the adapter contracts and the inbox UI layer.

## 2) Inputs and Locked Review Decisions

This spec incorporates approved decisions from `/office-hours`, `/plan-eng-review`,
`/plan-design-review`, and a Codex cold-read cross-model review.

Core lock-ins:

- **Two pillars, not six features.** Files (inbound mirror + outbound upload) and
  Identity (customer profile cache + outbound agent identity) share infrastructure.
  Ship as a bundled unit.
- **Cloudflare R2 for blob storage.** S3-compatible SDK, zero egress fees,
  decided (not open).
- **Mirror-to-R2 over thin-proxy.** A support platform whose chat history is its
  product cannot depend on Slack file URL lifetime.
- **Workflow-dispatches-activity pattern** for the file mirror, matching the
  existing `support.workflow.ts:36` `startChild` pattern. Temporal activities
  cannot dispatch activities; the workflow is the dispatcher.
- **Customer profile key on `(installationId, externalUserId)`.** A single
  TrustLoop workspace can connect multiple Slack teams; `U12345` is only
  meaningful within an install boundary.
- **First-party browser auth for attachment endpoints.** Session-cookie auth
  under `/api/support/attachments/*`, **not** `/api/rest/*` (which is reserved
  for service-key and workspace-API-key auth).
- **Single-message atomicity for outbound** via Slack's `initial_comment`
  parameter on `files.completeUploadExternal`, with a documented fallback
  path when the unified upload fails.
- **AI draft / auto-send flow is out of scope.** Tracked on a separate branch.
- **Reactions (`reactions.add`) are out of scope.** Inline `:emoji:` already works
  via text passthrough.

### Dependency: install-identity pre-work PR (P0 blocker)

The current `completeInstall` in `packages/rest/src/services/support/slack-oauth-service.ts`
upserts `SupportInstallation` rows on `providerInstallationId = appId`, where
`appId` is the Slack App ID — a constant across all workspaces that install
TrustLoop's Slack app. Two TrustLoop workspaces installing the same Slack app
collide on the same row, clobbering each other.

This spec depends on `providerInstallationId` being scoped per workspace + team
(e.g. `${appId}:${teamId}`). The fix **must land as a separate pre-work PR**
before the Slack Functionality PR lands. All downstream design decisions (customer
profile key, `oauthScopes` tracking, reinstall banner, profile cache ownership)
assume install rows are per-workspace-per-team.

## 3) Problem Statement

The Slack adapter is half-built and breaking real customer workflows in four
concrete ways:

1. **Inbound files are dropped on the floor.** `event-normalizer.ts` extracts
   text-only fields; the `files[]` array on the Slack event is never read.
   Agents see "[image]" or nothing where the screenshot should be.

2. **Outbound replies cannot attach files.** `slack-delivery-service.ts` renders
   `SupportAttachment[]` as plain-text URL footer lines. These are not real
   Slack file uploads.

3. **Outbound replies look like they are from a bot.** `sendThreadReply` calls
   `chat.postMessage` with the bot token and no `username`/`icon_url` customization.
   Every agent message appears as "TrustLoop App" regardless of which human typed it.

4. **Customer identity is missing in the inbox.** The inbox surfaces
   `authorExternalId` (raw Slack user ID like `U12345`) with no name or avatar.

## 4) Architecture

### 4.1) Feature coverage matrix

| # | Feature | Addressed in |
|---|---|---|
| 1 | Inbound images visible in inbox | §4.4 Inbound file flow (image mimetype rendering) |
| 2 | Inbound PDFs and non-image files in inbox | §4.4 Inbound file flow (download row rendering) |
| 3 | Outbound images (agent reply with image) | §4.5 Outbound file flow |
| 4 | Outbound PDFs and any file | §4.5 Outbound file flow (same path, any mimetype) |
| 5 | Agent name and avatar on outbound Slack messages | §4.6 Outbound agent identity |
| 6 | Customer name and avatar in TrustLoop inbox | §4.7 Customer identity in inbox |
| 7 | Emojis | Out of scope — text passthrough already works |

### 4.2) Object storage layer (new)

- **Provider:** Cloudflare R2. S3-compatible, zero egress fees. Provisioning the
  R2 account and bucket is a pre-merge deploy task.
- **Bucket layout:** `support-files/{workspaceId}/{conversationId}/{attachmentId}/{filename}` —
  workspace-scoped for multi-tenancy, conversation-scoped for cleanup on delete.
- **Access:** All reads go through `GET /api/support/attachments/:id`, a Next.js
  route handler in `apps/web/src/app/api/support/attachments/[id]/route.ts`, **not**
  under `/api/rest/*`. Per the REST API Classification in `AGENTS.md`, `/api/rest/*`
  is reserved for service-key and workspace-API-key auth (external integrations),
  neither of which works for a first-party browser `<img>` tag. This endpoint uses
  the existing session-cookie auth pattern (verify session → resolve userId → check
  workspace membership via `memberships.exists(userId, workspaceId)`). The endpoint
  returns a **302 redirect to a presigned R2 URL with 5-minute TTL**. Bucket URLs
  are never exposed directly.
- **Caching headers:** the 302 response sets `Cache-Control: private, max-age=240`
  (4 minutes, one minute shy of the presigned URL's TTL). This lets the browser
  cache the redirect for the same conversation re-render, avoiding a round trip
  per attachment on every sheet open, without ever caching past the presigned URL's expiry.
- **Outbound upload endpoint:** `POST /api/support/attachments/upload`, same
  session-cookie auth pattern.
- **Env contracts (new in `packages/env`):**
  - `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_SUPPORT_FILES`
  - Validated via Zod at boot.
- **Service module:** `packages/rest/src/services/support/support-attachment-service.ts`,
  namespace import as `supportAttachments`. Wraps the S3 SDK client pointed at R2's
  S3 endpoint. Never called directly from routers.
- **Dependencies:** `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner` (3.x)
  added to `packages/rest/package.json`. Scoped to `packages/rest` so the queue
  worker picks them up transitively.
- **shadcn components:** install `avatar` and `sonner` via `npx shadcn@latest add avatar sonner`.
  Configure Toaster at the root layout with `position="bottom-right"` and `richColors=false`
  to match DESIGN.md's calm aesthetic.
- **Retention:** No auto-delete in v1. Attachments live as long as the conversation does.
- **Storage cleanup on soft-delete:** The soft-delete cascade extension marks the DB
  row deleted but does not delete R2 objects. A Temporal scheduled sweeper
  `support-attachment-gc.workflow.ts` runs nightly, finds `SupportMessageAttachment`
  rows where `deletedAt IS NOT NULL AND deletedAt < now() - 7 days`, and hard-deletes
  the R2 object plus the row. The 7-day grace allows undo before the bytes vanish.

### 4.3) Database schema

New migration in `packages/database/prisma/schema/support.prisma` plus a raw-SQL
follow-up migration for partial unique indexes. Per the soft-delete rules in
`AGENTS.md`, `@@unique` drives TypeScript types; the actual DB constraint is a
partial unique index `WHERE deletedAt IS NULL` applied via raw SQL.

```prisma
model SupportMessageAttachment {
  id                String              @id @default(cuid())
  workspaceId       String
  conversationId    String
  eventId           String?             // FK; nullable for outbound drafts pre-send
  provider          SupportProvider
  providerFileId    String?             // nullable until Slack completeUploadExternal returns
  storageKey        String              // R2 object key, known at row creation
  mimeType          String
  sizeBytes         Int
  originalFilename  String?
  title             String?
  direction         SupportAttachmentDirection  // INBOUND or OUTBOUND
  uploadState       SupportAttachmentUploadState @default(PENDING)
  errorCode         String?
  lifecyclePolicy   SupportAttachmentLifecyclePolicy @default(ARCHIVE_NEVER)
  deletedAt         DateTime?
  workspace         Workspace           @relation(fields: [workspaceId], references: [id], onDelete: Restrict)
  conversation      SupportConversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  event             SupportConversationEvent? @relation(fields: [eventId], references: [id], onDelete: Cascade)
  createdAt         DateTime            @default(now())
  updatedAt         DateTime            @updatedAt

  @@index([conversationId, createdAt])
  @@index([workspaceId, uploadState])
  // TYPE GENERATION ONLY: DB uses partial unique index
  // (WHERE deletedAt IS NULL AND providerFileId IS NOT NULL).
  @@unique([provider, providerFileId, direction])
}

enum SupportAttachmentDirection { INBOUND OUTBOUND }
enum SupportAttachmentUploadState { PENDING UPLOADED FAILED }
enum SupportAttachmentLifecyclePolicy { ARCHIVE_NEVER ARCHIVE_AFTER_90D ARCHIVE_AFTER_1Y }

model SupportCustomerProfile {
  id              String              @id @default(cuid())
  workspaceId     String              // denormalized for bulk-query convenience
  installationId  String              // load-bearing: encodes (workspace, provider, team)
  provider        SupportProvider
  externalUserId  String              // Slack U12345 — meaningful only within the install's team
  displayName     String?
  realName        String?
  avatarUrl       String?             // Slack CDN URL, refreshed on TTL miss
  isBot           Boolean             @default(false)
  isExternal      Boolean             @default(false) // Slack Connect / shared channel guest
  profileFetchedAt DateTime           @default(now())
  deletedAt       DateTime?
  workspace       Workspace           @relation(fields: [workspaceId], references: [id], onDelete: Restrict)
  installation    SupportInstallation @relation(fields: [installationId], references: [id], onDelete: Cascade)
  createdAt       DateTime            @default(now())
  updatedAt       DateTime            @updatedAt

  // TYPE GENERATION ONLY: DB uses partial unique index (WHERE deletedAt IS NULL).
  // Key on (installationId, externalUserId) — a single workspace can connect
  // multiple Slack teams and U12345 means different people in different teams.
  @@unique([installationId, externalUserId])
  @@index([workspaceId, provider])
  @@index([installationId])
}
```

Key schema decisions:

- `providerFileId` is nullable. Outbound rows are created at upload time with only
  `storageKey`; `providerFileId` is populated after `files.completeUploadExternal`
  returns. The partial unique index excludes NULLs.
- `SupportCustomerProfile` is keyed on `(installationId, externalUserId)` because
  a single workspace can connect multiple Slack teams.
- `isBot` and `isExternal` flags let the UI distinguish customers from other
  actors and handle Slack Connect guests explicitly.
- `lifecyclePolicy` column is written as `ARCHIVE_NEVER` in v1 but exists so a
  later tiering job does not require a migration.
- `SupportConversationEvent` gets a relation: `attachments SupportMessageAttachment[]`.
- `SupportConversation` gets a relation to cascade delete attachments.
- `SupportInstallation` needs inverse relations added in the same migration:
  `customerProfiles SupportCustomerProfile[]`. Prisma enforces bidirectional
  relations.
- `SupportInstallation` gets a new typed column `oauthScopes String[] @default([])`
  populated on every OAuth install from the callback's `authed_user.scope` response.
  The reinstall banner queries it directly:
  `SELECT id FROM "SupportInstallation" WHERE NOT ('chat:write.customize' = ANY(oauthScopes))`.
  Existing installs get an empty array on migration and surface the banner on first
  load (expected — they do need reinstall).
- No changes to the `detailsJson` blob format; attachments now have their own
  queryable rows.

### 4.4) Inbound file flow

- **Event-normalizer extension** (`apps/queue/src/domains/support/adapters/slack/event-normalizer.ts`):
  add a `rawFiles: SlackRawFile[]` field to `NormalizedSlackMessageEvent`, populated
  from `event.files[]`. Shape:
  `{ id, name, mimetype, size, url_private_download, is_external, permalink, file_access }`.
  Also handle `event.subtype === "file_share"` and `event.subtype === "message_changed"`
  where `event.message.files` carries the payload (Slack re-emits `message_changed`
  when users edit a message to add files).

- **Drop-rule carve-out** (`apps/queue/src/domains/support/support.activity.ts`):
  the current `DROPPED_AUTHOR_ROLES` set drops bot-authored and system-subtype events
  before any pipeline logic, including `message_changed`. This spec adds a targeted
  carve-out: if `subtype === "message_changed"` AND `event.message.files` is
  non-empty, the event is kept and reclassified using `event.message.user`. Pure
  system events (edits without files, channel join/leave, topic changes) still drop.
  Bot-authored files remain out of scope for v1.

- **Ingress activity** (`apps/queue/src/domains/support/support.activity.ts`):
  inside the existing `prisma.$transaction` block (between the
  `supportConversationEvent.create` and the `supportIngressEvent.update`), for
  each raw file insert a `SupportMessageAttachment` row with `uploadState: PENDING`
  and `storageKey` computed up front. `runSupportPipeline` then returns the new
  IDs as `pendingAttachmentIds: string[]` on `SupportWorkflowResult`. The
  `supportInboxWorkflow` (at `support.workflow.ts`) iterates those IDs after the
  activity completes and dispatches `mirrorSupportAttachment` as a proxied
  activity per file — each file gets its own activity invocation so Temporal can
  retry individual failures without re-downloading successful ones. **Activities
  cannot dispatch activities in Temporal — the mirror dispatch lives in the
  workflow, not inside the ingress activity.**

- **Idempotency replay (regression-critical):** `runSupportPipeline` has an
  early-return branch for events already processed. After this change it must
  also return `pendingAttachmentIds` from the already-mirrored state — otherwise
  a Slack webhook retry after a transient failure loses the attachment pointers
  and the workflow dispatches nothing. This is covered by an explicit regression
  test.

- **New activity file** (`apps/queue/src/domains/support/support-attachment-mirror.activity.ts`):
  - Exported function: `mirrorSupportAttachment(input: MirrorSupportAttachmentInput): Promise<MirrorSupportAttachmentResult>`
  - Registered in `apps/queue/src/runtime/activities` under the `support` domain.
  - Flow:
    1. Resolve the bot token via `supportInstallation.getById(installationId)`.
    2. **Slack Connect stub check:** if the persisted file metadata has
       `file_access === "check_file_info"` (common for files shared in Slack
       Connect external shared channels), call `files.info({ file: fileId })`
       via the bot token first to get the real file object. This requires
       the `files:read` scope. The `url_private_download` from the stub is
       unusable; only after this branch do we have a downloadable URL.
    3. `GET url_private_download` with `Authorization: Bearer <botToken>`, streaming.
    4. Stream bytes to R2 via `supportAttachments.uploadStream(storageKey, stream, mimeType)`.
    5. On success: `UPDATE SupportMessageAttachment SET uploadState = 'UPLOADED', updatedAt = now() WHERE id = $1`.
    6. On transient failure (network timeout, Slack 5xx, R2 5xx): throw
       `TransientExternalError`, Temporal retries up to 3x with exponential
       backoff, row stays `PENDING`. R2 retries are idempotent because
       `storageKey` is deterministic.
    7. On permanent failure (Slack 403 `not_in_channel` / `file_not_found`, 404):
       throw `PermanentExternalError`, activity transitions the row to `FAILED`
       with `errorCode` set, writes a `SupportDeadLetter` record, and the UI
       shows a fallback link instead of silently dropping the file.
- **Timeouts:** 30s per file download, 2min total activity timeout per file.
- **Size cap v1:** 100MB (inbound). Larger files are recorded with
  `uploadState: FAILED` and `errorCode: "size_exceeded"` and shown as
  "File too large to preview — view in Slack [permalink]".

### 4.5) Outbound file flow

- **UI composer IA** (inside the shadcn Sheet composer region):

  ```
  ┌─ composer region ─────────────────────────────────────┐
  │ [Textarea — type your reply...]                       │
  │                                                        │
  │ [attached file strip — visible only when files exist] │
  │   [file-row + remove×] [file-row + remove×] ...       │
  │                                                        │
  │ [Attach files] [Send →]                               │
  └────────────────────────────────────────────────────────┘
  ```

- **Drop zone empty state:** invisible by default. No dashed rectangle, no cloud
  icon, no "drop files here" placeholder. Per DESIGN.md "subtraction default" —
  empty drop zones are visual clutter in an operator tool.
- **Drag-over state:** when a file drag enters the composer region, the composer's
  existing border transitions to `--primary` (yellow, 2px, 120ms ease-out), and
  a centered overlay on the textarea shows "Drop to attach" in muted foreground.
- **"Attach files" button** in the action row provides click-to-upload parity
  for keyboard users and screen readers. `variant="ghost"` so yellow `--primary`
  stays reserved for Send.
- **Attached-file strip:** visible only when files are present. Each row:
  `{mimetype icon} {filename} · {human size} [× remove]`, stacked vertically.
  Max 5 rows; 6th file drop shows a Sonner toast "Max 5 files per reply".
- **Upload in progress:** each file row shows a thin 2px progress bar as its
  bottom border, filling left-to-right as the R2 upload streams.
- **Upload error:** filename turns destructive foreground, `× remove` becomes
  `lucide RotateCw` retry icon, progress bar turns destructive-colored.
- **Size validation (outbound):** 25MB cap per file for v1 to keep the composer
  UX responsive. Outbound and inbound caps are intentionally asymmetric.
- **Accepted file types:** the `<input type="file">` uses
  `accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.md,.zip"`
  to steer the native picker. Drag-drop accepts any mimetype; invalid mimetypes
  are rejected client-side. Folders cannot be dropped in v1.
- **Retry on upload failure:** click the retry icon to re-POST the same file
  bytes from memory. No confirmation dialog, no re-picker. R2 retries are
  idempotent per deterministic `storageKey`.
- **Upload target:** `POST /api/support/attachments/upload` (multipart, session-cookie
  auth). Server streams directly to R2 and creates a `SupportMessageAttachment`
  row with `direction: OUTBOUND`, `uploadState: UPLOADED`, `storageKey` set,
  `providerFileId: null`. Returns the attachment ID. UI holds the ID list until
  the user clicks Send.

- **Send path** rewrites `slack-delivery-service.ts`. `SupportAdapterSendRequest.attachments`
  changes from `SupportAttachment[]` to `attachmentIds: string[]`. The send
  procedure runs as a dedicated Temporal activity
  `support-attachment-deliver.activity.ts` (exported `deliverSupportAttachments`)
  because the multi-step upload has real retry semantics that do not belong
  inline in a router handler.

- **Activity flow (happy path — unified single-entry):**
  1. Load `SupportMessageAttachment` rows by ID, verify workspace ownership.
  2. For each attachment:
     a. `GET https://slack.com/api/files.getUploadURLExternal?filename=...&length=...&alt_text=...`
        (canonical form per Slack docs). `length` is required and must be the
        exact byte count read from the attachment row's `sizeBytes`.
        Returns `{ upload_url, file_id }`.
     b. Stream bytes from R2 → `POST upload_url` with
        `Content-Type: application/octet-stream` raw body.
     c. Collect `file_id` into a list.
  3. `POST https://slack.com/api/files.completeUploadExternal` with
     `{ files: [{ id: file_id, title }], channel_id, thread_ts, initial_comment: messageText }`
     — the `initial_comment` is how text and files merge into a single thread
     entry. Returns the finalized message.
  4. Update each `SupportMessageAttachment` row with the returned `providerFileId`
     and `uploadState: UPLOADED`.

- **Activity flow (fallback path — two-entry):** If `files.completeUploadExternal`
  fails (upload error, Slack 5xx, permission denied), the activity falls back to:
  1. Send the text via plain `chat.postMessage` with `username` + `icon_url` per §4.6.
  2. Mark failed attachments with `errorCode` and surface in the inbox as
     "Retry" inline.
  The fallback is a supported degradation, not a crash path. It is explicitly
  tested.

- **Thread appearance:** happy path shows one unified thread entry (text as
  caption, files inline). Fallback shows text and files as separate entries.

- **Error handling:** If the multi-part upload fails halfway AND retry fails,
  any text that was already delivered via the fallback path stays put. Temporal
  retries the attachment step but not the text send — idempotency is tracked
  via `providerFileId`.

- **Message text** is sent via `chat.postMessage` only in the fallback path.
  Delete `formatAttachmentLines` and the `buildSlackMessageText` attachment
  branch — text and attachments are now handled at different points in the
  activity, not concatenated.

### 4.6) Outbound agent identity

- **Slack scope upgrade:** add three new scopes in `slack-oauth-service.ts`:
  - `chat:write.customize` — required for `username`/`icon_url` on `chat.postMessage`
  - `files:write` — required for `files.getUploadURLExternal` / `files.completeUploadExternal`
  - `files:read` — required for `files.info` (Slack Connect stub files)

  Existing installations must reinstall once to pick up all three scopes.
  Communicate this in the banner copy.

- **Reinstall prompt (settings > Slack integration):** shadcn `Alert` with
  `variant="default"` (neutral — the integration still works, it just degrades
  agent identity). Layout: `lucide Info` icon, title "Slack reinstall required",
  body "The Slack integration needs new permissions to show agent name and
  file attachments. Click Reinstall to grant them. Existing conversations are
  not affected.", primary button "Reinstall Slack" on the right, `×` dismiss
  affordance.

- **Banner lifecycle:** server-rendered via the settings page loader. Query
  `SupportInstallation` for the current workspace and evaluate `oauthScopes` —
  if missing any of the three required scopes, render the banner. Dismiss is
  session-scoped (React state, not localStorage). Banner disappears permanently
  when the OAuth callback updates `oauthScopes` to include all three scopes.

- **Per-agent profile resolution:** The acting `User` (TrustLoop agent) is
  known via `SupportCommand.createdByUserId` → `users.findById`. Load
  `displayName` and `avatarUrl`. `User.avatarUrl` already exists at
  `packages/database/prisma/schema/auth.prisma:59` and is populated from
  Google OAuth during login.

- **Send call** (in `slack-delivery-service.ts` and the new deliver activity):
  add `username: agent.displayName` and `icon_url: agent.avatarUrl` to the
  `chat.postMessage` body (fallback path) and to `files.completeUploadExternal`
  via the bot token's customization (happy path). Do not set `as_user` — it is
  deprecated and ignored for bot tokens; `username` + `icon_url` work directly
  with `chat:write.customize`.

- **Failure handling (missing scope):** If the workspace has not reinstalled
  with `chat:write.customize`, Slack returns `not_allowed_token_type` or
  `missing_scope`. The delivery service catches these and:
  1. Falls back to a plain `chat.postMessage` without `username`/`icon_url`.
  2. Prepends the message text with the agent's name, after stripping Slack
     mrkdwn metacharacters (`*`, `_`, `~`, `` ` ``, `<`, `>`) from
     `agent.displayName` so malformed names cannot break formatting:
     `*{safeDisplayName}* replied:\n\n{messageText}`.
  3. Writes a `SupportConversationEvent` of type `DELIVERY_WARNING` so the
     inbox surfaces a one-time warning:
     "Reinstall Slack to show agent name/avatar natively."

- **Automated sends:** If the outbound action is triggered by an automation
  (e.g. an AI draft auto-send from a separate flow), `createdByUserId` is null.
  The send uses the installation's default bot identity with `username: "TrustLoop"`
  and a workspace-configured icon. Never fake a human name for automated sends.

### 4.7) Customer identity in inbox

- **Profile cache:** `SupportCustomerProfile` table (schema in §4.3). On inbound
  event, the ingress activity checks the cache. On miss (or `profileFetchedAt`
  past 24h TTL), call Slack `users.info` and upsert the row.

- **Service module:** extend the existing
  `packages/rest/src/services/support/adapters/slack/slack-user-service.ts`
  (imported as `slackUser`). Add two new functions:
  `slackUser.getCachedProfile(installationId, externalUserId)` and
  `slackUser.refreshProfile(installation, externalUserId)`. Do not create a
  new `slack-profile-service.ts` — that would duplicate the namespace and
  violate the single-service-per-concern convention in `AGENTS.md`.

- **Slack Connect / external users:** Slack's `users.info` can return restricted
  data or fail with `user_not_visible` for external guest users in shared
  channels. Handle three cases:
  1. Full response → upsert with `isBot: false`, `isExternal: user.is_stranger === true`.
  2. Restricted response (`is_stranger: true`, limited profile) → upsert with
     whatever is available, `isExternal: true`.
  3. `user_not_visible` error → upsert with `displayName: null`, `externalUserId`,
     `isExternal: true`. The inbox renders "External user" instead of leaking
     the raw ID as a fake name.

- **Bot actors:** If `users.info` returns `is_bot: true`, upsert with `isBot: true`
  and resolve the bot's display name via `bots.info`. The UI renders a bot icon
  instead of a person avatar.

- **Bulk resolution performance:** The inbox list query must bulk-resolve
  profiles in one DB read. The list loader collects all unique
  `(installationId, externalUserId)` tuples for visible conversations and does
  `findMany({ where: { installationId, externalUserId: { in: ids } } })`. For
  cache misses, fire a background refresh activity; **do not block page render
  on `users.info` latency**. Page shows "Unknown user" on first render for
  missed rows and the real name on the next load.

- **Profile backfill:** Ship a one-shot migration script runnable as an `npm run`
  task that reads all distinct `(installationId, externalUserId)` tuples from
  existing `SupportConversationEvent` rows and calls `slackUser.refreshProfile`
  for each. Run once post-deploy. Rate-limited to respect Slack `users.info`
  tier limits.

### 4.8) Inbox UI — conversation sheet

- **Information hierarchy inside a single event** (inline flow, no nested cards):

  ```
  ┌─ event row ─────────────────────────────────────────────┐
  │ [Avatar 32px] Sarah @ Acme                09:14 AM      │
  │               Hey, the upload button is broken.         │
  │               [image 100% width max-height 320px]       │
  │               [file-row: icon name.pdf · 1.2 MB]        │
  └─────────────────────────────────────────────────────────┘
  ```

  Attachments render in the same indented column beneath the avatar/name/timestamp
  row, in `event.attachments` order. No nested cards, no background tint for
  attachments, no box-shadow. Per DESIGN.md "open layout over nested cards" and
  "shadows minimal."

- **Image rendering:** `<img src="/api/support/attachments/:id" alt="{originalFilename}">`
  with `max-width: 100%; max-height: 320px; border-radius: var(--radius-sm)`.
  Click to expand to full size in a shadcn Dialog.

- **Non-image file row:** single line, mono font. Format:
  `{lucide icon} {originalFilename} · {human size}`. No card wrapper, no background
  tint, no pill/bubble border-radius. Per DESIGN.md anti-slop.

- **PENDING state:** shadcn `Skeleton` at the image position (aspect ratio 16:9,
  max-height 200px for image mimetypes; single-line skeleton for files). Muted
  foreground caption: "Mirroring attachment…".

- **FAILED state:** inline row with `lucide AlertTriangle` in destructive
  foreground, filename, and a "View in Slack →" link opening `file.permalink`.
  Copy: "Attachment unavailable — {errorCode} · View in Slack". No card, no
  background fill.

- **Unsupported image formats (HEIC, SVG, TIFF):** render as the non-image file
  row. SVG specifically is never inlined — prevents XSS via embedded scripts.

- **Bot-actor files:** the event row's avatar slot shows the bot's icon
  (from `bots.info`) with the same size as a person avatar. Only the icon source
  changes.

- **Identity chip:** `{shadcn Avatar src=avatarUrl fallback=initials 32px} {name}`.
  Fall back hierarchy: `realName` → `displayName` → `"External user"` (if
  `isExternal`) → `"Unknown user"`. `<AvatarFallback>` uses initials when
  `avatarUrl` is null — never a generic person silhouette.

- **Identity chip interaction states:**
  - Resolved: default, no indicator.
  - Refreshing (background TTL miss): render the chip normally using stale data.
    Do not show a spinner or skeleton — the refresh is invisible by design.
  - Unresolved (cache miss during bulk load): show "Unknown user" + fallback
    initials "??" until the next page load. Not an error.
  - Bot actor: avatar fallback is a `lucide Bot` icon; name shows the bot
    display name.

- **Inbox fallback warning (agent-identity fallback):** when an outbound reply
  was delivered via the bot-identity fallback path, the inbox renders the
  `DELIVERY_WARNING` event as a single-line caption beneath the event row,
  in muted foreground, with `lucide Info` icon: "Sent as bot — reinstall Slack
  to show your name". Auto-hides on next page load if the workspace has since
  reinstalled.

### 4.9) Responsive behavior

TrustLoop is operator tooling used primarily on laptops (1280-1440px) and
external monitors (1920px+). Two breakpoints only: `≥640px` is the primary
experience; `<640px` is a graceful degradation. No tablet-specific breakpoint.

- **Conversation sheet width:** unchanged from existing behavior.
- **Inbound image:** `max-height: 320px` at `≥640px`, `240px` at `<640px`.
- **Lightbox:** full-screen at `<640px` so the lightbox gives a meaningful size
  increase.
- **Reply composer:** single column at all widths. Action row stays on one line;
  on `<640px` the two buttons share the row with equal flex.
- **Identity chip:** avatar `32px` at all widths. Name truncates with ellipsis at
  18 characters at `<640px`, 28 at `≥640px`. `title` attribute holds the full name.
- **Settings reinstall banner:** full-width at all breakpoints; button stacks
  below the text at `<640px`.

### 4.10) Accessibility

- **Keyboard navigation (composer):**
  - `Tab` enters at textarea.
  - `Tab` from textarea → "Attach files" button → each attached file's
    remove/retry button → "Send" button.
  - `Shift+Tab` reverses. `Enter` activates. `Escape` dismisses an open
    Toaster/Dialog but does not close the Sheet.

- **Keyboard navigation (conversation sheet body):**
  - Arrow keys scroll (native). Tab through interactive elements in events.
  - `Enter` on a focused image opens the lightbox. `Escape` closes and returns
    focus to the originating image.

- **Screen reader labels:**
  - Inbound image: `<img alt="{originalFilename}">`, with `aria-describedby`
    pointing to a visually-hidden `{mimetype} · {human size}` description.
  - PENDING attachment: `<div role="status" aria-live="polite">Mirroring {originalFilename}</div>`.
  - FAILED attachment: `<div role="alert">Attachment unavailable — {errorCode}. <a href="{permalink}">View in Slack</a></div>`.
  - Drop zone overlay: when activated, `aria-live="polite"` announces "Drop file to attach".
  - Composer file strip: `aria-label="{filename}, {size}, uploading"` / uploaded / failed.
  - Identity chip: `<img alt="{name}'s avatar">` or `aria-label="Unknown user"` for the fallback case.
  - Reinstall banner: `role="region" aria-labelledby="reinstall-banner-title"`.

- **Focus management:** shadcn Dialog handles focus trap and restore for the
  lightbox. Verify Escape returns focus to the originating image.

- **Touch target sizes:** all interactive elements are ≥44×44px.

- **Color contrast:** WCAG AA for all text-foreground combinations. DESIGN.md's
  warm neutral palette is already calibrated; do not introduce new muted
  foreground tokens without verifying contrast.

- **Reduced motion:** respect `prefers-reduced-motion: reduce` for the drop
  zone border transition and lightbox open/close animations. Motion is never
  load-bearing.

## 5) Data flow

```
Inbound (customer sends screenshot in Slack):
  Slack event → /api/slack/events → SupportIngressEvent row
                                  → supportInboxWorkflow → runSupportPipeline activity
                                  → inside txn: SupportConversationEvent + PENDING attachment rows
                                  → workflow dispatches mirrorSupportAttachment per file
                                  → [Slack Connect stub check via files.info if needed]
                                  → Slack files download (bot token)
                                  → R2 upload
                                  → SupportMessageAttachment row UPLOADED
                                  → profile cache check → slackUser.refreshProfile on miss
                                  → SupportCustomerProfile upsert

  Inbox UI → server loader (session cookie auth)
          → event relation loads attachments
          → <img src="/api/support/attachments/:id"> (session-cookie auth, 302 to presigned R2 URL)
          → identity chip from (installationId, externalUserId) profile lookup

Outbound (agent replies with a PDF):
  Reply composer → file drop → POST /api/support/attachments/upload (session cookie)
                             → stream to R2 → SupportMessageAttachment row OUTBOUND/UPLOADED
                             → returns attachment ID
                 → agent clicks Send → tRPC mutation includes text + attachment IDs
                 → deliverSupportAttachments activity
                   → (happy path) files.getUploadURLExternal → R2 stream →
                     files.completeUploadExternal with initial_comment = messageText
                   → (fallback path) chat.postMessage(text, username, icon_url) +
                     separate file upload, with DELIVERY_WARNING event if scope missing
                 → SupportDeliveryAttempt row

Garbage collection (nightly):
  support-attachment-gc.workflow → find SupportMessageAttachment where
                                    deletedAt < now() - 7 days → delete R2 object
                                    and hard-delete row
```

## 6) Success Criteria

- [ ] Customer sends a screenshot in a monitored Slack channel → inbox shows a
      loading placeholder within 5 seconds (PENDING row created on ingress),
      full image visible once mirroring completes (p95 <30s).
- [ ] Agent sends a reply with a PDF attached → PDF appears in the Slack thread
      as a native file upload, not a URL link.
- [ ] Agent's reply in Slack shows the agent's real name and avatar
      (post-reinstall) or the `*Alice* replied:` prefix fallback (pre-reinstall).
- [ ] Inbox list shows the customer's real name and avatar.
- [ ] No regression: existing text-only threads continue to work unchanged.
- [ ] Migration runs cleanly on production; no downtime on the Slack webhook endpoint.
- [ ] Type check passes across `apps/web`, `apps/queue`, `packages/rest`,
      `packages/database`, `packages/types`.
- [ ] `npm run check` green.
- [ ] Integration test: end-to-end inbound-file flow against a test Slack workspace.

## 7) Test strategy

Coverage target: every new codepath has at least one unit test; each user flow
has at least one integration test; live Slack API is mocked at the adapter
boundary in the default test run. One opt-in end-to-end smoke test runs against
a real test workspace, gated on the `TEST_SLACK_WORKSPACE` env var (not per-PR).

**Regression-critical tests (non-negotiable):**
- `runSupportPipeline` idempotency replay must return `pendingAttachmentIds`
  from existing state on a retry, not an empty list.
- Text-only Slack delivery via the rewritten `sendThreadReply` must produce
  identical Slack thread output as the current code path for the zero-attachment
  case.

**Test files to create or extend:**
- `apps/queue/test/slack-event-normalizer.test.ts` — extend. Add rawFiles
  extraction, `message_changed`-with-files reclassification, pure-system events
  still drop.
- `apps/queue/test/support-pipeline.test.ts` — new. PENDING row insertion inside
  transaction, pendingAttachmentIds return on happy path and replay path.
- `apps/queue/test/support-attachment-mirror.activity.test.ts` — new. Slack
  Connect stub path, permanent and transient error classification, R2 retry
  idempotency, size cap rejection.
- `apps/queue/test/support-attachment-deliver.activity.test.ts` — new. Happy
  path (unified), fallback path (two-entry), partial failure retry, idempotency
  via providerFileId.
- `apps/queue/test/support-attachment-gc.workflow.test.ts` — new. 7-day grace,
  R2 delete failure handling.
- `packages/rest/test/support-attachment-service.test.ts` — new. R2 client
  wrapper, presigned URL generation, storage key format.
- `packages/rest/test/slack-delivery-service.test.ts` — new.
  `chat:write.customize` happy path, `not_allowed_token_type` fallback with
  mrkdwn-safe name, text-only regression.
- `packages/rest/test/slack-user-service.test.ts` — extend. `getCachedProfile`
  TTL logic, `refreshProfile` bot detection, `user_not_visible` handling.
- `apps/web/test/attachments-route.test.ts` — new. POST upload auth + size limit
  + mimetype rejection; GET proxy auth + 302 redirect + cache headers.

## 8) Risk and mitigation

| Risk | Likelihood | Mitigation |
|---|---|---|
| Install-identity bug blocks this work | Certain (pre-work) | Ship the fix as a separate PR first. All other work waits. |
| R2 account provisioning delays | Med | Start provisioning in parallel with review; fall back to S3 if blocked >1 day. |
| Slack rate limits on `users.info` | Low | 24h TTL on `SupportCustomerProfile`; at most one `users.info` call per customer per day per workspace. |
| Bot lacks access to inbound file (403) | Med | Classified as `PermanentExternalError`; row set to `FAILED`; UI shows permalink fallback. |
| R2 storage leak on soft-delete | Low→Med | Nightly `support-attachment-gc.workflow.ts` sweeper deletes objects after 7-day grace. |
| Slack `files.getUploadURLExternal` `length` requirement | Low | R2 upload persists `sizeBytes` on the attachment row; activity reads it before calling Slack. |
| Large file download timeout on ingest | Med | Activity timeout 2min, Temporal retry 3x; dead-letter on permanent failure. |
| Existing workspaces break on scope upgrade | Med | Banner prompt to reinstall; graceful fallback to legacy send path until reinstall. |
| Multi-tenancy leak via attachment URL guess | Low→Catastrophic | All attachment reads go through the session-authenticated endpoint that verifies workspace membership; bucket URLs are never returned to the client. |

## 9) Rollout order

The implementation fans out across multiple workstreams after two serial
pre-work and foundation steps. Each lane can ship as its own PR.

| Step | Scope | Depends on |
|---|---|---|
| PRE | Install-identity fix (`slack-oauth-service.ts:223` composite key) | — |
| A | Schema + R2 substrate + env contracts + shadcn install (avatar, sonner) + S3 SDK deps | PRE |
| B | Inbound mirror path (`event-normalizer` extension + `support.activity` PENDING insertion + `support.workflow` dispatch + `mirrorSupportAttachment` activity) | PRE, A |
| C | Outbound delivery + agent identity (`slack-delivery-service` rewrite + `deliverSupportAttachments` activity + scope additions) | PRE, A |
| D | Customer identity cache (`slack-user-service` extension + profile refresh hook + backfill script) | PRE, A |
| E | Attachment proxy + upload routes (`apps/web/src/app/api/support/attachments/**`) | A |
| GC | Sweeper workflow (`support-attachment-gc.workflow.ts`) | A |
| UI | Conversation sheet rendering, composer drop zone, settings reinstall banner | A, B, C, D, E |

Parallelization: after A lands, B+D share `support.activity.ts` and serialize in one
lane; C, E, GC run in parallel lanes. UI merges last.

## 10) Out of scope

- **Emoji reactions (`reactions.add`).** Inline `:emoji:` text already works.
- **AI draft / auto-send flow.** Tracked separately.
- **Outbound file cap above 25MB.** v1 ships at 25MB outbound, 100MB inbound.
- **Cold-tier retention implementation.** Column exists (`lifecyclePolicy`) but
  v1 only writes `ARCHIVE_NEVER`.
- **Email / Intercom adapters using the same file substrate.** R2 is channel-
  agnostic but no other channels ship in v1.
- **Aggressive reinstall nudge (admin email, forced disconnect).** v1 uses an
  in-app settings banner only.
- **Workspace-configured bot name/icon for automation-triggered sends.** v1
  uses a hard-coded "TrustLoop" + default icon for automated sends.
- **Inbound files from bot-authored Slack messages** (other integrations
  posting files on behalf of users). v1 keeps the existing drop rule for
  `bot_id`-authored events.

## 11) Open questions

1. **Reinstall rollout.** The in-app banner is the v1 nudge. Is there appetite
   for a more aggressive push (workspace admin email, forced disconnect after
   N days)? Answer shapes the deprecation timeline for the fallback path.

## 12) References

- `docs/domains/support/spec-slack-ingestion-thread-grouping-p0.md` — upstream
  ingestion pipeline this spec extends.
- `docs/domains/support/spec-slack-oauth-install-flow.md` — install flow this
  spec adds scopes to.
- `AGENTS.md` — REST API Classification (first-party vs. external endpoints),
  Service Layer Conventions, soft-delete rules.
- `DESIGN.md` — design system rules this spec calibrates against.
- `packages/database/prisma/schema/support.prisma` — existing support schema
  the new models extend.
- `apps/queue/src/domains/support/support.workflow.ts` — workflow dispatch
  pattern reused for the mirror activity.
